// The hard criteria, in code: what fails here never reaches Claude and never reaches the board.
// When a posting doesn't say, it passes. Only something it states can rule it out.
import { normalizeCompany } from "./normalize";

export interface HardCriteria {
  locations: string[];
  remote: "onsite" | "hybrid" | "remote" | "any";
  salaryFloor: number | null;
  salaryCurrency: string | null;
  exclusions: { companies: string[]; keywords: string[]; seniority: string[] };
}

export interface FilterableJob {
  company: string;
  title: string;
  locations: string[];
  remote: "onsite" | "hybrid" | "remote" | "unknown";
  salary: string;
}

const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").match(/[\p{L}\p{N}+#]+/gu) ?? [];

/** All the phrase's words, side by side, so "go" doesn't match "Google". */
function hasPhrase(haystack: string[], phrase: string): boolean {
  const needle = words(phrase);
  if (needle.length === 0) return false;
  return haystack.some((_, i) => needle.every((w, j) => haystack[i + j] === w));
}

const CURRENCY_SYMBOLS: Record<string, string> = { "€": "EUR", "£": "GBP", $: "USD" };
const NOT_YEARLY = /\b(hour|hourly|day|daily|week|weekly|month|monthly)\b|\/\s*(hr|h|mo|m)\b/i;

/**
 * The top of a yearly pay range. Null unless it's unambiguous: a stated currency (a bare $ counts as
 * USD) and no hint that it's hourly or monthly. Null can't fail the floor.
 */
export function parseYearlySalary(salary: string): { currency: string; max: number } | null {
  if (NOT_YEARLY.test(salary)) return null;
  const code = salary.match(/\b(USD|EUR|GBP|CHF|CAD|AUD|SEK|NOK|DKK|PLN)\b/i)?.[1]?.toUpperCase();
  const symbol = salary.match(/[€£$]/)?.[0];
  const currency = code ?? (symbol && CURRENCY_SYMBOLS[symbol]);
  if (!currency) return null;
  const amounts = [...salary.matchAll(/(\d[\d.,]*)\s*(k\b)?/gi)].map(([, digits, k]) => {
    const whole = digits!.replace(/[.,](\d{3})(?=\D|$)/g, "$1").replace(",", ".");
    return Number.parseFloat(whole) * (k ? 1000 : 1);
  });
  const max = Math.max(...amounts.filter(Number.isFinite));
  return max >= 1000 ? { currency, max } : null;
}

/** Why this job fails the hard criteria, or null if it passes. */
export function hardFail(job: FilterableJob, c: HardCriteria): string | null {
  const company = normalizeCompany(job.company);
  if (c.exclusions.companies.some((x) => normalizeCompany(x) === company)) return "excluded company";

  const title = words(job.title);
  const keyword = c.exclusions.keywords.find((k) => hasPhrase(title, k));
  if (keyword) return `title has "${keyword}"`;
  const level = c.exclusions.seniority.find((s) => hasPhrase(title, s));
  if (level) return `seniority "${level}"`;

  if (c.remote !== "any" && job.remote !== "unknown" && job.remote !== c.remote) return `${job.remote}, not ${c.remote}`;

  if (c.locations.length > 0 && job.locations.length > 0) {
    const place = words([...job.locations, job.remote === "remote" ? "remote" : ""].join(" | "));
    if (!c.locations.some((l) => hasPhrase(place, l))) return "location";
  }

  if (c.salaryFloor !== null) {
    const pay = parseYearlySalary(job.salary);
    if (pay && pay.currency === c.salaryCurrency && pay.max < c.salaryFloor) return "below salary floor";
  }
  return null;
}
