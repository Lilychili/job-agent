import { authFromSettings, DEFAULT_MODEL, type Auth, type Usage } from "@jobagent/agents";
import type { CoreContext } from "@jobagent/core";

/** The provider and model from Settings. Throws a plain-English error if Claude isn't connected. */
export async function claudeFromSettings(ctx: CoreContext): Promise<{ auth: Auth; model: string }> {
  const { rows } = await ctx.pool.query<{ ai_provider: string; encrypted_api_key: string | null; default_model: string | null }>(
    "select ai_provider, encrypted_api_key, default_model from settings limit 1",
  );
  return {
    auth: authFromSettings({ aiProvider: rows[0]?.ai_provider, encryptedApiKey: rows[0]?.encrypted_api_key }),
    model: rows[0]?.default_model || DEFAULT_MODEL,
  };
}

export async function saveUsage(ctx: CoreContext, runId: string, run: { model: string; promptVersion: string | null; usage: Usage }): Promise<void> {
  await ctx.pool.query(
    `update agent_run set model = $2, prompt_version = $3,
       input_tokens = $4, output_tokens = $5, cache_read_tokens = $6, cache_write_tokens = $7
     where id = $1`,
    [runId, run.model, run.promptVersion, run.usage.inputTokens, run.usage.outputTokens, run.usage.cacheReadTokens, run.usage.cacheWriteTokens],
  );
}
