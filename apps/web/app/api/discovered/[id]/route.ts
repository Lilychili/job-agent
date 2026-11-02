import { removeDiscoveredCompany } from "@jobagent/core";
import { route } from "@/lib/route";
import { getCtx } from "@/lib/server";

/** Dismiss a company Claude found: Search stops reading its board and Discover won't suggest it again. */
export const DELETE = route<{ id: string }>(async (_req, { id }) => {
  const removed = await removeDiscoveredCompany((await getCtx()).pool, id);
  return Response.json({ removed }, { status: removed ? 200 : 404 });
});
