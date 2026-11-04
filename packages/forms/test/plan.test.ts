import { describe, expect, it } from "vitest";
import { matchOption, matchOptions, planFill, standardFromLabel, type FillSources } from "../src/plan";
import type { FormField } from "../src/types";

describe("matchOption", () => {
  it("matches ignoring case and spacing", () => {
    expect(matchOption("  yes ", ["Yes", "No"])).toBe("Yes");
  });

  it("lets a short answer pick the one option it starts, and a long answer the option it starts with", () => {
    expect(matchOption("Yes", ["Yes, I consent", "No, I do not consent"])).toBe("Yes, I consent");
    expect(matchOption("Yes, EU citizen", ["Yes", "No"])).toBe("Yes");
  });

  it("refuses an ambiguous or unrelated answer", () => {
    expect(matchOption("Yes", ["Yes, full time", "Yes, part time"])).toBeNull();
    expect(matchOption("Maybe", ["Yes", "No"])).toBeNull();
    expect(matchOption("Yesterday", ["Yes", "No"])).toBeNull();
    expect(matchOption("", ["Yes"])).toBeNull();
  });
});

describe("matchOptions", () => {
  const langs = ["English (ENG)", "Spanish (SPA)", "French (FRA)"];

  it("picks one option per listed answer", () => {
    expect(matchOptions("english (ENG); Spanish (SPA)", langs)).toEqual(["English (ENG)", "Spanish (SPA)"]);
  });

  it("refuses when any part matches nothing", () => {
    expect(matchOptions("English (ENG), Klingon", langs)).toBeNull();
  });
});

describe("planFill", () => {
  const field = (f: Partial<FormField> & Pick<FormField, "id" | "label">): FormField => ({ kind: "text", required: false, ...f });
  const sources = (answers: Record<string, string> = {}): FillSources => ({
    contact: { name: "Ana Ruiz", email: "ana@example.com", links: ["https://www.linkedin.com/in/ana", "https://ana.dev"] },
    currentCompany: "Acme",
    letterText: "Dear team,\n\nHello.",
    lookup: async (q) => answers[q] ?? null,
  });

  it("fills standard fields from the Profile, with links sorted by site", async () => {
    const plan = await planFill(
      [
        field({ id: "name", label: "Full name", standard: "name", required: true }),
        field({ id: "org", label: "Current company", standard: "currentCompany" }),
        field({ id: "li", label: "LinkedIn URL", standard: "linkedin" }),
        field({ id: "web", label: "Portfolio URL", standard: "website" }),
        field({ id: "gh", label: "GitHub URL", standard: "github" }),
        field({ id: "comments", label: "Additional information", kind: "textarea", standard: "coverLetterText" }),
      ],
      sources(),
    );
    expect(plan.fills.map((f) => [f.field.id, f.value.value, f.value.source])).toEqual([
      ["name", "Ana Ruiz", "profile"],
      ["org", "Acme", "profile"],
      ["li", "https://www.linkedin.com/in/ana", "profile"],
      ["web", "https://ana.dev", "profile"],
      ["comments", "Dear team,\n\nHello.", "document"],
    ]);
    expect(plan.skipped.map((f) => f.id)).toEqual(["gh"]);
  });

  it("asks the AnswerBank for a standard field the Profile lacks", async () => {
    const plan = await planFill([field({ id: "location", label: "Current location", standard: "location", required: true })], sources({ "Current location": "Lisbon" }));
    expect(plan.fills[0]!.value).toEqual({ value: "Lisbon", source: "answerBank" });
  });

  it("turns a required question with no answer, or an answer that fits no option, into an unknown", async () => {
    const plan = await planFill(
      [
        field({ id: "a", label: "Notice period?", required: true }),
        field({ id: "b", label: "Sponsorship?", kind: "choice", options: ["Yes", "No"], required: true }),
        field({ id: "c", label: "Pronouns", required: false }),
      ],
      sources({ "Sponsorship?": "Only for the US" }),
    );
    expect(plan.unknown.map((f) => f.id)).toEqual(["a", "b"]);
    expect(plan.skipped.map((f) => f.id)).toEqual(["c"]);
  });

  it("never uploads anything but the CV", async () => {
    const plan = await planFill(
      [
        field({ id: "resume", label: "Resume", kind: "file", standard: "resume", required: true }),
        field({ id: "other", label: "Transcript", kind: "file", required: true }),
      ],
      sources(),
    );
    expect(plan.uploads.map((f) => f.id)).toEqual(["resume"]);
    expect(plan.skipped.map((f) => f.id)).toEqual(["other"]);
    expect(plan.unknown).toEqual([]);
  });
});

describe("standardFromLabel", () => {
  it("knows link questions by their whole label", () => {
    expect(standardFromLabel("LinkedIn Profile")).toBe("linkedin");
    expect(standardFromLabel("Github URL")).toBe("github");
    expect(standardFromLabel("Website")).toBe("website");
    expect(standardFromLabel("Portfolio link")).toBe("website");
    expect(standardFromLabel("Current Company")).toBe("currentCompany");
  });

  it("leaves questions that only mention them", () => {
    expect(standardFromLabel("Why do you want to join LinkedIn?")).toBeUndefined();
    expect(standardFromLabel("Website you're most proud of building")).toBeUndefined();
  });
});

describe("planFill with split names and a country", () => {
  const sources: FillSources = {
    contact: { name: "Ana María Ruiz", email: "ana@example.com", location: "Madrid, Spain" },
    currentCompany: null,
    letterText: null,
    lookup: async () => null,
  };

  it("splits the name and picks the country from the location", async () => {
    const plan = await planFill(
      [
        { id: "first_name", label: "First Name", kind: "text", required: true, standard: "firstName" },
        { id: "last_name", label: "Last Name", kind: "text", required: true, standard: "lastName" },
        { id: "country", label: "Country", kind: "select", required: true, standard: "country", options: ["Portugal", "Spain"] },
      ],
      sources,
    );
    expect(plan.fills.map((f) => f.value.value)).toEqual(["Ana", "María Ruiz", "Spain"]);
    expect(plan.unknown).toEqual([]);
  });

  it("treats a one-word name's last name as unknown", async () => {
    const plan = await planFill([{ id: "last_name", label: "Last Name", kind: "text", required: true, standard: "lastName" }], {
      ...sources,
      contact: { ...sources.contact, name: "Ana" },
    });
    expect(plan.unknown.map((f) => f.id)).toEqual(["last_name"]);
  });
});
