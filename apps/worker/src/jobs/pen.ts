// M0 STUB — replaced by the real Pen (Claude + HTML template + Playwright PDF) in M3.
// It already writes versioned, hashed Document rows so Approve and Apply's hash check work.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, max } from "drizzle-orm";
import { resolveDataPath, sha256, transition } from "@jobagent/core";
import { createDb, document, profile } from "@jobagent/db";
import { sleep, type Outcome, type RunHelpers } from "../runner";

/** A minimal valid one-page PDF with a line of text. */
function placeholderPdf(text: string): Buffer {
  const safe = text.replace(/[()\\]/g, "");
  const stream = `BT /F1 14 Tf 72 720 Td (${safe}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

export async function penCraft({ ctx, run, log, signal }: RunHelpers): Promise<Outcome> {
  const appId = run.applicationId!;
  const db = createDb(ctx.pool);
  const [p] = await db.select().from(profile).limit(1);
  if (!p?.confirmed) throw new Error("Profile is not confirmed");

  await log("Drafting CV and cover letter (stub)");
  await sleep(2000, signal);

  const [{ v } = { v: 0 }] = await db
    .select({ v: max(document.version) })
    .from(document)
    .where(and(eq(document.applicationId, appId), eq(document.kind, "cv")));
  const version = (v ?? 0) + 1;
  const factIds = p.facts.map((f) => f.id);

  for (const kind of ["cv", "cover_letter"] as const) {
    const pdf = placeholderPdf(`${kind === "cv" ? "CV" : "Cover letter"} v${version} - placeholder (M0)`);
    const rel = path.join("documents", appId, `${kind}-v${version}.pdf`);
    const full = resolveDataPath(ctx, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, pdf);
    await db.insert(document).values({
      applicationId: appId,
      kind,
      version,
      htmlSource: `<p>${kind} placeholder v${version}</p>`,
      pdfPath: rel,
      sha256: sha256(pdf),
      factIds,
      profileVersion: p.version,
      agentRunId: run.id,
    });
  }
  await log(`Saved CV and cover letter v${version}`);

  await transition(ctx, appId, "craftSucceeded", { actor: "system", runId: run.id });
  return { kind: "succeeded" };
}
