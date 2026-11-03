// A thin Messages API client. Plain fetch keeps the key handling visible: the key is passed in
// per call by the code that just decrypted it, and is never logged or returned.

export const DEFAULT_MODEL = "claude-sonnet-5-5";
/** Cheapest model for the "Test connection" call. */
const TEST_MODEL = "claude-haiku-5-5";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export type ContentBlock = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown };

interface MessagesRequest {
  apiKey: string;
  model: string;
  system?: string;
  prompt: string;
  /** The start of `prompt` that repeats across calls (preferences, Profile facts). Cached, so later calls read it at a fraction of the cost. */
  sharedPrefix?: string;
  maxTokens: number;
  /** When set, Claude must answer by calling this tool. */
  tool?: { name: string; description: string; input_schema: object };
  /** Anthropic's web search, run on their side. Claude then picks between searching and `tool`. */
  webSearch?: { maxUses: number };
  /** A conversation to continue. Replaces `prompt`. */
  messages?: { role: "user" | "assistant"; content: unknown }[];
  /** Force `tool` (the default when it is set) or leave it to Claude. */
  toolChoice?: "force" | "auto";
  signal?: AbortSignal;
}

export class ClaudeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeError";
  }
}

function userContent({ prompt, sharedPrefix }: Pick<MessagesRequest, "prompt" | "sharedPrefix">) {
  if (!sharedPrefix) return prompt;
  return [
    { type: "text", text: sharedPrefix, cache_control: { type: "ephemeral" } },
    { type: "text", text: prompt },
  ];
}

export async function createMessage(
  req: MessagesRequest,
): Promise<{ content: ContentBlock[]; raw: unknown[]; stopReason: string | null; usage: Usage }> {
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: req.signal,
      headers: { "content-type": "application/json", "x-api-key": req.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens,
        // The tool and system prompt come first in the cached prefix, so one breakpoint on the system prompt covers both.
        system: req.system && [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        messages: req.messages ?? [{ role: "user", content: userContent(req) }],
        tools: (req.tool || req.webSearch) && [
          ...(req.webSearch ? [{ type: "web_search_20250305", name: "web_search", max_uses: req.webSearch.maxUses }] : []),
          ...(req.tool ? [req.tool] : []),
        ],
        tool_choice: req.tool && (req.toolChoice === "auto" ? { type: "auto" } : { type: "tool", name: req.tool.name }),
      }),
    });
  } catch (err) {
    if (req.signal?.aborted) throw req.signal.reason ?? err;
    throw new ClaudeError("Could not reach the Anthropic API. Check your internet connection.");
  }
  const body = (await res.json().catch(() => null)) as {
    content?: ContentBlock[];
    stop_reason?: string;
    usage?: Record<string, number>;
    error?: { message?: string };
  } | null;
  if (!res.ok) {
    const detail = body?.error?.message ?? res.statusText;
    if (res.status === 401) throw new ClaudeError("Anthropic rejected this API key (401).");
    if (res.status === 403) throw new ClaudeError(`This key isn't allowed to do that (403): ${detail}`);
    if (res.status === 404) throw new ClaudeError(`Model not available to this key: ${detail}`);
    if (res.status === 429) throw new ClaudeError("Rate limited by Anthropic (429). Try again in a minute.");
    throw new ClaudeError(`Anthropic API error ${res.status}: ${detail}`);
  }
  return { content: body?.content ?? [], raw: body?.content ?? [], stopReason: body?.stop_reason ?? null, usage: usageFrom(body?.usage) };
}

/** Both the API and Claude Code report usage with these field names. */
export function usageFrom(u: Record<string, number> = {}): Usage {
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
}

/** One tiny call (max_tokens 1) to prove the key works. */
export async function testApiKey(apiKey: string): Promise<{ model: string }> {
  await createMessage({ apiKey, model: TEST_MODEL, maxTokens: 1, prompt: "Hi" });
  return { model: TEST_MODEL };
}
