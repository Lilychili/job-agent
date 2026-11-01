# Architecture

## Stack

| Layer | Choice | Why |
|---|---|---|
| Web | Next.js (App Router) + React | Onboarding form, board, review screen, settings |
| DB | **Postgres** + Drizzle (or Prisma) | Real DB; also required by pg-boss |
| Queue | pg-boss | Runs on Postgres, nothing extra to operate |
| Worker | Separate Node process | Agent runs take minutes; never inside a request |
| Live updates | Server-Sent Events | One-way server → board; simpler than WebSockets |
| Browser automation / PDF | Playwright | Render PDFs and fill forms (already installed) |
| LLM | Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) for Scout and Shipper; Messages API with tool use + structured output for Pen and CV extraction | Agent loop where tools are needed; plain calls where they aren't |

> **Note on SQLite:** the brief allows SQLite for single-user. pg-boss needs Postgres, so if you choose SQLite you'd need a different queue. Recommendation: use Postgres from day one (a local Docker container is enough) and keep one queue story.

## Process layout

```
┌────────────── web (Next.js) ──────────────┐        ┌──────────── worker (Node) ────────────┐
│ UI routes, API route handlers             │        │ pg-boss consumers                      │
│ transition() → insert job into pg-boss ───┼──PG───▶│ scout.search  pen.craft  shipper.*     │
│ /api/events (SSE) ◀── LISTEN app_events ──┼──PG◀───│ NOTIFY app_events on every change      │
└───────────────────────────────────────────┘        └────────────────────────────────────────┘
                                   Postgres (data + queue + LISTEN/NOTIFY)
```

The worker publishes progress with Postgres `NOTIFY`; the SSE endpoint `LISTEN`s and forwards to the browser. No Redis needed.

## Repo layout

```
apps/
  web/                      # Next.js
    app/(onboarding)/...
    app/board/...
    app/review/[applicationId]/...
    app/questions/...
    app/settings/...
    app/api/events/route.ts # SSE
  worker/
    src/index.ts            # pg-boss bootstrap
    src/jobs/scout.ts
    src/jobs/pen.ts
    src/jobs/shipper.ts
packages/
  db/                       # schema, migrations, typed queries
  core/                     # state machine, transition(), guards
  agents/                   # Claude client wrapper, usage logging, structured-output schemas
  ats/                      # Greenhouse, Lever, Ashby clients (pure HTTP, no LLM)
  documents/                # HTML templates, render-to-PDF, metadata strip, hashing
  forms/                    # Playwright form-filling adapters per ATS
  security/                 # untrusted-content wrapping, secret encryption
agents/
  scout/agent.md            # versioned prompt files
  pen/agent.md
  shipper/agent.md
  shared/security-rules.md
```

## Claude integration

- One wrapper `runAgent({ role, input, tools, outputSchema })` in `packages/agents`:
  - Loads `agents/<role>/agent.md` + `agents/shared/security-rules.md`; records the prompt file's git hash on the AgentRun.
  - Reaches Claude through the provider chosen in Settings: the encrypted API key, read at call time, or the owner's Claude Code CLI (subscription).
  - Logs **real** `usage` (input, output, cache read/write tokens) from every response onto the AgentRun.
  - Validates output against a Zod schema; one repair retry on invalid JSON, then fail the run.
- Tools are explicit and minimal per role (see AGENTS.md). No shell, no arbitrary file system access, no `--dangerously-skip-permissions` equivalent.

## Job design

- Jobs are idempotent: keyed by `applicationId + action + version`. Re-delivery of the same job is a no-op.
- Checkpoints stored on `AgentRun.checkpoint` (JSON) so paused runs can resume.
- Timeouts: Scout 5 min, Pen 3 min, Shipper 10 min. On timeout → run failed, card returns to previous status with error.
- Crash recovery: a dead worker can't time anything out, so at startup and with every heartbeat the worker fails runs left `running` past their limit (`failStaleRuns`). Otherwise the one-active-run rule would block the card for good.

## File storage

Local disk under `data/` (`data/documents/<applicationId>/<kind>-v<n>.pdf`, `data/evidence/...`). Paths + hashes in DB. Swap for S3-compatible storage later if needed.
