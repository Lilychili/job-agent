# Security

## 1. Untrusted input (prompt injection)

Job postings and application pages are attacker-controllable text.

- Wrap all CV/page/posting text with `wrapUntrusted()` (`packages/agents`), which also breaks up anything in the text that looks like our tags, so it can't close its own block. `security-rules.md` states that content inside is data only.
- Tools are allowlisted per role. Discover can only search the web, and its results can't be wrapped, so code trusts nothing from it but company names, which it filters and wraps on the way back in, and links, which only ever lead to a board lookup. Scout cannot touch forms; Pen has no tools; Shipper cannot navigate to domains other than the job's ATS host (`FormSession` aborts any other top-level navigation while it drives).
- Shipper may only fill values that come from Profile, AnswerBank or approved Documents — never values suggested by the page. The page supplies only labels and options; `planFill` takes each value from one of those sources and records which, and a choice answer must match one of the field's options or it becomes a Blocker.
- Never send Profile data to a URL that came from page content. Careers pages Claude finds are only read for links (https, public hosts, nothing typed); a board found there is checked through its own API to belong to the company, and the form link always comes from that API, never from the page.
- Reuse and adapt TeamHero's `security-rules.md` into `agents/shared/security-rules.md`.

## 2. Secrets

- Claude API key (optional): entered once in Settings, encrypted with AES-256-GCM using a key from env (`APP_ENCRYPTION_KEY`), decrypted only at call time, in the worker for agent runs and in the web server for "Test connection".
- Never returned to the browser; UI shows `…last4`. Never logged (redact in logger).
- No login: the app binds to 127.0.0.1, and `apps/web/proxy.ts` rejects anything else that could reach it through the owner's browser: a foreign `Host` (DNS rebinding) and cross-site writes (`Origin` / `Sec-Fetch-Site`). Pages also refuse to be framed, so another site can't trick the owner into a click.
- Gmail: a read-only refresh token, encrypted like the API key and removed by Disconnect or Delete all. Code opens only messages from indeed.com and LinkedIn's job alert addresses, and stores no email. LinkedIn links lose their query before they are kept, because it can carry a sign-in token. Claude reads each one as untrusted text with no tools.
- Claude Code provider: agents run the owner's signed-in `claude -p` with no tools (Discover alone gets `WebSearch`, with a turn cap), no MCP servers, no session, none of their settings or hooks, in a fresh empty directory, with API-key variables removed from its environment so it can't bill the API. Prompts go over stdin, never the command line; the model name is validated so it can't pose as a flag.

## 3. Documents

- Strip PDF metadata (Author, Creator, Producer, CreationDate, ModDate, XMP) after render; verify by re-reading.
- SHA-256 on save. Approved Documents are immutable. Shipper verifies the hash immediately before upload and aborts on mismatch.

## 4. Submission safety

- v1: no submit tool exists. `FormSession` also blocks the ATS's submit request while it drives, and lifts the block only when it hands the window to the owner, who submits.
- Before any Shipper run: if `Evidence(type=submission)` exists for the application, refuse.
- v2 (post-MVP): submit only when zero Blockers, hashes verified, no CAPTCHA detected; capture evidence immediately; idempotency key per application.

## 5. Personal data

All data is local: Postgres and `DATA_DIR` hold the CV (`data/cv`), Profile, answers incl. visa/salary, jobs, documents, evidence and run logs. Settings has "Export all data" (JSON, never the API key) and "Delete all data" (rows, the key and all files).
