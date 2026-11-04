import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  agentRun,
  answerBank,
  application,
  applicationEvent,
  blocker,
  notify,
  withTx,
  type FieldContext,
  type RunLogEntry,
} from "@jobagent/db";
import { answerRule, checkAnswer } from "./answers";
import { TransitionError, type CoreContext } from "./context";
import { checkGuards } from "./guards";
import { ACTIVE_RUN_STATUSES, BUSY_RUN_STATUSES, getRule, JOBS, type JobName } from "./machine";
import { questionKey } from "./normalize";
import { transition, transitionInTx } from "./transition";

export type Run = typeof agentRun.$inferSelect;

/**
 * Atomically move a run from queued → running. Returns null if it is not queued
 * (already handled, superseded, or a duplicate delivery), which makes jobs idempotent.
 */
export async function claimRun(ctx: CoreContext, runId: string): Promise<Run | null> {
  return withTx(ctx.pool, async (tx) => {
    const [run] = await tx
      .update(agentRun)
      .set({ status: "running", startedAt: new Date() })
      .where(and(eq(agentRun.id, runId), eq(agentRun.status, "queued")))
      .returning();
    if (run) {
      await notify(tx, { type: "run", runId, applicationId: run.applicationId, status: "running", jobName: run.jobName });
    }
    return run ?? null;
  });
}

export async function appendLog(
  ctx: CoreContext,
  runId: string,
  message: string,
  level: RunLogEntry["level"] = "info",
): Promise<void> {
  const entry: RunLogEntry = { at: new Date().toISOString(), level, message };
  // Append and notify in one statement so the board shows progress as it happens.
  await ctx.pool.query(
    `with u as (
       update agent_run set logs = logs || $1::jsonb, updated_at = now() where id = $2
       returning id, application_id, status, job_name
     )
     select pg_notify('app_events', json_build_object(
       'type', 'run', 'runId', id, 'applicationId', application_id, 'status', status, 'jobName', job_name
     )::text) from u`,
    [JSON.stringify([entry]), runId],
  );
}

/**
 * Close a run that is still running. A no-op if a transition already closed it
 * (craftSucceeded, prefillDone…) or a Blocker paused it.
 */
export async function finishRun(
  ctx: CoreContext,
  runId: string,
  result: { status: "succeeded" | "failed"; output?: Record<string, unknown>; error?: string },
): Promise<void> {
  await withTx(ctx.pool, async (tx) => {
    const [run] = await tx
      .update(agentRun)
      .set({ status: result.status, output: result.output, error: result.error, finishedAt: new Date() })
      .where(and(eq(agentRun.id, runId), inArray(agentRun.status, BUSY_RUN_STATUSES)))
      .returning();
    if (run) {
      await notify(tx, { type: "run", runId, applicationId: run.applicationId, status: result.status, jobName: run.jobName });
    }
  });
}

/** Runs that aren't tied to a card aren't transitions. Only one of each role at a time. */
async function startSoloRun(
  ctx: CoreContext,
  run: { role: "scout" | "extractor" | "replies"; jobName: JobName; input: Record<string, unknown>; busyMessage: string },
): Promise<{ runId: string }> {
  return withTx(ctx.pool, async (tx, client) => {
    // Serialize concurrent clicks.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${run.jobName}))`);
    const active = await tx
      .select({ id: agentRun.id })
      .from(agentRun)
      .where(and(eq(agentRun.role, run.role), inArray(agentRun.status, BUSY_RUN_STATUSES)))
      .limit(1);
    if (active.length) throw new TransitionError("busy", run.busyMessage);
    const [row] = await tx
      .insert(agentRun)
      .values({ role: run.role, jobName: run.jobName, input: run.input })
      .returning({ id: agentRun.id });
    const runId = row!.id;
    await ctx.enqueue(client, { name: run.jobName, id: runId, data: { runId, applicationId: null } });
    await notify(tx, { type: "run", runId, applicationId: null, status: "queued", jobName: run.jobName });
    return { runId };
  });
}

export function startSearch(ctx: CoreContext): Promise<{ runId: string }> {
  return startSoloRun(ctx, { role: "scout", jobName: JOBS.scoutSearch, input: {}, busyMessage: "A search is already running." });
}

/** Score the open cards again against the Profile as it is now, after its facts changed. */
export function startRescore(ctx: CoreContext): Promise<{ runId: string }> {
  return startSoloRun(ctx, { role: "scout", jobName: JOBS.scoutRescore, input: {}, busyMessage: "A search is running; it scores the cards again when it ends." });
}

/** Look in the owner's mail for answers to the applications they sent. */
export function startRepliesCheck(ctx: CoreContext): Promise<{ runId: string }> {
  return startSoloRun(ctx, { role: "replies", jobName: JOBS.repliesCheck, input: {}, busyMessage: "Replies are already being checked." });
}

/** Queue a CV extraction. `file` is relative to DATA_DIR (the web app saved the upload there). */
export function startExtraction(ctx: CoreContext, file: { path: string; name: string }): Promise<{ runId: string }> {
  return startSoloRun(ctx, {
    role: "extractor",
    jobName: JOBS.extractorExtract,
    input: { file: file.path, fileName: file.name },
    busyMessage: "A CV is already being read.",
  });
}

/** How a failed or timed-out run rolls back the card, per queue. */
const FAILURE_ACTION: Partial<Record<JobName, string>> = {
  [JOBS.penCraft]: "craftFailed",
  [JOBS.shipperPrefill]: "prefillFailed",
  [JOBS.shipperResume]: "prefillFailed",
};

/** Close a run as failed and roll its card back, so nothing is left spinning. */
export async function failRun(ctx: CoreContext, run: Pick<Run, "id" | "jobName" | "applicationId">, error: string): Promise<void> {
  const action = FAILURE_ACTION[run.jobName as JobName];
  if (action && run.applicationId) {
    try {
      await transition(ctx, run.applicationId, action, { actor: "system", runId: run.id, error });
      return;
    } catch (e) {
      console.error(`[${run.jobName}] rollback transition failed:`, e);
    }
  }
  await finishRun(ctx, run.id, { status: "failed", error });
}

/** A queued job nobody picked up for this long is never going to run (pg-boss has dropped it). */
const QUEUED_MAX_AGE_SECONDS = 24 * 60 * 60;

/**
 * A crashed worker leaves runs `running` forever, and the one-active-run rule would then block the
 * card (or Search) for good. Fail anything past its time limit. `limits` is seconds per queue;
 * `assumeNoneRunning` is for worker startup, when no run can really be in progress.
 */
export async function failStaleRuns(
  ctx: CoreContext,
  limits: Partial<Record<string, number>>,
  opts: { assumeNoneRunning?: boolean } = {},
): Promise<number> {
  const { rows } = await ctx.pool.query<{
    id: string;
    job_name: string;
    application_id: string | null;
    status: string;
    age: number;
  }>(
    `select id, job_name, application_id, status,
            extract(epoch from now() - coalesce(started_at, created_at))::float8 as age
       from agent_run where status in ('queued', 'running')`,
  );
  const stale = rows.filter((r) =>
    r.status === "queued" ? r.age > QUEUED_MAX_AGE_SECONDS : opts.assumeNoneRunning || r.age > (limits[r.job_name] ?? Infinity),
  );
  for (const r of stale) {
    const error = r.status === "queued" ? "This run was never picked up. Try again." : "The worker stopped before this run finished. Try again.";
    await failRun(ctx, { id: r.id, jobName: r.job_name, applicationId: r.application_id }, error);
  }
  return stale.length;
}

/** The worker beats every minute; this long without a beat means it isn't running. */
export const WORKER_OFFLINE_AFTER_SECONDS = 150;

/**
 * Without a worker nothing claims a queued run and nothing times out a running one, so the board would
 * spin forever. The web app calls this: once the worker has been silent past the limit, every queued or
 * running run older than the limit is failed (cards roll back) with a message saying why.
 */
export async function failRunsWithoutWorker(ctx: CoreContext, limitSeconds = WORKER_OFFLINE_AFTER_SECONDS): Promise<number> {
  const { rows } = await ctx.pool.query<{ id: string; job_name: string; application_id: string | null }>(
    `select r.id, r.job_name, r.application_id
       from agent_run r
      where r.status in ('queued', 'running')
        and r.created_at < now() - $1::int * interval '1 second'
        and not exists (
          select 1 from settings s where s.worker_last_seen_at > now() - $1::int * interval '1 second'
        )`,
    [limitSeconds],
  );
  for (const r of rows) {
    await failRun(ctx, { id: r.id, jobName: r.job_name, applicationId: r.application_id }, WORKER_OFFLINE_ERROR);
  }
  return rows.length;
}

export const WORKER_OFFLINE_ERROR = "The worker isn't running, so this never finished. Start it with pnpm dev and try again.";
export const STOPPED_ERROR = "Stopped by you.";

/**
 * The owner stops a Search or reply check. Only runs not tied to a card: a card's run is stopped by Dismiss.
 * The worker hears the notification and aborts the handler; a queued run is simply never claimed.
 */
export async function stopRun(ctx: CoreContext, runId: string): Promise<void> {
  const { rows } = await ctx.pool.query<{ application_id: string | null; status: string }>("select application_id, status from agent_run where id = $1", [runId]);
  const run = rows[0];
  if (!run) throw new TransitionError("not_found", "Run not found.");
  if (run.application_id) throw new TransitionError("illegal", "Runs on a card stop when you dismiss the card.");
  if (!(BUSY_RUN_STATUSES as readonly string[]).includes(run.status)) return; // already over
  await finishRun(ctx, runId, { status: "failed", error: STOPPED_ERROR });
}

// ─── Blockers ───────────────────────────────────────────────────────────────

/**
 * The agent can't answer a question: record it, pause the run with a checkpoint,
 * and flag the card. The application keeps its status (Blocked is a flag, not a column).
 */
export async function raiseBlocker(
  ctx: CoreContext,
  runId: string,
  b: { question: string; fieldContext: FieldContext; checkpoint?: Record<string, unknown> },
): Promise<{ blockerId: string }> {
  return withTx(ctx.pool, async (tx) => {
    const [run] = await tx.select().from(agentRun).where(eq(agentRun.id, runId)).for("update");
    if (!run?.applicationId) throw new Error("Blockers need a run attached to an application.");
    if (!(ACTIVE_RUN_STATUSES as readonly string[]).includes(run.status)) throw new Error("This run is no longer active.");
    const [row] = await tx
      .insert(blocker)
      .values({
        applicationId: run.applicationId,
        agentRunId: runId,
        question: b.question,
        questionKey: questionKey(b.question),
        fieldContext: b.fieldContext,
      })
      .returning({ id: blocker.id });
    await tx
      .update(agentRun)
      .set({ status: "paused", checkpoint: b.checkpoint ?? run.checkpoint })
      .where(eq(agentRun.id, runId));
    const [app] = await tx
      .update(application)
      .set({ hasOpenBlocker: true })
      .where(eq(application.id, run.applicationId))
      .returning();
    await tx.insert(applicationEvent).values({
      applicationId: run.applicationId,
      action: "blockerRaised",
      fromStatus: app!.status,
      toStatus: app!.status,
      actorType: "agent",
      agentRunId: runId,
      note: b.question,
    });
    await notify(tx, { type: "application", applicationId: app!.id, status: app!.status, hasOpenBlocker: true });
    await notify(tx, { type: "run", runId, applicationId: app!.id, status: "paused", jobName: run.jobName });
    return { blockerId: row!.id };
  });
}

/**
 * Owner answers a Blocker. The answer goes to the AnswerBank (reusable or for this job only).
 * When it was the last open Blocker, the Shipper is resumed in the same transaction.
 */
export async function answerBlocker(
  ctx: CoreContext,
  blockerId: string,
  answer: string,
  opts: { reuse: boolean },
): Promise<{ resumed: boolean; runId?: string }> {
  const text = answer.trim();
  if (!text) throw new TransitionError("guard", "The answer can't be empty.");
  return withTx(ctx.pool, async (tx, client) => {
    const [b] = await tx.select().from(blocker).where(eq(blocker.id, blockerId)).for("update");
    if (!b) throw new TransitionError("not_found", "Blocker not found.");
    if (b.answeredAt) throw new TransitionError("illegal", "This Blocker was already answered.");

    // A seeded question keeps its rules when it comes in through a Blocker.
    const [known] = await tx.select({ kind: answerBank.kind }).from(answerBank).where(eq(answerBank.questionKey, b.questionKey));
    const problem = checkAnswer(answerRule(b.questionKey, known?.kind ?? "text"), text);
    if (problem) throw new TransitionError("guard", problem);

    await tx.update(blocker).set({ answer: text, answeredAt: new Date() }).where(eq(blocker.id, blockerId));

    // Job-only answers get an application-scoped key so they never leak into other jobs.
    const key = opts.reuse ? b.questionKey : `${b.questionKey}@${b.applicationId}`;
    await tx
      .insert(answerBank)
      .values({
        questionKey: key,
        questionVariants: [b.question],
        answer: text,
        reusable: opts.reuse,
      })
      .onConflictDoUpdate({
        target: answerBank.questionKey,
        set: {
          answer: text,
          questionVariants: sql`(select array_agg(distinct v) from unnest(${answerBank.questionVariants} || array[${b.question}]::text[]) v)`,
        },
      });

    const stillOpen = await tx
      .select({ id: blocker.id })
      .from(blocker)
      .where(and(eq(blocker.applicationId, b.applicationId), isNull(blocker.answeredAt)))
      .limit(1);

    await tx
      .update(application)
      .set({ hasOpenBlocker: stillOpen.length > 0 })
      .where(eq(application.id, b.applicationId));

    if (stillOpen.length > 0) {
      const [app] = await tx.select().from(application).where(eq(application.id, b.applicationId));
      await notify(tx, { type: "application", applicationId: app!.id, status: app!.status, hasOpenBlocker: true });
      return { resumed: false };
    }

    // If resuming can't pass its guards (say an approved PDF changed), keep the answer and hand the
    // card back to Approved with the reason, instead of rolling back and losing what the owner typed.
    const [app] = await tx.select().from(application).where(eq(application.id, b.applicationId));
    const reason = await checkGuards(getRule("resume")!.guards, tx, app!, ctx);
    if (reason) {
      await tx
        .update(agentRun)
        .set({ status: "superseded", finishedAt: new Date() })
        .where(and(eq(agentRun.applicationId, b.applicationId), eq(agentRun.status, "paused")));
      await transitionInTx(ctx, tx, client, b.applicationId, "prefillFailed", { actor: "system", error: reason });
      return { resumed: false };
    }
    const res = await transitionInTx(ctx, tx, client, b.applicationId, "resume", { note: "All blockers answered" });
    return { resumed: true, runId: res.runId };
  });
}

/** Look up an AnswerBank entry for a question: job-specific answer first, then reusable. */
export async function lookupAnswer(
  ctx: CoreContext,
  applicationId: string,
  question: string,
): Promise<string | null> {
  const key = questionKey(question);
  const { rows } = await ctx.pool.query<{ answer: string }>(
    `select answer from answer_bank
      where (question_key = $1 or question_key = $2) and answer <> ''
      order by (question_key = $2) desc limit 1`,
    [key, `${key}@${applicationId}`],
  );
  return rows[0]?.answer ?? null;
}
