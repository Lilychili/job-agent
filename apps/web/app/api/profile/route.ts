import { and, eq } from "drizzle-orm";
import { parseContact, parseFacts, ValidationError } from "@jobagent/core";
import { agentRun, profile } from "@jobagent/db";
import { loadProfile } from "@/lib/data";
import { readBody, route } from "@/lib/route";
import { getDb } from "@/lib/server";

/** The CV behind a Profile comes from the extraction run itself, never from a path the client supplies. */
async function sourceFileOf(runId: unknown): Promise<string | null> {
  if (typeof runId !== "string") return null;
  const [run] = await getDb()
    .select({ output: agentRun.output })
    .from(agentRun)
    .where(and(eq(agentRun.id, runId), eq(agentRun.role, "extractor")));
  return (run?.output?.sourceFile as string | undefined) ?? null;
}

/**
 * PUT { contact, facts, confirm?, extractionRunId? }. Facts keep their ids across saves so documents that
 * cite them stay valid. Agents refuse to run until `confirmed`; each save of a confirmed Profile bumps `version`.
 */
export const PUT = route(async (req) => {
  const body = await readBody<{ contact: unknown; facts: unknown; confirm: unknown; extractionRunId: unknown }>(req);
  const contact = parseContact(body.contact);
  const facts = parseFacts(body.facts);
  const confirm = body.confirm === true;
  if (confirm && facts.length === 0) throw new ValidationError("Add at least one fact before confirming.");

  const db = getDb();
  const existing = await loadProfile();
  const sourceFilePath = (await sourceFileOf(body.extractionRunId)) ?? existing?.sourceFilePath ?? null;
  if (!existing) {
    const [row] = await db.insert(profile).values({ contact, facts, confirmed: confirm, sourceFilePath }).returning();
    return Response.json(row);
  }
  const confirmed = existing.confirmed || confirm;
  const [row] = await db
    .update(profile)
    .set({ contact, facts, sourceFilePath, confirmed, version: confirmed ? existing.version + 1 : existing.version })
    .where(eq(profile.id, existing.id))
    .returning();
  return Response.json(row);
});
