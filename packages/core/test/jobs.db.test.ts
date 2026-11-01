// Adding a job by hand: validation, dedupe, and where the card lands.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { application, applicationEvent, job } from "@jobagent/db";
import { addJob, parseJob } from "../src/jobs";
import { transition } from "../src/transition";
import { resetDb, setupTestEnv, type TestEnv } from "./helpers";

const VALID = { company: "Acme GmbH", title: "Senior Engineer", sourceUrl: "https://acme.example/careers/42" };

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

describe("parseJob", () => {
  it("fills in the defaults", () => {
    const j = parseJob({ ...VALID, location: "  ", salary: "" });
    expect(j).toMatchObject({ ats: "other", location: null, remote: "unknown", salary: "not stated", rawPosting: "" });
  });

  it("adds https to a bare link", () => {
    expect(parseJob({ ...VALID, sourceUrl: "acme.example/jobs/1" }).sourceUrl).toBe("https://acme.example/jobs/1");
  });

  it("recognizes a known ATS link", () => {
    const j = parseJob({ ...VALID, sourceUrl: "https://jobs.lever.co/acme/123?lever-source=x" });
    expect(j.ats).toBe("lever");
    expect(j.canonicalUrl).toBe("https://jobs.lever.co/acme/123");
  });

  it.each([
    [{ ...VALID, company: " " }, /company/i],
    [{ ...VALID, title: "" }, /title/i],
    [{ ...VALID, sourceUrl: "" }, /link/i],
    [{ ...VALID, sourceUrl: "javascript:alert(1)" }, /not a valid link/],
    [{ ...VALID, sourceUrl: "file:///etc/passwd" }, /not a valid link/],
    [{ ...VALID, sourceUrl: "ftp://acme.example/x" }, /not a valid link/],
    [{ ...VALID, sourceUrl: "nonsense" }, /not a valid link/],
    [{ ...VALID, remote: "moon" }, /work style/i],
    [{ ...VALID, rawPosting: "x".repeat(100_001) }, /too long/],
  ])("rejects %j", (input, message) => {
    expect(() => parseJob(input)).toThrow(message);
  });
});

describe("addJob", () => {
  it("puts the card in Found, recorded as the owner's", async () => {
    const { applicationId } = await addJob(env.pool, VALID);
    const [app] = await env.db.select().from(application).where(eq(application.id, applicationId));
    expect(app!.status).toBe("found");
    const [event] = await env.db.select().from(applicationEvent).where(eq(applicationEvent.applicationId, applicationId));
    expect(event).toMatchObject({ action: "added", toStatus: "found", actorType: "owner" });
  });

  it("refuses the same link twice", async () => {
    await addJob(env.pool, VALID);
    await expect(addJob(env.pool, { ...VALID, company: "Other", title: "Other", sourceUrl: `${VALID.sourceUrl}?utm_source=x` })).rejects.toThrow(/already on the board/);
    expect(await env.db.select().from(job)).toHaveLength(1);
  });

  it("refuses the same company and title under another link", async () => {
    await addJob(env.pool, VALID);
    await expect(addJob(env.pool, { ...VALID, company: "ACME", title: "Sr. Engineer", sourceUrl: "https://acme.example/careers/43" })).rejects.toThrow(/already on the board/);
  });

  it("keeps jobs apart when only the query string identifies them", async () => {
    await addJob(env.pool, { company: "A", title: "One", sourceUrl: "https://board.example/view?jk=1" });
    await addJob(env.pool, { company: "B", title: "Two", sourceUrl: "https://board.example/view?jk=2" });
    expect(await env.db.select().from(job)).toHaveLength(2);
  });

  it("a dismissed job can't be added back", async () => {
    const { applicationId } = await addJob(env.pool, VALID);
    await transition(env.ctx, applicationId, "dismiss");
    await expect(addJob(env.pool, VALID)).rejects.toThrow(/dismissed/);
  });
});
