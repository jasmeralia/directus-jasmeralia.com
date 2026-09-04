import { describe, expect, it } from "vitest";

import {
  directGameSections,
  directGameSectionsByPosition,
  groupSectionsByCategory,
  orderedSections,
  pluralizeNoun,
  questProgressPercent,
  sectionNoun,
  sectionProgressPercent,
  sectionProgressSummary,
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

  it("orders by sort (falling back to number) instead of number, and excludes bundle members", () => {
    const sections: GameSection[] = [
      { number: 2, sort: 5, title: "Rae 2", category: "Rae" },
      { number: 1, sort: 1, title: "Main 1", category: "Main" },
      { number: 1, sort: 4, title: "Rae 1", category: "Rae" },
      { number: 3, sort: null, title: "No sort, falls back to number" },
      { number: 1, sort: 2, title: "Bundled", bundle_member_id: 9, category: "Main" },
    ];

    expect(directGameSectionsByPosition(sections).map(({ title }) => title)).toEqual([
      "Main 1",
      "No sort, falls back to number",
      "Rae 1",
      "Rae 2",
    ]);
    expect(directGameSectionsByPosition(undefined)).toEqual([]);
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
    expect(directGameSections(undefined)).toEqual([]);
  });
});

describe("sectionProgressPercent", () => {
  it("uses half credit for in-progress and on-hold games", () => {
    expect(sectionProgressPercent(2, 10, "in_progress")).toBe(15);
    expect(sectionProgressPercent(2, 10, "on_hold")).toBe(15);
  });

  it("uses the upper boundary for other active statuses", () => {
    expect(sectionProgressPercent(2, 10, "waiting_for_update")).toBe(20);
    expect(sectionProgressPercent(2, 10, null)).toBe(20);
  });

  it("always returns 100 for completed games", () => {
    expect(sectionProgressPercent(2, 10, "completed")).toBe(100);
    expect(sectionProgressPercent(0, 0, "completed")).toBe(100);
  });

  it("clamps invalid section positions to zero", () => {
    expect(sectionProgressPercent(-1, 10, "in_progress")).toBe(0);
    expect(sectionProgressPercent(0, 10, "in_progress")).toBe(0);
    expect(sectionProgressPercent(5, 2, "in_progress")).toBe(100);
  });
});

describe("sectionProgressSummary", () => {
  it("returns completed progress even without section rows", () => {
    expect(sectionProgressSummary({
      player_status: "completed",
      current_section: null,
      sections: [],
    })).toEqual({
      label: "Completed (100%)",
      title: "Completed",
      percent: 100,
    });
  });

  it("labels in-progress games with half-credit percentages", () => {
    expect(sectionProgressSummary({
      player_status: "in_progress",
      section_noun: "Mission",
      current_section: 2,
      sections: [
        { number: 1, title: "One" },
        { number: 2, title: "Two" },
      ],
    })).toEqual({
      label: "Mission 2/2 (75%)",
      title: "Mission 2 of 2",
      percent: 75,
    });
  });

  it("returns null when section data is missing for non-completed games", () => {
    expect(sectionProgressSummary({
      player_status: "in_progress",
      current_section: null,
      sections: [{ number: 1, title: "One" }],
    })).toBeNull();
  });

  it("counts completed quests for nonlinear games instead of using current_section", () => {
    expect(sectionProgressSummary({
      player_status: "in_progress",
      section_style: "nonlinear",
      section_noun: "Quest",
      current_section: null,
      sections: [
        { number: 1, title: "One", category: "Main", completed: true },
        { number: 2, title: "Two", category: "Main", completed: false },
        { number: 1, title: "Three", category: "Side", completed: true },
      ],
    })).toEqual({
      label: "2/3 Quests (67%)",
      title: "2 of 3 Quests completed",
      percent: 67,
    });
  });

  it("clamps nonlinear games to 100% when completed regardless of row-level completed flags", () => {
    expect(sectionProgressSummary({
      player_status: "completed",
      section_style: "nonlinear",
      section_noun: "Quest",
      sections: [
        { number: 1, title: "One", completed: false },
      ],
    })).toEqual({
      label: "Quests completed (100%)",
      title: "Quests completed",
      percent: 100,
    });
  });

  it("returns null for a nonlinear game with no section rows", () => {
    expect(sectionProgressSummary({
      player_status: "in_progress",
      section_style: "nonlinear",
      sections: [],
    })).toBeNull();
  });
});

describe("questProgressPercent", () => {
  it("computes a direct ratio with no half-credit branch", () => {
    expect(questProgressPercent(2, 4, "in_progress")).toBe(50);
    expect(questProgressPercent(0, 4, "in_progress")).toBe(0);
  });

  it("always returns 100 for completed games", () => {
    expect(questProgressPercent(0, 4, "completed")).toBe(100);
  });

  it("returns 0 for a zero total", () => {
    expect(questProgressPercent(0, 0, "in_progress")).toBe(0);
  });
});

describe("groupSectionsByCategory", () => {
  it("groups consecutive same-category sections and preserves order", () => {
    const sections: GameSection[] = [
      { number: 1, title: "Main 1", category: "Main Story" },
      { number: 2, title: "Main 2", category: "Main Story" },
      { number: 1, title: "Rae 1", category: "Rae" },
      { number: 1, title: "Flat", category: null },
    ];

    expect(groupSectionsByCategory(sections)).toEqual([
      { category: "Main Story", sections: [sections[0], sections[1]] },
      { category: "Rae", sections: [sections[2]] },
      { category: null, sections: [sections[3]] },
    ]);
  });

  it("returns an empty array for an empty input", () => {
    expect(groupSectionsByCategory([])).toEqual([]);
  });
});
