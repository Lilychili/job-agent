/// <reference lib="dom" />
// Reads a company's careers page for the links on it, so code can spot an embedded or linked job board.
// The page link came from the web: only links are read, nothing is typed or sent, and nothing it says is
// followed. Code then asks the board's own API whether the board is really the company's.
import { isPublicHttps } from "@jobagent/ats";
import { chromium } from "playwright";
import { inPage } from "./page";

const MAX_LINKS = 500;
const LOAD_TIMEOUT_MS = 20_000;

/** The page's own URL after redirects, its links and its frames' URLs. Empty when it can't be read. */
export async function readCareersPage(url: string, signal?: AbortSignal): Promise<string[]> {
  if (!isPublicHttps(url)) return [];
  const browser = await chromium.launch({ headless: true });
  const stop = () => void browser.close();
  signal?.addEventListener("abort", stop);
  try {
    const page = await browser.newPage();
    // A redirect into this machine's network is refused like the link itself would be.
    await page.route("**/*", (route) => (isPublicHttps(route.request().url()) ? route.continue() : route.abort("blockedbyclient")));
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: LOAD_TIMEOUT_MS });
    // Boards are often embedded by script after the page loads.
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    const hrefs = await inPage(page, () => Array.from(document.querySelectorAll("a[href]"), (a) => (a as HTMLAnchorElement).href), null);
    const frames = page.frames().map((f) => f.url());
    return [...new Set([page.url(), ...frames, ...hrefs])].filter(isPublicHttps).slice(0, MAX_LINKS);
  } catch {
    return [];
  } finally {
    signal?.removeEventListener("abort", stop);
    await browser.close().catch(() => {});
  }
}
