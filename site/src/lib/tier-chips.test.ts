import { describe, expect, it } from "vitest";

import { buildTierChips, groupTierChipsByGame } from "./tier-chips";

const entry = (gameId: number | null, slug: string, title: string, rating: string | null) => ({
  game_id: gameId === null ? null : { id: gameId },
  tier_list_id: { slug, title },
  rating,
});

describe("tier chips", () => {
  it("sorts by rating and then case-insensitive list title, trimming leading tildes", () => {
    expect(buildTierChips([
      entry(1, "beta", "Beta", "B"),
      entry(1, "completed", " ~~~Completed Games  ", "A"),
      entry(1, "alpha", "alpha", "A"),
      entry(1, "s", "Top", "S"),
    ])).toEqual([
      { slug: "s", text: "Top - S Tier" },
      { slug: "alpha", text: "alpha - A Tier" },
      { slug: "completed", text: "Completed Games - A Tier" },
      { slug: "beta", text: "Beta - B Tier" },
    ]);
  });

  it("hides U, null, and unknown ratings", () => {
    expect(buildTierChips([
      entry(1, "u", "Early", "U"),
      entry(1, "null", "No rating", null),
      entry(1, "unknown", "Unknown", "X"),
    ])).toEqual([]);
  });

  it("drops orphaned rows, incomplete lists, and empty titles", () => {
    expect(buildTierChips([
      { rating: "S", game_id: null, tier_list_id: { slug: "orphan", title: "Orphan" } },
      { rating: "S", game_id: { id: 1 }, tier_list_id: null },
      { rating: "S", game_id: { id: 1 }, tier_list_id: { slug: "missing-title" } },
      entry(1, "empty", " ~~~ ", "S"),
    ])).toEqual([]);
  });

  it("deduplicates by list slug per game and groups entries by game ID", () => {
    const grouped = groupTierChipsByGame([
      entry(1, "same", "List", "B"),
      entry(1, "same", "Renamed", "A"),
      entry(2, "same", "List", "F"),
      entry(null, "orphan", "Orphan", "S"),
    ]);

    expect(grouped).toEqual(new Map([
      [1, [{ slug: "same", text: "List - B Tier" }]],
      [2, [{ slug: "same", text: "List - F Tier" }]],
    ]));
  });
});
