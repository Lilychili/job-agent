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

### M6 — Reply tracking
- Inbox connection (Gmail API or IMAP), match messages to applications by company/domain/subject, propose a status move (Replied / Interview / Rejected) for the owner to confirm.

### Later
- More ATS sources, weekly digest, interview prep notes from the posting, analytics (response rate by template version).
