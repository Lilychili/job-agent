import { loadBoard } from "@/lib/board";
import { errorResponse } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await loadBoard());
  } catch (err) {
    return errorResponse(err);
  }
}
