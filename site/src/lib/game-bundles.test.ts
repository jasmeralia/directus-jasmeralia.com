import { describe, expect, it } from "vitest";

import bundleMembersFixture from "../test/fixtures/bundle-members.json";
import {
  bundleProgressSummary,
  effectiveSectionStyle,
  hasBundleMembers,
  orderedBundleMembers,
  sectionDataState,
  type GameBundleMember,
} from "./game-bundles";

const bundleMembers = bundleMembersFixture as GameBundleMember[];

const member = (
  id: number,
  overrides: Partial<GameBundleMember> = {},
): GameBundleMember => ({
  id,
  slug: `member-${id}`,
  title: `Member ${id}`,
  ...overrides,
});

describe("bundle member helpers", () => {
  it("orders members by sort then title without mutating the source", () => {
    const unsorted = [
      member(1, { title: "Zebra" }),
      member(2, { title: "beta", sort: 1 }),
      member(3, { title: "Alpha", sort: 1 }),
    ];

    expect(orderedBundleMembers(unsorted).map(({ title }) => title)).toEqual([
      "Alpha",
      "beta",
      "Zebra",
    ]);
    expect(unsorted.map(({ id }) => id)).toEqual([1, 2, 3]);
    expect(orderedBundleMembers(null)).toEqual([]);
  });

  it("uses title order when member sort positions are equal", () => {
    const equalSort = [
      member(1, { title: "zulu", sort: 4 }),
      member(2, { title: "Alpha", sort: 4 }),
    ];

    expect(orderedBundleMembers(equalSort).map(({ title }) => title)).toEqual([
      "Alpha",
      "zulu",
    ]);
  });

  it("detects whether a game has bundle members", () => {
    expect(hasBundleMembers({ bundle_members: bundleMembers })).toBe(true);
    expect(hasBundleMembers({ bundle_members: [] })).toBe(false);
    expect(hasBundleMembers(undefined)).toBe(false);
  });
});

describe("sectionDataState", () => {
  it("handles ordinary games with present or missing direct sections", () => {
    expect(sectionDataState({ sections: [{ number: 1, title: "Chapter 1" }] })).toBe(
      "present",
    );
    expect(sectionDataState({ sections: [] })).toBe("missing");
    expect(sectionDataState(null)).toBe("missing");
  });

  it("handles every bundle section-data combination", () => {
    expect(sectionDataState({ bundle_members: [
      member(1, { section_data_status: "unknown" }),
      member(2, { section_data_status: null }),
    ] })).toBe("missing");
    expect(sectionDataState({ bundle_members: [
      member(1, { section_data_status: "tracked" }),
      member(2, { section_data_status: "unknown" }),
    ] })).toBe("partial");
    expect(sectionDataState({ bundle_members: [
      member(1, { section_data_status: "not_applicable" }),
      member(2, { section_data_status: "not_applicable" }),
    ] })).toBe("not_applicable");
    expect(sectionDataState({ bundle_members: [
      member(1, { section_data_status: "tracked" }),
      member(2, { section_data_status: "not_applicable" }),
    ] })).toBe("present");
  });
});

describe("effectiveSectionStyle", () => {
  it("hides a declared style until real section data backs it up", () => {
    expect(effectiveSectionStyle({ section_style: "linear", sections: [] })).toBeNull();
    expect(effectiveSectionStyle({ section_style: null, sections: [{ number: 1, title: "Chapter 1" }] })).toBeNull();
    expect(effectiveSectionStyle(null)).toBeNull();
  });

  it("surfaces the declared style once section data is present", () => {
    expect(effectiveSectionStyle({
      section_style: "linear",
      sections: [{ number: 1, title: "Chapter 1" }],
    })).toBe("linear");
    expect(effectiveSectionStyle({
      section_style: "nonlinear",
      bundle_members: [member(1, { section_data_status: "tracked" })],
    })).toBe("nonlinear");
  });
});

describe("bundleProgressSummary", () => {
  it("returns null when no members exist", () => {
    expect(bundleProgressSummary({ bundle_members: [] })).toBeNull();
    expect(bundleProgressSummary(undefined)).toBeNull();
  });

  it("describes one active member using its custom section noun", () => {
    expect(bundleProgressSummary({ bundle_members: bundleMembers })).toEqual({
      label: "First Story: Mission 2/2",
      title: "First Story: Mission 2 of 2",
      percent: 75,
    });
  });

  it("clamps single-member progress percentages", () => {
    const sections = [
      { number: 1, title: "One" },
      { number: 2, title: "Two" },
    ];
    expect(bundleProgressSummary({ bundle_members: [member(1, {
      player_status: "in_progress",
      current_section: 5,
      sections,
    })] })?.percent).toBe(100);
    expect(bundleProgressSummary({ bundle_members: [member(1, {
      player_status: "in_progress",
      current_section: -1,
      sections,
    })] })?.percent).toBe(0);
  });

  it("treats on-hold members as active for section progress", () => {
    expect(bundleProgressSummary({ bundle_members: [member(1, {
      player_status: "on_hold",
      section_noun: "Act",
      current_section: 2,
      sections: [
        { number: 1, title: "Act 1" },
        { number: 2, title: "Act 2" },
        { number: 3, title: "Act 3" },
        { number: 4, title: "Act 4" },
      ],
    })] })).toEqual({
      label: "Member 1: Act 2/4",
      title: "Member 1: Act 2 of 4",
      percent: 38,
    });
  });

  it("handles one active member without trackable progress", () => {
    expect(bundleProgressSummary({ bundle_members: [member(1, {
      title: "Active",
      player_status: "in_progress",
    })] })).toEqual({
      label: "Active: In Progress",
      title: "Active: In Progress",
      percent: null,
    });
  });

  it("summarizes multiple active members", () => {
    expect(bundleProgressSummary({ bundle_members: [
      member(1, { player_status: "in_progress" }),
      member(2, { player_status: "in_progress" }),
    ] })).toEqual({
      label: "2 included games in progress",
      title: "2 included games in progress",
      percent: null,
    });
  });

  it("summarizes completed members when none are active", () => {
    expect(bundleProgressSummary({ bundle_members: [
      member(1, { player_status: "completed" }),
      member(2, { player_status: "completed" }),
      member(3, { player_status: "not_started" }),
    ] })).toEqual({
      label: "2 of 3 included games completed",
      title: "2 of 3 included games completed",
      percent: 67,
    });
  });
});
