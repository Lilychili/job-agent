// pg-boss setup shared by web (sending) and worker (sending + consuming).
import { PgBoss } from "pg-boss";
import type pg from "pg";
import { JOBS, type Enqueue, type JobName } from "@jobagent/core";

export { PgBoss };

/** Per-queue settings. Timeouts come from docs/ARCHITECTURE.md (Scout 5, Pen 3, Shipper 10 min). */
export const QUEUES: Record<JobName, { expireInSeconds: number; retryLimit: number }> = {
  [JOBS.extractorExtract]: { expireInSeconds: 2 * 60, retryLimit: 0 },
  [JOBS.scoutSearch]: { expireInSeconds: 5 * 60, retryLimit: 0 },
  [JOBS.penCraft]: { expireInSeconds: 3 * 60, retryLimit: 0 },
  [JOBS.shipperPrefill]: { expireInSeconds: 10 * 60, retryLimit: 0 },
  [JOBS.shipperResume]: { expireInSeconds: 10 * 60, retryLimit: 0 },
  [JOBS.shipperCaptureEvidence]: { expireInSeconds: 2 * 60, retryLimit: 2 },
  [JOBS.heartbeat]: { expireInSeconds: 30, retryLimit: 0 },
};

/**
 * Start pg-boss and make sure every queue exists.
 * The worker passes `worker: true`: it runs cron schedules and listens for new-job NOTIFYs,
 * so a click on the board starts the agent immediately instead of on the next poll.
 */
export async function startBoss(connectionString: string, opts: { worker?: boolean } = {}): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString,
    schedule: opts.worker ?? false,
    supervise: opts.worker ?? false,
    useListenNotify: opts.worker ?? false,
    max: opts.worker ? 5 : 2,
  });
  boss.on("error", (err) => console.error("[pg-boss]", err));
  await boss.start();
  const existing = new Set((await boss.getQueues()).map((q) => q.name));
  for (const [name, options] of Object.entries(QUEUES)) {
    if (!existing.has(name)) await boss.createQueue(name, { ...options, notify: true });
  }
  return boss;
}

/**
 * An `Enqueue` for @jobagent/core that writes the job through the caller's transaction
 * client. The AgentRun id is the job id, so a duplicate send is a no-op.
 */
export function makeEnqueue(boss: PgBoss): Enqueue {
  return async (client: pg.PoolClient, req) => {
    await boss.send(req.name, req.data, {
      id: req.id,
      db: { executeSql: (text: string, values?: unknown[]) => client.query(text, values as any[]) },
    });
  };
}
