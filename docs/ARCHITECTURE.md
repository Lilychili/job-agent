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
| LLM | Structured output with no tools for Scout, Pen and CV extraction, and for Shipper's custom-question mapping | Shipper fills forms with deterministic per-ATS adapters (`packages/forms`), so v1 needs no agent loop |

> **Note on SQLite:** the brief allows SQLite for single-user. pg-boss needs Postgres, so if you choose SQLite you'd need a different queue. Recommendation: use Postgres from day one (a local Docker container is enough) and keep one queue story.

## Process layout

```
┌────────────── web (Next.js) ──────────────┐        ┌──────────── worker (Node) ────────────┐
│ UI routes, API route handlers             │        │ pg-boss consumers                      │
│ transition() → insert job into pg-boss ───┼──PG───▶│ scout.*  pen.craft  shipper.*  replies │
│ /api/events (SSE) ◀── LISTEN app_events ──┼──PG◀───│ NOTIFY app_events on every change      │
└───────────────────────────────────────────┘        └────────────────────────────────────────┘
                                   Postgres (data + queue + LISTEN/NOTIFY)
```

The worker publishes progress with Postgres `NOTIFY`; the SSE endpoint `LISTEN`s and forwards to the browser. No Redis needed.

## Repo layout

```
apps/
  web/                      # Next.js
    app/setup/              # onboarding checklist
    app/profile/...         # Profile editor; looking-for/ = Preferences
    app/board/...           # board, Craft modal, PDF preview, prefill review
    app/questions/...       # AnswerBank and Blockers inbox
    app/settings/...        # Claude provider, Gmail, export / delete
    app/api/events/route.ts # SSE
    proxy.ts                # refuses requests that don't come from this machine
  worker/
    src/index.ts            # pg-boss bootstrap, heartbeat, stale-run recovery
    src/runner.ts           # claim, time limit, Stop, failure rollback for every job
    src/jobs/extractor.ts   # CV -> draft Profile
    src/jobs/scout.ts       # Discover + boards + alerts -> scored jobs
    src/jobs/rescore.ts
    src/jobs/pen.ts
    src/jobs/locate.ts      # find the application form after Approve
    src/jobs/shipper.ts     # prefill, resume, capture evidence
    src/jobs/replies.ts     # Gmail replies -> Replied / Rejected
packages/
  db/                       # schema, migrations, typed queries
  core/                     # state machine, transition(), guards, runs, Gmail, secret encryption
  queue/                    # pg-boss setup, per-queue time limits
  agents/                   # Claude client wrapper, usage logging, structured-output schemas;
                            # Pen's HTML templates, render-to-PDF, metadata strip, document saving
  ats/                      # Greenhouse, Lever, Ashby clients and form finding (pure HTTP, no LLM)
  forms/                    # Playwright form-filling adapters per ATS; FormSession enforces the
                            # host lock, the submit block and the hash check in code
agents/                     # versioned prompt files, one per role:
  extractor/ discover/ careers/ alerts/ scout/ pen/ shipper/ replies/
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
- Timeouts (`QUEUES` in `packages/queue`): Extractor 2 min, Search 5 min, Rescore 10 min, Pen 3 min, finding the form 4 min, Shipper 10 min, Replies 5 min. At the limit the runner aborts the handler's AbortSignal → run failed, card returns to previous status with error.
- Crash recovery: at startup and with every heartbeat the worker fails runs left `running` past their limit (`failStaleRuns`). Otherwise the one-active-run rule would block the card (or Search, or Check replies) for good.
- Worker offline: a stopped worker can't time anything out, and nothing claims a queued run. So whenever the board loads, the web app fails every queued or running run older than 150 s if the worker hasn't sent a heartbeat for 150 s (`failRunsWithoutWorker`), with an error that says to start it.
- Stop: Search and Check replies can be stopped from the board (`stopRun`). The run is closed as failed with "Stopped by you."; the worker hears the `run` notification and aborts that handler's signal. A card's run is stopped by Dismiss instead.

## File storage

Local disk under `data/` (`data/documents/<applicationId>/<kind>-v<n>.pdf`, `data/evidence/...`). Paths + hashes in DB. Swap for S3-compatible storage later if needed.
