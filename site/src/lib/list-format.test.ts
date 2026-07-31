import { describe, expect, it } from "vitest";

import { compareLabels, sortByName, sortByTitle } from "./list-format";

describe("list formatting and sorting", () => {
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

  it("compares labels without case sensitivity", () => {
    expect(compareLabels("alpha", "ALPHA")).toBe(0);
    expect(["Zebra", "dev_hell", "Alpha"].sort(compareLabels)).toEqual([
      "Alpha",
      "dev_hell",
      "Zebra",
    ]);
  });
});
