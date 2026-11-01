import { addJob } from "@jobagent/core";
import { readBody, route } from "@/lib/route";
import { getPool } from "@/lib/server";

export const POST = route(async (req) => Response.json(await addJob(getPool(), await readBody(req)), { status: 201 }));
