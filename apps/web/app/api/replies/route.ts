import { startRepliesCheck } from "@jobagent/core";
import { route } from "@/lib/route";
import { getCtx } from "@/lib/server";

/** POST — look in Gmail for answers to the applications that were sent. */
export const POST = route(async () => Response.json(await startRepliesCheck(await getCtx()), { status: 202 }));
