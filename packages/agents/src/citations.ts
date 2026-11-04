// What a piece of a document may claim, given the facts it cites, and how a skill or requirement is
// named and matched. Pure, so the Craft modal and the board use the same rules as the code that checks
// Claude's drafts.
import type { JobRequirement, ProfileFact } from "@jobagent/db";

const NUMBER = /\d+(?:[.,]\d+)*/g;

/** Everything a fact states, as one line of text. */
export const factSource = (f: ProfileFact) => [f.text, f.org, f.startDate, f.endDate].filter(Boolean).join(" ");

/**
 * The first number in `text` that none of `sources` states, if any. Whole numbers are compared, so the
 * "5" and "15" inside a date like "2015-05" back nothing.
 */
export function unsupportedNumber(text: string, sources: string[]): string | undefined {
  const stated = new Set(sources.flatMap((s) => s.match(NUMBER) ?? []));
  return text.match(NUMBER)?.find((n) => !stated.has(n));
}

const normName = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Words that give the owner a level. A job asking for seniority tempts a title the Profile never gave.
const LEVEL_WORDS = /(?<!\w)(senior|principal|staff engineer|lead (?:engineer|developer)|tech lead|head of|chief)(?!\w)/gi;

/**
 * The first level word in `text` that no role the owner held has in its title, if any: "Mentored
 * senior engineers" doesn't make the owner senior. Naming the job itself ("the Senior Engineer role")
 * is fine, so the job title is taken out first. A flag for the owner to check, not a rejection: they
 * may well be senior without a title that says so.
 */
export function unstatedLevel(text: string, facts: Iterable<ProfileFact>, jobTitle: string): string | undefined {
  const stated = [...facts].filter((f) => f.kind === "role").map((f) => f.text.toLowerCase());
  const rest = jobTitle.trim() ? text.replace(new RegExp(escapeRegex(jobTitle.trim()), "gi"), "") : text;
  return rest.match(LEVEL_WORDS)?.find((w) => !stated.some((s) => s.includes(w.toLowerCase())));
}

/** Any of `names` as a whole word or phrase, so "Go" doesn't match "Google". Null for no names. */
export const wordPattern = (names: string[], flags = "i") =>
  names.length ? new RegExp(`(?<!\\w)(?:${names.map(escapeRegex).join("|")})(?!\\w)`, flags) : null;

/**
 * The names a skill goes by, lowercased: "PHP/Laravel" is also "php" and "laravel", "Mock Service
 * Worker (MSW)" is also "mock service worker" and "msw".
 */
export function skillNames(text: string): string[] {
  const [, base = text, bracketed] = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(text) ?? [];
  return [...new Set([text, base, ...base.split("/"), ...(bracketed ? [bracketed] : [])].map(normName).filter(Boolean))];
}

/** A requirement's facts that still exist: those that meet it, and the closest experience when none does. */
export function requirementFacts(r: JobRequirement, facts: Map<string, ProfileFact>) {
  const pick = (ids: string[] = []) => ids.flatMap((id) => facts.get(id) ?? []);
  const met = pick(r.factIds);
  return { met, closest: met.length ? [] : pick(r.closest) };
}
