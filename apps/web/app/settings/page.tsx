import { encryptionKeyFromEnv } from "@jobagent/core";
import { PageShell } from "@/components/PageShell";
import { loadSettingsView } from "@/lib/data";
import { SettingsForm } from "./SettingsForm";

export const dynamic = "force-dynamic";

function encryptionReady(): boolean {
  try {
    encryptionKeyFromEnv();
    return true;
  } catch {
    return false;
  }
}

export default async function SettingsPage() {
  return (
    <PageShell title="Settings" lead="Your Claude API key is encrypted before it is stored and is never sent back to the browser.">
      <SettingsForm initial={await loadSettingsView()} encryptionReady={encryptionReady()} />
    </PageShell>
  );
}
