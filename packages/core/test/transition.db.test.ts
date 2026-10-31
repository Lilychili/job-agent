// Integration tests against a real Postgres (TEST_DATABASE_URL).
import { writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  agentRun,
  answerBank,
  application,
  applicationEvent,
  blocker,
  document,
  evidence,
  job,
} from "@jobagent/db";
import { TransitionError } from "../src/context";
import { answerBlocker, lookupAnswer, raiseBlocker, startSearch } from "../src/runs";
import { transition } from "../src/transition";
import { makeApp, makeDocument, makeRun, resetDb, seedProfile, setupTestEnv, type TestEnv } from "./helpers";

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

async function status(appId: string) {
  const [a] = await env.db.select().from(application).where(eq(application.id, appId));
  return a!;
}
async function events(appId: string) {
  return env.db.select().from(applicationEvent).where(eq(applicationEvent.applicationId, appId));
}
async function expectError(p: Promise<unknown>, code: TransitionError["code"], match?: RegExp) {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err, "expected the transition to be rejected").toBeInstanceOf(TransitionError);
  expect(err.code).toBe(code);
  if (match) expect(err.message).toMatch(match);
}

describe("transition()", () => {
  it("moves a card and writes an audit event", async () => {
    const { appId } = await makeApp(env, "found");
    const res = await transition(env.ctx, appId, "shortlist");
    expect(res).toMatchObject({ from: "found", to: "shortlisted" });
    expect((await status(appId)).status).toBe("shortlisted");
    const ev = await events(appId);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ action: "shortlist", fromStatus: "found", toStatus: "shortlisted", actorType: "owner" });
  });

  it("rejects illegal moves without side effects", async () => {
    const { appId } = await makeApp(env, "found");
    await expectError(transition(env.ctx, appId, "approve"), "illegal");
    await expectError(transition(env.ctx, appId, "teleport"), "illegal");
    expect((await status(appId)).status).toBe("found");
    expect(await events(appId)).toHaveLength(0);
  });

  it("keeps owner and system actions apart", async () => {
    const { appId } = await makeApp(env, "crafting");
    await expectError(transition(env.ctx, appId, "craftSucceeded"), "illegal", /system/);
    const found = await makeApp(env, "found");
    await expectError(transition(env.ctx, found.appId, "shortlist", { actor: "system" }), "illegal", /owner/);
  });

  it("404s on unknown applications", async () => {
    await expectError(transition(env.ctx, "00000000-0000-0000-0000-000000000000", "shortlist"), "not_found");
  });

  it("dismiss archives the job; the same posting can't come back", async () => {
    const { appId, jobId } = await makeApp(env, "found");
    await transition(env.ctx, appId, "dismiss");
    const [j] = await env.db.select().from(job).where(eq(job.id, jobId));
    expect(j!.archived).toBe(true);
    const again = await env.db
      .insert(job)
      .values({ ...j!, id: undefined, archived: false, createdAt: undefined, updatedAt: undefined })
      .onConflictDoNothing()
      .returning();
    expect(again).toHaveLength(0);
  });
});

describe("craft", () => {
  it("requires a confirmed Profile", async () => {
    await seedProfile(env, false);
    const { appId } = await makeApp(env, "shortlisted");
    await expectError(transition(env.ctx, appId, "craft"), "guard", /Profile/);
    expect(env.enqueued).toHaveLength(0);
  });

  it("creates a queued AgentRun and enqueues it in the same transaction", async () => {
    await seedProfile(env);
    const { appId } = await makeApp(env, "shortlisted");
    const res = await transition(env.ctx, appId, "craft");
    expect(res.to).toBe("crafting");
    expect(env.enqueued).toEqual([{ name: "pen.craft", id: res.runId, data: { runId: res.runId, applicationId: appId } }]);
    const [run] = await env.db.select().from(agentRun).where(eq(agentRun.id, res.runId!));
    expect(run).toMatchObject({ status: "queued", role: "pen", applicationId: appId });
  });

  it("rolls everything back if the queue write fails", async () => {
    await seedProfile(env);
    const { appId } = await makeApp(env, "shortlisted");
    env.failNextEnqueue();
    await expect(transition(env.ctx, appId, "craft")).rejects.toThrow("queue unavailable");
    expect((await status(appId)).status).toBe("shortlisted");
    expect(await env.db.select().from(agentRun)).toHaveLength(0);
    expect(await events(appId)).toHaveLength(0);
  });

  it("allows only one active run per application", async () => {
    await seedProfile(env);
    const { appId } = await makeApp(env, "shortlisted");
    await makeRun(env, appId, "running");
    await expectError(transition(env.ctx, appId, "craft"), "busy");
    expect((await status(appId)).status).toBe("shortlisted");
  });

  it("success closes the run and moves to Crafted", async () => {
    await seedProfile(env);
    const { appId } = await makeApp(env, "shortlisted");
    const { runId } = await transition(env.ctx, appId, "craft");
    await transition(env.ctx, appId, "craftSucceeded", { actor: "system", runId });
    expect((await status(appId)).status).toBe("crafted");
    const [run] = await env.db.select().from(agentRun).where(eq(agentRun.id, runId!));
    expect(run!.status).toBe("succeeded");
  });

  it("failure returns to the previous column with the error", async () => {
    await seedProfile(env);
    // First craft fails → back to Shortlisted.
    const a = await makeApp(env, "shortlisted");
    const r1 = await transition(env.ctx, a.appId, "craft");
    await transition(env.ctx, a.appId, "craftFailed", { actor: "system", runId: r1.runId, error: "Timed out" });
    expect(await status(a.appId)).toMatchObject({ status: "shortlisted", lastError: "Timed out" });
    // Regenerate fails → back to Crafted, not Shortlisted.
    const b = await makeApp(env, "crafted");
    const r2 = await transition(env.ctx, b.appId, "regenerate");
    await transition(env.ctx, b.appId, "craftFailed", { actor: "system", runId: r2.runId, error: "Bad JSON" });
    expect((await status(b.appId)).status).toBe("crafted");
    const [run] = await env.db.select().from(agentRun).where(eq(agentRun.id, r2.runId!));
    expect(run).toMatchObject({ status: "failed", error: "Bad JSON" });
  });
});

describe("approve", () => {
  it("needs a draft", async () => {
    const { appId } = await makeApp(env, "crafted");
    await expectError(transition(env.ctx, appId, "approve"), "guard", /draft/);
  });

  it("locks the latest version of each document, which then can't change", async () => {
    const { appId } = await makeApp(env, "crafted");
    await makeDocument(env, appId, "cv", 1);
    const cv2 = await makeDocument(env, appId, "cv", 2);
    const letter = await makeDocument(env, appId, "cover_letter", 1);
    await transition(env.ctx, appId, "approve");
    const app = await status(appId);
    expect(app).toMatchObject({ status: "approved", approvedCvDocId: cv2, approvedLetterDocId: letter });
    await expect(
      env.db.update(document).set({ sha256: "tampered" }).where(eq(document.id, cv2)),
    ).rejects.toThrow();
  });
});

describe("apply", () => {
  async function approvedApp() {
    const { appId } = await makeApp(env, "crafted");
    const cv = await makeDocument(env, appId, "cv");
    await makeDocument(env, appId, "cover_letter");
    await transition(env.ctx, appId, "approve");
    return { appId, cv };
  }

  it("queues the Shipper when approved files are intact", async () => {
    const { appId } = await approvedApp();
    const res = await transition(env.ctx, appId, "apply");
    expect(res.to).toBe("applying");
    expect(env.enqueued.at(-1)?.name).toBe("shipper.prefill");
  });

  it("refuses when an approved PDF changed on disk", async () => {
    const { appId, cv } = await approvedApp();
    const [d] = await env.db.select().from(document).where(eq(document.id, cv));
    await writeFile(path.join(env.ctx.dataDir, d!.pdfPath), "%PDF-1.4 edited");
    await expectError(transition(env.ctx, appId, "apply"), "guard", /hash mismatch/);
  });

  it("refuses when submission evidence already exists", async () => {
    const { appId } = await approvedApp();
    await env.db.insert(evidence).values({ applicationId: appId, type: "submission", text: "earlier" });
    await expectError(transition(env.ctx, appId, "apply"), "guard", /already submitted/);
  });

  it("markApplied records submission evidence once", async () => {
    const { appId } = await makeApp(env, "awaiting_submit");
    await transition(env.ctx, appId, "markApplied");
    const ev = await env.db.select().from(evidence).where(eq(evidence.applicationId, appId));
    expect(ev.map((e) => e.type)).toEqual(["submission"]);
    expect((await status(appId)).status).toBe("applied");
    expect(env.enqueued.at(-1)?.name).toBe("shipper.captureEvidence");
  });

  it("prefill failure returns to Approved", async () => {
    const { appId } = await approvedApp();
    const { runId } = await transition(env.ctx, appId, "apply");
    await transition(env.ctx, appId, "prefillFailed", { actor: "system", runId, error: "Form changed" });
    expect(await status(appId)).toMatchObject({ status: "approved", lastError: "Form changed" });
  });
});

describe("blockers", () => {
  async function applyingApp() {
    const { appId } = await makeApp(env, "crafted");
    await makeDocument(env, appId, "cv");
    await transition(env.ctx, appId, "approve");
    const { runId } = await transition(env.ctx, appId, "apply");
    await env.db.update(agentRun).set({ status: "running" }).where(eq(agentRun.id, runId!));
    return { appId, runId: runId! };
  }

  it("raise pauses the run and flags the card without changing status", async () => {
    const { appId, runId } = await applyingApp();
    await raiseBlocker(env.ctx, runId, {
      question: "What is your notice period?",
      fieldContext: { label: "Notice period", type: "text" },
      checkpoint: { step: "custom_questions" },
    });
    expect(await status(appId)).toMatchObject({ status: "applying", hasOpenBlocker: true });
    const [run] = await env.db.select().from(agentRun).where(eq(agentRun.id, runId));
    expect(run).toMatchObject({ status: "paused", checkpoint: { step: "custom_questions" } });
  });

  it("answering the last blocker saves to the AnswerBank and resumes", async () => {
    const { appId, runId } = await applyingApp();
    const { blockerId: b1 } = await raiseBlocker(env.ctx, runId, {
      question: "What is your notice period?",
      fieldContext: { label: "Notice", type: "text" },
    });
    const { blockerId: b2 } = await raiseBlocker(env.ctx, runId, {
      question: "Why do you want to work at Acme?",
      fieldContext: { label: "Why", type: "textarea" },
    });
    const enqueuedBefore = env.enqueued.length;

    const first = await answerBlocker(env.ctx, b1, "One month", { reuse: true });
    expect(first.resumed).toBe(false);
    expect((await status(appId)).hasOpenBlocker).toBe(true);

    const second = await answerBlocker(env.ctx, b2, "Because of the product.", { reuse: false });
    expect(second.resumed).toBe(true);
    expect((await status(appId)).hasOpenBlocker).toBe(false);
    expect(env.enqueued.slice(enqueuedBefore).map((j) => j.name)).toEqual(["shipper.resume"]);

    const runs = await env.db.select().from(agentRun).where(eq(agentRun.applicationId, appId));
    expect(runs.find((r) => r.id === runId)!.status).toBe("superseded");
    expect(runs.find((r) => r.id === second.runId)).toMatchObject({ status: "queued", parentRunId: runId });

    // Reusable answer is found for any job; job-only answer only for this one.
    expect(await lookupAnswer(env.ctx, appId, "When can you start?")).toBe("One month");
    const other = await makeApp(env, "found");
    expect(await lookupAnswer(env.ctx, other.appId, "Notice period")).toBe("One month");
    expect(await lookupAnswer(env.ctx, appId, "Why do you want to work at Acme?")).toBe("Because of the product.");
    expect(await lookupAnswer(env.ctx, other.appId, "Why do you want to work at Acme?")).toBeNull();
    const bank = await env.db.select().from(answerBank);
    expect(bank).toHaveLength(2);
  });

  it("can't be answered twice or with an empty answer", async () => {
    const { runId } = await applyingApp();
    const { blockerId } = await raiseBlocker(env.ctx, runId, {
      question: "Pronouns",
      fieldContext: { label: "Pronouns", type: "text" },
    });
    await expectError(answerBlocker(env.ctx, blockerId, "   ", { reuse: true }), "guard");
    await answerBlocker(env.ctx, blockerId, "she/her", { reuse: true });
    await expectError(answerBlocker(env.ctx, blockerId, "they/them", { reuse: true }), "illegal");
    const [b] = await env.db.select().from(blocker).where(eq(blocker.id, blockerId));
    expect(b!.answer).toBe("she/her");
  });

  it("resume refuses if the application was submitted meanwhile", async () => {
    const { appId, runId } = await applyingApp();
    const { blockerId } = await raiseBlocker(env.ctx, runId, {
      question: "Notice period",
      fieldContext: { label: "Notice", type: "text" },
    });
    await env.db.insert(evidence).values({ applicationId: appId, type: "submission" });
    await expectError(answerBlocker(env.ctx, blockerId, "2 weeks", { reuse: true }), "guard", /already submitted/);
    // The whole answer is rolled back, so it stays open.
    const [b] = await env.db.select().from(blocker).where(and(eq(blocker.id, blockerId)));
    expect(b!.answeredAt).toBeNull();
  });
});

describe("search", () => {
  it("allows one search at a time", async () => {
    await startSearch(env.ctx);
    await expectError(startSearch(env.ctx), "busy");
    expect(env.enqueued.map((j) => j.name)).toEqual(["scout.search"]);
  });
});

describe("live updates", () => {
  it("NOTIFYs on commit and stays silent on rollback", async () => {
    const listener = new pg.Client({ connectionString: env.url });
    await listener.connect();
    const received: any[] = [];
    listener.on("notification", (n) => received.push(JSON.parse(n.payload!)));
    await listener.query("LISTEN app_events");
    try {
      await seedProfile(env);
      const { appId } = await makeApp(env, "shortlisted");
      env.failNextEnqueue();
      await transition(env.ctx, appId, "craft").catch(() => {});
      await transition(env.ctx, appId, "dismiss");
      await new Promise((r) => setTimeout(r, 150));
      expect(received).toEqual([{ type: "application", applicationId: appId, status: "archived", hasOpenBlocker: false }]);
    } finally {
      await listener.end();
    }
  });
});
