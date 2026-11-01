import { loadOpenBlockers } from "@/lib/data";
import { route } from "@/lib/route";

export const dynamic = "force-dynamic";

export const GET = route(async () => Response.json(await loadOpenBlockers()));
