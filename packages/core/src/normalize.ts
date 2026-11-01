// Dedupe keys from the TeamHero rule: canonical URL + normalized company and title.
// Moves to packages/ats in M2; lives here so the stub Scout can dedupe in M0.

/**
 * https, lowercase host, no query, no fragment, no trailing slash.
 * Greenhouse, Lever and Ashby identify the job in the path, so any query string is
 * tracking (utm_*, gh_src, lever-source…) or UI state and is dropped entirely.
 */
export function canonicalUrl(raw: string): string {
  const u = new URL(raw.trim());
  const host = u.host.toLowerCase().replace(/^www\./, "");
  let path = u.pathname.replace(/\/+$/, "");
  if (path === "") path = "/";
  return `https://${host}${path}`;
}

export function atsFromUrl(raw: string): "greenhouse" | "lever" | "ashby" | null {
  const { hostname } = new URL(raw);
  if (hostname === "greenhouse.io" || hostname.endsWith(".greenhouse.io")) return "greenhouse";
  if (hostname === "jobs.lever.co") return "lever";
  if (hostname === "jobs.ashbyhq.com") return "ashby";
  return null;
}

/** Greenhouse embeds and company-hosted boards name the job in the query, not the path. */
const GREENHOUSE_JOB_PARAM = /^(token|gh_jid)$/;

const TRACKING_PARAM = /^(utm_.*|gclid|fbclid|msclkid|trk|refid)$/i;

/**
 * canonicalUrl for a link pasted by the owner. Outside the known ATSs the query can be
 * the only thing that identifies the job (?jk=…), so it stays, minus tracking.
 */
export function canonicalManualUrl(raw: string): string {
  const base = canonicalUrl(raw);
  const ats = atsFromUrl(raw);
  if (ats === "lever" || ats === "ashby") return base;
  const params = [...new URL(raw).searchParams]
    .filter(([key]) => (ats === "greenhouse" ? GREENHOUSE_JOB_PARAM.test(key) : !TRACKING_PARAM.test(key)))
    .sort(([a], [b]) => a.localeCompare(b));
  return params.length ? `${base}?${new URLSearchParams(params)}` : base;
}

const LEGAL_SUFFIX =
  /\b(incorporated|inc|llc|l\.l\.c|ltd|limited|gmbh|ag|se|kg|sa|sas|sarl|srl|spa|s\.a|s\.l|sl|bv|b\.v|nv|plc|oy|ab|as|co|corp|corporation|company)\.?$/i;

export function normalizeCompany(name: string): string {
  let s = name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  s = s.replace(/[,.]+$/g, "").trim();
  // strip one or more trailing legal suffixes ("Foo GmbH & Co. KG" stays readable enough)
  for (let i = 0; i < 3; i++) {
    const next = s.replace(LEGAL_SUFFIX, "").replace(/[\s,.&]+$/g, "").trim();
    if (next === s || next === "") break;
    s = next;
  }
  return s.replace(/\s+/g, " ");
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)|\[.*?\]/g, " ") // "(m/f/d)", "[Remote]"
    .replace(/\bsr\.?(?=\s|$)/g, "senior")
    .replace(/\bjr\.?(?=\s|$)/g, "junior")
    .replace(/[^a-z0-9+#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The wordings that mean exactly one saved answer. Matching is exact on purpose: a wrong match puts a
 * false statement on an application, while a miss only raises a Blocker. Near-misses must stay out:
 * "years of experience with Python" isn't total years, and "authorized to work in Germany" isn't the
 * same answer as the United States. The map grows in M4.
 */
const QUESTION_PHRASES: Record<string, string[]> = {
  start_date: ["what is your notice period", "notice period", "when can you start", "earliest start date", "availability to start", "start date", "desired start date", "preferred start date", "available start date"],
  visa_sponsorship: ["will you now or in the future require visa sponsorship", "will you now or in the future require sponsorship", "do you require sponsorship", "do you require visa sponsorship", "do you need sponsorship", "do you need visa sponsorship", "visa sponsorship"],
  work_authorization: ["are you legally authorized to work in this country", "are you legally authorised to work in this country", "are you legally authorized to work here", "are you authorized to work in this country", "work authorization", "work authorisation", "work authorization status", "right to work"],
  salary_expectation: ["what are your salary expectations", "salary expectations", "expected salary", "desired salary", "desired compensation", "compensation expectations"],
  years_experience: ["how many years of professional experience do you have", "how many years of experience do you have", "years of experience", "years of professional experience"],
  relocation: ["are you open to relocation", "are you willing to relocate", "willing to relocate", "open to relocation"],
  how_did_you_hear: ["how did you hear about this position", "how did you hear about this job", "how did you hear about us", "where did you find this job", "source"],
  why_this_company: ["why do you want to work at this company", "why do you want to work here", "why are you interested in this role", "why this company", "why us"],
  data_consent: ["i consent to the processing of my personal data for this application", "data processing consent", "privacy policy consent"],
  pronouns: ["what are your pronouns", "pronouns", "preferred pronouns"],
  linkedin: ["linkedin profile url", "linkedin profile", "linkedin url", "linkedin"],
  website: ["portfolio or website url", "portfolio url", "portfolio", "website url", "website", "personal website url", "personal website"],
};
const KEY_BY_PHRASE = new Map(Object.entries(QUESTION_PHRASES).flatMap(([key, phrases]) => phrases.map((p) => [p, key] as const)));

const MAX_KEY_CHARS = 80;

/** FNV-1a. This file also runs in the browser, so no node:crypto. */
function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Normalized AnswerBank key for a form question. Long questions keep a hash, so a shared opening never merges them. */
export function questionKey(question: string): string {
  const q = question.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const known = KEY_BY_PHRASE.get(q);
  if (known) return known;
  const slug = q.replace(/ /g, "_");
  return slug.length <= MAX_KEY_CHARS ? slug : `${slug.slice(0, MAX_KEY_CHARS - 9)}_${shortHash(q)}`;
}
