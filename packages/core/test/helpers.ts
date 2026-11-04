import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  "rejected_posting",
  "discovered_company",
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

const MIGRATIONS = fileURLToPath(new URL("../../db/migrations", import.meta.url));
// Held while a template is built or copied, so files and parallel runs don't trip over each other.
const TEMPLATE_LOCK = 4_224_771;
const CLONE_PREFIX = "jobagent_t_";
// A copy this old was left by a run that crashed; one still in use refuses the drop.
const LEFTOVER_AFTER_MS = 2 * 60 * 60 * 1000;

function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

/** The migrations' fingerprint: a template is built once per set of migrations and reused after. */
async function migrationsHash(): Promise<string> {
  const hash = createHash("sha256");
  const files = (await readdir(MIGRATIONS, { recursive: true })).map(String).sort();
  for (const f of files) {
    if (!f.endsWith(".sql") && !f.endsWith(".json")) continue;
    hash.update(f).update(await readFile(path.join(MIGRATIONS, f)));
  }
  return hash.digest("hex").slice(0, 12);
}

/** Makes sure the migrated template exists, and copies it into a database of this file's own. */
async function cloneTestDatabase(baseUrl: string): Promise<{ name: string; drop: () => Promise<void> }> {
  const template = `jobagent_tpl_${await migrationsHash()}`;
  const name = `${CLONE_PREFIX}${Date.now()}_${randomUUID().slice(0, 8)}`;
  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  try {
    await admin.query("select pg_advisory_lock($1)", [TEMPLATE_LOCK]);
    const { rows } = await admin.query<{ ready: boolean }>("select datistemplate as ready from pg_database where datname = $1", [template]);
    if (!rows[0]?.ready) {
      // Missing, or half-built by a run that died while migrating it.
      await admin.query(`drop database if exists "${template}"`);
      await admin.query(`create database "${template}"`);
      await runMigrations(withDatabase(baseUrl, template));
      await admin.query(`alter database "${template}" with is_template true`);
    }
    // Only building the template needs the lock: a finished template has no connections, so copies can run at once.
    await admin.query("select pg_advisory_unlock($1)", [TEMPLATE_LOCK]);
    await admin.query(`create database "${name}" template "${template}"`);
    // A test that loses its last commits in a crash loses nothing that matters.
    await admin.query(`alter database "${name}" set synchronous_commit = off`);
    const { rows: copies } = await admin.query<{ datname: string }>("select datname from pg_database where datname like $1", [`${CLONE_PREFIX}%`]);
    for (const { datname } of copies) {
      const createdAt = Number(datname.slice(CLONE_PREFIX.length).split("_")[0]);
      if (Date.now() - createdAt > LEFTOVER_AFTER_MS) await admin.query(`drop database if exists "${datname}"`).catch(() => {});
    }
  } finally {
    await admin.query("select pg_advisory_unlock($1)", [TEMPLATE_LOCK]).catch(() => {});
    await admin.end();
  }
  const drop = async () => {
    const c = new pg.Client({ connectionString: baseUrl });
    await c.connect();
    try {
      await c.query(`drop database if exists "${name}" with (force)`);
    } finally {
      await c.end();
    }
  };
  return { name, drop };
}

/**
 * Every test file gets a database of its own, copied from a migrated template, so files run in
 * parallel and other checkouts' test runs on the same Postgres can't deadlock this one.
 * The database is dropped when the file ends `env.pool`.
 */
export async function setupTestEnv(): Promise<TestEnv> {
  const baseUrl = process.env.TEST_DATABASE_URL;
  if (!baseUrl) throw new Error("TEST_DATABASE_URL is not set");
  const clone = await cloneTestDatabase(baseUrl);
  const url = withDatabase(baseUrl, clone.name);
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  const endPool = pool.end.bind(pool);
  pool.end = (async () => {
    await endPool();
    await clone.drop();
  }) as typeof pool.end;
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

/**
 * Empties every table. Deleting the few rows a test made is ~50x faster than `truncate`, which
 * rewrites each table's files. Replica mode skips the foreign-key and audit triggers, so the order
 * doesn't matter (application and document point at each other).
 */
export async function resetDb(env: TestEnv): Promise<void> {
  await env.pool.query(
    `begin; set local session_replication_role = replica; ${TABLES.map((t) => `delete from ${t};`).join(" ")} commit;`,
  );
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
