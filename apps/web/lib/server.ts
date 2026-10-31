import "server-only";
import { EventEmitter } from "node:events";
import pg from "pg";
import { dataDirFromEnv, TransitionError, type CoreContext } from "@jobagent/core";
import { APP_EVENTS_CHANNEL, createDb, createPool, databaseUrl, type Db } from "@jobagent/db";
import { makeEnqueue, startBoss, type PgBoss } from "@jobagent/queue";

// Singletons survive Next.js dev hot reloads by living on globalThis.
type Globals = {
  pool?: pg.Pool;
  db?: Db;
  boss?: Promise<PgBoss>;
  events?: EventEmitter;
  listener?: Promise<void>;
};
const g = globalThis as typeof globalThis & { __jobagent?: Globals };
const s = (g.__jobagent ??= {});

export function getDb(): Db {
  s.pool ??= createPool();
  s.db ??= createDb(s.pool);
  return s.db;
}

export async function getCtx(): Promise<CoreContext> {
  getDb();
  s.boss ??= startBoss(databaseUrl()).catch((err) => {
    s.boss = undefined;
    throw err;
  });
  const boss = await s.boss;
  return { pool: s.pool!, enqueue: makeEnqueue(boss), dataDir: dataDirFromEnv() };
}

/**
 * One LISTEN connection for the whole server, fanned out to every SSE client.
 * Reconnects with backoff; emits "reconnected" so clients can refetch what they missed.
 */
export function appEvents(): EventEmitter {
  if (!s.events) {
    s.events = new EventEmitter();
    s.events.setMaxListeners(100);
  }
  s.listener ??= listen(s.events, 0);
  return s.events;
}

async function listen(events: EventEmitter, attempt: number): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  const retry = () => {
    client.removeAllListeners();
    client.end().catch(() => {});
    const delay = Math.min(30_000, 500 * 2 ** attempt);
    setTimeout(() => void listen(events, attempt + 1), delay);
  };
  client.on("error", retry);
  client.on("notification", (n) => {
    if (n.channel === APP_EVENTS_CHANNEL && n.payload) events.emit("event", n.payload);
  });
  try {
    await client.connect();
    await client.query(`LISTEN ${APP_EVENTS_CHANNEL}`);
    if (attempt > 0) events.emit("event", JSON.stringify({ type: "reconnected" }));
    attempt = 0;
  } catch {
    retry();
  }
}

/** Map core errors to HTTP responses. */
export function errorResponse(err: unknown): Response {
  if (err instanceof TransitionError) {
    const status = { not_found: 404, illegal: 409, busy: 409, guard: 422 }[err.code];
    return Response.json({ error: err.message, code: err.code }, { status });
  }
  console.error(err);
  return Response.json({ error: "Something went wrong.", code: "internal" }, { status: 500 });
}
