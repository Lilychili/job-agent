// Schema for every table in docs/DATA_MODEL.md.
// Column names are camelCase here and snake_case in Postgres (casing: "snake_case").
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ─── Enums ──────────────────────────────────────────────────────────────────

/** Every status in docs/STATE_MACHINE.md. The kanban column is derived from this. */
export const applicationStatus = pgEnum("application_status", [
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
]);

export const ats = pgEnum("ats", ["greenhouse", "lever", "ashby", "other"]); // other: added by hand from anywhere else
export const remotePreference = pgEnum("remote_preference", ["onsite", "hybrid", "remote", "any"]);
export const jobRemote = pgEnum("job_remote", ["onsite", "hybrid", "remote", "unknown"]);
export const answerKind = pgEnum("answer_kind", ["text", "choice", "number", "date", "consent"]);
export const documentKind = pgEnum("document_kind", ["cv", "cover_letter"]);
export const agentRole = pgEnum("agent_role", ["extractor", "scout", "pen", "shipper"]);
export const runStatus = pgEnum("run_status", [
  "queued",
  "running",
  "paused",
  "succeeded",
  "failed",
  // A paused Shipper run is closed as superseded when its resume run starts.
  "superseded",
]);
export const evidenceType = pgEnum("evidence_type", [
  "prefill_screenshot",
  "submission",
  "confirmation_text",
  "email",
]);
export const actorType = pgEnum("actor_type", ["owner", "system", "agent"]);

// ─── Shared columns ─────────────────────────────────────────────────────────

const base = {
  id: uuid().primaryKey().defaultRandom(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// ─── JSON shapes ────────────────────────────────────────────────────────────

export type FactKind = "role" | "skill" | "education" | "achievement" | "cert" | "language";
export interface ProfileFact {
  id: string; // stable, so Pen can cite it
  kind: FactKind;
  text: string;
  org?: string;
  startDate?: string;
  endDate?: string;
}
export interface Contact {
  name: string;
  email: string;
  phone?: string;
  location?: string;
  links?: string[];
}
/** A piece of a document and the Profile facts it relies on. */
export interface CitedText {
  text: string;
  factIds: string[];
}
export interface CvContent {
  summary: CitedText;
  experience: { roleFactId: string; bullets: CitedText[] }[];
  skills: CitedText[];
  otherFactIds: string[];
}
export interface LetterContent {
  greeting: string;
  paragraphs: CitedText[];
  closing: string;
}
export interface MatchReasons {
  met: string[];
  missed: string[];
  hardFail?: string;
}
/** A core requirement of a posting, and the Profile facts that meet it (none when no fact does). */
export interface JobRequirement {
  text: string;
  factIds: string[];
  /** When no fact meets it: the facts showing the nearest real experience, e.g. MySQL for "Postgres". */
  closest?: string[];
}
export interface FieldContext {
  label: string;
  type: string;
  options?: string[];
}
export interface RunLogEntry {
  at: string;
  level: "info" | "warn" | "error";
  message: string;
}

// ─── Tables ─────────────────────────────────────────────────────────────────

export const profile = pgTable("profile", {
  ...base,
  sourceFilePath: text(),
  confirmed: boolean().notNull().default(false),
  contact: jsonb().$type<Contact>().notNull(),
  facts: jsonb().$type<ProfileFact[]>().notNull().default([]),
  version: integer().notNull().default(1),
});

export const preferences = pgTable("preferences", {
  ...base,
  // The job titles the owner wants, e.g. "Senior Frontend Engineer". Search looks for these first.
  roles: text().array().notNull().default(sql`'{}'::text[]`),
  locations: text().array().notNull().default(sql`'{}'::text[]`),
  remote: remotePreference().notNull().default("any"),
  salaryFloor: integer(),
  salaryCurrency: text(),
  stackMustHave: text().array().notNull().default(sql`'{}'::text[]`),
  stackNiceToHave: text().array().notNull().default(sql`'{}'::text[]`),
  exclusions: jsonb()
    .$type<{ companies: string[]; keywords: string[]; seniority: string[] }>()
    .notNull()
    .default({ companies: [], keywords: [], seniority: [] }),
  companyBoards: jsonb()
    .$type<{ ats: "greenhouse" | "lever" | "ashby"; boardToken: string }[]>()
    .notNull()
    .default([]),
});

/**
 * Companies Claude found by searching the web. Search only reads the ones with a verified board.
 * `ats` and `boardToken` stay null when no Greenhouse, Lever or Ashby board has it; `checkedAt` then
 * decides when to look again. `removed` keeps a company the owner dismissed from coming back.
 */
export const discoveredCompany = pgTable(
  "discovered_company",
  {
    ...base,
    name: text().notNull(),
    nameNorm: text().notNull(),
    ats: ats(),
    boardToken: text(),
    reason: text().notNull().default(""),
    checkedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    removed: boolean().notNull().default(false),
  },
  (t) => [uniqueIndex("discovered_company_name_uq").on(t.nameNorm)],
);

/**
 * Postings Scout scored below the cut-off. Only their link is kept, so a later search doesn't pay to
 * score them again. They never reach the board.
 */
export const rejectedPosting = pgTable("rejected_posting", {
  ...base,
  canonicalUrl: text().notNull().unique(),
  matchScore: integer().notNull(),
  // A hash of the Preferences it was scored against: new Preferences mean a new look.
  criteriaKey: text().notNull().default(""),
});

export const answerBank = pgTable("answer_bank", {
  ...base,
  questionKey: text().notNull().unique(),
  questionVariants: text().array().notNull().default(sql`'{}'::text[]`),
  answer: text().notNull(),
  kind: answerKind().notNull().default("text"),
  // false = applies to one application only; its questionKey ends in "@<applicationId>".
  reusable: boolean().notNull().default(true),
});

export const job = pgTable(
  "job",
  {
    ...base,
    ats: ats().notNull(),
    sourceUrl: text().notNull(),
    canonicalUrl: text().notNull(),
    company: text().notNull(),
    companyNorm: text().notNull(),
    title: text().notNull(),
    titleNorm: text().notNull(),
    location: text(),
    remote: jobRemote().notNull().default("unknown"),
    salary: text().notNull().default("not stated"),
    source: text(), // set when an alert brought the job in, e.g. "indeed_alert"
    companyUrl: text(), // the company's job board, when sourceUrl can't point at the company
    rawPosting: text().notNull().default(""),
    matchScore: integer(),
    matchReasons: jsonb().$type<MatchReasons>(),
    // Null for jobs found before Search read requirements; Pen reads them then.
    requirements: jsonb().$type<JobRequirement[]>(),
    // The Profile version the requirements were matched against. Pen matches them again after a change.
    requirementsProfileVersion: integer(),
    archived: boolean().notNull().default(false),
  },
  (t) => [
    // Dedupe rule 1: canonical URL is globally unique (archived jobs never come back).
    uniqueIndex("job_canonical_url_uq").on(t.canonicalUrl),
    // Dedupe rule 2: same normalized company + title among live jobs.
    uniqueIndex("job_company_title_live_uq")
      .on(t.companyNorm, t.titleNorm)
      .where(sql`archived = false`),
  ],
);

export const application = pgTable(
  "application",
  {
    ...base,
    jobId: uuid()
      .notNull()
      .unique()
      .references(() => job.id, { onDelete: "cascade" }),
    status: applicationStatus().notNull().default("found"),
    approvedCvDocId: uuid(),
    approvedLetterDocId: uuid(),
    hasOpenBlocker: boolean().notNull().default(false),
    lastError: text(),
  },
  (t) => [index("application_status_idx").on(t.status)],
);

export const agentRun = pgTable(
  "agent_run",
  {
    ...base,
    role: agentRole().notNull(),
    jobName: text().notNull(), // queue name, e.g. "pen.craft"
    applicationId: uuid().references(() => application.id, { onDelete: "cascade" }),
    parentRunId: uuid(), // set on a resume run
    status: runStatus().notNull().default("queued"),
    promptVersion: text(),
    model: text(),
    input: jsonb().$type<Record<string, unknown>>(),
    output: jsonb().$type<Record<string, unknown>>(),
    checkpoint: jsonb().$type<Record<string, unknown>>(),
    logs: jsonb().$type<RunLogEntry[]>().notNull().default([]),
    inputTokens: integer().notNull().default(0),
    outputTokens: integer().notNull().default(0),
    cacheReadTokens: integer().notNull().default(0),
    cacheWriteTokens: integer().notNull().default(0),
    error: text(),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    // Guard: one active run per application.
    uniqueIndex("agent_run_one_active_per_application_uq")
      .on(t.applicationId)
      .where(sql`status in ('queued', 'running', 'paused') and application_id is not null`),
    index("agent_run_application_idx").on(t.applicationId),
  ],
);

export const applicationEvent = pgTable(
  "application_event",
  {
    id: uuid().primaryKey().defaultRandom(),
    applicationId: uuid()
      .notNull()
      .references(() => application.id, { onDelete: "cascade" }),
    action: text().notNull(),
    fromStatus: applicationStatus(),
    toStatus: applicationStatus().notNull(),
    actorType: actorType().notNull(),
    agentRunId: uuid(),
    note: text(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("application_event_application_idx").on(t.applicationId, t.at)],
);

export const document = pgTable(
  "document",
  {
    ...base,
    applicationId: uuid()
      .notNull()
      .references(() => application.id, { onDelete: "cascade" }),
    kind: documentKind().notNull(),
    version: integer().notNull(),
    htmlSource: text().notNull(),
    // What the document says and which facts back it, for the review screen.
    content: jsonb().$type<CvContent | LetterContent>(),
    pdfPath: text().notNull(),
    sha256: text().notNull(),
    factIds: text().array().notNull().default(sql`'{}'::text[]`),
    profileVersion: integer().notNull(),
    agentRunId: uuid(),
    approvedAt: timestamp({ withTimezone: true }),
  },
  (t) => [uniqueIndex("document_app_kind_version_uq").on(t.applicationId, t.kind, t.version)],
);

export const evidence = pgTable(
  "evidence",
  {
    ...base,
    applicationId: uuid()
      .notNull()
      .references(() => application.id, { onDelete: "cascade" }),
    agentRunId: uuid(),
    type: evidenceType().notNull(),
    filePath: text(),
    text: text(),
    capturedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("evidence_application_type_idx").on(t.applicationId, t.type)],
);

export const blocker = pgTable(
  "blocker",
  {
    ...base,
    applicationId: uuid()
      .notNull()
      .references(() => application.id, { onDelete: "cascade" }),
    agentRunId: uuid().notNull(),
    question: text().notNull(),
    questionKey: text().notNull(),
    fieldContext: jsonb().$type<FieldContext>().notNull(),
    answer: text(),
    answeredAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index("blocker_open_idx").on(t.applicationId).where(sql`answered_at is null`),
  ],
);

export const settings = pgTable("settings", {
  ...base,
  // "api" = pay-per-use Claude API key; "cli" = the owner's signed-in Claude Code CLI (their subscription).
  aiProvider: text().notNull().default("api"),
  encryptedApiKey: text(),
  apiKeyLast4: text(),
  // A Google refresh token for reading job alerts. Never leaves the server.
  encryptedGmailToken: text(),
  defaultModel: text(),
  workerLastSeenAt: timestamp({ withTimezone: true }),
});

export type ApplicationStatus = (typeof applicationStatus.enumValues)[number];
