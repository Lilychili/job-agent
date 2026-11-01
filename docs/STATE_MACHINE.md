# State Machine

The kanban board *is* the state machine. `Application.status` is the column. Every button is a single transition that queues at most one job.

## Statuses

```
Found → Shortlisted → Crafting → Crafted → Approved → Applying → AwaitingSubmit → Applied → { Replied | Interview | Rejected }
                                                                                         ↘ Withdrawn
Any → Archived (dismiss)
```

`Crafting`, `Applying` are transient "agent working" states (shown as a spinner on the card, same column as their predecessor on the board). `AwaitingSubmit` is shown in the Approved column with a "Ready to submit" badge in Apply v1.

Blocked is **not** a status — it is a flag (`open Blocker exists`) layered on whatever status the card is in, shown as a red badge.

## Transitions

| From | Action | Actor | To | Queues job |
|---|---|---|---|---|
| — | Search | Owner | Found (new cards) | `scout.search` |
| Found | Shortlist | Owner | Shortlisted | — |
| Found / any pre-Applied, including Crafting and Applying | Dismiss | Owner | Archived (closes any active run) | — |
| Shortlisted | Craft | Owner | Crafting | `pen.craft` |
| Crafting | run succeeds | System | Crafted | — |
| Crafting | run fails | System | Shortlisted (+ error) | — |
| Crafted, Approved | Regenerate | Owner | Crafting | `pen.craft` (new version) |
| Crafted | Approve | Owner | Approved | — (locks doc versions + hashes) |
| Approved | Apply | Owner | Applying | `shipper.prefill` |
| Applying | needs answer | System | Applying + Blocker | (run pauses) |
| Applying (blocked) | Answer blocker | Owner | Applying | `shipper.resume` |
| Applying | prefill done | System | AwaitingSubmit | — |
| AwaitingSubmit | Mark applied | Owner | Applied | `shipper.captureEvidence` |
| Applied | Manual move | Owner | Replied / Interview / Rejected | — |

## Guards (enforced server-side, not just in UI)

- Only the transitions above are legal. Implement as a single `transition(applicationId, action)` function with a lookup table; reject everything else.
- `Craft` requires Profile `confirmed = true`.
- `Apply` requires an approved CV + letter whose stored hashes match the files on disk.
- `Apply` / any Shipper job refuses if `Evidence` of type `submission` exists for the application.
- One active job per application at a time (unique constraint on `AgentRun(applicationId) where status in (queued, running, paused)`).
- Every transition writes an `ApplicationEvent` row (from, to, actor, timestamp) for audit.

## Blockers

1. Agent hits a question it can't answer → creates `Blocker{question, fieldContext, suggestedOptions?}` and saves a resumable checkpoint on the AgentRun, then pauses.
2. Board shows a red badge; a Blockers inbox lists all open ones.
3. Owner answers → answer stored on Blocker and (optionally) in AnswerBank with a normalized question key.
4. `shipper.resume` re-enters from the checkpoint. For browser forms, "resume" means re-open and re-fill from scratch using the now-larger AnswerBank — simpler and more robust than keeping a browser alive for hours.
