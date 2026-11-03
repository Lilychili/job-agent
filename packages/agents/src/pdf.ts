// Prints a document's HTML to PDF and removes everything that says how or when it was made.
import { PDFDict, PDFDocument, PDFName, PDFRef, PDFStream } from "pdf-lib";
import { chromium, type Browser } from "playwright";

/** Nothing on the page may run or load anything: it holds text Claude wrote after reading a posting. */
async function printPdf(browser: Browser, html: string): Promise<Uint8Array> {
  const context = await browser.newContext({ javaScriptEnabled: false, offline: true });
  try {
    const page = await context.newPage();
    await page.route("**/*", (route) => route.abort());
    await page.setContent(html, { waitUntil: "load" });
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
