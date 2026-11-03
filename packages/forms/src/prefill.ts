import { planFill, type FillSources } from "./plan";
import type { Filled, FormSession } from "./session";
import type { ApprovedFile, FormField } from "./types";

export interface PrefillResult {
  filled: Filled[];
  /** Required questions with no usable answer. When there are any, nothing was filled. */
  unknown: FormField[];
  /** Left empty for the owner. */
  skipped: FormField[];
  /** Fields the page wouldn't take a value for; left for the owner. */
  failed: { field: FormField; error: string }[];
}

/**
 * Fill one form. Unknown required questions stop it before anything is typed: the run pauses on
 * Blockers, and resuming opens the form again and fills it from scratch.
 */
export async function prefill(session: FormSession, sources: FillSources, cv: ApprovedFile): Promise<PrefillResult> {
  const fields = await session.listFields();
  const plan = await planFill(fields, sources);
  const result: PrefillResult = { filled: session.filled, unknown: plan.unknown, skipped: plan.skipped, failed: [] };
  if (plan.unknown.length) return result;

  // The CV goes first: Lever fills fields from it, and ours should win.
  for (const field of plan.uploads) await session.upload(field, cv);
  for (const { field, value } of plan.fills) {
    try {
      await session.fill(field, value);
    } catch (err) {
      result.failed.push({ field, error: err instanceof Error ? err.message.split("\n")[0]! : String(err) });
    }
  }
  return result;
}
