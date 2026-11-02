// Finds which job board, if any, a company named by Claude actually has. Claude only names companies and
// may pass a link it saw; whether a board exists is decided here, by asking the three public APIs.
import { listPostings } from "./index";
import { AtsError, type Board, type BoardAts, type BoardReader, type Posting } from "./types";

const ATS_ORDER: BoardAts[] = ["greenhouse", "lever", "ashby"];
const BOARD_HOSTS: [RegExp, BoardAts][] = [
  [/(^|\.)greenhouse\.io$/, "greenhouse"],
  [/^jobs(\.eu)?\.lever\.co$/, "lever"],
  [/^jobs\.ashbyhq\.com$/, "ashby"],
];
const TOKEN = /^[A-Za-z0-9._-]+$/;
const LEGAL_WORDS = /\b(incorporated|inc|llc|ltd|limited|gmbh|ag|se|sa|sas|sl|bv|plc|oy|ab|corp|corporation|company|co)\b\.?/g;
const MAX_LINKS = 5;

/** The board a careers link points at, e.g. https://jobs.lever.co/acme/123 → { lever, acme }. */
export function boardFromUrl(raw: string): Board | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const ats = BOARD_HOSTS.find(([host]) => host.test(url.hostname))?.[1];
  if (!ats) return null;
  // Greenhouse's embed links name the board in ?for=
  const boardToken = (ats === "greenhouse" && url.searchParams.get("for")) || url.pathname.split("/").filter(Boolean)[0];
  return boardToken && TOKEN.test(boardToken) ? { ats, boardToken } : null;
}

/** "Acme Labs GmbH" → ["acmelabs", "acme-labs"]: the ways companies usually name their board. */
export function boardGuesses(company: string): string[] {
  const words = company
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(LEGAL_WORDS, " ")
    .match(/[a-z0-9]+/g);
  if (!words?.length) return [];
  return [...new Set([words.join(""), words.join("-")])];
}

/** The public page of a board, for people. */
export function boardHomeUrl({ ats, boardToken }: Board): string {
  const token = encodeURIComponent(boardToken);
  if (ats === "greenhouse") return `https://job-boards.greenhouse.io/${token}`;
  return ats === "lever" ? `https://jobs.lever.co/${token}` : `https://jobs.ashbyhq.com/${token}`;
}

/**
 * A LinkedIn link from an email, without what the email added: its query carries tracking and can carry
 * a sign-in token for the owner's account, so none of it is kept or stored.
 */
export function linkedInJobUrl(raw: string): string {
  const id = raw.match(/^https:\/\/([a-z0-9-]+\.)*linkedin\.com\/(comm\/)?jobs\/view\/([^/?#]*-)?(\d+)/i)?.[4];
  return id ? `https://www.linkedin.com/jobs/view/${id}/` : raw.split(/[?#]/)[0]!;
}

const MAX_REDIRECTS = 5;
const REDIRECT_TIMEOUT_MS = 8_000;
/** A link in an email may not lead this machine to itself or its network. */
const PRIVATE_HOST = /^(localhost|.*\.local|\d+\.\d+\.\d+\.\d+|\[.*\])$/i;

/**
 * Where a tracking link ends up, without reading the page. Stops at the last public https address it
 * reached, so a site that blocks us just means the link stays as it was.
 */
export async function followRedirects(raw: string, signal?: AbortSignal): Promise<string> {
  let current = raw;
  for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
    let next: string | null;
    try {
      const url = new URL(current);
      if (url.protocol !== "https:" || PRIVATE_HOST.test(url.hostname)) return raw;
      const timeout = AbortSignal.timeout(REDIRECT_TIMEOUT_MS);
      const res = await fetch(url, { redirect: "manual", signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      await res.body?.cancel();
      const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      next = location && new URL(location, url).toString();
    } catch (err) {
      if (signal?.aborted) throw signal.reason ?? err;
      return current;
    }
    if (!next) return current;
    current = next;
  }
  return current;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** A board can belong to someone else with the same slug. Greenhouse names its company; the others give the slug. */
function sameCompany(wanted: string, postings: Posting[]): boolean {
  const theirs = postings[0]?.company;
  if (!theirs) return true;
  const [a, b] = [squash(wanted), squash(theirs)];
  return a.includes(b) || b.includes(a);
}

export type BoardLookup =
  | { outcome: "found"; board: Board; postings: Posting[] }
  /** Every API answered and none has this company. */
  | { outcome: "none" }
  /** A board failed to answer (rate limit, timeout), so "none" can't be claimed. Worth asking again. */
  | { outcome: "unknown" };

async function tryBoard(board: Board, read: BoardReader, signal?: AbortSignal): Promise<Posting[] | "missing" | "unsure"> {
  try {
    return await read(board, signal);
  } catch (err) {
    if (signal?.aborted) throw signal.reason ?? err;
    return err instanceof AtsError && err.status === 404 ? "missing" : "unsure";
  }
}

/**
 * Links Claude saw come first, then the name guesses. A link comes from the web, so it gets the same
 * company check as a guess: a page can't plant someone else's board.
 */
export async function findBoard(company: string, links: string[], signal?: AbortSignal, read: BoardReader = listPostings): Promise<BoardLookup> {
  const linked = links.slice(0, MAX_LINKS).flatMap((link) => boardFromUrl(link) ?? []);
  const guessed = boardGuesses(company).flatMap((boardToken) => ATS_ORDER.map((ats): Board => ({ ats, boardToken })));
  let unsure = false;
  for (const board of [...linked, ...guessed]) {
    const postings = await tryBoard(board, read, signal);
    if (postings === "unsure") unsure = true;
    else if (postings !== "missing" && postings.length > 0 && sameCompany(company, postings)) return { outcome: "found", board, postings };
  }
  return { outcome: unsure ? "unknown" : "none" };
}
