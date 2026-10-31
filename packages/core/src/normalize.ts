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

/** Normalized AnswerBank key for a form question. Synonym map grows in M4. */
const QUESTION_SYNONYMS: [RegExp, string][] = [
  [/notice period|when can you start|earliest start|start date|availability to start/, "start_date"],
  [/salary|compensation expectation|expected pay/, "salary_expectation"],
  [/visa|work authori[sz]ation|right to work|sponsorship/, "work_authorization"],
  [/years of (professional )?experience/, "years_experience"],
  [/relocat/, "relocation"],
  [/how did you hear|where did you (hear|find)/, "how_did_you_hear"],
  [/why (do you want to work|are you interested|this company|us)/, "why_this_company"],
];

export function questionKey(question: string): string {
  const q = question.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  for (const [re, key] of QUESTION_SYNONYMS) if (re.test(q)) return key;
  return q.replace(/ /g, "_").slice(0, 80);
}
