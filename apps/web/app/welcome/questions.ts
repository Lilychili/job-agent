/**
 * The questions onboarding asks: nearly every form has them and none has a safe default.
 * `question` must match the built-in AnswerBank text in packages/core/src/answers.ts.
 */
export const KEY_QUESTIONS = [
  { question: "Are you legally authorized to work in this country?", label: "Can you work where you're applying?", choices: ["Yes", "No"], placeholder: "Or add detail, e.g. Yes in the EU, no in the US" },
  { question: "Will you now or in the future require visa sponsorship?", label: "Will you need visa sponsorship?", choices: ["No", "Yes"], placeholder: "Or add detail" },
  { question: "What are your salary expectations?", label: "Salary expectations", placeholder: "e.g. 70,000 EUR gross per year" },
  { question: "What is your notice period?", label: "Notice period", choices: ["Available now", "2 weeks", "1 month", "3 months"], placeholder: "Or type your own" },
] as const satisfies readonly { question: string; label: string; choices?: readonly string[]; placeholder: string }[];

export type KeyQuestion = (typeof KEY_QUESTIONS)[number];
