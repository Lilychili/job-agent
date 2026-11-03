import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

const envFile = new URL("../../.env", import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  test: {
    // DB tests share one test database, so run files one at a time.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
