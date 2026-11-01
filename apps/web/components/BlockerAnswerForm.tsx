"use client";

import { useState } from "react";
import { api } from "@/lib/api";

/** Answer one Blocker. Shared by the board card and the Blockers inbox. */
export function BlockerAnswerForm({
  blockerId,
  question,
  className,
  onAnswered,
  children,
}: {
  blockerId: string;
  question: string;
  className: string;
  onAnswered: () => Promise<void> | void;
  children?: React.ReactNode;
}) {
  const [answer, setAnswer] = useState("");
  const [reuse, setReuse] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await api(`/api/blockers/${blockerId}/answer`, "POST", { answer, reuse });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setAnswer("");
    await onAnswered();
  }

  return (
    <form className={className} onSubmit={submit}>
      {children}
      <div className="field">
        <label htmlFor={`b-${blockerId}`}>{question}</label>
        <input id={`b-${blockerId}`} value={answer} onChange={(e) => setAnswer(e.target.value)} required />
      </div>
      <div className="blocker-row">
        <label className="check">
          <input type="checkbox" checked={reuse} onChange={(e) => setReuse(e.target.checked)} /> Reuse for future jobs
        </label>
        <button className="btn primary" disabled={busy || !answer.trim()}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
