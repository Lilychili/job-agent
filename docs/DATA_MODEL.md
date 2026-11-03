# Data Model

All tables have `id` (uuid), `createdAt`, `updatedAt`. Single user, so no `userId` in MVP (add later if needed). Profile, Preferences and Settings hold exactly one row, enforced by a unique index.

## Profile
Facts parsed from the CV, reviewed and confirmed.
| Field | Type | Notes |
|---|---|---|
| sourceFilePath | text | Original CV |
| confirmed | bool | Agents refuse to run until true |
| contact | jsonb | name, email, phone, location, links |
| facts | jsonb[] | Each fact: `{ id, kind: role\|skill\|education\|achievement\|cert\|language, text, startDate?, endDate?, org? }` |
| version | int | Bumped on every confirmed edit |

Fact IDs are stable so Pen can cite them.

## Preferences
| Field | Type |
|---|---|
| roles | text[]: the job titles wanted. Discover searches for them, Search ranks by them, Scout scores against them |
| locations | text[] |
| remote | enum: onsite / hybrid / remote / any |
| salaryFloor | int + currency |
| stack | text[] (must-have / nice-to-have) |
| exclusions | jsonb: companies, keywords, seniority |
| companyBoards | jsonb: optional list of `{ ats: greenhouse\|lever\|ashby, boardToken }` to always search, on top of what Discover finds |

## DiscoveredCompany
Companies Claude found by searching the web (docs/SOURCES.md).

| Field | Type | Notes |
|---|---|---|
| name, nameNorm | text | nameNorm is unique, so a company is stored once |
| ats, boardToken | enum, text | Null when no Greenhouse, Lever or Ashby board answered; those are not searched |
| reason | text | Claude's one-line reason |
| checkedAt | timestamp | When the board was last looked for |
| removed | bool | The owner dismissed it: not read, not suggested again |

## RejectedPosting
Postings Scout dropped. Only the link and score are kept, so Search doesn't pay to score them again for 30 days, or until Preferences change. They never reach the board.

| Field | Type |
|---|---|
| canonicalUrl | text unique |
| matchScore | int |
| criteriaKey | text: hash of the Preferences it was scored against |

## AnswerBank
| Field | Type | Notes |
|---|---|---|
| questionKey | text unique | Normalized (lowercase, stripped punctuation, synonyms mapped). Job-only answers end in `@<applicationId>` |
| questionVariants | text[] | Raw phrasings seen |
| answer | text | Empty means "not answered yet": seeded questions start this way and lookups ignore them. Format and length rules are `answerRule` in `packages/core/src/answers.ts` |
| kind | enum: text / choice / number / date / consent | |
| reusable | bool | If false, only applies to the job it was created for |

## Job
| Field | Type | Notes |
|---|---|---|
| ats | enum | greenhouse / lever / ashby / other (added by hand from anywhere else) |
| sourceUrl | text | |
| canonicalUrl | text | Strip query, fragment, tracking params, trailing slash; lowercase host |
| company, companyNorm | text | Norm: lowercase, strip legal suffix (Inc, GmbH, SAS, Ltd…), collapse whitespace |
| title, titleNorm | text | Norm: lowercase, strip seniority punctuation noise, collapse whitespace |
| location, remote | text, enum | |
| salary | text | Literal from posting or `"not stated"` |
| rawPosting | text | Stored as untrusted |
| matchScore | int 0–100 | |
| matchReasons | jsonb | `{ met: [], missed: [], hardFail?: string }` |
| requirements | jsonb? | `[{ text, factIds[], closest?[] }]`: the posting's core requirements, most important first, the Profile facts that meet each (empty when none does), and for a requirement none meets, the facts showing the closest real experience. Scout writes them; null for jobs found before that, until Pen reads them. |
| requirementsProfileVersion | int? | The Profile version the requirements were matched against. Pen matches them again when the Profile has changed since. |

**Dedupe:** unique index on `canonicalUrl`, plus unique index on `(companyNorm, titleNorm)` among non-archived jobs. Insert with `ON CONFLICT DO NOTHING`.

## Application
| Field | Type |
|---|---|
| jobId | fk unique |
| status | enum (see STATE_MACHINE.md) |
| approvedCvDocId, approvedLetterDocId | fk? |
| hasOpenBlocker | bool (denormalized for the board) |

## ApplicationEvent
`applicationId, from, to, actor (owner|system|agentRunId), at`

## Document
| Field | Type |
|---|---|
| applicationId | fk |
| kind | enum: cv / cover_letter |
| version | int |
| htmlSource | text |
| content | jsonb? | What the document says, each piece with the fact IDs it cites; the Craft modal edits this |
| pdfPath | text |
| sha256 | text |
| factIds | text[] | Profile facts used |
| profileVersion | int |
| agentRunId | uuid? | The Pen run that wrote it; empty for the owner's edits |
| approvedAt | timestamp? |

Unique `(applicationId, kind, version)`. A CV and its letter are always saved together with the same version. Approved rows are immutable (DB trigger or app guard).

## AgentRun
| Field | Type |
|---|---|
| role | enum: extractor / scout / pen / shipper |
| applicationId | fk? |
| status | queued / running / paused / succeeded / failed |
| promptVersion | text (git hash of agent.md; a run that used more than one prompt joins them with `+`, e.g. Pen's and Scout's when Pen re-read requirements) |
| model | text |
| input, output | jsonb |
| checkpoint | jsonb? |
| logs | jsonb[] |
| inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens | int |
| error | text? |

## Evidence
`applicationId, agentRunId?, type (prefill_screenshot | submission | confirmation_text | email), filePath?, text?, capturedAt`

## Blocker
`applicationId, agentRunId, question, questionKey, fieldContext (label, type, options), answer?, answeredAt?`

## Settings
`aiProvider (api | cli), encryptedApiKey? (AES-256-GCM, key from env), apiKeyLast4?, defaultModel?, workerLastSeenAt?`
