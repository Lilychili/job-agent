/// <reference lib="dom" />
// Greenhouse's hosted form (job-boards.greenhouse.io/<token>/jobs/<id>) is a React app. Inputs are keyed
// by id, not name: first_name, last_name, email, phone, country, resume, cover_letter, question_<n>,
// and demographic ids (gender, veteran_status...). Dropdowns are react-select comboboxes whose options
// only exist once the menu is open, in #react-select-<id>-listbox. Links (LinkedIn, Website) are custom
// questions known only by their label. The page's script POSTs the application as JSON to
// boards.greenhouse.io/<token>/jobs/<id>, another host than the page; that POST is the submit.
import type { Locator, Page, Request } from "playwright";
import { inPage } from "./page";
import { standardFromLabel } from "./plan";
import type { FormAdapter, FormField, StandardField } from "./types";

const HOST = /^(job-boards|boards)(\.eu)?\.greenhouse\.io$/;

const STANDARD: Record<string, StandardField> = {
  first_name: "firstName",
  last_name: "lastName",
  email: "email",
  phone: "phone",
  country: "country",
  resume: "resume",
};

/** Alternatives to an upload that only appear after "Enter manually"; the approved file goes in instead. */
const IGNORED = ["resume_text", "cover_letter_text"];

const byId = (page: Page, id: string) => page.locator(`[id="${id.replace(/["\\]/g, "\\$&")}"]`);
const listbox = (page: Page, id: string) => byId(page, `react-select-${id}-listbox`);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const greenhouse: FormAdapter = {
  ats: "greenhouse",

  applyUrl(postingUrl) {
    let url: URL;
    try {
      url = new URL(postingUrl);
    } catch {
      return null;
    }
    const host = HOST.exec(url.hostname);
    if (url.protocol !== "https:" || !host) return null;
    const base = `https://job-boards${host[2] ?? ""}.greenhouse.io`;
    const m = /^\/([\w.%-]+)\/jobs\/(\d+)\/?$/.exec(url.pathname);
    if (m) return `${base}/${m[1]}/jobs/${m[2]}`;
    // The form a company page embeds: /embed/job_app?for=<token>&token=<id>.
    const token = url.searchParams.get("for");
    const id = url.searchParams.get("token");
    if (/^\/embed\/job_app\/?$/.test(url.pathname) && token && /^[\w.-]+$/.test(token) && id && /^\d+$/.test(id)) return `${base}/${token}/jobs/${id}`;
    return null;
  },

  isSubmit(req: Request) {
    if (req.method() === "GET") return false;
    const path = new URL(req.url()).pathname;
    return /^\/[^/]+\/jobs\/\d+\/?$/.test(path) || /^\/embed\/job_app\/?$/.test(path);
  },

  async listFields(page) {
    await page.locator("#application-form").waitFor({ timeout: 20_000 });
    const raw = await inPage(page, readGreenhouseForm, { standard: STANDARD, ignored: IGNORED });
    const fields: FormField[] = [];
    for (const f of raw) {
      if (f.combobox) {
        const menu = await readMenu(page, f.field.id);
        // A combobox with nothing to pick until you type (a city search) is left for the owner.
        fields.push({ ...f.field, kind: menu.options.length ? (menu.multi ? "multi" : "select") : "other", ...(menu.options.length ? { options: menu.options } : {}) });
      } else {
        const standard = f.field.standard ?? (f.field.kind === "text" ? standardFromLabel(f.field.label) : undefined);
        fields.push({ ...f.field, ...(standard ? { standard } : {}) });
      }
    }
    return fields;
  },

  async fill(page, field, value) {
    const values = Array.isArray(value) ? value : [value];
    if (field.kind !== "select" && field.kind !== "multi") {
      await byId(page, field.id).fill(values.join(", "));
      return;
    }
    for (const v of values) await pick(page, field.id, v);
    await page.keyboard.press("Escape");
  },

  async upload(page, field, filePath) {
    await byId(page, field.id).setInputFiles(filePath);
  },

  async afterUpload(page) {
    // Greenhouse doesn't read the CV into fields; just let it show the attached file.
    await page.waitForTimeout(500);
  },
};

/**
 * Open a combobox's menu, read its options, close it. The form is server-rendered, so the inputs exist
 * before React is listening; a click that early does nothing, hence the retries.
 */
async function readMenu(page: Page, id: string): Promise<{ options: string[]; multi: boolean }> {
  const input = byId(page, id);
  const list = listbox(page, id);
  let opened = false;
  for (let i = 0; i < 4 && !opened; i++) {
    await input.scrollIntoViewIfNeeded();
    await input.click();
    opened = await list.waitFor({ timeout: 1_500 }).then(
      () => true,
      () => false,
    );
  }
  const result = opened
    ? {
        options: (await list.locator('[role="option"]').allTextContents()).map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean),
        multi: (await list.getAttribute("aria-multiselectable")) === "true",
      }
    : { options: [], multi: false };
  await page.keyboard.press("Escape");
  await input.blur();
  return result;
}

/** Choose one option of a combobox by its exact text, and check the form took it. */
async function pick(page: Page, id: string, value: string): Promise<void> {
  const input = byId(page, id);
  await input.scrollIntoViewIfNeeded();
  const list = listbox(page, id);
  if (!(await list.isVisible())) await input.click();
  const option = (l: Locator) => l.locator('[role="option"]').filter({ hasText: new RegExp(`^\\s*${escapeRe(value)}\\s*$`) });
  if (!(await option(list).count())) await input.fill(value); // long lists (countries): filter first
  await option(list).first().click({ timeout: 5_000 });
  const control = input.locator("xpath=ancestor::*[contains(@class,'select__control')][1]");
  // The chosen value may show only part of the option: the phone country "Spain +34" shows "+34".
  const chosen = (await control.locator(".select__single-value, .select__multi-value__label").allTextContents()).map((t) => t.replace(/\s+/g, " ").trim());
  if (!chosen.some((t) => t && (t === value || value.endsWith(` ${t}`)))) throw new Error(`The form didn't take "${value}".`);
}

interface RawField {
  field: FormField;
  combobox: boolean;
}

/** Runs in the page. Reads the form into FormFields; must not reference anything outside itself. */
function readGreenhouseForm(args: { standard: Record<string, StandardField>; ignored: string[] }): RawField[] {
  const form = document.querySelector("#application-form") ?? document;
  const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").replace(/\s*\*$/, "").trim();
  const textOf = (id: string | null) => {
    if (!id) return "";
    const el = document.getElementById(id);
    if (!el) return "";
    const copy = el.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('[aria-hidden="true"], .required').forEach((n) => n.remove());
    return clean(copy.textContent);
  };
  const group = (el: Element) => el.closest('[role="group"][aria-labelledby]');
  const labelOf = (el: HTMLElement) => {
    const g = el.getAttribute("type") === "file" ? group(el) : null;
    if (g) return textOf(g.getAttribute("aria-labelledby"));
    const by = el.getAttribute("aria-labelledby");
    if (by) return by.split(/\s+/).map(textOf).filter(Boolean).join(" ");
    const label = form.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    return label ? textOf(label.id || null) || clean(label.textContent) : el.id;
  };
  const isRequired = (el: HTMLElement) =>
    (el as HTMLInputElement).required || el.getAttribute("aria-required") === "true" || group(el)?.getAttribute("aria-required") === "true";

  const out: RawField[] = [];
  const seen = new Set(args.ignored);
  for (const el of Array.from(form.querySelectorAll<HTMLElement>("input[id], select[id], textarea[id]"))) {
    const id = el.id;
    if (seen.has(id)) continue;
    const type = el.tagName === "INPUT" ? (el as HTMLInputElement).type : el.tagName.toLowerCase();
    if (["hidden", "submit", "button", "image", "reset"].includes(type)) continue;
    seen.add(id);
    const combobox = el.getAttribute("role") === "combobox";
    const standard = args.standard[id];
    // Boxes and native selects aren't how Greenhouse asks questions today; list them for the owner to fill.
    const kind = combobox ? "select" : type === "textarea" ? "textarea" : type === "file" ? "file" : ["text", "email", "tel", "url", "number"].includes(type) ? "text" : "other";
    out.push({
      combobox,
      field: {
        id,
        label: labelOf(el),
        kind,
        required: isRequired(el),
        ...(standard ? { standard } : {}),
      },
    });
  }
  return out;
}
