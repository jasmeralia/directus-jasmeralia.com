import { describe, expect, it, vi } from "vitest";

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

  it("uses the configured site timezone instead of the host clock", () => {
    vi.stubEnv("SITE_TIMEZONE", "America/Los_Angeles");
    // 06:05 UTC on the 23rd is still 23:05 on the 22nd in Pacific time.
    expect(formatDate("2026-09-23T06:05:57.636Z")).toBe("Sep 22, 2026");
  });

  it("falls back to America/Los_Angeles when SITE_TIMEZONE is unset", () => {
    vi.stubEnv("SITE_TIMEZONE", "");
    expect(formatDate("2026-09-23T06:05:57.636Z")).toBe("Sep 22, 2026");
  });
});
