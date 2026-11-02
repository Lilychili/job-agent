import "server-only";
import { and, desc, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { columnFor, ownerActions, RULES, type Action, type ColumnId, type Status } from "@jobagent/core";
import { agentRun, application, applicationEvent, blocker, job, settings } from "@jobagent/db";
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
  lastError: string | null;
  working: boolean;
  runLog: string | null;
  actions: { action: Action; label: string }[];
  blockers: { id: string; question: string; label: string }[];
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

export async function loadBoard(): Promise<BoardData> {
  const db = getDb();
  const rows = await db
    .select({ app: application, job })
    .from(application)
    .innerJoin(job, eq(job.id, application.jobId))
    .where(notInArray(application.status, ["archived", "withdrawn"]))
    .orderBy(desc(job.matchScore), desc(application.updatedAt));

  const ids = rows.map((r) => r.app.id);
  const [runs, openBlockers, intoCrafting, [latestSearch], [cfg]] = await Promise.all([
    ids.length
      ? db
          .select()
          .from(agentRun)
          .where(and(inArray(agentRun.applicationId, ids), inArray(agentRun.status, ["queued", "running", "paused"])))
      : [],
    ids.length
      ? db.select().from(blocker).where(and(inArray(blocker.applicationId, ids), isNull(blocker.answeredAt)))
      : [],
    ids.length
      ? db
          .select({ applicationId: applicationEvent.applicationId, from: applicationEvent.fromStatus, at: applicationEvent.at })
          .from(applicationEvent)
          .where(and(inArray(applicationEvent.applicationId, ids), eq(applicationEvent.toStatus, "crafting")))
          .orderBy(desc(applicationEvent.at))
      : [],
    db
      .select({ status: agentRun.status, error: agentRun.error, output: agentRun.output })
      .from(agentRun)
      .where(eq(agentRun.role, "scout"))
      .orderBy(desc(agentRun.createdAt))
      .limit(1),
    db.select({ workerLastSeenAt: settings.workerLastSeenAt }).from(settings).limit(1),
  ]);

  const cards: BoardCard[] = [];
  for (const { app, job: j } of rows) {
    const status = app.status as Status;
    const prev = intoCrafting.find((e) => e.applicationId === app.id)?.from as Status | undefined;
    const column = columnFor(status, prev);
    if (!column) continue;
    const run = runs.find((r) => r.applicationId === app.id);
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
      lastError: app.lastError,
      working: !!run && run.status !== "paused",
      runLog: lastLog,
      actions: ownerActions(status).map((a) => ({ action: a, label: RULES[a].label })),
      blockers: openBlockers
        .filter((b) => b.applicationId === app.id)
        .map((b) => ({ id: b.id, question: b.question, label: b.fieldContext.label })),
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
