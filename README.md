# Job Agent

A single-user app that finds jobs, writes CVs and cover letters from verified facts, and prefills application forms, with your approval between every step. The plan lives in [docs/](docs/PLAN.md).

**Status: M0–M3 built; M4 (Apply v1) built for Lever forms; M6 (reply tracking) started.** The board, state machine, queue, worker and live updates are real, and so is onboarding: encrypted API key, Profile editor with CV extraction, Preferences, AnswerBank and the Blockers inbox. Search: Claude searches the web for companies that fit your Preferences, code looks for their Greenhouse, Lever or Ashby boards, Gmail job alerts from Indeed and LinkedIn add more, and Scout scores the open jobs. Pen writes the CV and cover letter from cited Profile facts, and you edit them beside the PDF before approving. Shipper finds the application form when you approve, then prefills it in a visible browser window and hands it to you to submit; only Lever forms have a fill adapter so far. **Check replies** reads Gmail for employers' answers and moves Applied cards to Replied or Rejected. Still open: the M3 and M4 exit checks with real jobs, and Greenhouse and Ashby fill adapters.

Agents reach Claude through your signed-in Claude Code CLI (your subscription) or an Anthropic API key (pay per use); choose in Settings.

## Run it

Requires Node 22+, pnpm 10 and Docker.

```bash
cp .env.example .env
pnpm install
pnpm --filter @jobagent/agents exec playwright install chromium   # prints the CV and cover letter PDFs
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
2. **Shortlist → Craft** → the Craft modal opens while Claude writes the CV and cover letter. Edit them beside the PDF preview, then click **Craft**: the card moves to Crafted with a **PDF** pill that reopens them for editing or download.
3. **Approve** → the Shipper looks for the job's application form; the card shows what it found.
4. **Apply** → the form opens in the Shipper's browser window and is filled from your Profile, AnswerBank and approved CV. A required question it can't answer raises a **Blocker** (red) instead of a guess.
5. Answer it → saved to the AnswerBank, the Shipper fills the form again from scratch → *Ready to submit*. Review what was filled, then submit it yourself in that window.
6. **Mark applied** → a screenshot and the text of the confirmation page are kept as evidence; the card can never be applied to again.
7. **Check replies** (needs Gmail connected in Settings) → employers' answers move Applied cards to Replied or Rejected.

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
apps/worker       pg-boss consumers: extractor, scout (search, rescore), pen, shipper (locate, prefill, resume, evidence), replies
packages/db       Drizzle schema for every table, migrations, NOTIFY helper
packages/core     State machine (transition table, transition(), guards), runs, blockers, AnswerBank, Gmail, secrets
packages/queue    pg-boss setup and per-queue time limits, shared by web and worker
packages/ats      Greenhouse, Lever and Ashby clients and form finding (plain HTTP, no LLM)
packages/agents   Claude client (API key or Claude Code CLI), prompts, every role's structured output, PDF rendering
packages/forms    Playwright form filling: FormSession safety rules, per-ATS adapters (Lever so far)
agents/           Versioned prompt files per role, plus shared security rules
docs/             The plan and the design notes
```

## How it fits together

- **One way to change a card:** `transition(applicationId, action)` in `packages/core`. In one transaction it locks the row, checks the move is legal (`RULES` in `machine.ts`), runs guards, applies effects, creates the AgentRun, enqueues the pg-boss job **through the same transaction**, writes an `application_event` and `NOTIFY app_events`. If anything fails, nothing happens, including the queue write.
- **Guards enforced in code:** confirmed Profile before Craft; approved PDFs must match their stored SHA-256 before Apply; no Shipper run once `submission` evidence exists; one active run per application (partial unique index); approved documents are immutable (DB trigger).
- **Live board:** the worker and web write `pg_notify('app_events', …)`; the web keeps one `LISTEN` connection and fans it out over Server-Sent Events. Notifications sent inside a transaction arrive only on commit, so the board never shows a rolled-back change.
- **Idempotent jobs:** the AgentRun id is the pg-boss job id, and the worker only starts a run it can move from `queued` to `running`. Duplicate deliveries are skipped.
- **No endless spinners:** every queue has a time limit (`QUEUES` in `packages/queue`) that the runner enforces with an AbortSignal, and the heartbeat fails runs past it. When the worker itself is offline, the web app fails queued or running runs older than 150 s the next time the board loads (`failRunsWithoutWorker`), saying the worker isn't running. Search and Check replies have a **Stop** button (`POST /api/runs/:id/stop`); the worker hears the notification and aborts the handler.
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

## Next

- M3 exit check: craft and approve 5 real jobs, spot-check for unsupported claims, and check the PDFs with `exiftool`.
- M4: fill adapters for Greenhouse and Ashby (`packages/forms`), and the exit check of 10 real applications end to end.
- Replies: run on a schedule, and match by sender domain as well as company name.
