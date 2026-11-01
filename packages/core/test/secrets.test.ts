import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptionKeyFromEnv, encryptSecret, last4, maskKey } from "../src/secrets";

const key = randomBytes(32);

describe("secrets", () => {
  it("round-trips and never stores the plaintext", () => {
    const stored = encryptSecret("sk-ant-api03-abcdef1234", key);
    expect(stored).not.toContain("abcdef1234");
    expect(stored.startsWith("v1:")).toBe(true);
    expect(decryptSecret(stored, key)).toBe("sk-ant-api03-abcdef1234");
  });

  it("uses a fresh IV each time", () => {
    expect(encryptSecret("same", key)).not.toBe(encryptSecret("same", key));
  });

  it("fails on the wrong key or tampered data", () => {
    const stored = encryptSecret("secret", key);
    expect(() => decryptSecret(stored, randomBytes(32))).toThrow(/Could not decrypt/);
    const [v, iv, tag, ct] = stored.split(":");
    const flipped = Buffer.from(ct!, "base64");
    flipped[0] = flipped[0]! ^ 1;
    expect(() => decryptSecret([v, iv, tag, flipped.toString("base64")].join(":"), key)).toThrow(/Could not decrypt/);
    expect(() => decryptSecret("garbage", key)).toThrow(/Unrecognized/);
  });

  it("validates APP_ENCRYPTION_KEY", () => {
    expect(() => encryptionKeyFromEnv({})).toThrow(/not set/);
    expect(() => encryptionKeyFromEnv({ APP_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") })).toThrow(/32 bytes/);
    expect(encryptionKeyFromEnv({ APP_ENCRYPTION_KEY: key.toString("base64") })).toEqual(key);
  });

  it("only ever exposes the last four characters", () => {
    expect(maskKey(last4("sk-ant-api03-abcdef1234"))).toBe("sk-…1234");
    expect(maskKey(null)).toBeNull();
  });
});
