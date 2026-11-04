// Prints a document's HTML to PDF and removes everything that says how or when it was made.
import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDict, PDFDocument, PDFName, PDFRef, PDFStream } from "pdf-lib";
import { chromium, type Browser } from "playwright";
import { repoRoot } from "@jobagent/core";

/**
 * Inter (SIL Open Font License, packages/agents/fonts/OFL.txt), inlined as data: URLs because the page
 * may not load anything. Read once; the PDF embeds only the glyphs it uses.
 */
let fontCss: string | undefined;
const LATIN = "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";
const LATIN_EXT = "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF";
// Static weights, not the variable font: Chromium embeds those as TrueType, which every PDF reader and
// applicant tracking system reads, where the variable font would become Type 3 glyphs.
function embeddedFonts(): string {
  if (fontCss !== undefined) return fontCss;
  try {
    fontCss = [400, 500, 600, 700]
      .flatMap((weight) => [
        { file: `inter-latin-ext-${weight}-normal.woff2`, range: LATIN_EXT, weight },
        { file: `inter-latin-${weight}-normal.woff2`, range: LATIN, weight },
      ])
      .map(({ file, range, weight }) => {
        const data = readFileSync(path.join(repoRoot(), "packages", "agents", "fonts", file)).toString("base64");
        return `@font-face{font-family:"Inter";font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${data}) format("woff2");unicode-range:${range};}`;
      })
      .join("");
  } catch (err) {
    // A missing font file must not stop a CV from printing: the template falls back to Helvetica/Arial.
    console.error("[pdf] Inter not found, printing with the fallback font:", err);
    fontCss = "";
  }
  return fontCss;
}

const withFonts = (html: string) => {
  const css = embeddedFonts();
  return css ? html.replace("</head>", `<style>${css}</style></head>`) : html;
};

/** Nothing on the page may run or load anything: it holds text Claude wrote after reading a posting. */
async function printPdf(browser: Browser, html: string): Promise<Uint8Array> {
  const context = await browser.newContext({ javaScriptEnabled: false, offline: true });
  try {
    const page = await context.newPage();
    await page.route("**/*", (route) => route.abort());
    await page.setContent(withFonts(html), { waitUntil: "load" });
    // Data-URL fonts load at once, but give layout a chance to use them before printing.
    await page.evaluate("document.fonts.ready").catch(() => {});
    return await page.pdf({ preferCSSPageSize: true, printBackground: true });
  } finally {
    await context.close();
  }
}

const METADATA = PDFName.of("Metadata");
const INFO_KEYS = ["Author", "Producer", "Creator", "CreationDate", "ModDate"].map((k) => PDFName.of(k));

export async function stripMetadata(pdf: Uint8Array): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const info = doc.context.trailerInfo.Info;
  if (info instanceof PDFRef) doc.context.delete(info);
  doc.context.trailerInfo.Info = undefined;
  doc.context.trailerInfo.ID = undefined;
  // The XMP stream is its own object: dropping the catalog's link to it would leave it in the file.
  const xmp = doc.catalog.get(METADATA);
  if (xmp instanceof PDFRef) doc.context.delete(xmp);
  doc.catalog.delete(METADATA);
  // No object streams: they compress dictionaries, which would hide leftovers from a plain byte search.
  const stripped = Buffer.from(await doc.save({ updateFieldAppearances: false, useObjectStreams: false }));
  await assertNoMetadata(stripped);
  return stripped;
}

/** Re-reads the saved file and throws if anything still says how or when it was made. */
async function assertNoMetadata(pdf: Uint8Array) {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const { Info, ID } = doc.context.trailerInfo;
  const found = Info || ID ? ["a document info entry"] : [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFStream ? obj.dict : obj instanceof PDFDict ? obj : undefined;
    if (!dict) continue;
    if (dict.get(PDFName.of("Type")) === METADATA || dict.has(METADATA)) found.push("an XMP metadata stream");
    found.push(...INFO_KEYS.filter((k) => dict.has(k)).map((k) => k.decodeText()));
  }
  if (found.length) throw new Error(`The printed PDF still holds metadata: ${[...new Set(found)].join(", ")}.`);
}

export const launchPdfBrowser = () => chromium.launch();

/** One PDF per page of HTML, in the same order. Without a `browser`, one is started and closed for this call. */
export async function renderPdfs(pages: string[], browser?: Browser): Promise<Buffer[]> {
  const b = browser ?? (await launchPdfBrowser());
  try {
    const pdfs: Buffer[] = [];
    for (const html of pages) pdfs.push(await stripMetadata(await printPdf(b, html)));
    return pdfs;
  } finally {
    if (!browser) await b.close();
  }
}
