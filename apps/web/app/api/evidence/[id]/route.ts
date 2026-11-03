import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { resolveDataPath, TransitionError } from "@jobagent/core";
import { evidence } from "@jobagent/db";
import { route } from "@/lib/route";
import { getCtx, getDb } from "@/lib/server";

/** GET — an evidence screenshot. */
export const GET = route<{ id: string }>(async (_req, { id }) => {
  const [row] = await getDb().select({ filePath: evidence.filePath }).from(evidence).where(eq(evidence.id, id));
  if (!row?.filePath?.endsWith(".png")) throw new TransitionError("not_found", "Screenshot not found.");
  const png = await readFile(resolveDataPath(await getCtx(), row.filePath)).catch(() => null);
  if (!png) throw new TransitionError("not_found", "The screenshot file is missing.");
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" } });
});
