"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { SaveBar, type SaveState } from "@/components/SaveBar";
import { TagInput } from "@/components/TagInput";
import { api } from "@/lib/api";
import type { ExtractionOutput } from "@/lib/data";
import type { Contact, FactKind, ProfileFact } from "@jobagent/db";

/** A fact row in the editor: every field is a string, and `id` is "" until the server assigns one. */
type FactRow = Required<ProfileFact> & { key: string };
type ContactForm = Required<Contact>;
interface Stored {
  contact: Contact;
  facts: ProfileFact[];
  confirmed: boolean;
  version: number;
  /** The CV file the saved facts came from. */
  sourceFilePath: string | null;
}
interface Extraction {
  id: string;
  status: string;
  fileName: string;
  error: string | null;
  lastLog: string | null;
  output: ExtractionOutput | null;
}

const SECTIONS: { kind: FactKind; title: string; textLabel: string; orgLabel?: string; dates?: boolean; multiline?: boolean }[] = [
  { kind: "role", title: "Experience", textLabel: "Job title", orgLabel: "Company", dates: true },
  { kind: "education", title: "Education", textLabel: "Degree and field", orgLabel: "Institution", dates: true },
  { kind: "achievement", title: "Achievements", textLabel: "What you achieved", orgLabel: "Company (optional)", multiline: true },
  { kind: "skill", title: "Skills", textLabel: "Skill or technology" },
  { kind: "cert", title: "Certifications", textLabel: "Certification" },
  { kind: "language", title: "Languages", textLabel: "Language and level" },
];

let counter = 0;
const newKey = () => `k${++counter}`;

const toFacts = (facts: ProfileFact[]): FactRow[] =>
  facts.map((f) => ({
    // Saved facts key on their id: the counter differs between server and browser, which breaks hydration.
    key: f.id || newKey(),
    id: f.id,
    kind: f.kind,
    text: f.text,
    org: f.org ?? "",
    startDate: f.startDate ?? "",
    endDate: f.endDate ?? "",
  }));

const toContact = (c: Contact): ContactForm => ({
  name: c.name ?? "",
  email: c.email ?? "",
  phone: c.phone ?? "",
  location: c.location ?? "",
  links: c.links ?? [],
});

export function ProfileEditor({
  initial,
  extraction: initialExtraction,
  aiReady,
}: {
  initial: Stored | null;
  extraction: Extraction | null;
  aiReady: boolean;
}) {
  const [contact, setContact] = useState<ContactForm>(initial ? toContact(initial.contact) : { name: "", email: "", phone: "", location: "", links: [] });
  const [facts, setFacts] = useState<FactRow[]>(initial ? toFacts(initial.facts) : []);
  const [meta, setMeta] = useState({ confirmed: initial?.confirmed ?? false, version: initial?.version ?? 0 });
  const [dirty, setDirty] = useState(!initial);
  const [state, setState] = useState<SaveState>({ kind: "idle" });

  // ── CV upload + extraction ────────────────────────────────────────────────
  const [extraction, setExtraction] = useState<Extraction | null>(initialExtraction);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [appliedRun, setAppliedRun] = useState<string | null>(null);
  const [uploadedRun, setUploadedRun] = useState<string | null>(null);
  const [savedSource, setSavedSource] = useState(initial?.sourceFilePath ?? null);
  const fileInput = useRef<HTMLInputElement>(null);
  const running = extraction?.status === "queued" || extraction?.status === "running";

  const refreshExtraction = useCallback(async () => {
    const res = await api<Extraction | null>("/api/profile/extract");
    if (res.ok) setExtraction(res.data);
  }, []);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void refreshExtraction(), 1500);
    return () => clearInterval(t);
  }, [running, refreshExtraction]);

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    const form = new FormData();
    form.set("file", file);
    const res = await api<{ runId: string }>("/api/profile/extract", "POST", form);
    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
    if (!res.ok) return setUploadError(res.error);
    setUploadedRun(res.data.runId);
    await refreshExtraction();
  }

  /** Put the facts read from the CV in the editor. Asks first only when it would throw away unsaved edits. */
  function applyExtraction(askFirst: boolean) {
    const out = extraction?.output;
    if (!out) return;
    if (askFirst && facts.length > 0 && !confirm("Replace the facts and contact details below with the ones read from your CV?")) return;
    setContact(toContact(out.contact));
    setFacts(toFacts(out.facts));
    setAppliedRun(extraction!.id);
    setDirty(true);
    setState({ kind: "idle" });
  }

  // A CV uploaded here goes straight into the editor once it is read: uploading it was the decision.
  useEffect(() => {
    if (extraction?.status === "succeeded" && extraction.id === uploadedRun && appliedRun !== extraction.id) applyExtraction(dirty);
    // Runs when the read finishes; the other values are read at that moment.
  }, [extraction?.status, extraction?.id, uploadedRun]);

  // A CV that was read but never loaded and saved: the Profile still holds the old one.
  const unsavedCv = extraction?.status === "succeeded" && !!extraction.output && extraction.output.sourceFile !== savedSource && appliedRun !== extraction.id;

  // ── editing ───────────────────────────────────────────────────────────────
  const touch = () => {
    setDirty(true);
    setState({ kind: "idle" });
  };
  const setField = (key: keyof Omit<ContactForm, "links">, value: string) => {
    setContact((c) => ({ ...c, [key]: value }));
    touch();
  };
  const patchFact = (key: string, patch: Partial<FactRow>) => {
    setFacts((fs) => fs.map((f) => (f.key === key ? { ...f, ...patch } : f)));
    touch();
  };
  const addFact = (kind: FactKind) => {
    setFacts((fs) => [...fs, { key: newKey(), id: "", kind, text: "", org: "", startDate: "", endDate: "" }]);
    touch();
  };
  const removeFact = (key: string) => {
    setFacts((fs) => fs.filter((f) => f.key !== key));
    touch();
  };

  async function save(confirmIt: boolean) {
    setState({ kind: "saving" });
    const res = await api<Stored>("/api/profile", "PUT", {
      contact,
      facts: facts.map(({ key: _key, ...f }) => f),
      confirm: confirmIt,
      extractionRunId: appliedRun ?? undefined,
    });
    if (!res.ok) return setState({ kind: "error", message: res.error });
    // Pick up server-assigned fact ids so later saves keep them stable.
    setFacts(toFacts(res.data.facts));
    setContact(toContact(res.data.contact));
    setMeta({ confirmed: res.data.confirmed, version: res.data.version });
    setSavedSource(res.data.sourceFilePath);
    setDirty(false);
    setState({ kind: "saved", message: confirmIt ? `Confirmed (version ${res.data.version}).` : "Saved." });
  }

  const status = meta.version === 0 ? "Not saved yet" : meta.confirmed ? `Confirmed · version ${meta.version}` : "Draft: not confirmed";

  return (
    <>
      <section className="panel">
        <h2>Start from your CV</h2>
        {!aiReady ? (
          <p>
            Reading a CV needs Claude. <Link href="/settings">Connect it in Settings</Link> (sign in with Claude Code, or add an API key), or fill the profile in by hand below.
          </p>
        ) : (
          <>
            <p className="hint">
              Upload a PDF or DOCX. It is read here on your machine, then its text is sent to Claude to be turned into the facts below. You review everything before anything uses it.
            </p>
            <div className="upload-row">
              <label className={`btn primary${running || uploading ? " disabled" : ""}`}>
                {running ? "Reading…" : uploading ? "Uploading…" : "Upload CV"}
                <input
                  ref={fileInput}
                  type="file"
                  accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  disabled={running || uploading}
                  onChange={(e) => void upload(e.target.files?.[0])}
                  className="sr-only"
                />
              </label>
              {running && (
                <p className="progress">
                  <span className="spinner" aria-hidden /> {extraction?.lastLog ?? "Queued…"}
                </p>
              )}
            </div>
            {uploadError && <p className="error">{uploadError}</p>}
            {extraction?.status === "failed" && <p className="error">Couldn&apos;t read {extraction.fileName}: {extraction.error}</p>}
            {extraction?.status === "succeeded" && extraction.output && (
              <div className="extracted">
                <p>
                  ✓ Read <strong>{extraction.fileName}</strong>: {extraction.output.facts.length} facts found.
                </p>
                {appliedRun === extraction.id ? (
                  <p className="hint">Loaded below. Review it, then click {meta.confirmed ? "Save changes" : "Confirm profile"} at the bottom.</p>
                ) : unsavedCv ? (
                  <>
                    <p className="error">This CV isn&apos;t in your Profile yet. Load it, review it, then save.</p>
                    <button type="button" className="btn primary" onClick={() => applyExtraction(true)}>
                      Load it into the editor
                    </button>
                  </>
                ) : (
                  <p className="hint">This is the CV your Profile was saved from.</p>
                )}
              </div>
            )}
          </>
        )}
      </section>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save(false);
        }}
      >
        <section className="panel">
          <h2>Contact</h2>
          <div className="row">
            <div className="field">
              <label htmlFor="name">Full name</label>
              <input id="name" value={contact.name} onChange={(e) => setField("name", e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" value={contact.email} onChange={(e) => setField("email", e.target.value)} />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="phone">Phone (optional)</label>
              <input id="phone" value={contact.phone} onChange={(e) => setField("phone", e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="loc">Location (optional)</label>
              <input id="loc" value={contact.location} onChange={(e) => setField("location", e.target.value)} />
            </div>
          </div>
          <TagInput
            label="Links"
            value={contact.links}
            onChange={(links) => {
              setContact((c) => ({ ...c, links }));
              touch();
            }}
            placeholder="linkedin.com/in/you, github.com/you"
            hint="LinkedIn, GitHub, portfolio. Press Enter after each one."
          />
        </section>

        {SECTIONS.map((s) => {
          const rows = facts.filter((f) => f.kind === s.kind);
          return (
            <section className="panel" key={s.kind} aria-labelledby={`sec-${s.kind}`}>
              <h2 id={`sec-${s.kind}`}>
                {s.title} <span className="count">{rows.length}</span>
              </h2>
              {rows.map((f) => (
                <div className="fact" key={f.key}>
                  <div className="fact-main">
                    <div className="field">
                      <label htmlFor={`t-${f.key}`}>{s.textLabel}</label>
                      {s.multiline ? (
                        <textarea id={`t-${f.key}`} rows={2} value={f.text} onChange={(e) => patchFact(f.key, { text: e.target.value })} />
                      ) : (
                        <input id={`t-${f.key}`} value={f.text} onChange={(e) => patchFact(f.key, { text: e.target.value })} />
                      )}
                    </div>
                    {s.orgLabel && (
                      <div className="field">
                        <label htmlFor={`o-${f.key}`}>{s.orgLabel}</label>
                        <input id={`o-${f.key}`} value={f.org} onChange={(e) => patchFact(f.key, { org: e.target.value })} />
                      </div>
                    )}
                    {s.dates && (
                      <div className="row">
                        <div className="field narrow">
                          <label htmlFor={`s-${f.key}`}>From</label>
                          <input id={`s-${f.key}`} placeholder="2021-03" value={f.startDate} onChange={(e) => patchFact(f.key, { startDate: e.target.value })} />
                        </div>
                        <div className="field narrow">
                          <label htmlFor={`e-${f.key}`}>To</label>
                          <input id={`e-${f.key}`} placeholder="now" value={f.endDate} onChange={(e) => patchFact(f.key, { endDate: e.target.value })} />
                        </div>
                      </div>
                    )}
                  </div>
                  <button type="button" className="btn ghost" aria-label={`Remove ${s.title.toLowerCase()} entry`} onClick={() => removeFact(f.key)}>
                    Remove
                  </button>
                </div>
              ))}
              <button type="button" className="btn" onClick={() => addFact(s.kind)}>
                + Add
              </button>
            </section>
          );
        })}

        <div className="panel confirm-panel">
          <p className="profile-status">
            <span className={`dot ${meta.confirmed ? "ok" : "bad"}`} aria-hidden /> {status}
          </p>
          <p className="hint">
            Search, Craft and Apply stay locked until the Profile is confirmed. Every sentence in a CV or cover letter must trace back to one of these facts.
          </p>
          {unsavedCv && <p className="error">Your new CV isn&apos;t loaded below yet. Use &quot;Load it into the editor&quot; at the top first.</p>}
          <SaveBar state={state} dirty={dirty}>
            {!meta.confirmed && (
              <button className="btn" disabled={!dirty || state.kind === "saving"}>
                Save draft
              </button>
            )}
            <button type="button" className="btn primary" disabled={state.kind === "saving" || (!dirty && meta.confirmed)} onClick={() => void save(true)}>
              {meta.confirmed ? "Save changes" : "Confirm profile"}
            </button>
          </SaveBar>
        </div>
      </form>
    </>
  );
}
