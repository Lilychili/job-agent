import { describe, expect, it } from "vitest";
import { hardFail, parseYearlySalary, type FilterableJob, type HardCriteria } from "../src/filter";

const none: HardCriteria = { locations: [], remote: "any", salaryFloor: null, salaryCurrency: null, exclusions: { companies: [], keywords: [], seniority: [] } };
const job: FilterableJob = { company: "Acme Inc.", title: "Senior Frontend Engineer", locations: ["Barcelona, Spain"], remote: "hybrid", salary: "not stated" };

describe("hardFail", () => {
  it("passes when nothing is set", () => expect(hardFail(job, none)).toBeNull());

  it("drops excluded companies whatever their legal suffix", () => {
    expect(hardFail(job, { ...none, exclusions: { ...none.exclusions, companies: ["acme"] } })).toBe("excluded company");
  });

  it("matches title keywords as whole words", () => {
    const keywords = (k: string[]) => ({ ...none, exclusions: { ...none.exclusions, keywords: k } });
    expect(hardFail({ ...job, title: "Crypto Engineer" }, keywords(["crypto"]))).not.toBeNull();
    expect(hardFail({ ...job, title: "Cryptography Engineer" }, keywords(["crypto"]))).toBeNull();
    expect(hardFail({ ...job, title: "Google Ads Lead" }, keywords(["go"]))).toBeNull();
  });

  it("drops excluded seniority", () => {
    expect(hardFail({ ...job, title: "Junior Developer" }, { ...none, exclusions: { ...none.exclusions, seniority: ["junior"] } })).toBe('seniority "junior"');
  });

  it("applies the remote policy but never guesses at an unknown one", () => {
    expect(hardFail(job, { ...none, remote: "remote" })).toBe("hybrid, not remote");
    expect(hardFail(job, { ...none, remote: "hybrid" })).toBeNull();
    expect(hardFail({ ...job, remote: "unknown" }, { ...none, remote: "remote" })).toBeNull();
  });

  it("matches any location the posting names", () => {
    const madrid = { ...none, locations: ["Madrid"] };
    expect(hardFail(job, madrid)).toBe("location");
    expect(hardFail({ ...job, locations: ["Lisbon", "Madrid"] }, madrid)).toBeNull();
    expect(hardFail({ ...job, locations: [] }, madrid)).toBeNull();
  });

  it("treats a remote job as matching a Remote location", () => {
    const c = { ...none, locations: ["Remote"] };
    expect(hardFail({ ...job, locations: ["Germany"], remote: "remote" }, c)).toBeNull();
    expect(hardFail({ ...job, locations: ["Germany"], remote: "onsite" }, c)).toBe("location");
    expect(hardFail({ ...job, locations: ["Remote - EU"], remote: "remote" }, { ...none, locations: ["Remote EU"] })).toBeNull();
  });

  it("compares salary only when the currency matches", () => {
    const floor = { ...none, salaryFloor: 70000, salaryCurrency: "EUR" };
    expect(hardFail({ ...job, salary: "€50,000 – €60,000" }, floor)).toBe("below salary floor");
    expect(hardFail({ ...job, salary: "€60,000 – €75,000" }, floor)).toBeNull();
    expect(hardFail({ ...job, salary: "$50,000" }, floor)).toBeNull();
    expect(hardFail(job, floor)).toBeNull();
  });
});

describe("parseYearlySalary", () => {
  it.each([
    ["€60,000 – €75,000", "EUR", 75000],
    ["€150K - €250K", "EUR", 250000],
    ["$87,069-$124,385 plus equity", "USD", 124385],
    ["EUR 60000 - 75000 per year salary", "EUR", 75000],
    ["70.000 EUR", "EUR", 70000],
    ["85.5k GBP", "GBP", 85500],
  ])("reads %s", (text, currency, max) => expect(parseYearlySalary(text)).toEqual({ currency, max }));

  it.each(["not stated", "€40 per hour", "$5,000 monthly", "competitive", "60000"])("won't guess at %s", (text) => {
    expect(parseYearlySalary(text)).toBeNull();
  });
});
