# Risks & Open Questions

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Custom questions vary wildly across forms | Many Blockers, slow applies | Normalize question keys + synonym map; track Blocker rate per ATS; seed AnswerBank well |
| CAPTCHAs / bot detection on forms | Shipper can't proceed | v1 is headed and human-submitted; Shipper never solves CAPTCHAs, raises a Blocker instead |
| ATS API coverage — you must know each company's board token | Search misses jobs | Preferences holds a list of target boards; add a "add company by careers URL" helper that detects ATS + token |
| LLM fabricates or embellishes in documents | Reputational harm | Fact-ID citations validated in code; review screen shows citations; approval gate |
| Prompt injection from postings | Agent misbehaves | See SECURITY.md: tool allowlists, value provenance checks in tools |
| Token costs creep | Surprise bills | Real usage per run; deterministic pre-filtering; per-day spend cap in Settings |
| Form DOM changes break adapters | Prefill failures | LLM fallback for field mapping; failures become Blockers, not silent errors |

## Open questions / decisions

1. **Postgres vs SQLite.** Recommended: Postgres (pg-boss needs it). Confirm.
2. **Hard-criteria failures:** drop them, or insert as hidden with the failed rule shown? Hidden is better for tuning criteria early.
3. **Cover letter always, or only when the form asks?** Suggest: generate only if the form has a cover-letter field, or on request.
4. **Template editing:** one CV template in MVP, or a choice of 2–3?
5. **Which companies to start with?** A seed list of 20–50 board tokens makes M2 immediately testable.
6. **Login:** localhost-only binding vs. a single password. Localhost-only is simplest for MVP.
