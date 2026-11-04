"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { TagInput } from "@/components/TagInput";
import { api } from "@/lib/api";
import type { AnswerRow, ExtractionOutput } from "@/lib/data";
import type { PrefsValue } from "../profile/looking-for/PreferencesForm";
import type { Contact, ProfileFact } from "@jobagent/db";
import type { KeyQuestion } from "./questions";

type Provider = "api" | "cli";
interface SettingsView {
  provider: Provider;
  hasKey: boolean;
  maskedKey: string | null;
  ready: boolean;
}
interface StoredProfile {
  contact: Contact;
  facts: ProfileFact[];
  confirmed: boolean;
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

export interface OnboardingProps {
  settings: SettingsView;
  encryptionReady: boolean;
  profile: StoredProfile | null;
  extraction: Extraction | null;
  prefs: PrefsValue | null;
  questions: (AnswerRow & KeyQuestion)[];
  linkAnswers: { id: string; question: string; answer: string }[];
  workerLastSeenAt: string | null;
}

const STEPS = [
  { title: "Connect Claude", short: "Connect" },
  { title: "Your CV", short: "CV" },
  { title: "What you're looking for", short: "Looking for" },
  { title: "A few quick questions", short: "Questions" },
] as const;
const DONE = STEPS.length;

const EMPTY_PREFS: PrefsValue = {
  roles: [],
  locations: [],
  remote: "any",
  salaryFloor: "",
  salaryCurrency: "",
  stackMustHave: [],
  stackNiceToHave: [],
  exclusions: { companies: [], keywords: [], seniority: [] },
  companyBoards: [],
};

const hasPrefs = (p: PrefsValue | null) => !!p && (p.roles.length > 0 || p.locations.length > 0 || p.stackMustHave.length > 0 || p.companyBoards.length > 0);

/** The first step still to do, so coming back to the page carries on where you left off. */
function firstOpenStep(p: OnboardingProps): number {
  if (!p.settings.ready) return 0;
  if (!p.profile?.confirmed) return 1;
  if (!hasPrefs(p.prefs)) return 2;
  if (p.questions.some((q) => !q.answer)) return 3;
  return DONE;
}

export function Onboarding(props: OnboardingProps) {
  const [step, setStep] = useState(() => firstOpenStep(props));
  const [reached, setReached] = useState(step);
  const [profile, setProfile] = useState(props.profile);
  const top = useRef<HTMLDivElement>(null);

  function go(next: number) {
    setStep(next);
    setReached((r) => Math.max(r, next));
    top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="welcome" ref={top}>
      <header className="welcome-top">
        <Link href="/" className="brand" aria-label="Job Agent home">
          <span className="brand-mark" aria-hidden>
            ◆
          </span>
          <span className="brand-name">Job Agent</span>
        </Link>
        {step < DONE && (
          <Link className="btn ghost" href="/setup">
            I&apos;ll set up later
          </Link>
        )}
      </header>

      <main className="wizard">
        {step < DONE && <Stepper step={step} reached={reached} onPick={go} />}
        {step === 0 && <ConnectStep {...props} onNext={() => go(1)} />}
        {step === 1 && <CvStep profile={profile} extraction={props.extraction} onBack={() => go(0)} onConfirmed={setProfile} onNext={() => go(2)} />}
        {step === 2 && <PrefsStep prefs={props.prefs} profile={profile} onBack={() => go(1)} onNext={() => go(3)} />}
        {step === 3 && <QuestionsStep questions={props.questions} linkAnswers={props.linkAnswers} profile={profile} onBack={() => go(2)} onNext={() => go(DONE)} />}
        {step === DONE && <DoneStep workerLastSeenAt={props.workerLastSeenAt} onEdit={() => go(0)} />}
      </main>
    </div>
  );
}

// ─── Frame ──────────────────────────────────────────────────────────────────

function Stepper({ step, reached, onPick }: { step: number; reached: number; onPick: (i: number) => void }) {
  return (
    <ol className="stepper" aria-label="Setup progress">
      {STEPS.map((s, i) => {
        const state = i < step ? "done" : i === step ? "current" : "todo";
        return (
          <li key={s.title} className={`stepper-item ${state}`}>
            <button type="button" disabled={i > reached || i === step} onClick={() => onPick(i)} aria-current={i === step ? "step" : undefined}>
              <span className="stepper-dot" aria-hidden>
                {i < step ? "✓" : i + 1}
              </span>
              <span className="stepper-label">{s.short}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function StepCard({ index, lead, children, footer }: { index: number; lead: React.ReactNode; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <section className="wizard-card" aria-labelledby="wizard-title">
      <p className="tag">
        Step {index + 1} of {STEPS.length}
      </p>
      <h1 id="wizard-title" className="wizard-title">
        {STEPS[index]!.title}
      </h1>
      <p className="wizard-lead">{lead}</p>
      <div className="wizard-body">{children}</div>
      <div className="wizard-foot">{footer}</div>
    </section>
  );
}

function Back({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="btn ghost" onClick={onClick}>
      ← Back
    </button>
  );
}

// ─── 1. Connect Claude ─────────────────────────────────────────────────────

type Check = { kind: "idle" } | { kind: "checking" } | { kind: "ok"; text: string } | { kind: "bad"; text: string };

function ConnectStep({ settings: initial, encryptionReady, onNext }: OnboardingProps & { onNext: () => void }) {
  const [view, setView] = useState(initial);
  // Claude Code needs nothing pasted, so it's the default unless an API key is already set up.
  const [choice, setChoice] = useState<Provider>(initial.provider === "api" && initial.hasKey ? "api" : "cli");
  const [check, setCheck] = useState<Check>({ kind: "idle" });
  const [apiKey, setApiKey] = useState("");
  const autoChecked = useRef(false);

  const test = useCallback(async (provider: Provider) => {
    setCheck({ kind: "checking" });
    if (provider !== view.provider) {
      const saved = await api<SettingsView>("/api/settings", "PUT", { provider });
      if (!saved.ok) return setCheck({ kind: "bad", text: saved.error });
      setView(saved.data);
    }
    const res = await api<{ ok: boolean; model?: string; error?: string }>("/api/settings/test", "POST");
    if (!res.ok) return setCheck({ kind: "bad", text: res.error });
    setCheck(res.data.ok ? { kind: "ok", text: provider === "cli" ? "Claude Code is signed in and answering." : "Your API key works." } : { kind: "bad", text: res.data.error ?? "It didn't answer." });
  }, [view.provider]);

  // Check straight away: most people are already signed in to Claude Code, and then there's nothing to do.
  useEffect(() => {
    if (autoChecked.current || (choice === "api" && !view.hasKey)) return;
    autoChecked.current = true;
    void test(choice);
  }, [choice, test, view.hasKey]);

  function pick(p: Provider) {
    if (p === choice) return;
    setChoice(p);
    setCheck({ kind: "idle" });
    if (p === "cli") void test("cli");
    else if (view.hasKey) void test("api");
  }

  async function saveKey(e: React.FormEvent) {
    e.preventDefault();
    setCheck({ kind: "checking" });
    const res = await api<SettingsView>("/api/settings", "PUT", { provider: "api", apiKey });
    if (!res.ok) return setCheck({ kind: "bad", text: res.error });
    setView(res.data);
    setApiKey("");
    await test("api");
  }

  return (
    <StepCard
      index={0}
      lead="Job Agent uses Claude to read your CV, score jobs and write applications. Pick how it reaches Claude."
      footer={
        <>
          <span />
          <button type="button" className="btn primary big" disabled={check.kind !== "ok"} onClick={onNext}>
            Continue →
          </button>
        </>
      }
    >
      <div className="choices big" role="radiogroup" aria-label="How Job Agent reaches Claude">
        <label className={`choice${choice === "cli" ? " selected" : ""}`}>
          <input type="radio" name="provider" checked={choice === "cli"} onChange={() => pick("cli")} />
          <span>
            <strong>
              Claude Code <span className="badge ready">Recommended</span>
            </strong>
            <span className="hint">Uses your Claude subscription through the Claude Code app on this computer. Nothing to paste.</span>
          </span>
        </label>
        <label className={`choice${choice === "api" ? " selected" : ""}`}>
          <input type="radio" name="provider" checked={choice === "api"} onChange={() => pick("api")} />
          <span>
            <strong>Anthropic API key</strong>
            <span className="hint">Pay per use, billed to your Anthropic Console account.</span>
          </span>
        </label>
      </div>

      {choice === "api" &&
        (!encryptionReady ? (
          <div className="callout warn" role="alert">
            <strong>One thing first</strong>
            <p>
              Set <code>APP_ENCRYPTION_KEY</code> in <code>.env</code> so the key can be stored encrypted, then restart <code>pnpm dev</code>. The README shows how to make one.
            </p>
          </div>
        ) : (
          <form className="key-form" onSubmit={saveKey}>
            <div className="field">
              <label htmlFor="apikey">{view.hasKey ? `Replace your key (${view.maskedKey})` : "Your API key"}</label>
              <input id="apikey" type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-…" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            </div>
            <button className="btn primary" disabled={!apiKey.trim() || check.kind === "checking"}>
              Save and test
            </button>
          </form>
        ))}

      <ConnectionStatus check={check} choice={choice} onRetry={() => void test(choice)} />
    </StepCard>
  );
}

function ConnectionStatus({ check, choice, onRetry }: { check: Check; choice: Provider; onRetry: () => void }) {
  if (check.kind === "idle") return null;
  if (check.kind === "checking")
    return (
      <p className="callout" role="status">
        <span className="spinner" aria-hidden /> {choice === "cli" ? "Looking for Claude Code on this computer…" : "Testing your key…"}
      </p>
    );
  if (check.kind === "ok")
    return (
      <p className="callout ok" role="status">
        <span className="ok-mark" aria-hidden>
          ✓
        </span>{" "}
        {check.text}
      </p>
    );
  return (
    <div className="callout bad" role="alert">
      <strong>{choice === "cli" ? "Claude Code didn't answer" : "That didn't work"}</strong>
      <p>{check.text}</p>
      {choice === "cli" && (
        <ol className="fix-steps">
          <li>
            Open a terminal and run <code>claude</code>.
          </li>
          <li>Sign in with your Claude account when it asks.</li>
          <li>Come back here and check again.</li>
        </ol>
      )}
      <div>
        <button type="button" className="btn" onClick={onRetry}>
          Check again
        </button>
      </div>
    </div>
  );
}

// ─── 2. CV ─────────────────────────────────────────────────────────────────

function CvStep({
  profile,
  extraction: initialExtraction,
  onBack,
  onConfirmed,
  onNext,
}: {
  profile: StoredProfile | null;
  extraction: Extraction | null;
  onBack: () => void;
  onConfirmed: (p: StoredProfile) => void;
  onNext: () => void;
}) {
  const [extraction, setExtraction] = useState(initialExtraction);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Show the drop zone again when someone with a confirmed Profile wants to replace it.
  const [replacing, setReplacing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const running = extraction?.status === "queued" || extraction?.status === "running";

  useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => {
      const res = await api<Extraction | null>("/api/profile/extract");
      if (res.ok) setExtraction(res.data);
    }, 1500);
    return () => clearInterval(t);
  }, [running]);

  async function upload(file: File | undefined) {
    if (!file) return;
    setError(null);
    setUploading(true);
    const form = new FormData();
    form.set("file", file);
    const res = await api<{ runId: string }>("/api/profile/extract", "POST", form);
    setUploading(false);
    if (input.current) input.current.value = "";
    if (!res.ok) return setError(res.error);
    setReplacing(false);
    const latest = await api<Extraction | null>("/api/profile/extract");
    if (latest.ok) setExtraction(latest.data);
  }

  // A CV that was read but not saved into the Profile yet.
  const pending = extraction?.status === "succeeded" && extraction.output && extraction.output.sourceFile !== profile?.sourceFilePath ? extraction : null;

  async function confirm() {
    if (!pending?.output) return;
    setSaving(true);
    setError(null);
    const res = await api<StoredProfile>("/api/profile", "PUT", {
      contact: pending.output.contact,
      facts: pending.output.facts,
      confirm: true,
      extractionRunId: pending.id,
    });
    setSaving(false);
    if (!res.ok) return setError(res.error);
    onConfirmed(res.data);
    onNext();
  }

  const showDrop = !running && !uploading && !pending && (!profile?.confirmed || replacing);

  return (
    <StepCard
      index={1}
      lead="Every CV and cover letter Job Agent writes is built only from facts in your Profile. Start it from your CV: you check what was read before anything uses it."
      footer={
        <>
          <Back onClick={onBack} />
          {pending ? (
            <button type="button" className="btn primary big" disabled={saving} onClick={() => void confirm()}>
              {saving ? "Saving…" : "Looks right, confirm →"}
            </button>
          ) : (
            <button type="button" className="btn primary big" disabled={!profile?.confirmed || running || uploading} onClick={onNext}>
              Continue →
            </button>
          )}
        </>
      }
    >
      {showDrop && (
        <label
          className={`dropzone${dragging ? " over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void upload(e.dataTransfer.files[0]);
          }}
        >
          <svg className="dropzone-icon" viewBox="0 0 48 48" aria-hidden>
            <path d="M14 6h14l10 10v24a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" />
            <path d="M28 6v10h10M24 34V22m-5 5 5-5 5 5" />
          </svg>
          <strong>Drop your CV here</strong>
          <span className="hint">or click to choose a PDF or Word file (up to 10 MB)</span>
          <input
            ref={input}
            type="file"
            className="sr-only"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => void upload(e.target.files?.[0])}
          />
        </label>
      )}

      {(uploading || running) && (
        <div className="reading" role="status">
          <div className="reading-bar" aria-hidden>
            <span />
          </div>
          <strong>{uploading ? "Uploading…" : `Reading ${extraction?.fileName ?? "your CV"}…`}</strong>
          <span className="hint">{uploading ? "" : (extraction?.lastLog ?? "Waiting for the worker to pick it up…")}</span>
        </div>
      )}

      {pending?.output && <CvSummary contact={pending.output.contact} facts={pending.output.facts} fileName={pending.fileName} />}

      {!pending && !running && profile?.confirmed && !replacing && (
        <>
          <p className="callout ok">
            <span className="ok-mark" aria-hidden>
              ✓
            </span>{" "}
            Your Profile is confirmed with {profile.facts.length} facts.
          </p>
          <CvSummary contact={profile.contact} facts={profile.facts} />
          <div>
            <button type="button" className="btn" onClick={() => setReplacing(true)}>
              Upload a different CV
            </button>
          </div>
        </>
      )}

      {extraction?.status === "failed" && !uploading && (
        <p className="error">
          Couldn&apos;t read {extraction.fileName}: {extraction.error}
        </p>
      )}
      {error && <p className="error">{error}</p>}

      <p className="hint">
        {pending ? "Something wrong or missing? " : "No CV to hand? "}
        <Link href="/profile">{pending ? "Edit every detail in your Profile" : "Fill in your Profile by hand"}</Link>.
      </p>
    </StepCard>
  );
}

function CvSummary({ contact, facts, fileName }: { contact: Contact; facts: ProfileFact[]; fileName?: string }) {
  const roles = facts.filter((f) => f.kind === "role");
  const skills = facts.filter((f) => f.kind === "skill");
  const others = (["education", "achievement", "cert", "language"] as const)
    .map((kind) => ({ kind, n: facts.filter((f) => f.kind === kind).length }))
    .filter((x) => x.n > 0);
  const LABEL = { education: "education", achievement: "achievements", cert: "certifications", language: "languages" } as const;

  return (
    <div className="cv-summary">
      {fileName && (
        <p className="cv-summary-head">
          Here&apos;s what Claude read from <strong>{fileName}</strong>. Check it, then confirm.
        </p>
      )}
      <div className="cv-person">
        <span className="cv-avatar" aria-hidden>
          {(contact.name ?? "?").trim().charAt(0).toUpperCase() || "?"}
        </span>
        <div>
          <strong>{contact.name || "No name found"}</strong>
          <p className="hint">{[contact.email, contact.location].filter(Boolean).join(" · ") || "No contact details found"}</p>
        </div>
      </div>
      {roles.length > 0 && (
        <div>
          <h3 className="cv-label">Experience</h3>
          <ul className="cv-roles">
            {roles.slice(0, 4).map((r) => (
              <li key={r.id || `${r.text}${r.org}`}>
                <strong>{r.text}</strong>
                {r.org && <span> · {r.org}</span>}
                {(r.startDate || r.endDate) && (
                  <span className="hint">
                    {" "}
                    {r.startDate ?? "?"}–{r.endDate || "now"}
                  </span>
                )}
              </li>
            ))}
            {roles.length > 4 && <li className="hint">and {roles.length - 4} more</li>}
          </ul>
        </div>
      )}
      {skills.length > 0 && (
        <div>
          <h3 className="cv-label">Skills</h3>
          <div className="cv-skills">
            {skills.slice(0, 14).map((s) => (
              <span className="tag-chip" key={s.id || s.text}>
                {s.text}
              </span>
            ))}
            {skills.length > 14 && <span className="hint">+{skills.length - 14}</span>}
          </div>
        </div>
      )}
      {others.length > 0 && <p className="hint">Also: {others.map((o) => `${o.n} ${LABEL[o.kind]}`).join(", ")}.</p>}
    </div>
  );
}

// ─── 3. What you're looking for ─────────────────────────────────────────────

/** Titles and location from the CV, so the owner edits a guess instead of starting blank. */
function suggestFromProfile(profile: StoredProfile | null): Pick<PrefsValue, "roles" | "locations"> {
  if (!profile) return { roles: [], locations: [] };
  const roles = [...new Set(profile.facts.filter((f) => f.kind === "role" && f.text.trim()).map((f) => f.text.trim()))].slice(0, 2);
  const location = profile.contact.location?.trim();
  return { roles, locations: location ? [location] : [] };
}

const REMOTE_OPTIONS: { value: PrefsValue["remote"]; label: string }[] = [
  { value: "any", label: "Any" },
  { value: "remote", label: "Remote" },
  { value: "hybrid", label: "Hybrid" },
  { value: "onsite", label: "On-site" },
];

function PrefsStep({ prefs, profile, onBack, onNext }: { prefs: PrefsValue | null; profile: StoredProfile | null; onBack: () => void; onNext: () => void }) {
  const [suggested] = useState(() => !hasPrefs(prefs));
  const [v, setV] = useState<PrefsValue>(() => (hasPrefs(prefs) ? prefs! : { ...(prefs ?? EMPTY_PREFS), ...suggestFromProfile(profile) }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await api("/api/preferences", "PUT", v);
    setSaving(false);
    if (!res.ok) return setError(res.error);
    onNext();
  }

  return (
    <StepCard
      index={2}
      lead="Search looks for these first, and jobs that don't fit are filtered out before any AI sees them."
      footer={
        <>
          <Back onClick={onBack} />
          <button type="button" className="btn primary big" disabled={v.roles.length === 0 || saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Continue →"}
          </button>
        </>
      }
    >
      {suggested && (v.roles.length > 0 || v.locations.length > 0) && <p className="callout">✨ Filled in from your CV. Change anything that&apos;s off.</p>}
      <TagInput
        label="Job titles you want"
        value={v.roles}
        onChange={(roles) => setV((p) => ({ ...p, roles }))}
        placeholder="e.g. Senior Frontend Engineer"
        hint="Press Enter after each one. At least one is needed."
      />
      <TagInput
        label="Where"
        value={v.locations}
        onChange={(locations) => setV((p) => ({ ...p, locations }))}
        placeholder="e.g. Barcelona, Remote EU"
        hint="Cities, countries or regions."
      />
      <fieldset className="field segmented-field">
        <legend>Working style</legend>
        <div className="segmented" role="radiogroup">
          {REMOTE_OPTIONS.map((o) => (
            <label key={o.value} className={v.remote === o.value ? "on" : ""}>
              <input type="radio" name="remote" className="sr-only" checked={v.remote === o.value} onChange={() => setV((p) => ({ ...p, remote: o.value }))} />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>
      <p className="hint">
        Salary floor, must-have stack and companies to skip can wait: they&apos;re in Profile → What I&apos;m looking for.
      </p>
      {error && <p className="error">{error}</p>}
    </StepCard>
  );
}

// ─── 4. Questions ───────────────────────────────────────────────────────────

/** A LinkedIn or personal-site link from the CV, as a full URL. */
function linkFor(question: string, links: string[]): string | null {
  const isLinkedIn = /linkedin/i.test(question);
  const found = links.find((l) => (isLinkedIn ? /linkedin\.com/i.test(l) : !/linkedin\.com|github\.com/i.test(l))) ?? (isLinkedIn ? null : links.find((l) => /github\.com/i.test(l)));
  if (!found) return null;
  return /^https?:\/\//i.test(found) ? found : `https://${found}`;
}

function QuestionsStep({
  questions,
  linkAnswers,
  profile,
  onBack,
  onNext,
}: {
  questions: OnboardingProps["questions"];
  linkAnswers: OnboardingProps["linkAnswers"];
  profile: StoredProfile | null;
  onBack: () => void;
  onNext: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(questions.map((q) => [q.id, q.answer])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (id: string, value: string) => setValues((v) => ({ ...v, [id]: value }));

  // Empty link answers the CV already knows.
  const fromCv = linkAnswers
    .filter((a) => !a.answer)
    .map((a) => ({ ...a, answer: linkFor(a.question, profile?.contact.links ?? []) }))
    .filter((a): a is { id: string; question: string; answer: string } => !!a.answer);

  async function finish() {
    const answers = [
      ...questions.filter((q) => (values[q.id] ?? "").trim() !== q.answer).map((q) => ({ id: q.id, answer: values[q.id] ?? "" })),
      ...fromCv.map((a) => ({ id: a.id, answer: a.answer })),
    ];
    if (answers.length === 0) return onNext();
    setSaving(true);
    setError(null);
    const res = await api("/api/answers", "PUT", { answers });
    setSaving(false);
    if (!res.ok) return setError(res.error);
    onNext();
  }

  return (
    <StepCard
      index={3}
      lead="Almost every application form asks these. Answer them once and they're reused on every job. Skip any: you'll be asked when a form needs it."
      footer={
        <>
          <Back onClick={onBack} />
          <span className="actions">
            <button type="button" className="btn ghost" onClick={onNext}>
              Skip for now
            </button>
            <button type="button" className="btn primary big" disabled={saving} onClick={() => void finish()}>
              {saving ? "Saving…" : "Finish →"}
            </button>
          </span>
        </>
      }
    >
      {questions.map((q) => {
        const value = values[q.id] ?? "";
        const choices: readonly string[] = "choices" in q ? q.choices : [];
        return (
          <div className="field" key={q.id}>
            <label htmlFor={`q-${q.id}`}>{q.label}</label>
            {choices.length > 0 && (
              <div className="segmented" role="group" aria-label={q.label}>
                {choices.map((c) => (
                  <button type="button" key={c} className={value === c ? "on" : ""} aria-pressed={value === c} onClick={() => set(q.id, value === c ? "" : c)}>
                    {c}
                  </button>
                ))}
              </div>
            )}
            <input id={`q-${q.id}`} value={choices.includes(value) ? "" : value} placeholder={q.placeholder} maxLength={200} onChange={(e) => set(q.id, e.target.value)} />
          </div>
        );
      })}
      {fromCv.length > 0 && (
        <p className="callout">
          ✨ From your CV we&apos;ll also save: {fromCv.map((a) => a.answer.replace(/^https?:\/\//, "")).join(", ")}.
        </p>
      )}
      <p className="hint">
        The rest of the common questions are on the <Link href="/questions">Questions</Link> page.
      </p>
      {error && <p className="error">{error}</p>}
    </StepCard>
  );
}

// ─── Done ───────────────────────────────────────────────────────────────────

/** The worker beats every minute; this matches the board's "Worker running" dot. */
const WORKER_ALIVE_MS = 90_000;

function DoneStep({ workerLastSeenAt, onEdit }: { workerLastSeenAt: string | null; onEdit: () => void }) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const workerAlive = !!workerLastSeenAt && now - Date.parse(workerLastSeenAt) < WORKER_ALIVE_MS;

  async function search() {
    setStarting(true);
    setError(null);
    const res = await api("/api/search", "POST");
    if (!res.ok) {
      setStarting(false);
      return setError(res.error);
    }
    router.push("/board");
  }

  return (
    <section className="wizard-card done" aria-labelledby="wizard-title">
      <div className="done-mark" aria-hidden>
        ✓
      </div>
      <h1 id="wizard-title" className="wizard-title">
        You&apos;re all set
      </h1>
      <p className="wizard-lead">
        Job Agent will look for roles that fit and put them in <strong>Found</strong> on your board. Nothing is sent anywhere without your approval.
      </p>
      {!workerAlive && (
        <div className="callout warn" role="alert">
          <strong>The worker isn&apos;t running</strong>
          <p>
            Search runs in the worker. Start it with <code>pnpm dev</code> in the project folder, then search.
          </p>
        </div>
      )}
      <div className="done-actions">
        <button type="button" className="btn primary big" disabled={starting} onClick={() => void search()}>
          {starting ? "Starting…" : "Find my first jobs →"}
        </button>
        <Link className="btn" href="/board">
          Open the board
        </Link>
      </div>
      {error && <p className="error">{error}</p>}
      <button type="button" className="btn ghost" onClick={onEdit}>
        Review my answers
      </button>
    </section>
  );
}
