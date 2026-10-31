import { answerBlocker } from "@jobagent/core";
import { errorResponse, getCtx } from "@/lib/server";

export const dynamic = "force-dynamic";

/** POST { answer, reuse } — saves to the AnswerBank and resumes the Shipper when no Blockers remain. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { answer?: unknown; reuse?: unknown };
    if (typeof body.answer !== "string") {
      return Response.json({ error: "Missing answer." }, { status: 400 });
    }
    const result = await answerBlocker(await getCtx(), id, body.answer, { reuse: body.reuse !== false });
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
