export type BoardAts = "greenhouse" | "lever" | "ashby";
export type Board = { ats: BoardAts; boardToken: string };
export type Remote = "onsite" | "hybrid" | "remote" | "unknown";
/** How a board is read. A search passes its own, so one board is downloaded once. */
export type BoardReader = (board: Board, signal?: AbortSignal) => Promise<Posting[]>;

export const NOT_STATED = "not stated";

export const boardKey = ({ ats, boardToken }: Board) => `${ats}/${boardToken.toLowerCase()}`;

/** One open job, in the same shape whichever board it came from. */
export interface Posting {
  /** "other" for a job known only from an email. */
  ats: BoardAts | "other";
  sourceUrl: string;
  company: string;
  title: string;
  /** The location to show on the card. */
  location: string | null;
  /** Every location the posting names, for matching against Preferences. */
  locations: string[];
  remote: Remote;
  /** Copied from a pay field on the board, or "not stated" when the board has none. */
  salary: string;
  /** Plain text of the posting. Untrusted. */
  text: string;
  /** Set when an alert email brought this job in. */
  source?: "indeed_alert" | "linkedin_alert";
  /** Only the alert's summary is known, not the full posting. */
  summaryOnly?: boolean;
  /** The company's job board, when `sourceUrl` can't point at the company itself. */
  companyUrl?: string | null;
}

export class AtsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AtsError";
  }
}

const REQUEST_TIMEOUT_MS = 20_000;

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, headers: { accept: "application/json" } });
  } catch (err) {
    if (signal?.aborted) throw signal.reason ?? err;
    throw new AtsError("the job board didn't respond");
  }
  if (res.status === 404) throw new AtsError("board not found; check its name in Preferences", 404);
  if (!res.ok) throw new AtsError(`the job board answered ${res.status}`, res.status);
  try {
    return (await res.json()) as T;
  } catch {
    throw new AtsError("the job board sent an unreadable reply");
  }
}

/** A readable company name for boards that only give us their slug: "acme-labs" → "Acme Labs". */
export function companyFromToken(token: string): string {
  return token
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}
