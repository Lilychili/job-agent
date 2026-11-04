// A CV and cover letter from content to saved files: fill the templates, print, hash, and save both as
// the next version. Pen saves Claude's draft this way and the Craft modal saves the owner's edits.
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq, max } from "drizzle-orm";
import type { Browser } from "playwright";
import { resolveDataPath, sha256, type CoreContext } from "@jobagent/core";
import { document, withTx, type Contact, type CvContent, type Db, type DocumentStyle, type LetterContent, type ProfileFact } from "@jobagent/db";
import { cvFactIds, letterFactIds, type PenDraft } from "./pen";
import { renderPdfs } from "./pdf";
import { cvHtml, letterHtml } from "./templates";

export interface DocumentProfile {
  contact: Contact;
  facts: ProfileFact[];
  version: number;
}

type Kind = "cv" | "cover_letter";

export interface PrintedDocument {
  kind: Kind;
  style: DocumentStyle;
  html: string;
  content: CvContent | LetterContent;
  factIds: string[];
  pdf: Buffer;
}

export function documentHtml(kind: Kind, content: CvContent | LetterContent, p: DocumentProfile, style: DocumentStyle = "color"): string {
  return kind === "cv" ? cvHtml(content as CvContent, p.contact, p.facts, style) : letterHtml(content as LetterContent, p.contact, style);
}

export async function printDocuments(draft: PenDraft, p: DocumentProfile, style: DocumentStyle, browser?: Browser): Promise<PrintedDocument[]> {
  const docs = [
    { kind: "cv" as const, style, html: documentHtml("cv", draft.cv, p, style), content: draft.cv, factIds: cvFactIds(draft.cv) },
    { kind: "cover_letter" as const, style, html: documentHtml("cover_letter", draft.coverLetter, p, style), content: draft.coverLetter, factIds: letterFactIds(draft.coverLetter) },
  ];
  const pdfs = await renderPdfs(docs.map((d) => d.html), browser);
  return docs.map((d, i) => ({ ...d, pdf: pdfs[i]! }));
}

export interface SaveDocuments {
  applicationId: string;
  documents: PrintedDocument[];
  profileVersion: number;
  agentRunId?: string;
}

type Tx = Parameters<Parameters<typeof withTx>[1]>;

/**
 * Runs `fn` in one transaction. Its `save` writes the files and saves the documents as one new version;
 * the files are removed again if the transaction doesn't commit. Lock the application in `fn` before
 * saving, so two saves can't take the same version.
 */
export async function withDocuments<T>(
  ctx: Pick<CoreContext, "pool" | "dataDir">,
  fn: (tx: Tx[0], client: Tx[1], save: (opts: SaveDocuments) => Promise<number>) => Promise<T>,
): Promise<T> {
  const written: string[] = [];
  try {
    return await withTx(ctx.pool, (tx, client) => fn(tx, client, (opts) => saveDocuments(tx, ctx, opts, written)));
  } catch (err) {
    await Promise.all(written.map((f) => rm(f, { force: true })));
    throw err;
  }
}

async function saveDocuments(db: Db, ctx: Pick<CoreContext, "dataDir">, opts: SaveDocuments, written: string[]): Promise<number> {
  const [{ v } = { v: 0 }] = await db.select({ v: max(document.version) }).from(document).where(eq(document.applicationId, opts.applicationId));
  const version = (v ?? 0) + 1;
  for (const { kind, style, html, content, factIds, pdf } of opts.documents) {
    const rel = path.join("documents", opts.applicationId, `${kind}-v${version}.pdf`);
    const full = resolveDataPath(ctx, rel);
    await mkdir(path.dirname(full), { recursive: true });
    written.push(full);
    await writeFile(full, pdf);
    await db.insert(document).values({
      applicationId: opts.applicationId,
      kind,
      version,
      style,
      htmlSource: html,
      content,
      pdfPath: rel,
      sha256: sha256(pdf),
      factIds,
      profileVersion: opts.profileVersion,
      agentRunId: opts.agentRunId,
    });
  }
  return version;
}
