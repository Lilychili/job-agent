"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";

// Google only sends the owner back to this exact address, so the cookie has to be set on it too.
const CONNECT_URL = "http://127.0.0.1:3000/api/gmail/connect";

export function GmailPanel({ configured, connected, failed }: { configured: boolean; connected: boolean; failed: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function disconnect() {
    const res = await api("/api/gmail", "DELETE");
    if (!res.ok) return setError(res.error);
    setError(null);
    router.refresh();
  }

  return (
    <section className="panel">
      <h2>Job alerts</h2>
      <p className="hint">
        Search can read the Indeed and LinkedIn job alerts in your Gmail and check them against what you&apos;re looking for. Access is
        read-only, and only messages from indeed.com and LinkedIn&apos;s job alert addresses are opened. Their text goes to Claude to list the jobs.
      </p>
      {!configured && <p className="hint">Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env, then restart the app.</p>}
      {configured && !connected && (
        <a className="btn primary" href={CONNECT_URL}>
          Connect Gmail
        </a>
      )}
      {connected && (
        <>
          <p className="hint">Gmail is connected.</p>
          <button type="button" className="btn" onClick={disconnect}>
            Disconnect
          </button>
        </>
      )}
      {failed && !connected && <p className="error">Gmail couldn&apos;t be connected. Try again.</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
