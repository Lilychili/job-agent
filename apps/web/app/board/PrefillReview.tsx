"use client";

import { useEffect, useRef, useState } from "react";
import type { PrefillSummary } from "@/app/api/applications/[id]/form/route";
import { api } from "@/lib/api";
import type { BoardCard } from "@/lib/board";

const SOURCES: Record<string, string> = { profile: "Profile", answerBank: "Your answers", document: "Approved document" };

/** What the Shipper filled in, from where, and what it left for the owner, beside its screenshot. */
export function PrefillReview({ card, onClose, onShowForm }: { card: BoardCard; onClose: () => void; onShowForm: () => Promise<unknown> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<PrefillSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  useEffect(() => {
    let live = true;
    void api<PrefillSummary>(`/api/applications/${card.id}/form`).then((res) => {
      if (!live) return;
      if (res.ok) setData(res.data);
      else setError(res.error);
    });
    return () => {
      live = false;
    };
  }, [card.id, card.formWindowOpen]);

  return (
    <dialog ref={dialog} className="dialog craft" aria-labelledby="review-title" onClose={onClose}>
      <div className="panel craft-panel">
        <div className="craft-head">
          <div>
            <p className="company">{card.company}</p>
            <h2 id="review-title">Review the prefilled form</h2>
          </div>
          <button type="button" className="btn ghost" onClick={() => dialog.current?.close()} aria-label="Close">
            ✕
          </button>
        </div>

        {error ? (
          <p className="error">{error}</p>
        ) : !data ? (
          <p className="progress">
            <span className="spinner" aria-hidden /> Loading…
          </p>
        ) : (
          <div className="craft-body">
            <div className="craft-editor">
              <section className="craft-section">
                <h3>Left for you</h3>
                {data.leftForOwner.length ? (
                  <ul className="review-list">
                    {data.leftForOwner.map((label, i) => (
                      <li key={i} className="missed">{label}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="hint">Nothing. Check the form, then submit it.</p>
                )}
              </section>
              <section className="craft-section">
                <h3>Filled in</h3>
                <ul className="review-list">
                  {data.filled.map((f, i) => (
                    <li key={i} className="met">
                      {f.label} <span className="hint">· {SOURCES[f.source] ?? f.source}</span>
                    </li>
                  ))}
                </ul>
              </section>
              <p className="hint">
                Submit in the form&apos;s tab in the Shipper window, then click Mark applied on the card. The Shipper never submits for you.
              </p>
            </div>
            <div className="craft-preview">
              {data.screenshotId ? (
                <img className="review-shot" src={`/api/evidence/${data.screenshotId}`} alt="Screenshot of the prefilled form" />
              ) : (
                <p className="hint">No screenshot.</p>
              )}
            </div>
          </div>
        )}

        <div className="craft-actions">
          <div className="actions">
            {data?.formUrl && (
              <a className="btn ghost" href={data.formUrl} target="_blank" rel="noreferrer noopener">
                Open the job page
              </a>
            )}
          </div>
          <div className="actions">
            {card.formWindowOpen ? (
              <button type="button" className="btn primary" onClick={() => void onShowForm()}>
                Show form
              </button>
            ) : (
              <span className="hint">The form&apos;s tab was closed. Open the job page to apply there.</span>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
}
