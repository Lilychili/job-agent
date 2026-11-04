// The CV and cover letter as HTML, ready to print. Claude's words are escaped here, and the contact
// details, role titles, employers and dates come straight from the Profile.
import type { Contact, CvContent, DocumentStyle, FactKind, LetterContent, ProfileFact } from "@jobagent/db";

// Inter is embedded when the page is printed (pdf.ts); the fallbacks only show in a plain browser.
const STYLE = `
  @page { size: A4; margin: 16mm 18mm 15mm; }
  * { box-sizing: border-box; }
  :root { --accent: #1f5c99; --ink: #1d2126; --soft: #5b6470; --rule: #d9dee4; --dot: #a3acb8; }
  body[data-style="mono"] { --accent: #1d2126; }
  body {
    margin: 0; color: var(--ink); font: 400 9.8pt/1.5 "Inter", "Helvetica Neue", Arial, sans-serif;
    -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
  }
  h1 { margin: 0; font-size: 23pt; line-height: 1.1; font-weight: 700; letter-spacing: -0.022em; }
  .headline { margin: 3pt 0 0; font-size: 11pt; font-weight: 500; color: var(--accent); }
  body[data-style="mono"] .headline { color: var(--soft); }
  .contact { margin: 6pt 0 0; font-size: 8.8pt; color: var(--soft); }
  .sep { color: var(--rule); padding: 0 5pt; }
  h2 {
    margin: 15pt 0 7pt; padding-bottom: 3pt; border-bottom: 0.75pt solid var(--rule);
    font-size: 8.4pt; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent);
  }
  p { margin: 0 0 5pt; }
  .entry { margin: 0 0 7pt; break-inside: avoid-page; }
  .entry-head { display: flex; justify-content: space-between; align-items: baseline; gap: 14pt; margin-bottom: 2pt; }
  .entry-head .what { font-weight: 600; }
  .org { font-weight: 400; color: var(--accent); }
  body[data-style="mono"] .org { color: var(--ink); }
  .dates { flex: none; font-size: 8.6pt; color: var(--soft); font-variant-numeric: tabular-nums; }
  ul { margin: 0; padding: 0; list-style: none; }
  /* No positioning here: positioned boxes are printed last, and text readers would see every bullet at the end. */
  li { padding-left: 11pt; margin-bottom: 2.5pt; }
  li::before { content: ""; display: inline-block; width: 3.2pt; height: 3.2pt; margin: 0 5.4pt 0 -8.6pt; border-radius: 50%; background: var(--dot); vertical-align: 0.22em; }
  .skills { line-height: 1.7; }
  .skill { white-space: nowrap; }
  .skills .sep { padding: 0 2pt; }
  .plain .what { font-weight: 400; }
  .letter { font-size: 10.2pt; line-height: 1.62; }
  .letter header { padding-bottom: 12pt; margin-bottom: 26pt; border-bottom: 0.75pt solid var(--rule); }
  .letter p { margin-bottom: 11pt; }
  .letter .sign { margin-top: 18pt; font-weight: 600; }
`;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(title: string, style: DocumentStyle, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body data-style="${style}">${body}</body></html>`;
}

// The separators are real characters, so a tracking system reading the text still sees them apart.
function header({ name, email, phone, location, links }: Contact, headline?: string): string {
  // Links read better bare, as on a printed CV: "linkedin.com/in/you", not "https://linkedin.com/in/you/".
  const bare = (link: string) => link.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
  const contact = [location, phone, email, ...(links ?? []).map(bare)]
    .filter(Boolean)
    .map((s) => escapeHtml(s!))
    .join(`<span class="sep">|</span>`);
  return `<header><h1>${escapeHtml(name)}</h1>${headline ? `<p class="headline">${escapeHtml(headline)}</p>` : ""}<p class="contact">${contact}</p></header>`;
}

const dates = ({ startDate, endDate }: ProfileFact) => (startDate ? `${startDate} – ${endDate || "present"}` : (endDate ?? ""));

function section(title: string, body: string): string {
  return body ? `<section><h2>${title}</h2>${body}</section>` : "";
}

/** "Title · Organisation" on the left, the dates on the right. */
function entryHead(f: ProfileFact): string {
  const org = f.org ? ` · <span class="org">${escapeHtml(f.org)}</span>` : "";
  const when = dates(f);
  return `<div class="entry-head"><span class="what">${escapeHtml(f.text)}${org}</span>${when ? `<span class="dates">${escapeHtml(when)}</span>` : ""}</div>`;
}

// Standard headings, one column, dates after the title they belong to: applicant tracking systems read
// the PDF as plain text, in this order.
export function cvHtml(content: CvContent, contact: Contact, facts: ProfileFact[], style: DocumentStyle = "color"): string {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const fact = (id: string) => byId.get(id)!;
  const experience = content.experience
    .map(({ roleFactId, bullets }) => {
      const items = bullets.map((b) => `<li>${escapeHtml(b.text)}</li>`).join("");
      return `<div class="entry">${entryHead(fact(roleFactId))}${items ? `<ul>${items}</ul>` : ""}</div>`;
    })
    .join("");
  // Education leads with the degree in bold; certifications and languages are plain lines.
  const listed = (kinds: FactKind[], plain = false) =>
    content.otherFactIds
      .map(fact)
      .filter((f) => kinds.includes(f.kind))
      .map((f) => `<div class="entry${plain ? " plain" : ""}">${entryHead(f)}</div>`)
      .join("");
  // The newest role the CV shows, under the name: a fact from the Profile, never a made-up title.
  const first = content.experience[0];
  const headline = first ? byId.get(first.roleFactId)?.text : undefined;
  return page(`${contact.name} CV`, style, [
    header(contact, headline),
    section("Summary", `<p>${escapeHtml(content.summary.text)}</p>`),
    section("Work Experience", experience),
    section("Skills", content.skills.length ? `<p class="skills">${content.skills.map((s) => `<span class="skill">${escapeHtml(s.text)}</span>`).join(`<span class="sep"> · </span>`)}</p>` : ""),
    section("Education", listed(["education"])),
    section("Certifications", listed(["cert"], true)),
    section("Languages", listed(["language"], true)),
  ].join(""));
}

/** The letter as plain text, for forms that take it in a text box (Lever's "Additional information"). */
export function letterText(content: LetterContent, contact: Contact): string {
  return [content.greeting, ...content.paragraphs.map((p) => p.text), content.closing, contact.name].map((s) => s.trim()).filter(Boolean).join("\n\n");
}

export function letterHtml(content: LetterContent, contact: Contact, style: DocumentStyle = "color"): string {
  const paragraphs = content.paragraphs.map((p) => `<p>${escapeHtml(p.text)}</p>`).join("");
  return page(
    `${contact.name} cover letter`,
    style,
    `<div class="letter">${header(contact)}<p>${escapeHtml(content.greeting)}</p>${paragraphs}<p>${escapeHtml(content.closing)}</p><p class="sign">${escapeHtml(contact.name)}</p></div>`,
  );
}
