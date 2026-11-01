// Jobs the owner adds by hand. Same dedupe and same starting point as the ones Scout finds.
import type pg from "pg";
import { application, applicationEvent, job, jobRemote, notify, withTx } from "@jobagent/db";
import { atsFromUrl, canonicalManualUrl, normalizeCompany, normalizeTitle } from "./normalize";
import { str, ValidationError } from "./profile";

const MAX_POSTING_CHARS = 100_000;

type Remote = (typeof jobRemote.enumValues)[number];

export function parseJob(input: unknown): Omit<typeof job.$inferInsert, "id" | "createdAt" | "updatedAt"> {
  const b = (input ?? {}) as Record<string, unknown>;

  const company = str(b.company);
  const title = str(b.title);
  if (!company) throw new ValidationError("Company is required.");
  if (!title) throw new ValidationError("Job title is required.");

  const rawUrl = str(b.sourceUrl);
  if (!rawUrl) throw new ValidationError("A link to the posting is required.");
  let sourceUrl: string;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || !u.hostname.includes(".")) throw new Error();
    sourceUrl = u.toString();
  } catch {
    throw new ValidationError(`"${rawUrl}" is not a valid link.`);
  }

  const remote = (str(b.remote) || "unknown") as Remote;
  if (!jobRemote.enumValues.includes(remote)) throw new ValidationError("Choose a work style.");

  const rawPosting = str(b.rawPosting);
  if (rawPosting.length > MAX_POSTING_CHARS) throw new ValidationError("The job description is too long.");

  return {
    ats: atsFromUrl(sourceUrl) ?? "other",
    sourceUrl,
    canonicalUrl: canonicalManualUrl(sourceUrl),
    company,
    companyNorm: normalizeCompany(company),
    title,
    titleNorm: normalizeTitle(title),
    location: str(b.location) || null,
    remote,
    salary: str(b.salary) || "not stated",
    rawPosting,
  };
}

/** Puts the job in Found. A dismissed job stays out, as it does for Scout. */
export async function addJob(pool: pg.Pool, input: unknown): Promise<{ applicationId: string }> {
  const values = parseJob(input);
  return withTx(pool, async (tx) => {
    const [row] = await tx.insert(job).values(values).onConflictDoNothing().returning({ id: job.id });
    if (!row) throw new ValidationError("This job is already on the board, or you dismissed it earlier.");
    const [app] = await tx.insert(application).values({ jobId: row.id }).returning({ id: application.id });
    await tx.insert(applicationEvent).values({
      applicationId: app!.id,
      action: "added",
      toStatus: "found",
      actorType: "owner",
    });
    await notify(tx, { type: "jobs_added", count: 1 });
    return { applicationId: app!.id };
  });
}
