import { defineConfig } from "vitest/config";
// The browser tests launch Chromium, which is slow on a cold start.
export default defineConfig({ test: { testTimeout: 30_000 } });
