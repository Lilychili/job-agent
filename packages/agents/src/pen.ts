// Writes a CV and cover letter for one job. The CV is the owner's own CV, tailored: every role, every
// achievement, skill, degree, certificate and language stays, and Claude only chooses their order and
// rewords each achievement for the job. Code checks nothing was left out, added or used twice. Claude
// gets no tools; every claim cites its facts, and code rejects unknown citations and numbers no cited fact
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
  /** The posting's core requirements, most important first, when Search has read them. */
  requirements?: string[] | null;
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
    checkKeepsTheCv({ experience, skills, otherFactIds }, facts);
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
  // Roles stay in CV order, most recent first, whatever order Claude gave them in.
  if (!owner) {
    const start = (id: string) => byId.get(id)?.startDate ?? "";
    experience.sort((a, b) => start(b.roleFactId).localeCompare(start(a.roleFactId)));
  }
  return {
    cv: { summary, experience, skills, otherFactIds },
    coverLetter: { greeting: free(coverLetter.greeting, "The greeting"), paragraphs, closing: free(coverLetter.closing, "The closing") },
  };
}

// Both sides go through the same squashing, so accented names still match each other.
const orgKey = (org: string | undefined) => (org ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join(" ");
const named = (f: ProfileFact) => `"${[f.text, f.org].filter(Boolean).join(", ").slice(0, 80)}" (${f.id})`;

/**
 * The CV is the owner's CV in a better order and wording, so nothing is left out or added: every role;
 * each of a role's achievements exactly once, as one bullet under that role; every skill; and every
 * degree, certificate and language. An achievement whose employer matches no role may go under any role,
 * or nowhere.
 */
function checkKeepsTheCv(cv: Pick<CvContent, "experience" | "skills" | "otherFactIds">, facts: ProfileFact[]) {
  const shown = new Set(cv.experience.map((e) => e.roleFactId));
  for (const role of facts.filter((f) => f.kind === "role")) {
    if (!shown.has(role.id)) throw new ValidationError(`Experience leaves out the role ${named(role)}. Keep every role.`);
  }
  const roleOrgs = new Set(facts.filter((f) => f.kind === "role").map((f) => orgKey(f.org)).filter(Boolean));
  const byId = new Map(facts.map((f) => [f.id, f]));
  const used = new Set<string>();
  cv.experience.forEach((e, i) => {
    const role = byId.get(e.roleFactId)!;
    e.bullets.forEach((b, j) => {
      const where = `Experience ${i + 1}, bullet ${j + 1}`;
      const achievements = b.factIds.map((id) => byId.get(id)!).filter((f) => f.kind === "achievement");
      if (achievements.length !== 1) throw new ValidationError(`${where} must reword exactly one achievement and cite it; it cites ${achievements.length}.`);
      const a = achievements[0]!;
      if (used.has(a.id)) throw new ValidationError(`${where} repeats the achievement ${named(a)}. Use each achievement once.`);
      used.add(a.id);
      if (roleOrgs.has(orgKey(a.org)) && orgKey(a.org) !== orgKey(role.org)) {
        throw new ValidationError(`${where} puts the achievement ${named(a)} under ${named(role)}. It belongs under the role at ${a.org}.`);
      }
    });
  });
  const left = facts.filter((f) => f.kind === "achievement" && roleOrgs.has(orgKey(f.org)) && !used.has(f.id));
  if (left.length) {
    throw new ValidationError(`Experience leaves out the achievement ${named(left[0]!)}${left.length > 1 ? ` and ${left.length - 1} more` : ""}. Keep every achievement, as one bullet under its role.`);
  }
  const skillsCited = new Set(cv.skills.flatMap((s) => s.factIds));
  const skillsLeft = facts.filter((f) => f.kind === "skill" && !skillsCited.has(f.id));
  if (skillsLeft.length) {
    throw new ValidationError(`Skills leave out ${skillsLeft.slice(0, 5).map(named).join(", ")}${skillsLeft.length > 5 ? ` and ${skillsLeft.length - 5} more` : ""}. Keep every skill.`);
  }
  const other = new Set(cv.otherFactIds);
  const otherLeft = facts.filter((f) => OTHER_KINDS.includes(f.kind) && !other.has(f.id));
  if (otherLeft.length) throw new ValidationError(`Other facts leave out ${otherLeft.map(named).join(", ")}. List every degree, certificate and language.`);
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
    // Read by Claude from this posting earlier, so as untrusted as the posting itself.
    ...(opts.job.requirements?.length ? [`<requirements>\n${wrapUntrusted("posting", opts.job.requirements.map((r, i) => `${i + 1}. ${r}`).join("\n"))}\n</requirements>`] : []),
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
      // The whole CV comes back now, not a selection of it.
      maxTokens: 8000,
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
