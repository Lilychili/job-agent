// Runs the owner's own Claude Code CLI in print mode, so work is billed to their Claude subscription
// instead of a pay-per-use API key. This is a local, single-user app driving the owner's own signed-in
// CLI; usage counts against their subscription limits.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { usageFrom, type Usage } from "./claude";

export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

/**
 * The CLI executable. `CLAUDE_CLI_PATH` wins. On Windows the npm shim (`claude.cmd`) can't be spawned
 * without a shell, so look for the native binary next to it. Elsewhere `claude` on PATH is fine.
 */
export function resolveClaudeCli(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CLAUDE_CLI_PATH) return env.CLAUDE_CLI_PATH;
  if (process.platform !== "win32") return "claude";
  for (const dir of (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean)) {
    const native = path.join(dir, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
    if (existsSync(native)) return native;
    const direct = path.join(dir, "claude.exe");
    if (existsSync(direct)) return direct;
  }
  return "claude.exe";
}

interface CliRequest {
  prompt: string;
  system?: string;
  /** JSON Schema: the CLI validates its answer against this and returns it as `structured`. */
  schema?: object;
  model?: string;
  signal?: AbortSignal;
}

interface CliResult {
  structured: unknown;
  usage: Usage;
  /** What the run would have cost at API list prices. Informational: a subscription isn't billed per call. */
  listCostUsd: number;
}

interface CliJson {
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  total_cost_usd?: number;
  usage?: Record<string, number>;
}

/** Never let an API key in our environment turn a subscription run into a pay-per-use one. */
export function cliEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const clean = { ...env };
  for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX"]) delete clean[k];
  return clean;
}

export function cliArgs(req: CliRequest): string[] {
  const args = [
    "-p",
    "--output-format",
    "json",
    "--no-session-persistence",
    "--tools",
    "", // no tools: this is a pure text-in, structure-out call
    "--disable-slash-commands",
    "--strict-mcp-config", // don't attach the owner's connectors (Gmail, Drive…) to a run fed untrusted text
  ];
  if (req.system) args.push("--system-prompt", req.system);
  if (req.schema) args.push("--json-schema", JSON.stringify(req.schema));
  if (req.model) args.push("--model", req.model);
  return args;
}

export async function runClaudeCli(req: CliRequest): Promise<CliResult> {
  // A fresh, empty directory per run, so no project CLAUDE.md or settings leak into the call.
  const cwd = await mkdtemp(path.join(os.tmpdir(), "jobagent-claude-"));
  try {
    return await spawnCli(req, cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true }).catch(() => {});
  }
}

async function spawnCli(req: CliRequest, cwd: string): Promise<CliResult> {
  const child = spawn(resolveClaudeCli(), cliArgs(req), {
    cwd,
    env: cliEnv(),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  const onAbort = () => child.kill();
  req.signal?.addEventListener("abort", onAbort, { once: true });

  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", (err: NodeJS.ErrnoException) =>
      reject(
        err.code === "ENOENT"
          ? new CliError("Claude Code isn't installed (or isn't on PATH). Install it with `npm i -g @anthropic-ai/claude-code`, or set CLAUDE_CLI_PATH in .env.")
          : err,
      ),
    );
    child.on("close", resolve);
    child.stdin.on("error", () => {}); // the child may exit before reading everything
    child.stdin.end(req.prompt);
  }).finally(() => req.signal?.removeEventListener("abort", onAbort));

  if (req.signal?.aborted) throw req.signal.reason ?? new CliError("Cancelled.");

  let json: CliJson | null = null;
  try {
    json = JSON.parse(stdout) as CliJson;
  } catch {
    // fall through to the error below
  }
  const text = (json?.result ?? "").trim();
  if (!json || json.is_error || code !== 0) {
    const detail = text || stderr.trim() || stdout.trim().slice(0, 300) || `exit code ${code}`;
    if (/not logged in|\/login|authenticat|invalid api key/i.test(detail)) {
      throw new CliError("Claude Code isn't signed in. Open a terminal, run `claude`, and sign in with your Claude account.");
    }
    throw new CliError(`Claude Code failed: ${detail}`);
  }

  return { structured: json.structured_output ?? null, listCostUsd: json.total_cost_usd ?? 0, usage: usageFrom(json.usage) };
}

/** One tiny call to prove the CLI is installed and signed in. */
export async function testCli(): Promise<{ model: string }> {
  const model = "haiku";
  await runClaudeCli({
    prompt: "Reply with the JSON.",
    model,
    schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
  });
  return { model };
}
