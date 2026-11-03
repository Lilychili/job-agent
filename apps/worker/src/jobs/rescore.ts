// After the owner's CV changes, Claude scores the open cards again against the Profile as it is now:
// the score, the reasons and which facts meet each core requirement. Cards keep their place on the board,
// whatever the new score; only Search drops postings under the cut-off.
import type { Posting } from "@jobagent/ats";
import { addUsage, NO_USAGE, scorePostings } from "@jobagent/agents";
import { startRescore, TransitionError } from "@jobagent/core";
import { createDb, notify } from "@jobagent/db";
import { claudeFromSettings, saveUsage } from "../claude";
import type { Outcome, RunHelpers } from "../runner";
import { errorText, forEachParallel } from "../util";
import { BATCH_SIZE, confirmedProfile, loadCriteria, PARALLEL_BATCHES, preferencesOf } from "./scout";

/** Statuses whose cards a better or worse score still matters for. */
const OPEN = ["found", "shortlisted", "crafting", "crafted", "approved"];

interface StaleJob {
  id: string;
  ats: Posting["ats"];
  sourceUrl: string;
  company: string;
  title: string;
  location: string | null;
  remote: Posting["remote"];
  salary: string;
  rawPosting: string;
  source: string | null;
  companyUrl: string | null;
}

/** Open cards scored against an older Profile, or before Search remembered which. */
export async function staleCards(ctx: RunHelpers["ctx"], profileVersion: number): Promise<StaleJob[]> {
  const { rows } = await ctx.pool.query<StaleJob>(
    `select j.id, j.ats, j.source_url as "sourceUrl", j.company, j.title, j.location, j.remote, j.salary,
            j.raw_posting as "rawPosting", j.source, j.company_url as "companyUrl"
       from job j join application a on a.job_id = j.id
      where a.status = any($1) and j.requirements_profile_version is distinct from $2`,
    [OPEN, profileVersion],
  );
  return rows;
}

const toPosting = (j: StaleJob): Posting => ({
  ats: j.ats,
  sourceUrl: j.sourceUrl,
  company: j.company,
  title: j.title,
  location: j.location,
  locations: j.location ? [j.location] : [],
  remote: j.remote,
  salary: j.salary,
  text: j.rawPosting,
  ...(j.source ? { source: j.source as Posting["source"] } : {}),
  // Alert jobs no board could be found for are known only from the email's summary.
  summaryOnly: j.ats === "other" && !!j.source,
  companyUrl: j.companyUrl,
});

export async function scoutRescore({ run, ctx, log, signal }: RunHelpers): Promise<Outcome> {
  const profile = await confirmedProfile(ctx);
  if (profile.version === null) {
    await log("The Profile isn't confirmed, so there is nothing to score against.");
    return { kind: "succeeded" };
  }
  const stale = await staleCards(ctx, profile.version);
  if (!stale.length) {
    await log("Every card is already scored against your current Profile.");
    return { kind: "succeeded", output: { rescored: 0 } };
  }
  const preferences = preferencesOf(await loadCriteria(ctx));
  const { auth, model } = await claudeFromSettings(ctx);
  await log(`Scoring ${stale.length} cards again against your current Profile…`);

  const byUrl = new Map(stale.map((j) => [j.sourceUrl, j.id]));
  const postings = stale.map(toPosting);
  const batches: Posting[][] = [];
  for (let i = 0; i < postings.length; i += BATCH_SIZE) batches.push(postings.slice(i, i + BATCH_SIZE));

  let usage = NO_USAGE;
  let promptVersion: string | null = null;
  let done = 0;
  const errors: string[] = [];
  await forEachParallel(batches, PARALLEL_BATCHES, async (batch) => {
    try {
      const result = await scorePostings({ auth, model, preferences, facts: profile.facts, postings: batch, signal, log });
      usage = addUsage(usage, result.usage);
      promptVersion = result.promptVersion;
      for (const j of result.jobs) {
        const id = byUrl.get(j.sourceUrl);
        if (!id) continue;
        await ctx.pool.query(
          `update job set match_score = $2, match_reasons = $3, requirements = $4, requirements_profile_version = $5, updated_at = now() where id = $1`,
          [id, j.matchScore, JSON.stringify(j.matchReasons), JSON.stringify(j.requirements), profile.version],
        );
        done++;
      }
      await saveUsage(ctx, run.id, { model, promptVersion, usage });
      await log(`Scored ${done} of ${stale.length} again.`);
    } catch (err) {
      if (signal.aborted) throw err;
      errors.push(errorText(err));
      await log(`Couldn't score ${batch.length} cards: ${errorText(err)}`);
    }
  });
  if (done === 0) throw new Error(errors[0] ?? "No cards could be scored.");
  // Cards whose scores changed show it on the next board refresh.
  await notify(createDb(ctx.pool), { type: "jobs_added", count: 0 });
  return { kind: "succeeded", output: { rescored: done, failed: stale.length - done } };
}

/** A re-score started at most this often by the heartbeat, so a card that always fails can't cost much. */
const BACKSTOP_EVERY_MS = 30 * 60 * 1000;

/**
 * The heartbeat's backstop: a CV saved while a search ran, or a re-score that timed out, still gets its
 * cards scored again once nothing else is scoring.
 */
export async function rescoreIfStale(ctx: RunHelpers["ctx"]): Promise<void> {
  const profile = await confirmedProfile(ctx);
  if (profile.version === null || (await staleCards(ctx, profile.version)).length === 0) return;
  const { rows } = await ctx.pool.query(
    `select 1 from agent_run where job_name = 'scout.rescore' and created_at > now() - make_interval(secs => $1) limit 1`,
    [BACKSTOP_EVERY_MS / 1000],
  );
  if (rows.length) return;
  try {
    await startRescore(ctx);
  } catch (err) {
    // A search is running; the next beat tries again.
    if (!(err instanceof TransitionError)) throw err;
  }
}
