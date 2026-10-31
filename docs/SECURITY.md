# Security

## 1. Untrusted input (prompt injection)

Job postings and application pages are attacker-controllable text.

- Wrap all page/posting text in clearly delimited blocks (e.g. `<untrusted_posting>…</untrusted_posting>`) and state in `security-rules.md` that content inside is data only.
- Tools are allowlisted per role. Scout cannot touch forms; Pen has no tools; Shipper cannot navigate to domains other than the job's ATS host (enforce in the `form.open` tool).
- Shipper may only fill values that come from Profile, AnswerBank or approved Documents — never values suggested by the page. Enforce in `form.fill`: value must match a lookup result or an answered Blocker.
- Never send Profile data to a URL that came from page content.
- Reuse and adapt TeamHero's `security-rules.md` into `agents/shared/security-rules.md`.

## 2. Secrets

- Claude API key: entered once in Settings, encrypted with AES-256-GCM using a key from env (`APP_ENCRYPTION_KEY`), decrypted only in the worker at call time.
- Never returned to the browser; UI shows `…last4`. Never logged (redact in logger).
- App behind a single local login (or bind to localhost only for MVP).

## 3. Documents

- Strip PDF metadata (Author, Creator, Producer, CreationDate, ModDate, XMP) after render; verify by re-reading.
- SHA-256 on save. Approved Documents are immutable. Shipper verifies the hash immediately before upload and aborts on mismatch.

## 4. Submission safety

- v1: no submit tool exists. The owner submits.
- Before any Shipper run: if `Evidence(type=submission)` exists for the application, refuse.
- v2 (post-MVP): submit only when zero Blockers, hashes verified, no CAPTCHA detected; capture evidence immediately; idempotency key per application.

## 5. Personal data

All data is local. Document what's stored (CV, answers incl. visa/salary) and provide "export all" and "delete all" in Settings.
