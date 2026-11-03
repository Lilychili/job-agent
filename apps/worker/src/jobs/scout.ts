// Search: read the owner's job boards, apply the hard criteria in code, skip what's already known,
// have Claude score the rest in small batches, re-check, and put the survivors in Found.
import { boardKey, type Board, type BoardReader, type Posting } from "@jobagent/ats";
import { addUsage, discoverCompanies, NO_USAGE, scorePostings, type Auth, type ScoutPreferences } from "@jobagent/agents";
import { addFoundJobs, addRejectedPostings, hardFail, listDiscoveredCompanies, MIN_MATCH_SCORE, sha256, unknownPostings, type HardCriteria } from "@jobagent/core";
import type { ProfileFact } from "@jobagent/db";
import { claudeFromSettings, saveUsage } from "../claude";
import { readJobAlerts } from "./alerts";
import { boardReader, findAndSaveBoard, PARALLEL_LOOKUPS, RECHECK_AFTER_MS } from "./boards";
import type { Outcome, RunHelpers } from "../runner";
import { errorText, forEachParallel } from "../util";

// A search has five minutes, so it scores 40 postings. Each source has a share of those, so alert
// summaries (a title and a company) can't crowd out full postings, the only ones whose requirements a
// CV can be fitted to. A share a source can't fill goes to the others; what doesn't fit this time is
// picked up by the next search.
const SCORING_SHARES = { board: 20, indeed_alert: 10, linkedin_alert: 10 } as const;
const MAX_SCORED_PER_SEARCH = Object.values(SCORING_SHARES).reduce((a, b) => a + b, 0);
const BATCH_SIZE = 10;
const PARALLEL_BATCHES = 3;
// Each search asks Claude for this many new companies; the ones with a board join the next searches too.
const NEW_COMPANIES_PER_SEARCH = 15;
// Discover gets part of the five minutes, so a slow web search can't cost the whole search.
const DISCOVER_TIMEOUT_MS = 120_000;
const MAX_RECHECKS_PER_SEARCH = 10;
const PARALLEL_BOARD_READS = 8;

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
 * Requirements are matched against the confirmed Profile only, and remember its version so Pen can
 * match them again after a change. Before the Profile is confirmed, Search still scores.
 */
async function confirmedProfile(ctx: RunHelpers["ctx"]): Promise<{ facts: ProfileFact[]; version: number | null }> {
  const { rows } = await ctx.pool.query<{ facts: ProfileFact[]; version: number }>(`select facts, version from profile where confirmed limit 1`);
  return rows[0] ?? { facts: [], version: null };
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

async function readBoards(boards: Board[], read: BoardReader, log: RunHelpers["log"], signal: AbortSignal): Promise<Posting[]> {
  if (boards.length === 0) return [];
  // A search starts from every board found so far, so the list only grows: read a few at a time.
  const postings: Posting[] = [];
  const failures: string[] = [];
  await forEachParallel(boards, PARALLEL_BOARD_READS, async (board) => {
    try {
      postings.push(...(await read(board)));
    } catch (err) {
      if (signal.aborted) throw err;
      failures.push(`${board.boardToken}: ${errorText(err)}`);
    }
  });
  for (const failure of failures) await log(`Skipped ${failure}`);
  if (failures.length === boards.length) throw new Error(`Couldn't read any job board. ${failures.join("; ")}`);
  return postings;
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

/** The ranked postings to score this time: each source's best up to its share, then the best of the rest. */
function pickForScoring(ranked: Posting[]): Posting[] {
  const used: Record<keyof typeof SCORING_SHARES, number> = { board: 0, indeed_alert: 0, linkedin_alert: 0 };
  const within = new Set<Posting>();
  for (const p of ranked) {
    const source = p.source ?? "board";
    if (used[source] >= SCORING_SHARES[source]) continue;
    used[source]++;
    within.add(p);
  }
  const spare = ranked.filter((p) => !within.has(p)).slice(0, MAX_SCORED_PER_SEARCH - within.size);
  const picked = new Set([...within, ...spare]);
  return ranked.filter((p) => picked.has(p));
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
  const profile = await confirmedProfile(ctx);
  const read = boardReader(signal);

  const discovered = await discoverBoards(preferences, read, { ctx, log, signal }, { auth, model });
  // Saved here too: a search with nothing left to score still paid for Discover.
  await saveUsage(ctx, run.id, { model, promptVersion: discovered.promptVersion, usage: discovered.usage });
  // The owner's own list plus what Claude found, each board once.
  const boards = [...new Map([...criteria.companyBoards, ...discovered.boards].map((b) => [boardKey(b), b])).values()];

  await log(`Reading ${boards.length} job boards…`);
  const fromBoards = await readBoards(boards, read, log, signal);
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
  const queue = pickForScoring(rank(fresh, criteria));
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
      const result = await scorePostings({ auth, model, preferences, facts: profile.facts, postings, signal, log });
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
      inserted += await addFoundJobs(ctx.pool, keep.map((j) => ({ ...j, requirementsProfileVersion: profile.version })), run.id);
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
