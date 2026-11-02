// Scores postings against Preferences. Claude gets no tools: code has already read the boards and
// applied the hard criteria. Claude's answer is checked here, and it can only ever add a score,
// reasons, and a salary or work style the posting states. Company, title and links stay the board's.
import { ValidationError } from "@jobagent/core";
import { NOT_STATED, type Posting, type Remote } from "@jobagent/ats";
import { addUsage, askClaude, NO_USAGE, type Auth } from "./ask";
import type { Usage } from "./claude";
import { loadPrompt } from "./prompts";
import { salaryCopiedFrom, wrapUntrusted } from "./untrusted";

const MAX_POSTING_PROMPT_CHARS = 6000;
const MAX_REASONS = 6;
const MAX_REASON_CHARS = 200;
const MAX_SALARY_CHARS = 120;
const PAY_LINE = /[€£$]|salary|compensation|pay range|base pay/i;
const REMOTES: readonly Remote[] = ["onsite", "hybrid", "remote", "unknown"];

const SCHEMA = {
  type: "object",
  required: ["scores"],
  properties: {
    scores: {
      type: "array",
      items: {
        type: "object",
        required: ["ref", "salary", "remote", "matchScore", "met", "missed"],
        properties: {
          ref: { type: "integer", description: "The posting's number." },
          salary: { type: "string", description: 'Copied word for word from the posting, or exactly "not stated".' },
          remote: { type: "string", enum: REMOTES },
          matchScore: { type: "integer", minimum: 0, maximum: 100 },
          met: { type: "array", items: { type: "string" } },
          missed: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

export interface ScoutPreferences {
  /** The job titles the owner wants. */
  roles: string[];
  locations: string[];
  remote: string;
  salaryFloor: number | null;
  salaryCurrency: string | null;
  stackMustHave: string[];
  stackNiceToHave: string[];
  exclusions: { companies: string[]; keywords: string[]; seniority: string[] };
}

export type ScoredPosting = Posting & { matchScore: number; matchReasons: { met: string[]; missed: string[] } };

/** Long postings are cut for the prompt, but pay is often at the very end, so those lines stay. */
export function postingForPrompt(text: string): string {
  if (text.length <= MAX_POSTING_PROMPT_CHARS) return text;
  const pay = text.slice(MAX_POSTING_PROMPT_CHARS).split("\n").filter((l) => PAY_LINE.test(l));
  return [text.slice(0, MAX_POSTING_PROMPT_CHARS), ...pay].join("\n").slice(0, MAX_POSTING_PROMPT_CHARS * 1.25);
}

function promptFor(preferences: ScoutPreferences, postings: Posting[]): string {
  const items = postings.map((p, ref) =>
    [
      `Posting ${ref}`,
      wrapUntrusted("posting", [`Company: ${p.company}`, `Title: ${p.title}`, `Location: ${p.location ?? "not stated"}`, `Work style: ${p.remote}`, ...(p.summaryOnly ? ["Source: email alert, summary only"] : []), "", postingForPrompt(p.text)].join("\n")),
    ].join("\n"),
  );
  return [`<preferences>\n${JSON.stringify(preferences)}\n</preferences>`, ...items, `Score all ${postings.length} postings.`].join("\n\n");
}

function reasons(v: unknown, label: string): string[] {
  if (!Array.isArray(v) || v.some((r) => typeof r !== "string")) throw new ValidationError(`${label} must be a list of strings.`);
  return (v as string[]).map((r) => r.trim().slice(0, MAX_REASON_CHARS)).filter(Boolean).slice(0, MAX_REASONS);
}

function checkSalary(raw: unknown, posting: Posting): string {
  if (posting.salary !== NOT_STATED) return posting.salary;
  const salary = typeof raw === "string" ? raw.trim() : "";
  if (salary === NOT_STATED) return NOT_STATED;
  const literal = salary.length <= MAX_SALARY_CHARS && salaryCopiedFrom(salary, posting.text);
  if (!literal) throw new ValidationError(`Posting ${posting.title}: salary must be copied from the posting or be exactly "not stated".`);
  return salary;
}

/** Claude's answer, merged onto the postings. Throws ValidationError unless every posting got a sound score. */
export function parseScores(output: unknown, postings: Posting[]): ScoredPosting[] {
  const scores = (output as { scores?: unknown } | null)?.scores;
  if (!Array.isArray(scores)) throw new ValidationError("No scores were returned.");
  const byRef = new Map<number, Record<string, unknown>>();
  for (const s of scores as Record<string, unknown>[]) {
    if (byRef.has(s?.ref as number)) throw new ValidationError(`Posting ${String(s.ref)} was scored twice.`);
    byRef.set(s?.ref as number, s);
  }
  return postings.map((posting, ref) => {
    const s = byRef.get(ref);
    if (!s) throw new ValidationError(`Posting ${ref} has no score.`);
    const matchScore = s.matchScore;
    if (typeof matchScore !== "number" || !Number.isInteger(matchScore) || matchScore < 0 || matchScore > 100) {
      throw new ValidationError(`Posting ${ref}: score must be a whole number from 0 to 100.`);
    }
    const met = reasons(s.met, "met");
    const missed = reasons(s.missed, "missed");
    if (met.length + missed.length === 0) throw new ValidationError(`Posting ${ref}: a score needs reasons.`);
    const remote = posting.remote === "unknown" && REMOTES.includes(s.remote as Remote) ? (s.remote as Remote) : posting.remote;
    return { ...posting, remote, salary: checkSalary(s.salary, posting), matchScore, matchReasons: { met, missed } };
  });
}

export interface ScoreResult {
  jobs: ScoredPosting[];
  usage: Usage;
  listCostUsd: number;
  promptVersion: string;
}

export async function scorePostings(opts: {
  auth: Auth;
  model: string;
  preferences: ScoutPreferences;
  postings: Posting[];
  signal?: AbortSignal;
  log?: (m: string) => Promise<void> | void;
}): Promise<ScoreResult> {
  const { system, version } = loadPrompt("scout");
  const base = promptFor(opts.preferences, opts.postings);
  let prompt = base;
  let usage = NO_USAGE;
  let listCostUsd = 0;

  // One repair retry on invalid output, then fail (docs/ARCHITECTURE.md).
  for (let attempt = 0; ; attempt++) {
    const res = await askClaude({
      auth: opts.auth,
      model: opts.model,
      system,
      prompt,
      schema: SCHEMA,
      tool: { name: "submit_scores", description: "Submit a score for every posting." },
      maxTokens: 4000,
      signal: opts.signal,
    });
    usage = addUsage(usage, res.usage);
    listCostUsd += res.listCostUsd;
    try {
      return { jobs: parseScores(res.output, opts.postings), usage, listCostUsd, promptVersion: version };
    } catch (err) {
      if (!(err instanceof ValidationError) || attempt >= 1) throw err;
      await opts.log?.(`Scores were invalid (${err.message}); asking once more.`);
      prompt = `${base}\n\nYour previous answer was rejected: ${err.message} Return corrected scores for all postings.`;
    }
  }
}
