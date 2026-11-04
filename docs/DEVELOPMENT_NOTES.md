# Development notes

Implementation details that used to live in the README.

## Changes from the plan

- Added `superseded` run status and `agent_run.parent_run_id`, to close a paused Shipper run when its resume run starts.
- Added `craftFailed` → back to the previous column, and `prefillFailed` → back to Approved, so timeouts and errors never strand a card in a spinner.
- `job.archived` makes Dismiss permanent: the canonical-URL index still blocks the posting from coming back.
- `settings.worker_last_seen_at` powers the "Worker running" indicator.

## How the pieces fit

- **No endless spinners:** every queue has a time limit (`QUEUES` in `packages/queue`) that the runner enforces with an AbortSignal, and the heartbeat fails runs past it. When the worker itself is offline, the web app fails queued or running runs older than 150 s the next time the board loads (`failRunsWithoutWorker`), saying the worker isn't running. Search and Check replies have a **Stop** button (`POST /api/runs/:id/stop`); the worker hears the notification and aborts the handler.
- **Blockers** are a flag, not a status. Raising one pauses the run with a checkpoint; answering the last one supersedes the paused run and queues `shipper.resume`, which refills the form from scratch using the larger AnswerBank.

## M1 notes

- An AnswerBank row with an empty answer means "not answered yet": it is seeded for the ~12 common questions, ignored by lookups, and filled in when you answer it (or a Blocker for it).
- CV extraction runs as a worker job (`extractor.extract`). It never writes the Profile: the result is a draft you load into the editor, edit, and confirm.
- The app has no login. `apps/web/proxy.ts` refuses requests that don't come from this machine, so open it at 127.0.0.1 or localhost, not through a tunnel or a LAN address.
- If the worker dies mid-run, the run is failed and the card rolled back when it next starts.
- Settings has "Export all data" and "Delete all data".
- **Add job** on the board puts a job you found yourself in Found. It needs a link, is deduped like Scout's finds, and a dismissed job can't be added back.

## Open exit checks

- M3: craft and approve 5 real jobs, spot-check for unsupported claims, and check the PDFs with `exiftool`.
- M4: fill adapters for Greenhouse and Ashby (`packages/forms`), and the exit check of 10 real applications end to end.
- Replies: run on a schedule, and match by sender domain as well as company name.
