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
import { TransitionError, type CoreContext } from "./context";
import { JOBS } from "./machine";
import { questionKey } from "./normalize";
import { transitionInTx } from "./transition";

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
      .where(and(eq(agentRun.id, runId), inArray(agentRun.status, ["queued", "running"])))
      .returning();
    if (run) {
      await notify(tx, { type: "run", runId, applicationId: run.applicationId, status: result.status, jobName: run.jobName });
    }
  });
}

/** Search isn't tied to a card, so it isn't a transition. One search at a time. */
export async function startSearch(ctx: CoreContext): Promise<{ runId: string }> {
  return withTx(ctx.pool, async (tx, client) => {
    // Serialize concurrent clicks on Search.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('scout.search'))`);
    const active = await tx
      .select({ id: agentRun.id })
      .from(agentRun)
      .where(and(eq(agentRun.role, "scout"), inArray(agentRun.status, ["queued", "running"])))
      .limit(1);
    if (active.length) throw new TransitionError("busy", "A search is already running.");
    const [run] = await tx
      .insert(agentRun)
      .values({ role: "scout", jobName: JOBS.scoutSearch, input: {} })
      .returning({ id: agentRun.id });
    await ctx.enqueue(client, { name: JOBS.scoutSearch, id: run!.id, data: { runId: run!.id, applicationId: null } });
    await notify(tx, { type: "run", runId: run!.id, applicationId: null, status: "queued", jobName: JOBS.scoutSearch });
    return { runId: run!.id };
  });
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

    await tx
      .update(blocker)
      .set({ answer: text, answeredAt: new Date(), savedToAnswerBank: true })
      .where(eq(blocker.id, blockerId));

    // Job-only answers get an application-scoped key so they never leak into other jobs.
    const key = opts.reuse ? b.questionKey : `${b.questionKey}@${b.applicationId}`;
    await tx
      .insert(answerBank)
      .values({
        questionKey: key,
        questionVariants: [b.question],
        answer: text,
        reusable: opts.reuse,
        applicationId: opts.reuse ? null : b.applicationId,
        sourceBlockerId: b.id,
      })
      .onConflictDoUpdate({
        target: answerBank.questionKey,
        set: {
          answer: text,
          sourceBlockerId: b.id,
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
      where question_key = $1 or question_key = $2
      order by (question_key = $2) desc limit 1`,
    [key, `${key}@${applicationId}`],
  );
  return rows[0]?.answer ?? null;
}
