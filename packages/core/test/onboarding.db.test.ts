// Integration tests for the M1 onboarding pieces against a real Postgres (TEST_DATABASE_URL).
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agentRun, answerBank, application, blocker, job, profile, settings } from "@jobagent/db";
import { DEFAULT_QUESTIONS, ensureAnswerDefaults } from "../src/answers";
import { questionKey } from "../src/normalize";
import { deleteAll, exportAll } from "../src/data";
import { answerBlocker, failStaleRuns, lookupAnswer, raiseBlocker, startExtraction, startSearch } from "../src/runs";
import { transition } from "../src/transition";
import { writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { makeApp, makeDocument, resetDb, seedProfile, setupTestEnv, type TestEnv } from "./helpers";

let env: TestEnv;
beforeAll(async () => {
  env = await setupTestEnv();
});
afterAll(async () => {
  await env.pool.end();
});
beforeEach(async () => {
  await resetDb(env);
});

describe("AnswerBank defaults", () => {
  it("seeds every question once, unanswered", async () => {
    expect(await ensureAnswerDefaults(env.pool)).toBe(DEFAULT_QUESTIONS.length);
    expect(await ensureAnswerDefaults(env.pool)).toBe(0);
    const rows = await env.db.select().from(answerBank);
    expect(rows).toHaveLength(DEFAULT_QUESTIONS.length);
    expect(rows.every((r) => r.answer === "")).toBe(true);
  });

  it("never overwrites an answer the owner wrote", async () => {
    await ensureAnswerDefaults(env.pool);
    const key = questionKey("What is your notice period?");
    await env.db.update(answerBank).set({ answer: "One month" }).where(eq(answerBank.questionKey, key));
    await ensureAnswerDefaults(env.pool);
    const [row] = await env.db.select().from(answerBank).where(eq(answerBank.questionKey, key));
    expect(row!.answer).toBe("One month");
  });

  it("an unanswered default is not an answer: lookups ignore it", async () => {
    await ensureAnswerDefaults(env.pool);
    const { appId } = await makeApp(env, "applying");
    expect(await lookupAnswer(env.ctx, appId, "What is your notice period?")).toBeNull();
  });

  it("answering a Blocker fills the seeded row instead of duplicating it", async () => {
    await ensureAnswerDefaults(env.pool);
    const { appId } = await makeApp(env, "crafted");
    await makeDocument(env, appId, "cv");
    await transition(env.ctx, appId, "approve");
    const { runId } = await transition(env.ctx, appId, "apply");
    await env.db.update(agentRun).set({ status: "running" }).where(eq(agentRun.id, runId!));
    const { blockerId } = await raiseBlocker(env.ctx, runId!, {
      question: "What is your notice period?",
      fieldContext: { label: "Notice period", type: "text" },
    });
    await answerBlocker(env.ctx, blockerId, "Two weeks", { reuse: true });
    const rows = await env.db.select().from(answerBank);
    expect(rows).toHaveLength(DEFAULT_QUESTIONS.length);
    expect(await lookupAnswer(env.ctx, appId, "What is your notice period?")).toBe("Two weeks");
  });
});

describe("startExtraction", () => {
  it("queues an extractor run with the uploaded file and allows only one at a time", async () => {
    const { runId } = await startExtraction(env.ctx, { path: "cv/abc.pdf", name: "My CV.pdf" });
    expect(env.enqueued).toEqual([{ name: "extractor.extract", id: runId, data: { runId, applicationId: null } }]);
    const [run] = await env.db.select().from(agentRun).where(eq(agentRun.id, runId));
    expect(run).toMatchObject({ role: "extractor", status: "queued", input: { file: "cv/abc.pdf", fileName: "My CV.pdf" } });
    await expect(startExtraction(env.ctx, { path: "cv/b.pdf", name: "b.pdf" })).rejects.toMatchObject({ code: "busy" });
  });
});

describe("every seeded phrasing reaches its own answer", () => {
  for (const q of DEFAULT_QUESTIONS) {
    it(q.question, () => {
      for (const v of q.variants) expect(questionKey(v)).toBe(questionKey(q.question));
    });
  }

  it("no two seeded questions share a key", () => {
    expect(new Set(DEFAULT_QUESTIONS.map((q) => questionKey(q.question))).size).toBe(DEFAULT_QUESTIONS.length);
  });
});

async function applyingApp() {
  const { appId, jobId } = await makeApp(env, "crafted");
  await makeDocument(env, appId, "cv");
  await transition(env.ctx, appId, "approve");
  const { runId } = await transition(env.ctx, appId, "apply");
  await env.db.update(agentRun).set({ status: "running" }).where(eq(agentRun.id, runId!));
  return { appId, jobId, runId: runId! };
}
const statusOf = async (appId: string) => (await env.db.select().from(application).where(eq(application.id, appId)))[0]!;
const runOf = async (id: string) => (await env.db.select().from(agentRun).where(eq(agentRun.id, id)))[0]!;

describe("failStaleRuns", () => {
  it("rolls a card back when its worker died, so it isn't stuck forever", async () => {
    const { appId, runId } = await applyingApp();
    expect(await failStaleRuns(env.ctx, {}, { assumeNoneRunning: true })).toBe(1);
    expect(await statusOf(appId)).toMatchObject({ status: "approved", lastError: expect.stringContaining("worker stopped") });
    expect((await runOf(runId)).status).toBe("failed");
  });

  it("frees a stuck Search", async () => {
    const { runId } = await startSearch(env.ctx);
    await env.db.update(agentRun).set({ status: "running", startedAt: new Date() }).where(eq(agentRun.id, runId));
    await failStaleRuns(env.ctx, {}, { assumeNoneRunning: true });
    await expect(startSearch(env.ctx)).resolves.toBeDefined();
  });

  it("leaves healthy runs alone: within the limit, paused, or simply waiting for a worker", async () => {
    const { runId } = await applyingApp();
    expect(await failStaleRuns(env.ctx, { "shipper.prefill": 600 })).toBe(0);
    await env.db.update(agentRun).set({ status: "queued", startedAt: null }).where(eq(agentRun.id, runId));
    expect(await failStaleRuns(env.ctx, {}, { assumeNoneRunning: true })).toBe(0);
  });

  it("fails a run once it passes its limit", async () => {
    const { runId } = await applyingApp();
    await env.db.update(agentRun).set({ startedAt: new Date(Date.now() - 3600_000) }).where(eq(agentRun.id, runId));
    expect(await failStaleRuns(env.ctx, { "shipper.prefill": 600 })).toBe(1);
  });
});

describe("no dead ends", () => {
  it("a blocked application can be dismissed", async () => {
    const { appId, runId } = await applyingApp();
    await raiseBlocker(env.ctx, runId, { question: "Anything?", fieldContext: { label: "x", type: "text" } });
    await transition(env.ctx, appId, "dismiss");
    expect(await statusOf(appId)).toMatchObject({ status: "archived", hasOpenBlocker: false });
    expect((await runOf(runId)).status).toBe("superseded");
  });

  it("a late result from a dismissed run is refused", async () => {
    const { appId, runId } = await applyingApp();
    await transition(env.ctx, appId, "dismiss");
    await expect(transition(env.ctx, appId, "prefillDone", { actor: "system", runId })).rejects.toMatchObject({ code: "illegal" });
  });

  it("if an approved PDF changed, answering a Blocker keeps the answer and hands the card back", async () => {
    const { appId, runId } = await applyingApp();
    const { blockerId } = await raiseBlocker(env.ctx, runId, {
      question: "What is your notice period?",
      fieldContext: { label: "Notice", type: "text" },
    });
    const [doc] = await env.pool.query("select pdf_path from document where application_id = $1", [appId]).then((r) => r.rows);
    await writeFile(path.join(env.ctx.dataDir, doc.pdf_path), "tampered");

    await expect(answerBlocker(env.ctx, blockerId, "Two weeks", { reuse: true })).resolves.toEqual({ resumed: false });
    expect(await statusOf(appId)).toMatchObject({ status: "approved", hasOpenBlocker: false, lastError: expect.stringContaining("hash mismatch") });
    expect(await lookupAnswer(env.ctx, appId, "What is your notice period?")).toBe("Two weeks");
    expect((await env.db.select().from(blocker).where(eq(blocker.id, blockerId)))[0]!.answer).toBe("Two weeks");

    // …and Regenerate is a way forward from there.
    await seedProfile(env);
    expect((await transition(env.ctx, appId, "regenerate")).to).toBe("crafting");
  });
});

describe("export and delete all", () => {
  it("exports everything except the API key", async () => {
    await seedProfile(env);
    await env.db.insert(settings).values({ encryptedApiKey: "v1:secret", apiKeyLast4: "1234" });
    await makeApp(env);
    const dump = await exportAll(env.db);
    expect(dump.profile?.contact.name).toBe("Test Owner");
    expect(dump.jobs).toHaveLength(1);
    expect(JSON.stringify(dump)).not.toContain("v1:secret");
  });

  it("erases rows, the key and files, including approved documents", async () => {
    await seedProfile(env);
    await env.db.insert(settings).values({ aiProvider: "cli", encryptedApiKey: "v1:secret", apiKeyLast4: "1234" });
    const { appId } = await makeApp(env, "crafted");
    await makeDocument(env, appId, "cv");
    await transition(env.ctx, appId, "approve");
    await mkdir(path.join(env.ctx.dataDir, "cv"), { recursive: true });
    await writeFile(path.join(env.ctx.dataDir, "cv", "x.pdf"), "cv");

    await deleteAll(env.ctx);

    expect(await env.db.select().from(profile)).toEqual([]);
    expect(await env.db.select().from(job)).toEqual([]);
    expect((await env.db.select().from(settings))[0]).toMatchObject({ encryptedApiKey: null, apiKeyLast4: null, aiProvider: "cli" });
    expect(await readdir(env.ctx.dataDir)).toEqual([]);
  });
});

describe("single-row tables", () => {
  it("refuses a second Profile", async () => {
    await seedProfile(env);
    await expect(seedProfile(env)).rejects.toThrow();
  });
});
