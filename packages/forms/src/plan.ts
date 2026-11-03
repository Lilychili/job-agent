// Decides what goes in each field before anything is typed. Values come only from the Profile,
// the AnswerBank and the approved documents; the page supplies labels and options, never values.
import type { FormField, SourcedValue, StandardField } from "./types";

export interface Contact {
  name: string;
  email: string;
  phone?: string;
  location?: string;
  links?: string[];
}

export interface FillSources {
  contact: Contact;
  /** The org of the Profile's current role, if any. */
  currentCompany: string | null;
  /** Plain text of the approved cover letter, for forms that take it as text. */
  letterText: string | null;
  /** AnswerBank answer for a question (job-only first, then reusable), or null when there is none. */
  lookup: (question: string) => Promise<string | null>;
}

export interface FillPlan {
  fills: { field: FormField; value: SourcedValue }[];
  /** The approved CV goes here, after its hash is checked again. */
  uploads: FormField[];
  /** Required questions with no usable answer. Each becomes a Blocker. */
  unknown: FormField[];
  /** Optional questions with no answer, and fields only the owner can fill (other uploads). Left empty. */
  skipped: FormField[];
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * The option an answer picks, or null. Exact match (ignoring case) first; otherwise the one option
 * the answer and it share as a leading phrase, so "Yes" picks "Yes, I consent" and
 * "Yes, EU citizen" picks "Yes". Two candidates means the answer is ambiguous: null.
 */
export function matchOption(answer: string, options: readonly string[]): string | null {
  const a = norm(answer);
  if (!a) return null;
  const exact = options.filter((o) => norm(o) === a);
  if (exact.length === 1) return exact[0]!;
  const startsWith = (long: string, short: string) => long.startsWith(short) && /^[^a-z0-9]/.test(long.slice(short.length));
  const close = options.filter((o) => {
    const n = norm(o);
    return n && (startsWith(a, n) || startsWith(n, a));
  });
  return close.length === 1 ? close[0]! : null;
}

/** The options a "check all that apply" answer picks: one per comma, semicolon or line. Null if any part matches nothing. */
export function matchOptions(answer: string, options: readonly string[]): string[] | null {
  const whole = options.find((o) => norm(o) === norm(answer));
  if (whole) return [whole];
  const parts = answer.split(/[,;\n]/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const picked: string[] = [];
  for (const p of parts) {
    const o = options.find((x) => norm(x) === norm(p));
    if (!o) return null;
    if (!picked.includes(o)) picked.push(o);
  }
  return picked;
}

function linkFor(links: readonly string[], kind: "linkedin" | "github" | "twitter" | "website"): string | null {
  const host = (l: string) => {
    try {
      return new URL(l).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  };
  const social: Record<string, (h: string) => boolean> = {
    linkedin: (h) => h === "linkedin.com" || h.endsWith(".linkedin.com"),
    github: (h) => h === "github.com",
    twitter: (h) => h === "twitter.com" || h === "x.com",
  };
  if (kind !== "website") return links.find((l) => social[kind]!(host(l))) ?? null;
  return links.find((l) => host(l) && !Object.values(social).some((is) => is(host(l)))) ?? null;
}

function profileValue(standard: StandardField, s: FillSources): string | null {
  const c = s.contact;
  switch (standard) {
    case "name":
      return c.name || null;
    case "email":
      return c.email || null;
    case "phone":
      return c.phone || null;
    case "location":
      return c.location || null;
    case "currentCompany":
      return s.currentCompany;
    case "linkedin":
    case "github":
    case "twitter":
    case "website":
      return linkFor(c.links ?? [], standard);
    case "resume":
    case "coverLetterText":
      return null;
  }
}

/** The AnswerBank answer for a question, shaped to the field, or null when it doesn't fit. */
function answerFor(field: FormField, answer: string): string | string[] | null {
  const options = field.options ?? [];
  if (field.kind === "choice" || field.kind === "select") return matchOption(answer, options);
  if (field.kind === "multi") return matchOptions(answer, options);
  return answer.trim() || null;
}

export async function planFill(fields: readonly FormField[], s: FillSources): Promise<FillPlan> {
  const plan: FillPlan = { fills: [], uploads: [], unknown: [], skipped: [] };
  for (const field of fields) {
    if (field.standard === "resume") {
      plan.uploads.push(field);
      continue;
    }
    if (field.standard === "coverLetterText") {
      if (s.letterText) plan.fills.push({ field, value: { value: s.letterText, source: "document" } });
      else plan.skipped.push(field);
      continue;
    }
    if (field.kind === "file" || field.kind === "other") {
      plan.skipped.push(field);
      continue;
    }
    const fromProfile = field.standard ? profileValue(field.standard, s) : null;
    if (fromProfile) {
      plan.fills.push({ field, value: { value: fromProfile, source: "profile" } });
      continue;
    }
    // Anything the Profile can't answer, including a standard field it lacks, is an AnswerBank question.
    const answer = await s.lookup(field.label);
    const value = answer === null ? null : answerFor(field, answer);
    if (value !== null) plan.fills.push({ field, value: { value, source: "answerBank" } });
    else (field.required ? plan.unknown : plan.skipped).push(field);
  }
  return plan;
}
