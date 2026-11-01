import { transition, ValidationError } from "@jobagent/core";
import { readBody, route } from "@/lib/route";
import { getCtx } from "@/lib/server";

/** POST { action } — the only way the UI changes a card. Always acts as the owner. */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const { action } = await readBody<{ action: unknown }>(req);
  if (typeof action !== "string") throw new ValidationError("Missing action.");
  return Response.json(await transition(await getCtx(), id, action, { actor: "owner" }));
});
