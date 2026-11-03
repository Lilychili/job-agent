/// <reference lib="dom" />
// Lever's apply page is server-rendered HTML with stable field names: name, email, phone, location,
// org, urls[...], resume, comments ("Additional information"). Custom questions come in cards whose
// hidden `cards[<id>][baseTemplate]` input holds the questions as JSON, answered in `cards[<id>][field<i>]`.
// The page posts the form back to its own /apply URL; that POST is the submit.
import type { Page, Request } from "playwright";
import { inPage } from "./page";
import type { FieldKind, FormAdapter, FormField, StandardField } from "./types";

const HOSTS = new Set(["jobs.lever.co", "jobs.eu.lever.co"]);

const STANDARD: Record<string, StandardField> = {
  name: "name",
  email: "email",
  phone: "phone",
  location: "location",
  org: "currentCompany",
  "urls[LinkedIn]": "linkedin",
  "urls[GitHub]": "github",
  "urls[Twitter]": "twitter",
  "urls[Portfolio]": "website",
  resume: "resume",
  comments: "coverLetterText",
};

const CARD_KINDS: Record<string, FieldKind> = {
  text: "text",
  textarea: "textarea",
  "multiple-choice": "choice",
  "multiple-select": "multi",
  dropdown: "select",
};

/** Inputs Lever fills itself or that only its scripts touch. */
const IGNORED = ["selectedLocation", "h-captcha-response", "resumeStorageId", "linkedInData", "accountId", "timezone", "origin", "referer", "source", "socialSource", "socialReferralKey"];

const byName = (id: string) => `[name="${id.replace(/["\\]/g, "\\$&")}"]`;

export const lever: FormAdapter = {
  ats: "lever",

  applyUrl(postingUrl) {
    let url: URL;
    try {
      url = new URL(postingUrl);
    } catch {
      return null;
    }
    if (url.protocol !== "https:" || !HOSTS.has(url.hostname)) return null;
    const m = /^\/([\w.-]+)\/([\w-]+)(?:\/apply)?\/?$/.exec(url.pathname);
    return m ? `https://${url.hostname}/${m[1]}/${m[2]}/apply` : null;
  },

  isSubmit(req: Request) {
    return req.method() !== "GET" && /\/apply\/?$/.test(new URL(req.url()).pathname);
  },

  listFields(page: Page) {
    return inPage(page, readLeverForm, { standard: STANDARD, cardKinds: CARD_KINDS, ignored: IGNORED });
  },

  async fill(page, field, value) {
    const values = Array.isArray(value) ? value : [value];
    const sel = byName(field.id);
    switch (field.kind) {
      case "choice":
      case "multi":
        for (const v of values) await page.locator(`input${sel}`).and(page.locator(`[value="${v.replace(/["\\]/g, "\\$&")}"]`)).check();
        return;
      case "select":
        await page.locator(`select${sel}`).selectOption(values[0]!);
        return;
      default:
        await page.locator(sel).first().fill(values.join(", "));
    }
  },

  async upload(page, field, filePath) {
    await page.locator(`input[type="file"]${byName(field.id)}`).setInputFiles(filePath);
  },

  async afterUpload(page) {
    // Lever reads the CV and fills name, email and so on itself; let it finish so ours win.
    await page.waitForTimeout(500);
    await page.locator(".resume-upload-working").first().waitFor({ state: "hidden", timeout: 20_000 }).catch(() => {});
  },
};

/** Runs in the page. Reads the form into FormFields; must not reference anything outside itself. */
function readLeverForm(args: { standard: Record<string, StandardField>; cardKinds: Record<string, FieldKind>; ignored: string[] }): FormField[] {
  const form = document.querySelector("#application-form") ?? document;
  const clean = (s: string | null | undefined) => (s ?? "").replace(/✱/g, "").replace(/\s+/g, " ").trim();
  const q = (name: string) => form.querySelectorAll<HTMLInputElement>(`[name="${name.replace(/["\\]/g, "\\$&")}"]`);
  const labelOf = (el: Element) => {
    const li = el.closest("li.application-question");
    const text = li?.querySelector(".application-label .text, .application-label");
    if (text) return clean(text.textContent);
    if (el.id) {
      const label = form.querySelector(`label[for="${el.id}"]`);
      if (label) return clean(label.textContent);
    }
    return clean(el.closest("label")?.textContent) || (el as HTMLInputElement).name;
  };
  const isRequired = (el: Element) =>
    (el as HTMLInputElement).required || !!el.closest("li.application-question")?.querySelector(".application-label .required");

  const fields: FormField[] = [];
  const seen = new Set<string>(args.ignored);

  for (const tpl of Array.from(form.querySelectorAll<HTMLInputElement>('input[name$="[baseTemplate]"]'))) {
    seen.add(tpl.name);
    const card = tpl.name.slice(0, -"[baseTemplate]".length);
    let template: { fields?: { type?: string; text?: string; required?: boolean; options?: { text?: string }[] }[] };
    try {
      template = JSON.parse(tpl.value);
    } catch {
      continue;
    }
    (template.fields ?? []).forEach((f, i) => {
      const id = `${card}[field${i}]`;
      if (!q(id).length) return;
      seen.add(id);
      const options = (f.options ?? []).map((o) => clean(o.text)).filter(Boolean);
      fields.push({
        id,
        label: clean(f.text),
        kind: args.cardKinds[f.type ?? ""] ?? "other",
        required: !!f.required,
        ...(options.length ? { options } : {}),
      });
    });
  }

  const elements = Array.from(form.querySelectorAll<HTMLInputElement>("input[name], select[name], textarea[name]"));
  for (const el of elements) {
    const name = el.name;
    if (seen.has(name) || name.startsWith("cards[")) continue;
    const type = el.tagName === "INPUT" ? el.type : el.tagName.toLowerCase();
    if (["hidden", "submit", "button", "image", "reset"].includes(type)) continue;
    seen.add(name);
    const standard = args.standard[name];
    let kind: FieldKind = type === "textarea" ? "textarea" : type === "file" ? "file" : type === "select" ? "select" : "text";
    let options: string[] = [];
    if (type === "radio" || type === "checkbox") {
      kind = type === "radio" ? "choice" : "multi";
      options = Array.from(q(name)).map((o) => o.value);
    } else if (type === "select") {
      options = Array.from((el as unknown as HTMLSelectElement).options).filter((o) => o.value).map((o) => clean(o.textContent));
    }
    fields.push({
      id: name,
      label: labelOf(el),
      kind,
      required: Array.from(q(name)).some(isRequired),
      ...(options.length ? { options } : {}),
      ...(standard ? { standard } : {}),
    });
  }
  return fields;
}
