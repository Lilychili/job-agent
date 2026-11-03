# Agents

Four roles plus two utilities. Each has a versioned prompt file at `agents/<role>/agent.md`, a fixed tool list, and a JSON output schema that code checks. All load `agents/shared/security-rules.md`.

## Rules carried over from TeamHero memory

| Rule | Enforced where |
|---|---|
| Dedupe by canonical URL + normalized company and title | `packages/ats` normalizers + DB unique indexes (not the LLM) |
| Use Greenhouse, Lever, Ashby APIs; don't scrape JS-heavy pages | Code calls the three API clients; Scout has no tools |
| Missing salary → "not stated"; never estimate | Scout prompt + schema (salary must be a substring of the posting or exactly `"not stated"`; validated in code) |
| CVs only from verified facts; strip PDF metadata | Pen cites fact IDs; code rejects unknown IDs; `packages/agents/src/pdf.ts` strips metadata and re-reads the file |
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
- **What gets scored:** at most 40 postings a search, best-ranked first, with a share per source: 20 from company boards, 10 from Indeed alerts, 10 from LinkedIn alerts. A share a source can't fill goes to the others; the rest wait for the next search.
- **Output (JSON):** `{ scores: [{ ref, requirements: [{ text, factIds[] }], salary, remote, matchScore, met, missed }] }`. Company, title and links always come from the board.
- **Requirements:** Scout also gets the confirmed Profile facts, one line each, and lists each posting's core requirements (up to 10: skills and tools, certifications, minimum experience, main responsibilities, level, languages), one thing each in the posting's exact terms, with the facts that meet all of it. Code keeps only citations of facts that exist, and keeps no requirements for an alert summary, which has only a title to read them from. A long posting is cut at 6,000 characters, but lines further on that state pay or name one of the owner's skills are kept, so a tech stack at the end isn't lost. The card shows "Meets N of M core requirements".
- **Code after the run:** normalize, recompute dedupe keys, re-check hard criteria deterministically, drop anything scored under 55 (`MIN_MATCH_SCORE`; only its link is remembered in `rejected_posting`, for 30 days or until Preferences change, so it isn't scored again), insert with ON CONFLICT DO NOTHING, emit SSE.
- Hard filters (location, remote, exclusions) should be applied in code *before* the LLM sees postings, to cut tokens. The LLM's job is the fuzzy part: stack fit, seniority fit, scoring and reasons.

## Pen — craft documents
- **API:** forced tool call, or the CLI with `--json-schema`, as Settings picks. No tools.
- **Input:** confirmed Profile facts, the whole Job posting (wrapped as untrusted, up to 40,000 characters), AnswerBank "why this company" answer. Claude chooses which facts matter for the job and words them freely; the job's requirements are not part of the prompt.
- **Requirements, for the owner:** the requirements Search read are shown on the card and in the Craft modal, with the facts that meet them and the closest real experience for gaps. If they were never read, or were matched against an older Profile version, Pen first reads them again (`readRequirements`: Scout's prompt, requirements only, no score) and saves them on the job, so a fact the owner just added counts. That read gets one repair retry; if it still fails, the draft goes on and the next craft tries again.
- **Output (JSON):** `{ cv: { summary, experience: [{ roleFactId, bullets[] }], skills[], otherFactIds[] }, coverLetter: { greeting, paragraphs[], closing } }`. Each summary, bullet, skill and paragraph is `{ text, factIds[] }`. Contact details, role titles, employers and dates come from the Profile, so Claude doesn't write them.
- **Code after the run:** reject a citation that is unknown or missing, any number its cited facts don't state (whole numbers only, so "5" isn't backed by the date "2015-05"), a level such as "senior", "principal" or "lead engineer" that no fact's title states (naming the job itself is fine), a role listed twice, other facts that don't exist or aren't education, certificates or languages, and a bullet or paragraph count outside 1–5 per role (the prompt asks for 2–5, but a role with one achievement can only have one true bullet) or 3–4, with one repair retry. The answer format lists the real fact IDs for each place (citations, roles, other facts), so Claude picks an ID rather than writing a random-looking one from memory; escape the text into the template (one column, standard headings — Summary, Work Experience, Skills, Education, Certifications, Languages — and each role's dates right after its title, so the PDF reads in order as plain text); print to PDF with Playwright, with scripts and network off; strip metadata and re-read the file to check none is left; hash; save both Documents and move the card to Drafted in one transaction, so a dismissed card gets no documents.
- **Owner edits (Craft modal):** the owner may change, add, reorder and remove pieces. Code still rejects citations of unknown facts; the modal warns, without blocking, about pieces that cite nothing or state a number their facts don't. Saved edits go through the same template, printing and hashing (`packages/agents/src/documents.ts`).

## Shipper — prefill (v1) / submit (v2)
- **API:** Agent SDK with Playwright tools.
- **Tools:** `form.open(url)`, `form.listFields()`, `form.fill(fieldId, value)`, `form.upload(fieldId, documentId)` (verifies hash first), `answers.lookup(question)`, `blocker.raise(question, fieldContext)`, `evidence.screenshot(label)`. No `form.submit` in v1.
- **Input:** Job, Profile, AnswerBank, approved document IDs.
- **Flow:** check evidence → open → list fields → map each field to Profile/AnswerBank → fill → for unknowns, `blocker.raise` and stop → screenshot → done (AwaitingSubmit).
- Prefer per-ATS deterministic adapters in `packages/forms` for known fields (name, email, CV upload); use the LLM only for mapping custom questions. Cheaper and more reliable.

## Model choice

Make the model per role configurable. Start with a mid-tier model for Scout and Shipper, a stronger model for Pen, and measure from logged token usage before optimizing.
