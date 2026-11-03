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
import { CraftModal } from "./CraftModal";

type Conn = "connecting" | "live" | "offline";

const REFETCH_WINDOW_MS = 300;

export function Board({ initial, setup }: { initial: BoardData; setup: { done: number; total: number } | null }) {
  const [data, setData] = useState(initial);
  const [conn, setConn] = useState<Conn>("connecting");
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [crafting, setCrafting] = useState<string | null>(null); // the card whose Craft modal is open
  const [now, setNow] = useState(() => Date.now());
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(async () => {
    const res = await api<BoardData>("/api/board");
    if (res.ok) setData(res.data);
  }, []);

  // At most one refetch per window, however many events arrive: a running search logs a line every few
  // hundred milliseconds, and each line used to rebuild the whole board.
  const scheduleRefetch = useCallback(() => {
    if (refetchTimer.current) return;
    refetchTimer.current = setTimeout(() => {
      refetchTimer.current = null;
      void refetch();
    }, REFETCH_WINDOW_MS);
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
      return res;
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
  const craftCard = data.cards.find((c) => c.id === crafting);
  const transition = (card: BoardCard, action: string) => post(card.id, `/api/applications/${card.id}/transition`, { action });

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
          {!data.searchRunning && data.lastSearch && <span className={data.lastSearch.ok ? "hint" : "error"}>{data.lastSearch.message}</span>}
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
                  <Card
                    key={c.id}
                    card={c}
                    busy={busy}
                    onAction={async (action) => {
                      // Craft and Regenerate open the modal at once; it shows Claude's progress.
                      if ((await transition(c, action)).ok && (action === "craft" || action === "regenerate")) setCrafting(c.id);
                    }}
                    onOpen={() => setCrafting(c.id)}
                    onChanged={refetch}
                  />
                ))}
                {cards.length === 0 && <p className="empty">—</p>}
              </div>
            </section>
          );
        })}
      </main>

      {craftCard && (
        <CraftModal
          key={craftCard.id}
          card={craftCard}
          onClose={() => setCrafting(null)}
          onChanged={refetch}
          regenerate={() => transition(craftCard, "regenerate")}
        />
      )}

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
  onAction,
  onOpen,
  onChanged,
}: {
  card: BoardCard;
  busy: Set<string>;
  onAction: (action: string) => Promise<void>;
  onOpen: () => void;
  onChanged: () => Promise<void>;
}) {
  const blocked = card.blockers.length > 0;
  const drafted = card.status === "drafted";
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
        <div className="card-pills">
          {card.matchScore !== null && <span className={`score s${Math.floor(card.matchScore / 25)}`}>{card.matchScore}</span>}
          {card.hasDocuments && !drafted && !card.working && (
            <button type="button" className="pdf-pill" onClick={onOpen} aria-label={`Open the CV and cover letter for ${card.company}`}>
              PDF
            </button>
          )}
        </div>
      </div>

      <p className="meta">
        {[card.location, card.remote !== "unknown" ? card.remote : null].filter(Boolean).join(" · ")}
        <br />
        <span className={card.salary === "not stated" ? "muted" : ""}>Salary: {card.salary}</span>
        {card.alertSite && (
          <>
            <br />
            <span className="muted">From {card.alertSite === "Indeed" ? "an" : "a"} {card.alertSite} alert</span>
          </>
        )}
        {card.companyUrl && (
          <>
            <br />
            <a href={card.companyUrl} target="_blank" rel="noreferrer noopener">
              Company jobs page
            </a>
          </>
        )}
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
      {card.requirements && card.requirements.length > 0 && (
        <details className="requirements">
          <summary>
            Meets {card.requirements.filter((r) => r.met).length} of {card.requirements.length} core requirements
          </summary>
          <ul className="reasons">
            {card.requirements.map((r, i) => (
              <li key={i} className={r.met ? "met" : "missed"}>
                {r.text}
              </li>
            ))}
          </ul>
        </details>
      )}

      {card.status === "awaiting_submit" && <p className="badge ready">Ready to submit — review the form, submit, then mark applied</p>}
      {drafted && <p className="badge ready">Draft ready — review it, then Craft</p>}
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

      {(card.actions.length > 0 || drafted) && (
        <div className="actions">
          {drafted && (
            <button className="btn primary" onClick={onOpen}>
              Review draft
            </button>
          )}
          {card.actions.map(({ action, label }) => (
            <button
              key={action}
              className={`btn ${action === "dismiss" || action === "withdraw" ? "ghost" : ""}`}
              disabled={busy.has(card.id)}
              onClick={() => void onAction(action)}
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
