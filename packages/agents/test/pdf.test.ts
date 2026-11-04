import { PDFDocument, PDFName } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { renderPdfs, stripMetadata } from "../src/pdf";
import { cvHtml } from "../src/templates";

describe("the printed CV as plain text", () => {
  it("reads in order, with each role's dates next to it, as an applicant tracking system sees it", async () => {
    const facts = [
      { id: "r1", kind: "role" as const, text: "Software Engineer", org: "Acme", startDate: "2019-03", endDate: "2023-01" },
      { id: "r2", kind: "role" as const, text: "Developer", org: "Globex", startDate: "2015-01", endDate: "2019-02" },
      { id: "e1", kind: "education" as const, text: "BSc Computer Science", org: "UPC" },
      { id: "c1", kind: "cert" as const, text: "AWS Certified Developer" },
      { id: "l1", kind: "language" as const, text: "Spanish: Native" },
    ];
    const html = cvHtml(
      {
        summary: { text: "Engineer who ships.", factIds: ["r1"] },
        experience: [
          { roleFactId: "r1", bullets: [{ text: "Cut build time by 40%.", factIds: [] }] },
          { roleFactId: "r2", bullets: [{ text: "Built the billing system.", factIds: [] }] },
        ],
        skills: [{ text: "TypeScript", factIds: [] }],
        otherFactIds: ["e1", "c1", "l1"],
      },
      { name: "Ana Ruiz", email: "ana@example.com" },
      facts,
    );
    const [pdf] = await renderPdfs([html]);
    const { text } = await extractText(await getDocumentProxy(new Uint8Array(pdf!)), { mergePages: true });
    const order = ["Ana Ruiz", "SUMMARY", "WORK EXPERIENCE", "Software Engineer · Acme", "2019-03 – 2023-01", "Cut build time", "Developer · Globex", "2015-01 – 2019-02", "Built the billing", "SKILLS", "TypeScript", "EDUCATION", "BSc Computer Science", "CERTIFICATIONS", "AWS Certified", "LANGUAGES", "Spanish: Native"];
    const at = order.map((s) => text.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  }, 30_000);
});

describe("stripMetadata", () => {
  it("removes the document info and the XMP stream itself, not just the link to it", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.setProducer("Skia/PDF m140");
    doc.setCreationDate(new Date("2026-11-03"));
    const xmp = doc.context.register(doc.context.stream("<x:xmpmeta>HeadlessChrome</x:xmpmeta>", { Type: "Metadata", Subtype: "XML" }));
    doc.catalog.set(PDFName.of("Metadata"), xmp);
    const before = await doc.save({ useObjectStreams: false });
    expect(Buffer.from(before).toString("latin1")).toContain("xmpmeta");

    const after = await stripMetadata(before);
    const text = after.toString("latin1");
    for (const marker of ["xmpmeta", "HeadlessChrome", "Producer", "CreationDate"]) expect(text).not.toContain(marker);
    expect((await PDFDocument.load(after)).getPageCount()).toBe(1);
  });
});
