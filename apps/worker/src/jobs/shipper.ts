// M0 STUB — replaced by the real Shipper (Playwright + Agent SDK) in M4.
// It already exercises the Blocker loop: an unknown question pauses the run,
// the owner's answer lands in the AnswerBank, and the resume run uses it.
import { and, eq } from "drizzle-orm";
import { lookupAnswer, raiseBlocker, transition } from "@jobagent/core";
import { createDb, evidence } from "@jobagent/db";
import { sleep, type Outcome, type RunHelpers } from "../runner";

/** The "custom questions" on the fake form. */
const FAKE_FORM_QUESTIONS = [{ question: "What is your notice period?", label: "Notice period", type: "text" }];

export async function shipperPrefill({ ctx, run, log, signal }: RunHelpers): Promise<Outcome> {
  const appId = run.applicationId!;
  const db = createDb(ctx.pool);

  // Never touch a form that was already submitted.
  const prior = await db
    .select({ id: evidence.id })
    .from(evidence)
    .where(and(eq(evidence.applicationId, appId), eq(evidence.type, "submission")))
    .limit(1);
  if (prior.length) throw new Error("Submission evidence exists; refusing to prefill again");

  await log("Opening form and filling standard fields (stub)");
  await sleep(1500, signal);

  for (const q of FAKE_FORM_QUESTIONS) {
    const answer = await lookupAnswer(ctx, appId, q.question);
    if (answer === null) {
      await log(`No answer for "${q.question}" — raising a Blocker`);
      await raiseBlocker(ctx, run.id, {
        question: q.question,
        fieldContext: { label: q.label, type: q.type },
        checkpoint: { step: "custom_questions" },
      });
      return { kind: "paused" };
    }
    await log(`Filled "${q.label}" from the AnswerBank`);
  }

  await db.insert(evidence).values({
    applicationId: appId,
    agentRunId: run.id,
    type: "prefill_screenshot",
    text: "(stub) form prefilled; stopped before submit",
  });
  await log("Stopped before submit. Waiting for the owner.");
  await transition(ctx, appId, "prefillDone", { actor: "system", runId: run.id });
  return { kind: "succeeded" };
}

export async function shipperCaptureEvidence({ ctx, run, log }: RunHelpers): Promise<Outcome> {
  const db = createDb(ctx.pool);
  await db.insert(evidence).values({
    applicationId: run.applicationId!,
    agentRunId: run.id,
    type: "confirmation_text",
    text: "(stub) confirmation page text would be captured here",
  });
  await log("Captured confirmation evidence (stub)");
  return { kind: "succeeded" };
}
