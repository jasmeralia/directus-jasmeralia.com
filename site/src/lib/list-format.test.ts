import { describe, expect, it } from "vitest";

import {
  compareLabels,
  formatUnknown,
  sortByName,
  sortByReleaseYear,
  sortByTitle,
} from "./list-format";

describe("list formatting and sorting", () => {
  it("labels unknown values while preserving known values", () => {
    expect(formatUnknown("unknown", "engine")).toBe("<Unknown engine>");
    expect(formatUnknown("Ren'py", "engine")).toBe("Ren'py");
  });

  it("sorts titles case-insensitively without mutating the input", () => {
    const input = [
      { title: "Zebra" },
      { title: "dev_hell" },
      { title: "Alpha" },
    ];

    const result = sortByTitle(input);

    expect(result.map(({ title }) => title)).toEqual(["Alpha", "dev_hell", "Zebra"]);
    expect(result).not.toBe(input);
    expect(input.map(({ title }) => title)).toEqual(["Zebra", "dev_hell", "Alpha"]);
  });

  it("sorts names case-insensitively and handles an empty array", () => {
    const input = [{ name: "zulu" }, { name: "Alpha" }, { name: "beta" }];

    expect(sortByName(input).map(({ name }) => name)).toEqual(["Alpha", "beta", "zulu"]);
    expect(input.map(({ name }) => name)).toEqual(["zulu", "Alpha", "beta"]);
    expect(sortByName([])).toEqual([]);
    expect(sortByTitle([])).toEqual([]);
  });

  it("sorts by release year oldest-first, unknown years last, ties broken by title", () => {
    const input = [
      { title: "Newer", release_year: 2022 },
      { title: "Zebra Unknown", release_year: null },
      { title: "Older", release_year: 2018 },
      { title: "Same Year B", release_year: 2020 },
      { title: "Same Year A", release_year: 2020 },
      { title: "Alpha Unknown" },
    ];

    const result = sortByReleaseYear(input);

    expect(result.map(({ title }) => title)).toEqual([
      "Older",
      "Same Year A",
      "Same Year B",
      "Newer",
      "Alpha Unknown",
      "Zebra Unknown",
    ]);
    expect(result).not.toBe(input);
    expect(sortByReleaseYear([])).toEqual([]);
  });

  it("compares labels without case sensitivity", () => {
    expect(compareLabels("alpha", "ALPHA")).toBe(0);
    expect(["Zebra", "dev_hell", "Alpha"].sort(compareLabels)).toEqual([
      "Alpha",
      "dev_hell",
      "Zebra",
    ]);
  });
});
