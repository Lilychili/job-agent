"use client";

import { useEffect, useRef, useState } from "react";
import { PdfPages } from "./PdfPages";

/** An approved document as its PDF, nothing else. These are the files the Shipper uploads. */
export function PdfPreview({ documentId, title, onClose }: { documentId: string; title: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pdf, setPdf] = useState<ArrayBuffer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    void (async () => {
      try {
        const res = await fetch(`/api/documents/${documentId}/pdf`, { signal: ctrl.signal, cache: "no-store" });
        if (!res.ok) {
          const json = (await res.json().catch(() => null)) as { error?: string } | null;
          return setError(json?.error ?? `Couldn't load the PDF (${res.status})`);
        }
        setPdf(await res.arrayBuffer());
      } catch {
        if (!ctrl.signal.aborted) setError("Couldn't reach the server. Is `pnpm dev` running?");
      }
    })();
    return () => ctrl.abort();
  }, [documentId]);

  return (
    <dialog ref={dialog} className="dialog pdf-preview" aria-labelledby="pdf-preview-title" onClose={onClose}>
      <div className="panel craft-panel">
        <div className="craft-head">
          <h2 id="pdf-preview-title">{title}</h2>
          <button type="button" className="btn ghost" onClick={() => dialog.current?.close()} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="craft-preview">
          {pdf ? (
            <PdfPages data={pdf} label={`${title} PDF`} />
          ) : (
            <div className="craft-preview-empty">{error ? <p className="error">{error}</p> : <span className="spinner" aria-hidden />}</div>
          )}
        </div>
      </div>
    </dialog>
  );
}
