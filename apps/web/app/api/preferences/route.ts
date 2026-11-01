import { eq } from "drizzle-orm";
import { parsePreferences } from "@jobagent/core";
import { preferences } from "@jobagent/db";
import { loadPreferences } from "@/lib/data";
import { readBody, route } from "@/lib/route";
import { getDb } from "@/lib/server";

export const PUT = route(async (req) => {
  const values = parsePreferences(await readBody(req));
  const db = getDb();
  const existing = await loadPreferences();
  const [row] = existing
    ? await db.update(preferences).set(values).where(eq(preferences.id, existing.id)).returning()
    : await db.insert(preferences).values(values).returning();
  return Response.json(row);
});
