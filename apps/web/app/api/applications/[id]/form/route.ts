import { and, desc, eq, inArray } from "drizzle-orm";
import { JOBS, TransitionError } from "@jobagent/core";
import { agentRun, application, evidence, job, notify } from "@jobagent/db";
import { route } from "@/lib/route";
import { getDb } from "@/lib/server";

export interface PrefillSummary {
  formUrl: string | null;
  formTitle: string | null;
  windowOpen: boolean;
  filled: { label: string; source: string }[];
  leftForOwner: string[];
  screenshotId: string | null;
}

/** GET — what the last prefill did, for the review modal. */
export const GET = route<{ id: string }>(async (_req, { id }) => {
  const db = getDb();
  const [app] = await db
    .select({ windowOpen: application.formWindowOpen, formUrl: job.formUrl, formTitle: job.formTitle })
    .from(application)
    .innerJoin(job, eq(job.id, application.jobId))
    .where(eq(application.id, id));
  if (!app) throw new TransitionError("not_found", "Application not found.");
  const [run] = await db
    .select({ output: agentRun.output })
    .from(agentRun)
    .where(and(eq(agentRun.applicationId, id), eq(agentRun.status, "succeeded"), inArray(agentRun.jobName, [JOBS.shipperPrefill, JOBS.shipperResume])))
    .orderBy(desc(agentRun.createdAt))
    .limit(1);
  const [shot] = await db
    .select({ id: evidence.id })
    .from(evidence)
    .where(and(eq(evidence.applicationId, id), eq(evidence.type, "prefill_screenshot")))
    .orderBy(desc(evidence.capturedAt))
    .limit(1);
  const out = (run?.output ?? {}) as { filled?: { label?: string; fieldId?: string; source?: string }[]; leftForOwner?: string[] };
  const summary: PrefillSummary = {
    ...app,
    filled: (out.filled ?? []).map((f) => ({ label: f.label ?? f.fieldId ?? "", source: f.source ?? "" })),
    leftForOwner: out.leftForOwner ?? [],
    screenshotId: shot?.id ?? null,
  };
  return Response.json(summary);
});

/** POST — bring the application's form tab to the front of the Shipper window. */
export const POST = route<{ id: string }>(async (_req, { id }) => {
  const db = getDb();
  const [app] = await db.select({ open: application.formWindowOpen }).from(application).where(eq(application.id, id));
  if (!app) throw new TransitionError("not_found", "Application not found.");
  if (!app.open) throw new TransitionError("illegal", "The form isn't open in the Shipper window any more. Open it from the card's form link.");
  await notify(db, { type: "show_form", applicationId: id });
  return Response.json({ ok: true });
});
