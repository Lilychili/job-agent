# Agents

Four roles plus two utilities. Each has a versioned prompt file at `agents/<role>/agent.md`, a fixed tool list, and a JSON output schema that code checks. All load `agents/shared/security-rules.md`.

## Rules carried over from TeamHero memory

| Rule | Enforced where |
|---|---|
| Dedupe by canonical URL + normalized company and title | `packages/ats` normalizers + DB unique indexes (not the LLM) |
| Use Greenhouse, Lever, Ashby APIs; don't scrape JS-heavy pages | Code calls the three API clients; Scout has no tools |
| Missing salary → "not stated"; never estimate | Scout prompt + schema (salary must be a substring of the posting or exactly `"not stated"`; validated in code) |
| CVs only from verified facts; strip PDF metadata | Pen cites fact IDs; code rejects unknown IDs; `documents` strips metadata |
| Hash approved files so they can't change silently | `documents` hashes on save; Shipper re-verifies before upload |
| Check existing evidence before retrying a submission | `transition()` guard + Shipper's first step |

Rule of thumb: **if a rule can be enforced in code, enforce it in code and also state it in the prompt.**

## Extractor (onboarding utility)
- **API:** Messages API with a forced tool call, or the owner's Claude Code CLI with `--json-schema` (Settings picks which; see `packages/agents/src/cli.ts`). The output is a draft on the run; only the owner writes the Profile.
- **Input:** CV text (PDF/DOCX → text in code).
- **Output:** `Profile` (contact + facts with IDs).
- **Tools:** none.

## Discover — find companies
- **API:** Messages API with Anthropic's web search, or the owner's Claude Code CLI with `WebSearch` (Settings picks which).
- **Tools:** web search only, capped at 8 searches (API) or 12 turns (CLI), with two minutes of the search. Prompt: `agents/discover/agent.md`.
- **Input:** Preferences, companies already found or dismissed.
- **Output (JSON):** `{ companies: [{ name, link?, reason }] }`. Claude names companies and never reports jobs.
- **Code after the run:** drop known, excluded and malformed entries; look for each company's board with `findBoard` (a link Claude saw first, then name guesses against the three APIs; either way the board must name the same company); save the result in `discovered_company`. Only boards that answered are searched, so every job still comes from an ATS API response.

## Alerts — read job alert emails (utility)
- **API:** forced tool call, or the CLI with `--json-schema`, as Settings picks.
- **Tools:** none. Prompt: `agents/alerts/agent.md`.
- **Input:** one Indeed or LinkedIn email, wrapped as untrusted, with links as numbered markers.
- **Output (JSON):** `{ jobs: [{ title, company, location?, salary?, link }] }`.
- **Code after the run:** drop any job whose title or company isn't in the email or whose link number doesn't exist. See docs/SOURCES.md.

## Scout — find jobs
- **API:** Agent SDK.
- **Tools:** none. The worker reads the boards with `packages/ats`, applies the hard filters and skips known jobs before Claude sees anything.
- **Input:** Preferences, and the boards to query: Discover's finds plus the owner's optional "always search" list.
- **Output (JSON):** `{ scores: [{ ref, salary, remote, matchScore, met, missed }] }`. Company, title and links always come from the board.
- **Code after the run:** normalize, recompute dedupe keys, re-check hard criteria deterministically, drop anything scored under 55 (`MIN_MATCH_SCORE`; only its link is remembered in `rejected_posting`, for 30 days or until Preferences change, so it isn't scored again), insert with ON CONFLICT DO NOTHING, emit SSE.
- Hard filters (location, remote, exclusions) should be applied in code *before* the LLM sees postings, to cut tokens. The LLM's job is the fuzzy part: stack fit, seniority fit, scoring and reasons.

## Pen — craft documents
- **API:** Messages API, structured output (no tools needed).
- **Input:** confirmed Profile facts, Job posting (wrapped as untrusted), AnswerBank "why this company" template, HTML template slots.
- **Output (JSON):** `{ cv: { sections: [{ slot, content, factIds[] }] }, coverLetter: { paragraphs: [{ text, factIds[] }] } }`
- **Code after the run:** reject if any factId is unknown or any paragraph has no factIds (except greeting/closing); fill template; Playwright → PDF; strip metadata; hash; save Document version.

## Shipper — prefill (v1) / submit (v2)
- **API:** Agent SDK with Playwright tools.
- **Tools:** `form.open(url)`, `form.listFields()`, `form.fill(fieldId, value)`, `form.upload(fieldId, documentId)` (verifies hash first), `answers.lookup(question)`, `blocker.raise(question, fieldContext)`, `evidence.screenshot(label)`. No `form.submit` in v1.
- **Input:** Job, Profile, AnswerBank, approved document IDs.
- **Flow:** check evidence → open → list fields → map each field to Profile/AnswerBank → fill → for unknowns, `blocker.raise` and stop → screenshot → done (AwaitingSubmit).
- Prefer per-ATS deterministic adapters in `packages/forms` for known fields (name, email, CV upload); use the LLM only for mapping custom questions. Cheaper and more reliable.

## Model choice

Make the model per role configurable. Start with a mid-tier model for Scout and Shipper, a stronger model for Pen, and measure from logged token usage before optimizing.
