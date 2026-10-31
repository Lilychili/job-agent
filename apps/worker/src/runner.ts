import { appendLog, claimRun, finishRun, transition, type CoreContext, type Run } from "@jobagent/core";
import { QUEUES } from "@jobagent/queue";
import type { JobName } from "@jobagent/core";

export interface JobData {
  runId: string;
  applicationId: string | null;
}

export interface RunHelpers {
  run: Run;
  ctx: CoreContext;
  log: (message: string) => Promise<void>;
  signal: AbortSignal;
}

/** What a handler reports. "paused" means it raised a Blocker and the run waits for the owner. */
export type Outcome =
  | { kind: "succeeded"; output?: Record<string, unknown> }
  | { kind: "paused" };

/** How a failed or timed-out run rolls back the card, per queue. */
const FAILURE_ACTION: Partial<Record<JobName, string>> = {
  "pen.craft": "craftFailed",
  "shipper.prefill": "prefillFailed",
  "shipper.resume": "prefillFailed",
};

/**
 * Wraps every handler: claim the run (skip duplicates), enforce the timeout,
 * and turn exceptions into a failed run plus the matching rollback transition.
 */
export function runner(
  ctx: CoreContext,
  name: JobName,
  handler: (h: RunHelpers) => Promise<Outcome>,
) {
  const timeoutMs = (QUEUES[name].expireInSeconds - 5) * 1000;

  return async (jobs: { data: JobData }[]) => {
    for (const { data } of jobs) {
      const run = await claimRun(ctx, data.runId);
      if (!run) {
        console.log(`[${name}] run ${data.runId} is not queued; skipping duplicate delivery`);
        continue;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs / 1000}s`)), timeoutMs);
      const log = (m: string) => appendLog(ctx, run.id, m);
      try {
        await log(`Started ${name}`);
        const outcome = await Promise.race([
          handler({ run, ctx, log, signal: controller.signal }),
          new Promise<never>((_, reject) =>
            controller.signal.addEventListener("abort", () => reject(controller.signal.reason)),
          ),
        ]);
        if (outcome.kind === "succeeded") {
          // No-op when the handler's own transition already closed the run.
          await finishRun(ctx, run.id, { status: "succeeded", output: outcome.output });
        }
        console.log(`[${name}] run ${run.id} ${outcome.kind}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[${name}] run ${run.id} failed:`, message);
        await appendLog(ctx, run.id, message, "error").catch(() => {});
        await fail(ctx, name, run, message);
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

async function fail(ctx: CoreContext, name: JobName, run: Run, error: string) {
  const action = FAILURE_ACTION[name];
  if (action && run.applicationId) {
    try {
      await transition(ctx, run.applicationId, action, { actor: "system", runId: run.id, error });
      return;
    } catch (e) {
      console.error(`[${name}] rollback transition failed:`, e);
    }
  }
  await finishRun(ctx, run.id, { status: "failed", error });
}

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(signal.reason);
    });
  });
