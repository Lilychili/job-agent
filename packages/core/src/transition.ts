import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type pg from "pg";
import {
  agentRun,
  application,
  applicationEvent,
  document,
  evidence,
  job,
  notify,
  withTx,
  type Db,
} from "@jobagent/db";
import { TransitionError, type CoreContext } from "./context";
import { checkGuards } from "./guards";
import { ACTIVE_RUN_STATUSES, columnFor, getRule, JOBS, type Action, type Status } from "./machine";

export interface TransitionOptions {
  /** Who is asking. Owner requests can't trigger system actions and vice versa. */
  actor?: "owner" | "system";
  /** Who the audit trail names, when an agent acts with the owner's rights (the reply check). Defaults to `actor`. */
  recordAs?: "agent";
  /** For system actions: the AgentRun that finished. It is closed as succeeded/failed. */
  runId?: string;
  /** For failure actions: shown on the card. */
  error?: string;
  note?: string;
}

export interface TransitionResult {
  applicationId: string;
  action: Action;
  from: Status;
  to: Status;
  /** Set when the transition queued an agent run. */
  runId?: string;
}

const RUN_OUTCOME: Partial<Record<Action, "succeeded" | "failed">> = {
  craftSucceeded: "succeeded",
  craftFailed: "failed",
  prefillDone: "succeeded",
  prefillFailed: "failed",
};

/**
 * The only way an Application changes status. Runs in one transaction:
 * lock row → check legality → guards → effects → queue job → update → audit event → NOTIFY.
 */
export async function transition(
  ctx: CoreContext,
  applicationId: string,
  action: string,
  opts: TransitionOptions = {},
): Promise<TransitionResult> {
  return withTx(ctx.pool, (tx, client) =>
    transitionInTx(ctx, tx, client, applicationId, action, opts),
  );
}

export async function transitionInTx(
  ctx: CoreContext,
  tx: Db,
  client: pg.PoolClient,
  applicationId: string,
  action: string,
  opts: TransitionOptions = {},
): Promise<TransitionResult> {
  const rule = getRule(action);
  if (!rule) throw new TransitionError("illegal", `Unknown action "${action}".`);
  const actor = opts.actor ?? "owner";
  if (rule.actor !== actor) {
    throw new TransitionError("illegal", `"${action}" can only be performed by the ${rule.actor}.`);
  }

  // Lock the row so two clicks (or a click and a worker) can't race.
  const [app] = await tx
    .select()
    .from(application)
    .where(eq(application.id, applicationId))
    .for("update");
  if (!app) throw new TransitionError("not_found", "Application not found.");

  const from = app.status as Status;
  if (!rule.from.includes(from)) {
    throw new TransitionError("illegal", `Can't "${rule.label}" a card that is ${from}.`);
  }

  // A run that was cancelled or timed out may still be finishing in the worker. Its result doesn't count.
  if (actor === "system" && opts.runId) {
    const [run] = await tx.select({ status: agentRun.status, applicationId: agentRun.applicationId }).from(agentRun).where(eq(agentRun.id, opts.runId));
    if (run?.applicationId !== app.id || (run.status !== "queued" && run.status !== "running")) {
      throw new TransitionError("illegal", "This run is no longer active.");
    }
  }

  const reason = await checkGuards(rule.guards, tx, app, ctx);
  if (reason) throw new TransitionError("guard", reason);

  const to: Status = rule.to === "previous" ? await previousStatus(tx, app.id, from) : rule.to;
  const patch: Partial<typeof application.$inferInsert> = { status: to };

  // ── Effects ──────────────────────────────────────────────────────────────
  for (const effect of rule.effects ?? []) {
    switch (effect) {
      case "archiveJob":
        await tx.update(job).set({ archived: true }).where(eq(job.id, app.jobId));
        break;
      case "cancelRuns":
        // Abandoning a card closes whatever is working on it; a late result from the worker is then refused.
        await tx
          .update(agentRun)
          .set({ status: "superseded", finishedAt: new Date() })
          .where(and(eq(agentRun.applicationId, app.id), inArray(agentRun.status, ACTIVE_RUN_STATUSES)));
        patch.hasOpenBlocker = false;
        break;
      case "supersedeLocate":
        // Looking for the form is never worth blocking the owner's next click.
        await tx
          .update(agentRun)
          .set({ status: "superseded", finishedAt: new Date() })
          .where(and(eq(agentRun.applicationId, app.id), eq(agentRun.jobName, JOBS.shipperLocate), inArray(agentRun.status, ACTIVE_RUN_STATUSES)));
        break;
      case "lockDocuments": {
        const locked = await lockLatestDocuments(tx, app.id);
        patch.approvedCvDocId = locked.cv;
        patch.approvedLetterDocId = locked.coverLetter;
        break;
      }
      case "unlockDocuments":
        patch.approvedCvDocId = null;
        patch.approvedLetterDocId = null;
        break;
      case "recordSubmission":
        // Written synchronously with the click: this row is what blocks any second submission.
        await tx.insert(evidence).values({
          applicationId: app.id,
          type: "submission",
          text: opts.note ?? "Owner submitted the form and marked the application as applied.",
        });
        break;
      case "setError":
        patch.lastError = opts.error ?? "The agent run failed.";
        break;
      case "clearError":
        patch.lastError = null;
        break;
    }
  }

  // An error belongs to the column it happened in: once the card moves on, it no longer applies.
  if (app.lastError && patch.lastError === undefined && (await changesColumn(tx, app.id, from, to))) {
    patch.lastError = null;
  }

  // ── Close the run that reported this outcome ─────────────────────────────
  const outcome = RUN_OUTCOME[action as Action];
  if (outcome && opts.runId) {
    await tx
      .update(agentRun)
      .set({ status: outcome, finishedAt: new Date(), error: opts.error ?? null })
      .where(eq(agentRun.id, opts.runId));
  }

  // ── Queue the agent run ──────────────────────────────────────────────────
  let runId: string | undefined;
  if (rule.queue) {
    if (action === "resume") {
      // The paused run hands over to a fresh one that refills the form from scratch.
      await tx
        .update(agentRun)
        .set({ status: "superseded", finishedAt: new Date() })
        .where(and(eq(agentRun.applicationId, app.id), eq(agentRun.status, "paused")));
    }
    const parent =
      action === "resume"
        ? await tx
            .select({ id: agentRun.id })
            .from(agentRun)
            .where(and(eq(agentRun.applicationId, app.id), eq(agentRun.status, "superseded")))
            .orderBy(desc(agentRun.createdAt))
            .limit(1)
        : [];
    try {
      const [run] = await tx
        .insert(agentRun)
        .values({
          role: rule.queue.role,
          jobName: rule.queue.name,
          applicationId: app.id,
          parentRunId: parent[0]?.id,
          input: { applicationId: app.id, action },
        })
        .returning({ id: agentRun.id });
      runId = run!.id;
    } catch (err) {
      if (isUniqueViolation(err, "agent_run_one_active_per_application_uq")) {
        throw new TransitionError("busy", "An agent is already working on this application.");
      }
      throw err;
    }
    await ctx.enqueue(client, {
      name: rule.queue.name,
      id: runId,
      data: { runId, applicationId: app.id },
    });
  }

  const [updated] = await tx
    .update(application)
    .set(patch)
    .where(eq(application.id, app.id))
    .returning({ hasOpenBlocker: application.hasOpenBlocker });

  await tx.insert(applicationEvent).values({
    applicationId: app.id,
    action,
    fromStatus: from,
    toStatus: to,
    actorType: opts.recordAs ?? actor,
    agentRunId: opts.runId ?? runId,
    note: opts.error ?? opts.note,
  });

  await notify(tx, {
    type: "application",
    applicationId: app.id,
    status: to,
    hasOpenBlocker: updated!.hasOpenBlocker,
  });

  return { applicationId: app.id, action: action as Action, from, to, runId };
}

/** The status a card was in before it entered `current` (used to roll back failed runs). */
async function previousStatus(tx: Db, applicationId: string, current: Status): Promise<Status> {
  const [ev] = await tx
    .select({ from: applicationEvent.fromStatus })
    .from(applicationEvent)
    .where(and(eq(applicationEvent.applicationId, applicationId), eq(applicationEvent.toStatus, current)))
    .orderBy(desc(applicationEvent.at))
    .limit(1);
  return (ev?.from as Status | null) ?? "shortlisted";
}

/** Whether moving from `from` to `to` puts the card in a different board column (or off the board). */
async function changesColumn(tx: Db, applicationId: string, from: Status, to: Status): Promise<boolean> {
  const inCraftLoop = (s: Status) => s === "crafting" || s === "drafted";
  const craftedFrom = inCraftLoop(from) || inCraftLoop(to) ? await statusBeforeCrafting(tx, applicationId) : null;
  // Entering crafting from outside the draft loop: the card stays in the column it came from.
  const toPrev = to === "crafting" && !inCraftLoop(from) ? from : craftedFrom;
  return columnFor(from, craftedFrom) !== columnFor(to, toPrev);
}

/** The status the card was in when it last entered crafting from outside the draft loop (as the board computes it). */
async function statusBeforeCrafting(tx: Db, applicationId: string): Promise<Status | null> {
  const [ev] = await tx
    .select({ from: applicationEvent.fromStatus })
    .from(applicationEvent)
    .where(and(eq(applicationEvent.applicationId, applicationId), eq(applicationEvent.toStatus, "crafting"), ne(applicationEvent.fromStatus, "drafted")))
    .orderBy(desc(applicationEvent.at))
    .limit(1);
  return (ev?.from as Status | null) ?? null;
}

/** Approve the newest version of each document kind. Approved rows are immutable (DB trigger). */
async function lockLatestDocuments(
  tx: Db,
  applicationId: string,
): Promise<{ cv: string | null; coverLetter: string | null }> {
  const docs = await tx
    .select({ id: document.id, kind: document.kind, version: document.version, approvedAt: document.approvedAt })
    .from(document)
    .where(eq(document.applicationId, applicationId))
    .orderBy(desc(document.version));
  const latest = { cv: docs.find((d) => d.kind === "cv"), coverLetter: docs.find((d) => d.kind === "cover_letter") };
  const toLock = [latest.cv, latest.coverLetter].filter((d) => d && !d.approvedAt).map((d) => d!.id);
  if (toLock.length) {
    await tx.update(document).set({ approvedAt: new Date() }).where(inArray(document.id, toLock));
  }
  return { cv: latest.cv?.id ?? null, coverLetter: latest.coverLetter?.id ?? null };
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  for (let e = err as { code?: string; constraint?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (e.code === "23505" && (!constraint || e.constraint === constraint)) return true;
  }
  return false;
}
