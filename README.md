# Job Agent

A single-user app that finds jobs, writes CVs and cover letters from verified facts, and prefills application forms, with your approval between every step. The plan lives in [docs/](docs/PLAN.md).

**Status: M0 (Foundations) done; M1 (Onboarding) built, needs a real-CV check.** The board, state machine, queue, worker and live updates are real, and so is onboarding: encrypted API key, Profile editor with CV extraction, Preferences, AnswerBank and the Blockers inbox. The Scout, Pen and Shipper are still **stubs** that behave like the real ones at their boundaries (dedupe, versioned + hashed documents, Blockers, evidence). They will be replaced in M2 (Scout), M3 (Pen) and M4 (Shipper).

Agents reach Claude through your signed-in Claude Code CLI (your subscription) or an Anthropic API key (pay per use); choose in Settings.

## Run it

Requires Node 22+, pnpm 10 and Docker.

```bash
cp .env.example .env
pnpm install
pnpm db:up          # Postgres 16 on 127.0.0.1:5432 (also creates jobagent_test)
pnpm db:migrate
pnpm dev            # web on http://127.0.0.1:3000 + worker
```

If you'll use an API key rather than Claude Code, put a 32-byte key in `.env` as `APP_ENCRYPTION_KEY` first; restart `pnpm dev` after changing `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Open http://127.0.0.1:3000/setup and follow the four steps: connect Claude → Profile (upload a PDF/DOCX CV or type it in, then confirm) → What I'm looking for → Questions. Nothing runs against your Profile until you confirm it.

To click through the board without onboarding, `pnpm db:seed` adds a confirmed demo Profile and Preferences. Skip it for real use.

Then open the board and try the whole loop:

1. **Search** → three demo jobs appear in Found. Search again: no duplicates.
2. **Shortlist → Craft** → the card spins while the Pen stub writes CV + letter v1, then moves to Crafted.
3. **Approve → Apply** → the Shipper stub hits a question it can't answer and raises a **Blocker** (red).
4. Answer it → saved to the AnswerBank, the Shipper resumes → *Ready to submit*.
5. **Mark applied** → submission evidence is recorded; the card can never be submitted again.
6. Apply on a second job: the notice-period answer is reused, so no Blocker.

## Test

```bash
pnpm test        # transition matrix, normalizers, secrets, validation, CV reading, and DB tests for every guard
pnpm typecheck
pnpm lint
```

The DB tests use `TEST_DATABASE_URL` and truncate it on every test.

## Layout

```
apps/web          Next.js board, API routes, SSE endpoint (/api/events)
apps/worker       pg-boss consumers; src/jobs/{scout,pen,shipper}.ts are M0 stubs
packages/db       Drizzle schema for every table, migrations, NOTIFY helper
packages/core     State machine: transition table, transition(), guards, runs, blockers
packages/queue    pg-boss setup shared by web and worker
packages/agents   Claude client, prompt loading, CV text extraction + Extractor
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

## M1 notes

- An AnswerBank row with an empty answer means "not answered yet": it is seeded for the ~12 common questions, ignored by lookups, and filled in when you answer it (or a Blocker for it).
- CV extraction runs as a worker job (`extractor.extract`). It never writes the Profile: the result is a draft you load into the editor, edit, and confirm.
- The app has no login. `apps/web/proxy.ts` refuses requests that don't come from this machine, so open it at 127.0.0.1 or localhost, not through a tunnel or a LAN address.
- If the worker dies mid-run, the run is failed and the card rolled back when it next starts.
- Settings has "Export all data" and "Delete all data".
- **Add job** on the board puts a job you found yourself in Found. It needs a link, is deduped like Scout's finds, and a dismissed job can't be added back.

## Next: M2

ATS clients (Greenhouse, Lever, Ashby), the deterministic filter, and the real Scout.
