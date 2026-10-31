import { startSearch } from "@jobagent/core";
import { errorResponse, getCtx } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    return Response.json(await startSearch(await getCtx()), { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
