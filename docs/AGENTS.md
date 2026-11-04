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
- **Stack fit** comes from the Profile: Claude compares the skills a posting requires with the owner's skill facts (and roles and achievements that show a skill). The Preferences stack lists are optional extra weight, often empty.
- **When the CV changes:** saving a confirmed Profile whose facts changed bumps its version and queues `scout.rescore`, which scores the open cards (Found to Approved) again in batches: score, reasons and requirement matches. Cards keep their place whatever the new score. If a search is running, the worker's heartbeat starts it later (at most every 30 minutes while cards are stale). A posting Scout rejected is judged again by the next search, since a rejection only holds for the Preferences and Profile version it was judged against.
- **Code after the run:** normalize, recompute dedupe keys, re-check hard criteria deterministically, drop anything scored under 55 (`MIN_MATCH_SCORE`; only its link is remembered in `rejected_posting`, for 30 days or until Preferences change, so it isn't scored again), insert with ON CONFLICT DO NOTHING, emit SSE.
- Hard filters (location, remote, exclusions) should be applied in code *before* the LLM sees postings, to cut tokens. The LLM's job is the fuzzy part: stack fit, seniority fit, scoring and reasons.

## Pen — craft documents
- **API:** forced tool call, or the CLI with `--json-schema`, as Settings picks. No tools.
- **Input:** confirmed Profile facts, the whole Job posting (wrapped as untrusted, up to 40,000 characters), AnswerBank "why this company" answer, and the job's requirements when known (wrapped as untrusted). The CV is the owner's own CV, tailored: it keeps every role, every achievement (one bullet each, under its employer's role), every skill, degree, certificate and language. Claude only chooses the order of bullets and skills, by the requirements, and rewords each achievement for the job without changing what it says. The letter is written freely from the facts.
- **Requirements:** Pen orders the CV by them, and they are shown on the card and in the Craft modal, with the facts that meet them and the closest real experience for gaps. If they were never read, or were matched against an older Profile version, Pen first reads them again (`readRequirements`: Scout's prompt, requirements only, no score) and saves them on the job, so a fact the owner just added counts. That read gets one repair retry; if it still fails, the draft goes on and the next craft tries again.
- **Output (JSON):** `{ cv: { summary, experience: [{ roleFactId, bullets[] }], skills[], otherFactIds[] }, coverLetter: { greeting, paragraphs[], closing } }`. Each summary, bullet, skill and paragraph is `{ text, factIds[] }`. Contact details, role titles, employers and dates come from the Profile, so Claude doesn't write them.
- **Code after the run:** reject a citation that is unknown or missing, any number its cited facts don't state (whole numbers only, so "5" isn't backed by the date "2015-05"), a level such as "senior", "principal" or "lead engineer" that no fact's title states (naming the job itself is fine), a role listed twice, other facts that don't exist or aren't education, certificates or languages, a CV that leaves out a role, achievement, skill, degree, certificate or language, a bullet that rewords no achievement or more than one, an achievement used twice or under another employer's role (achievements at no listed employer may go anywhere), and a paragraph count outside 3–4, with one repair retry. Code puts roles in date order, most recent first. The answer format lists the real fact IDs for each place (citations, roles, other facts), so Claude picks an ID rather than writing a random-looking one from memory; escape the text into the template (one column, standard headings — Summary, Work Experience, Skills, Education, Certifications, Languages — and each role's dates right after its title, so the PDF reads in order as plain text); print to PDF with Playwright, with scripts and network off; strip metadata and re-read the file to check none is left; hash; save both Documents and move the card to Drafted in one transaction, so a dismissed card gets no documents.
- **Owner edits (Craft modal):** the owner may change, add, reorder and remove pieces. Code still rejects citations of unknown facts; the modal warns, without blocking, about pieces that cite nothing or state a number their facts don't. Saved edits go through the same template, printing and hashing (`packages/agents/src/documents.ts`).

## Replies — read employers' emails
- **API:** forced tool call, or the CLI with `--json-schema`, as Settings picks. No tools. Prompt: `agents/replies/agent.md`. Started by the board's **Check replies** button (`POST /api/replies`).
- **Input:** for each Applied or Replied card, up to six emails that name its company, received since the owner applied (Gmail search `"Company" after:<applied> -from:me`, job alerts left out), wrapped as untrusted.
- **Output (JSON):** `{ emails: [{ number, kind }] }`, kind being `reply`, `rejection`, `acknowledgement` or `unrelated`.
- **Code after the run:** a missing or odd label counts as unrelated, and so does an email that never names the company. The newest `reply` or `rejection` decides: Applied → Replied on a reply, Applied or Replied → Rejected on a rejection. Receipts and noise never move a card. The move and a `email` evidence row (message id, sender, subject, date) are saved in one transaction, and a message with evidence is not read again, so a rerun or restart changes nothing.

## Shipper — prefill (v1) / submit (v2)
- **API:** no agent loop in v1. A deterministic adapter per ATS in `packages/forms` reads and fills the form with Playwright; Claude only maps custom questions the AnswerBank lookup missed (planned, structured output, no tools).
- **Operations** (`FormSession`): `open(url)`, `listFields()`, `fill(field, value)`, `upload(field, file)` (verifies hash first), `screenshot(path)`, `handOver()`. No submit in v1: the submit request is blocked until `handOver()`.
- **Input:** Job, Profile, AnswerBank, approved document IDs.
- **Finding the form** (`shipper.locate`, queued by Approve; `packages/ats/src/form.ts`): the job's own link if it is a Greenhouse, Lever or Ashby posting; else the company's board, found by name or stored board link, matched by link (`?gh_jid=` on company sites) or a title that fits one posting only; else Claude searches the web for the careers page (`agents/careers/agent.md`, web search only, links only), and code reads those pages for board links. Any board is checked through its own API to belong to the company before a form is taken from it.
- **Flow:** check evidence → open the form as a tab in the one Shipper window (a persistent profile under `DATA_DIR/browser`) → list fields → plan each field from Profile / AnswerBank / approved documents → if a required question has no usable answer, raise a Blocker for each and stop (nothing is typed) → otherwise upload the CV, fill, screenshot → AwaitingSubmit, and the window stays open for the owner to review and submit. Optional questions with no answer, and uploads other than the CV, are left for the owner.
- **Lever:** the approved letter's text goes in "Additional information" (Lever has no letter upload). Attaching the CV sends it to Lever at once, which reads it to fill fields; ours overwrite what it fills.
- Prefer per-ATS deterministic adapters in `packages/forms` for known fields (name, email, CV upload); use the LLM only for mapping custom questions. Cheaper and more reliable.

## Model choice

Make the model per role configurable. Start with a mid-tier model for Scout and Shipper, a stronger model for Pen, and measure from logged token usage before optimizing.
