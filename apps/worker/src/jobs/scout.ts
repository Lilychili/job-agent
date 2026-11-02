// Search: read the owner's job boards, apply the hard criteria in code, skip what's already known,
// have Claude score the rest in small batches, re-check, and put the survivors in Found.
import { boardKey, type Board, type BoardReader, type Posting } from "@jobagent/ats";
import { addUsage, discoverCompanies, NO_USAGE, scorePostings, type Auth, type ScoutPreferences } from "@jobagent/agents";
import { addFoundJobs, addRejectedPostings, hardFail, listDiscoveredCompanies, MIN_MATCH_SCORE, sha256, unknownPostings, type HardCriteria } from "@jobagent/core";
import { claudeFromSettings, saveUsage } from "../claude";
import { readJobAlerts } from "./alerts";
import { boardReader, findAndSaveBoard, PARALLEL_LOOKUPS, RECHECK_AFTER_MS } from "./boards";
import type { Outcome, RunHelpers } from "../runner";
import { errorText, forEachParallel } from "../util";

// A search has five minutes. What doesn't fit this time is picked up by the next one.
const MAX_SCORED_PER_SEARCH = 40;
const BATCH_SIZE = 10;
const PARALLEL_BATCHES = 3;
// Each search asks Claude for this many new companies; the ones with a board join the next searches too.
const NEW_COMPANIES_PER_SEARCH = 15;
// Discover gets part of the five minutes, so a slow web search can't cost the whole search.
const DISCOVER_TIMEOUT_MS = 120_000;
const MAX_RECHECKS_PER_SEARCH = 10;

type Criteria = HardCriteria & ScoutPreferences & { companyBoards: Board[] };

async function loadCriteria(ctx: RunHelpers["ctx"]): Promise<Criteria> {
  const { rows } = await ctx.pool.query<Criteria>(
    `select roles, locations, remote, salary_floor as "salaryFloor", salary_currency as "salaryCurrency",
            stack_must_have as "stackMustHave", stack_nice_to_have as "stackNiceToHave",
            exclusions, company_boards as "companyBoards"
       from preferences limit 1`,
  );
  const criteria = rows[0];
  if (!criteria) throw new Error("Fill in Profile → Looking for first.");
  return criteria;
}

/**
 * Claude names new companies by searching the web, then code looks for each one's board. Boards found
 * earlier are kept, so every search starts from a bigger list.
 */
async function discoverBoards(
  preferences: ScoutPreferences,
  read: BoardReader,
  { ctx, log, signal }: Pick<RunHelpers, "ctx" | "log" | "signal">,
  claude: { auth: Auth; model: string },
) {
  const known = await listDiscoveredCompanies(ctx.pool);
  const boards: Board[] = known.flatMap((c) => (!c.removed && c.ats && c.boardToken ? [{ ats: c.ats, boardToken: c.boardToken }] : []));
  let usage = NO_USAGE;
  let listCostUsd = 0;
  let promptVersion: string | null = null;

  let named = 0;
  const queue: { name: string; reason: string; link: string | null }[] = [];
  try {
    await log("Asking Claude to search the web for companies…");
    const found = await discoverCompanies({
      ...claude,
      preferences,
      known: known.map((c) => c.name),
      want: NEW_COMPANIES_PER_SEARCH,
      signal: AbortSignal.any([signal, AbortSignal.timeout(DISCOVER_TIMEOUT_MS)]),
    });
    usage = found.usage;
    listCostUsd = found.listCostUsd;
    promptVersion = found.promptVersion;
    named = found.companies.length;
    queue.push(...found.companies);
    if (found.problem) await log(`Claude's list of companies couldn't be used: ${found.problem}`);
    if (found.suspicious.length) await log(`Claude ignored instructions on ${found.suspicious.length} web page(s): ${found.suspicious.join(", ").slice(0, 300)}`);
  } catch (err) {
    if (signal.aborted) throw err;
    // The boards found before are still worth reading.
    await log(`Couldn't look for new companies: ${errorText(err)}`);
  }

  const dueBefore = Date.now() - RECHECK_AFTER_MS;
  const due = known.filter((c) => !c.removed && !c.boardToken && c.checkedAt.getTime() < dueBefore).slice(0, MAX_RECHECKS_PER_SEARCH);
  queue.push(...due.map((c) => ({ name: c.name, reason: c.reason, link: null })));

  let withBoard = 0;
  let unsure = 0;
  await forEachParallel(queue, PARALLEL_LOOKUPS, async (c) => {
    const hit = await findAndSaveBoard({ name: c.name, reason: c.reason }, c.link ? [c.link] : [], read, { ctx, signal });
    if (hit.outcome === "unknown") unsure++;
    if (hit.outcome !== "found") return;
    withBoard++;
    boards.push(hit.board);
  });
  await log(`Claude named ${named} new companies, ${due.length} rechecked; ${withBoard} have a job board I can read${unsure ? `, ${unsure} couldn't be checked` : ""}.`);
  return { boards, usage, listCostUsd, promptVersion };
}

async function readBoards(boards: Board[], read: BoardReader, log: RunHelpers["log"]): Promise<Posting[]> {
  if (boards.length === 0) return [];
  const results = await Promise.allSettled(boards.map((b) => read(b)));
  const failures = results.flatMap((r, i) => (r.status === "rejected" ? [`${boards[i]!.boardToken}: ${errorText(r.reason)}`] : []));
  for (const failure of failures) await log(`Skipped ${failure}`);
  if (failures.length === boards.length) throw new Error(`Couldn't read any job board. ${failures.join("; ")}`);
  return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}

/** Most promising first, so the cap on a big board keeps the jobs with the owner's titles and stack. */
function rank(postings: Posting[], { roles, stackMustHave, stackNiceToHave }: ScoutPreferences): Posting[] {
  const hits = (haystack: string, terms: string[]) => terms.filter((t) => haystack.includes(t.toLowerCase())).length;
  const score = (p: Posting) => {
    const haystack = `${p.title}\n${p.text}`.toLowerCase();
    // An alert is a job the owner asked for, so it starts ahead.
    return (p.source ? 4 : 0) + hits(p.title.toLowerCase(), roles) * 6 + hits(haystack, stackMustHave) * 2 + hits(haystack, stackNiceToHave);
  };
  return postings.map((p) => ({ p, s: score(p) })).sort((a, b) => b.s - a.s).map(({ p }) => p);
}

export async function scoutSearch({ run, ctx, log, signal }: RunHelpers): Promise<Outcome> {
  const criteria = await loadCriteria(ctx);
  const { auth, model } = await claudeFromSettings(ctx);
  const preferences: ScoutPreferences = {
    roles: criteria.roles,
    locations: criteria.locations,
    remote: criteria.remote,
    salaryFloor: criteria.salaryFloor,
    salaryCurrency: criteria.salaryCurrency,
    stackMustHave: criteria.stackMustHave,
    stackNiceToHave: criteria.stackNiceToHave,
    exclusions: criteria.exclusions,
  };
  const read = boardReader(signal);

  const discovered = await discoverBoards(preferences, read, { ctx, log, signal }, { auth, model });
  // Saved here too: a search with nothing left to score still paid for Discover.
  await saveUsage(ctx, run.id, { model, promptVersion: discovered.promptVersion, usage: discovered.usage });
  // The owner's own list plus what Claude found, each board once.
  const boards = [...new Map([...criteria.companyBoards, ...discovered.boards].map((b) => [boardKey(b), b])).values()];

  await log(`Reading ${boards.length} job boards…`);
  const fromBoards = await readBoards(boards, read, log);
  // A rejection only holds for the Preferences it was judged against.
  const criteriaKey = sha256(JSON.stringify(preferences));
  const alerts = await readJobAlerts({ auth, model }, { criteria, criteriaKey, read }, { ctx, log, signal });
  let usage = addUsage(discovered.usage, alerts.usage);
  // And again, for the same reason: reading the alerts cost something too.
  await saveUsage(ctx, run.id, { model, promptVersion: discovered.promptVersion, usage });
  const fetched = [...alerts.postings, ...fromBoards];
  if (fetched.length === 0) throw new Error("No jobs to look at yet: no company with a job board and no alerts. Try again, or add a few under Profile → Looking for.");
  const passing = fetched.filter((p) => !hardFail(p, criteria));
  // Ruling out an alert job cost a lookup, so it's remembered. A board's jobs are checked for free next time.
  await addRejectedPostings(ctx.pool, alerts.postings.filter((p) => hardFail(p, criteria)).map((p) => ({ ...p, matchScore: 0 })), criteriaKey);
  const fresh = await unknownPostings(ctx.pool, passing, criteriaKey);
  const queue = rank(fresh, criteria).slice(0, MAX_SCORED_PER_SEARCH);
  const left = fresh.length - queue.length;
  await log(`${fetched.length} open, ${fetched.length - passing.length} ruled out by your criteria, ${passing.length - fresh.length} already known. Scoring ${queue.length}${left ? ` (${left} left for the next search)` : ""}…`);

  const batches: Posting[][] = [];
  for (let i = 0; i < queue.length; i += BATCH_SIZE) batches.push(queue.slice(i, i + BATCH_SIZE));

  let listCostUsd = discovered.listCostUsd + alerts.listCostUsd;
  let promptVersion = discovered.promptVersion;
  let inserted = 0;
  let scored = 0;
  let belowCutoff = 0;
  const errors: string[] = [];

  await forEachParallel(batches, PARALLEL_BATCHES, async (postings) => {
    try {
      const result = await scorePostings({ auth, model, preferences, postings, signal, log });
      usage = addUsage(usage, result.usage);
      listCostUsd += result.listCostUsd;
      promptVersion = result.promptVersion;
      scored += result.jobs.length;
      // Each batch lands on its own, so cards appear as they're scored and a timeout loses little.
      const passing = result.jobs.filter((j) => !hardFail(j, criteria));
      const keep = passing.filter((j) => j.matchScore >= MIN_MATCH_SCORE);
      // What didn't make it never reaches the board, but is remembered so the next search skips it.
      await addRejectedPostings(ctx.pool, result.jobs.filter((j) => !keep.includes(j)), criteriaKey);
      belowCutoff += result.jobs.filter((j) => j.matchScore < MIN_MATCH_SCORE).length;
      inserted += await addFoundJobs(ctx.pool, keep, run.id);
      await saveUsage(ctx, run.id, { model, promptVersion, usage });
      await log(`Scored ${scored} of ${queue.length}, added ${inserted}.`);
    } catch (err) {
      if (signal.aborted) throw err;
      const message = errorText(err);
      errors.push(message);
      await log(`Couldn't score ${postings.length} postings: ${message}`);
    }
  });

  if (queue.length > 0 && scored === 0) throw new Error(errors[0] ?? "No postings could be scored.");
  await log(`Added ${inserted} new jobs. ${belowCutoff} scored under ${MIN_MATCH_SCORE} and were left out.`);
  return {
    kind: "succeeded",
    output: { fetched: fetched.length, ruledOut: fetched.length - passing.length, known: passing.length - fresh.length, scored, belowCutoff, inserted, left, listCostUsd },
  };
}
