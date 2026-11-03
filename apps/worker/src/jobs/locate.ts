// Finds an approved job's application form, so the card can show it before Apply. Trusted sources first:
// the posting link, then the company's board. Only then Claude searches the web for the careers page,
// which is read for links to a board; findBoard checks any board found belongs to the company.
import { eq } from "drizzle-orm";
import { findCareersLinks } from "@jobagent/agents";
import { boardFromUrl, findForm, type FormLookup } from "@jobagent/ats";
import { application, createDb, job } from "@jobagent/db";
import { readCareersPage } from "@jobagent/forms";
import { claudeFromSettings, saveUsage } from "../claude";
import type { Outcome, RunHelpers } from "../runner";
import { errorText } from "../util";

export interface FoundForm {
  url: string;
  ats: "greenhouse" | "lever" | "ashby";
  title: string;
}

const CAREERS_TIMEOUT_MS = 3 * 60 * 1000;

/** Look for the form and store the answer on the job. Returns the form, or null when there is none to fill. */
export async function locateForm({ ctx, run, log, signal }: RunHelpers): Promise<{ found: FoundForm | null; lookup: FormLookup }> {
  const db = createDb(ctx.pool);
  const [target] = await db
    .select({ id: job.id, sourceUrl: job.sourceUrl, companyUrl: job.companyUrl, company: job.company, title: job.title })
    .from(application)
    .innerJoin(job, eq(job.id, application.jobId))
    .where(eq(application.id, run.applicationId!));
  if (!target) throw new Error("This application's job is missing.");

  await log(`Looking for the ${target.company} application form…`);
  const careersLinks = async (): Promise<string[]> => {
    let claude;
    try {
      claude = await claudeFromSettings(ctx);
    } catch (err) {
      await log(`Can't search the web for the careers page: ${errorText(err)}`);
      return [];
    }
    await log("Asking Claude to find the company's careers page…");
    const res = await findCareersLinks({ ...claude, company: target.company, title: target.title, signal: AbortSignal.any([signal, AbortSignal.timeout(CAREERS_TIMEOUT_MS)]) });
    await saveUsage(ctx, run.id, { model: claude.model, promptVersion: res.promptVersion, usage: res.usage });
    if (res.suspicious.length) await log(`Claude ignored instructions on ${res.suspicious.length} web page(s)`);
    const links = [...res.links];
    // A careers page that isn't a board may embed or link one.
    for (const link of res.links.filter((l) => !boardFromUrl(l))) {
      await log(`Reading ${new URL(link).host} for a job board…`);
      links.push(...(await readCareersPage(link, signal)).filter((l) => boardFromUrl(l)));
    }
    return links;
  };

  const lookup = await findForm(target, { careersLinks, signal });
  const found: FoundForm | null = lookup.outcome === "found" ? { url: lookup.link.url, ats: lookup.link.ats, title: lookup.link.title } : null;
  await db
    .update(job)
    .set({
      formUrl: found?.url ?? null,
      formAts: found?.ats ?? null,
      formTitle: found?.title ?? null,
      formVia: lookup.outcome === "found" ? lookup.via : lookup.outcome === "none" ? "none" : null,
      formCheckedAt: new Date(),
    })
    .where(eq(job.id, target.id));

  if (lookup.outcome === "found") await log(`Found the form on ${lookup.link.ats}: "${lookup.link.title}"`);
  else if (lookup.outcome === "none") await log("No Greenhouse, Lever or Ashby form found. Apply on the company's site.");
  else await log("A job board didn't answer, so the form may still exist. Apply will look again.");
  return { found, lookup };
}

export async function shipperLocate(h: RunHelpers): Promise<Outcome> {
  const { found, lookup } = await locateForm(h);
  return { kind: "succeeded", output: { outcome: lookup.outcome, ...(found ? { form: found } : {}) } };
}
