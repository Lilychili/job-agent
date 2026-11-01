// CV → structured Profile draft. Reads text in code, asks Claude for structure (via the API or the
// owner's Claude Code CLI), then validates and assigns fact ids in code. The result is a draft:
// nothing uses it until the owner confirms.
import { parseFacts, ValidationError } from "@jobagent/core";
import type { Contact, ProfileFact } from "@jobagent/db";
import { createMessage, type ContentBlock, type Usage } from "./claude";
import { runClaudeCli } from "./cli";
import { loadPrompt } from "./prompts";
import { wrapUntrusted } from "./untrusted";

const MAX_CV_CHARS = 60_000;

/** How to reach Claude: a pay-per-use API key, or the owner's signed-in Claude Code CLI. */
export type Auth = { kind: "api"; apiKey: string } | { kind: "cli" };

/** Read the text of a PDF or DOCX. The format is decided by the file's bytes, not its name. */
export async function extractCvText(buf: Buffer): Promise<string> {
  const head = buf.subarray(0, 4).toString("latin1");
  let text: string;
  if (head === "%PDF") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    text = (await extractText(pdf, { mergePages: true })).text;
  } else if (head.startsWith("PK")) {
    const mammoth = await import("mammoth");
    text = (await mammoth.extractRawText({ buffer: buf })).value;
  } else {
    throw new Error("Only PDF and DOCX files are supported.");
  }
  text = text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < 40) {
    throw new Error("Couldn't read any text from this file. If it's a scan, export a text-based PDF instead.");
  }
  return text.slice(0, MAX_CV_CHARS);
}

const SCHEMA = {
  type: "object",
  required: ["contact", "facts"],
  properties: {
    contact: {
      type: "object",
      required: ["name", "email"],
      properties: {
        name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        location: { type: "string" },
        links: { type: "array", items: { type: "string" } },
      },
    },
    facts: {
      type: "array",
      items: {
        type: "object",
        required: ["kind", "text"],
        properties: {
          kind: { type: "string", enum: ["role", "skill", "education", "achievement", "cert", "language"] },
          text: { type: "string" },
          org: { type: "string" },
          startDate: { type: "string", description: "YYYY or YYYY-MM" },
          endDate: { type: "string", description: "YYYY or YYYY-MM; omit if current" },
        },
      },
    },
  },
} as const;

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** A draft contact: keep whatever the CV had. The owner fixes gaps in the editor, which validates on save. */
function draftContact(raw: unknown): Contact {
  const c = (raw ?? {}) as Record<string, unknown>;
  const links = (Array.isArray(c.links) ? c.links : []).map(text).filter(Boolean);
  return {
    name: text(c.name),
    email: text(c.email),
    ...(text(c.phone) && { phone: text(c.phone) }),
    ...(text(c.location) && { location: text(c.location) }),
    links,
  };
}

interface ExtractionResult {
  contact: Contact;
  facts: ProfileFact[];
  usage: Usage;
  /** API list price of the run. Only known for Claude Code, and only informational on a subscription. */
  listCostUsd: number;
  model: string;
  promptVersion: string;
}

const add = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
});

/** One round trip to Claude through whichever provider is configured; returns the structured answer. */
async function ask(
  auth: Auth,
  model: string,
  system: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<{ output: unknown; usage: Usage; listCostUsd: number }> {
  if (auth.kind === "cli") {
    const res = await runClaudeCli({ system, prompt, schema: SCHEMA, model, signal });
    return { output: res.structured, usage: res.usage, listCostUsd: res.listCostUsd };
  }
  const res = await createMessage({
    apiKey: auth.apiKey,
    model,
    system,
    prompt,
    maxTokens: 8000,
    tool: { name: "submit_profile", description: "Submit the structured Profile extracted from the CV.", input_schema: SCHEMA },
    signal,
  });
  const call = res.content.find((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use");
  return { output: call?.input ?? null, usage: res.usage, listCostUsd: 0 };
}

export async function extractProfile(opts: {
  auth: Auth;
  model: string;
  cvText: string;
  signal?: AbortSignal;
  log?: (m: string) => Promise<void> | void;
}): Promise<ExtractionResult> {
  const { system, version } = loadPrompt("extractor");
  const base = `${wrapUntrusted("cv", opts.cvText)}\n\nExtract the Profile from this CV.`;
  let prompt = base;
  let usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let listCostUsd = 0;

  // One repair retry on invalid output, then fail (docs/ARCHITECTURE.md).
  for (let attempt = 0; ; attempt++) {
    const res = await ask(opts.auth, opts.model, system, prompt, opts.signal);
    usage = add(usage, res.usage);
    listCostUsd += res.listCostUsd;
    try {
      const out = res.output as { contact?: unknown; facts?: unknown } | null;
      if (!out || typeof out !== "object") throw new ValidationError("No profile was returned.");
      return { contact: draftContact(out.contact), facts: parseFacts(out.facts), usage, listCostUsd, model: opts.model, promptVersion: version };
    } catch (err) {
      if (!(err instanceof ValidationError) || attempt >= 1) throw err;
      await opts.log?.(`Output was invalid (${err.message}); asking once more.`);
      prompt = `${base}\n\nYour previous answer was rejected: ${err.message} Return a corrected Profile.`;
    }
  }
}
