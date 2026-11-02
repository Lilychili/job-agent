// Pulls the jobs out of a job alert email. Claude gets no tools and only reports what the email
// says: titles and companies must appear in it, and a link can only be one the email contains.
import { htmlToText, NOT_STATED } from "@jobagent/ats";
import { str, ValidationError } from "@jobagent/core";
import { askClaude, type Auth } from "./ask";
import type { Usage } from "./claude";
import { loadPrompt } from "./prompts";
import { copiedFrom, isSafeName, salaryCopiedFrom, wrapUntrusted } from "./untrusted";

const MAX_EMAIL_CHARS = 30_000;
const MAX_LINKS = 80;
const MAX_JOBS = 30;
const MAX_FIELD_CHARS = 200;

const SCHEMA = {
  type: "object",
  required: ["jobs"],
  properties: {
    jobs: {
      type: "array",
      items: {
        type: "object",
        required: ["title", "company", "link"],
        properties: {
          title: { type: "string", description: "Copied from the email." },
          company: { type: "string", description: "Copied from the email." },
          location: { type: "string", description: "Copied from the email. Omit if it gives none." },
          salary: { type: "string", description: 'Copied word for word from the email, or exactly "not stated".' },
          link: { type: "integer", description: "The number in the job's [link N] marker." },
        },
      },
    },
  },
} as const;

export interface AlertJob {
  title: string;
  company: string;
  location: string | null;
  salary: string;
  sourceUrl: string;
}

/** The email as text, with each link replaced by a numbered marker, and the list of those links. */
export function emailForPrompt(html: string): { text: string; links: string[] } {
  const links: string[] = [];
  const marked = html.replace(/<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi, (_, href: string) => {
    const url = href.replace(/&amp;/g, "&").trim();
    if (!/^https?:\/\//i.test(url) || links.length >= MAX_LINKS) return " ";
    links.push(url);
    return ` [link ${links.length - 1}] `;
  });
  return { text: htmlToText(marked).slice(0, MAX_EMAIL_CHARS), links };
}

/** Claude's answer, checked against the email. What doesn't hold up is dropped, not repaired. */
export function parseAlertJobs(output: unknown, text: string, links: string[]): AlertJob[] {
  const jobs = (output as { jobs?: unknown } | null)?.jobs;
  if (!Array.isArray(jobs)) throw new ValidationError("No jobs were returned.");
  return (jobs as Record<string, unknown>[]).slice(0, MAX_JOBS).flatMap((j) => {
    const title = str(j?.title);
    const company = str(j?.company);
    const sourceUrl = links[j?.link as number];
    if (!title || !company || !sourceUrl || title.length > MAX_FIELD_CHARS || company.length > MAX_FIELD_CHARS) return [];
    if (!isSafeName(title) || !isSafeName(company) || !copiedFrom(title, text) || !copiedFrom(company, text)) return [];
    const location = str(j.location);
    const salary = str(j.salary);
    return [{ title, company, sourceUrl, location: location && copiedFrom(location, text) ? location : null, salary: salary && salaryCopiedFrom(salary, text) ? salary : NOT_STATED }];
  });
}

export async function extractAlertJobs(opts: {
  auth: Auth;
  model: string;
  html: string;
  signal?: AbortSignal;
}): Promise<{ jobs: AlertJob[]; usage: Usage; listCostUsd: number }> {
  const { system } = loadPrompt("alerts");
  const { text, links } = emailForPrompt(opts.html);
  const res = await askClaude({
    auth: opts.auth,
    model: opts.model,
    system,
    prompt: `${wrapUntrusted("email", text)}\n\nList every job in this email.`,
    schema: SCHEMA,
    tool: { name: "submit_jobs", description: "Submit the jobs in the email." },
    maxTokens: 3000,
    signal: opts.signal,
  });
  return { jobs: parseAlertJobs(res.output, text, links), usage: res.usage, listCostUsd: res.listCostUsd };
}
