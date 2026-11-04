// Craft: Claude tailors the owner's CV (every fact kept, reordered and reworded for the job) and writes a
// cover letter, code checks every citation, then the documents are printed to PDF, stripped of metadata,
// hashed and saved as a new version. The card then waits in Drafted until the owner approves the draft in
// the Craft modal. Pen orders the CV by the job's requirements, so ones never read, or matched against an
// older Profile, are read again first; the card and modal then also count a fact the owner just added.
import { eq } from "drizzle-orm";
import { addUsage, craftDocuments, NO_USAGE, printDocuments, readRequirements, withDocuments } from "@jobagent/agents";
import { transitionInTx } from "@jobagent/core";
import { answerBank, application, createDb, job, profile, settings } from "@jobagent/db";
import { claudeFromSettings, saveUsage } from "../claude";
import type { Outcome, RunHelpers } from "../runner";
import { errorText } from "../util";

export async function penCraft({ ctx, run, log, signal }: RunHelpers): Promise<Outcome> {
  const appId = run.applicationId!;
  const db = createDb(ctx.pool);
  const [p] = await db.select().from(profile).limit(1);
  if (!p?.confirmed) throw new Error("Profile is not confirmed");
  const [target] = await db
    .select({ id: job.id, company: job.company, title: job.title, posting: job.rawPosting, requirements: job.requirements, matchedVersion: job.requirementsProfileVersion })
    .from(application)
    .innerJoin(job, eq(job.id, application.jobId))
    .where(eq(application.id, appId));
  if (!target) throw new Error("This application's job is missing.");
  const [why] = await db.select({ answer: answerBank.answer }).from(answerBank).where(eq(answerBank.questionKey, "why_this_company"));
  const { auth, model } = await claudeFromSettings(ctx);

  let usage = NO_USAGE;
  let readVersion: string | null = null;
  let requirements = target.requirements;
  if (!target.requirements || target.matchedVersion !== p.version) {
    await log("Reading what the job requires…");
    try {
      const read = await readRequirements({ auth, model, facts: p.facts, job: target, signal });
      usage = read.usage;
      readVersion = read.promptVersion;
      requirements = read.requirements;
      await db.update(job).set({ requirements: read.requirements, requirementsProfileVersion: p.version }).where(eq(job.id, target.id));
    } catch (err) {
      if (signal.aborted) throw err;
      // Pen can order the CV from the posting alone, so the draft goes on; the next craft tries again.
      await log(`Couldn't read the job's requirements: ${errorText(err)}`);
    }
  }

  await log(`Writing a CV and cover letter for ${target.company}…`);
  const { draft, promptVersion: penVersion, usage: penUsage } = await craftDocuments({ auth, model, facts: p.facts, job: { ...target, requirements: requirements?.map((r) => r.text) }, whyTemplate: why?.answer.trim() || null, signal, log });
  // A run that used Search's prompt too records both versions.
  const promptVersion = [penVersion, readVersion].filter(Boolean).join("+");
  await saveUsage(ctx, run.id, { model, promptVersion, usage: addUsage(usage, penUsage) });

  await log("Printing the PDFs…");
  // Drafts get the look the owner last chose in the Craft modal.
  const [cfg] = await db.select({ style: settings.documentStyle }).from(settings).limit(1);
  const documents = await printDocuments(draft, p, cfg?.style ?? "color");
  // The status change goes first: it locks the card, and refuses if it was dismissed meanwhile, so
  // neither document is saved.
  const version = await withDocuments(ctx, async (tx, client, save) => {
    await transitionInTx(ctx, tx, client, appId, "craftSucceeded", { actor: "system", runId: run.id });
    return save({ applicationId: appId, documents, profileVersion: p.version, agentRunId: run.id });
  });
  await log(`Saved the draft as version ${version}`);
  return { kind: "succeeded" };
}
