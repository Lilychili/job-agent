// Reads the mail that names a company the owner applied to. Claude gets no tools and only labels each email;
// code decides whether a label may move a card: the company must be named in the email, and only a reply or
// a rejection counts.
import { htmlToText } from "@jobagent/ats";
import { askClaude, type Auth } from "./ask";
import type { Usage } from "./claude";
import { loadPrompt } from "./prompts";
import { copiedFrom, wrapUntrusted } from "./untrusted";

const MAX_EMAIL_CHARS = 4000;
const KINDS = ["reply", "rejection", "acknowledgement", "unrelated"] as const;

export type EmailKind = (typeof KINDS)[number];

export interface ReplyEmail {
  id: string;
  from: string;
  subject: string;
  receivedAt: Date;
  html: string;
}

const SCHEMA = {
  type: "object",
  required: ["emails"],
  properties: {
    emails: {
      type: "array",
      items: {
        type: "object",
        required: ["number", "kind"],
        properties: { number: { type: "integer", description: "The email's number." }, kind: { type: "string", enum: KINDS } },
      },
    },
  },
} as const;

const textOf = (e: ReplyEmail) => htmlToText(e.html).slice(0, MAX_EMAIL_CHARS);

/** One kind per email, in order. An email Claude left out, or labelled oddly, or that never names the company, is unrelated. */
export function parseKinds(output: unknown, emails: ReplyEmail[], company: string): EmailKind[] {
  const given = new Map<number, EmailKind>();
  const list = (output as { emails?: unknown } | null)?.emails;
  for (const item of Array.isArray(list) ? (list as Record<string, unknown>[]) : []) {
    const n = item?.number;
    if (typeof n === "number" && Number.isInteger(n) && KINDS.includes(item.kind as EmailKind)) given.set(n, item.kind as EmailKind);
  }
  return emails.map((e, i) => {
    const kind = given.get(i + 1) ?? "unrelated";
    // Gmail's search also matches a word in a link or a quoted thread; the message itself must name the company.
    return copiedFrom(company, `${e.from} ${e.subject} ${textOf(e)}`) ? kind : "unrelated";
  });
}

/** What the newest reply or rejection says about the card, if anything. Emails are newest first, as Gmail gives them. */
export function decide(kinds: EmailKind[], status: "applied" | "replied"): { move: "markReplied" | "markRejected"; index: number } | null {
  const index = kinds.findIndex((k) => k === "reply" || k === "rejection");
  if (index < 0) return null;
  if (kinds[index] === "rejection") return { move: "markRejected", index };
  return status === "applied" ? { move: "markReplied", index } : null;
}

export async function classifyEmails(opts: {
  auth: Auth;
  model: string;
  company: string;
  title: string;
  emails: ReplyEmail[];
  signal?: AbortSignal;
}): Promise<{ kinds: EmailKind[]; usage: Usage; listCostUsd: number; promptVersion: string }> {
  const { system, version } = loadPrompt("replies");
  const body = opts.emails.map((e, i) => `Email ${i + 1}\nFrom: ${e.from}\nSubject: ${e.subject}\n\n${textOf(e)}`).join("\n\n---\n\n");
  const res = await askClaude({
    auth: opts.auth,
    model: opts.model,
    system,
    prompt: `Company: ${opts.company}\nJob title: ${opts.title}\n\n${wrapUntrusted("email", body)}\n\nLabel every email.`,
    schema: SCHEMA,
    tool: { name: "submit_kinds", description: "Submit what each email is." },
    maxTokens: 1000,
    signal: opts.signal,
  });
  return { kinds: parseKinds(res.output, opts.emails, opts.company), usage: res.usage, listCostUsd: res.listCostUsd, promptVersion: version };
}
