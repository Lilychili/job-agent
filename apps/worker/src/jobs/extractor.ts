// Onboarding utility (docs/AGENTS.md "Extractor"): CV file → Profile draft stored on the run's output.
// It never writes the Profile itself: the owner loads the draft into the editor, edits and confirms.
import { readFile } from "node:fs/promises";
import { resolveDataPath } from "@jobagent/core";
import { authFromSettings, DEFAULT_MODEL, extractCvText, extractProfile } from "@jobagent/agents";
import type { Outcome, RunHelpers } from "../runner";

export async function extractorExtract({ run, ctx, log, signal }: RunHelpers): Promise<Outcome> {
  const input = run.input as { file?: string; fileName?: string } | null;
  if (!input?.file) throw new Error("No CV file was attached to this run.");

  const { rows } = await ctx.pool.query<{ ai_provider: string; encrypted_api_key: string | null; default_model: string | null }>(
    "select ai_provider, encrypted_api_key, default_model from settings limit 1",
  );
  const auth = authFromSettings({ aiProvider: rows[0]?.ai_provider, encryptedApiKey: rows[0]?.encrypted_api_key });
  const model = rows[0]?.default_model || DEFAULT_MODEL;

  await log(`Reading ${input.fileName ?? "CV"}…`);
  const text = await extractCvText(await readFile(resolveDataPath(ctx, input.file)));
  await log(`Extracted ${text.length.toLocaleString()} characters. Asking ${model} (${auth.kind === "cli" ? "Claude Code" : "API"}) to structure them…`);

  const result = await extractProfile({ auth, model, cvText: text, signal, log });
  await ctx.pool.query(
    `update agent_run set model = $2, prompt_version = $3,
       input_tokens = $4, output_tokens = $5, cache_read_tokens = $6, cache_write_tokens = $7
     where id = $1`,
    [
      run.id,
      result.model,
      result.promptVersion,
      result.usage.inputTokens,
      result.usage.outputTokens,
      result.usage.cacheReadTokens,
      result.usage.cacheWriteTokens,
    ],
  );
  await log(`Found ${result.facts.length} facts (${result.usage.inputTokens} in / ${result.usage.outputTokens} out tokens).`);
  return {
    kind: "succeeded",
    output: { contact: result.contact, facts: result.facts, sourceFile: input.file, listCostUsd: result.listCostUsd },
  };
}
