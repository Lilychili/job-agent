import { describe, expect, it } from "vitest";
import { keepFactIds, parseContact, parseFacts, parseModel, parsePreferences, ValidationError } from "../src/profile";

describe("parseContact", () => {
  it("trims, normalizes links and drops empty optionals", () => {
    const c = parseContact({
      name: "  Ada Lovelace ",
      email: "ada@example.com",
      phone: " ",
      links: ["github.com/ada", "", "https://ada.dev"],
    });
    expect(c).toEqual({ name: "Ada Lovelace", email: "ada@example.com", links: ["https://github.com/ada", "https://ada.dev/"] });
  });

  it("requires a name and a valid email", () => {
    expect(() => parseContact({ email: "a@b.co" })).toThrow(ValidationError);
    expect(() => parseContact({ name: "A", email: "nope" })).toThrow(/email/);
  });

  it("rejects non-http links", () => {
    expect(() => parseContact({ name: "A", email: "a@b.co", links: ["javascript:alert(1)"] })).toThrow(/not a valid link/);
  });
});

describe("parseFacts", () => {
  it("keeps existing ids, assigns new ones and drops empty rows", () => {
    const facts = parseFacts([
      { id: "f-keep", kind: "role", text: " Engineer ", org: "Acme", startDate: "2021-03", endDate: "2023" },
      { kind: "skill", text: "TypeScript" },
      { kind: "skill", text: "   " },
    ]);
    expect(facts).toHaveLength(2);
    expect(facts[0]).toEqual({ id: "f-keep", kind: "role", text: "Engineer", org: "Acme", startDate: "2021-03", endDate: "2023" });
    expect(facts[1]!.id).toMatch(/^f-skill-[0-9a-f]{8}$/);
  });

  it("rejects bad kinds, dates, duplicate ids and reversed ranges", () => {
    expect(() => parseFacts([{ kind: "hobby", text: "x" }])).toThrow(/Unknown fact kind/);
    expect(() => parseFacts([{ kind: "role", text: "x", startDate: "March 2021" }])).toThrow(/startDate/);
    expect(() =>
      parseFacts([
        { id: "a", kind: "skill", text: "x" },
        { id: "a", kind: "skill", text: "y" },
      ]),
    ).toThrow(/Duplicate/);
    expect(() => parseFacts([{ kind: "role", text: "x", startDate: "2023-05", endDate: "2023-01" }])).toThrow(/before it starts/);
  });
});

describe("parsePreferences", () => {
  const ok = { remote: "any" };

  it("trims, dedupes and fills defaults", () => {
    expect(parsePreferences({ ...ok, locations: [" Barcelona ", "Barcelona", ""], companyBoards: [{ ats: "lever", boardToken: "acme" }, { ats: "lever", boardToken: " " }] })).toMatchObject({
      locations: ["Barcelona"],
      salaryFloor: null,
      salaryCurrency: null,
      companyBoards: [{ ats: "lever", boardToken: "acme" }],
    });
  });

  it("requires a currency with a salary floor, and uppercases it", () => {
    expect(parsePreferences({ ...ok, salaryFloor: "60000", salaryCurrency: "eur" })).toMatchObject({ salaryFloor: 60000, salaryCurrency: "EUR" });
    expect(() => parsePreferences({ ...ok, salaryFloor: 60000 })).toThrow(/currency/);
    expect(() => parsePreferences({ ...ok, salaryFloor: -1, salaryCurrency: "EUR" })).toThrow(/whole number/);
  });

  it("rejects unknown enums and odd board names", () => {
    expect(() => parsePreferences({ remote: "moon" })).toThrow(/remote policy/);
    expect(() => parsePreferences({ ...ok, companyBoards: [{ ats: "workday", boardToken: "x" }] })).toThrow(/Unknown job board/);
    expect(() => parsePreferences({ ...ok, companyBoards: [{ ats: "lever", boardToken: "../etc" }] })).toThrow(/board name/);
  });
});

describe("parseModel", () => {
  it("accepts model ids and treats empty as the default", () => {
    expect(parseModel("claude-sonnet-5-5")).toBe("claude-sonnet-5-5");
    expect(parseModel(" ")).toBeNull();
  });

  it("refuses anything that could be read as a command-line flag", () => {
    expect(() => parseModel("--dangerously-skip-permissions")).toThrow(/valid model/);
    expect(() => parseModel("a b")).toThrow(/valid model/);
  });
});

describe("keepFactIds", () => {
  const old = [
    { id: "r-old", kind: "role" as const, text: "Software Engineer", org: "Sage" },
    { id: "a-old", kind: "achievement" as const, text: "Built AI receipt capture.", org: "Sage" },
    { id: "s-old", kind: "skill" as const, text: "TypeScript" },
  ];

  it("gives a re-read fact the ID it had, ignoring case and spacing", () => {
    const read = [
      { id: "r-new", kind: "role" as const, text: "software  engineer", org: "SAGE" },
      { id: "a-new", kind: "achievement" as const, text: "Built AI receipt capture, live in production.", org: "Sage" },
      { id: "s-new", kind: "skill" as const, text: "TypeScript" },
    ];
    expect(keepFactIds(read, old).map((f) => f.id)).toEqual(["r-old", "a-new", "s-old"]);
  });

  it("leaves facts that already carry a saved ID alone, and never gives one ID twice", () => {
    const edited = [
      { id: "s-old", kind: "skill" as const, text: "TypeScript" },
      { id: "s-new", kind: "skill" as const, text: "TypeScript" },
    ];
    expect(keepFactIds(edited, old).map((f) => f.id)).toEqual(["s-old", "s-new"]);
  });
});
