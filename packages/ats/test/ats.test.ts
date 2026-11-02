import { afterEach, describe, expect, it, vi } from "vitest";
import { AtsError, companyFromToken, htmlToText, listPostings, type Board } from "../src/index";

const stub = (handler: (url: string) => { status?: number; body: unknown }) => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    const { status = 200, body } = handler(url);
    return new Response(JSON.stringify(body), { status });
  });
  return calls;
};

afterEach(() => vi.unstubAllGlobals());

const greenhouse: Board = { ats: "greenhouse", boardToken: "acme" };
const lever: Board = { ats: "lever", boardToken: "acme-labs" };
const ashby: Board = { ats: "ashby", boardToken: "acme" };

describe("listPostings", () => {
  it("reads Greenhouse, including its escaped HTML", async () => {
    const calls = stub(() => ({
      body: {
        jobs: [
          {
            title: " Engineer ",
            absolute_url: "https://job-boards.greenhouse.io/acme/jobs/1",
            company_name: "Acme",
            location: { name: "Remote, Spain" },
            content: "&lt;p&gt;Build &amp;amp; ship&lt;/p&gt;&lt;script&gt;bad()&lt;/script&gt;",
          },
          { title: "No link" },
        ],
      },
    }));
    expect(await listPostings(greenhouse)).toEqual([
      {
        ats: "greenhouse",
        sourceUrl: "https://job-boards.greenhouse.io/acme/jobs/1",
        company: "Acme",
        title: "Engineer",
        location: "Remote, Spain",
        locations: ["Remote, Spain"],
        remote: "remote",
        salary: "not stated",
        text: "Build & ship",
      },
    ]);
    expect(calls[0]).toContain("boards/acme/jobs?content=true");
  });

  it("reads Lever and keeps the structured salary in the text", async () => {
    stub(() => ({
      body: [
        {
          text: "Engineer",
          hostedUrl: "https://jobs.lever.co/acme-labs/1",
          workplaceType: "hybrid",
          categories: { location: "Madrid", allLocations: ["Madrid", "Lisbon"] },
          descriptionPlain: "About us",
          lists: [{ text: "You", content: "<li>TypeScript</li><li>React</li>" }],
          additionalPlain: "Benefits",
          salaryRange: { min: 60000, max: 75000, currency: "EUR", interval: "per-year-salary" },
        },
      ],
    }));
    const [p] = await listPostings(lever);
    expect(p).toMatchObject({ company: "Acme Labs", remote: "hybrid", locations: ["Madrid", "Lisbon"], salary: "EUR 60000 - 75000 per year salary" });
    expect(p!.text).toContain("TypeScript\nReact");
    expect(p!.text).toContain(p!.salary);
  });

  it("falls back to Lever's EU host when the global one has no such board", async () => {
    const calls = stub((url) => (url.includes("api.eu.") ? { body: [] } : { status: 404, body: {} }));
    expect(await listPostings(lever)).toEqual([]);
    expect(calls).toHaveLength(2);
  });

  it("reads Ashby and skips unlisted jobs", async () => {
    stub(() => ({
      body: {
        jobs: [
          {
            title: "Engineer",
            jobUrl: "https://jobs.ashbyhq.com/acme/1",
            location: "Remote - EU",
            secondaryLocations: [{ location: "Spain" }],
            workplaceType: "Remote",
            descriptionPlain: "Hello",
            compensation: { scrapeableCompensationSalarySummary: "€150K - €250K" },
          },
          { title: "Hidden", jobUrl: "https://jobs.ashbyhq.com/acme/2", isListed: false },
        ],
      },
    }));
    const posts = await listPostings(ashby);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ remote: "remote", salary: "€150K - €250K", locations: ["Remote - EU", "Spain"] });
    expect(posts[0]!.text).toContain("€150K - €250K");
  });

  it("says plainly when a board doesn't exist", async () => {
    stub(() => ({ status: 404, body: {} }));
    await expect(listPostings(greenhouse)).rejects.toThrow(AtsError);
    await expect(listPostings(greenhouse)).rejects.toThrow(/check its name/);
  });

  it("escapes the board name in the URL", async () => {
    const calls = stub(() => ({ body: { jobs: [] } }));
    await listPostings({ ats: "greenhouse", boardToken: "../x" });
    expect(calls[0]).toContain("..%2Fx");
  });
});

describe("helpers", () => {
  it("htmlToText keeps line breaks and decodes entities", () => {
    expect(htmlToText("<p>One &amp; two</p><ul><li>a</li><li>b&#8217;s</li></ul>")).toBe("One & two\na\nb’s");
  });
  it("companyFromToken makes a slug readable", () => {
    expect(companyFromToken("acme-labs_inc")).toBe("Acme Labs Inc");
  });
});
