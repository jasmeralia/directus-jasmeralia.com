import { describe, expect, it } from "vitest";

import { fmtDelta, fmtNewGame, humanVal, SKIP_DELTA } from "./changelog";

const emptyValue = "\u2014";
const deltaArrow = "\u2192";

describe("changelog value formatting", () => {
  it("maps enums, booleans, nulls, and ordinary values to human labels", () => {
    expect(humanVal("player_status", "in_progress")).toBe("In Progress");
    expect(humanVal("title", "Custom title")).toBe("Custom title");
    expect(humanVal("family_sharing", true)).toBe("Yes");
    expect(humanVal("family_sharing", false)).toBe("No");
    expect(humanVal("release_year", 2024)).toBe("2024");
    expect(humanVal("release_year", null)).toBe(emptyValue);
    expect(humanVal("cover_image", "file-id")).toBe("[image]");
  });

  it("formats deltas with and without previous values", () => {
    const result = fmtDelta(
      { player_status: "completed", release_year: 2024 },
      { player_status: "in_progress" },
    );

    expect(result).toContain(`**Play Status**: In Progress ${deltaArrow} Completed`);
    expect(result).toContain("**Year**: 2024");
  });

  it("excludes skip keys and describes cover-image changes", () => {
    expect(SKIP_DELTA.has("slug")).toBe(true);
    expect(fmtDelta({ slug: "new", updated_at: "today" }, null)).toBe("");
    expect(fmtDelta({ cover_image: "new-id" }, null)).toBe("**Cover Image**: Added");
    expect(fmtDelta({ cover_image: null }, { cover_image: "old-id" })).toBe(
      "**Cover Image**: Removed",
    );
    expect(fmtDelta({ cover_image: "new-id" }, { cover_image: "old-id" })).toBe(
      "**Cover Image**: Updated",
    );
  });

  it("formats a new game and omits absent fields", () => {
    expect(fmtNewGame({
      release_year: 2025,
      player_status: "not_started",
      family_sharing: false,
    }, ["Adventure", "RPG"])).toBe([
      "**Year**: 2025",
      "**Play Status**: Not Started",
      "**Family Sharing**: No",
      "**Genres**: Adventure, RPG",
    ].join("\n"));
  });
});
