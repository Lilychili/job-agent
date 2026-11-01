import { describe, expect, it } from "vitest";
import { atsFromUrl, canonicalManualUrl, canonicalUrl, normalizeCompany, normalizeTitle, questionKey } from "../src/normalize";

describe("canonicalUrl", () => {
  it("drops query, fragment, trailing slash, www and case in host", () => {
    expect(canonicalUrl("http://WWW.Boards.Greenhouse.io/acme/jobs/123/?gh_src=abc&utm_source=x#apply")).toBe(
      "https://boards.greenhouse.io/acme/jobs/123",
    );
  });
  it("treats tracking variants of the same Lever posting as one", () => {
    const a = canonicalUrl("https://jobs.lever.co/acme/1f2e?lever-source=LinkedIn");
    const b = canonicalUrl("https://jobs.lever.co/acme/1f2e/");
    expect(a).toBe(b);
  });
  it("keeps path case (ATS ids can be case-sensitive)", () => {
    expect(canonicalUrl("https://jobs.ashbyhq.com/Acme/AbC")).toBe("https://jobs.ashbyhq.com/Acme/AbC");
  });
});

describe("atsFromUrl", () => {
  it.each([
    ["boards.greenhouse.io", "greenhouse"],
    ["job-boards.greenhouse.io", "greenhouse"],
    ["greenhouse.io", "greenhouse"],
    ["jobs.lever.co", "lever"],
    ["jobs.ashbyhq.com", "ashby"],
  ])("%s is %s", (host, expected) => {
    expect(atsFromUrl(`https://${host}/acme/1`)).toBe(expected);
  });

  it.each([
    "notgreenhouse.io",
    "fakegreenhouse-io",
    "greenhouse.io.evil.com",
    "jobs-lever.co",
    "jobsxlever.co",
    "notjobs.lever.co",
    "jobs-ashbyhq.com",
    "fooashbyhq.com",
  ])("%s is not a known ATS", (host) => {
    expect(atsFromUrl(`https://${host}/acme/1`)).toBeNull();
  });
});

describe("canonicalManualUrl", () => {
  it("keeps a query that identifies the job", () => {
    expect(canonicalManualUrl("https://board.example/view?jk=1")).not.toBe(canonicalManualUrl("https://board.example/view?jk=2"));
  });
  it("ignores parameter order", () => {
    expect(canonicalManualUrl("https://board.example/view?b=2&a=1")).toBe(canonicalManualUrl("https://board.example/view?a=1&b=2"));
  });
  it("drops a query that is only tracking", () => {
    expect(canonicalManualUrl("https://board.example/view/1?utm_source=x&gclid=y")).toBe("https://board.example/view/1");
  });
  it("drops tracking and keeps the rest", () => {
    expect(canonicalManualUrl("https://board.example/view?jk=1&utm_source=x")).toBe("https://board.example/view?jk=1");
  });
  it("drops any query on a known ATS", () => {
    expect(canonicalManualUrl("https://jobs.lever.co/acme/1?lever-source=x")).toBe("https://jobs.lever.co/acme/1");
  });
  it("keeps the query on a lookalike of a known ATS", () => {
    expect(canonicalManualUrl("https://notgreenhouse.io/view?id=1")).toBe("https://notgreenhouse.io/view?id=1");
  });
});

describe("normalizeCompany", () => {
  it.each([
    ["Acme Inc.", "acme"],
    ["ACME, Inc", "acme"],
    ["Qonto SAS", "qonto"],
    ["Lokalise", "lokalise"],
    ["Zalando SE ", "zalando"],
    ["Foo GmbH & Co. KG", "foo"],
    ["Müller GmbH", "muller"],
    ["Foo  Bar   Ltd", "foo bar"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeCompany(input)).toBe(expected);
  });
});

describe("normalizeTitle", () => {
  it.each([
    ["Sr. Frontend Engineer (m/f/d)", "senior frontend engineer"],
    ["Senior Frontend Engineer", "senior frontend engineer"],
    ["Backend Engineer – Node.js [Remote]", "backend engineer node js"],
    ["C# / .NET Developer", "c# net developer"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeTitle(input)).toBe(expected);
  });
});

describe("questionKey", () => {
  it("maps common phrasings to the same key", () => {
    expect(questionKey("What is your notice period?")).toBe("start_date");
    expect(questionKey("When can you start?")).toBe("start_date");
    expect(questionKey("Do you require visa sponsorship?")).toBe("visa_sponsorship");
    expect(questionKey("Salary expectations (EUR)")).toBe("salary_expectation");
  });
  it("falls back to a slug for unknown questions", () => {
    expect(questionKey("Favourite editor?")).toBe("favourite_editor");
  });
});

describe("questionKey never merges questions with different answers", () => {
  // A wrong match writes a false statement on an application; a miss only raises a Blocker.
  it("keeps right-to-work and sponsorship apart", () => {
    for (const q of ["Do you have the right to work in Spain?", "Work authorization status", "Are you legally authorized to work here?"]) {
      expect(questionKey(q)).toBe("work_authorization");
    }
    for (const q of ["Will you now or in the future require visa sponsorship?", "Do you need sponsorship?"]) {
      expect(questionKey(q)).toBe("visa_sponsorship");
    }
  });

  it("doesn't guess at questions that only sound like a known one", () => {
    for (const q of [
      "What is your current salary?",
      "Salary",
      "What was your start date at your last job?",
      "Do you have a valid visa?",
      "Do you have a website for your band?",
    ]) {
      expect(["salary_expectation", "start_date", "work_authorization", "visa_sponsorship", "website"]).not.toContain(questionKey(q));
    }
  });
});
