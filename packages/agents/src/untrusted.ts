/**
 * Wrap attacker-controllable text (a CV, a job posting, a form page) for a prompt, per docs/SECURITY.md §1.
 * Anything that looks like one of our tags is broken up first, so the text can't close its own
 * wrapper and pose as instructions.
 */
export function wrapUntrusted(kind: "cv" | "posting" | "page", text: string): string {
  const safe = text.replace(/<(\/?)\s*untrusted/gi, "<$1 (escaped) untrusted");
  return `<untrusted_${kind}>\n${safe}\n</untrusted_${kind}>`;
}
