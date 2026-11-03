// A tab on one application form, in the Shipper's one browser window. The safety rules live here, in code:
// - while the agent drives, the tab (and any popup it opens) can't leave the form's host and the submit
//   request is blocked;
// - every upload re-checks the approved file's sha256 right before it is attached;
// - there is no submit method. Handing over lifts the blocks so the owner can submit by hand.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { chromium, type BrowserContext, type Page, type Route, type Request } from "playwright";
import type { ApprovedFile, FormAdapter, FormField, SourcedValue } from "./types";

export interface OpenOptions {
  /** Show the window. The owner submits in it, so the worker runs headed; tests don't. */
  headless?: boolean;
  /** Keep cookies (consent banners, sign-ins) here between runs. Without it the browser forgets on close. */
  profileDir?: string;
  /** Called with each request the session blocked, for the run log. */
  onBlocked?: (what: string) => void;
}

export interface Filled {
  fieldId: string;
  label: string;
  source: SourcedValue["source"];
}

export class HashMismatchError extends Error {
  constructor(file: string) {
    super(`The approved file changed since it was approved: ${file}. Regenerate and approve it again.`);
    this.name = "HashMismatchError";
  }
}

// ─── The one browser ────────────────────────────────────────────────────────

let shared: { key: string; context: Promise<BrowserContext> } | null = null;
const sessions = new WeakMap<Page, FormSession>();
/** Forms the agent is filling right now, for requests that can't be traced to a tab. */
const driving = new Set<FormSession>();

async function browserContext(opts: OpenOptions): Promise<BrowserContext> {
  const key = `${opts.headless ?? false}|${opts.profileDir ?? ""}`;
  if (shared?.key === key) {
    const existing = await shared.context.catch(() => null);
    if (existing) return existing;
  }
  if (shared) await closeShipperBrowser();
  const context = (async () => {
    const headless = opts.headless ?? false;
    let c: BrowserContext;
    if (opts.profileDir) c = await chromium.launchPersistentContext(opts.profileDir, { headless, viewport: null });
    else {
      const browser = await chromium.launch({ headless });
      c = await browser.newContext();
      c.on("close", () => void browser.close().catch(() => {}));
    }
    c.on("close", () => {
      if (shared?.context === context) shared = null;
    });
    await c.route("**/*", guardRequest);
    return c;
  })();
  shared = { key, context };
  context.catch(() => {
    if (shared?.context === context) shared = null;
  });
  return context;
}

/** Route every request to the session whose tab made it, or whose tab opened the popup that made it. */
async function guardRequest(route: Route) {
  const req = route.request();
  let page: Page | null = null;
  try {
    page = req.frame().page();
  } catch {
    // A popup's first navigation comes before its frame exists, and service worker requests have none.
    // While any form is being filled, such a navigation may only go to a form's own host.
    if (req.isNavigationRequest() && driving.size > 0) {
      const host = new URL(req.url()).host;
      const owner = [...driving].find((s) => s.host === host);
      if (!owner) {
        for (const s of driving) s.report(`navigation to ${host}`);
        return route.abort("blockedbyclient");
      }
    }
  }
  let session = page ? sessions.get(page) : undefined;
  if (!session && page) {
    const opener = await page.opener().catch(() => null);
    session = opener ? sessions.get(opener) : undefined;
  }
  return session ? session.guard(route) : route.continue();
}

/** Close the window and every form in it. */
export async function closeShipperBrowser(): Promise<void> {
  const current = shared;
  shared = null;
  const context = await current?.context.catch(() => null);
  await context?.close().catch(() => {});
}

// ─── One form ───────────────────────────────────────────────────────────────

export class FormSession {
  readonly filled: Filled[] = [];
  private driving = true;

  private constructor(
    readonly page: Page,
    readonly adapter: FormAdapter,
    readonly host: string,
    private readonly onBlocked?: (what: string) => void,
  ) {}

  static async open(adapter: FormAdapter, url: string, opts: OpenOptions = {}): Promise<FormSession> {
    const host = new URL(url).host;
    const context = await browserContext(opts);
    const blank = context.pages().filter((p) => !sessions.has(p) && p.url() === "about:blank");
    const page = await context.newPage();
    const session = new FormSession(page, adapter, host, opts.onBlocked);
    sessions.set(page, session);
    driving.add(session);
    page.on("close", () => driving.delete(session));
    // A fresh persistent window starts with an empty tab; ours replaces it.
    for (const p of blank) await p.close().catch(() => {});
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      if (new URL(page.url()).host !== host) throw new Error(`The form redirected away from ${host}.`);
      return session;
    } catch (err) {
      await session.close();
      throw err;
    }
  }

  get isOpen(): boolean {
    return !this.page.isClosed();
  }

  onClose(listener: () => void): void {
    this.page.on("close", listener);
  }

  report(what: string) {
    this.onBlocked?.(what);
  }

  async guard(route: Route) {
    const req = route.request();
    if (this.driving && this.adapter.isSubmit(req)) {
      this.report(`submit request to ${req.url()}`);
      return route.abort("blockedbyclient");
    }
    if (this.driving && isTopLevelNavigation(req) && new URL(req.url()).host !== this.host) {
      this.report(`navigation to ${new URL(req.url()).host}`);
      return route.abort("blockedbyclient");
    }
    return route.continue();
  }

  listFields(): Promise<FormField[]> {
    return this.adapter.listFields(this.page);
  }

  async fill(field: FormField, value: SourcedValue): Promise<void> {
    this.assertDriving();
    await this.adapter.fill(this.page, field, value.value);
    this.filled.push({ fieldId: field.id, label: field.label, source: value.source });
  }

  async upload(field: FormField, file: ApprovedFile): Promise<void> {
    this.assertDriving();
    const actual = createHash("sha256").update(await readFile(file.path)).digest("hex");
    if (actual !== file.sha256) throw new HashMismatchError(file.path);
    await this.adapter.upload(this.page, field, file.path);
    await this.adapter.afterUpload(this.page);
    this.filled.push({ fieldId: field.id, label: field.label, source: "document" });
  }

  async screenshot(path: string): Promise<void> {
    await this.page.screenshot({ path, fullPage: true });
  }

  /** Lift the blocks and leave the tab open for the owner. The session no longer fills anything. */
  async handOver(): Promise<void> {
    this.driving = false;
    driving.delete(this);
  }

  /** Bring this form's tab to the front of the window. */
  async show(): Promise<void> {
    await this.page.bringToFront();
  }

  async close(): Promise<void> {
    await this.page.close().catch(() => {});
  }

  private assertDriving() {
    if (!this.driving) throw new Error("This form was handed over to the owner.");
  }
}

function isTopLevelNavigation(req: Request): boolean {
  if (!req.isNavigationRequest()) return false;
  try {
    return req.frame().parentFrame() === null;
  } catch {
    return false;
  }
}
