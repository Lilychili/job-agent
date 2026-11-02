// Jobs from the owner's Indeed and LinkedIn alert emails, in the same shape as a board's postings, so
// Search filters and scores them like any other. Where the company's own posting can be found, that is
// what's used.
import { boardHomeUrl, boardFromUrl, followRedirects, linkedInJobUrl, NOT_STATED, type BoardLookup, type BoardReader, type Posting } from "@jobagent/ats";
import { addUsage, extractAlertJobs, NO_USAGE, type AlertJob, type Auth } from "@jobagent/agents";
import { hardFail, listDiscoveredCompanies, normalizeCompany, normalizeTitle, readAlertEmails, unknownPostings, type AlertSource, type DiscoveredCompany, type HardCriteria } from "@jobagent/core";
import type { RunHelpers } from "../runner";
import { errorText, forEachParallel } from "../util";
import { findAndSaveBoard, PARALLEL_LOOKUPS, RECHECK_AFTER_MS } from "./boards";

const MAX_JOBS_PER_SEARCH = 30;
const PARALLEL_EMAILS = 3;
const NOT_JOB_SITE = /^https:\/\/(?!([a-z0-9-]+\.)*(indeed|linkedin)\.)/i;
const FOUND_REASON: Record<AlertSource, string> = { indeed_alert: "From an Indeed alert.", linkedin_alert: "From a LinkedIn alert." };

type SourcedJob = AlertJob & { source: AlertSource };
type Helpers = Pick<RunHelpers, "ctx" | "log" | "signal">;
type FindCompany = (job: SourcedJob, link: string) => Promise<BoardLookup>;

const sameJob = (a: string, b: string) => normalizeTitle(a) === normalizeTitle(b);

/** A posting from the email alone: all Claude can score is its title, company and location. */
function fromEmail(job: SourcedJob, url: string, companyUrl: string | null): Posting {
  const locations = job.location ? [job.location] : [];
  const text = [job.title, job.company, job.location, job.salary === NOT_STATED ? null : job.salary].filter(Boolean).join("\n");
  return { ats: "other", sourceUrl: url, company: job.company, title: job.title, location: job.location, locations, remote: "unknown", salary: job.salary, text, source: job.source, summaryOnly: true, companyUrl };
}

/** One lookup per company per search. A company checked lately costs nothing, unless the link names a board. */
function companyFinder(known: DiscoveredCompany[], read: BoardReader, helpers: Pick<Helpers, "ctx" | "signal">): FindCompany {
  const byName = new Map(known.map((c) => [c.nameNorm, c]));
  const lookups = new Map<string, Promise<BoardLookup>>();
  const dueBefore = Date.now() - RECHECK_AFTER_MS;
  return (job, link) => {
    const key = normalizeCompany(job.company);
    const company = byName.get(key);
    if (company && !company.boardToken && company.checkedAt.getTime() >= dueBefore && !boardFromUrl(link)) return Promise.resolve({ outcome: "none" });
    const home = company?.ats && company.boardToken ? [boardHomeUrl({ ats: company.ats, boardToken: company.boardToken })] : [];
    const lookup = lookups.get(key) ?? findAndSaveBoard({ name: job.company, reason: FOUND_REASON[job.source] },[...home, link], read, helpers);
    lookups.set(key, lookup);
    return lookup;
  };
}

/** The best link there is: the company's own posting, then its site, then its job board, then the alert's. */
async function toPosting(job: SourcedJob, findCompany: FindCompany, signal: AbortSignal): Promise<Posting> {
  // LinkedIn's job links don't lead to the employer, and its pages are never fetched.
  const finalUrl = job.source === "linkedin_alert" ? job.sourceUrl : await followRedirects(job.sourceUrl, signal);
  const hit = await findCompany(job, finalUrl);
  if (hit.outcome !== "found") return fromEmail(job, NOT_JOB_SITE.test(finalUrl) ? finalUrl : job.sourceUrl, null);
  const own = hit.postings.find((p) => sameJob(p.title, job.title));
  if (own) return { ...own, source: job.source };
  // The link went straight to a posting that has since closed, or the board calls the job something else.
  return fromEmail(job, boardFromUrl(finalUrl) ? finalUrl : job.sourceUrl, boardHomeUrl(hit.board));
}

/** Empty when Gmail isn't connected. A problem here is logged and never stops the search. */
export async function readJobAlerts(
  claude: { auth: Auth; model: string },
  { criteria, criteriaKey, read }: { criteria: HardCriteria; criteriaKey: string; read: BoardReader },
  { ctx, log, signal }: Helpers,
) {
  let usage = NO_USAGE;
  let listCostUsd = 0;
  const postings: Posting[] = [];
  try {
    const emails = await readAlertEmails(ctx.pool, signal);
    if (!emails) return { postings, usage, listCostUsd };
    const count = (source: AlertSource) => emails.filter((e) => e.source === source).length;
    await log(`Reading ${count("indeed_alert")} Indeed and ${count("linkedin_alert")} LinkedIn alert emails…`);

    const found: SourcedJob[] = [];
    await forEachParallel(emails, PARALLEL_EMAILS, async ({ source, html }) => {
      try {
        const res = await extractAlertJobs({ ...claude, html, signal });
        usage = addUsage(usage, res.usage);
        listCostUsd += res.listCostUsd;
        found.push(...res.jobs.map((j) => ({ ...j, source, sourceUrl: source === "linkedin_alert" ? linkedInJobUrl(j.sourceUrl) : j.sourceUrl })));
      } catch (err) {
        if (signal.aborted) throw err;
        await log(`Couldn't read an alert email: ${errorText(err)}`);
      }
    });

    // Company and title rules can be judged from the email. Location waits, as a board may list more places.
    const wanted = found.filter((j) => !hardFail({ company: j.company, title: j.title, locations: [], remote: "unknown", salary: NOT_STATED }, criteria));
    // Alerts repeat, so one job can arrive many times. Skipping known ones here saves the lookups.
    const fresh = await unknownPostings(ctx.pool, wanted, criteriaKey);
    const findCompany = companyFinder(await listDiscoveredCompanies(ctx.pool), read, { ctx, signal });
    await forEachParallel(fresh.slice(0, MAX_JOBS_PER_SEARCH), PARALLEL_LOOKUPS, async (job) => {
      postings.push(await toPosting(job, findCompany, signal));
    });
    const own = postings.filter((p) => !p.summaryOnly).length;
    await log(`Job alerts: ${found.length} jobs, ${fresh.length} new. Found ${own} on the company's own board.`);
  } catch (err) {
    if (signal.aborted) throw err;
    await log(`Couldn't read job alerts: ${errorText(err)}`);
  }
  return { postings, usage, listCostUsd };
}
