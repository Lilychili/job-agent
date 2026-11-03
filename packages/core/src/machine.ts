// The transition table from docs/STATE_MACHINE.md. Pure data + pure lookups:
// no DB, so it can be tested exhaustively and imported by the UI.
import type { ApplicationStatus } from "@jobagent/db";

export const STATUSES = [
  "found",
  "shortlisted",
  "crafting",
  "drafted",
  "crafted",
  "approved",
  "applying",
  "awaiting_submit",
  "applied",
  "replied",
  "interview",
  "rejected",
  "withdrawn",
  "archived",
] as const satisfies readonly ApplicationStatus[];

export type Status = (typeof STATUSES)[number];

/** Queue names. Each one is handled by a worker consumer. */
export const JOBS = {
  extractorExtract: "extractor.extract",
  scoutSearch: "scout.search",
  scoutRescore: "scout.rescore",
  penCraft: "pen.craft",
  shipperLocate: "shipper.locate",
  shipperPrefill: "shipper.prefill",
  shipperResume: "shipper.resume",
  shipperCaptureEvidence: "shipper.captureEvidence",
  heartbeat: "system.heartbeat",
} as const;
export type JobName = (typeof JOBS)[keyof typeof JOBS];

export type GuardName =
  | "profileConfirmed"
  | "hasDraftDocuments"
  | "approvedDocsIntact"
  | "noSubmissionEvidence"
  | "noOpenBlockers";

export type Effect = "archiveJob" | "cancelRuns" | "supersedeLocate" | "lockDocuments" | "unlockDocuments" | "recordSubmission" | "setError" | "clearError";

export interface Rule {
  from: readonly Status[];
  /** "previous" = the status the card was in before the agent started (failure rollback). */
  to: Status | "previous";
  actor: "owner" | "system";
  label: string;
  queue?: { name: JobName; role: "pen" | "shipper" };
  guards?: readonly GuardName[];
  effects?: readonly Effect[];
}

export const RULES = {
  // ── Owner gates ────────────────────────────────────────────────────────
  shortlist: { from: ["found"], to: "shortlisted", actor: "owner", label: "Shortlist" },
  // Dismiss means "not this one" in Found and Shortlisted, and "one step back" from Crafted and Approved.
  dismiss: {
    from: ["found", "shortlisted", "crafting", "drafted", "applying", "awaiting_submit"],
    to: "archived",
    actor: "owner",
    label: "Dismiss",
    effects: ["cancelRuns", "archiveJob"],
  },
  unCraft: { from: ["crafted"], to: "shortlisted", actor: "owner", label: "Dismiss" },
  unApprove: {
    from: ["approved"],
    to: "crafted",
    actor: "owner",
    label: "Dismiss",
    // The approved versions stay as they are; the next Approve locks whatever is newest then.
    effects: ["supersedeLocate", "unlockDocuments"],
  },
  craft: {
    from: ["shortlisted"],
    to: "crafting",
    actor: "owner",
    label: "Craft",
    queue: { name: JOBS.penCraft, role: "pen" },
    guards: ["profileConfirmed"],
    effects: ["clearError"],
  },
  // Drafts from before Craft went straight to Crafted: approving one in the Craft modal saves it.
  keepDraft: {
    from: ["drafted"],
    to: "crafted",
    actor: "owner",
    label: "Approve",
    guards: ["hasDraftDocuments"],
  },
  // "Ask Claude again" in the Craft modal.
  regenerate: {
    from: ["drafted", "crafted"],
    to: "crafting",
    actor: "owner",
    label: "Regenerate",
    queue: { name: JOBS.penCraft, role: "pen" },
    guards: ["profileConfirmed"],
    effects: ["supersedeLocate", "clearError"],
  },
  approve: {
    from: ["crafted"],
    to: "approved",
    actor: "owner",
    label: "Approve",
    // Finds the job's application form in the background, so the card shows it before Apply.
    queue: { name: JOBS.shipperLocate, role: "shipper" },
    guards: ["hasDraftDocuments"],
    effects: ["lockDocuments"],
  },
  apply: {
    from: ["approved"],
    to: "applying",
    actor: "owner",
    label: "Apply",
    queue: { name: JOBS.shipperPrefill, role: "shipper" },
    guards: ["approvedDocsIntact", "noSubmissionEvidence"],
    // Prefill looks for the form itself if the search started by Approve hasn't finished.
    effects: ["supersedeLocate", "clearError"],
  },
  // Triggered by answering the last open Blocker (not a button on the card).
  resume: {
    from: ["applying"],
    to: "applying",
    actor: "owner",
    label: "Resume",
    queue: { name: JOBS.shipperResume, role: "shipper" },
    guards: ["noOpenBlockers", "approvedDocsIntact", "noSubmissionEvidence"],
  },
  markApplied: {
    from: ["awaiting_submit"],
    to: "applied",
    actor: "owner",
    label: "Mark applied",
    queue: { name: JOBS.shipperCaptureEvidence, role: "shipper" },
    guards: ["noSubmissionEvidence"],
    effects: ["recordSubmission"],
  },
  markReplied: { from: ["applied"], to: "replied", actor: "owner", label: "Replied" },
  markInterview: { from: ["applied", "replied"], to: "interview", actor: "owner", label: "Interview" },
  markRejected: {
    from: ["applied", "replied", "interview"],
    to: "rejected",
    actor: "owner",
    label: "Rejected",
  },
  withdraw: {
    from: ["applied", "replied", "interview"],
    to: "withdrawn",
    actor: "owner",
    label: "Withdraw",
  },

  // ── System outcomes of agent runs ───────────────────────────────────────
  craftSucceeded: { from: ["crafting"], to: "crafted", actor: "system", label: "Draft ready" },
  craftFailed: {
    from: ["crafting"],
    to: "previous",
    actor: "system",
    label: "Craft failed",
    effects: ["setError"],
  },
  prefillDone: { from: ["applying"], to: "awaiting_submit", actor: "system", label: "Prefill done" },
  prefillFailed: {
    from: ["applying"],
    to: "approved",
    actor: "system",
    label: "Prefill failed",
    effects: ["setError"],
  },
} as const satisfies Record<string, Rule>;

export type Action = keyof typeof RULES;
export const ACTIONS = Object.keys(RULES) as Action[];

export function getRule(action: string): Rule | undefined {
  return Object.hasOwn(RULES, action) ? (RULES as Record<string, Rule>)[action] : undefined;
}

/** Actions with no button on the card: the Blockers UI drives `resume`, the Craft modal `keepDraft` and `regenerate`. */
const OFF_CARD: readonly Action[] = ["resume", "keepDraft", "regenerate"];

/** Owner actions to render as buttons for a card. */
export function ownerActions(status: Status): Action[] {
  return ACTIONS.filter((a) => {
    const r: Rule = RULES[a];
    return r.actor === "owner" && !OFF_CARD.includes(a) && r.from.includes(status);
  });
}

/** Statuses whose card shows the approved CV and cover letter as pills. */
export const SHOWS_APPROVED_DOCUMENTS: readonly Status[] = ["approved", "applying", "awaiting_submit", "applied", "replied", "interview", "rejected"];

/** Statuses whose documents the owner may still edit. Approved documents are locked. */
export const EDITABLE_DOCUMENTS: readonly Status[] = ["drafted", "crafted"];

export const COLUMNS = [
  { id: "found", title: "Found" },
  { id: "shortlisted", title: "Shortlisted" },
  { id: "crafted", title: "Crafted" },
  { id: "approved", title: "Approved" },
  { id: "applied", title: "Applied" },
  { id: "replied", title: "Replied" },
  { id: "interview", title: "Interview" },
  { id: "rejected", title: "Rejected" },
] as const;
export type ColumnId = (typeof COLUMNS)[number]["id"];

/**
 * Which column a card sits in. Crafting, and the draft it ends in, stay in the column the card was in
 * before crafting (`previous`); Approved also holds "Ready to submit" cards (Apply v1). Hidden:
 * archived, withdrawn.
 */
export function columnFor(status: Status, previous?: Status | null): ColumnId | null {
  switch (status) {
    case "crafting":
    case "drafted":
      return previous === "crafted" || previous === "approved" ? previous : "shortlisted";
    case "applying":
    case "awaiting_submit":
      return "approved";
    case "archived":
    case "withdrawn":
      return null;
    default:
      return status;
  }
}

/** Runs that have not finished: one waiting its turn, one working, one paused on a Blocker. */
export const ACTIVE_RUN_STATUSES = ["queued", "running", "paused"] as const;
/** Runs a worker is, or is about to be, busy with. A paused run is waiting on the owner. */
export const BUSY_RUN_STATUSES = ["queued", "running"] as const;
