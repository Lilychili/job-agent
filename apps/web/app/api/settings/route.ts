import { eq } from "drizzle-orm";
import { encryptionKeyFromEnv, encryptSecret, last4, parseModel, ValidationError } from "@jobagent/core";
import { settings } from "@jobagent/db";
import { loadSettingsView } from "@/lib/data";
import { readBody, route } from "@/lib/route";
import { ensureSettingsRow } from "@/lib/server-secrets";
import { getDb } from "@/lib/server";

/** PUT { provider?, apiKey?, defaultModel? }. The key is encrypted before it touches the database and is not echoed back. */
export const PUT = route(async (req) => {
  const b = await readBody<{ provider: unknown; apiKey: unknown; defaultModel: unknown }>(req);
  const row = await ensureSettingsRow();
  const patch: Partial<typeof settings.$inferInsert> = {};

  if (typeof b.apiKey === "string" && b.apiKey.trim()) {
    const apiKey = b.apiKey.trim();
    if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(apiKey)) {
      throw new ValidationError("That doesn't look like an Anthropic API key (it starts with sk-).");
    }
    patch.encryptedApiKey = encryptSecret(apiKey, encryptionKeyFromEnv());
    patch.apiKeyLast4 = last4(apiKey);
  }
  if (b.provider !== undefined) {
    if (b.provider !== "api" && b.provider !== "cli") throw new ValidationError("Choose Claude Code or an API key.");
    patch.aiProvider = b.provider;
  }
  if (b.defaultModel !== undefined) patch.defaultModel = parseModel(b.defaultModel);

  if (Object.keys(patch).length) await getDb().update(settings).set(patch).where(eq(settings.id, row.id));
  return Response.json(await loadSettingsView());
});

export const DELETE = route(async () => {
  const row = await ensureSettingsRow();
  await getDb().update(settings).set({ encryptedApiKey: null, apiKeyLast4: null }).where(eq(settings.id, row.id));
  return Response.json(await loadSettingsView());
});
