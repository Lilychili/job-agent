import { existsSync } from "node:fs";
import type { NextConfig } from "next";

// One .env at the repo root for web and worker.
const rootEnv = new URL("../../.env", import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const config: NextConfig = {
  transpilePackages: ["@jobagent/core", "@jobagent/db", "@jobagent/queue", "@jobagent/agents"],
  serverExternalPackages: ["pg", "pg-boss", "unpdf", "mammoth"],
  redirects: () => [
    { source: "/blockers", destination: "/questions", permanent: false },
    { source: "/answers", destination: "/questions", permanent: false },
    { source: "/preferences", destination: "/profile/looking-for", permanent: false },
  ],
};

export default config;
