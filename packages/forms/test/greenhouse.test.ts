import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { adapterFor, closeShipperBrowser, FormSession, greenhouse, prefill, type ApprovedFile, type FillSources } from "../src";

const FIXTURE = new URL("./fixtures/greenhouse-apply.html", import.meta.url);

describe("greenhouse.applyUrl", () => {
  it("turns any Greenhouse posting link into the hosted form", () => {
    expect(greenhouse.applyUrl("https://job-boards.greenhouse.io/acme/jobs/123?gh_src=x")).toBe("https://job-boards.greenhouse.io/acme/jobs/123");
    expect(greenhouse.applyUrl("https://boards.greenhouse.io/acme/jobs/123")).toBe("https://job-boards.greenhouse.io/acme/jobs/123");
    expect(greenhouse.applyUrl("https://job-boards.eu.greenhouse.io/acme/jobs/123/")).toBe("https://job-boards.eu.greenhouse.io/acme/jobs/123");
    expect(greenhouse.applyUrl("https://boards.greenhouse.io/embed/job_app?for=acme&token=123")).toBe("https://job-boards.greenhouse.io/acme/jobs/123");
  });

  it("refuses links that aren't Greenhouse postings", () => {
    expect(greenhouse.applyUrl("https://job-boards.greenhouse.io.evil.com/acme/jobs/123")).toBeNull();
    expect(greenhouse.applyUrl("http://job-boards.greenhouse.io/acme/jobs/123")).toBeNull();
    expect(greenhouse.applyUrl("https://job-boards.greenhouse.io/acme")).toBeNull();
    expect(greenhouse.applyUrl("https://acme.com/careers?gh_jid=123")).toBeNull();
    expect(greenhouse.applyUrl("not a url")).toBeNull();
  });

  it("is the adapter for greenhouse forms", () => {
    expect(adapterFor("greenhouse")).toBe(greenhouse);
  });
});

describe("a Greenhouse form in Chromium", () => {
  let server: Server;
  let url: string;
  let posts: string[] = [];
  let session: FormSession | null = null;
  let cv: ApprovedFile;

  beforeAll(async () => {
    const html = await readFile(FIXTURE, "utf8");
    server = createServer((req, res) => {
      if (req.method === "POST") {
        posts.push(req.url ?? "");
        res.setHeader("content-type", "application/json");
        res.end("{}");
        return;
      }
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(html);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/acme/jobs/123`;

    const dir = await mkdtemp(path.join(os.tmpdir(), "jobagent-forms-"));
    const cvPath = path.join(dir, "cv-v1.pdf");
    await writeFile(cvPath, "%PDF-1.4 approved cv");
    cv = { path: cvPath, sha256: createHash("sha256").update("%PDF-1.4 approved cv").digest("hex") };
  });

  afterEach(async () => {
    await session?.close();
    session = null;
    posts = [];
  });

  afterAll(async () => {
    await closeShipperBrowser();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const answers: Record<string, string> = {
    "Do you require visa sponsorship?": "No",
    "Which languages do you speak?": "English, Spanish",
    "Why Acme?": "Because you build things.",
  };
  const sources = (extra: Record<string, string | null> = {}): FillSources => ({
    contact: { name: "Ana Ruiz López", email: "ana@example.com", phone: "+34 600 000 000", location: "Madrid, Spain", links: ["https://linkedin.com/in/ana", "https://ana.dev"] },
    currentCompany: "Acme",
    letterText: "Dear Acme team,\n\nI build things.",
    lookup: async (q) => (q in extra ? extra[q]! : (answers[q] ?? null)),
  });
  const value = (id: string) => session!.page.locator(`#${id}`).inputValue();
  const chosen = (id: string) =>
    session!.page.locator(`#${id}`).locator("xpath=ancestor::*[contains(@class,'select__control')][1]").locator(".select__single-value, .select__multi-value__label").allTextContents();

  it("reads every question with its label, kind, options and whether it is required", async () => {
    session = await FormSession.open(greenhouse, url, { headless: true });
    const fields = await session.listFields();
    const byId = Object.fromEntries(fields.map((f) => [f.id, f]));

    expect(fields.map((f) => f.id)).toEqual([
      "first_name", "last_name", "email", "country", "phone", "resume", "cover_letter",
      "question_1", "question_2", "question_3", "question_4", "question_5", "question_6", "candidate-location", "gender",
    ]);
    expect(byId["first_name"]).toEqual({ id: "first_name", label: "First Name", kind: "text", required: true, standard: "firstName" });
    expect(byId["country"]).toMatchObject({ label: "Country", kind: "select", required: true, standard: "country", options: ["Spain +34", "United Kingdom +44", "United States +1"] });
    expect(byId["resume"]).toMatchObject({ label: "Resume/CV", kind: "file", required: true, standard: "resume" });
    expect(byId["cover_letter"]).toMatchObject({ label: "Cover Letter", kind: "file", required: false });
    expect(byId["question_1"]).toMatchObject({ label: "LinkedIn Profile", standard: "linkedin", required: false });
    expect(byId["question_2"]).toMatchObject({ label: "Website", standard: "website" });
    expect(byId["question_3"]).toEqual({ id: "question_3", label: "Do you require visa sponsorship?", kind: "select", required: true, options: ["Yes", "No"] });
    expect(byId["question_4"]).toMatchObject({ kind: "multi", required: false, options: ["English", "Spanish", "French"] });
    expect(byId["question_5"]).toMatchObject({ label: "Why Acme?", kind: "textarea", required: true });
    expect(byId["question_6"]!.standard).toBeUndefined();
    // A search box with nothing to pick until you type is left for the owner.
    expect(byId["candidate-location"]).toMatchObject({ kind: "other" });
    expect(byId["gender"]).toMatchObject({ kind: "select", required: false });
    // Reading the menus leaves them closed.
    expect(await session.page.locator('[role="listbox"]').count()).toBe(0);
  });

  it("fills the Profile, the AnswerBank answers and the CV, and leaves the rest", async () => {
    session = await FormSession.open(greenhouse, url, { headless: true });
    const result = await prefill(session, sources(), cv);

    expect(result.unknown).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(await value("first_name")).toBe("Ana");
    expect(await value("last_name")).toBe("Ruiz López");
    expect(await value("email")).toBe("ana@example.com");
    expect(await value("phone")).toBe("+34 600 000 000");
    expect(await chosen("country")).toEqual(["+34"]);
    expect(await value("question_1")).toBe("https://linkedin.com/in/ana");
    expect(await value("question_2")).toBe("https://ana.dev");
    expect(await chosen("question_3")).toEqual(["No"]);
    expect((await chosen("question_4")).sort()).toEqual(["English", "Spanish"]);
    expect(await value("question_5")).toBe("Because you build things.");
    expect(await session.page.locator("#resume").evaluate((e) => (e as HTMLInputElement).files?.[0]?.name)).toBe("cv-v1.pdf");

    expect(result.skipped.map((f) => f.id).sort()).toEqual(["candidate-location", "cover_letter", "gender", "question_6"]);
    expect(result.filled.find((f) => f.fieldId === "country")?.source).toBe("profile");
    expect(result.filled.find((f) => f.fieldId === "question_3")?.source).toBe("answerBank");
  });

  it("asks the AnswerBank for the country when the Profile's isn't an option", async () => {
    session = await FormSession.open(greenhouse, url, { headless: true });
    const result = await prefill(session, { ...sources(), contact: { ...sources().contact, location: "Lisbon, Portugal" } }, cv);
    expect(result.unknown.map((f) => f.id)).toEqual(["country"]);
  });

  it("fills nothing when a required question has no answer, and reports it", async () => {
    session = await FormSession.open(greenhouse, url, { headless: true });
    const result = await prefill(session, sources({ "Why Acme?": null }), cv);
    expect(result.unknown.map((f) => f.label)).toEqual(["Why Acme?"]);
    expect(result.filled).toEqual([]);
    expect(await value("first_name")).toBe("");
  });

  it("blocks the submit while it drives, and lets the owner submit once handed over", async () => {
    const blocked: string[] = [];
    session = await FormSession.open(greenhouse, url, { headless: true, onBlocked: (w) => blocked.push(w) });
    await prefill(session, sources(), cv);

    await session.page.click("#submit-app");
    await session.page.locator("#failed").waitFor();
    expect(posts).toEqual([]);
    expect(blocked[0]).toMatch(/^submit request/);

    await session.handOver();
    await session.page.click("#submit-app");
    await session.page.locator("#done").waitFor();
    expect(posts).toEqual(["/acme/jobs/123"]);
  });

  it("won't follow a link off the form's host", async () => {
    const blocked: string[] = [];
    session = await FormSession.open(greenhouse, url, { headless: true, onBlocked: (w) => blocked.push(w) });
    await session.page.click("#away").catch(() => {});
    await session.page.waitForTimeout(300);
    expect(blocked).toEqual(["navigation to example.invalid"]);
  });
});

describe("greenhouse.isSubmit", () => {
  const req = (method: string, url: string) => ({ method: () => method, url: () => url }) as Parameters<typeof greenhouse.isSubmit>[0];
  it("is the POST of the application to the board, on whichever host", () => {
    expect(greenhouse.isSubmit(req("POST", "https://boards.greenhouse.io/acme/jobs/123"))).toBe(true);
    expect(greenhouse.isSubmit(req("POST", "https://job-boards.greenhouse.io/embed/job_app"))).toBe(true);
    expect(greenhouse.isSubmit(req("GET", "https://boards.greenhouse.io/acme/jobs/123"))).toBe(false);
    expect(greenhouse.isSubmit(req("POST", "https://job-boards.greenhouse.io/seek/send_signal"))).toBe(false);
  });
});
