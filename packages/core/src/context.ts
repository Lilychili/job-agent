import { existsSync } from "node:fs";
import path from "node:path";
import type pg from "pg";

export interface EnqueueRequest {
  name: string;
  /** AgentRun id; also used as the queue job id so re-delivery is a no-op. */
  id: string;
  data: { runId: string; applicationId: string | null };
}

/**
 * Writes a queue job using `client`, i.e. inside the caller's transaction,
 * so a rolled-back transition never leaves a job behind.
 */
export type Enqueue = (client: pg.PoolClient, req: EnqueueRequest) => Promise<void>;

export interface CoreContext {
  pool: pg.Pool;
  enqueue: Enqueue;
  /** Root for documents and evidence files (DATA_DIR). */
  dataDir: string;
}

/**
 * DATA_DIR from env, resolved against the repo root (not the cwd), so the web app
 * (cwd apps/web) and the worker (cwd apps/worker) agree on where files live.
 */
export function dataDirFromEnv(): string {
  const raw = process.env.DATA_DIR ?? "./data";
  return path.resolve(repoRoot(), raw);
}

/** The monorepo root, whichever app we were started from. */
export function repoRoot(): string {
  let dir = process.cwd();
  while (!existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
    const up = path.dirname(dir);
    if (up === dir) throw new Error("Could not find the repo root (pnpm-workspace.yaml).");
    dir = up;
  }
  return dir;
}

export function resolveDataPath(ctx: Pick<CoreContext, "dataDir">, relative: string): string {
  const full = path.resolve(ctx.dataDir, relative);
  if (!full.startsWith(path.resolve(ctx.dataDir) + path.sep)) {
    throw new Error(`Path escapes DATA_DIR: ${relative}`);
  }
  return full;
}

export class TransitionError extends Error {
  constructor(
    public readonly code: "not_found" | "illegal" | "guard" | "busy",
    message: string,
  ) {
    super(message);
    this.name = "TransitionError";
  }
}
