import { decryptSecret, encryptionKeyFromEnv } from "@jobagent/core";
import type { Auth } from "./ask";

/** Turn the settings row into credentials for a call. Throws a plain-English error if it isn't set up. */
export function authFromSettings(s: { aiProvider?: string | null; encryptedApiKey?: string | null } | undefined): Auth {
  if (s?.aiProvider === "cli") return { kind: "cli" };
  if (!s?.encryptedApiKey) {
    throw new Error("Connect Claude in Settings first: sign in with Claude Code, or add an API key.");
  }
  return { kind: "api", apiKey: decryptSecret(s.encryptedApiKey, encryptionKeyFromEnv()) };
}
