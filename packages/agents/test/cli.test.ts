import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { cliArgs, cliEnv, collectText, resolveClaudeCli } from "../src/cli";
import { authFromSettings } from "../src/provider";

describe("cliEnv", () => {
  it("removes anything that could turn a subscription run into a pay-per-use one", () => {
    const env = cliEnv({
      PATH: "/bin",
      ANTHROPIC_API_KEY: "sk-ant-secret",
      ANTHROPIC_AUTH_TOKEN: "tok",
      ANTHROPIC_BASE_URL: "https://proxy.example",
      CLAUDE_CODE_USE_FOUNDRY: "1",
      CLAUDE_CODE_USE_BEDROCK: "1",
      CLAUDE_CODE_USE_VERTEX: "1",
    });
    expect(env).toEqual({ PATH: "/bin" });
  });
});

describe("cliArgs", () => {
  it("runs print mode with no tools, no session, and passes system, schema and model as separate args", () => {
    const args = cliArgs({ prompt: "x", system: 'be "careful"; rm -rf', schema: { type: "object" }, model: "haiku" });
    expect(args).toEqual(expect.arrayContaining(["-p", "--no-session-persistence", "--disable-slash-commands", "--strict-mcp-config"]));
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args[args.indexOf("--setting-sources") + 1]).toBe("");
    expect(args[args.indexOf("--system-prompt") + 1]).toBe('be "careful"; rm -rf');
    expect(args[args.indexOf("--json-schema") + 1]).toBe('{"type":"object"}');
    expect(args[args.indexOf("--model") + 1]).toBe("haiku");
  });

  it("allows only the tools a step asks for", () => {
    const args = cliArgs({ prompt: "x", tools: ["WebSearch"] });
    expect(args[args.indexOf("--tools") + 1]).toBe("WebSearch");
    expect(args[args.indexOf("--allowedTools") + 1]).toBe("WebSearch");
    expect(cliArgs({ prompt: "x" })).not.toContain("--allowedTools");
    expect(cliArgs({ prompt: "x", maxTurns: 12 }).join(" ")).toContain("--max-turns 12");
  });

  it("never puts the user's prompt (the CV) on the command line", () => {
    expect(cliArgs({ prompt: "PRIVATE CV TEXT" }).join(" ")).not.toContain("PRIVATE");
  });
});

describe("collectText", () => {
  it("keeps a character whole when it is split across two chunks", async () => {
    const stream = new PassThrough();
    const out = collectText(stream);
    const name = Buffer.from("Лилия");
    stream.write(name.subarray(0, 3));
    stream.end(name.subarray(3));
    await new Promise((resolve) => stream.on("end", resolve));
    expect(out.text).toBe("Лилия");
  });
});

describe("resolveClaudeCli", () => {
  it("honours CLAUDE_CLI_PATH", () => {
    expect(resolveClaudeCli({ CLAUDE_CLI_PATH: "/opt/claude" })).toBe("/opt/claude");
  });
});

describe("authFromSettings", () => {
  it("uses the CLI when chosen, without needing a key", () => {
    expect(authFromSettings({ aiProvider: "cli", encryptedApiKey: null })).toEqual({ kind: "cli" });
  });
  it("explains what's missing for the API provider", () => {
    expect(() => authFromSettings({ aiProvider: "api", encryptedApiKey: null })).toThrow(/Connect Claude/);
    expect(() => authFromSettings(undefined)).toThrow(/Connect Claude/);
  });
});
