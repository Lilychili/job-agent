import "server-only";
import { decryptSecret, encryptionKeyFromEnv } from "@jobagent/core";
import { settings } from "@jobagent/db";
import { getDb } from "./server";

/** The settings row, created on first use (there is exactly one). */
export async function ensureSettingsRow() {
  const db = getDb();
  const [existing] = await db.select().from(settings).limit(1);
  if (existing) return existing;
  await db.insert(settings).values({}).onConflictDoNothing();
  const [row] = await db.select().from(settings).limit(1);
  return row!;
}

/** Decrypt the stored Claude key for a server-side call. Never send the result to the browser. */
export async function readApiKey(): Promise<string | null> {
  const [s] = await getDb().select().from(settings).limit(1);
  return s?.encryptedApiKey ? decryptSecret(s.encryptedApiKey, encryptionKeyFromEnv()) : null;
}
