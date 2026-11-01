// The ~10 questions application forms keep asking (docs/MVP_SCOPE.md). Seeded with empty answers:
// an empty answer means "not answered yet", and lookups ignore it, so the Shipper raises a Blocker.
// The rules below run in the browser too, so this file imports only types and ./normalize.
import type { Pool } from "pg";
import type { answerKind } from "@jobagent/db";
import { questionKey } from "./normalize";

type Kind = (typeof answerKind.enumValues)[number];

export interface DefaultQuestion {
  question: string;
  kind: Kind;
  hint: string;
  variants: string[];
}

export const DEFAULT_QUESTIONS: readonly DefaultQuestion[] = [
  {
    question: "Why do you want to work at this company?",
    kind: "text",
    hint: "A reusable template. Pen adapts it per job; never invent company facts.",
    variants: ["Why are you interested in this role?", "Why us?"],
  },
  { question: "How many years of professional experience do you have?", kind: "number", hint: "A number.", variants: ["Years of experience"] },
  {
    question: "Are you legally authorized to work in this country?",
    kind: "choice",
    hint: "Yes / No, plus detail if it differs by country.",
    variants: ["Work authorization", "Right to work"],
  },
  {
    question: "Will you now or in the future require visa sponsorship?",
    kind: "choice",
    hint: "Yes / No.",
    variants: ["Do you require sponsorship?"],
  },
  { question: "What is your notice period?", kind: "text", hint: "e.g. 1 month, or available immediately.", variants: ["When can you start?", "Earliest start date"] },
  {
    question: "What are your salary expectations?",
    kind: "text",
    hint: "Amount and currency, e.g. 70,000 EUR gross per year.",
    variants: ["Expected salary", "Desired compensation"],
  },
  { question: "Are you open to relocation?", kind: "choice", hint: "Yes / No / Depends.", variants: ["Willing to relocate?"] },
  {
    question: "I consent to the processing of my personal data for this application.",
    kind: "consent",
    hint: "Yes or No. Consent boxes are never ticked without an explicit answer here.",
    variants: ["Data processing consent", "Privacy policy consent"],
  },
  { question: "What are your pronouns?", kind: "text", hint: "Optional. Leave empty to be asked each time.", variants: ["Preferred pronouns"] },
  { question: "How did you hear about this position?", kind: "text", hint: "e.g. Company website.", variants: ["Where did you find this job?", "Source"] },
  { question: "LinkedIn profile URL", kind: "text", hint: "A link.", variants: ["LinkedIn", "LinkedIn URL"] },
  { question: "Portfolio or website URL", kind: "text", hint: "A link.", variants: ["Website", "Portfolio", "Personal website"] },
];

/** Insert any default question that isn't there yet. Never touches answers the owner has written. */
export async function ensureAnswerDefaults(pool: Pick<Pool, "query">): Promise<number> {
  const { rowCount } = await pool.query(
    `insert into answer_bank (question_key, question_variants, answer, kind, reusable)
     select key, array[question] || string_to_array(variants, '|'), '', kind::answer_kind, true
       from unnest($1::text[], $2::text[], $3::text[], $4::text[]) as t(key, question, variants, kind)
     on conflict (question_key) do nothing`,
    [
      DEFAULT_QUESTIONS.map((q) => questionKey(q.question)),
      DEFAULT_QUESTIONS.map((q) => q.question),
      DEFAULT_QUESTIONS.map((q) => q.variants.join("|")),
      DEFAULT_QUESTIONS.map((q) => q.kind),
    ],
  );
  return rowCount ?? 0;
}

/** Hint text for a seeded question, keyed the same way as the AnswerBank. */
export const DEFAULT_HINTS: Record<string, string> = Object.fromEntries(
  DEFAULT_QUESTIONS.map((q) => [questionKey(q.question), q.hint]),
);

export const MAX_QUESTION_CHARS = 200;
export const MAX_SHORT_ANSWER_CHARS = 200;
export const MAX_LONG_ANSWER_CHARS = 2000;
const MAX_LINK_CHARS = 300;
const MAX_NUMBER_CHARS = 10;

export type AnswerRule = { format: "text" | "number" | "link" | "yes-no"; maxChars: number };

const SHORT_DEFAULT_KEYS = new Set(
  DEFAULT_QUESTIONS.filter((q) => q.kind === "text" && questionKey(q.question) !== "why_this_company").map((q) => questionKey(q.question)),
);

/** What a valid answer looks like. Questions you add and Blocker answers can be long. */
export function answerRule(key: string, kind: Kind): AnswerRule {
  if (kind === "consent") return { format: "yes-no", maxChars: 3 };
  if (kind === "number") return { format: "number", maxChars: MAX_NUMBER_CHARS };
  if (key === "linkedin" || key === "website") return { format: "link", maxChars: MAX_LINK_CHARS };
  if (kind === "text" && !SHORT_DEFAULT_KEYS.has(key)) return { format: "text", maxChars: MAX_LONG_ANSWER_CHARS };
  return { format: "text", maxChars: MAX_SHORT_ANSWER_CHARS };
}

function isLink(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    return new URL(value).hostname.includes(".");
  } catch {
    return false;
  }
}

/** The problem with an answer, or null when it's fine. Empty is fine: it means "not answered yet". */
export function checkAnswer(rule: AnswerRule, answer: string): string | null {
  const value = answer.trim();
  if (!value) return null;
  if (rule.format === "yes-no") return /^(yes|no)$/i.test(value) ? null : "Choose Yes or No.";
  if (value.length > rule.maxChars) return `Too long: ${value.length.toLocaleString("en")} of ${rule.maxChars.toLocaleString("en")} characters.`;
  if (rule.format === "number" && !/^\d+([.,]\d+)?$/.test(value)) return "Enter a number, e.g. 5.";
  if (rule.format === "link" && !isLink(value)) return "Enter a full link starting with https://";
  return null;
}
