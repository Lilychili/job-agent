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

export interface FoundJob {
  ats: "greenhouse" | "lever" | "ashby" | "other";
  sourceUrl: string;
  company: string;
  title: string;
  location: string | null;
  remote: Remote;
  salary: string;
  text: string;
  matchScore: number;
  matchReasons: { met: string[]; missed: string[] };
  source?: "indeed_alert" | "linkedin_alert";
  companyUrl?: string | null;
}

type JobKeys = Pick<FoundJob, "sourceUrl" | "company" | "title">;

/** Null for a link we can't read: nothing could dedupe it, so it isn't kept. */
function dedupeKeys({ sourceUrl, company, title }: JobKeys) {
  try {
    return { canonicalUrl: canonicalManualUrl(sourceUrl), companyNorm: normalizeCompany(company), titleNorm: normalizeTitle(title) };
  } catch {
    return null;
  }
}

/** Scores under this never reach the board. */
export const MIN_MATCH_SCORE = 55;
/** How long a rejected posting is left alone before it can be scored again, if Preferences don't change first. */
const REJECTED_DAYS = 30;

/**
 * An alert's link changes from email to email and can differ from the posting's own, so an alert job is
 * also remembered by company and title, in the same column.
 */
const rejectedJobKey = (pair: string) => `job:${pair}`;
const jobPair = ({ companyNorm, titleNorm }: { companyNorm: string; titleNorm: string }) => `${companyNorm}\n${titleNorm}`;

/** Remember postings that were turned down, so the next search skips them. */
export async function addRejectedPostings(pool: pg.Pool, rejected: (JobKeys & Pick<FoundJob, "matchScore" | "source">)[], criteriaKey: string): Promise<void> {
  const scores = new Map<string, number>();
  for (const r of rejected) {
    const keys = dedupeKeys(r);
    if (!keys) continue;
    scores.set(keys.canonicalUrl, r.matchScore);
    if (r.source) scores.set(rejectedJobKey(jobPair(keys)), r.matchScore);
  }
  const rows = [...scores].map(([url, score]) => ({ url, score }));
  if (rows.length === 0) return;
  await pool.query(
    `insert into rejected_posting (canonical_url, match_score, criteria_key)
     select url, score, $3 from unnest($1::text[], $2::int[]) as t(url, score)
     on conflict (canonical_url) do update
       set match_score = excluded.match_score, criteria_key = excluded.criteria_key, updated_at = now()`,
    [rows.map((r) => r.url), rows.map((r) => r.score), criteriaKey],
  );
}

/** The postings not on the board yet, one per job, so Claude never scores a duplicate. */
export async function unknownPostings<T extends JobKeys>(pool: pg.Pool, postings: T[], criteriaKey: string): Promise<T[]> {
  const keyed = postings.flatMap((p) => {
    const keys = dedupeKeys(p);
    return keys ? [{ p, ...keys, pair: jobPair(keys) }] : [];
  });
  const { rows } = await pool.query<{ canonical_url: string; pair: string | null }>(
    `select canonical_url, case when archived then null else company_norm || E'\n' || title_norm end as pair
       from job
      where canonical_url = any($1) or (not archived and company_norm || E'\n' || title_norm = any($2))`,
    [keyed.map((k) => k.canonicalUrl), keyed.map((k) => k.pair)],
  );
  const { rows: rejected } = await pool.query<{ canonical_url: string }>(
    `select canonical_url from rejected_posting
      where canonical_url = any($1) and criteria_key = $3 and updated_at > now() - make_interval(days => $2)`,
    [keyed.flatMap((k) => [k.canonicalUrl, rejectedJobKey(k.pair)]), REJECTED_DAYS, criteriaKey],
  );
  const seen = new Set([...rows.flatMap((r) => [r.canonical_url, ...(r.pair ? [r.pair] : [])]), ...rejected.map((r) => r.canonical_url)]);
  return keyed.flatMap(({ p, canonicalUrl, pair }) => {
    if (seen.has(canonicalUrl) || seen.has(pair) || seen.has(rejectedJobKey(pair))) return [];
    seen.add(canonicalUrl).add(pair);
    return [p];
  });
}

/** Scout's finds go in Found. The unique indexes have the last word on duplicates. Returns how many were new. */
export async function addFoundJobs(pool: pg.Pool, jobs: FoundJob[], agentRunId: string): Promise<number> {
  if (jobs.length === 0) return 0;
  return withTx(pool, async (tx) => {
    let added = 0;
    for (const { text, ...j } of jobs) {
      const keys = dedupeKeys(j);
      if (!keys) continue;
      const values = {
        ats: j.ats,
        sourceUrl: j.sourceUrl,
        company: j.company,
        title: j.title,
        location: j.location,
        remote: j.remote,
        salary: j.salary,
        matchScore: j.matchScore,
        matchReasons: j.matchReasons,
        source: j.source ?? null,
        companyUrl: j.companyUrl ?? null,
        ...keys,
        rawPosting: text.slice(0, MAX_POSTING_CHARS),
      };
      const [row] = await tx.insert(job).values(values).onConflictDoNothing().returning({ id: job.id });
      if (!row) continue;
      const [app] = await tx.insert(application).values({ jobId: row.id }).returning({ id: application.id });
      await tx.insert(applicationEvent).values({ applicationId: app!.id, action: "found", toStatus: "found", actorType: "agent", agentRunId });
      added++;
    }
    if (added) await notify(tx, { type: "jobs_added", count: added });
    return added;
  });
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
