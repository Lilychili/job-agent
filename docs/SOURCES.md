# Job sources

Status: Discover and verify, and Indeed and LinkedIn alerts from Gmail, are built. Aggregators are planned.

## Problem

Search ([scout.ts](../apps/worker/src/jobs/scout.ts)) reads only the boards in Preferences (`companyBoards`) and stops with "Add the companies to search in Profile → Looking for" when the list is empty. The owner does not want to name companies. Claude should find them.

The Greenhouse, Lever and Ashby APIs have no "search all jobs" endpoint: a company must be named. So Claude's job is to name the companies, and code's job is to check them.

## Search procedure

One Search run does these steps in order. The owner gives only Preferences (roles, locations, remote, salary floor, stack, exclusions).

1. **Discover (Claude, web search).** Claude searches the web from Preferences, for example "senior frontend engineer remote Spain", and returns the companies that look like a fit, with any careers or ATS link it saw. Its only tool is web search. Companies found in earlier runs are passed in so it looks for new ones.
2. **Verify (code).** For each company, code finds the board: parse the token from an ATS link, otherwise try slug guesses of the name against the three APIs. A company with no board is kept as "no known board" and looked up again after 30 days. A board that failed to answer proves nothing, so that company isn't saved and can be named again.
   - `boards-api.greenhouse.io/v1/boards/{token}/jobs`
   - `api.lever.co/v0/postings/{token}`
   - `api.ashbyhq.com/posting-api/job-board/{token}`
3. **Read (code).** Read every open posting on the verified boards. Aggregators (Remotive, Arbeitnow) are read the same way to catch companies Claude missed. Boards found this way are remembered.
4. **Filter (code).** Hard criteria, then skip known jobs, as today.
5. **Compare skills (Claude, no tools).** Score each posting against the stack, seniority and preferences, with reasons, as today. The salary must be copied from the posting or be `"not stated"`.
6. **Found.** Survivors land on the board.

Steps 4–6 already exist. New work is steps 1–3.

### Safety rules

- Discover is the only step that uses the open web. Its output is company names and links, never jobs. Every job shown comes from an ATS API response, so Claude cannot invent a posting.
- Web pages are untrusted. Instructions found in a page are ignored. The output schema allows only company, optional link, and a short reason.
- Scoring stays tool-free.
- Missing salary is `"not stated"`. Never estimate.

## Profile changes

- Remove the required "Companies to search" field from Profile → Looking for.
- Replace it with:
  - **Never include** (already covered by `exclusions.companies`).
  - **Always include** (optional): companies the owner wants searched even if Claude doesn't find them.
  - **Discovered companies**: a read-only list of what Claude found and whether a board was found, each with a remove button. Removing adds it to Never include.
- An empty profile list no longer blocks Search.

## Data

- `discovered_company`: name, `ats`, `board_token` (null when none found), `reason`, `checked_at`, `removed`.
- Planned with aggregators: `found_via` (`web`, `aggregator`, `gmail`, `owner`) and `jobs.source`, where a card came from.

## Gmail alerts

Built for Indeed and LinkedIn.

1. **Connect.** Settings → Job alerts. Gmail API, OAuth, scope `gmail.readonly`. The refresh token is encrypted with [secrets.ts](../packages/core/src/secrets.ts). M6 (reply tracking) can share this connection.
2. **Read.** Every Search reads up to 8 messages per source from the last 14 days: `from:indeed.com` without its application confirmations, and LinkedIn's job alert addresses only (`LINKEDIN_ALERT_SENDERS` in [gmail.ts](../packages/core/src/gmail.ts)). Code re-checks the From address. No other mail is opened and no email is stored.
3. **List the jobs.** Claude, with no tools, lists the jobs in each email (`agents/alerts/agent.md`). Code keeps a job only if its title and company appear in the email and its link is one the email contains.
4. **Find the company link.** For Indeed, code follows the tracking link without reading the page. LinkedIn links are never fetched: they are cut down to the plain job address, because their query can carry a sign-in token. Then code looks for the company's board with `findBoard`. The card links to, in order: the company's own posting, the company site the link reached, or the alert's link with a "Company jobs page" link to the board. A board found this way joins the discovered companies.
5. **Score.** Alert jobs go through the same hard filters, dedupe and 55 cut-off. Excluded companies and titles are dropped before any lookup. An alert job that is turned down is remembered by company and title as well as by link, because its link changes between emails. A job known only from the email is scored on its title, company and location, and can't score above 69.

Each board is read once per search, shared by Discover, the board read and the alerts. A company known to have no board isn't looked up again until its 30-day recheck. Emails themselves are read again on each Search, up to 16 paid Claude calls: nothing records which ones were handled yet.

LinkedIn and Indeed pages are never scraped. Email text is untrusted: wrapped in `<untrusted_email>`, and Claude's answer is checked against it.

### Setting up Google

1. In the Google Cloud console, create a project and enable the Gmail API.
2. Under the OAuth consent screen, choose External and add your own address as a test user.
3. Create an OAuth client of type "Web application", with redirect URI `http://127.0.0.1:3000/api/gmail/callback`.
4. Put the client ID and secret in `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, restart the app, then use Connect Gmail in Settings.

While the app is in Google's "Testing" status, Google ends the connection after 7 days and Gmail must be connected again. The search log says when.

## Build order

Each step ships on its own.

1. **Discover and verify.** Claude web-search step, board verification, `discovered_company`, remove the Profile requirement. This is the core of the feature.
2. **Aggregators** (Remotive, Arbeitnow) as extra inputs.
3. **Gmail alerts**: built for Indeed and LinkedIn.

## Open decisions

- Discover runs inside every Search, or as a separate daily run that Search reads from. Default: **inside Search, capped, and results remembered**, so later runs cost less.
- Whether Claude's web search runs through the Agent SDK or the owner's Claude Code CLI, as Settings already chooses for other roles. Default: **same as Settings**.
- Gmail: **read-only OAuth limited to the alert senders**.
- Alert jobs that don't resolve to an ATS page: **show as flagged cards**.

## Not doing

- Scraping LinkedIn, Indeed, InfoJobs, StepStone or Workday pages.
- Giving the scoring step tools.
- Showing jobs that did not come from an ATS API response or a flagged alert.
