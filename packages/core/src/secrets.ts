// AES-256-GCM for the Claude API key (docs/SECURITY.md §2). The key comes from APP_ENCRYPTION_KEY.
// Stored format: "v1:<iv>:<tag>:<ciphertext>", each part base64.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

/** The app is misconfigured: the message tells the owner what to change. Safe to show. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** 32 bytes, base64: `openssl rand -base64 32`. */
export function encryptionKeyFromEnv(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env.APP_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new ConfigError("APP_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and add it to .env.");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new ConfigError("APP_ENCRYPTION_KEY must be 32 bytes, base64-encoded (`openssl rand -base64 32`).");
  }
  return key;
}

export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decryptSecret(stored: string, key: Buffer): string {
  const [version, iv, tag, ct] = stored.split(":");
  if (version !== VERSION || !iv || !tag || !ct) throw new Error("Unrecognized secret format.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  try {
    return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
  } catch {
    // Wrong key or tampered data. Don't leak which.
    throw new ConfigError("Could not decrypt the stored key. Was APP_ENCRYPTION_KEY changed? Enter the API key again.");
  }
}

export function last4(secret: string): string {
  return secret.slice(-4);
}

/** What the UI may show about a key: never the key itself. */
export function maskKey(l4: string | null | undefined): string | null {
  return l4 ? `sk-…${l4}` : null;
}
