# State Machine

The kanban board *is* the state machine. `Application.status` is the column. Every button is a single transition that queues at most one job.

## Statuses

```
Found → Shortlisted → Crafting → Crafted → Approved → Applying → AwaitingSubmit → Applied → { Replied | Interview | Rejected }
                                                                                          ↘ Withdrawn
Found, Shortlisted → Archived (Dismiss)        Crafted → Shortlisted, Approved → Crafted (Dismiss: one step back)
```

`Crafting`, `Applying` are transient "agent working" states (shown as a spinner on the card, same column as their predecessor on the board). `AwaitingSubmit` is shown in the Approved column with a "Ready to submit" badge in Apply v1. `Drafted` is no longer reached: Craft lands in Crafted, and drafts saved before that change were moved to Crafted (migration 0017).

What each column offers:

| Column | Buttons | |
|---|---|---|
| Found | Shortlist, Dismiss | Dismiss removes the card from the board |
| Shortlisted | Dismiss, Craft | Craft opens the Craft modal at once; it shows Claude's progress, then the draft, and the card moves to Crafted |
| Crafted | Review draft, Dismiss, Approve | Review draft reopens the modal to edit; it has Approve too, and Ask Claude again. Dismiss goes back to Shortlisted |
| Approved | Dismiss, Apply | Dismiss goes back to Crafted and unlocks the documents. The card shows CV and Cover letter pills (PDF only): the files the Shipper uploads |

In the modal, Save changes keeps edits as a new document version without changing the status, and Approve saves any edits, locks the documents and moves Crafted → Approved.

Blocked is **not** a status — it is a flag (`open Blocker exists`) layered on whatever status the card is in, shown as a red badge.

## Transitions

| From | Action | Actor | To | Queues job |
|---|---|---|---|---|
| — | Search | Owner | Found (new cards) | `scout.search` |
| Found | Shortlist | Owner | Shortlisted | — |
| Found, Shortlisted, and the working states Crafting, Applying, AwaitingSubmit | Dismiss (`dismiss`) | Owner | Archived (closes any active run) | — |
| Crafted | Dismiss (`unCraft`) | Owner | Shortlisted | — |
| Approved | Dismiss (`unApprove`) | Owner | Crafted (clears the approved document IDs; stops a form search) | — |
| Shortlisted | Craft | Owner | Crafting | `pen.craft` |
| Crafting | run succeeds | System | Crafted | — |
| Crafting | run fails | System | the status before Crafting (+ error) | — |
| Crafted | Ask Claude again (in the modal) | Owner | Crafting | `pen.craft` (new version) |
| Crafted | Approve (card or modal) | Owner | Approved | `shipper.locate` (locks doc versions + hashes; finds the application form) |
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

`shipper.locate` never changes the status. It stores the form it found on the job, and the card shows it ("Form: Lever · title", or "No Greenhouse, Lever or Ashby form found"). Apply and Dismiss supersede a search that hasn't finished, so it never blocks a click; prefill then looks for the form itself.

A prefilled form stays open as a tab in the Shipper's one browser window. An AwaitingSubmit card has Review (what was filled, from where, what's left, and the screenshot) and, while the tab is open, Show form, which brings that tab to the front.

## Blockers

1. Agent hits a question it can't answer → creates `Blocker{question, fieldContext, suggestedOptions?}` and saves a resumable checkpoint on the AgentRun, then pauses.
2. Board shows a red badge; a Blockers inbox lists all open ones.
3. Owner answers → answer stored on Blocker and (optionally) in AnswerBank with a normalized question key.
4. `shipper.resume` re-enters from the checkpoint. For browser forms, "resume" means re-open and re-fill from scratch using the now-larger AnswerBank — simpler and more robust than keeping a browser alive for hours.
