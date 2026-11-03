import { exportAll } from "@jobagent/core";
import { route } from "@/lib/route";
import { getDb } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Downloads everything stored about the owner as JSON (docs/SECURITY.md §5). */
export const GET = route(async () => {
  return new Response(JSON.stringify(await exportAll(getDb()), null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="job-agent-export.json"',
    },
  });
});
