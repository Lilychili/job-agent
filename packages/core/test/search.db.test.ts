// What Search stores: M2's exit test is that running it twice adds nothing new.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agentRun, application, applicationEvent, job, preferences } from "@jobagent/db";
import { listDiscoveredCompanies, removeDiscoveredCompany, saveDiscoveredCompany } from "../src/discovered";
import { addFoundJobs, addRejectedPostings, unknownPostings, type FoundJob } from "../src/jobs";
import { resetDb, setupTestEnv, type TestEnv } from "./helpers";

const found = (over: Partial<FoundJob> = {}): FoundJob => ({
  ats: "greenhouse",
  sourceUrl: "https://job-boards.greenhouse.io/acme/jobs/1",
  company: "Acme",
  title: "Engineer",
  location: "Barcelona",
  remote: "hybrid",
  salary: "not stated",
  text: "The posting",
  matchScore: 80,
  matchReasons: { met: ["React"], missed: [] },
  ...over,
});

let env: TestEnv;
let runId: string;
beforeAll(async () => {
  env = await setupTestEnv();
});
afterAll(async () => {
  await env.pool.end();
});
beforeEach(async () => {
  await resetDb(env);
  const [run] = await env.db.insert(agentRun).values({ role: "scout", jobName: "scout.search" }).returning();
  runId = run!.id;
});

describe("addFoundJobs", () => {
  it("puts the job in Found with its score and reasons", async () => {
    expect(await addFoundJobs(env.pool, [found()], runId)).toBe(1);
    const [row] = await env.db.select().from(job);
    expect(row).toMatchObject({ matchScore: 80, matchReasons: { met: ["React"], missed: [] }, salary: "not stated", rawPosting: "The posting" });
    const [app] = await env.db.select().from(application).where(eq(application.jobId, row!.id));
    expect(app!.status).toBe("found");
    const [event] = await env.db.select().from(applicationEvent);
    expect(event).toMatchObject({ action: "found", actorType: "agent", agentRunId: runId });
  });

  it("adds nothing the second time", async () => {
    await addFoundJobs(env.pool, [found()], runId);
    expect(await addFoundJobs(env.pool, [found()], runId)).toBe(0);
    expect(await env.db.select().from(job)).toHaveLength(1);
  });

  it("treats the same role at another link as a duplicate", async () => {
    await addFoundJobs(env.pool, [found()], runId);
    expect(await addFoundJobs(env.pool, [found({ sourceUrl: "https://job-boards.greenhouse.io/acme/jobs/2" })], runId)).toBe(0);
  });
});

describe("addRejectedPostings", () => {
  it("keeps a low-scored posting off the next search without putting it on the board", async () => {
    const low = found({ sourceUrl: "https://job-boards.greenhouse.io/acme/jobs/9?gh_src=x" });
    await addRejectedPostings(env.pool, [{ ...low, matchScore: 40 }], "key");
    expect(await env.db.select().from(job)).toHaveLength(0);
    expect(await unknownPostings(env.pool, [low, found()], "key")).toEqual([found()]);
  });

  it("knows a rejected alert job again by company and title, whatever its link", async () => {
    const alert = found({ sourceUrl: "https://job-boards.greenhouse.io/acme/jobs/9", source: "indeed_alert" });
    await addRejectedPostings(env.pool, [{ ...alert, matchScore: 40 }], "key");
    const nextEmail = found({ sourceUrl: "https://cts.indeed.com/a?x=2" });
    expect(await unknownPostings(env.pool, [nextEmail], "key")).toEqual([]);
    expect(await unknownPostings(env.pool, [nextEmail], "new preferences")).toEqual([nextEmail]);
  });

  it("scores a rejected posting again when Preferences change", async () => {
    await addRejectedPostings(env.pool, [{ ...found(), matchScore: 40 }], "key");
    expect(await unknownPostings(env.pool, [found()], "new preferences")).toEqual([found()]);
  });

  it("scores a rejected posting again after a month", async () => {
    const low = found();
    await addRejectedPostings(env.pool, [{ ...low, matchScore: 40 }], "key");
    await env.pool.query("update rejected_posting set updated_at = now() - interval '31 days'");
    expect(await unknownPostings(env.pool, [low], "key")).toEqual([low]);
  });
});

describe("unknownPostings", () => {
  it("keeps a dismissed Indeed job out when a later email links to it differently", async () => {
    await addFoundJobs(env.pool, [found({ sourceUrl: "https://es.indeed.com/rc/clk/dl?bb=first&jk=49d3&tk=1" })], runId);
    await env.db.update(job).set({ archived: true });
    expect(await unknownPostings(env.pool, [found({ sourceUrl: "https://es.indeed.com/rc/clk/dl?bb=second&jk=49d3&tk=2" })], "key")).toEqual([]);
  });

  it("drops what's on the board and repeats within the list", async () => {
    await addFoundJobs(env.pool, [found()], runId);
    const fresh = found({ sourceUrl: "https://acme.example/careers?gh_jid=2", title: "Designer" });
    const repeat = { ...fresh, sourceUrl: "https://acme.example/careers?gh_jid=3" };
    expect(await unknownPostings(env.pool, [found(), fresh, repeat], "key")).toEqual([fresh]);
  });

  it("tells apart jobs a company page names only in the query", async () => {
    const one = found({ sourceUrl: "https://acme.example/careers?gh_jid=1", title: "One" });
    const two = found({ sourceUrl: "https://acme.example/careers?gh_jid=2", title: "Two" });
    expect(await unknownPostings(env.pool, [one, two], "key")).toEqual([one, two]);
  });

  it("keeps a dismissed job out by its link, but lets a new opening with the same title in", async () => {
    await addFoundJobs(env.pool, [found()], runId);
    await env.db.update(job).set({ archived: true });
    const reopened = found({ sourceUrl: "https://job-boards.greenhouse.io/acme/jobs/9" });
    expect(await unknownPostings(env.pool, [found(), reopened], "key")).toEqual([reopened]);
  });

  it("skips a link it can't read", async () => {
    expect(await unknownPostings(env.pool, [found({ sourceUrl: "not a link" })], "key")).toEqual([]);
  });
});

describe("removeDiscoveredCompany", () => {
  it("adds the company to the ones to skip, once", async () => {
    await env.db.insert(preferences).values({});
    await saveDiscoveredCompany(env.pool, { name: "Acme", reason: "", board: null });
    const [company] = await listDiscoveredCompanies(env.pool);
    expect(await removeDiscoveredCompany(env.pool, company!.id)).toBe(true);
    expect(await removeDiscoveredCompany(env.pool, company!.id)).toBe(true);
    const [prefs] = await env.db.select().from(preferences);
    expect(prefs!.exclusions.companies).toEqual(["Acme"]);
    expect((await listDiscoveredCompanies(env.pool))[0]!.removed).toBe(true);
  });
});
