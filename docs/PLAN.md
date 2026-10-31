# Job Agent — MVP Plan

A single-user web app that finds relevant jobs, writes tailored CVs and cover letters from verified facts only, and prefills application forms, with a human approval gate between every step.

It is a rebuild of the useful ideas in TeamHero (strict state machine, role prompts, learned rules, blockers, versioned deliverables) without its plumbing (terminal-driven Claude, Markdown-as-database, one 230 KB `server.js`).

## Documents

| File | What it covers |
|---|---|
| [PRODUCT.md](PRODUCT.md) | Problem, user, principles, success metrics |
| [MVP_SCOPE.md](MVP_SCOPE.md) | What's in, what's out, user stories with acceptance criteria |
| [STATE_MACHINE.md](STATE_MACHINE.md) | Kanban columns, transitions, approval gates, blockers |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Stack, modules, worker/queue, SSE, Claude integration |
| [DATA_MODEL.md](DATA_MODEL.md) | Tables, fields, constraints, dedupe key |
| [AGENTS.md](AGENTS.md) | Scout, Pen, Shipper: tools, I/O contracts, carried-over rules |
| [SECURITY.md](SECURITY.md) | Prompt injection, secrets, PDF hygiene, idempotent submission |
| [ROADMAP.md](ROADMAP.md) | Milestones M0–M4 (MVP) and post-MVP M5–M6, with exit criteria |
| [RISKS.md](RISKS.md) | Risks, open questions, decisions to make |

Agent prompt files live in the repo at `agents/<role>/agent.md` — starters are in [agents/](agents/).

## MVP in one sentence

**Onboard → Search → Shortlist → Craft → Approve → Prefill & human submit**, all on one live kanban board, with every unanswerable question surfaced as a Blocker instead of a guess.
