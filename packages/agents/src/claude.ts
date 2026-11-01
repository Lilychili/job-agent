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
  maxTokens: number;
  /** When set, Claude must answer by calling this tool. */
  tool?: { name: string; description: string; input_schema: object };
  signal?: AbortSignal;
}

export class ClaudeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeError";
  }
}

export async function createMessage(req: MessagesRequest): Promise<{ content: ContentBlock[]; usage: Usage }> {
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: req.signal,
      headers: { "content-type": "application/json", "x-api-key": req.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: "user", content: req.prompt }],
        tools: req.tool && [req.tool],
        tool_choice: req.tool && { type: "tool", name: req.tool.name },
      }),
    });
  } catch (err) {
    if (req.signal?.aborted) throw req.signal.reason ?? err;
    throw new ClaudeError("Could not reach the Anthropic API. Check your internet connection.");
  }
  const body = (await res.json().catch(() => null)) as {
    content?: ContentBlock[];
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
  return { content: body?.content ?? [], usage: usageFrom(body?.usage) };
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
