# Agents

Three roles plus one utility. Each has a versioned prompt file at `agents/<role>/agent.md`, a fixed tool list, and a Zod output schema. All load `agents/shared/security-rules.md`.

## Rules carried over from TeamHero memory

| Rule | Enforced where |
|---|---|
| Dedupe by canonical URL + normalized company and title | `packages/ats` normalizers + DB unique indexes (not the LLM) |
| Use Greenhouse, Lever, Ashby APIs; don't scrape JS-heavy pages | Scout's only tools are the three API clients |
| Missing salary → "not stated"; never estimate | Scout prompt + schema (salary must be a substring of the posting or exactly `"not stated"`; validated in code) |
| CVs only from verified facts; strip PDF metadata | Pen cites fact IDs; code rejects unknown IDs; `documents` strips metadata |
| Hash approved files so they can't change silently | `documents` hashes on save; Shipper re-verifies before upload |
| Check existing evidence before retrying a submission | `transition()` guard + Shipper's first step |

Rule of thumb: **if a rule can be enforced in code, enforce it in code and also state it in the prompt.**

## Extractor (onboarding utility)
- **API:** Messages API, structured output.
- **Input:** CV text (PDF/DOCX → text in code).
- **Output:** `Profile` (contact + facts with IDs).
- **Tools:** none.

## Scout — find jobs
- **API:** Agent SDK.
- **Tools:** `greenhouse.listJobs(boardToken)`, `lever.listPostings(company)`, `ashby.listJobs(org)`, `jobs.existsByKey(canonicalUrl, companyNorm, titleNorm)`.
- **Input:** Preferences, list of boards to query.
- **Output (JSON):** `{ jobs: [{ ats, sourceUrl, company, title, location, remote, salary, matchScore, matchReasons }] }`
- **Code after the run:** normalize, recompute dedupe keys, re-check hard criteria deterministically, insert with ON CONFLICT DO NOTHING, emit SSE.
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
