// Groups Found cards from one company into one multi-position card. Pure, so the board can import it.

/** Positions from one company found less than this far apart share a card. */
export const GROUP_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface Groupable {
  /** The normalized company name, so "Acme Inc." and "ACME" are one company. */
  companyKey: string;
  /** When the job was found, as an ISO string. */
  foundAt: string;
}

/**
 * Splits cards into groups of one company's positions, each found within `GROUP_WINDOW_DAYS` of the
 * group's earliest. A group sits where its first card did, so the column keeps its order (best score
 * first), and keeps its cards in that order too.
 */
export function groupByCompany<T extends Groupable>(cards: readonly T[], windowDays = GROUP_WINDOW_DAYS): T[][] {
  const window = windowDays * DAY_MS;
  // Within one company, oldest first: each card joins the group whose earliest card is close enough.
  const byCompany = new Map<string, T[]>();
  for (const c of cards) {
    const list = byCompany.get(c.companyKey);
    if (list) list.push(c);
    else byCompany.set(c.companyKey, [c]);
  }
  const groupOf = new Map<T, T[]>();
  for (const list of byCompany.values()) {
    const oldestFirst = [...list].sort((a, b) => Date.parse(a.foundAt) - Date.parse(b.foundAt));
    let group: T[] = [];
    let start = 0;
    for (const c of oldestFirst) {
      const at = Date.parse(c.foundAt);
      if (group.length === 0 || at - start >= window) {
        group = [];
        start = at;
      }
      group.push(c);
      groupOf.set(c, group);
    }
  }
  // Back in the column's order: a group appears once, at its first card, its cards as they came.
  const out: T[][] = [];
  const placed = new Set<T[]>();
  for (const c of cards) {
    const g = groupOf.get(c)!;
    if (placed.has(g)) continue;
    placed.add(g);
    out.push(cards.filter((x) => groupOf.get(x) === g));
  }
  return out;
}
