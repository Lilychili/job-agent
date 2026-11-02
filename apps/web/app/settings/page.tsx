import { encryptionKeyFromEnv, gmailConfigured } from "@jobagent/core";
import { PageShell } from "@/components/PageShell";
import { loadSettingsView } from "@/lib/data";
import { GmailPanel } from "./GmailPanel";
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

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ gmail?: string }> }) {
  const [view, { gmail }] = await Promise.all([loadSettingsView(), searchParams]);
  return (
    <PageShell title="Settings" lead="Choose how agents reach Claude, and manage the data stored on this computer.">
      <SettingsForm initial={view} encryptionReady={encryptionReady()} />
      <GmailPanel configured={gmailConfigured()} connected={view.gmailConnected} failed={gmail === "failed"} />
    </PageShell>
  );
}
