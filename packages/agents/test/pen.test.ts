import { describe, expect, it } from "vitest";
import { ValidationError } from "@jobagent/core";
import type { Contact, ProfileFact } from "@jobagent/db";
import { cvFactIds, letterFactIds, parseDraft, schemaFor } from "../src/pen";
import { cvHtml, letterHtml } from "../src/templates";

const facts: ProfileFact[] = [
  { id: "r1", kind: "role", text: "Software Engineer", org: "Acme", startDate: "2019-03", endDate: "2023-01" },
  { id: "a1", kind: "achievement", text: "Cut build time by 40%", org: "Acme" },
  { id: "a2", kind: "achievement", text: "Wrote the TypeScript SDK", org: "Acme" },
  { id: "s1", kind: "skill", text: "TypeScript" },
  { id: "e1", kind: "education", text: "BSc Computer Science", org: "UPC" },
];
const contact: Contact = { name: "Ana <b>Ruiz</b>", email: "ana@example.com" };
const job = { company: "Globex 42", title: "Engineer" };

const output = (over: { bullet?: unknown; greeting?: string } = {}) => ({
  cv: {
    summary: { text: "Engineer who ships.", factIds: ["r1"] },
    experience: [{ roleFactId: "r1", bullets: [over.bullet ?? { text: "Cut build time by 40%.", factIds: ["a1"] }, { text: "Wrote the TypeScript SDK.", factIds: ["a2", "s1"] }] }],
    skills: [{ text: "TypeScript", factIds: ["s1"] }],
    otherFactIds: ["e1"],
  },
  coverLetter: {
    greeting: over.greeting ?? "Dear Globex 42 team,",
    paragraphs: [
      { text: "I build things.", factIds: ["r1", "r1"] },
      { text: "I write TypeScript.", factIds: ["s1"] },
      { text: "I studied computer science.", factIds: ["e1"] },
    ],
    closing: "Kind regards,",
  },
});

const withSummary = (text: string) => {
  const o = output();
  return { ...o, cv: { ...o.cv, summary: { text, factIds: ["r1"] } } };
};

describe("parseDraft", () => {
  it("keeps a draft whose claims all hold up", () => {
    const draft = parseDraft(output(), facts, job);
    expect(cvFactIds(draft.cv).sort()).toEqual(["a1", "a2", "e1", "r1", "s1"]);
    expect(letterFactIds(draft.coverLetter)).toEqual(["r1", "s1", "e1"]);
  });

  it("holds Claude to the whole CV: every role, achievement, skill and degree, each once", () => {
    const short = output();
    short.cv.experience[0]!.bullets.pop();
    expect(() => parseDraft(short, facts, job)).toThrow(/leaves out the achievement "Wrote the TypeScript SDK, Acme" \(a2\)/);
    expect(parseDraft(short, facts, job, "owner").cv.experience[0]!.bullets).toHaveLength(1);
    const twice = output();
    twice.cv.experience[0]!.bullets[1] = { text: "Made builds faster.", factIds: ["a1"] };
    expect(() => parseDraft(twice, facts, job)).toThrow(/bullet 2 repeats the achievement/);
    const extra = output();
    extra.cv.experience[0]!.bullets.push({ text: "Wrote TypeScript.", factIds: ["s1"] });
    expect(() => parseDraft(extra, facts, job)).toThrow(/bullet 3 must reword exactly one achievement/);
    const noSkills = output();
    noSkills.cv.skills = [];
    expect(() => parseDraft(noSkills, facts, job)).toThrow(/Skills leave out "TypeScript" \(s1\)/);
    const noDegree = output();
    noDegree.cv.otherFactIds = [];
    expect(() => parseDraft(noDegree, facts, job)).toThrow(/leave out "BSc Computer Science, UPC"/);
    const brief = output();
    brief.coverLetter.paragraphs.pop();
    expect(() => parseDraft(brief, facts, job)).toThrow(/paragraph count is 2; it must be 3 to 4/);
  });

  it("keeps each achievement under its own employer's role, and roles in date order", () => {
    const two: ProfileFact[] = [...facts, { id: "r0", kind: "role", text: "Developer", org: "Globex", startDate: "2015-01", endDate: "2019-02" }, { id: "a9", kind: "achievement", text: "Built billing", org: "Globex" }];
    const swapped = output();
    swapped.cv.experience.unshift({ roleFactId: "r0", bullets: [{ text: "Cut build time by 40%.", factIds: ["a1"] }] });
    swapped.cv.experience[1]!.bullets[0] = { text: "Built billing.", factIds: ["a9"] };
    expect(() => parseDraft(swapped, two, job)).toThrow(/puts the achievement "Cut build time by 40%, Acme" \(a1\) under "Developer, Globex"/);
    const older = output();
    older.cv.experience.unshift({ roleFactId: "r0", bullets: [{ text: "Built billing.", factIds: ["a9"] }] });
    expect(parseDraft(older, two, job).cv.experience.map((e) => e.roleFactId)).toEqual(["r1", "r0"]);
    const missing = output();
    expect(() => parseDraft(missing, two, job)).toThrow(/leaves out the role "Developer, Globex" \(r0\)/);
    // An achievement at no employer the CV lists may go anywhere, or nowhere.
    const loose: ProfileFact[] = [...facts, { id: "a5", kind: "achievement", text: "Ran a meetup" }];
    expect(() => parseDraft(output(), loose, job)).not.toThrow();
  });

  it("rejects a role listed twice, and other facts that don't exist or aren't education, certificates or languages", () => {
    const twice = output();
    twice.cv.experience.push({ ...twice.cv.experience[0]! });
    expect(() => parseDraft(twice, facts, job)).toThrow(/repeats the role "r1"/);
    expect(() => parseDraft(twice, facts, job, "owner")).toThrow(/repeats the role/);
    const made = output();
    made.cv.otherFactIds = ["e1", "f-language-ukrainian-placeholder"];
    expect(() => parseDraft(made, facts, job)).toThrow(/unknown fact "f-language-ukrainian-placeholder"/);
    const skill = output();
    skill.cv.otherFactIds = ["s1"];
    expect(() => parseDraft(skill, facts, job)).toThrow(/not the skill "s1"/);
  });

  it("rejects unknown, missing and misplaced citations", () => {
    expect(() => parseDraft(output({ bullet: { text: "Led a team.", factIds: ["nope"] } }), facts, job)).toThrow(/unknown fact "nope"/);
    expect(() => parseDraft(output({ bullet: { text: "Led a team.", factIds: [] } }), facts, job)).toThrow(/cites no facts/);
    const skillAsRole = output();
    skillAsRole.cv.experience[0]!.roleFactId = "s1";
    expect(() => parseDraft(skillAsRole, facts, job)).toThrow(/must point at a role/);
  });

  it("rejects a number none of the cited facts state", () => {
    expect(() => parseDraft(output({ bullet: { text: "Cut build time by 60%.", factIds: ["a1"] } }), facts, job)).toThrow(/says "60"/);
    expect(() => parseDraft(output({ bullet: { text: "Cut build time by 40%.", factIds: ["s1"] } }), facts, job)).toThrow(/says "40"/);
    expect(() => parseDraft(output({ greeting: "After 10 years, hello," }), facts, job)).toThrow(/says "10"/);
  });

  it("doesn't take a number from inside a cited date", () => {
    // r1 runs 2019-03 to 2023-01: "3" and "19" are pieces of those dates, not facts.
    expect(() => parseDraft(output({ bullet: { text: "Led 3 teams.", factIds: ["r1"] } }), facts, job)).toThrow(/says "3"/);
    expect(() => parseDraft(output({ bullet: { text: "Shipped 19 releases.", factIds: ["r1"] } }), facts, job)).toThrow(/says "19"/);
    expect(parseDraft(output({ bullet: { text: "At Acme since 2019.", factIds: ["a1", "r1"] } }), facts, job).cv.experience[0]!.bullets[0]!.text).toBe("At Acme since 2019.");
  });

  it("lets the owner write uncited text and numbers, but not cite facts that don't exist", () => {
    const edited = output({ bullet: { text: "Cut build time by 60%.", factIds: [] } });
    edited.coverLetter.paragraphs.push({ text: "  ", factIds: [] });
    const draft = parseDraft(edited, facts, job, "owner");
    expect(draft.cv.experience[0]!.bullets[0]).toEqual({ text: "Cut build time by 60%.", factIds: [] });
    expect(draft.coverLetter.paragraphs).toHaveLength(3); // the emptied paragraph is dropped
    expect(() => parseDraft(output({ bullet: { text: "Led a team.", factIds: ["nope"] } }), facts, job, "owner")).toThrow(/unknown fact/);
  });

  it("doesn't let Claude give the owner a level no fact states, though it may name the job", () => {
    expect(() => parseDraft(withSummary("Senior engineer who ships."), facts, job)).toThrow(/summary calls the owner "Senior"/);
    const naming = output();
    naming.coverLetter.paragraphs[0] = { text: "I'm applying for the Senior Engineer role.", factIds: ["r1"] };
    expect(() => parseDraft(naming, facts, { ...job, title: "Senior Engineer" })).not.toThrow();
    // A title the owner held is a fact; a level mentioned elsewhere in a fact is not a title.
    const lead: ProfileFact[] = facts.map((f) => (f.id === "r1" ? { ...f, text: "Lead Developer" } : f));
    expect(() => parseDraft(withSummary("Lead developer who ships."), lead, job)).not.toThrow();
    const mentor: ProfileFact[] = [...facts, { id: "a3", kind: "achievement", text: "Mentored senior engineers" }];
    expect(() => parseDraft(withSummary("Senior engineer who ships."), mentor, job)).toThrow(/calls the owner "Senior"/);
  });

  it("lists the real fact IDs in Claude's answer format, so Claude picks them instead of writing them out", () => {
    const { cv, coverLetter } = schemaFor(facts).properties;
    const role = cv.properties.experience.items.properties;
    expect(role.roleFactId).toEqual({ type: "string", enum: ["r1"] });
    expect(role.bullets.items.properties.factIds.items).toEqual({ type: "string", enum: ["r1", "a1", "a2", "s1", "e1"] });
    expect(cv.properties.otherFactIds.items).toEqual({ type: "string", enum: ["e1"] });
    expect(coverLetter.properties.paragraphs.items.properties.factIds.items.enum).toHaveLength(5);
    // With no facts of a kind there is nothing to list, and the code check still applies.
    expect(schemaFor([]).properties.cv.properties.otherFactIds.items).toEqual({ type: "string" });
  });

  it("rejects an answer with a document missing", () => {
    expect(() => parseDraft({ cv: output().cv }, facts, job)).toThrow(ValidationError);
    expect(() => parseDraft(null, facts, job)).toThrow(ValidationError);
  });
});

describe("templates", () => {
  const draft = parseDraft(output({ bullet: { text: "Cut <script>alert(40)</script> build time", factIds: ["a1"] } }), facts, job);

  it("takes the role's title, employer and dates from the Profile", () => {
    const html = cvHtml(draft.cv, contact, facts);
    expect(html).toContain("Software Engineer, Acme");
    expect(html).toContain("2019-03 – 2023-01");
    expect(html).toContain("BSc Computer Science, UPC");
  });

  it("escapes everything that isn't template", () => {
    expect(cvHtml(draft.cv, contact, facts)).not.toContain("<script>");
    expect(letterHtml(draft.coverLetter, contact)).not.toContain("<b>");
  });
});
