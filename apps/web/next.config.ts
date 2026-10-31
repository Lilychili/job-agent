import { existsSync } from "node:fs";
import type { NextConfig } from "next";

// One .env at the repo root for web and worker.
const rootEnv = new URL("../../.env", import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const config: NextConfig = {
  transpilePackages: ["@jobagent/core", "@jobagent/db", "@jobagent/queue"],
  serverExternalPackages: ["pg", "pg-boss"],
};

export default config;
