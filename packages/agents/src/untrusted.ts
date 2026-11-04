/**
 * Wrap attacker-controllable text (a CV, a job posting, a form page) for a prompt, per docs/SECURITY.md §1.
 * Anything that looks like one of our tags is broken up first, so the text can't close its own
 * wrapper and pose as instructions.
 */
export function wrapUntrusted(kind: "cv" | "posting" | "page" | "email", text: string): string {
  const safe = text.replace(/<\s*(\/?)\s*untrusted/gi, "<$1 (escaped) untrusted");
  return `<untrusted_${kind}>\n${safe}\n</untrusted_${kind}>`;
}

/** A name has no use for these, and they are how text poses as markup or instructions. */
const NOT_A_NAME = /[<>{}\r\n]/;

/** Names go on to board lookups and prompts. */
export const isSafeName = (name: string) => !NOT_A_NAME.test(name);

const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Whether Claude's text really is in the source it says it copied from. */
export const copiedFrom = (text: string, source: string) => squash(source).includes(squash(text));

/** The same, for pay: it must also hold an amount, so "competitive" doesn't count. */
export const salaryCopiedFrom = (salary: string, source: string) => /\d/.test(salary) && copiedFrom(salary, source);
