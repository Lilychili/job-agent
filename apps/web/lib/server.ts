import "server-only";
import { EventEmitter } from "node:events";
import pg from "pg";
import { ClaudeError, CliError } from "@jobagent/agents";
import { ConfigError, dataDirFromEnv, TransitionError, ValidationError, type CoreContext } from "@jobagent/core";
import { APP_EVENTS_CHANNEL, createDb, createPool, databaseUrl, type Db } from "@jobagent/db";
import { makeEnqueue, startBoss, type PgBoss } from "@jobagent/queue";

// Connections survive Next.js dev hot reloads by living on globalThis. The Drizzle wrapper doesn't:
// it holds the schema, which must stay in step with the code.
type Globals = {
  pool?: pg.Pool;
  boss?: Promise<PgBoss>;
  events?: EventEmitter;
  listener?: Promise<void>;
};
const g = globalThis as typeof globalThis & { __jobagent?: Globals };
const s = (g.__jobagent ??= {});

export function getPool(): pg.Pool {
  s.pool ??= createPool();
  return s.pool;
}

export function getDb(): Db {
  return createDb(getPool());
}

export async function getCtx(): Promise<CoreContext> {
  s.boss ??= startBoss(databaseUrl()).catch((err) => {
    s.boss = undefined;
    throw err;
  });
  const boss = await s.boss;
  return { pool: getPool(), enqueue: makeEnqueue(boss), dataDir: dataDirFromEnv() };
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

/** Postgres rejected an id that isn't a UUID, so nothing can have that id. */
function isBadUuid(err: unknown): boolean {
  for (let e = err as { code?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (e.code === "22P02") return true;
  }
  return false;
}

/** Map core errors to HTTP responses. */
export function errorResponse(err: unknown): Response {
  if (err instanceof ValidationError) {
    return Response.json({ error: err.message, code: "invalid" }, { status: 400 });
  }
  if (err instanceof ClaudeError || err instanceof CliError) {
    return Response.json({ error: err.message, code: "claude" }, { status: 502 });
  }
  if (err instanceof ConfigError) {
    return Response.json({ error: err.message, code: "config" }, { status: 500 });
  }
  if (isBadUuid(err)) {
    return Response.json({ error: "Not found.", code: "not_found" }, { status: 404 });
  }
  if (err instanceof TransitionError) {
    const status = { not_found: 404, illegal: 409, busy: 409, guard: 422 }[err.code];
    return Response.json({ error: err.message, code: err.code }, { status });
  }
  console.error(err);
  return Response.json({ error: "Something went wrong.", code: "internal" }, { status: 500 });
}
