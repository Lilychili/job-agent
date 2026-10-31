import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { blocker, document, evidence, profile, type Db } from "@jobagent/db";
import { resolveDataPath, type CoreContext } from "./context";
import type { GuardName } from "./machine";

type AppRow = {
  id: string;
  approvedCvDocId: string | null;
  approvedLetterDocId: string | null;
};

/** A guard returns null when it passes, or a human-readable reason when it fails. */
type Guard = (tx: Db, app: AppRow, ctx: CoreContext) => Promise<string | null>;

export async function sha256File(fullPath: string): Promise<string> {
  return createHash("sha256").update(await readFile(fullPath)).digest("hex");
}

const guards: Record<GuardName, Guard> = {
  async profileConfirmed(tx) {
    const [p] = await tx.select({ confirmed: profile.confirmed }).from(profile).limit(1);
    return p?.confirmed ? null : "Confirm your Profile before crafting documents.";
  },

  async hasDraftDocuments(tx, app) {
    const [cv] = await tx
      .select({ id: document.id })
      .from(document)
      .where(and(eq(document.applicationId, app.id), eq(document.kind, "cv")))
      .limit(1);
    return cv ? null : "There is no CV draft to approve yet.";
  },

  async approvedDocsIntact(tx, app, ctx) {
    if (!app.approvedCvDocId) return "No approved CV for this application.";
    const ids = [app.approvedCvDocId, app.approvedLetterDocId].filter((x): x is string => !!x);
    const docs = await tx.select().from(document).where(inArray(document.id, ids));
    if (docs.length !== ids.length) return "An approved document is missing from the database.";
    for (const d of docs) {
      if (!d.approvedAt) return `Document ${d.kind} v${d.version} is not approved.`;
      let actual: string;
      try {
        actual = await sha256File(resolveDataPath(ctx, d.pdfPath));
      } catch {
        return `Approved ${d.kind} file is missing on disk.`;
      }
      if (actual !== d.sha256) {
        return `Approved ${d.kind} v${d.version} changed on disk (hash mismatch). Regenerate and re-approve.`;
      }
    }
    return null;
  },

  async noSubmissionEvidence(tx, app) {
    const [e] = await tx
      .select({ id: evidence.id })
      .from(evidence)
      .where(and(eq(evidence.applicationId, app.id), eq(evidence.type, "submission")))
      .limit(1);
    return e ? "This application was already submitted; refusing to submit again." : null;
  },

  async noOpenBlockers(tx, app) {
    const open = await tx
      .select({ id: blocker.id })
      .from(blocker)
      .where(and(eq(blocker.applicationId, app.id), isNull(blocker.answeredAt)))
      .limit(1);
    return open.length ? "Answer the open Blockers first." : null;
  },
};

export async function checkGuards(
  names: readonly GuardName[] | undefined,
  tx: Db,
  app: AppRow,
  ctx: CoreContext,
): Promise<string | null> {
  for (const name of names ?? []) {
    const reason = await guards[name](tx, app, ctx);
    if (reason) return reason;
  }
  return null;
}
