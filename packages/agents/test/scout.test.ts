import { describe, expect, it } from "vitest";
import type { Posting } from "@jobagent/ats";
import { parseScores, postingForPrompt } from "../src/scout";

const posting: Posting = {
  ats: "greenhouse",
  sourceUrl: "https://job-boards.greenhouse.io/acme/jobs/1",
  company: "Acme",
  title: "Engineer",
  location: "Barcelona",
  locations: ["Barcelona"],
  remote: "unknown",
  salary: "not stated",
  text: "We pay  €60,000 –\n€75,000 a year. Hybrid.",
};
const good = { ref: 0, salary: "not stated", remote: "hybrid", matchScore: 80, met: ["React"], missed: [] };
const parse = (over: object, p = posting) => parseScores({ scores: [{ ...good, ...over }] }, [p]);

describe("parseScores", () => {
  it("merges the score onto the posting", () => {
    expect(parse({})[0]).toMatchObject({ company: "Acme", matchScore: 80, matchReasons: { met: ["React"], missed: [] }, salary: "not stated" });
  });

  it("can't change what the board said", () => {
    const [job] = parse({ company: "Evil", title: "CEO", sourceUrl: "https://evil.example" });
    expect(job).toMatchObject({ company: "Acme", title: "Engineer", sourceUrl: posting.sourceUrl });
  });

  it("takes the work style only when the board gave none", () => {
    expect(parse({})[0]!.remote).toBe("hybrid");
    expect(parse({}, { ...posting, remote: "onsite" })[0]!.remote).toBe("onsite");
  });

  it("accepts a salary copied from the posting, ignoring spacing", () => {
    expect(parse({ salary: "€60,000 – €75,000" })[0]!.salary).toBe("€60,000 – €75,000");
  });

  it.each(["€80,000", "competitive", "", "about 60k"])("rejects the invented salary %j", (salary) => {
    expect(() => parse({ salary })).toThrow(/salary/);
  });

  it("keeps the board's salary whatever Claude says", () => {
    expect(parse({ salary: "€1" }, { ...posting, salary: "€150K" })[0]!.salary).toBe("€150K");
  });

  it.each([[-1], [101], [7.5], ["80"]])("rejects the score %j", (matchScore) => {
    expect(() => parse({ matchScore })).toThrow(/0 to 100/);
  });

  it("needs reasons", () => {
    expect(() => parse({ met: [], missed: [" "] })).toThrow(/reasons/);
  });

  it("needs every posting scored exactly once", () => {
    expect(() => parseScores({ scores: [] }, [posting])).toThrow(/no score/);
    expect(() => parseScores({ scores: [good, good] }, [posting])).toThrow(/twice/);
    expect(() => parseScores(null, [posting])).toThrow(/No scores/);
  });
});

describe("postingForPrompt", () => {
  it("cuts long postings but keeps pay lines from the end", () => {
    const text = `${"x".repeat(7000)}\nPerks\nThe salary range is €70,000\nThanks`;
    const short = postingForPrompt(text);
    expect(short.length).toBeLessThan(7500);
    expect(short).toContain("€70,000");
    expect(short).not.toContain("Perks");
  });
});
