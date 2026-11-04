import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

const envFile = new URL("../../.env", import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  test: {
    // Files run in parallel: each DB test file gets a database of its own (test/helpers.ts).
    testTimeout: 15_000,
    // Setup copies a database, and waits while another file builds the template the first time.
    hookTimeout: 60_000,
  },
});
