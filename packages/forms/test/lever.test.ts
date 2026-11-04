import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeShipperBrowser, FormSession, HashMismatchError, lever, prefill, type ApprovedFile, type FillSources } from "../src";

const FIXTURE = new URL("./fixtures/lever-apply.html", import.meta.url);

describe("lever.applyUrl", () => {
  it("turns a posting link into its apply form", () => {
    expect(lever.applyUrl("https://jobs.lever.co/acme/6ed76ce8-4156-4b60-b120-403538bd66cd?lever-source=x")).toBe(
      "https://jobs.lever.co/acme/6ed76ce8-4156-4b60-b120-403538bd66cd/apply",
    );
    expect(lever.applyUrl("https://jobs.eu.lever.co/acme/abc/apply")).toBe("https://jobs.eu.lever.co/acme/abc/apply");
  });

  it("refuses links that aren't Lever postings", () => {
    expect(lever.applyUrl("https://jobs.lever.co.evil.com/acme/abc")).toBeNull();
    expect(lever.applyUrl("http://jobs.lever.co/acme/abc")).toBeNull();
    expect(lever.applyUrl("https://jobs.lever.co/acme")).toBeNull();
    expect(lever.applyUrl("not a url")).toBeNull();
  });
});

describe("a Lever form in Chromium", () => {
  let server: Server;
  let url: string;
  let posts: string[];
  let session: FormSession | null = null;
  let cv: ApprovedFile;

  beforeAll(async () => {
    const html = await readFile(FIXTURE, "utf8");
    server = createServer((req, res) => {
      if (req.method === "POST") {
        posts.push(req.url ?? "");
        res.end("<p>Application submitted</p>");
        return;
      }
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(html);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/acme/abc/apply`;

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

  posts = [];

  const answers: Record<string, string> = {
    "Are you legally authorized to work in the country for which you are applying?": "Yes",
    "Will you now or in the future require visa sponsorship?": "No",
    "Language Skill(s) (Check all that apply)": "English (ENG), Spanish (SPA)",
    "How did you hear about this position?": "Company website",
  };
  const sources = (extra: Record<string, string | null> = {}): FillSources => ({
    contact: { name: "Ana Ruiz", email: "ana@example.com", phone: "+34 600 000 000", location: "Madrid, Spain", links: ["https://linkedin.com/in/ana"] },
    currentCompany: "Acme",
    letterText: "Dear Acme team,\n\nI build things.",
    lookup: async (q) => (q in extra ? extra[q]! : (answers[q] ?? null)),
  });
  const value = (name: string) => session!.page.locator(`[name="${name}"]`).first().inputValue();

  it("reads every question with its label, kind, options and whether it is required", async () => {
    session = await FormSession.open(lever, url, { headless: true });
    const fields = await session.listFields();
    const byId = Object.fromEntries(fields.map((f) => [f.id, f]));

    expect(byId["resume"]).toMatchObject({ kind: "file", standard: "resume", required: true });
    expect(byId["name"]).toMatchObject({ label: "Full name", standard: "name", required: true });
    expect(byId["location"]).toMatchObject({ label: "Current location", standard: "location", required: true });
    expect(byId["phone"]).toMatchObject({ standard: "phone", required: false });
    expect(byId["comments"]).toMatchObject({ label: "Additional information", kind: "textarea", standard: "coverLetterText" });
    expect(byId["urls[Other]"]).toMatchObject({ label: "Other website", kind: "text" });
    expect(byId["urls[Other]"]!.standard).toBeUndefined();
    expect(byId["cards[c1][field1]"]).toEqual({
      id: "cards[c1][field1]",
      label: "Will you now or in the future require visa sponsorship?",
      kind: "choice",
      required: true,
      options: ["Yes", "No"],
    });
    expect(byId["cards[c2][field0]"]).toMatchObject({ kind: "multi", options: ["English (ENG)", "Spanish (SPA)", "French (FRA)"] });
    expect(byId["cards[c2][field2]"]).toMatchObject({ kind: "select", required: true, options: ["Company website", "Friend or Family"] });
    expect(byId["cards[c2][field3]"]).toMatchObject({ kind: "textarea", required: false });
    expect(byId["eeo[gender]"]).toMatchObject({ label: "Gender", kind: "select", required: false });
    // Lever's own bookkeeping inputs aren't questions.
    expect(byId["selectedLocation"]).toBeUndefined();
    expect(byId["h-captcha-response"]).toBeUndefined();
    expect(byId["cards[c1][baseTemplate]"]).toBeUndefined();
  });

  it("fills the Profile, the AnswerBank answers, the letter text and the CV, and leaves the rest", async () => {
    session = await FormSession.open(lever, url, { headless: true });
    const result = await prefill(session, sources(), cv);

    expect(result.unknown).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(await value("name")).toBe("Ana Ruiz");
    expect(await value("email")).toBe("ana@example.com");
    expect(await value("location")).toBe("Madrid, Spain");
    expect(await value("org")).toBe("Acme");
    expect(await value("urls[LinkedIn]")).toBe("https://linkedin.com/in/ana");
    expect(await value("comments")).toBe("Dear Acme team,\n\nI build things.");
    expect(await session.page.locator('[name="cards[c1][field0]"][value="Yes"]').isChecked()).toBe(true);
    expect(await session.page.locator('[name="cards[c1][field1]"][value="No"]').isChecked()).toBe(true);
    expect(await session.page.locator('[name="cards[c2][field0]"]:checked').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).toEqual([
      "English (ENG)",
      "Spanish (SPA)",
    ]);
    expect(await value("cards[c2][field2]")).toBe("Company website");
    expect(await session.page.locator('[name="resume"]').evaluate((e) => (e as HTMLInputElement).files?.[0]?.name)).toBe("cv-v1.pdf");

    expect(result.skipped.map((f) => f.id).sort()).toEqual(["cards[c2][field1]", "cards[c2][field3]", "eeo[gender]", "urls[GitHub]", "urls[Other]", "urls[Portfolio]"].sort());
    expect(result.filled.find((f) => f.fieldId === "comments")?.source).toBe("document");
    expect(result.filled.find((f) => f.fieldId === "cards[c2][field2]")?.source).toBe("answerBank");
  });

  it("fills nothing when a required question has no answer, and reports it", async () => {
    session = await FormSession.open(lever, url, { headless: true });
    const result = await prefill(session, sources({ "Will you now or in the future require visa sponsorship?": null }), cv);

    expect(result.unknown.map((f) => f.label)).toEqual(["Will you now or in the future require visa sponsorship?"]);
    expect(result.filled).toEqual([]);
    expect(await value("name")).toBe("");
  });

  it("refuses to upload a CV that changed since it was approved", async () => {
    session = await FormSession.open(lever, url, { headless: true });
    await expect(prefill(session, sources(), { ...cv, sha256: "0".repeat(64) })).rejects.toBeInstanceOf(HashMismatchError);
    expect(await session.page.locator('[name="resume"]').evaluate((e) => (e as HTMLInputElement).files?.length)).toBe(0);
  });

  it("blocks the submit while it drives, and lets the owner submit once handed over", async () => {
    const blocked: string[] = [];
    session = await FormSession.open(lever, url, { headless: true, onBlocked: (w) => blocked.push(w) });
    await prefill(session, sources(), cv);

    await session.page.click("#btn-submit");
    await expect.poll(() => blocked.length).toBeGreaterThan(0);
    expect(posts).toEqual([]);
    expect(blocked[0]).toMatch(/^submit request/);
    // The blocked submit lands on Chromium's error page; let that finish, or it cuts off the reload below.
    await session.page.waitForURL((u) => u.protocol === "chrome-error:", { timeout: 5_000 }).catch(() => {});

    // A reloaded form's required fields are empty, so skip validation to show the POST now goes out.
    await session.page.goto(url);
    await session.handOver();
    await session.page.locator("form").evaluate((f) => ((f as HTMLFormElement).noValidate = true));
    await Promise.all([session.page.waitForResponse((r) => r.request().method() === "POST"), session.page.click("#btn-submit")]);
    expect(posts).toEqual(["/acme/abc/apply"]);
  });

  it("opens each form as a tab in one window", async () => {
    session = await FormSession.open(lever, url, { headless: true });
    const second = await FormSession.open(lever, url, { headless: true });
    expect(second.page.context()).toBe(session.page.context());
    await second.close();
    expect(second.isOpen).toBe(false);
    expect(session.isOpen).toBe(true);
  });

  it("keeps a popup the form opens on the form's host", async () => {
    const blocked: string[] = [];
    session = await FormSession.open(lever, url, { headless: true, onBlocked: (w) => blocked.push(w) });
    const [popup] = await Promise.all([session.page.waitForEvent("popup"), session.page.evaluate(() => void window.open("https://example.invalid/x"))]);
    await popup.waitForTimeout(300);
    expect(blocked).toEqual(["navigation to example.invalid"]);
    await popup.close();
  });

  it("won't follow a link off the form's host", async () => {
    const blocked: string[] = [];
    session = await FormSession.open(lever, url, { headless: true, onBlocked: (w) => blocked.push(w) });
    await session.page.click("#away").catch(() => {});
    await session.page.waitForTimeout(300);
    expect(blocked).toEqual(["navigation to example.invalid"]);
  });
});
