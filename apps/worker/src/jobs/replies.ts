// Replies: for each applied card, look in Gmail for mail that names its company since the owner applied,
// have Claude label it, and move the card to Replied or Rejected. Each email that moved a card is saved as
// evidence, so a message is never read twice and a restart changes nothing.
import { and, desc, eq, inArray } from "drizzle-orm";
import { addUsage, classifyEmails, decide, NO_USAGE } from "@jobagent/agents";
import { readCompanyEmails, transitionInTx, type ReplyTarget } from "@jobagent/core";
import { application, applicationEvent, createDb, evidence, job, withTx } from "@jobagent/db";
import { claudeFromSettings, saveUsage } from "../claude";
import type { Outcome, RunHelpers } from "../runner";
import { errorText, forEachParallel } from "../util";

const PARALLEL_COMPANIES = 3;
/** The first line of an email's evidence, so a message that already moved a card isn't read again. */
const MESSAGE_PREFIX = "gmail:";

export async function repliesCheck({ ctx, run, log, signal }: RunHelpers): Promise<Outcome> {
  const db = createDb(ctx.pool);
  const cards = await db
    .select({ id: application.id, status: application.status, updatedAt: application.updatedAt, company: job.company, title: job.title })
    .from(application)
    .innerJoin(job, eq(job.id, application.jobId))
    .where(inArray(application.status, ["applied", "replied"]));
  if (!cards.length) {
    await log("No applications are waiting for a reply.");
    return { kind: "succeeded", output: { checked: 0, replied: 0, rejected: 0 } };
  }
  const ids = cards.map((c) => c.id);

  // Mail from before the owner applied can't be an answer to it.
  const appliedAt = new Map<string, Date>();
  const moves = await db
    .select({ applicationId: applicationEvent.applicationId, at: applicationEvent.at })
    .from(applicationEvent)
    .where(and(inArray(applicationEvent.applicationId, ids), eq(applicationEvent.toStatus, "applied")))
    .orderBy(desc(applicationEvent.at));
  for (const m of moves) if (!appliedAt.has(m.applicationId)) appliedAt.set(m.applicationId, m.at);
  const targets: ReplyTarget[] = cards.map((c) => ({ id: c.id, company: c.company, since: appliedAt.get(c.id) ?? c.updatedAt }));

  await log(`Searching Gmail for ${cards.length} ${cards.length === 1 ? "company" : "companies"}…`);
  const mail = await readCompanyEmails(ctx.pool, targets, signal);
  if (!mail) throw new Error("Gmail isn't connected. Connect it in Settings.");

  const recorded = await db.select({ applicationId: evidence.applicationId, text: evidence.text }).from(evidence).where(and(inArray(evidence.applicationId, ids), eq(evidence.type, "email")));
  const seen = new Set(recorded.map((e) => `${e.applicationId}:${e.text?.split("\n")[0]}`));

  const { auth, model } = await claudeFromSettings(ctx);
  let usage = NO_USAGE;
  let promptVersion: string | null = null;
  let replied = 0;
  let rejected = 0;

  await forEachParallel(cards, PARALLEL_COMPANIES, async (card) => {
    signal.throwIfAborted(); // stopped or timed out: move no more cards
    const emails = (mail.get(card.id) ?? []).filter((e) => !seen.has(`${card.id}:${MESSAGE_PREFIX}${e.id}`));
    if (!emails.length) return;
    try {
      const read = await classifyEmails({ auth, model, company: card.company, title: card.title, emails, signal });
      usage = addUsage(usage, read.usage);
      promptVersion = read.promptVersion;
      const verdict = decide(read.kinds, card.status as "applied" | "replied");
      if (!verdict) return;
      const email = emails[verdict.index]!;
      signal.throwIfAborted();
      await withTx(ctx.pool, async (tx, client) => {
        await transitionInTx(ctx, tx, client, card.id, verdict.move, { actor: "owner", recordAs: "agent", runId: run.id, note: `Moved by the reply check: "${email.subject}"` });
        await tx.insert(evidence).values({
          applicationId: card.id,
          agentRunId: run.id,
          type: "email",
          text: `${MESSAGE_PREFIX}${email.id}\nFrom: ${email.from}\nSubject: ${email.subject}\nReceived: ${email.receivedAt.toISOString()}`,
        });
      });
      if (verdict.move === "markReplied") replied++;
      else rejected++;
      await log(`${card.company}: ${verdict.move === "markReplied" ? "replied" : "rejected"} ("${email.subject}")`);
    } catch (err) {
      if (signal.aborted) throw err;
      await log(`${card.company}: couldn't check (${errorText(err)})`);
    }
  });

  if (promptVersion) await saveUsage(ctx, run.id, { model, promptVersion, usage });
  await log(`Checked ${cards.length}: ${replied} replied, ${rejected} rejected.`);
  return { kind: "succeeded", output: { checked: cards.length, replied, rejected } };
}
