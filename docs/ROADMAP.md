# Roadmap

Each milestone ends with something usable. Estimates assume one developer, part-time-ish; adjust.

## M0 — Foundations (≈3 days)
- Monorepo (`apps/web`, `apps/worker`, `packages/*`), Postgres in Docker, Drizzle migrations for all tables.
- pg-boss wired up; worker heartbeat job; SSE endpoint fed by LISTEN/NOTIFY.
- `transition()` + transition table + ApplicationEvent, with unit tests for every legal and illegal move.
- **Exit:** a fake job enqueued from the web moves a dummy card across the board live.

## M1 — Profile, onboarding, empty board — no AI (≈1 week)
- Profile editor (manual entry first), Preferences, AnswerBank (seeded with the ~10 common questions), Settings with encrypted API key + "Test key".
- Board UI with all columns, card component, dismiss/archive, Blockers inbox (empty).
- Then add the Extractor: CV upload → structured Profile → edit → confirm.
- **Exit:** onboarding complete in < 20 min; key never visible in network tab.

## M2 — Search (≈1 week)
- `packages/ats`: Greenhouse, Lever, Ashby clients + normalizers + canonical URL function (unit-tested).
- Deterministic hard-criteria filter.
- Scout run with structured output; salary validation; insert with dedupe; AgentRun with real token usage.
- **Exit:** Search twice → zero duplicates; every card has score + reasons; salary is literal or "not stated". *Useful on its own.*

## M3 — Craft + review (≈1–1.5 weeks)
- HTML templates (CV, cover letter), Pen run with fact citations, citation validator.
- Playwright render → metadata strip → hash → Document versions.
- Review screen: side-by-side PDF + cited facts per paragraph, regenerate, edit source, Approve (locks versions).
- **Exit:** 5 jobs crafted and approved; spot check finds no unsupported claims; `exiftool` shows no metadata.

## M4 — Apply v1: prefill + human submit (≈1.5 weeks)
- `packages/forms` adapters for Greenhouse, Lever, Ashby standard fields.
- Shipper with tools; hash check before upload; Blocker raise/answer/resume loop; AnswerBank learning.
- Headed browser; stop before submit; pre-submit screenshot; "Mark applied" captures evidence.
- Evidence check guard.
- **Exit = MVP done:** 10 real applications end-to-end, no duplicates, no double submits, cost per application visible.

---

## Post-MVP

### M5 — Apply v2: auto-submit
- Submit tool gated by: zero open Blockers, hashes verified, no CAPTCHA detected, explicit per-application "allow auto-submit" toggle.
- Confirmation capture (page text + screenshot) immediately after submit; idempotency key.

#### Where shipping stands before M5
Prefill v1 is built for Lever: `shipper.locate` finds the form on Approve, and `shipper.prefill` opens it in a headed window (`FormSession` holds the host lock, blocks the submit request and re-hashes each upload), fills it from Profile, AnswerBank and the approved documents, raises Blockers for required questions it can't answer, and hands the window to the owner. Greenhouse and Ashby forms are found but not yet filled. "Mark applied" is still the owner's word: it writes a `submission` evidence row, and `shipper.captureEvidence` keeps a screenshot and the page text of whatever the window shows, not a matched confirmation. M5 adds the rest below.

#### Missing features and the plan
| Gap | Plan |
|---|---|
| Real browser Shipper | Built for Lever (M4). Still to do: Greenhouse and Ashby adapters in `packages/forms`. |
| Recheck employer, role and destination | Before filling, load the form and compare employer, job title and ATS host with the row's `job`. Stop with a Blocker on any mismatch. Block navigation off the job's ATS host in the browser context, not just in the prompt. |
| Fill only from verified facts | Every `form.fill` value carries a source (`profile`, `answerBank` or `blocker`) that code checks. Reject a value with no source or one the page suggested. Log the source of each field on the run. |
| Unknown required answer | Keep the Blocker loop: pause, ask, save the answer to the AnswerBank, resume. A required field with no confident answer never gets a guess. |
| Authentication gates | Detect a login wall or CAPTCHA, pause with a Blocker, and let the owner sign in in the headed browser. Never store or type the owner's passwords, and never solve a CAPTCHA. |
| Submit tool | Add `form.submit`, only when all of these hold: zero open Blockers, `approvedDocsIntact` passes, no CAPTCHA, destination rechecked, and the per-application "allow auto-submit" toggle is on. |
| Idempotency | Add an `idempotency_key` to the application. Write a `submitting` evidence row with the key in a transaction before the click. After a crash or restart, check the form's confirmation state and the evidence rows first, and never click submit again while a `submitting` row exists without a result. |
| Mark submitted only after confirmation | Auto-submit moves a card to Applied only after the confirmation page or email is read and matched to the row. A submit with no confirmation moves to a new `needs_check` state for the owner to resolve. For the manual button, ask the owner to paste or attach the confirmation. |
| Evidence | Add `channel` (ATS name, direct site, email), `submittedAt` and `confirmation` to `evidence`. (A screenshot and the page text are already kept.) Link the evidence to the document IDs and hashes that were sent. |
| Duplicate evidence | Keep the guards. Also match across applications on canonical URL and company plus title, so a re-added or archived job can't be submitted twice. |

**Exit:** 10 auto-submitted applications with a saved screenshot and confirmation each, no duplicate and no double submit after a forced worker restart mid-submit.

### M6 — Reply tracking
Started: the board's **Check replies** button runs `replies.check` (see Replies in [AGENTS.md](AGENTS.md)). It moves cards by itself, as the owner asked, instead of proposing a move; matching is by company name only, not yet by domain or subject. It has a 5-minute limit and a Stop button, and fails at once with a clear error when the worker is offline. Still to do: run it on a schedule, and match by sender domain.

- Inbox connection (Gmail API or IMAP), match messages to applications by company/domain/subject, propose a status move (Replied / Interview / Rejected) for the owner to confirm.

### Sources
- Search without a company list: Claude finds companies by web search, code verifies their Greenhouse/Lever/Ashby boards, then aggregators and Gmail job alerts. See [SOURCES.md](SOURCES.md). The Gmail connection is shared with M6.

### Later
- More ATS sources, weekly digest, interview prep notes from the posting, analytics (response rate by template version).
