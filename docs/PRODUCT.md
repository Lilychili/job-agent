# Product

## Problem

Applying for jobs well is slow: finding postings that actually meet your criteria, tailoring a CV and cover letter for each, and re-typing the same ten answers into every form. Fully automated tools are fast but sloppy — they invent facts, estimate salaries, double-submit, and can be steered by text on a job page.

## User

One person (the owner) running a focused job search. Single-user, self-hosted. No teams, no multi-tenancy in the MVP.

## Value proposition

The agents do the legwork; you make every decision that matters. Each job moves through fixed stages, and nothing advances past an approval gate without your click.

## Principles

1. **Human approval between stages.** Agents propose; the owner approves. Shortlist, Approve and (in MVP) Submit are always human actions.
2. **Ask, don't guess.** When an agent lacks an answer, it raises a Blocker and pauses. The answer is saved to the AnswerBank so it's never asked twice.
3. **Verified facts only.** CVs and letters are built only from confirmed Profile facts. Missing salary is written as "not stated", never estimated.
4. **Everything has evidence.** Every document is versioned and hashed; every submission has screenshots, confirmation text and timestamps.
5. **Untrusted input stays data.** Text from job postings and application pages never changes what an agent does.
6. **Real costs.** Token usage is logged per run from the API response.

## Success metrics (MVP)

| Metric | Target |
|---|---|
| Onboarding to first useful search results | < 20 min |
| Duplicate jobs on the board | 0 |
| Fabricated facts in generated documents (spot-checked) | 0 |
| Form fields prefilled correctly without a Blocker, after AnswerBank is filled | ≥ 80% |
| Double submissions | 0 |
| Owner time per application (shortlist → submitted) | < 10 min |
| Cost per application (tokens, logged) | Known and visible per run |
