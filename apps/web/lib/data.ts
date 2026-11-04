import "server-only";
import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { answerRule, DEFAULT_HINTS, encryptionKeyFromEnv, maskKey, type AnswerRule } from "@jobagent/core";
import { agentRun, answerBank, application, blocker, discoveredCompany, job, preferences, profile, settings, type Contact, type ProfileFact } from "@jobagent/db";
import { getDb } from "./server";

export async function loadProfile() {
  const [p] = await getDb().select().from(profile).limit(1);
  return p ?? null;
}

export async function loadPreferences() {
  const [p] = await getDb().select().from(preferences).limit(1);
  return p ?? null;
}

/** Companies Claude found by searching the web, the ones with a readable board first. */
export async function loadDiscoveredCompanies() {
  return getDb()
    .select({ id: discoveredCompany.id, name: discoveredCompany.name, reason: discoveredCompany.reason, hasBoard: sql<boolean>`${discoveredCompany.boardToken} is not null` })
    .from(discoveredCompany)
    .where(eq(discoveredCompany.removed, false))
    .orderBy(sql`${discoveredCompany.boardToken} is null`, asc(discoveredCompany.name));
}

/** Everything the UI may know about Settings. The encrypted key and the key itself never leave the server. */
export async function loadSettingsView() {
  const [s] = await getDb().select().from(settings).limit(1);
  const provider = s?.aiProvider === "cli" ? ("cli" as const) : ("api" as const);
  const hasKey = !!s?.encryptedApiKey;
  return {
    provider,
    hasKey,
    maskedKey: maskKey(s?.apiKeyLast4),
    defaultModel: s?.defaultModel ?? "",
    gmailConnected: !!s?.encryptedGmailToken,
    /** Can an agent call Claude right now? */
    ready: provider === "cli" || hasKey,
  };
}

/** Is APP_ENCRYPTION_KEY set, so an API key can be stored? */
export function encryptionReady(): boolean {
  try {
    encryptionKeyFromEnv();
    return true;
  } catch {
    return false;
  }
}

/** When the worker last beat, or null if it never has. */
export async function loadWorkerLastSeen(): Promise<Date | null> {
  const [s] = await getDb().select({ at: settings.workerLastSeenAt }).from(settings).limit(1);
  return s?.at ?? null;
}

export type AnswerRow = {
  id: string;
  question: string;
  answer: string;
  kind: "text" | "choice" | "number" | "date" | "consent";
  hint: string | null;
  isDefault: boolean;
  rule: AnswerRule;
};

export async function loadAnswers(): Promise<AnswerRow[]> {
  // Job-only answers (reusable = false) belong to a single application and show up on its card instead.
  const rows = await getDb()
    .select()
    .from(answerBank)
    .where(eq(answerBank.reusable, true))
    .orderBy(asc(answerBank.createdAt), asc(answerBank.questionKey));
  return rows.map((r) => ({
    id: r.id,
    question: r.questionVariants[0] ?? r.questionKey,
    answer: r.answer,
    kind: r.kind,
    hint: DEFAULT_HINTS[r.questionKey] ?? null,
    isDefault: Object.hasOwn(DEFAULT_HINTS, r.questionKey),
    rule: answerRule(r.questionKey, r.kind),
  }));
}

export async function loadOpenBlockers() {
  return getDb()
    .select({
      id: blocker.id,
      question: blocker.question,
      label: blocker.fieldContext,
      company: job.company,
      title: job.title,
    })
    .from(blocker)
    .innerJoin(application, eq(application.id, blocker.applicationId))
    .innerJoin(job, eq(job.id, application.jobId))
    .where(and(isNull(blocker.answeredAt), ne(application.status, "archived")))
    .orderBy(desc(blocker.createdAt))
    .then((rows) => rows.map((r) => ({ ...r, label: r.label.label })));
}

/** The latest CV extraction run, for the Profile page. */
export async function loadLatestExtraction() {
  const [run] = await getDb()
    .select()
    .from(agentRun)
    .where(eq(agentRun.role, "extractor"))
    .orderBy(desc(agentRun.createdAt))
    .limit(1);
  if (!run) return null;
  return {
    id: run.id,
    status: run.status,
    fileName: (run.input as { fileName?: string } | null)?.fileName ?? "CV",
    error: run.error,
    lastLog: run.logs.at(-1)?.message ?? null,
    output: run.status === "succeeded" ? (run.output as unknown as ExtractionOutput) : null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}

export interface ExtractionOutput {
  contact: Contact;
  facts: ProfileFact[];
  sourceFile: string;
}

interface SetupStatus {
  key: boolean;
  profile: "none" | "draft" | "confirmed";
  factCount: number;
  preferences: boolean;
  answered: number;
  answerTotal: number;
}

/** Connecting Claude, a confirmed Profile and criteria are required; Search can run without Answers. */
export function setupProgress(s: SetupStatus) {
  const required = [s.key, s.profile === "confirmed", s.preferences];
  const done = required.filter(Boolean).length;
  return { done, total: required.length, ready: done === required.length, started: s.profile !== "none" || s.preferences };
}

export async function loadSetupStatus(): Promise<SetupStatus> {
  const [settingsView, p, prefs, answers] = await Promise.all([
    loadSettingsView(),
    loadProfile(),
    loadPreferences(),
    loadAnswers(),
  ]);
  return {
    key: settingsView.ready,
    profile: !p ? "none" : p.confirmed ? "confirmed" : "draft",
    factCount: p?.facts.length ?? 0,
    preferences: !!prefs && (prefs.roles.length > 0 || prefs.locations.length > 0 || prefs.stackMustHave.length > 0 || prefs.companyBoards.length > 0),
    answered: answers.filter((a) => a.answer.trim() !== "").length,
    answerTotal: answers.length,
  };
}
