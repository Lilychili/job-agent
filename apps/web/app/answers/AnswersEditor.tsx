"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { AnswerRow } from "@/lib/data";

type Kind = AnswerRow["kind"];

export function AnswersEditor({ initial }: { initial: AnswerRow[] }) {
  const [rows, setRows] = useState(initial);
  const [saved, setSaved] = useState(() => new Map(initial.map((r) => [r.id, r.answer])));
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState({ question: "", answer: "", kind: "text" as Kind });
  const [addError, setAddError] = useState<string | null>(null);

  const answered = rows.filter((r) => saved.get(r.id)?.trim()).length;

  async function save(row: AnswerRow) {
    setBusy(row.id);
    setErrors((e) => ({ ...e, [row.id]: "" }));
    const res = await api("/api/answers", "PUT", { id: row.id, answer: row.answer });
    setBusy(null);
    if (!res.ok) return setErrors((e) => ({ ...e, [row.id]: res.error }));
    setSaved((m) => new Map(m).set(row.id, row.answer.trim()));
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, answer: row.answer.trim() } : r)));
  }

  async function remove(row: AnswerRow) {
    const verb = row.isDefault ? "Clear this answer?" : "Delete this question?";
    if (!confirm(verb)) return;
    const res = await api(`/api/answers?id=${row.id}`, "DELETE");
    if (!res.ok) return setErrors((e) => ({ ...e, [row.id]: res.error }));
    if (row.isDefault) {
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, answer: "" } : r)));
      setSaved((m) => new Map(m).set(row.id, ""));
    } else {
      setRows((rs) => rs.filter((r) => r.id !== row.id));
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    const res = await api<{ id: string }>("/api/answers", "POST", adding);
    if (!res.ok) return setAddError(res.error);
    const row: AnswerRow = { id: res.data.id, question: adding.question.trim(), answer: adding.answer.trim(), kind: adding.kind, hint: null, isDefault: false };
    setRows((rs) => [...rs, row]);
    setSaved((m) => new Map(m).set(row.id, row.answer));
    setAdding({ question: "", answer: "", kind: "text" });
  }

  return (
    <>
      <p className="progress-line">
        <strong>{answered}</strong> of {rows.length} answered
      </p>

      {rows.map((r) => {
        const changed = r.answer.trim() !== (saved.get(r.id) ?? "");
        const done = !!saved.get(r.id)?.trim();
        return (
          <form
            className="panel answer"
            key={r.id}
            onSubmit={(e) => {
              e.preventDefault();
              void save(r);
            }}
          >
            <div className="field">
              <label htmlFor={`a-${r.id}`}>
                {r.question} {done && <span className="ok-mark" aria-label="answered">✓</span>}
              </label>
              {r.kind === "consent" || r.kind === "choice" ? (
                <input id={`a-${r.id}`} value={r.answer} onChange={(e) => setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, answer: e.target.value } : x)))} placeholder={r.kind === "consent" ? "Yes or No" : "Your answer"} />
              ) : (
                <textarea
                  id={`a-${r.id}`}
                  rows={r.question.toLowerCase().startsWith("why") ? 4 : 2}
                  value={r.answer}
                  onChange={(e) => setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, answer: e.target.value } : x)))}
                />
              )}
              {r.hint && <p className="hint">{r.hint}</p>}
            </div>
            <div className="actions">
              <button className="btn primary" disabled={!changed || busy === r.id}>
                {busy === r.id ? "Saving…" : "Save"}
              </button>
              {(done || !r.isDefault) && (
                <button type="button" className="btn ghost" onClick={() => void remove(r)}>
                  {r.isDefault ? "Clear" : "Delete"}
                </button>
              )}
              {errors[r.id] && <span className="error">{errors[r.id]}</span>}
            </div>
          </form>
        );
      })}

      <form className="panel" onSubmit={add}>
        <h2>Add your own question</h2>
        <div className="field">
          <label htmlFor="nq">Question, as forms phrase it</label>
          <input id="nq" value={adding.question} onChange={(e) => setAdding({ ...adding, question: e.target.value })} required />
        </div>
        <div className="field">
          <label htmlFor="na">Answer</label>
          <textarea id="na" rows={2} value={adding.answer} onChange={(e) => setAdding({ ...adding, answer: e.target.value })} />
        </div>
        <div className="actions">
          <button className="btn primary" disabled={!adding.question.trim()}>
            Add question
          </button>
          {addError && <span className="error">{addError}</span>}
        </div>
      </form>
    </>
  );
}
