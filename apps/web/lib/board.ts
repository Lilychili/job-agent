import "server-only";
import { and, desc, eq, getTableColumns, inArray, isNotNull, isNull, ne, notInArray } from "drizzle-orm";
import { requirementFacts } from "@jobagent/agents/citations";
import { ACTIVE_RUN_STATUSES, columnFor, ownerActions, RULES, type Action, type ColumnId, type Status } from "@jobagent/core";
import { agentRun, application, applicationEvent, blocker, document, job, profile, settings } from "@jobagent/db";
import { getDb } from "./server";

export interface BoardCard {
  id: string;
  status: Status;
  column: ColumnId;
  company: string;
  title: string;
  location: string | null;
  remote: string;
  salary: string;
  sourceUrl: string;
  companyUrl: string | null;
  alertSite: "Indeed" | "LinkedIn" | null;
  matchScore: number | null;
  matchReasons: { met: string[]; missed: string[] } | null;
  /** The job's core requirements, and whether a Profile fact meets each. Null for jobs found before Search read them. */
  requirements: { text: string; met: boolean }[] | null;
  lastError: string | null;
  working: boolean;
  runLog: string | null;
  actions: { action: Action; label: string }[];
  blockers: { id: string; question: string; label: string }[];
  /** Saved documents exist, so the card shows a PDF pill. */
  hasDocuments: boolean;
  updatedAt: string;
}

export interface BoardData {
  cards: BoardCard[];
  searchRunning: boolean;
  lastSearch: { ok: boolean; message: string } | null;
  workerLastSeenAt: string | null;
}

function describeSearch(run: { status: string; error: string | null; output: Record<string, unknown> | null }): BoardData["lastSearch"] {
  if (run.status === "failed") return { ok: false, message: `Search failed: ${run.error ?? "unknown error"}` };
  if (run.status !== "succeeded" || typeof run.output?.inserted !== "number") return null;
  const added = run.output.inserted;
  return { ok: true, message: `Last search added ${added} ${added === 1 ? "job" : "jobs"}.` };
}

// The card never shows the posting text, which is most of a job row.
const { rawPosting: _rawPosting, ...jobColumns } = getTableColumns(job);

/** Groups rows by application, keeping the order they came in. */
function byApplication<T extends { applicationId: string | null }>(rows: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    if (!row.applicationId) continue;
    const group = groups.get(row.applicationId);
    if (group) group.push(row);
    else groups.set(row.applicationId, [row]);
  }
  return groups;
}

export async function loadBoard(): Promise<BoardData> {
  const db = getDb();
  const rows = await db
    .select({ app: application, job: jobColumns })
    .from(application)
    .innerJoin(job, eq(job.id, application.jobId))
    .where(notInArray(application.status, ["archived", "withdrawn"]))
    .orderBy(desc(job.matchScore), desc(application.updatedAt));

  const ids = rows.map((r) => r.app.id);
  const [runs, openBlockers, intoCrafting, withDocuments, [latestSearch], [cfg], [owner]] = await Promise.all([
    ids.length
      ? db
          .select()
          .from(agentRun)
          .where(and(inArray(agentRun.applicationId, ids), inArray(agentRun.status, ACTIVE_RUN_STATUSES)))
      : [],
    ids.length
      ? db.select().from(blocker).where(and(inArray(blocker.applicationId, ids), isNull(blocker.answeredAt)))
      : [],
    ids.length
      ? db
          .select({ applicationId: applicationEvent.applicationId, from: applicationEvent.fromStatus, at: applicationEvent.at })
          .from(applicationEvent)
          // Asking for a new draft from a draft says nothing about which column the card belongs in.
          .where(and(inArray(applicationEvent.applicationId, ids), eq(applicationEvent.toStatus, "crafting"), ne(applicationEvent.fromStatus, "drafted")))
          .orderBy(desc(applicationEvent.at))
      : [],
    // Only documents the Craft modal can show: ones saved before M3 have no content.
    ids.length ? db.selectDistinct({ applicationId: document.applicationId }).from(document).where(and(inArray(document.applicationId, ids), isNotNull(document.content))) : [],
    db
      .select({ status: agentRun.status, error: agentRun.error, output: agentRun.output })
      .from(agentRun)
      .where(eq(agentRun.role, "scout"))
      .orderBy(desc(agentRun.createdAt))
      .limit(1),
    db.select({ workerLastSeenAt: settings.workerLastSeenAt }).from(settings).limit(1),
    // A requirement counts as met only by facts the Profile still has, as in the Craft modal.
    db.select({ facts: profile.facts }).from(profile).limit(1),
  ]);
  const facts = new Map((owner?.facts ?? []).map((f) => [f.id, f]));
  const runsByApp = byApplication(runs);
  const blockersByApp = byApplication(openBlockers);
  // Newest first, so the first event for an application is its latest move into crafting.
  const craftedFromByApp = new Map<string, string | null>();
  for (const e of intoCrafting) if (!craftedFromByApp.has(e.applicationId)) craftedFromByApp.set(e.applicationId, e.from);
  const documentsByApp = new Set(withDocuments.map((d) => d.applicationId));

  const cards: BoardCard[] = [];
  for (const { app, job: j } of rows) {
    const status = app.status as Status;
    const prev = craftedFromByApp.get(app.id) as Status | undefined;
    const column = columnFor(status, prev);
    if (!column) continue;
    const run = runsByApp.get(app.id)?.[0];
    const lastLog = run?.logs.at(-1)?.message ?? null;
    cards.push({
      id: app.id,
      status,
      column,
      company: j.company,
      title: j.title,
      location: j.location,
      remote: j.remote,
      salary: j.salary,
      sourceUrl: j.sourceUrl,
      companyUrl: j.companyUrl,
      alertSite: j.source === "indeed_alert" ? "Indeed" : j.source === "linkedin_alert" ? "LinkedIn" : null,
      matchScore: j.matchScore,
      matchReasons: j.matchReasons ? { met: j.matchReasons.met, missed: j.matchReasons.missed } : null,
      requirements: j.requirements?.map((r) => ({ text: r.text, met: requirementFacts(r, facts).met.length > 0 })) ?? null,
      lastError: app.lastError,
      working: !!run && run.status !== "paused",
      runLog: lastLog,
      actions: ownerActions(status).map((a) => ({ action: a, label: RULES[a].label })),
      blockers: (blockersByApp.get(app.id) ?? []).map((b) => ({ id: b.id, question: b.question, label: b.fieldContext.label })),
      hasDocuments: documentsByApp.has(app.id),
      updatedAt: app.updatedAt.toISOString(),
    });
  }

  return {
    cards,
    searchRunning: latestSearch?.status === "queued" || latestSearch?.status === "running",
    lastSearch: latestSearch ? describeSearch(latestSearch) : null,
    workerLastSeenAt: cfg?.workerLastSeenAt?.toISOString() ?? null,
  };
}
