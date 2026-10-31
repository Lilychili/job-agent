import { sql } from "drizzle-orm";
import { dataDirFromEnv, JOBS, type CoreContext } from "@jobagent/core";
import { createDb, createPool, databaseUrl, notify, settings } from "@jobagent/db";
import { makeEnqueue, startBoss } from "@jobagent/queue";
import { penCraft } from "./jobs/pen";
import { scoutSearch } from "./jobs/scout";
import { shipperCaptureEvidence, shipperPrefill } from "./jobs/shipper";
import { runner, type JobData } from "./runner";

const url = databaseUrl();
const pool = createPool(url);
const db = createDb(pool);
const boss = await startBoss(url, { worker: true });
const ctx: CoreContext = {
  pool,
  enqueue: makeEnqueue(boss),
  dataDir: dataDirFromEnv(),
};

await boss.work<JobData>(JOBS.scoutSearch, runner(ctx, JOBS.scoutSearch, scoutSearch));
await boss.work<JobData>(JOBS.penCraft, runner(ctx, JOBS.penCraft, penCraft));
await boss.work<JobData>(JOBS.shipperPrefill, runner(ctx, JOBS.shipperPrefill, shipperPrefill));
await boss.work<JobData>(JOBS.shipperResume, runner(ctx, JOBS.shipperResume, shipperPrefill));
await boss.work<JobData>(
  JOBS.shipperCaptureEvidence,
  runner(ctx, JOBS.shipperCaptureEvidence, shipperCaptureEvidence),
);

// Heartbeat: lets the board show whether the worker is alive.
async function beat() {
  const at = new Date();
  await db.execute(sql`insert into settings (id) select gen_random_uuid() where not exists (select 1 from settings)`);
  await db.update(settings).set({ workerLastSeenAt: at });
  await notify(db, { type: "heartbeat", at: at.toISOString() });
}
await boss.work(JOBS.heartbeat, async () => beat());
await boss.schedule(JOBS.heartbeat, "* * * * *");
await beat();

console.log(`Worker ready. DATA_DIR=${ctx.dataDir}`);

async function shutdown(signal: string) {
  console.log(`${signal} received, stopping worker…`);
  await boss.stop({ graceful: true, timeout: 15_000 });
  await pool.end();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
