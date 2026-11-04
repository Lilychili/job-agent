import { describe, expect, it } from "vitest";
import { groupByCompany } from "../src/group";

const card = (id: string, companyKey: string, day: number) => ({ id, companyKey, foundAt: new Date(Date.UTC(2026, 0, 1 + day)).toISOString() });
const ids = (groups: { id: string }[][]) => groups.map((g) => g.map((c) => c.id));

describe("groupByCompany", () => {
  it("puts one company's positions found close together on one card", () => {
    const cards = [card("a1", "acme", 0), card("b1", "beta", 1), card("a2", "acme", 10)];
    expect(ids(groupByCompany(cards))).toEqual([["a1", "a2"], ["b1"]]);
  });

  it("keeps the column's order: a group sits at its best card, its cards in order", () => {
    const cards = [card("b1", "beta", 0), card("a2", "acme", 5), card("a1", "acme", 0)];
    expect(ids(groupByCompany(cards))).toEqual([["b1"], ["a2", "a1"]]);
  });

  it("starts a new card for positions a month or more after the group's first", () => {
    const cards = [card("a1", "acme", 0), card("a2", "acme", 20), card("a3", "acme", 30), card("a4", "acme", 45)];
    expect(ids(groupByCompany(cards))).toEqual([["a1", "a2"], ["a3", "a4"]]);
  });
});
