import { eq } from "drizzle-orm";
import { printDocuments, withDocuments } from "@jobagent/agents";
import { transitionInTx, type Status } from "@jobagent/core";
import { application, notify, settings } from "@jobagent/db";
import { assertEditable, latestDocuments, loadCraft, loadTarget, ownerDraft, parseStyle, pdfBrowser, sameContent } from "@/lib/documents";
import { ensureSettingsRow } from "@/lib/server-secrets";
import { readBody, route } from "@/lib/route";
import { getCtx, getDb } from "@/lib/server";

/** GET — what the Craft modal shows: the newest CV and letter, and the facts they cite. */
export const GET = route<{ id: string }>(async (_req, { id }) => Response.json(await loadCraft(id)));

/**
 * POST { cv, coverLetter, style } — the owner keeps the documents, edited or not. A change, in the words
 * or the look, is printed and saved as a new version; a draft then moves to Crafted. The style becomes
 * the default for the next drafts.
 */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const body = await readBody<{ cv: unknown; coverLetter: unknown; style: unknown }>(req);
  const db = getDb();
  const target = await loadTarget(db, id);
  assertEditable(target.status);
  const draft = ownerDraft(body, target.profile.facts, target);
  const latest = await latestDocuments(db, id);
  const style = parseStyle(body.style ?? latest.cv?.style ?? "color");
  const changed =
    !sameContent(draft.cv, latest.cv?.content) ||
    !sameContent(draft.coverLetter, latest.coverLetter?.content) ||
    style !== latest.cv?.style ||
    style !== latest.coverLetter?.style;
  const documents = changed ? await printDocuments(draft, target.profile, style, await pdfBrowser()) : [];
  await db.update(settings).set({ documentStyle: style }).where(eq(settings.id, (await ensureSettingsRow()).id));

  const ctx = await getCtx();
  const result = await withDocuments(ctx, async (tx, client, save) => {
    // Claude may have started a new draft since the checks above.
    const [app] = await tx.select({ status: application.status, hasOpenBlocker: application.hasOpenBlocker }).from(application).where(eq(application.id, id)).for("update");
    const status = app!.status as Status;
    assertEditable(status);
    const version = documents.length ? await save({ applicationId: id, documents, profileVersion: target.profile.version }) : null;
    if (status === "drafted") await transitionInTx(ctx, tx, client, id, "keepDraft", { actor: "owner", note: version ? `Edited, saved as version ${version}` : undefined });
    else await notify(tx, { type: "application", applicationId: id, status, hasOpenBlocker: app!.hasOpenBlocker });
    return { version };
  });
  return Response.json(result);
});
