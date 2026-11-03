// Finds a job's application form on Greenhouse, Lever or Ashby. Links from the web only ever lead to a
// board lookup (findBoard checks the board belongs to the company); the form link itself always comes
// from the board's own API or the job's stored posting link.
import { boardFromUrl, findBoard } from "./find";
import { listPostings } from "./index";
import type { BoardAts, BoardReader, Posting } from "./types";

export interface FormLink {
  ats: BoardAts;
  /** The ATS's own posting page; the adapter turns it into the apply form. */
  url: string;
  /** The posting's title on the board, for the owner to check it's the right job. */
  title: string;
}

export type FormLookup =
  | { outcome: "found"; link: FormLink; via: "posting" | "board" | "careers" }
  | { outcome: "none" }
  /** A board didn't answer, so "none" can't be claimed. Worth asking again. */
  | { outcome: "unknown" };

/** The hosted posting page a link points at, without query or fragment, or null. */
export function postingFromUrl(raw: string): { ats: BoardAts; url: string } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const host = url.hostname;
  if (/^jobs(\.eu)?\.lever\.co$/.test(host) && parts.length >= 2 && /^[\w.-]+$/.test(parts[0]!) && /^[\w-]+$/.test(parts[1]!)) {
    return { ats: "lever", url: `https://${host}/${parts[0]}/${parts[1]}` };
  }
  if (host === "jobs.ashbyhq.com" && parts.length >= 2 && /^[\w.%-]+$/.test(parts[0]!) && /^[0-9a-f-]{36}$/i.test(parts[1]!)) {
    return { ats: "ashby", url: `https://${host}/${parts[0]}/${parts[1]}` };
  }
  if (/^(job-boards|boards)(\.eu)?\.greenhouse\.io$/.test(host) && parts.length >= 3 && parts[1] === "jobs" && /^\d+$/.test(parts[2]!)) {
    return { ats: "greenhouse", url: `https://${host}/${parts[0]}/jobs/${parts[2]}` };
  }
  return null;
}

/** Greenhouse's job id, from its own page or a company page that embeds it (`?gh_jid=`). */
export function greenhouseJobId(raw: string): string | null {
  try {
    const url = new URL(raw);
    const id = url.searchParams.get("gh_jid") ?? /\/jobs\/(\d+)/.exec(url.pathname)?.[1] ?? null;
    return id && /^\d+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
// The query stays: company pages tell jobs apart there (?gh_jid=).
const sameUrl = (a: string, b: string) => a.replace(/#.*$/, "").replace(/\/$/, "") === b.replace(/#.*$/, "").replace(/\/$/, "");

/** The board's posting for this job: the same link, else the one posting with the same title. */
export function matchPosting(postings: Posting[], job: { sourceUrl: string; title: string }): Posting | null {
  const byLink = postings.find((p) => sameUrl(p.sourceUrl, job.sourceUrl) || (greenhouseJobId(job.sourceUrl) !== null && greenhouseJobId(p.sourceUrl) === greenhouseJobId(job.sourceUrl)));
  if (byLink) return byLink;
  const want = squash(job.title);
  if (!want) return null;
  const exact = postings.filter((p) => squash(p.title) === want);
  if (exact.length === 1) return exact[0]!;
  const close = postings.filter((p) => squash(p.title).includes(want) || want.includes(squash(p.title)));
  return close.length === 1 ? close[0]! : null;
}

/** A posting from a board's API as a form link. Greenhouse may list a company page; its job id rebuilds the hosted one. */
function formFromPosting(p: Posting, boardToken: string): FormLink | null {
  const hosted = postingFromUrl(p.sourceUrl);
  if (hosted) return { ...hosted, title: p.title };
  const id = p.ats === "greenhouse" ? greenhouseJobId(p.sourceUrl) : null;
  return id ? { ats: "greenhouse", url: `https://job-boards.greenhouse.io/${encodeURIComponent(boardToken)}/jobs/${id}`, title: p.title } : null;
}

export interface FormJob {
  sourceUrl: string;
  companyUrl: string | null;
  company: string;
  title: string;
}

/**
 * Most trusted first: the posting link itself, then the company's board found from its name or stored
 * board link, then boards linked from the careers pages `careersLinks` finds (Claude plus a page read).
 */
export async function findForm(
  job: FormJob,
  opts: { careersLinks?: () => Promise<string[]>; read?: BoardReader; signal?: AbortSignal } = {},
): Promise<FormLookup> {
  const direct = postingFromUrl(job.sourceUrl);
  if (direct) return { outcome: "found", link: { ...direct, title: job.title }, via: "posting" };

  const read = opts.read ?? listPostings;
  let unsure = false;
  const tryLinks = async (links: string[], via: "board" | "careers"): Promise<FormLookup | null> => {
    const lookup = await findBoard(job.company, links.filter((l) => boardFromUrl(l)), opts.signal, read);
    if (lookup.outcome === "unknown") unsure = true;
    if (lookup.outcome !== "found") return null;
    const posting = matchPosting(lookup.postings, job);
    const link = posting && formFromPosting(posting, lookup.board.boardToken);
    return link ? { outcome: "found", link, via } : null;
  };

  const fromBoard = await tryLinks(job.companyUrl ? [job.companyUrl] : [], "board");
  if (fromBoard) return fromBoard;
  if (opts.careersLinks) {
    const fromCareers = await tryLinks(await opts.careersLinks(), "careers");
    if (fromCareers) return fromCareers;
  }
  return { outcome: unsure ? "unknown" : "none" };
}
