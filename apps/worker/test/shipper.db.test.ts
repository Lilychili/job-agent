// The Shipper against a real Postgres (TEST_DATABASE_URL) and a copy of a Lever form served locally.
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { answerBlocker, appendLog, claimRun, questionKey, resolveDataPath } from "@jobagent/core";
import { agentRun, answerBank, application, blocker, document, evidence, job, profile } from "@jobagent/db";
import { closeAllWindows } from "@jobagent/forms";
import { makeApp, makeDocument, makeRun, resetDb, seedProfile, setupTestEnv, type TestEnv } from "../../../packages/core/test/helpers";
import { shipperLocate } from "../src/jobs/locate";
import { shipperPrefill } from "../src/jobs/shipper";

// Point the Lever adapter at the local copy of the form instead of jobs.lever.co.
const form = vi.hoisted(() => ({ url: "" }));
vi.mock("@jobagent/forms", async (importOriginal) => {
  const real = await importOriginal<typeof import("@jobagent/forms")>();
  return { ...real, adapterFor: () => ({ ...real.lever, applyUrl: () => form.url }) };
});

const FIXTURE = new URL("../../../packages/forms/test/fixtures/lever-apply.html", import.meta.url);
const ANSWERS: Record<string, string> = {
  "Are you legally authorized to work in the country for which you are applying?": "Yes",
  "Will you now or in the future require visa sponsorship?": "No",
  "Language Skill(s) (Check all that apply)": "English (ENG)",
  "How did you hear about this position?": "Company website",
};

let env: TestEnv;
let server: Server;

beforeAll(async () => {
  process.env.SHIPPER_HEADLESS = "1";
  env = await setupTestEnv();
  const html = await readFile(FIXTURE, "utf8");
  server = createServer((_req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  form.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/acme/abc/apply`;
});
afterAll(async () => {
  await closeAllWindows();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await env.pool.end();
});
beforeEach(async () => {
  await resetDb(env);
  await seedProfile(env);
  await env.db.insert(answerBank).values(
    Object.entries(ANSWERS).map(([q, answer]) => ({ questionKey: questionKey(q), questionVariants: [q], answer, kind: "text" as const, reusable: true })),
  );
});

/** A job whose link is a Greenhouse posting, so finding its form needs no network. */
async function makeGreenhouseApp(status: "approved" | "applying") {
  const made = await makeApp(env, status);
  const id = String(Math.floor(Math.random() * 1e9));
  await env.db.update(job).set({ sourceUrl: `https://boards.greenhouse.io/acme/jobs/${id}` }).where(eq(job.id, made.jobId));
  return made;
}

/** An application in Applying with an approved CV and letter, as the Apply button leaves it. */
async function applying() {
  const { appId } = await makeGreenhouseApp("applying");
  const cvId = await makeDocument(env, appId, "cv");
  const letterId = await makeDocument(env, appId, "cover_letter");
  await env.db
    .update(document)
    .set({ content: { greeting: "Dear Acme,", paragraphs: [{ text: "I build things.", factIds: ["f1"] }], closing: "Best," } })
    .where(eq(document.id, letterId));
  await env.db.update(document).set({ approvedAt: new Date() }).where(eq(document.applicationId, appId));
  await env.db.update(application).set({ approvedCvDocId: cvId, approvedLetterDocId: letterId }).where(eq(application.id, appId));
  return { appId, cvId };
}

async function helpers(runId: string) {
  const [run] = await env.db.select().from(agentRun).where(eq(agentRun.id, runId));
  return { ctx: env.ctx, run: run!, log: (m: string) => appendLog(env.ctx, runId, m), signal: new AbortController().signal };
}

async function runShipper(runId: string) {
  const [run] = await env.db.select().from(agentRun).where(eq(agentRun.id, runId));
  return shipperPrefill({ ctx: env.ctx, run: run!, log: (m) => appendLog(env.ctx, runId, m), signal: new AbortController().signal });
}

const statusOf = async (appId: string) => (await env.db.select().from(application).where(eq(application.id, appId)))[0]!;

describe("shipper.prefill on a Lever form", () => {
  it("pauses on a question it can't answer, then fills the form after the owner answers it", async () => {
    // The seeded Profile has no location, and the form requires one.
    const { appId } = await applying();
    const runId = await makeRun(env, appId, "running", "shipper");

    await expect(runShipper(runId)).resolves.toEqual({ kind: "paused" });
    const [b] = await env.db.select().from(blocker).where(eq(blocker.applicationId, appId));
    expect(b).toMatchObject({ question: "Current location", fieldContext: { label: "Current location", type: "text" } });
    expect(await statusOf(appId)).toMatchObject({ status: "applying", hasOpenBlocker: true });
    expect(await env.db.select().from(evidence).where(eq(evidence.applicationId, appId))).toEqual([]);

    await expect(answerBlocker(env.ctx, b!.id, "Madrid, Spain", { reuse: true })).resolves.toMatchObject({ resumed: true });
    const resumeRun = await claimRun(env.ctx, env.enqueued.at(-1)!.id);
    const outcome = await runShipper(resumeRun!.id);

    expect(outcome).toMatchObject({ kind: "succeeded", output: { url: form.url } });
    expect(await statusOf(appId)).toMatchObject({ status: "awaiting_submit", hasOpenBlocker: false });
    if (outcome.kind !== "succeeded") throw new Error("expected the resumed run to succeed");
    expect(outcome.output!.filled).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fieldId: "resume", source: "document" }),
        expect.objectContaining({ fieldId: "name", source: "profile" }),
        expect.objectContaining({ fieldId: "location", source: "answerBank" }),
        expect.objectContaining({ fieldId: "comments", source: "document" }),
        expect.objectContaining({ fieldId: "cards[c1][field1]", source: "answerBank" }),
      ]),
    );
    const [shot] = await env.db.select().from(evidence).where(eq(evidence.applicationId, appId));
    expect(shot).toMatchObject({ type: "prefill_screenshot", agentRunId: resumeRun!.id });
    expect(existsSync(resolveDataPath(env.ctx, shot!.filePath!))).toBe(true);
  });

  it("fills the current employer from the Profile's open-ended role", async () => {
    await env.db.update(profile).set({
      contact: { name: "Test Owner", email: "t@example.com", location: "Madrid" },
      facts: [
        { id: "r1", kind: "role", text: "Engineer", org: "Globex", startDate: "2015-01", endDate: "2019-01" },
        { id: "r2", kind: "role", text: "Senior Engineer", org: "Initech", startDate: "2019-02" },
      ],
    });
    const { appId } = await applying();
    const runId = await makeRun(env, appId, "running", "shipper");
    const outcome = await runShipper(runId);
    expect(outcome.kind).toBe("succeeded");
    const [run] = await env.db.select().from(agentRun).where(eq(agentRun.id, runId));
    expect(run!.logs.map((l) => l.message)).toContain('Filled "Current company" from the profile');
  });

  it("fails without uploading when the approved CV changed on disk", async () => {
    await env.db.update(profile).set({ contact: { name: "Test Owner", email: "t@example.com", location: "Madrid" } });
    const { appId, cvId } = await applying();
    const [cv] = await env.db.select().from(document).where(eq(document.id, cvId));
    await writeFile(path.join(env.ctx.dataDir, cv!.pdfPath), "%PDF-1.4 tampered");
    const runId = await makeRun(env, appId, "running", "shipper");

    await expect(runShipper(runId)).rejects.toThrow(/changed since it was approved/);
    expect(await statusOf(appId)).toMatchObject({ status: "applying" });
    expect(await env.db.select().from(evidence).where(eq(evidence.applicationId, appId))).toEqual([]);
  });

  it("refuses an application that was already submitted", async () => {
    const { appId } = await applying();
    await env.db.insert(evidence).values({ applicationId: appId, type: "submission", text: "done" });
    const runId = await makeRun(env, appId, "running", "shipper");
    await expect(runShipper(runId)).rejects.toThrow(/Submission evidence exists/);
  });
});

describe("shipper.locate", () => {
  it("stores the form a posting link already points at, without asking Claude", async () => {
    const { appId, jobId } = await makeGreenhouseApp("approved");
    const runId = await makeRun(env, appId, "running", "shipper");
    await expect(shipperLocate(await helpers(runId))).resolves.toMatchObject({ kind: "succeeded", output: { outcome: "found" } });
    const [j] = await env.db.select().from(job).where(eq(job.id, jobId));
    expect(j).toMatchObject({ formAts: "greenhouse", formVia: "posting", formUrl: expect.stringMatching(/^https:\/\/boards\.greenhouse\.io\/acme\/jobs\//) });
  });

  it("makes Apply refuse a job known to have no form", async () => {
    const { appId } = await applying();
    const [app] = await env.db.select().from(application).where(eq(application.id, appId));
    await env.db.update(job).set({ formVia: "none" }).where(eq(job.id, app!.jobId));
    const runId = await makeRun(env, appId, "running", "shipper");
    await expect(runShipper(runId)).rejects.toThrow(/No Greenhouse, Lever or Ashby form/);
  });
});
