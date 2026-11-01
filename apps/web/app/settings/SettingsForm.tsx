"use client";

import { useState } from "react";
import { SaveBar, type SaveState } from "@/components/SaveBar";
import { api } from "@/lib/api";

type Provider = "api" | "cli";
interface View {
  provider: Provider;
  hasKey: boolean;
  maskedKey: string | null;
  defaultModel: string;
  ready: boolean;
}

const MODELS = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"];

export function SettingsForm({ initial, encryptionReady }: { initial: View; encryptionReady: boolean }) {
  const [view, setView] = useState(initial);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(initial.defaultModel);
  const [providerState, setProviderState] = useState<SaveState>({ kind: "idle" });
  const [keyState, setKeyState] = useState<SaveState>({ kind: "idle" });
  const [modelState, setModelState] = useState<SaveState>({ kind: "idle" });
  const [test, setTest] = useState<{ busy: boolean; ok?: boolean; text?: string }>({ busy: false });
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function chooseProvider(provider: Provider) {
    if (provider === view.provider) return;
    setProviderState({ kind: "saving" });
    setTest({ busy: false });
    const res = await api<View>("/api/settings", "PUT", { provider });
    if (!res.ok) return setProviderState({ kind: "error", message: res.error });
    setView(res.data);
    setProviderState({ kind: "saved", message: provider === "cli" ? "Using Claude Code." : "Using your API key." });
  }

  async function saveKey(e: React.FormEvent) {
    e.preventDefault();
    setKeyState({ kind: "saving" });
    const res = await api<View>("/api/settings", "PUT", { apiKey });
    if (!res.ok) return setKeyState({ kind: "error", message: res.error });
    setView(res.data);
    setApiKey("");
    setTest({ busy: false });
    setKeyState({ kind: "saved", message: "Key saved (encrypted)." });
  }

  async function removeKey() {
    if (!confirm("Remove the stored API key?")) return;
    const res = await api<View>("/api/settings", "DELETE");
    if (res.ok) {
      setView(res.data);
      setTest({ busy: false });
      setKeyState({ kind: "saved", message: "Key removed." });
    } else setKeyState({ kind: "error", message: res.error });
  }

  async function runTest() {
    setTest({ busy: true });
    const res = await api<{ ok: boolean; model?: string; error?: string }>("/api/settings/test", "POST");
    if (!res.ok) return setTest({ busy: false, ok: false, text: res.error });
    setTest(
      res.data.ok
        ? { busy: false, ok: true, text: `Works. One tiny call (${res.data.model}) succeeded.` }
        : { busy: false, ok: false, text: res.data.error },
    );
  }

  async function deleteEverything() {
    const typed = prompt("This erases your Profile, answers, jobs, applications, documents, uploaded CVs and API key. It can't be undone. Type DELETE to confirm.");
    if (typed === null) return;
    const res = await api("/api/data/delete", "POST", { confirm: typed });
    if (!res.ok) return setDeleteError(res.error);
    window.location.href = "/setup";
  }

  async function saveModel(e: React.FormEvent) {
    e.preventDefault();
    setModelState({ kind: "saving" });
    const res = await api<View>("/api/settings", "PUT", { defaultModel: model });
    if (!res.ok) return setModelState({ kind: "error", message: res.error });
    setView(res.data);
    setModelState({ kind: "saved", message: "Model saved." });
  }

  const testButton = (
    <button type="button" className="btn" onClick={runTest} disabled={test.busy}>
      {test.busy ? "Testing…" : "Test connection"}
    </button>
  );
  const testResult = test.text && (
    <p className={`test-result ${test.ok ? "ok" : "bad"}`} role="status">
      {test.ok ? "✓ " : "✗ "}
      {test.text}
    </p>
  );

  return (
    <>
      <section className="panel">
        <h2>How should agents reach Claude?</h2>
        <div className="choices" role="radiogroup" aria-label="Claude connection">
          <label className={`choice${view.provider === "cli" ? " selected" : ""}`}>
            <input type="radio" name="provider" checked={view.provider === "cli"} onChange={() => void chooseProvider("cli")} />
            <span>
              <strong>Claude Code (your subscription)</strong>
              <span className="hint">
                Uses the Claude Code CLI you&apos;re already signed in to, so work counts against your Claude plan, not a pay-per-use bill. Fine for a personal
                tool on your own computer. Heavy use can hit your plan&apos;s limits.
              </span>
            </span>
          </label>
          <label className={`choice${view.provider === "api" ? " selected" : ""}`}>
            <input type="radio" name="provider" checked={view.provider === "api"} onChange={() => void chooseProvider("api")} />
            <span>
              <strong>Anthropic API key (pay per use)</strong>
              <span className="hint">Billed per token to your Anthropic Console account, separately from any Claude subscription.</span>
            </span>
          </label>
        </div>
        <SaveBar state={providerState} dirty={false}>
          {null}
        </SaveBar>
      </section>

      {view.provider === "cli" ? (
        <section className="panel">
          <h2>Claude Code</h2>
          <p>
            Agents run <code>claude -p</code> on this computer with no tools and no access to your files. An <code>ANTHROPIC_API_KEY</code> in your
            environment is ignored for these calls, so they can&apos;t bill the API by accident.
          </p>
          <p className="hint">
            Not signed in yet? Open a terminal, run <code>claude</code>, and log in with your Claude account. Then test the connection.
          </p>
          <div className="actions">{testButton}</div>
          {testResult}
        </section>
      ) : (
        <>
          {!encryptionReady && (
            <div className="panel warn" role="alert">
              <h2>Encryption key missing</h2>
              <p>
                <code>APP_ENCRYPTION_KEY</code> isn&apos;t set in <code>.env</code>, so an API key can&apos;t be stored safely. Add one and restart{" "}
                <code>pnpm dev</code> (see the README).
              </p>
            </div>
          )}
          <form className="panel" onSubmit={saveKey}>
            <h2>Anthropic API key</h2>
            <p className="hint">Create one at console.anthropic.com. It is encrypted before it is stored and never sent back to the browser.</p>
            <p className="key-status">
              {view.hasKey ? (
                <>
                  <span className="dot ok" aria-hidden /> Stored: <code>{view.maskedKey}</code>
                </>
              ) : (
                <>
                  <span className="dot bad" aria-hidden /> No key stored yet
                </>
              )}
            </p>
            <div className="field">
              <label htmlFor="apikey">{view.hasKey ? "Replace key" : "API key"}</label>
              <input
                id="apikey"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="sk-ant-…"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
            <SaveBar state={keyState} dirty={apiKey !== ""}>
              {view.hasKey && (
                <>
                  {testButton}
                  <button type="button" className="btn ghost" onClick={removeKey}>
                    Remove
                  </button>
                </>
              )}
              <button className="btn primary" disabled={!apiKey.trim() || keyState.kind === "saving" || !encryptionReady}>
                Save key
              </button>
            </SaveBar>
            {testResult}
          </form>
        </>
      )}

      <section className="panel">
        <h2>Your data</h2>
        <p className="hint">Everything is stored on this computer. Export gives you all of it as a JSON file (never your API key).</p>
        <div className="actions">
          <a className="btn" href="/api/data/export" download>
            Export all data
          </a>
          <button type="button" className="btn ghost" onClick={deleteEverything}>
            Delete all data
          </button>
        </div>
        {deleteError && <p className="error">{deleteError}</p>}
      </section>

      <form className="panel" onSubmit={saveModel}>
        <h2>Default model</h2>
        <p className="hint">Used for reading your CV. Leave empty for the default (claude-sonnet-5-5).</p>
        <div className="field">
          <label htmlFor="model">Model</label>
          <input id="model" list="models" value={model} placeholder="claude-sonnet-5-5" onChange={(e) => setModel(e.target.value)} />
          <datalist id="models">
            {MODELS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>
        <SaveBar state={modelState} dirty={model !== view.defaultModel}>
          <button className="btn primary" disabled={model === view.defaultModel || modelState.kind === "saving"}>
            Save model
          </button>
        </SaveBar>
      </form>
    </>
  );
}
