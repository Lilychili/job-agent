import { startSearch } from "@jobagent/core";
import { route } from "@/lib/route";
import { getCtx } from "@/lib/server";

export const POST = route(async () => Response.json(await startSearch(await getCtx()), { status: 202 }));
