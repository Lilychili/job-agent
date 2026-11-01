"use client";

import { answerRule, checkAnswer, MAX_QUESTION_CHARS, MAX_SHORT_ANSWER_CHARS, type AnswerRule } from "@jobagent/core/answers";
import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";
import { SaveBar, type SaveState } from "@/components/SaveBar";
import { api } from "@/lib/api";
import type { AnswerRow } from "@/lib/data";

const NEW_ANSWER_RULE = answerRule("", "text");
const BLANK_QUESTION = { question: "", answer: "", kind: "text" as AnswerRow["kind"] };

function CharCount({ value, max }: { value: string; max: number }) {
  const used = value.trim().length;
  return (
    <span className={`char-count${used > max ? " over" : ""}`}>
      {used.toLocaleString("en")} / {max.toLocaleString("en")}
    </span>
  );
}

function AnswerInput({ id, rule, value, invalid, describedBy, onChange, onBlur }: {
  id: string;
  rule: AnswerRule;
  value: string;
  invalid: boolean;
  describedBy?: string;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  const common = { id, value, onBlur, "aria-invalid": invalid, "aria-describedby": describedBy };
  if (rule.format === "yes-no") {
    const legacy = value && !["Yes", "No"].includes(value) ? value : null;
    return (
      <select {...common} onChange={(e) => onChange(e.target.value)}>
        <option value="">Not answered</option>
        <option>Yes</option>
        <option>No</option>
        {legacy && <option>{legacy}</option>}
      </select>
    );
  }
  if (rule.format === "text" && rule.maxChars > MAX_SHORT_ANSWER_CHARS) return <textarea {...common} rows={4} onChange={(e) => onChange(e.target.value)} />;
  return (
    <input
      {...common}
      type={rule.format === "link" ? "url" : "text"}
      inputMode={rule.format === "number" ? "decimal" : undefined}
      placeholder={rule.format === "link" ? "https://" : undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function AnswersEditor({ initial: rows }: { initial: AnswerRow[] }) {
  const router = useRouter();
  // Only edits live here, so a refresh (say, a Blocker answered above) keeps what you've typed.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const [adding, setAdding] = useState(BLANK_QUESTION);
  const [addError, setAddError] = useState<string | null>(null);

  const valueOf = (r: AnswerRow) => drafts[r.id] ?? r.answer;
  const changed = rows.filter((r) => valueOf(r).trim() !== r.answer);
  const errorOf = (r: AnswerRow) => (changed.includes(r) ? checkAnswer(r.rule, valueOf(r)) : null);
  const answered = rows.filter((r) => r.answer).length;

  function edit(id: string, value: string) {
    setDrafts((d) => ({ ...d, [id]: value }));
    setState({ kind: "idle" });
  }

  function clearAll() {
    setDrafts(Object.fromEntries(rows.map((r) => [r.id, ""])));
    setState({ kind: "idle" });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const invalid = changed.filter(errorOf);
    if (invalid.length > 0) {
      setTouched((t) => new Set([...t, ...invalid.map((r) => r.id)]));
      setState({ kind: "error", message: invalid.length === 1 ? "Fix the marked answer to save." : `Fix the ${invalid.length} marked answers to save.` });
      document.getElementById(`a-${invalid[0]!.id}`)?.focus();
      return;
    }
    setState({ kind: "saving" });
    const sent = changed.map((r) => ({ id: r.id, answer: valueOf(r) }));
    const res = await api("/api/answers", "PUT", { answers: sent });
    if (!res.ok) return setState({ kind: "error", message: res.error });
    setState({ kind: "saved", message: sent.length === 1 ? "Answer saved." : `${sent.length} answers saved.` });
    startTransition(() => {
      setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([id, value]) => !sent.some((s) => s.id === id && s.answer === value))));
      router.refresh();
    });
  }

  async function remove(row: AnswerRow) {
    if (!confirm(`Delete "${row.question}"?`)) return;
    const res = await api(`/api/answers?id=${row.id}`, "DELETE");
    if (!res.ok) return setState({ kind: "error", message: res.error });
    startTransition(() => {
      setDrafts(({ [row.id]: _deleted, ...rest }) => rest);
      router.refresh();
    });
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const problem = adding.question.trim().length > MAX_QUESTION_CHARS ? `Keep the question under ${MAX_QUESTION_CHARS} characters.` : checkAnswer(NEW_ANSWER_RULE, adding.answer);
    setAddError(problem);
    if (problem) return;
    const res = await api<{ id: string }>("/api/answers", "POST", adding);
    if (!res.ok) return setAddError(res.error);
    setAdding(BLANK_QUESTION);
    startTransition(() => router.refresh());
  }

  return (
    <>
      <p className="progress-line">
        <strong>{answered}</strong> of {rows.length} answered
      </p>

      <form onSubmit={save} noValidate>
        <section className="panel">
          {rows.map((r) => {
            const value = valueOf(r);
            const error = touched.has(r.id) ? errorOf(r) : null;
            return (
              <div className="field" key={r.id}>
                <label htmlFor={`a-${r.id}`}>
                  {r.question} {r.answer && <span className="ok-mark" aria-label="answered">✓</span>}
                </label>
                <AnswerInput
                  id={`a-${r.id}`}
                  rule={r.rule}
                  value={value}
                  invalid={!!error}
                  describedBy={error ? `e-${r.id}` : undefined}
                  onChange={(v) => edit(r.id, v)}
                  onBlur={() => setTouched((t) => new Set(t).add(r.id))}
                />
                <div className="field-foot">
                  {error ? <span className="field-error" id={`e-${r.id}`}>{error}</span> : r.hint && <span className="hint">{r.hint}</span>}
                  {r.rule.format === "text" && <CharCount value={value} max={r.rule.maxChars} />}
                  {!r.isDefault && (
                    <button type="button" className="btn ghost" onClick={() => void remove(r)}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </section>

        <SaveBar state={state} dirty={changed.length > 0}>
          <button type="button" className="btn ghost" disabled={rows.every((r) => !valueOf(r).trim())} onClick={clearAll}>
            Clear all
          </button>
          <button className="btn primary big" disabled={changed.length === 0 || state.kind === "saving"}>
            Save answers
          </button>
        </SaveBar>
      </form>

      <form className="panel" onSubmit={add}>
        <h2>Add your own question</h2>
        <div className="field">
          <label htmlFor="nq">Question, as forms phrase it</label>
          <input id="nq" value={adding.question} onChange={(e) => setAdding({ ...adding, question: e.target.value })} required />
          <div className="field-foot">
            <CharCount value={adding.question} max={MAX_QUESTION_CHARS} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="na">Answer</label>
          <textarea id="na" rows={2} value={adding.answer} onChange={(e) => setAdding({ ...adding, answer: e.target.value })} />
          <div className="field-foot">
            <CharCount value={adding.answer} max={NEW_ANSWER_RULE.maxChars} />
          </div>
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
