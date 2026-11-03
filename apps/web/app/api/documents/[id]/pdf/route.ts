import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { resolveDataPath, sha256, TransitionError } from "@jobagent/core";
import { application, document, job, profile } from "@jobagent/db";
import { pdfResponse } from "@/lib/documents";
import { route } from "@/lib/route";
import { getCtx, getDb } from "@/lib/server";

const slug = (s: string) => s.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");

/** GET — a saved PDF, only if it still matches its hash. `?download=1` names it for saving. */
export const GET = route<{ id: string }>(async (req, { id }) => {
  const db = getDb();
  const [doc] = await db
    .select({ kind: document.kind, pdfPath: document.pdfPath, sha256: document.sha256, company: job.company })
    .from(document)
    .innerJoin(application, eq(application.id, document.applicationId))
    .innerJoin(job, eq(job.id, application.jobId))
    .where(eq(document.id, id));
  if (!doc) throw new TransitionError("not_found", "Document not found.");
  const pdf = await readFile(resolveDataPath(await getCtx(), doc.pdfPath)).catch(() => null);
  if (!pdf || sha256(pdf) !== doc.sha256) {
    return Response.json({ error: "This PDF is missing or changed on disk. Ask Claude again to make a new one." }, { status: 409 });
  }
  if (!new URL(req.url).searchParams.has("download")) return pdfResponse(pdf);
  const [p] = await db.select({ contact: profile.contact }).from(profile).limit(1);
  const name = [p?.contact.name, doc.kind === "cv" ? "CV" : "Cover letter", doc.company].filter(Boolean).map((s) => slug(s!)).join("-");
  return pdfResponse(pdf, `${name || "document"}.pdf`);
});
