import { describe, expect, it } from "vitest";
import { findForm, greenhouseJobId, matchPosting, postingFromUrl } from "../src/form";
import type { Board, Posting } from "../src/types";

const posting = (p: Partial<Posting> & Pick<Posting, "sourceUrl" | "title">): Posting => ({
  ats: "greenhouse",
  company: "Wizeline",
  location: null,
  locations: [],
  remote: "unknown",
  salary: "not stated",
  text: "",
  ...p,
});

describe("postingFromUrl", () => {
  it("recognizes hosted postings and drops the query", () => {
    expect(postingFromUrl("https://jobs.lever.co/rover/a825940e-3c09?lever-source=x")).toEqual({ ats: "lever", url: "https://jobs.lever.co/rover/a825940e-3c09" });
    expect(postingFromUrl("https://jobs.ashbyhq.com/preply/1f864bc1-1fbe-45cf-a3e5-a77658b5c5ac")).toMatchObject({ ats: "ashby" });
    expect(postingFromUrl("https://job-boards.greenhouse.io/scopely/jobs/4596752008?gh_jid=4596752008")).toEqual({
      ats: "greenhouse",
      url: "https://job-boards.greenhouse.io/scopely/jobs/4596752008",
    });
  });

  it("refuses company pages, boards and look-alike hosts", () => {
    expect(postingFromUrl("https://www.wizeline.ai/careers/job?gh_jid=3004353")).toBeNull();
    expect(postingFromUrl("https://jobs.lever.co/rover")).toBeNull();
    expect(postingFromUrl("https://jobs.lever.co.evil.com/rover/1")).toBeNull();
    expect(postingFromUrl("http://jobs.lever.co/rover/1")).toBeNull();
  });
});

describe("greenhouseJobId", () => {
  it("reads it from either kind of link", () => {
    expect(greenhouseJobId("https://stripe.com/jobs/search?gh_jid=8232358")).toBe("8232358");
    expect(greenhouseJobId("https://job-boards.eu.greenhouse.io/lighthouse/jobs/4877053101")).toBe("4877053101");
    expect(greenhouseJobId("https://example.com/jobs")).toBeNull();
  });
});

describe("matchPosting", () => {
  const postings = [
    posting({ sourceUrl: "https://www.wizeline.ai/careers/job?gh_jid=1", title: "Senior Full-Stack Engineer" }),
    posting({ sourceUrl: "https://www.wizeline.ai/careers/job?gh_jid=2", title: "Data Engineer" }),
    posting({ sourceUrl: "https://www.wizeline.ai/careers/job?gh_jid=3", title: "Senior Data Engineer" }),
  ];

  it("prefers the same link, then a unique title", () => {
    expect(matchPosting(postings, { sourceUrl: "https://www.wizeline.ai/careers/job?gh_jid=2", title: "x" })?.title).toBe("Data Engineer");
    expect(matchPosting(postings, { sourceUrl: "https://es.indeed.com/x", title: "Senior Full Stack Engineer" })?.title).toBe("Senior Full-Stack Engineer");
  });

  it("refuses a title that fits more than one posting", () => {
    expect(matchPosting(postings, { sourceUrl: "https://es.indeed.com/x", title: "Engineer" })).toBeNull();
  });
});

describe("findForm", () => {
  const boards: Record<string, Posting[]> = {
    "greenhouse/wizeline": [posting({ sourceUrl: "https://www.wizeline.ai/careers/job?gh_jid=77", title: "Senior Full-Stack Engineer" })],
  };
  it("uses the posting link when it already is one", async () => {
    const r = await findForm({ sourceUrl: "https://jobs.lever.co/rover/abc", companyUrl: null, company: "Rover", title: "Engineer" });
    expect(r).toEqual({ outcome: "found", via: "posting", link: { ats: "lever", url: "https://jobs.lever.co/rover/abc", title: "Engineer" } });
  });

  it("rebuilds the hosted Greenhouse form for a job listed on the company's own site", async () => {
    const { AtsError } = await import("../src/types");
    const strict = async (b: Board) => {
      const found = boards[`${b.ats}/${b.boardToken}`];
      if (!found) throw new AtsError("missing", 404);
      return found;
    };
    const r = await findForm({ sourceUrl: "https://www.wizeline.ai/careers/job?gh_jid=77", companyUrl: null, company: "Wizeline", title: "Senior Full-Stack Engineer" }, { read: strict });
    expect(r).toEqual({
      outcome: "found",
      via: "board",
      link: { ats: "greenhouse", url: "https://job-boards.greenhouse.io/wizeline/jobs/77", title: "Senior Full-Stack Engineer" },
    });
  });

  it("asks for careers links only when the company's name finds no board", async () => {
    const { AtsError } = await import("../src/types");
    const strict = async (b: Board) => {
      if (b.ats === "greenhouse" && b.boardToken === "wz-careers") return boards["greenhouse/wizeline"]!;
      throw new AtsError("missing", 404);
    };
    let asked = 0;
    const r = await findForm(
      { sourceUrl: "https://es.indeed.com/rc/clk/dl?jk=1", companyUrl: null, company: "Wizeline", title: "Senior Full-Stack Engineer" },
      { read: strict, careersLinks: async () => (asked++, ["https://boards.greenhouse.io/embed/job_board?for=wz-careers", "https://www.wizeline.ai/careers"]) },
    );
    expect(asked).toBe(1);
    expect(r).toMatchObject({ outcome: "found", via: "careers", link: { url: "https://job-boards.greenhouse.io/wz-careers/jobs/77" } });
  });
});
