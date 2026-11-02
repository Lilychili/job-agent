import { disconnectGmail } from "@jobagent/core";
import { route } from "@/lib/route";
import { getCtx } from "@/lib/server";

export const DELETE = route(async () => {
  await disconnectGmail((await getCtx()).pool);
  return Response.json({ ok: true });
});
