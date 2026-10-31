# Job Agent

A single-user app that finds jobs, writes CVs and cover letters from verified facts, and prefills application forms, with your approval between every step. The plan lives in [docs/](docs/PLAN.md).

**Status: M0 (Foundations) done.** The board, state machine, queue, worker and live updates are real. The three agents are **stubs** that behave like the real ones at their boundaries (dedupe, versioned + hashed documents, Blockers, evidence). They will be replaced in M2 (Scout), M3 (Pen) and M4 (Shipper).

## Run it

Requires Node 22+, pnpm 10 and Docker.

```bash
cp .env.example .env
pnpm install
pnpm db:up          # Postgres 16 on 127.0.0.1:5432 (also creates jobagent_test)
pnpm db:migrate
pnpm db:seed        # demo confirmed Profile + Preferences (replaced by onboarding in M1)
pnpm dev            # web on http://127.0.0.1:3000 + worker
```

Then open http://127.0.0.1:3000 and try the whole loop:

1. **Search** → three demo jobs appear in Found. Search again: no duplicates.
2. **Shortlist → Craft** → the card spins while the Pen stub writes CV + letter v1, then moves to Crafted.
3. **Approve → Apply** → the Shipper stub hits a question it can't answer and raises a **Blocker** (red).
4. Answer it → saved to the AnswerBank, the Shipper resumes → *Ready to submit*.
5. **Mark applied** → submission evidence is recorded; the card can never be submitted again.
6. Apply on a second job: the notice-period answer is reused, so no Blocker.

## Test

```bash
pnpm test        # 257 tests: full transition matrix, normalizers, and DB tests for every guard
pnpm typecheck
```

The DB tests use `TEST_DATABASE_URL` and truncate it on every test.

## Layout

```
apps/web          Next.js board, API routes, SSE endpoint (/api/events)
apps/worker       pg-boss consumers; src/jobs/{scout,pen,shipper}.ts are M0 stubs
packages/db       Drizzle schema for every table, migrations, NOTIFY helper
packages/core     State machine: transition table, transition(), guards, runs, blockers
packages/queue    pg-boss setup shared by web and worker
agents/           Versioned prompt files per role (used from M2)
docs/             The MVP plan
```

## How it fits together

- **One way to change a card:** `transition(applicationId, action)` in `packages/core`. In one transaction it locks the row, checks the move is legal (`RULES` in `machine.ts`), runs guards, applies effects, creates the AgentRun, enqueues the pg-boss job **through the same transaction**, writes an `application_event` and `NOTIFY app_events`. If anything fails, nothing happens, including the queue write.
- **Guards enforced in code:** confirmed Profile before Craft; approved PDFs must match their stored SHA-256 before Apply; no Shipper run once `submission` evidence exists; one active run per application (partial unique index); approved documents are immutable (DB trigger).
- **Live board:** the worker and web write `pg_notify('app_events', …)`; the web keeps one `LISTEN` connection and fans it out over Server-Sent Events. Notifications sent inside a transaction arrive only on commit, so the board never shows a rolled-back change.
- **Idempotent jobs:** the AgentRun id is the pg-boss job id, and the worker only starts a run it can move from `queued` to `running`. Duplicate deliveries are skipped.
- **Blockers** are a flag, not a status. Raising one pauses the run with a checkpoint; answering the last one supersedes the paused run and queues `shipper.resume`, which refills the form from scratch using the larger AnswerBank.

## Changes from the plan

- Added `superseded` run status and `agent_run.parent_run_id`, to close a paused Shipper run when its resume run starts.
- Added `craftFailed` → back to the previous column, and `prefillFailed` → back to Approved, so timeouts and errors never strand a card in a spinner.
- `job.archived` makes Dismiss permanent: the canonical-URL index still blocks the posting from coming back.
- `settings.worker_last_seen_at` powers the "Worker running" indicator.

## Next: M1

Profile editor and CV extraction, Preferences, AnswerBank onboarding, encrypted API key, Blockers inbox.
