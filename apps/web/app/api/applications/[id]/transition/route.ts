import { transition } from "@jobagent/core";
import { errorResponse, getCtx } from "@/lib/server";

export const dynamic = "force-dynamic";

/** POST { action } — the only way the UI changes a card. Always acts as the owner. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { action?: unknown };
    if (typeof body.action !== "string") {
      return Response.json({ error: "Missing action." }, { status: 400 });
    }
    const result = await transition(await getCtx(), id, body.action, { actor: "owner" });
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
