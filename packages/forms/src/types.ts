import type { Page, Request } from "playwright";

/** Fields every ATS asks for, filled from the Profile rather than the AnswerBank. */
export type StandardField =
  | "name"
  | "email"
  | "phone"
  | "location"
  | "currentCompany"
  | "linkedin"
  | "github"
  | "twitter"
  | "website"
  | "resume"
  | "coverLetterText";

/** `file` and `other` are left for the owner: only the approved CV is ever uploaded. */
export type FieldKind = "text" | "textarea" | "choice" | "multi" | "select" | "file" | "other";

/** One question on an application form, as the adapter read it. Label and options are page text: untrusted. */
export interface FormField {
  /** The input's name attribute; unique on the form. */
  id: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  options?: string[];
  standard?: StandardField;
}

/** Where a filled value came from. Nothing on the page is ever a source. */
export type ValueSource = "profile" | "answerBank" | "document";

export interface SourcedValue {
  /** For a `multi` field: one value per box to tick. */
  value: string | string[];
  source: ValueSource;
}

/** A file to upload, with the hash it had when the owner approved it. */
export interface ApprovedFile {
  path: string;
  sha256: string;
}

/** What a deterministic per-ATS adapter knows about its forms. */
export interface FormAdapter {
  ats: "greenhouse" | "lever" | "ashby";
  /** The application form for a posting link, or null when the link isn't one of this ATS's postings. */
  applyUrl(postingUrl: string): string | null;
  /** True for the request that would submit the application. Blocked while the agent drives. */
  isSubmit(request: Request): boolean;
  listFields(page: Page): Promise<FormField[]>;
  fill(page: Page, field: FormField, value: string | string[]): Promise<void>;
  upload(page: Page, field: FormField, filePath: string): Promise<void>;
  /** Wait for whatever the form does after a CV upload (Lever reads it and fills fields itself). */
  afterUpload(page: Page): Promise<void>;
}
