// Public job-board APIs. Plain HTTP and no LLM: what comes back is untrusted posting text.
import { ashbyPostings, type AshbyJob } from "./ashby";
import { greenhousePostings, type GreenhouseJob } from "./greenhouse";
import { leverPostings, type LeverPosting } from "./lever";
import { AtsError, getJson, type Board, type Posting } from "./types";

export * from "./types";
export { htmlToText } from "./text";
export { boardFromUrl, boardGuesses, boardHomeUrl, findBoard, followRedirects, linkedInJobUrl, type BoardLookup } from "./find";

/** Fetch every open posting on one company's board. */
export async function listPostings({ ats, boardToken }: Board, signal?: AbortSignal): Promise<Posting[]> {
  const token = encodeURIComponent(boardToken);
  if (ats === "greenhouse") {
    const { jobs } = await getJson<{ jobs?: GreenhouseJob[] }>(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`, signal);
    return greenhousePostings(boardToken, jobs ?? []);
  }
  if (ats === "ashby") {
    const { jobs } = await getJson<{ jobs?: AshbyJob[] }>(`https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=true`, signal);
    return ashbyPostings(boardToken, jobs ?? []);
  }
  try {
    return leverPostings(boardToken, await getJson<LeverPosting[]>(`https://api.lever.co/v0/postings/${token}?mode=json`, signal));
  } catch (err) {
    // Lever hosts EU customers separately, and the global API answers 404 for them.
    if (!(err instanceof AtsError) || err.status !== 404) throw err;
    return leverPostings(boardToken, await getJson<LeverPosting[]>(`https://api.eu.lever.co/v0/postings/${token}?mode=json`, signal));
  }
}
export * from "./form";
