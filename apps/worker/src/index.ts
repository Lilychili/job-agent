import { sql } from "drizzle-orm";
import { dataDirFromEnv, ensureAnswerDefaults, failStaleRuns, JOBS, type CoreContext } from "@jobagent/core";
import { APP_EVENTS_CHANNEL, createDb, createPool, databaseUrl, notify, settings, type AppEvent } from "@jobagent/db";
import { closeAllWindows } from "@jobagent/forms";
import { makeEnqueue, QUEUES, startBoss } from "@jobagent/queue";
import { extractorExtract } from "./jobs/extractor";
import { penCraft } from "./jobs/pen";
import { rescoreIfStale, scoutRescore } from "./jobs/rescore";
import { scoutSearch } from "./jobs/scout";
import { shipperLocate } from "./jobs/locate";
import { shipperCaptureEvidence, shipperPrefill, showForm } from "./jobs/shipper";
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

await ensureAnswerDefaults(pool);

// Runs a previous worker left behind: it died, so nothing can really be running yet.
const RUN_LIMITS = Object.fromEntries(Object.entries(QUEUES).map(([name, q]) => [name, q.expireInSeconds + 60]));
const recovered = await failStaleRuns(ctx, RUN_LIMITS, { assumeNoneRunning: true });
if (recovered) console.log(`Closed ${recovered} run(s) left over from a previous worker.`);

await boss.work<JobData>(JOBS.extractorExtract,runner(ctx, JOBS.extractorExtract, extractorExtract));
await boss.work<JobData>(JOBS.scoutSearch,runner(ctx, JOBS.scoutSearch, scoutSearch));
await boss.work<JobData>(JOBS.scoutRescore, runner(ctx, JOBS.scoutRescore, scoutRescore));
await boss.work<JobData>(JOBS.penCraft, runner(ctx, JOBS.penCraft, penCraft));
await boss.work<JobData>(JOBS.shipperLocate, runner(ctx, JOBS.shipperLocate, shipperLocate));
await boss.work<JobData>(JOBS.shipperPrefill, runner(ctx, JOBS.shipperPrefill, shipperPrefill));
await boss.work<JobData>(JOBS.shipperResume, runner(ctx, JOBS.shipperResume, shipperPrefill));
await boss.work<JobData>(
  JOBS.shipperCaptureEvidence,
  runner(ctx, JOBS.shipperCaptureEvidence, shipperCaptureEvidence),
);

// A new worker has no form tabs open, whatever the last one left in the database.
await pool.query("update application set form_window_open = false where form_window_open");

// The board's Show form button: bring that application's tab to the front.
const listener = await pool.connect();
listener.on("notification", (msg) => {
  try {
    const event = JSON.parse(msg.payload ?? "") as AppEvent;
    if (event.type === "show_form") void showForm(event.applicationId).catch((err) => console.error("[show form]", err));
  } catch {
    // Not ours to read.
  }
});
await listener.query(`listen ${APP_EVENTS_CHANNEL}`);

// Heartbeat: lets the board show whether the worker is alive.
async function beat() {
  const at = new Date();
  await db.execute(sql`insert into settings (id) values (gen_random_uuid()) on conflict do nothing`);
  await db.update(settings).set({ workerLastSeenAt: at });
  await notify(db, { type: "heartbeat", at: at.toISOString() });
  await failStaleRuns(ctx, RUN_LIMITS);
  await rescoreIfStale(ctx).catch((err) => console.error("[rescore backstop]", err));
}
await boss.work(JOBS.heartbeat, async () => beat());
await boss.schedule(JOBS.heartbeat, "* * * * *");
await beat();

console.log(`Worker ready. DATA_DIR=${ctx.dataDir}`);

async function shutdown(signal: string) {
  console.log(`${signal} received, stopping worker…`);
  await boss.stop({ graceful: true, timeout: 15_000 });
  await closeAllWindows();
  listener.release();
  await pool.end();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
