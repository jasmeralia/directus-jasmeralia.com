import { describe, expect, it } from "vitest";

import {
  expandGenreSlugs,
  hasGenreMembership,
  normalizeGenreSlugs,
  shouldExcludeSuperset,
} from "./genre-supersets";

describe("genre superset helpers", () => {
  it("adds each configured superset to subset-only genres without dropping the source genres", () => {
    expect(expandGenreSlugs(["avn", "horror", "avn"])).toEqual([
      "avn",
      "horror",
      "visual-novel",
    ]);
    expect(expandGenreSlugs(["crpg", "jrpg"])).toEqual(["crpg", "jrpg", "rpg"]);
  });

  it("keeps explicit supersets and unrelated genres while expanding", () => {
    expect(expandGenreSlugs(["rpg", "arpg", "strategy"])).toEqual([
      "rpg",
      "arpg",
      "strategy",
    ]);
    expect(expandGenreSlugs(["adventure"])).toEqual(["adventure"]);
  });

  it("keeps inherited membership separate from distinct genre labels", () => {
    const effectiveGenres = expandGenreSlugs(["crpg"]);

    expect(effectiveGenres).toEqual(["crpg", "rpg"]);
    expect(normalizeGenreSlugs(effectiveGenres)).toEqual(["crpg"]);
  });

  it("matches inherited supersets but does not reverse the relationship", () => {
    expect(hasGenreMembership(["avn"], "visual-novel")).toBe(true);
    expect(hasGenreMembership(["crpg"], "rpg")).toBe(true);
    expect(hasGenreMembership(["visual-novel"], "avn")).toBe(false);
    expect(hasGenreMembership(["strategy"], "rpg")).toBe(false);
    expect(hasGenreMembership([], "rpg")).toBe(false);
  });

  it("deduplicates genres and removes supersets when a subset is present", () => {
    expect(normalizeGenreSlugs(["visual-novel", "avn", "avn", "horror"])).toEqual([
      "avn",
      "horror",
    ]);
    expect(normalizeGenreSlugs(["rpg", "jrpg", "arpg"])).toEqual(["jrpg", "arpg"]);
  });

  it("keeps a superset when none of its subsets are present", () => {
    expect(normalizeGenreSlugs(["rpg", "strategy", "rpg"])).toEqual([
      "rpg",
      "strategy",
    ]);
  });

  it("identifies only configured supersets with a present subset", () => {
    expect(shouldExcludeSuperset("visual-novel", ["adventure", "avn"])).toBe(true);
    expect(shouldExcludeSuperset("visual-novel", ["adventure"])).toBe(false);
    expect(shouldExcludeSuperset("strategy", ["rpg", "jrpg"])).toBe(false);
  });
});
