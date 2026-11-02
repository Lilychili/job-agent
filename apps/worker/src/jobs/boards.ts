// Job board access shared by every step of a search.
import { boardKey, findBoard, listPostings, type BoardLookup, type BoardReader, type Posting } from "@jobagent/ats";
import { saveDiscoveredCompany } from "@jobagent/core";
import type { RunHelpers } from "../runner";

export const PARALLEL_LOOKUPS = 5;
// A company with no board may move to one, so it is looked up again now and then.
export const RECHECK_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/** Reads each board once per search, however many steps or alert jobs ask for it. */
export function boardReader(signal: AbortSignal): BoardReader {
  const reads = new Map<string, Promise<Posting[]>>();
  return (board) => {
    const key = boardKey(board);
    const read = reads.get(key) ?? listPostings(board, signal);
    reads.set(key, read);
    return read;
  };
}

export async function findAndSaveBoard(
  company: { name: string; reason: string },
  links: string[],
  read: BoardReader,
  { ctx, signal }: Pick<RunHelpers, "ctx" | "signal">,
): Promise<BoardLookup> {
  const hit = await findBoard(company.name, links, signal, read);
  // Not saved: a board that didn't answer says nothing, so the company stays open for next time.
  if (hit.outcome !== "unknown") await saveDiscoveredCompany(ctx.pool, { ...company, board: hit.outcome === "found" ? hit.board : null });
  return hit;
}
