import { loadBoard } from "@/lib/board";
import { route } from "@/lib/route";

export const dynamic = "force-dynamic";

export const GET = route(async () => Response.json(await loadBoard()));
