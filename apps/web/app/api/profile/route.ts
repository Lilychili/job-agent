import { and, eq } from "drizzle-orm";
import { keepFactIds, parseContact, parseFacts, startRescore, TransitionError, ValidationError } from "@jobagent/core";
import { agentRun, profile } from "@jobagent/db";
import { loadProfile } from "@/lib/data";
import { readBody, route } from "@/lib/route";
import { getCtx, getDb } from "@/lib/server";

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
  const confirm = body.confirm === true;
  const db = getDb();
  const existing = await loadProfile();
  const facts = keepFactIds(parseFacts(body.facts), existing?.facts ?? []);
  if (confirm && facts.length === 0) throw new ValidationError("Add at least one fact before confirming.");

  const sourceFilePath = (await sourceFileOf(body.extractionRunId)) ?? existing?.sourceFilePath ?? null;
  if (!existing) {
    const [row] = await db.insert(profile).values({ contact, facts, confirmed: confirm, sourceFilePath }).returning();
    return Response.json(row);
  }
  const confirmed = existing.confirmed || confirm;
  // Only the facts decide how jobs match, so a new version (and Claude scoring the cards again) needs
  // changed facts, or a first confirmation. Contact details alone don't.
  const factsChanged = JSON.stringify(facts) !== JSON.stringify(existing.facts);
  const newVersion = confirmed && (factsChanged || !existing.confirmed);
  const [row] = await db
    .update(profile)
    .set({ contact, facts, sourceFilePath, confirmed, version: newVersion ? existing.version + 1 : existing.version })
    .where(eq(profile.id, existing.id))
    .returning();
  if (newVersion) {
    // The worker's heartbeat starts it later if a search is running now.
    await startRescore(await getCtx()).catch((err) => {
      if (!(err instanceof TransitionError)) throw err;
    });
  }
  return Response.json(row);
});
