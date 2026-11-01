"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { BlockerAnswerForm } from "@/components/BlockerAnswerForm";
import { TopBar } from "@/components/TopBar";
import { api } from "@/lib/api";
import { useAppEvents } from "@/lib/useAppEvents";
import { COLUMNS } from "@jobagent/core/machine";
import type { BoardCard, BoardData } from "@/lib/board";
import { AddJobDialog } from "./AddJobDialog";

type Conn = "connecting" | "live" | "offline";

export function Board({ initial, setup }: { initial: BoardData; setup: { done: number; total: number } | null }) {
  const [data, setData] = useState(initial);
  const [conn, setConn] = useState<Conn>("connecting");
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(async () => {
    const res = await api<BoardData>("/api/board");
    if (res.ok) setData(res.data);
  }, []);

  // Coalesce bursts of events (a transition can emit several) into one refetch.
  const scheduleRefetch = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => void refetch(), 80);
  }, [refetch]);

  useAppEvents({
    onEvent: (type) => {
      if (type !== "hello") scheduleRefetch();
    },
    onStatus: (status) => {
      setConn(status);
      if (status === "live") scheduleRefetch(); // catch up on anything missed while disconnected
    },
  });

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  async function post(key: string, url: string, body?: unknown) {
    setBusy((s) => new Set(s).add(key));
    try {
      const res = await api(url, "POST", body);
      if (!res.ok) setToast(res.error);
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
      <TopBar />
      {setup && (
        <Link className="setup-banner" href="/setup">
          {setup.done} of {setup.total} setup steps done. Continue setup <span aria-hidden>→</span>
        </Link>
      )}
      <div className="board-bar">
        <h1 className="sr-only">Board</h1>
        <div className="status">
          <StatusDot ok={conn === "live"} label={conn === "live" ? "Live" : conn === "connecting" ? "Connecting" : "Reconnecting"} />
          <StatusDot ok={!!workerAlive} label={workerAlive ? "Worker running" : "Worker offline"} />
        </div>
        <div className="actions">
          <AddJobDialog onAdded={refetch} />
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
      </div>

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
                  <Card key={c.id} card={c} busy={busy} post={post} onChanged={refetch} />
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
  onChanged,
}: {
  card: BoardCard;
  busy: Set<string>;
  post: (key: string, url: string, body?: unknown) => Promise<boolean>;
  onChanged: () => Promise<void>;
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
        <BlockerAnswerForm key={b.id} blockerId={b.id} question={b.question} className="blocker" onAnswered={onChanged}>
          <p className="badge danger">Needs your answer</p>
        </BlockerAnswerForm>
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
