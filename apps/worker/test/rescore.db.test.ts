// Scoring the open cards again after the Profile changed, against a real Postgres (TEST_DATABASE_URL).
// Claude is replaced by a stub that scores every posting 77 and cites the Profile's skill.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appendLog } from "@jobagent/core";
import { agentRun, job, preferences, profile } from "@jobagent/db";
import { makeApp, makeRun, resetDb, seedProfile, setupTestEnv, type TestEnv } from "../../../packages/core/test/helpers";
import { scoutRescore } from "../src/jobs/rescore";

const scored = vi.hoisted(() => ({ calls: [] as { postings: { sourceUrl: string }[]; facts: { id: string }[] }[] }));
vi.mock("../src/claude", () => ({
  claudeFromSettings: async () => ({ auth: { kind: "cli" }, model: "test-model" }),
  saveUsage: async () => {},
}));
vi.mock("@jobagent/agents", async (importOriginal) => {
  const real = await importOriginal<typeof import("@jobagent/agents")>();
  return {
    ...real,
    scorePostings: async (opts: { postings: { sourceUrl: string }[]; facts: { id: string }[] }) => {
      scored.calls.push(opts);
      return {
        jobs: opts.postings.map((p) => ({ ...p, matchScore: 77, matchReasons: { met: ["TypeScript"], missed: [] }, requirements: [{ text: "TypeScript", factIds: ["f1"], closest: [] }] })),
        usage: real.NO_USAGE,
        listCostUsd: 0,
        promptVersion: "test",
      };
    },
  };
});

let env: TestEnv;
beforeAll(async () => {
  env = await setupTestEnv();
});
afterAll(async () => {
  await env.pool.end();
});
beforeEach(async () => {
  await resetDb(env);
  scored.calls.length = 0;
  await seedProfile(env);
  await env.db.insert(preferences).values({ roles: ["Engineer"] });
});

async function run() {
  const [p] = await env.db.select({ version: profile.version }).from(profile);
  const { appId } = await makeApp(env, "found");
  const runId = await makeRun(env, appId, "running");
  const [r] = await env.db.select().from(agentRun).where(eq(agentRun.id, runId));
  return { version: p!.version, helpers: { ctx: env.ctx, run: { ...r!, applicationId: null }, log: (m: string) => appendLog(env.ctx, runId, m), signal: new AbortController().signal } };
}

describe("scout.rescore", () => {
  it("scores open cards matched against an older Profile again, and leaves current and closed ones alone", async () => {
    const { version, helpers } = await run();
    const { jobId: current } = await makeApp(env, "shortlisted");
    await env.db.update(job).set({ requirementsProfileVersion: version }).where(eq(job.id, current));
    const { jobId: closed } = await makeApp(env, "applied");
    const { jobId: stale } = await makeApp(env, "crafted");
    await env.db.update(job).set({ requirementsProfileVersion: version - 1, matchScore: 60 }).where(eq(job.id, stale));

    await expect(scoutRescore(helpers)).resolves.toMatchObject({ kind: "succeeded", output: { rescored: 2 } });
    // The run's own "found" card had no version yet, so it was stale too.
    expect(scored.calls).toHaveLength(1);
    expect(scored.calls[0]!.facts.map((f) => f.id)).toEqual(["f1"]);
    const rows = await env.db.select().from(job);
    const byId = new Map(rows.map((j) => [j.id, j]));
    expect(byId.get(stale)).toMatchObject({ matchScore: 77, requirementsProfileVersion: version, requirements: [{ text: "TypeScript", factIds: ["f1"], closest: [] }] });
    expect(byId.get(current)!.requirementsProfileVersion).toBe(version);
    expect(byId.get(current)!.matchScore).toBeNull();
    expect(byId.get(closed)!.requirementsProfileVersion).toBeNull();
  });

  it("does nothing when every card is current", async () => {
    const { version, helpers } = await run();
    await env.db.update(job).set({ requirementsProfileVersion: version });
    await expect(scoutRescore(helpers)).resolves.toMatchObject({ output: { rescored: 0 } });
    expect(scored.calls).toHaveLength(0);
  });
});
