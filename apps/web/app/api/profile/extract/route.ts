import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveDataPath, startExtraction, ValidationError } from "@jobagent/core";
import { loadLatestExtraction, loadSettingsView } from "@/lib/data";
import { route } from "@/lib/route";
import { getCtx } from "@/lib/server";

export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024;

export const GET = route(async () => Response.json(await loadLatestExtraction()));

/** multipart/form-data with a `file` (PDF or DOCX). Saves it under DATA_DIR/cv and queues the Extractor. */
export const POST = route(async (req) => {
  // Refuse oversized uploads before reading them into memory; multipart adds a little overhead.
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES + 64 * 1024) {
    throw new ValidationError("That file is larger than 10 MB.");
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new ValidationError("Choose a PDF or DOCX file.");
  if (file.size === 0) throw new ValidationError("That file is empty.");
  if (file.size > MAX_BYTES) throw new ValidationError("That file is larger than 10 MB.");

  const buf = Buffer.from(await file.arrayBuffer());
  const head = buf.subarray(0, 4).toString("latin1");
  const ext = head === "%PDF" ? "pdf" : head.startsWith("PK") ? "docx" : null;
  if (!ext) throw new ValidationError("Only PDF and DOCX files are supported.");

  if (!(await loadSettingsView()).ready) {
    throw new ValidationError("Connect Claude in Settings first: sign in with Claude Code, or add an API key.");
  }

  const ctx = await getCtx();
  const relative = `cv/${randomUUID()}.${ext}`;
  const full = resolveDataPath(ctx, relative);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, buf);
  const { runId } = await startExtraction(ctx, { path: relative, name: path.basename(file.name) });
  return Response.json({ runId }, { status: 202 });
});
