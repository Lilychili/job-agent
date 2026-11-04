import { documentHtml, renderPdfs } from "@jobagent/agents";
import { ValidationError } from "@jobagent/core";
import { ownerDraft, loadTarget, parseStyle, pdfBrowser, pdfResponse } from "@/lib/documents";
import { readBody, route } from "@/lib/route";
import { getDb } from "@/lib/server";

/** POST { kind, style, cv, coverLetter } — prints one document as it stands in the editor. Nothing is saved. */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const body = await readBody<{ kind: unknown; style: unknown; cv: unknown; coverLetter: unknown }>(req);
  const style = parseStyle(body.style ?? "color");
  if (body.kind !== "cv" && body.kind !== "cover_letter") throw new ValidationError("Unknown document.");
  const target = await loadTarget(getDb(), id);
  const draft = ownerDraft(body, target.profile.facts, target);
  const html = documentHtml(body.kind, body.kind === "cv" ? draft.cv : draft.coverLetter, target.profile, style);
  const [pdf] = await renderPdfs([html], await pdfBrowser());
  return pdfResponse(pdf!);
});
