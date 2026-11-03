// One structured round trip to Claude, through whichever provider the owner chose.
import { createMessage, type ContentBlock, type Usage } from "./claude";
import { runClaudeCli } from "./cli";

/** How to reach Claude: a pay-per-use API key, or the owner's signed-in Claude Code CLI. */
export type Auth = { kind: "api"; apiKey: string } | { kind: "cli" };

/** Turns, not searches: the CLI has no search cap of its own. */
const MAX_SEARCH_TURNS_CLI = 12;

export const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

export const addUsage = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
});

export async function askClaude(req: {
  auth: Auth;
  model: string;
  system: string;
  prompt: string;
  /** The start of the prompt that repeats across calls. Cached on the API; put in front of `prompt` for Claude Code. */
  sharedPrefix?: string;
  schema: object;
  tool: { name: string; description: string };
  maxTokens: number;
  /** Let Claude search the web before it answers. */
  webSearch?: boolean;
  signal?: AbortSignal;
}): Promise<{ output: unknown; usage: Usage; listCostUsd: number }> {
  const { auth, model, system, prompt, sharedPrefix, schema, tool, maxTokens, webSearch, signal } = req;
  if (auth.kind === "cli") {
    const res = await runClaudeCli({ system, prompt: sharedPrefix ? `${sharedPrefix}\n\n${prompt}` : prompt, schema, model, tools: webSearch ? ["WebSearch"] : undefined, maxTurns: webSearch ? MAX_SEARCH_TURNS_CLI : undefined, signal });
    return { output: res.structured, usage: res.usage, listCostUsd: res.listCostUsd };
  }
  if (webSearch) return askWithWebSearch({ ...req, auth });
  const res = await createMessage({ apiKey: auth.apiKey, model, system, prompt, sharedPrefix, maxTokens, tool: { ...tool, input_schema: schema }, signal });
  const call = res.content.find((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use");
  return { output: call?.input ?? null, usage: res.usage, listCostUsd: 0 };
}

const MAX_SEARCH_TURNS = 6;
const MAX_SEARCHES = 8;

/** Claude searches as it likes, then submits through `tool`. One more nudge if it answers in prose instead. */
async function askWithWebSearch(req: Parameters<typeof askClaude>[0] & { auth: { kind: "api"; apiKey: string } }) {
  const { auth, model, system, prompt, schema, tool, maxTokens, signal } = req;
  const messages: { role: "user" | "assistant"; content: unknown }[] = [{ role: "user", content: prompt }];
  let usage = NO_USAGE;
  let searches = 0;
  let force = false;
  for (let turn = 0; turn < MAX_SEARCH_TURNS; turn++) {
    const res = await createMessage({
      apiKey: auth.apiKey,
      model,
      system,
      prompt,
      messages,
      maxTokens,
      tool: { ...tool, input_schema: schema },
      // max_uses counts per request, so the budget for the whole conversation is kept here.
      webSearch: { maxUses: Math.max(1, MAX_SEARCHES - searches) },
      toolChoice: force ? "force" : "auto",
      signal,
    });
    usage = addUsage(usage, res.usage);
    const call = res.content.find((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use" && b.name === tool.name);
    if (call) return { output: call.input, usage, listCostUsd: 0 };
    searches += res.raw.filter((b) => (b as { type?: string }).type === "server_tool_use").length;
    force = searches >= MAX_SEARCHES || turn >= MAX_SEARCH_TURNS - 2;
    messages.push({ role: "assistant", content: res.raw });
    // pause_turn: the search is still running on Anthropic's side, so send it back to continue.
    if (res.stopReason !== "pause_turn" || force) messages.push({ role: "user", content: `Now submit what you found by calling ${tool.name}.` });
  }
  return { output: null, usage, listCostUsd: 0 };
}
