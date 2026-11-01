// Validation for the owner-edited Profile. Agents only ever see what passes through here.
import { randomUUID } from "node:crypto";
import { ats, remotePreference, type Contact, type FactKind, type ProfileFact, type preferences } from "@jobagent/db";

export const FACT_KINDS = ["role", "skill", "education", "achievement", "cert", "language"] as const satisfies readonly FactKind[];

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Fact ids are stable so Pen can cite them: assigned once, kept across edits. */
export function newFactId(kind: FactKind): string {
  return `f-${kind}-${randomUUID().slice(0, 8)}`;
}

const DATE = /^\d{4}(-(0[1-9]|1[0-2]))?$/;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function parseContact(input: unknown): Contact {
  const c = (input ?? {}) as Record<string, unknown>;
  const name = str(c.name);
  const email = str(c.email);
  if (!name) throw new ValidationError("Name is required.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError("A valid email is required.");
  const links = (Array.isArray(c.links) ? c.links : [])
    .map(str)
    .filter(Boolean)
    .map((l) => {
      try {
        const u = new URL(/^[a-z]+:\/\//i.test(l) ? l : `https://${l}`);
        if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
        return u.toString();
      } catch {
        throw new ValidationError(`"${l}" is not a valid link.`);
      }
    });
  return {
    name,
    email,
    ...(str(c.phone) && { phone: str(c.phone) }),
    ...(str(c.location) && { location: str(c.location) }),
    links,
  };
}

/**
 * Trim, drop empty rows, validate, and give new facts an id. Existing ids are kept
 * (and must be unique) so documents that cite them stay valid.
 */
export function parseFacts(input: unknown): ProfileFact[] {
  if (!Array.isArray(input)) throw new ValidationError("Facts must be a list.");
  const seen = new Set<string>();
  const out: ProfileFact[] = [];
  for (const raw of input) {
    const f = (raw ?? {}) as Record<string, unknown>;
    const text = str(f.text);
    if (!text) continue;
    const kind = str(f.kind) as FactKind;
    if (!FACT_KINDS.includes(kind)) throw new ValidationError(`Unknown fact kind "${str(f.kind)}".`);
    let id = str(f.id);
    if (id && seen.has(id)) throw new ValidationError(`Duplicate fact id ${id}.`);
    if (!id) id = newFactId(kind);
    seen.add(id);
    const fact: ProfileFact = { id, kind, text };
    for (const key of ["startDate", "endDate"] as const) {
      const d = str(f[key]);
      if (d) {
        if (!DATE.test(d)) throw new ValidationError(`${key} "${d}" must look like 2021 or 2021-03.`);
        fact[key] = d;
      }
    }
    if (fact.startDate && fact.endDate && fact.endDate < fact.startDate) {
      throw new ValidationError(`"${text}" ends before it starts.`);
    }
    if (str(f.org)) fact.org = str(f.org);
    out.push(fact);
  }
  return out;
}

const list = (v: unknown): string[] => [...new Set((Array.isArray(v) ? v : []).map(str).filter(Boolean))];

type Ats = (typeof ats.enumValues)[number];
type Remote = (typeof remotePreference.enumValues)[number];

export function parsePreferences(input: unknown): Omit<typeof preferences.$inferInsert, "id" | "createdAt" | "updatedAt"> {
  const b = (input ?? {}) as Record<string, unknown>;

  const remote = b.remote as Remote;
  if (!remotePreference.enumValues.includes(remote)) throw new ValidationError("Choose a remote policy.");

  let salaryFloor: number | null = null;
  if (b.salaryFloor !== null && b.salaryFloor !== "" && b.salaryFloor !== undefined) {
    salaryFloor = Number(b.salaryFloor);
    if (!Number.isInteger(salaryFloor) || salaryFloor < 0) throw new ValidationError("Salary floor must be a whole number.");
  }
  const currency = str(b.salaryCurrency).toUpperCase();
  if (salaryFloor !== null && !/^[A-Z]{3}$/.test(currency)) {
    throw new ValidationError("Give the salary currency as a 3-letter code, e.g. EUR.");
  }

  const excl = (b.exclusions ?? {}) as Record<string, unknown>;
  const boards = (Array.isArray(b.companyBoards) ? b.companyBoards : [])
    .map((x) => x as { ats?: string; boardToken?: unknown })
    .filter((x) => str(x.boardToken))
    .map((x) => {
      if (!ats.enumValues.includes(x.ats as Ats)) throw new ValidationError(`Unknown job board type "${x.ats}".`);
      const boardToken = str(x.boardToken);
      if (!/^[A-Za-z0-9._-]+$/.test(boardToken)) throw new ValidationError(`"${boardToken}" doesn't look like a board name.`);
      return { ats: x.ats as Ats, boardToken };
    });

  return {
    locations: list(b.locations),
    remote,
    salaryFloor,
    salaryCurrency: salaryFloor === null ? null : currency,
    stackMustHave: list(b.stackMustHave),
    stackNiceToHave: list(b.stackNiceToHave),
    exclusions: { companies: list(excl.companies), keywords: list(excl.keywords), seniority: list(excl.seniority) },
    companyBoards: boards,
  };
}

/** A model id goes on the Claude Code command line, so it must not be able to look like a flag. */
export function parseModel(input: unknown): string | null {
  const model = str(input);
  if (!model) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:[\]-]*$/.test(model)) throw new ValidationError(`"${model}" isn't a valid model name.`);
  return model;
}
