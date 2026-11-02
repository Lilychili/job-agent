"use client";

import { useState } from "react";
import { SaveBar, type SaveState } from "@/components/SaveBar";
import { TagInput } from "@/components/TagInput";
import { api } from "@/lib/api";

type Board = { ats: "greenhouse" | "lever" | "ashby"; boardToken: string };

export interface PrefsValue {
  roles: string[];
  locations: string[];
  remote: "onsite" | "hybrid" | "remote" | "any";
  salaryFloor: string;
  salaryCurrency: string;
  stackMustHave: string[];
  stackNiceToHave: string[];
  exclusions: { companies: string[]; keywords: string[]; seniority: string[] };
  companyBoards: Board[];
}

export function PreferencesForm({ initial }: { initial: PrefsValue }) {
  const [v, setV] = useState(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const dirty = JSON.stringify(v) !== saved;
  const set = <K extends keyof PrefsValue>(key: K, value: PrefsValue[K]) => {
    setV((p) => ({ ...p, [key]: value }));
    setState({ kind: "idle" });
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState({ kind: "saving" });
    const res = await api("/api/preferences", "PUT", v);
    if (!res.ok) return setState({ kind: "error", message: res.error });
    setSaved(JSON.stringify(v));
    setState({ kind: "saved", message: "Preferences saved." });
  }

  return (
    <form onSubmit={save}>
      <section className="panel">
        <h2>Role</h2>
        <TagInput
          label="Job titles you want"
          value={v.roles}
          onChange={(x) => set("roles", x)}
          placeholder="Senior Frontend Engineer, Staff Engineer…"
          hint="Press Enter after each one. Search looks for these titles first, and a job far from them scores low."
        />
      </section>

      <section className="panel">
        <h2>Where and how</h2>
        <TagInput
          label="Locations"
          value={v.locations}
          onChange={(x) => set("locations", x)}
          placeholder="Barcelona, Remote EU…"
          hint="Press Enter after each one."
        />
        <div className="field">
          <label htmlFor="remote">Remote policy</label>
          <select id="remote" value={v.remote} onChange={(e) => set("remote", e.target.value as PrefsValue["remote"])}>
            <option value="any">Any</option>
            <option value="remote">Remote only</option>
            <option value="hybrid">Hybrid</option>
            <option value="onsite">On-site</option>
          </select>
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="floor">Salary floor (per year)</label>
            <input
              id="floor"
              inputMode="numeric"
              placeholder="e.g. 60000"
              value={v.salaryFloor}
              onChange={(e) => set("salaryFloor", e.target.value.replace(/[^\d]/g, ""))}
            />
          </div>
          <div className="field narrow">
            <label htmlFor="cur">Currency</label>
            <input id="cur" maxLength={3} placeholder="EUR" value={v.salaryCurrency} onChange={(e) => set("salaryCurrency", e.target.value.toUpperCase())} />
          </div>
        </div>
        <p className="hint">Jobs that don&apos;t state a salary are never guessed at; they&apos;re shown as &ldquo;not stated&rdquo;.</p>
      </section>

      <section className="panel">
        <h2>Stack</h2>
        <TagInput label="Must have" value={v.stackMustHave} onChange={(x) => set("stackMustHave", x)} placeholder="TypeScript, React…" />
        <TagInput label="Nice to have" value={v.stackNiceToHave} onChange={(x) => set("stackNiceToHave", x)} placeholder="GraphQL, Go…" />
      </section>

      <section className="panel">
        <h2>Exclusions</h2>
        <TagInput
          label="Companies to skip"
          value={v.exclusions.companies}
          onChange={(x) => set("exclusions", { ...v.exclusions, companies: x })}
        />
        <TagInput
          label="Keywords to skip"
          value={v.exclusions.keywords}
          onChange={(x) => set("exclusions", { ...v.exclusions, keywords: x })}
          placeholder="crypto, gambling…"
          hint="Any posting with these words in the title is dropped."
        />
        <TagInput
          label="Seniority to skip"
          value={v.exclusions.seniority}
          onChange={(x) => set("exclusions", { ...v.exclusions, seniority: x })}
          placeholder="Intern, Junior…"
        />
      </section>

      <section className="panel">
        <h2>Always search these (optional)</h2>
        <p className="hint">
          Search finds companies on its own: Claude looks them up on the web and checks their job boards. Add a company here only
          if you want it searched every time. The board name is the last part of its URL, e.g. boards.greenhouse.io/
          <strong>acme</strong>.
        </p>
        {v.companyBoards.map((b, i) => (
          <div className="row" key={i}>
            <div className="field narrow">
              <label htmlFor={`ats-${i}`} className="sr-only">
                Board type
              </label>
              <select
                id={`ats-${i}`}
                value={b.ats}
                onChange={(e) => set("companyBoards", v.companyBoards.map((x, j) => (j === i ? { ...x, ats: e.target.value as Board["ats"] } : x)))}
              >
                <option value="greenhouse">Greenhouse</option>
                <option value="lever">Lever</option>
                <option value="ashby">Ashby</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor={`tok-${i}`} className="sr-only">
                Board name
              </label>
              <input
                id={`tok-${i}`}
                placeholder="board name"
                value={b.boardToken}
                onChange={(e) => set("companyBoards", v.companyBoards.map((x, j) => (j === i ? { ...x, boardToken: e.target.value } : x)))}
              />
            </div>
            <button type="button" className="btn ghost" aria-label="Remove board" onClick={() => set("companyBoards", v.companyBoards.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        ))}
        <button type="button" className="btn" onClick={() => set("companyBoards", [...v.companyBoards, { ats: "greenhouse", boardToken: "" }])}>
          + Add a company
        </button>
      </section>

      <SaveBar state={state} dirty={dirty}>
        <button className="btn primary big" disabled={!dirty || state.kind === "saving"}>
          Save preferences
        </button>
      </SaveBar>
    </form>
  );
}
