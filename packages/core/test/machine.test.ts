import { describe, expect, it } from "vitest";
import { ACTIONS, columnFor, getRule, isLegal, ownerActions, RULES, STATUSES, type Status } from "../src/machine";

// Written out by hand from docs/STATE_MACHINE.md, independently of RULES,
// so a typo in the table shows up as a failing test rather than a silent change.
const EXPECTED_LEGAL: Record<string, Status[]> = {
  shortlist: ["found"],
  dismiss: ["found", "shortlisted", "crafted", "approved", "awaiting_submit"],
  craft: ["shortlisted"],
  regenerate: ["crafted"],
  approve: ["crafted"],
  apply: ["approved"],
  resume: ["applying"],
  markApplied: ["awaiting_submit"],
  markReplied: ["applied"],
  markInterview: ["applied", "replied"],
  markRejected: ["applied", "replied", "interview"],
  withdraw: ["applied", "replied", "interview"],
  craftSucceeded: ["crafting"],
  craftFailed: ["crafting"],
  prefillDone: ["applying"],
  prefillFailed: ["applying"],
};

describe("transition table", () => {
  it("has exactly the expected actions", () => {
    expect([...ACTIONS].sort()).toEqual(Object.keys(EXPECTED_LEGAL).sort());
  });

  // Every (status, action) pair: 13 statuses × 16 actions.
  for (const status of STATUSES) {
    for (const action of ACTIONS) {
      const legal = EXPECTED_LEGAL[action]!.includes(status);
      it(`${legal ? "allows" : "rejects"} ${action} from ${status}`, () => {
        expect(isLegal(status, action)).toBe(legal);
      });
    }
  }

  it("rejects unknown actions and prototype keys", () => {
    expect(isLegal("found", "teleport")).toBe(false);
    expect(isLegal("found", "toString")).toBe(false);
    expect(getRule("__proto__")).toBeUndefined();
  });

  it("has no transitions out of terminal states except via the listed outcomes", () => {
    for (const terminal of ["rejected", "withdrawn", "archived"] as Status[]) {
      expect(ACTIONS.filter((a) => isLegal(terminal, a))).toEqual([]);
    }
  });

  it("only system actions leave transient states, except resume", () => {
    for (const a of ACTIONS) {
      const r = RULES[a];
      if (r.from.some((s: Status) => s === "crafting")) expect(r.actor).toBe("system");
      if (r.from.some((s: Status) => s === "applying") && a !== "resume") expect(r.actor).toBe("system");
    }
  });

  it("queues a job for exactly the agent-starting actions", () => {
    const queued = ACTIONS.filter((a) => "queue" in RULES[a]).sort();
    expect(queued).toEqual(["apply", "craft", "markApplied", "regenerate", "resume"]);
  });

  it("guards the gates from the spec", () => {
    expect(RULES.craft.guards).toContain("profileConfirmed");
    expect(RULES.apply.guards).toEqual(expect.arrayContaining(["approvedDocsIntact", "noSubmissionEvidence"]));
    expect(RULES.resume.guards).toContain("noSubmissionEvidence");
    expect(RULES.markApplied.guards).toContain("noSubmissionEvidence");
  });
});

describe("board helpers", () => {
  it("ownerActions never offers system actions or resume", () => {
    for (const s of STATUSES) {
      for (const a of ownerActions(s)) {
        expect(RULES[a].actor).toBe("owner");
        expect(a).not.toBe("resume");
      }
    }
    expect(ownerActions("found")).toEqual(["shortlist", "dismiss"]);
    expect(ownerActions("crafting")).toEqual([]);
  });

  it("puts transient states in their predecessor's column", () => {
    expect(columnFor("crafting", "shortlisted")).toBe("shortlisted");
    expect(columnFor("crafting", "crafted")).toBe("crafted");
    expect(columnFor("applying")).toBe("approved");
    expect(columnFor("awaiting_submit")).toBe("approved");
    expect(columnFor("archived")).toBeNull();
    expect(columnFor("withdrawn")).toBeNull();
    expect(columnFor("interview")).toBe("interview");
  });
});
