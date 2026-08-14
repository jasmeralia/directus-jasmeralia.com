import { describe, expect, it } from "vitest";

import { DEVELOPER_LINK_FIELDS, GAME_THUMB_FIELDS } from "./game-fields";

describe("shared Directus field lists", () => {
  it("contains unique fields needed by game thumbnails and developer links", () => {
    expect(GAME_THUMB_FIELDS.length).toBeGreaterThan(0);
    expect(new Set(GAME_THUMB_FIELDS).size).toBe(GAME_THUMB_FIELDS.length);
    expect(GAME_THUMB_FIELDS).toEqual(expect.arrayContaining([
      "id",
      "slug",
      "sections.number",
      "bundle_members.sections.number",
    ]));

    expect(DEVELOPER_LINK_FIELDS.length).toBeGreaterThan(0);
    expect(new Set(DEVELOPER_LINK_FIELDS).size).toBe(DEVELOPER_LINK_FIELDS.length);
    expect(DEVELOPER_LINK_FIELDS).toContain("links.kind");
  });
});
