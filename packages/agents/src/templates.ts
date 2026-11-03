// The CV and cover letter as HTML, ready to print. Claude's words are escaped here, and the contact
// details, role titles, employers and dates come straight from the Profile.
import type { Contact, CvContent, FactKind, LetterContent, ProfileFact } from "@jobagent/db";

const STYLE = `
  @page { size: A4; margin: 18mm 18mm 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 10.5pt/1.45 Arial, Helvetica, sans-serif; color: #1a1a1a; }
  h1 { margin: 0; font-size: 20pt; font-weight: 700; }
  h2 { margin: 14pt 0 5pt; padding-bottom: 2pt; border-bottom: 1px solid #999; font-size: 10.5pt; letter-spacing: .06em; text-transform: uppercase; }
  h3 { margin: 8pt 0 2pt; font-size: 10.5pt; display: flex; justify-content: space-between; gap: 12pt; }
  p { margin: 0 0 6pt; }
  ul { margin: 0 0 4pt; padding-left: 14pt; }
  li { margin-bottom: 2pt; }
  .contact { color: #444; font-size: 9.5pt; }
  .dates { flex: none; font-weight: 400; color: #444; }
  .letter p { margin-bottom: 10pt; }
  .letter .contact { margin-bottom: 24pt; }
`;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
}

function header({ name, email, phone, location, links }: Contact): string {
  const contact = [email, phone, location, ...(links ?? [])].filter(Boolean).map((s) => escapeHtml(s!)).join(" · ");
  return `<h1>${escapeHtml(name)}</h1><p class="contact">${contact}</p>`;
}

const dates = ({ startDate, endDate }: ProfileFact) => (startDate ? `${startDate} – ${endDate ?? "present"}` : (endDate ?? ""));

function section(title: string, body: string): string {
  return body ? `<h2>${title}</h2>${body}` : "";
}

// Standard headings, one column, dates after the title they belong to: applicant tracking systems read
// the PDF as plain text, in this order.
export function cvHtml(content: CvContent, contact: Contact, facts: ProfileFact[]): string {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const fact = (id: string) => byId.get(id)!;
  const experience = content.experience
    .map(({ roleFactId, bullets }) => {
      const r = fact(roleFactId);
      const heading = [r.text, r.org].filter(Boolean).join(", ");
      const items = bullets.map((b) => `<li>${escapeHtml(b.text)}</li>`).join("");
      return `<h3><span>${escapeHtml(heading)}</span><span class="dates">${escapeHtml(dates(r))}</span></h3>${items ? `<ul>${items}</ul>` : ""}`;
    })
    .join("");
  const listed = (kinds: FactKind[]) => {
    const items = content.otherFactIds
      .map(fact)
      .filter((f) => kinds.includes(f.kind))
      .map((f) => `<li>${escapeHtml([f.text, f.org, dates(f)].filter(Boolean).join(", "))}</li>`)
      .join("");
    return items ? `<ul>${items}</ul>` : "";
  };
  return page(`${contact.name} CV`, [
    header(contact),
    section("Summary", `<p>${escapeHtml(content.summary.text)}</p>`),
    section("Work Experience", experience),
    section("Skills", content.skills.length ? `<p>${content.skills.map((s) => escapeHtml(s.text)).join(" · ")}</p>` : ""),
    section("Education", listed(["education"])),
    section("Certifications", listed(["cert"])),
    section("Languages", listed(["language"])),
  ].join(""));
}

/** The letter as plain text, for forms that take it in a text box (Lever's "Additional information"). */
export function letterText(content: LetterContent, contact: Contact): string {
  return [content.greeting, ...content.paragraphs.map((p) => p.text), content.closing, contact.name].map((s) => s.trim()).filter(Boolean).join("\n\n");
}

export function letterHtml(content: LetterContent, contact: Contact): string {
  const paragraphs = content.paragraphs.map((p) => `<p>${escapeHtml(p.text)}</p>`).join("");
  return page(`${contact.name} cover letter`, `<div class="letter">${header(contact)}<p>${escapeHtml(content.greeting)}</p>${paragraphs}<p>${escapeHtml(content.closing)}</p><p>${escapeHtml(contact.name)}</p></div>`);
}
