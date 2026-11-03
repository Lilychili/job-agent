// Scores postings against Preferences. Claude gets no tools: code has already read the boards and
// applied the hard criteria. Claude's answer is checked here, and it can only ever add a score,
// reasons, the posting's core requirements matched to Profile facts, and a salary or work style the
// posting states. Company, title and links stay the board's.
import { str, ValidationError } from "@jobagent/core";
import { NOT_STATED, type Posting, type Remote } from "@jobagent/ats";
import type { JobRequirement, ProfileFact } from "@jobagent/db";
import { addUsage, askClaude, NO_USAGE, type Auth } from "./ask";
import { factSource, skillNames, wordPattern } from "./citations";
import type { Usage } from "./claude";
import { loadPrompt } from "./prompts";
import { salaryCopiedFrom, wrapUntrusted } from "./untrusted";

const MAX_POSTING_PROMPT_CHARS = 6000;
const MAX_REASONS = 6;
const MAX_REASON_CHARS = 200;
const MAX_SALARY_CHARS = 120;
const MAX_REQUIREMENTS = 10;
const MAX_REQUIREMENT_CHARS = 120;
const PAY_LINE = /[€£$]|salary|compensation|pay range|base pay/i;
const REMOTES: readonly Remote[] = ["onsite", "hybrid", "remote", "unknown"];

const REQUIREMENTS = {
  type: "array",
  description: "The posting's core requirements, most important first, each with the Profile facts that meet it.",
  items: {
    type: "object",
    required: ["text", "factIds", "closest"],
    properties: {
      text: { type: "string" },
      factIds: { type: "array", items: { type: "string" } },
      closest: { type: "array", items: { type: "string" }, description: "Only when factIds is empty: the facts showing the nearest real experience." },
    },
  },
} as const;

const SCHEMA = {
  type: "object",
  required: ["scores"],
  properties: {
    scores: {
      type: "array",
      items: {
        type: "object",
        required: ["ref", "requirements", "salary", "remote", "matchScore", "met", "missed"],
        properties: {
          ref: { type: "integer", description: "The posting's number." },
          requirements: REQUIREMENTS,
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

export type ScoredPosting = Posting & { matchScore: number; matchReasons: { met: string[]; missed: string[] }; requirements: JobRequirement[] };

/** Any of the owner's skills, by any of their names, as whole words. */
export function skillPattern(facts: ProfileFact[], stack: string[] = []): RegExp | null {
  const names = [...facts.filter((f) => f.kind === "skill").map((f) => f.text), ...stack];
  return wordPattern([...new Set(names.flatMap(skillNames))].filter((n) => n.length > 1));
}

/**
 * Long postings are cut for the prompt. Pay is often at the very end, and the tech stack can be too, so
 * lines further on that state pay or name one of the owner's skills stay.
 */
export function postingForPrompt(text: string, skills: RegExp | null = null): string {
  if (text.length <= MAX_POSTING_PROMPT_CHARS) return text;
  const kept = text
    .slice(MAX_POSTING_PROMPT_CHARS)
    .split("\n")
    .filter((l) => PAY_LINE.test(l) || skills?.test(l));
  return [text.slice(0, MAX_POSTING_PROMPT_CHARS), ...kept].join("\n").slice(0, MAX_POSTING_PROMPT_CHARS * 1.5);
}

/** One line per fact, so Claude can cite them by ID without the whole Profile as JSON. */
const factLines = (facts: ProfileFact[]) => (facts.length ? facts.map((f) => `${f.id} (${f.kind}): ${factSource(f)}`).join("\n") : "none");

function promptFor(preferences: ScoutPreferences, postings: Posting[], facts: ProfileFact[]): string {
  const skills = skillPattern(facts, [...preferences.stackMustHave, ...preferences.stackNiceToHave]);
  const items = postings.map((p, ref) =>
    [
      `Posting ${ref}`,
      wrapUntrusted("posting", [`Company: ${p.company}`, `Title: ${p.title}`, `Location: ${p.location ?? "not stated"}`, `Work style: ${p.remote}`, ...(p.summaryOnly ? ["Source: email alert, summary only"] : []), "", postingForPrompt(p.text, skills)].join("\n")),
    ].join("\n"),
  );
  return [
    `<preferences>\n${JSON.stringify(preferences)}\n</preferences>`,
    `<profile_facts>\n${factLines(facts)}\n</profile_facts>`,
    ...items,
    `Score all ${postings.length} postings.`,
  ].join("\n\n");
}

/** Requirements with their text cut to size and only citations of facts that exist. */
function requirements(v: unknown, known: Set<string>, ref: number): JobRequirement[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new ValidationError(`Posting ${ref}: requirements must be a list.`);
  // A citation of a fact that doesn't exist only loses the match; Pen and the owner never see it.
  const cites = (ids: unknown) => (Array.isArray(ids) ? [...new Set(ids.filter((id): id is string => typeof id === "string" && known.has(id)))] : []);
  return v
    .flatMap((r: { text?: unknown; factIds?: unknown; closest?: unknown } | null) => {
      const text = str(r?.text).slice(0, MAX_REQUIREMENT_CHARS);
      if (!text) return [];
      const factIds = cites(r?.factIds);
      return [{ text, factIds, closest: factIds.length ? [] : cites(r?.closest) }];
    })
    .slice(0, MAX_REQUIREMENTS);
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
export function parseScores(output: unknown, postings: Posting[], facts: ProfileFact[] = []): ScoredPosting[] {
  const known = new Set(facts.map((f) => f.id));
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
    // A summary is only a title and a company: any requirements read from it would just repeat the title.
    const needs = posting.summaryOnly ? [] : requirements(s.requirements, known, ref);
    return { ...posting, remote, salary: checkSalary(s.salary, posting), matchScore, matchReasons: { met, missed }, requirements: needs };
  });
}

// An alert summary is a title and a company, a few dozen characters: nothing to read requirements from.
const MIN_REQUIREMENTS_POSTING_CHARS = 300;

/**
 * Only the core requirements of one posting, matched to the facts, without a score: for a job found
 * before Search read requirements, or whose matches predate a change to the Profile. Same prompt and
 * rules as scoring.
 */
export async function readRequirements(opts: {
  auth: Auth;
  model: string;
  facts: ProfileFact[];
  job: { company: string; title: string; posting: string };
  signal?: AbortSignal;
}): Promise<{ requirements: JobRequirement[]; usage: Usage; listCostUsd: number; promptVersion: string | null }> {
  const { company, title, posting } = opts.job;
  if (posting.length < MIN_REQUIREMENTS_POSTING_CHARS) return { requirements: [], usage: NO_USAGE, listCostUsd: 0, promptVersion: null };
  const { system, version } = loadPrompt("scout");
  const base = [
    `<profile_facts>\n${factLines(opts.facts)}\n</profile_facts>`,
    wrapUntrusted("posting", [`Company: ${company}`, `Title: ${title}`, "", postingForPrompt(posting, skillPattern(opts.facts))].join("\n")),
    "List this posting's core requirements only. Don't score it.",
  ].join("\n\n");
  let prompt = base;
  let usage = NO_USAGE;
  let listCostUsd = 0;

  // One repair retry on invalid output, then fail, as scoring does.
  for (let attempt = 0; ; attempt++) {
    const res = await askClaude({
      auth: opts.auth,
      model: opts.model,
      system,
      prompt,
      schema: { type: "object", required: ["requirements"], properties: { requirements: REQUIREMENTS } },
      tool: { name: "submit_requirements", description: "Submit the posting's core requirements." },
      maxTokens: 2000,
      signal: opts.signal,
    });
    usage = addUsage(usage, res.usage);
    listCostUsd += res.listCostUsd;
    try {
      const found = requirements((res.output as { requirements?: unknown } | null)?.requirements, new Set(opts.facts.map((f) => f.id)), 0);
      return { requirements: found, usage, listCostUsd, promptVersion: version };
    } catch (err) {
      if (!(err instanceof ValidationError) || attempt >= 1) throw err;
      prompt = `${base}\n\nYour previous answer was rejected: ${err.message} Return corrected requirements.`;
    }
  }
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
  /** The confirmed Profile's facts, to match requirements against. None before the Profile is confirmed. */
  facts: ProfileFact[];
  postings: Posting[];
  signal?: AbortSignal;
  log?: (m: string) => Promise<void> | void;
}): Promise<ScoreResult> {
  const { system, version } = loadPrompt("scout");
  const base = promptFor(opts.preferences, opts.postings, opts.facts);
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
      // Requirements add a few hundred tokens a posting.
      maxTokens: 8000,
      signal: opts.signal,
    });
    usage = addUsage(usage, res.usage);
    listCostUsd += res.listCostUsd;
    try {
      return { jobs: parseScores(res.output, opts.postings, opts.facts), usage, listCostUsd, promptVersion: version };
    } catch (err) {
      if (!(err instanceof ValidationError) || attempt >= 1) throw err;
      await opts.log?.(`Scores were invalid (${err.message}); asking once more.`);
      prompt = `${base}\n\nYour previous answer was rejected: ${err.message} Return corrected scores for all postings.`;
    }
  }
}
