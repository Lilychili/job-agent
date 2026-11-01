import { readFileSync } from "node:fs";
import path from "node:path";
import { repoRoot, sha256 } from "@jobagent/core";

/** `agents/<role>/agent.md` + the shared security rules, with a short content hash to record on the AgentRun. */
export function loadPrompt(role: string): { system: string; version: string } {
  const root = repoRoot();
  const system = [
    readFileSync(path.join(root, "agents", role, "agent.md"), "utf8"),
    readFileSync(path.join(root, "agents", "shared", "security-rules.md"), "utf8"),
  ].join("\n\n");
  return { system, version: sha256(system).slice(0, 12) };
}
