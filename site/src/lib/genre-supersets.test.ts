import { describe, expect, it } from "vitest";

import { normalizeGenreSlugs, shouldExcludeSuperset } from "./genre-supersets";

describe("genre superset helpers", () => {
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
