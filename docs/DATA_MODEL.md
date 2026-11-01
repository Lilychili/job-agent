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
| locations | text[] |
| remote | enum: onsite / hybrid / remote / any |
| salaryFloor | int + currency |
| stack | text[] (must-have / nice-to-have) |
| exclusions | jsonb: companies, keywords, seniority |
| companyBoards | jsonb: list of `{ ats: greenhouse\|lever\|ashby, boardToken }` to search |

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
| pdfPath | text |
| sha256 | text |
| factIds | text[] | Profile facts used |
| profileVersion | int |
| approvedAt | timestamp? |

Unique `(applicationId, kind, version)`. Approved rows are immutable (DB trigger or app guard).

## AgentRun
| Field | Type |
|---|---|
| role | enum: extractor / scout / pen / shipper |
| applicationId | fk? |
| status | queued / running / paused / succeeded / failed |
| promptVersion | text (git hash of agent.md) |
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
