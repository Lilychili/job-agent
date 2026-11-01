// The ~10 questions application forms keep asking (docs/MVP_SCOPE.md). Seeded with empty answers:
// an empty answer means "not answered yet", and lookups ignore it, so the Shipper raises a Blocker.
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
