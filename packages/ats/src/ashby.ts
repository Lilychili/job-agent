import { htmlToText } from "./text";
import { companyFromToken, type Posting, type Remote } from "./types";
import { isWebLink } from "./url";

export interface AshbyJob {
  title?: string;
  jobUrl?: string;
  location?: string;
  secondaryLocations?: { location?: string }[];
  isListed?: boolean;
  isRemote?: boolean;
  workplaceType?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
  compensation?: { scrapeableCompensationSalarySummary?: string | null };
}

const WORKPLACE: Record<string, Remote> = { Remote: "remote", Hybrid: "hybrid", OnSite: "onsite" };

export function ashbyPostings(boardToken: string, jobs: AshbyJob[]): Posting[] {
  return jobs.flatMap((j) => {
    if (!j.title || !j.jobUrl || !isWebLink(j.jobUrl) || j.isListed === false) return [];
    const location = j.location?.trim() || null;
    const salary = j.compensation?.scrapeableCompensationSalarySummary?.trim() || "not stated";
    const description = j.descriptionPlain?.trim() || htmlToText(j.descriptionHtml ?? "");
    return {
      ats: "ashby" as const,
      sourceUrl: j.jobUrl,
      company: companyFromToken(boardToken),
      title: j.title.trim(),
      location,
      locations: [...new Set([location, ...(j.secondaryLocations ?? []).map((l) => l.location)].filter((l): l is string => !!l))],
      remote: WORKPLACE[j.workplaceType ?? ""] ?? (j.isRemote ? "remote" : "unknown"),
      salary,
      text: salary === "not stated" ? description : `${description}\n\nSalary: ${salary}`,
    };
  });
}
