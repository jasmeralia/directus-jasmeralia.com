import { describe, expect, it } from "vitest";

import {
  directGameSections,
  orderedSections,
  pluralizeNoun,
  sectionNoun,
  type GameSection,
} from "./game-sections";

describe("game section helpers", () => {
  it.each([
    [null, "Chapter"],
    [undefined, "Chapter"],
    ["", "Chapter"],
    ["Act", "Act"],
  ])("normalizes section noun %s", (value, expected) => {
    expect(sectionNoun(value)).toBe(expected);
  });

  it.each([
    ["Story", "Stories"],
    ["Day", "Days"],
    ["Chapter", "Chapters"],
  ])("pluralizes %s", (noun, expected) => {
    expect(pluralizeNoun(noun)).toBe(expected);
  });

  it("orders sections numerically without mutating the source", () => {
    const sections: GameSection[] = [
      { number: 10, title: "Ten" },
      { number: 2, title: "Two" },
      { number: 1, title: "One" },
    ];

    expect(orderedSections(sections).map(({ number }) => number)).toEqual([1, 2, 10]);
    expect(sections.map(({ number }) => number)).toEqual([10, 2, 1]);
    expect(orderedSections(null)).toEqual([]);
  });

  it("returns only direct sections and excludes all bundle member references", () => {
    const sections: GameSection[] = [
      { number: 3, title: "Direct 3", bundle_member_id: null },
      { number: 1, title: "Bundled", bundle_member_id: 5 },
      { number: 2, title: "Direct 2" },
      { number: 4, title: "Bundled object", bundle_member_id: { id: 6 } },
    ];

    expect(directGameSections(sections).map(({ title }) => title)).toEqual([
      "Direct 2",
      "Direct 3",
    ]);
    expect(sections).toHaveLength(4);
  });
});
