// Prefill v1: open the job's application form as a tab in the Shipper's visible window, fill it from the
// Profile, the AnswerBank and the approved documents, then hand the tab to the owner, who submits it.
// There is no submit step: `packages/forms` blocks the submit request until the hand-over.
// A required question with no answer raises a Blocker and pauses; resuming fills the form from scratch.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { letterText } from "@jobagent/agents";
import { lookupAnswer, questionKey, raiseBlocker, resolveDataPath, transition } from "@jobagent/core";
import { application, createDb, document, evidence, job, notify, profile, type ProfileFact } from "@jobagent/db";
import { adapterFor, closeWindow, FormSession, heldWindow, holdWindow, prefill } from "@jobagent/forms";
import type { CoreContext } from "@jobagent/core";
import type { Outcome, RunHelpers } from "../runner";
import { locateForm, type FoundForm } from "./locate";

/** Blockers show the options; a university list can run to thousands. */
const MAX_BLOCKER_OPTIONS = 100;
const MAX_PAGE_TEXT = 20_000;

const headless = () => process.env.SHIPPER_HEADLESS === "1";

/** Record whether the application's form is open in the window, so the board can offer Show form. */
async function setWindowOpen(ctx: CoreContext, appId: string, open: boolean): Promise<void> {
  const db = createDb(ctx.pool);
  const [app] = await db.update(application).set({ formWindowOpen: open }).where(eq(application.id, appId)).returning();
  if (app) await notify(db, { type: "application", applicationId: app.id, status: app.status, hasOpenBlocker: app.hasOpenBlocker });
}

/** The employer of the role the Profile has no end date for. */
function currentCompany(facts: ProfileFact[]): string | null {
  return facts.find((f) => f.kind === "role" && f.org && !f.endDate)?.org ?? null;
}

export async function shipperPrefill(helpers: RunHelpers): Promise<Outcome> {
  const { ctx, run, log, signal } = helpers;
  const appId = run.applicationId!;
  const db = createDb(ctx.pool);

  // Never touch a form that was already submitted.
  const prior = await db
    .select({ id: evidence.id })
    .from(evidence)
    .where(and(eq(evidence.applicationId, appId), eq(evidence.type, "submission")))
    .limit(1);
  if (prior.length) throw new Error("Submission evidence exists; refusing to prefill again");

  const [target] = await db
    .select({
      company: job.company,
      formUrl: job.formUrl,
      formAts: job.formAts,
      formTitle: job.formTitle,
      formVia: job.formVia,
      cvId: application.approvedCvDocId,
      letterId: application.approvedLetterDocId,
    })
    .from(application)
    .innerJoin(job, eq(job.id, application.jobId))
    .where(eq(application.id, appId));
  if (!target) throw new Error("This application's job is missing.");
  if (target.formVia === "none") throw new Error("No Greenhouse, Lever or Ashby form was found for this job. Apply on the company's site yourself.");
  // Found when the card was approved; looked for now if that didn't finish or a board didn't answer.
  let form: FoundForm | null =
    target.formUrl && target.formAts && target.formAts !== "other" ? { url: target.formUrl, ats: target.formAts, title: target.formTitle ?? "" } : null;
  if (!form) form = (await locateForm(helpers)).found;
  if (!form) throw new Error("Couldn't find this job's application form. Apply on the company's site yourself, or try Apply again later.");
  const adapter = adapterFor(form.ats);
  if (!adapter) throw new Error(`Prefill can't fill ${form.ats} forms yet. Open the form from the card and apply there yourself.`);
  const url = adapter.applyUrl(form.url);
  if (!url) throw new Error(`The form link isn't a ${form.ats} posting: ${form.url}`);

  const [p] = await db.select().from(profile).limit(1);
  if (!p?.confirmed) throw new Error("Profile is not confirmed");
  const docIds = [target.cvId, target.letterId].filter((x): x is string => !!x);
  const docs = docIds.length ? await db.select().from(document).where(inArray(document.id, docIds)) : [];
  const cv = docs.find((d) => d.id === target.cvId);
  const letter = docs.find((d) => d.id === target.letterId);
  if (!cv?.approvedAt) throw new Error("There is no approved CV for this application.");
  const letterContent = letter?.approvedAt && letter.content && "paragraphs" in letter.content ? letter.content : null;

  // A window from an earlier run of this application is stale now.
  await closeWindow(appId);
  await log(`Opening the ${target.company} application form…`);
  const session = await FormSession.open(adapter, url, {
    headless: headless(),
    profileDir: headless() ? undefined : resolveDataPath(ctx, "browser"),
    onBlocked: (what) => void log(`Blocked ${what}`),
  });
  const stop = () => void session.close();
  signal.addEventListener("abort", stop);
  let handedOver = false;
  try {
    const result = await prefill(
      session,
      {
        contact: p.contact,
        currentCompany: currentCompany(p.facts),
        letterText: letterContent ? letterText(letterContent, p.contact) : null,
        lookup: (question) => lookupAnswer(ctx, appId, question),
      },
      { path: resolveDataPath(ctx, cv.pdfPath), sha256: cv.sha256 },
    );

    if (result.unknown.length) {
      const asked = new Set<string>();
      for (const field of result.unknown) {
        if (asked.has(questionKey(field.label))) continue;
        asked.add(questionKey(field.label));
        await log(`No answer for "${field.label}". Raising a Blocker.`);
        await raiseBlocker(ctx, run.id, {
          question: field.label,
          fieldContext: { label: field.label, type: field.kind, ...(field.options ? { options: field.options.slice(0, MAX_BLOCKER_OPTIONS) } : {}) },
          checkpoint: { step: "custom_questions", url },
        });
      }
      return { kind: "paused" };
    }

    for (const f of result.filled) await log(`Filled "${f.label}" from the ${f.source === "answerBank" ? "AnswerBank" : f.source}`);
    for (const { field, error } of result.failed) await log(`Couldn't fill "${field.label}": ${error}`);
    const leftForOwner = [...result.skipped, ...result.failed.map((f) => f.field)];
    const requiredLeft = leftForOwner.filter((f) => f.required).map((f) => f.label);
    if (leftForOwner.length) await log(`Left for you: ${leftForOwner.map((f) => `"${f.label}"`).join(", ")}`);

    const rel = path.join("evidence", appId, `prefill-${run.id}.png`);
    const full = resolveDataPath(ctx, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await session.screenshot(full);
    await db.insert(evidence).values({
      applicationId: appId,
      agentRunId: run.id,
      type: "prefill_screenshot",
      filePath: rel,
      text: `Prefilled ${result.filled.length} fields on ${url}; stopped before submit.${requiredLeft.length ? ` Required and still empty: ${requiredLeft.join("; ")}.` : ""}`,
    });

    // The status change goes first: it refuses if the card was dismissed meanwhile, and then the window closes.
    await transition(ctx, appId, "prefillDone", { actor: "system", runId: run.id });
    if (!headless()) {
      await session.handOver();
      holdWindow(appId, session);
      handedOver = true;
      session.onClose(() => void setWindowOpen(ctx, appId, false).catch(() => {}));
      await setWindowOpen(ctx, appId, true);
    }
    await log(headless() ? "Stopped before submit." : "Stopped before submit. Review the form in its tab in the Shipper window and submit it there.");
    return {
      kind: "succeeded",
      output: {
        url,
        filled: result.filled.map((f) => ({ fieldId: f.fieldId, label: f.label, source: f.source })),
        leftForOwner: leftForOwner.map((f) => f.label),
        screenshot: rel,
      },
    };
  } finally {
    signal.removeEventListener("abort", stop);
    if (!handedOver) await session.close();
  }
}

/** After the owner marks it applied: keep what the form window shows now, then close it. */
/** The owner clicked Show form: bring the application's tab to the front. */
export async function showForm(applicationId: string): Promise<void> {
  await heldWindow(applicationId)?.show();
}

export async function shipperCaptureEvidence({ ctx, run, log }: RunHelpers): Promise<Outcome> {
  const appId = run.applicationId!;
  const db = createDb(ctx.pool);
  const session = heldWindow(appId);
  if (!session) {
    await log("The form window is closed, so there is no confirmation page to keep.");
    return { kind: "succeeded" };
  }
  try {
    const rel = path.join("evidence", appId, `confirmation-${run.id}.png`);
    const full = resolveDataPath(ctx, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await session.screenshot(full);
    // Page text is untrusted; it is only stored, never read by an agent.
    const text = (await session.page.locator("body").innerText()).slice(0, MAX_PAGE_TEXT);
    await db.insert(evidence).values({ applicationId: appId, agentRunId: run.id, type: "confirmation_text", filePath: rel, text });
    await log("Kept a screenshot and the text of the confirmation page");
  } finally {
    await closeWindow(appId);
  }
  return { kind: "succeeded" };
}
