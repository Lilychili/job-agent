"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { factSource, requirementFacts, unsupportedNumber } from "@jobagent/agents/citations";
import type { CitedText, CvContent, JobRequirement, LetterContent, ProfileFact } from "@jobagent/db";
import { api } from "@/lib/api";
import type { BoardCard } from "@/lib/board";
import type { CraftData } from "@/lib/documents";
import { PdfPages } from "./PdfPages";

type Kind = "cv" | "cover_letter";
const PREVIEW_DELAY_MS = 800;

/**
 * The Craft modal: Claude's draft on the left, the PDF it prints to on the right. Opens as soon as
 * Craft is clicked and shows Claude's progress until the draft is saved.
 */
export function CraftModal({
  card,
  onClose,
  onChanged,
  regenerate,
}: {
  card: BoardCard;
  onClose: () => void;
  onChanged: () => Promise<void>;
  regenerate: () => ReturnType<typeof api>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<CraftData | null>(null);
  const [cv, setCv] = useState<CvContent | null>(null);
  const [letter, setLetter] = useState<LetterContent | null>(null);
  const [tab, setTab] = useState<Kind>("cv");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const writing = card.status === "crafting";

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  // Load the documents whenever the card settles in a state that has them, e.g. after Claude finishes.
  useEffect(() => {
    if (writing) return;
    let live = true;
    setLoadError(null);
    void api<CraftData>(`/api/applications/${card.id}/documents`).then((res) => {
      if (!live) return;
      if (!res.ok) return setLoadError(res.error);
      setData(res.data);
      setCv(res.data.cv?.content ?? null);
      setLetter(res.data.coverLetter?.content ?? null);
    });
    return () => {
      live = false;
    };
  }, [card.id, card.status, writing]);

  const facts = useMemo(() => new Map((data?.facts ?? []).map((f) => [f.id, f])), [data]);
  const dirty = !!data && (JSON.stringify(cv) !== JSON.stringify(data.cv?.content ?? null) || JSON.stringify(letter) !== JSON.stringify(data.coverLetter?.content ?? null));
  const editable = !writing && !!data?.editable && !!cv && !!letter;
  const saved = tab === "cv" ? data?.cv : data?.coverLetter;
  const preview = usePreview(card.id, tab, writing || !cv || !letter ? null : { cv, coverLetter: letter }, dirty ? null : (saved?.id ?? null));

  function close() {
    if (dirty && !window.confirm("Close without keeping your changes?")) return;
    dialog.current?.close();
  }

  async function keep() {
    if (!cv || !letter) return;
    setSaving(true);
    setActionError(null);
    const res = await api(`/api/applications/${card.id}/documents`, "POST", { cv, coverLetter: letter });
    setSaving(false);
    if (!res.ok) return setActionError(res.error);
    await onChanged();
    dialog.current?.close();
  }

  async function askAgain() {
    if (dirty && !window.confirm("Ask Claude for a new draft? Your changes will be lost.")) return;
    setActionError(null);
    // The card turns to Crafting and this shows Claude's progress, then loads the new draft.
    const res = await regenerate();
    if (res.ok) setData(null);
    else setActionError(res.error);
  }

  /** Fetched rather than linked, so a file that is missing or changed on disk can say so here. */
  async function download(id: string) {
    setActionError(null);
    try {
      const res = await fetch(`/api/documents/${id}/pdf?download=1`, { cache: "no-store" });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        return setActionError(json?.error ?? `Download failed (${res.status})`);
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "document.pdf";
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setActionError("Couldn't reach the server. Is `pnpm dev` running?");
    }
  }

  const job = { company: card.company, title: card.title };
  const canRegenerate = card.actions.some((a) => a.action === "regenerate");

  return (
    <dialog
      ref={dialog}
      className="dialog craft"
      aria-labelledby="craft-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClose={onClose}
    >
      <div className="panel craft-panel">
        <div className="craft-head">
          <div>
            <p className="company">{card.company}</p>
            <h2 id="craft-title">{card.title}</h2>
          </div>
          <button type="button" className="btn ghost" onClick={close} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="craft-tabs" role="tablist">
          {(["cv", "cover_letter"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
              {k === "cv" ? "CV" : "Cover letter"}
            </button>
          ))}
        </div>

        {writing ? (
          <div className="craft-writing">
            <p className="progress">
              <span className="spinner" aria-hidden /> {card.runLog ?? "Waiting for Claude…"}
            </p>
            <p className="hint">Claude is writing your CV and cover letter from your confirmed Profile facts. This takes a minute or two. You can close this window; the card shows when the draft is ready.</p>
          </div>
        ) : loadError || (!data && card.lastError) ? (
          <p className="error">{loadError ?? card.lastError}</p>
        ) : !data ? (
          <p className="progress">
            <span className="spinner" aria-hidden /> Loading…
          </p>
        ) : !cv || !letter ? (
          <p className="hint">{card.lastError ?? "There are no documents for this job yet."}</p>
        ) : (
          <div className="craft-body">
            <div className="craft-editor" role="tabpanel" aria-label={tab === "cv" ? "CV text" : "Cover letter text"}>
              {!data.editable && <p className="badge ready">Approved: these documents are locked.</p>}
              {card.lastError && (
                <p className="error" role="alert">
                  Claude's last new draft failed: {card.lastError} This is the draft from before.
                </p>
              )}
              {data.requirements && data.requirements.length > 0 && <Requirements items={data.requirements} facts={facts} />}
              {tab === "cv" ? (
                <CvEditor value={cv} onChange={setCv} facts={facts} job={job} readOnly={!editable} />
              ) : (
                <LetterEditor value={letter} onChange={setLetter} facts={facts} job={job} readOnly={!editable} />
              )}
            </div>
            <div className="craft-preview">
              {preview.pdf ? (
                <PdfPages data={preview.pdf} label={`${tab === "cv" ? "CV" : "Cover letter"} PDF preview`} />
              ) : (
                <div className="craft-preview-empty">{preview.error ? <p className="error">{preview.error}</p> : <span className="spinner" aria-hidden />}</div>
              )}
              {preview.pdf && (preview.busy || preview.error) && (
                <span className={`craft-preview-busy${preview.error ? " bad" : ""}`} aria-live="polite">
                  {preview.error ?? "Updating…"}
                </span>
              )}
            </div>
          </div>
        )}

        {actionError && <p className="error" role="alert">{actionError}</p>}
        <div className="craft-actions">
          <div className="actions">
            {canRegenerate && !writing && (
              <button type="button" className="btn ghost" onClick={() => void askAgain()} disabled={saving}>
                Ask Claude again
              </button>
            )}
          </div>
          <div className="actions">
            {saved && (
              dirty ? (
                <span className="hint">Craft to download your edits</span>
              ) : (
                <button type="button" className="btn" onClick={() => void download(saved.id)}>
                  Download {tab === "cv" ? "CV" : "cover letter"}
                </button>
              )
            )}
            {editable && (card.status === "drafted" || dirty) && (
              <button type="button" className="btn primary" onClick={() => void keep()} disabled={saving}>
                {saving ? "Crafting…" : card.status === "drafted" ? "Craft" : "Save changes"}
              </button>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
}

/**
 * The PDF on the right. Unchanged documents show the saved file; edits are printed by the server a
 * moment after typing stops.
 */
function usePreview(appId: string, kind: Kind, draft: { cv: CvContent; coverLetter: LetterContent } | null, savedId: string | null) {
  const [state, setState] = useState<{ pdf: ArrayBuffer | null; busy: boolean; error: string | null }>({ pdf: null, busy: false, error: null });
  const key = draft ? JSON.stringify([kind, savedId ?? draft]) : null;

  useEffect(() => {
    if (!key || !draft) return;
    const ctrl = new AbortController();
    setState((s) => ({ ...s, busy: true, error: null }));
    const timer = setTimeout(
      async () => {
        try {
          const res = savedId
            ? await fetch(`/api/documents/${savedId}/pdf`, { signal: ctrl.signal, cache: "no-store" })
            : await fetch(`/api/applications/${appId}/preview`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ kind, ...draft }),
                signal: ctrl.signal,
              });
          if (!res.ok) {
            const json = (await res.json().catch(() => null)) as { error?: string } | null;
            return setState((s) => ({ ...s, busy: false, error: json?.error ?? `Preview failed (${res.status})` }));
          }
          const pdf = await res.arrayBuffer();
          setState({ pdf, busy: false, error: null });
        } catch {
          if (!ctrl.signal.aborted) setState((s) => ({ ...s, busy: false, error: "Couldn't print the preview." }));
        }
      },
      savedId ? 0 : PREVIEW_DELAY_MS,
    );
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
    // `key` stands for `draft`, `kind` and `savedId`.
  }, [key, appId]);

  return state;
}

// ─── Editors ────────────────────────────────────────────────────────────────

type Facts = Map<string, ProfileFact>;

/** What the job needs and which Profile facts meet it. A gap can only be closed in the Profile. */
function Requirements({ items, facts }: { items: JobRequirement[]; facts: Facts }) {
  const rows = items.map((r) => ({ text: r.text, ...requirementFacts(r, facts) }));
  const gaps = rows.filter((r) => r.met.length === 0).length;
  return (
    <section className="craft-section craft-requirements">
      <h3>
        What the job needs <span className="hint">· you meet {rows.length - gaps} of {rows.length}</span>
      </h3>
      <ul>
        {rows.map((r, i) => (
          <li key={i} className={r.met.length ? "met" : "missed"}>
            <strong>{r.text}</strong>
            {r.met.length ? (
              <FactChips facts={r.met} label="Facts that meet it" />
            ) : (
              <>
                <span className="hint"> Not in your Profile, so the CV leaves it out{r.closest.length ? ". Closest real experience:" : ""}</span>
                {r.closest.length > 0 && <FactChips facts={r.closest} label="Your closest real experience" near />}
              </>
            )}
          </li>
        ))}
      </ul>
      {gaps > 0 && <p className="hint">If you do have one of these, add it to your Profile and ask Claude again.</p>}
    </section>
  );
}

function FactChips({ facts, label, near }: { facts: ProfileFact[]; label: string; near?: boolean }) {
  return (
    <ul className={`craft-cites${near ? " near" : ""}`} aria-label={label}>
      {facts.map((f) => (
        <li key={f.id} title={factSource(f)}>
          {f.text}
        </li>
      ))}
    </ul>
  );
}
type Job = { company: string; title: string };

const dates = (f: ProfileFact) => (f.startDate ? `${f.startDate} – ${f.endDate ?? "present"}` : (f.endDate ?? ""));

function CvEditor({ value, onChange, facts, job, readOnly }: { value: CvContent; onChange: (v: CvContent) => void; facts: Facts; job: Job; readOnly: boolean }) {
  const set = (patch: Partial<CvContent>) => onChange({ ...value, ...patch });
  return (
    <>
      <section className="craft-section">
        <h3>Summary</h3>
        <Piece value={value.summary} onChange={(summary) => set({ summary })} facts={facts} job={job} readOnly={readOnly} label="Summary" />
      </section>

      <section className="craft-section">
        <h3>Experience</h3>
        {value.experience.map((e, i) => {
          const role = facts.get(e.roleFactId);
          return (
            <div key={e.roleFactId} className="craft-role">
              <p className="craft-role-head">
                <strong>{[role?.text, role?.org].filter(Boolean).join(", ")}</strong>
                {role && <span className="hint"> {dates(role)}</span>}
              </p>
              <PieceList
                items={e.bullets}
                onChange={(bullets) => set({ experience: value.experience.map((x, j) => (j === i ? { ...x, bullets } : x)) })}
                facts={facts}
                job={job}
                readOnly={readOnly}
                noun="bullet"
              />
            </div>
          );
        })}
        <p className="hint">Job titles, employers and dates come from your Profile. Change them there.</p>
      </section>

      <section className="craft-section">
        <h3>Skills</h3>
        <PieceList items={value.skills} onChange={(skills) => set({ skills })} facts={facts} job={job} readOnly={readOnly} noun="skill" short />
      </section>

      {value.otherFactIds.length > 0 && (
        <section className="craft-section">
          <h3>Education and more</h3>
          <ul className="craft-other">
            {value.otherFactIds.map((id) => {
              const f = facts.get(id);
              return <li key={id}>{f ? [f.text, f.org, dates(f)].filter(Boolean).join(", ") : id}</li>;
            })}
          </ul>
        </section>
      )}
    </>
  );
}

function LetterEditor({ value, onChange, facts, job, readOnly }: { value: LetterContent; onChange: (v: LetterContent) => void; facts: Facts; job: Job; readOnly: boolean }) {
  const set = (patch: Partial<LetterContent>) => onChange({ ...value, ...patch });
  return (
    <>
      <section className="craft-section">
        <h3>Greeting</h3>
        <input aria-label="Greeting" value={value.greeting} onChange={(e) => set({ greeting: e.target.value })} readOnly={readOnly} />
      </section>
      <section className="craft-section">
        <h3>Paragraphs</h3>
        <PieceList items={value.paragraphs} onChange={(paragraphs) => set({ paragraphs })} facts={facts} job={job} readOnly={readOnly} noun="paragraph" />
      </section>
      <section className="craft-section">
        <h3>Closing</h3>
        <input aria-label="Closing" value={value.closing} onChange={(e) => set({ closing: e.target.value })} readOnly={readOnly} />
        <p className="hint">Your name is added below it.</p>
      </section>
    </>
  );
}

/** A list of cited pieces the owner can edit, reorder, remove and add to. */
function PieceList({
  items,
  onChange,
  facts,
  job,
  readOnly,
  noun,
  short,
}: {
  items: CitedText[];
  onChange: (v: CitedText[]) => void;
  facts: Facts;
  job: Job;
  readOnly: boolean;
  noun: string;
  short?: boolean;
}) {
  const move = (from: number, to: number) => {
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    onChange(next);
  };
  return (
    <div className="craft-list">
      {items.map((item, i) => (
        <div key={i} className="craft-item">
          <Piece
            value={item}
            onChange={(v) => onChange(items.map((x, j) => (j === i ? v : x)))}
            facts={facts}
            job={job}
            readOnly={readOnly}
            label={`${noun} ${i + 1}`}
            short={short}
          />
          {!readOnly && (
            <div className="craft-item-tools">
              <button type="button" className="btn ghost" aria-label={`Move ${noun} ${i + 1} up`} disabled={i === 0} onClick={() => move(i, i - 1)}>
                ↑
              </button>
              <button type="button" className="btn ghost" aria-label={`Move ${noun} ${i + 1} down`} disabled={i === items.length - 1} onClick={() => move(i, i + 1)}>
                ↓
              </button>
              <button type="button" className="btn ghost" aria-label={`Remove ${noun} ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          )}
        </div>
      ))}
      {!readOnly && (
        <button type="button" className="btn ghost craft-add" onClick={() => onChange([...items, { text: "", factIds: [] }])}>
          + Add {noun}
        </button>
      )}
    </div>
  );
}

/** One cited piece of text, with the facts behind it and a warning when the text goes beyond them. */
function Piece({ value, onChange, facts, job, readOnly, label, short }: { value: CitedText; onChange: (v: CitedText) => void; facts: Facts; job: Job; readOnly: boolean; label: string; short?: boolean }) {
  const cited = value.factIds.map((id) => facts.get(id)).filter((f): f is ProfileFact => !!f);
  const invented = unsupportedNumber(value.text, [...cited.map(factSource), job.company, job.title]);
  const warning = !value.text.trim() ? null : cited.length === 0 ? "Your own words: no Profile fact backs this." : invented ? `"${invented}" isn't in the facts this cites.` : null;
  return (
    <div className="craft-piece">
      {short ? (
        <input aria-label={label} value={value.text} onChange={(e) => onChange({ ...value, text: e.target.value })} readOnly={readOnly} />
      ) : (
        <textarea aria-label={label} value={value.text} onChange={(e) => onChange({ ...value, text: e.target.value })} readOnly={readOnly} />
      )}
      {cited.length > 0 && <FactChips facts={cited} label="Facts this cites" />}
      {warning && <p className="craft-warning">{warning}</p>}
    </div>
  );
}
