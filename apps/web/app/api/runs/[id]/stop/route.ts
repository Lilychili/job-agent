import { stopRun } from "@jobagent/core";
import { route } from "@/lib/route";
import { getCtx } from "@/lib/server";

/** POST — stop a Search or reply check that is queued or running. */
export const POST = route<{ id: string }>(async (_req, { id }) => {
  await stopRun(await getCtx(), id);
  return Response.json({ ok: true });
});
