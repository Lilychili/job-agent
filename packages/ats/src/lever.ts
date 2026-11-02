import { htmlToText, remoteFromLocation } from "./text";
import { companyFromToken, type Posting, type Remote } from "./types";

export interface LeverPosting {
  text?: string;
  hostedUrl?: string;
  workplaceType?: string;
  categories?: { location?: string; allLocations?: string[] };
  descriptionPlain?: string;
  lists?: { text?: string; content?: string }[];
  additionalPlain?: string;
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string };
  salaryDescriptionPlain?: string;
}

const WORKPLACE: Record<string, Remote> = { onsite: "onsite", hybrid: "hybrid", remote: "remote" };

function salaryOf({ salaryRange: r }: LeverPosting): string {
  if (!r?.currency || r.min === undefined || r.max === undefined) return "not stated";
  const range = r.min === r.max ? `${r.min}` : `${r.min} - ${r.max}`;
  return `${r.currency} ${range}${r.interval ? ` ${r.interval.replaceAll("-", " ")}` : ""}`;
}

function textOf(p: LeverPosting, salary: string): string {
  const lists = (p.lists ?? []).map((l) => `${l.text ?? ""}\n${htmlToText(l.content ?? "")}`);
  return [p.descriptionPlain, ...lists, p.additionalPlain, p.salaryDescriptionPlain, salary === "not stated" ? "" : `Salary: ${salary}`]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join("\n\n");
}

export function leverPostings(boardToken: string, postings: LeverPosting[]): Posting[] {
  return postings.flatMap((p) => {
    if (!p.text || !p.hostedUrl) return [];
    const location = p.categories?.location?.trim() || null;
    const salary = salaryOf(p);
    return {
      ats: "lever" as const,
      sourceUrl: p.hostedUrl,
      company: companyFromToken(boardToken),
      title: p.text.trim(),
      location,
      locations: [...new Set([location, ...(p.categories?.allLocations ?? [])].filter((l): l is string => !!l))],
      remote: WORKPLACE[p.workplaceType ?? ""] ?? (location ? remoteFromLocation(location) : "unknown"),
      salary,
      text: textOf(p, salary),
    };
  });
}
