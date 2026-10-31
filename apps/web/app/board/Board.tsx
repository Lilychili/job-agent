"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { COLUMNS } from "@jobagent/core/machine";
import type { BoardCard, BoardData } from "@/lib/board";

type Conn = "connecting" | "live" | "offline";

export function Board({ initial }: { initial: BoardData }) {
  const [data, setData] = useState(initial);
  const [conn, setConn] = useState<Conn>("connecting");
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/board", { cache: "no-store" });
    if (res.ok) setData(await res.json());
  }, []);

  // Coalesce bursts of events (a transition can emit several) into one refetch.
  const scheduleRefetch = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => void refetch(), 80);
  }, [refetch]);

  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onopen = () => {
      setConn("live");
      scheduleRefetch(); // catch up on anything missed while disconnected
    };
    es.onerror = () => setConn("offline");
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data) as { type: string };
      if (ev.type !== "hello") scheduleRefetch();
    };
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      es.close();
      clearInterval(tick);
    };
  }, [scheduleRefetch]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  async function post(key: string, url: string, body?: unknown) {
    setBusy((s) => new Set(s).add(key));
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setToast(err.error ?? `Request failed (${res.status})`);
      }
      await refetch();
      return res.ok;
    } finally {
      setBusy((s) => {
        const n = new Set(s);
        n.delete(key);
        return n;
      });
    }
  }

  const workerAlive = data.workerLastSeenAt && now - Date.parse(data.workerLastSeenAt) < 90_000;
  const byColumn = (id: string) => data.cards.filter((c) => c.column === id);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>◆</span>
          <h1>Job Agent</h1>
        </div>
        <div className="status">
          <StatusDot ok={conn === "live"} label={conn === "live" ? "Live" : conn === "connecting" ? "Connecting" : "Reconnecting"} />
          <StatusDot ok={!!workerAlive} label={workerAlive ? "Worker running" : "Worker offline"} />
          <button
            className="btn primary"
            disabled={data.searchRunning || busy.has("search")}
            onClick={() => void post("search", "/api/search")}
          >
            {data.searchRunning ? (
              <>
                <Spinner /> Searching…
              </>
            ) : (
              "Search"
            )}
          </button>
        </div>
      </header>

      <main className="board" aria-label="Applications board">
        {COLUMNS.map((col) => {
          const cards = byColumn(col.id);
          return (
            <section className="column" key={col.id} aria-labelledby={`col-${col.id}`}>
              <h2 id={`col-${col.id}`}>
                {col.title}
                <span className="count">{cards.length}</span>
              </h2>
              <div className="cards">
                {cards.map((c) => (
                  <Card key={c.id} card={c} busy={busy} post={post} />
                ))}
                {cards.length === 0 && <p className="empty">—</p>}
              </div>
            </section>
          );
        })}
      </main>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function Card({
  card,
  busy,
  post,
}: {
  card: BoardCard;
  busy: Set<string>;
  post: (key: string, url: string, body?: unknown) => Promise<boolean>;
}) {
  const blocked = card.blockers.length > 0;
  return (
    <article className={`card${card.working ? " working" : ""}${blocked ? " blocked" : ""}`}>
      <div className="card-head">
        <div>
          <p className="company">{card.company}</p>
          <h3 className="title">
            <a href={card.sourceUrl} target="_blank" rel="noreferrer noopener">
              {card.title}
            </a>
          </h3>
        </div>
        {card.matchScore !== null && <span className={`score s${Math.floor(card.matchScore / 25)}`}>{card.matchScore}</span>}
      </div>

      <p className="meta">
        {[card.location, card.remote !== "unknown" ? card.remote : null].filter(Boolean).join(" · ")}
        <br />
        <span className={card.salary === "not stated" ? "muted" : ""}>Salary: {card.salary}</span>
      </p>

      {card.matchReasons && (
        <ul className="reasons">
          {card.matchReasons.met.slice(0, 3).map((r) => (
            <li key={`m-${r}`} className="met">{r}</li>
          ))}
          {card.matchReasons.missed.slice(0, 2).map((r) => (
            <li key={`x-${r}`} className="missed">{r}</li>
          ))}
        </ul>
      )}

      {card.status === "awaiting_submit" && <p className="badge ready">Ready to submit — review the form, submit, then mark applied</p>}
      {card.working && (
        <p className="progress">
          <Spinner /> {card.runLog ?? "Queued…"}
        </p>
      )}
      {card.lastError && <p className="error">{card.lastError}</p>}

      {card.blockers.map((b) => (
        <BlockerForm key={b.id} blocker={b} busy={busy.has(`b-${b.id}`)} post={post} />
      ))}

      {card.actions.length > 0 && (
        <div className="actions">
          {card.actions.map(({ action, label }) => (
            <button
              key={action}
              className={`btn ${action === "dismiss" || action === "withdraw" ? "ghost" : ""}`}
              disabled={busy.has(card.id)}
              onClick={() => void post(card.id, `/api/applications/${card.id}/transition`, { action })}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

function BlockerForm({
  blocker,
  busy,
  post,
}: {
  blocker: { id: string; question: string; label: string };
  busy: boolean;
  post: (key: string, url: string, body?: unknown) => Promise<boolean>;
}) {
  const [answer, setAnswer] = useState("");
  const [reuse, setReuse] = useState(true);
  return (
    <form
      className="blocker"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await post(`b-${blocker.id}`, `/api/blockers/${blocker.id}/answer`, { answer, reuse })) setAnswer("");
      }}
    >
      <p className="badge danger">Needs your answer</p>
      <label htmlFor={`b-${blocker.id}`}>{blocker.question}</label>
      <input id={`b-${blocker.id}`} value={answer} onChange={(e) => setAnswer(e.target.value)} required />
      <div className="blocker-row">
        <label className="check">
          <input type="checkbox" checked={reuse} onChange={(e) => setReuse(e.target.checked)} /> Reuse for future jobs
        </label>
        <button className="btn primary" disabled={busy || !answer.trim()}>
          Save
        </button>
      </div>
    </form>
  );
}

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="dot-label">
      <span className={`dot ${ok ? "ok" : "bad"}`} aria-hidden />
      {label}
    </span>
  );
}

function Spinner() {
  return <span className="spinner" aria-hidden />;
}
