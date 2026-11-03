import { deleteAll, ValidationError } from "@jobagent/core";
import { readBody, route } from "@/lib/route";
import { getCtx } from "@/lib/server";

/** POST { confirm: "DELETE" } erases all personal data, the API key and all files (docs/SECURITY.md §5). */
export const POST = route(async (req) => {
  const { confirm } = await readBody<{ confirm: unknown }>(req);
  if (confirm !== "DELETE") throw new ValidationError('Type DELETE to confirm.');
  await deleteAll(await getCtx());
  return Response.json({ ok: true });
});
