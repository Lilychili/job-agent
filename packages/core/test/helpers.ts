import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import {
  agentRun,
  application,
  createDb,
  document,
  job,
  profile,
  type Db,
} from "@jobagent/db";
import { runMigrations } from "@jobagent/db/migrate";
import type { CoreContext, EnqueueRequest } from "../src/context";
import type { Status } from "../src/machine";

const TABLES = [
  "application_event",
  "evidence",
  "blocker",
  "document",
  "agent_run",
  "application",
  "job",
  "answer_bank",
  "profile",
  "preferences",
  "settings",
];

export interface TestEnv {
  ctx: CoreContext;
  db: Db;
  pool: pg.Pool;
  enqueued: EnqueueRequest[];
  /** Make the next enqueue throw (to test rollback). */
  failNextEnqueue: () => void;
  url: string;
}

export async function setupTestEnv(): Promise<TestEnv> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  await runMigrations(url);
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  const enqueued: EnqueueRequest[] = [];
  let failNext = false;
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "jobagent-test-"));
  const ctx: CoreContext = {
    pool,
    dataDir,
    enqueue: async (client, req) => {
      if (failNext) {
        failNext = false;
        throw new Error("queue unavailable");
      }
      // Prove the job is written inside the caller's transaction.
      const { rows } = await client.query("select txid_current_if_assigned() as tx");
      if (rows[0].tx === null) throw new Error("enqueue called outside a write transaction");
      enqueued.push(req);
    },
  };
  return { ctx, db: createDb(pool), pool, enqueued, failNextEnqueue: () => (failNext = true), url };
}

export async function resetDb(env: TestEnv): Promise<void> {
  await env.pool.query(`truncate ${TABLES.join(", ")} cascade`);
  env.enqueued.length = 0;
}

export async function seedProfile(env: TestEnv, confirmed = true): Promise<void> {
  await env.db.insert(profile).values({
    confirmed,
    contact: { name: "Test Owner", email: "t@example.com" },
    facts: [{ id: "f1", kind: "skill", text: "TypeScript" }],
  });
}

/** Insert a job + application directly in `status` (bypassing transitions, for setup only). */
export async function makeApp(env: TestEnv, status: Status = "found"): Promise<{ appId: string; jobId: string }> {
  const n = randomUUID().slice(0, 8);
  const [j] = await env.db
    .insert(job)
    .values({
      ats: "greenhouse",
      sourceUrl: `https://boards.greenhouse.io/acme/jobs/${n}`,
      canonicalUrl: `https://boards.greenhouse.io/acme/jobs/${n}`,
      company: "Acme",
      companyNorm: "acme",
      title: `Engineer ${n}`,
      titleNorm: `engineer ${n}`,
    })
    .returning();
  const [a] = await env.db.insert(application).values({ jobId: j!.id, status }).returning();
  return { appId: a!.id, jobId: j!.id };
}

/** Write a document file under DATA_DIR and its row; returns the row id. */
export async function makeDocument(
  env: TestEnv,
  appId: string,
  kind: "cv" | "cover_letter",
  version = 1,
  content = `%PDF-1.4 ${kind} v${version}`,
): Promise<string> {
  const rel = path.join("documents", appId, `${kind}-v${version}.pdf`);
  const full = path.join(env.ctx.dataDir, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content);
  const [d] = await env.db
    .insert(document)
    .values({
      applicationId: appId,
      kind,
      version,
      htmlSource: "<p>test</p>",
      pdfPath: rel,
      sha256: createHash("sha256").update(content).digest("hex"),
      factIds: ["f1"],
      profileVersion: 1,
    })
    .returning();
  return d!.id;
}

export async function makeRun(
  env: TestEnv,
  appId: string,
  status: "queued" | "running" | "paused" = "running",
  role: "pen" | "shipper" = "pen",
): Promise<string> {
  const [r] = await env.db
    .insert(agentRun)
    .values({ role, jobName: role === "pen" ? "pen.craft" : "shipper.prefill", applicationId: appId, status })
    .returning();
  return r!.id;
}
