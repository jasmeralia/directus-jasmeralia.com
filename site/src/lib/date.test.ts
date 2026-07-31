import { describe, expect, it } from "vitest";

import { formatDate } from "./date";

describe("formatDate", () => {
  it.each([null, undefined, ""])("returns an empty string for %s", (value) => {
    expect(formatDate(value)).toBe("");
  });

  it("formats a valid date in a stable locale", () => {
    expect(formatDate("2024-02-03T12:00:00Z")).toBe("Feb 3, 2024");
  });

  it("falls back to the date-like prefix for unparseable input", () => {
    expect(formatDate("not-a-date 12:34:56")).toBe("not-a-date");
  });
});
