import { htmlToText, remoteFromLocation } from "./text";
import { companyFromToken, type Posting } from "./types";
import { isWebLink } from "./url";

export interface GreenhouseJob {
  title?: string;
  absolute_url?: string;
  company_name?: string;
  location?: { name?: string };
  content?: string;
}

export function greenhousePostings(boardToken: string, jobs: GreenhouseJob[]): Posting[] {
  return jobs.flatMap((j) => {
    if (!j.title || !j.absolute_url || !isWebLink(j.absolute_url)) return [];
    const location = j.location?.name?.trim() || null;
    return {
      ats: "greenhouse" as const,
      sourceUrl: j.absolute_url,
      company: j.company_name?.trim() || companyFromToken(boardToken),
      title: j.title.trim(),
      location,
      locations: location ? [location] : [],
      remote: location ? remoteFromLocation(location) : "unknown",
      salary: "not stated",
      text: htmlToText(j.content ?? ""),
    };
  });
}
