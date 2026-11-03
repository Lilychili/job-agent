// Writes a CV and cover letter for one job. Claude gets no tools and only words what the confirmed Profile
// facts say. Every claim cites its facts, and code rejects unknown citations and numbers no cited fact
// holds. Names, role titles, employers and dates aren't Claude's to write: the templates take them from
// the Profile.
import { ValidationError, str } from "@jobagent/core";
import type { CitedText, CvContent, FactKind, LetterContent, ProfileFact } from "@jobagent/db";
import { addUsage, askClaude, NO_USAGE, type Auth } from "./ask";
import { escapeRegex, factSource, unsupportedNumber } from "./citations";
import type { Usage } from "./claude";
import { loadPrompt } from "./prompts";
import { wrapUntrusted } from "./untrusted";

const MAX_TEXT_CHARS = 1200;
// Whole postings: what the job needs can sit near the end of a long one.
const MAX_POSTING_PROMPT_CHARS = 40_000;
// The prompt asks for 2–5 bullets, but a role whose Profile holds one achievement can only truthfully have one.
const BULLETS = [1, 5] as const;
const PARAGRAPHS = [3, 4] as const;
const OTHER_KINDS: readonly FactKind[] = ["education", "cert", "language"];

/**
 * Claude's answer format, listing every fact ID it may write in each place. Claude writes IDs out as
 * text, and a random-looking one like "f-language-34b0348d" is easy to get wrong ("f-language-ukrainian-
 * placeholder"): with the IDs listed it picks one instead. parseDraft still checks them.
 */
export function schemaFor(facts: ProfileFact[]) {
  const oneOf = (kinds?: readonly FactKind[]) => {
    const ids = facts.filter((f) => !kinds || kinds.includes(f.kind)).map((f) => f.id);
    return ids.length ? { type: "string", enum: ids } : { type: "string" };
  };
  const cited = {
    type: "object",
    required: ["text", "factIds"],
    properties: { text: { type: "string" }, factIds: { type: "array", items: oneOf() } },
  };
  return {
    type: "object",
    required: ["cv", "coverLetter"],
    properties: {
      cv: {
        type: "object",
        required: ["summary", "experience", "skills", "otherFactIds"],
        properties: {
          summary: cited,
          experience: {
            type: "array",
            items: {
              type: "object",
              required: ["roleFactId", "bullets"],
              properties: { roleFactId: oneOf(["role"]), bullets: { type: "array", items: cited } },
            },
          },
          skills: { type: "array", items: cited },
          otherFactIds: { type: "array", items: oneOf(OTHER_KINDS), description: "Education, certificate and language facts to list." },
        },
      },
      coverLetter: {
        type: "object",
        required: ["greeting", "paragraphs", "closing"],
        properties: { greeting: { type: "string" }, paragraphs: { type: "array", items: cited }, closing: { type: "string" } },
      },
    },
  };
}

export interface PenJob {
  company: string;
  title: string;
  posting: string;
}

export interface PenDraft {
  cv: CvContent;
  coverLetter: LetterContent;
}

/**
 * Claude's answer, checked against the facts. Throws ValidationError unless every claim holds up.
 * `by: "owner"` checks the owner's edits instead: they may write what they like (the modal warns about
 * uncited claims and numbers), but citations must still be real facts, and emptied items are dropped.
 */
export function parseDraft(output: unknown, facts: ProfileFact[], job: Pick<PenJob, "company" | "title">, by: "claude" | "owner" = "claude"): PenDraft {
  const owner = by === "owner";
  const byId = new Map(facts.map((f) => [f.id, f]));
  const fact = (id: string, where: string) => {
    const hit = byId.get(id);
    if (!hit) throw new ValidationError(`${where} cites unknown fact "${id}".`);
    return hit;
  };
  const numbersIn = (text: string, sources: string[], where: string) => {
    const invented = owner ? undefined : unsupportedNumber(text, sources);
    if (invented) throw new ValidationError(`${where} says "${invented}", which none of its facts state.`);
  };
  const free = (v: unknown, where: string) => {
    const text = str(v);
    if (!text || text.length > MAX_TEXT_CHARS) throw new ValidationError(`${where} must be 1 to ${MAX_TEXT_CHARS} characters.`);
    numbersIn(text, [job.company, job.title], where);
    return text;
  };
  const cited = (v: unknown, where: string): CitedText => {
    const raw = v as { text?: unknown; factIds?: unknown } | null;
    const text = str(raw?.text);
    if (!text || text.length > MAX_TEXT_CHARS) throw new ValidationError(`${where} must be 1 to ${MAX_TEXT_CHARS} characters.`);
    if (!Array.isArray(raw?.factIds) || (!owner && raw.factIds.length === 0) || raw.factIds.some((id) => typeof id !== "string")) throw new ValidationError(`${where} cites no facts.`);
    const factIds = [...new Set(raw.factIds as string[])];
    const sources = factIds.map((id) => factSource(fact(id, where)));
    numbersIn(text, [...sources, job.company, job.title], where);
    return { text, factIds };
  };
  const list = (v: unknown, where: string): unknown[] => {
    if (!Array.isArray(v)) throw new ValidationError(`${where} must be a list.`);
    return v;
  };
  const citedList = (v: unknown, where: string, item: (i: number) => string): CitedText[] => {
    const items = owner ? list(v, where).filter((c) => str((c as { text?: unknown } | null)?.text) !== "") : list(v, where);
    return items.map((c, i) => cited(c, item(i)));
  };

  // How many pieces Claude must write. The owner may cut or add as they like.
  const count = (n: number, [min, most]: readonly [number, number], what: string) => {
    if (!owner && (n < min || n > most)) throw new ValidationError(`${what} is ${n}; it must be ${min} to ${most}.`);
  };

  const { cv, coverLetter } = (output ?? {}) as { cv?: Record<string, unknown>; coverLetter?: Record<string, unknown> };
  if (!cv || !coverLetter) throw new ValidationError("The CV or the cover letter is missing.");
  const roles = new Set<string>();
  const experience = list(cv.experience, "Experience").map((e, i) => {
    const { roleFactId, bullets } = e as { roleFactId?: unknown; bullets?: unknown };
    const where = `Experience ${i + 1}`;
    const role = fact(str(roleFactId), where);
    if (role.kind !== "role") throw new ValidationError(`${where} must point at a role, not a ${role.kind}.`);
    if (roles.has(role.id)) throw new ValidationError(`${where} repeats the role "${role.id}".`);
    roles.add(role.id);
    const items = citedList(bullets, where, (j) => `${where}, bullet ${j + 1}`);
    count(items.length, BULLETS, `${where}'s bullet count`);
    return { roleFactId: role.id, bullets: items };
  });
  const paragraphs = citedList(coverLetter.paragraphs, "The letter", (i) => `Paragraph ${i + 1}`);
  count(paragraphs.length, PARAGRAPHS, "The letter's paragraph count");
  if (paragraphs.length === 0) throw new ValidationError("The letter has no paragraphs.");
  // A made-up ID is rejected, not dropped: Claude meant some fact, and dropping it would silently leave
  // that fact (a language, say) off the CV.
  const otherFactIds = [...new Set(list(cv.otherFactIds, "Other facts").map((id) => str(id)))].map((id) => {
    const f = fact(id, "Other facts");
    if (!OTHER_KINDS.includes(f.kind)) throw new ValidationError(`Other facts may list education, certificates and languages, not the ${f.kind} "${id}".`);
    return f.id;
  });
  const summary = cited(cv.summary, "The summary");
  const skills = citedList(cv.skills, "Skills", (i) => `Skill ${i + 1}`);
  if (!owner) {
    checkLevelWords(
      [
        { text: summary.text, where: "The summary" },
        ...experience.flatMap((e, i) => e.bullets.map((b, j) => ({ text: b.text, where: `Experience ${i + 1}, bullet ${j + 1}` }))),
        ...paragraphs.map((p, i) => ({ text: p.text, where: `Paragraph ${i + 1}` })),
      ],
      facts,
      job.title,
    );
  }
  return {
    cv: { summary, experience, skills, otherFactIds },
    coverLetter: { greeting: free(coverLetter.greeting, "The greeting"), paragraphs, closing: free(coverLetter.closing, "The closing") },
  };
}

// Words that give the owner a level. A job asking for seniority tempts a title the Profile never gave.
const LEVEL_WORDS = /(?<!\w)(senior|principal|staff engineer|lead (?:engineer|developer)|tech lead|head of|chief)(?!\w)/gi;

/**
 * A level word in the documents must be in the title of a role the owner held: "Mentored senior
 * engineers" doesn't make the owner senior. Naming the job itself ("the Senior Engineer role") is
 * fine, so the job title is taken out first.
 */
function checkLevelWords(pieces: { text: string; where: string }[], facts: ProfileFact[], jobTitle: string) {
  const stated = facts.filter((f) => f.kind === "role").map((f) => f.text.toLowerCase());
  const title = new RegExp(escapeRegex(jobTitle), "gi");
  for (const { text, where } of pieces) {
    const word = text.replace(title, "").match(LEVEL_WORDS)?.find((w) => !stated.some((s) => s.includes(w.toLowerCase())));
    if (word) throw new ValidationError(`${where} calls the owner "${word}", which no fact states. Show the level through the roles instead.`);
  }
}

export const cvFactIds = ({ summary, experience, skills, otherFactIds }: CvContent) => [
  ...new Set([...summary.factIds, ...experience.flatMap((e) => [e.roleFactId, ...e.bullets.flatMap((b) => b.factIds)]), ...skills.flatMap((s) => s.factIds), ...otherFactIds]),
];

export const letterFactIds = ({ paragraphs }: LetterContent) => [...new Set(paragraphs.flatMap((p) => p.factIds))];

export async function craftDocuments(opts: {
  auth: Auth;
  model: string;
  facts: ProfileFact[];
  job: PenJob;
  whyTemplate: string | null;
  signal?: AbortSignal;
  log?: (m: string) => Promise<void> | void;
}): Promise<{ draft: PenDraft; usage: Usage; listCostUsd: number; promptVersion: string }> {
  const { system, version } = loadPrompt("pen");
  const { company, title, posting } = opts.job;
  const base = [
    `<facts>\n${JSON.stringify(opts.facts)}\n</facts>`,
    wrapUntrusted("posting", [`Company: ${company}`, `Title: ${title}`, "", posting.slice(0, MAX_POSTING_PROMPT_CHARS)].join("\n")),
    `<why_template>\n${opts.whyTemplate ?? "none"}\n</why_template>`,
    "Write the CV and the cover letter for this job.",
  ].join("\n\n");
  const schema = schemaFor(opts.facts);
  let prompt = base;
  let usage = NO_USAGE;
  let listCostUsd = 0;

  // One repair retry on invalid output, then fail, as Scout does.
  for (let attempt = 0; ; attempt++) {
    const res = await askClaude({
      auth: opts.auth,
      model: opts.model,
      system,
      prompt,
      schema,
      tool: { name: "submit_documents", description: "Submit the CV and the cover letter." },
      maxTokens: 4000,
      signal: opts.signal,
    });
    usage = addUsage(usage, res.usage);
    listCostUsd += res.listCostUsd;
    try {
      return { draft: parseDraft(res.output, opts.facts, opts.job), usage, listCostUsd, promptVersion: version };
    } catch (err) {
      if (!(err instanceof ValidationError) || attempt >= 1) throw err;
      await opts.log?.(`The draft was invalid (${err.message}); asking once more.`);
      prompt = `${base}\n\nYour previous answer was rejected: ${err.message} Return a corrected draft.`;
    }
  }
}
