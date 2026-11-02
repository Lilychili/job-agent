// Onboarding utility (docs/AGENTS.md "Extractor"): CV file → Profile draft stored on the run's output.
// It never writes the Profile itself: the owner loads the draft into the editor, edits and confirms.
import { readFile } from "node:fs/promises";
import { resolveDataPath } from "@jobagent/core";
import { extractCvText, extractProfile } from "@jobagent/agents";
import { claudeFromSettings, saveUsage } from "../claude";
import type { Outcome, RunHelpers } from "../runner";

export async function extractorExtract({ run, ctx, log, signal }: RunHelpers): Promise<Outcome> {
  const input = run.input as { file?: string; fileName?: string } | null;
  if (!input?.file) throw new Error("No CV file was attached to this run.");

  const { auth, model } = await claudeFromSettings(ctx);

  await log(`Reading ${input.fileName ?? "CV"}…`);
  const text = await extractCvText(await readFile(resolveDataPath(ctx, input.file)));
  await log(`Extracted ${text.length.toLocaleString()} characters. Asking ${model} (${auth.kind === "cli" ? "Claude Code" : "API"}) to structure them…`);

  const result = await extractProfile({ auth, model, cvText: text, signal, log });
  await saveUsage(ctx, run.id, result);
  await log(`Found ${result.facts.length} facts (${result.usage.inputTokens} in / ${result.usage.outputTokens} out tokens).`);
  return {
    kind: "succeeded",
    output: { contact: result.contact, facts: result.facts, sourceFile: input.file, listCostUsd: result.listCostUsd },
  };
}
