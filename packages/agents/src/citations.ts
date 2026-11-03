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
