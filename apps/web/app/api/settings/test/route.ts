import { ClaudeError, CliError, testApiKey, testCli } from "@jobagent/agents";
import { ValidationError } from "@jobagent/core";
import { loadSettingsView } from "@/lib/data";
import { route } from "@/lib/route";
import { readApiKey } from "@/lib/server-secrets";

/** One tiny call through the chosen provider. Reports ok/error; never returns a key. */
export const POST = route(async () => {
  const { provider } = await loadSettingsView();
  try {
    if (provider === "cli") return Response.json({ ok: true, ...(await testCli()) });
    const apiKey = await readApiKey();
    if (!apiKey) throw new ValidationError("Save an API key first.");
    return Response.json({ ok: true, ...(await testApiKey(apiKey)) });
  } catch (err) {
    if (err instanceof ClaudeError || err instanceof CliError) return Response.json({ ok: false, error: err.message });
    throw err;
  }
});
