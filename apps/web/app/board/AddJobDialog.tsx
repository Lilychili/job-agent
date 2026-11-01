"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api";

export function AddJobDialog({ onAdded }: { onAdded: () => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError(null);
    const res = await api("/api/jobs", "POST", Object.fromEntries(new FormData(form)));
    setBusy(false);
    if (!res.ok) return setError(res.error);
    form.reset();
    dialog.current?.close();
    await onAdded();
  }

  return (
    <>
      <button type="button" className="btn" onClick={() => dialog.current?.showModal()}>
        Add job
      </button>
      <dialog ref={dialog} className="dialog" aria-labelledby="add-job-title">
        <form className="panel" onSubmit={submit}>
          <h2 id="add-job-title">Add a job</h2>
          <div className="row">
            <div className="field">
              <label htmlFor="job-company">Company</label>
              <input id="job-company" name="company" required />
            </div>
            <div className="field">
              <label htmlFor="job-title">Job title</label>
              <input id="job-title" name="title" required />
            </div>
          </div>
          <div className="field">
            <label htmlFor="job-url">Link to the posting</label>
            <input id="job-url" name="sourceUrl" required inputMode="url" placeholder="https://…" />
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="job-location">Location (optional)</label>
              <input id="job-location" name="location" />
            </div>
            <div className="field">
              <label htmlFor="job-remote">Work style</label>
              <select id="job-remote" name="remote" defaultValue="unknown">
                <option value="unknown">Not stated</option>
                <option value="onsite">On-site</option>
                <option value="hybrid">Hybrid</option>
                <option value="remote">Remote</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="job-salary">Salary (optional)</label>
            <input id="job-salary" name="salary" placeholder="€60,000 – €75,000" />
          </div>
          <div className="field">
            <label htmlFor="job-posting">Job description (optional)</label>
            <textarea id="job-posting" name="rawPosting" rows={6} />
            <p className="hint">Paste the full text. The CV and cover letter are tailored to it.</p>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="btn ghost" onClick={() => dialog.current?.close()}>
              Cancel
            </button>
            <button className="btn primary" disabled={busy}>
              {busy ? "Adding…" : "Add to board"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
