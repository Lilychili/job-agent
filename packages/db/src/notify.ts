import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/** Postgres channel the worker and web write to; the SSE endpoint LISTENs on it. */
export const APP_EVENTS_CHANNEL = "app_events";

export type AppEvent =
  | { type: "application"; applicationId: string; status: string; hasOpenBlocker: boolean }
  | { type: "run"; runId: string; applicationId: string | null; status: string; jobName: string }
  | { type: "jobs_added"; count: number }
  | { type: "heartbeat"; at: string };

/**
 * Queue a notification. Inside a transaction, Postgres delivers it only on COMMIT,
 * so the board never sees a change that was rolled back.
 */
export async function notify(db: NodePgDatabase<any>, event: AppEvent): Promise<void> {
  await db.execute(sql`select pg_notify(${APP_EVENTS_CHANNEL}, ${JSON.stringify(event)})`);
}
