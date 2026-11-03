import "server-only";
import { desc, eq } from "drizzle-orm";
import type { Browser } from "playwright";
import { launchPdfBrowser, parseDraft, type PenDraft } from "@jobagent/agents";
import { EDITABLE_DOCUMENTS, TransitionError, ValidationError, type Status } from "@jobagent/core";
import { application, document, job, profile, type CvContent, type Db, type JobRequirement, type LetterContent, type ProfileFact } from "@jobagent/db";
import { getDb } from "./server";

type Globals = { pdfBrowser?: Promise<Browser> };
const g = globalThis as typeof globalThis & { __jobagentPdf?: Globals };
const s = (g.__jobagentPdf ??= {});

/** One Chromium for the whole server, so a preview prints in a fraction of a second. Restarted if it died. */
export async function pdfBrowser(): Promise<Browser> {
  const current = await s.pdfBrowser?.catch(() => undefined);
  if (current?.isConnected()) return current;
  s.pdfBrowser = launchPdfBrowser();
  return s.pdfBrowser;
}

interface SavedDocument<C> {
  id: string;
  version: number;
  content: C;
}

export interface CraftData {
  status: Status;
  company: string;
  title: string;
  editable: boolean;
  facts: ProfileFact[];
  requirements: JobRequirement[] | null;
  cv: SavedDocument<CvContent> | null;
  coverLetter: SavedDocument<LetterContent> | null;
}

/** The application, its job and the confirmed Profile. Throws a 404 if any is missing. */
export async function loadTarget(db: Db, applicationId: string) {
  const [target] = await db
    .select({ status: application.status, company: job.company, title: job.title, requirements: job.requirements })
    .from(application)
    .innerJoin(job, eq(job.id, application.jobId))
    .where(eq(application.id, applicationId));
  if (!target) throw new TransitionError("not_found", "Application not found.");
  const [p] = await db.select().from(profile).limit(1);
  if (!p?.confirmed) throw new ValidationError("Confirm your Profile first.");
  return { ...target, status: target.status as Status, profile: p };
}

/** The newest version of each document. */
export async function latestDocuments(db: Db, applicationId: string) {
  const docs = await db
    .select({ id: document.id, kind: document.kind, version: document.version, content: document.content })
    .from(document)
    .where(eq(document.applicationId, applicationId))
    .orderBy(desc(document.version));
  const pick = <C>(kind: "cv" | "cover_letter") => {
    const d = docs.find((x) => x.kind === kind && x.content);
    return d ? { id: d.id, version: d.version, content: d.content as C } : null;
  };
  return { cv: pick<CvContent>("cv"), coverLetter: pick<LetterContent>("cover_letter") };
}

export async function loadCraft(applicationId: string): Promise<CraftData> {
  const db = getDb();
  const t = await loadTarget(db, applicationId);
  return {
    status: t.status,
    company: t.company,
    title: t.title,
    editable: EDITABLE_DOCUMENTS.includes(t.status),
    facts: t.profile.facts,
    requirements: t.requirements,
    ...(await latestDocuments(db, applicationId)),
  };
}

/** The owner's edits from a request body, checked against the Profile. */
export function ownerDraft(body: { cv?: unknown; coverLetter?: unknown }, facts: ProfileFact[], job: { company: string; title: string }): PenDraft {
  return parseDraft({ cv: body.cv, coverLetter: body.coverLetter }, facts, job, "owner");
}

/** JSON with sorted keys: Postgres stores jsonb with its own key order. */
const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`
      : JSON.stringify(v ?? null);

export const sameContent = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/** A document the owner can still change, or an error saying why not. */
export function assertEditable(status: Status) {
  if (!EDITABLE_DOCUMENTS.includes(status)) {
    throw new TransitionError("illegal", status === "crafting" ? "Claude is still writing this draft." : "These documents are approved and locked.");
  }
}

export const pdfResponse = (pdf: Buffer, filename?: string) =>
  new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "no-store",
      ...(filename ? { "Content-Disposition": `attachment; filename="${filename}"` } : {}),
    },
  });
