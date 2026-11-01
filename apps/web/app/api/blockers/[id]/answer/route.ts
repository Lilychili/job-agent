import { answerBlocker, ValidationError } from "@jobagent/core";
import { readBody, route } from "@/lib/route";
import { getCtx } from "@/lib/server";

/** POST { answer, reuse } — saves to the AnswerBank and resumes the Shipper when no Blockers remain. */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const body = await readBody<{ answer: unknown; reuse: unknown }>(req);
  if (typeof body.answer !== "string") throw new ValidationError("Missing answer.");
  return Response.json(await answerBlocker(await getCtx(), id, body.answer, { reuse: body.reuse !== false }));
});
