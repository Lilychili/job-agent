# MVP Scope

The MVP is build steps 1–4: onboarding, Search, Craft, and Apply v1 (prefill + human submit).

## In

- **Onboarding**: CV upload → Claude extracts a structured Profile → owner edits and confirms. Preferences (hard criteria). AnswerBank. Claude API key (encrypted server-side).
- **Kanban board** with fixed columns and live updates (SSE).
- **Search (Scout)**: queries Greenhouse, Lever and Ashby job-board APIs, scores matches against Preferences, returns structured JSON, dedupes before insert.
- **Shortlist**: owner's approval gate.
- **Craft (Pen)**: CV + cover letter from an HTML template using Profile facts only; Playwright renders PDF; metadata stripped; versioned + hashed.
- **Review & Approve** screen for documents, with regenerate.
- **Apply v1 (Shipper)**: opens the form in a visible Playwright browser, fills from Profile + AnswerBank, uploads the approved PDFs, stops before submit. Owner reviews and clicks submit. Unknown questions → Blocker.
- **Manual status moves** for Applied → Replied / Interview / Rejected.
- **AgentRun log**: input, output, logs, real token usage, errors, per run.

## Out (post-MVP)

- Auto-submit (Apply v2) — M5
- Inbox reply tracking — M6
- Scraping arbitrary career sites beyond the three ATS APIs
- LinkedIn / Workday / custom-ATS forms (Shipper may still try; anything unsupported becomes a Blocker)
- Multi-user, auth beyond a single local login, billing
- Mobile layout polish

## User stories

### Onboarding
- **As the owner, I upload my CV and get a structured Profile I can edit.**
  - Accepts PDF and DOCX. Extraction returns roles, dates, skills, education, links, contact.
  - Every extracted field is editable; nothing is used by agents until the Profile is marked *confirmed*.
- **I set hard criteria.** Locations, remote policy, salary floor, stack, exclusions (companies, keywords, seniority).
- **I fill the AnswerBank once.** Seeded with the common ~10 questions (why this company template, years of experience, visa/work authorization, notice period/start date, salary expectation, relocation, consent choices, pronouns optional, how did you hear, links).
- **I add my Claude API key.** Stored encrypted; never returned to the browser (UI shows only `sk-…last4`). A "Test key" button makes one cheap call.

### Search
- **I click Search and new cards appear in Found.**
  - Each card shows company, title, location, salary (or "not stated"), match score, top match reasons.
  - Rerunning Search produces no duplicates (dedupe key in DATA_MODEL.md).
  - Jobs failing a hard criterion are not inserted, or inserted as hidden with the failed rule shown (decide in RISKS.md).

### Shortlist
- **I click Shortlist on a Found card** → it moves to Shortlisted. Dismiss archives it and it never reappears.

### Craft
- **I click Craft** → a Pen run produces a CV and cover letter PDF.
  - Every claim traces to a Profile fact (Pen returns a fact-ID list per section; the review screen shows it).
  - PDF metadata (author, creator, producer, dates) stripped; SHA-256 hash stored.
  - Card moves to Crafted. I can view, edit the source, regenerate (new version), or Approve.
- **I click Approve** → the exact versions + hashes are locked; card moves to Approved.

### Apply v1
- **I click Apply** → Shipper opens the form in a visible browser and fills it.
  - Before uploading, it verifies the PDF hash matches the approved hash; mismatch aborts.
  - Any question not answerable from Profile/AnswerBank → Blocker, red badge on card, run pauses.
  - I answer the Blocker in the UI; the answer is saved to AnswerBank (with a "reuse for future jobs" toggle); the run resumes.
  - Shipper stops before submit and captures a pre-submit screenshot. I submit myself, then click "Mark applied", which records evidence (screenshot, confirmation text if visible, timestamp).
- **Before any retry**, Shipper checks for existing submission evidence and refuses if found.

## Definition of done (MVP)

10 real applications completed end-to-end through the board, with zero duplicates, zero double submissions, zero fabricated facts, and per-run token costs visible.
