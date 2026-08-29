import { describe, expect, it } from "vitest";

import { mockDirectusFetch } from "../test/directus-mock";
import {
  fetchActivity,
  fetchGameGenres,
  fetchItemMap,
  fetchPrevRevision,
  fetchRevisions,
  fmtDelta,
  fmtNewGame,
  humanVal,
  SKIP_DELTA,
} from "./changelog";

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

  it("formats current_section changes with the game's section noun", () => {
    expect(
      fmtDelta(
        { current_section: 2 },
        { current_section: 1, section_noun: "Episode" },
        { section_noun: "Episode" },
      ),
    ).toBe("**Current Progress**: Episode 1 → Episode 2");
  });

  it("falls back to the previous revision's section noun when current data lacks it", () => {
    expect(
      fmtDelta(
        { current_section: 2 },
        { current_section: 1, section_noun: "Act" },
        null,
      ),
    ).toBe("**Current Progress**: Act 1 → Act 2");
  });

  it("defaults current_section formatting to Chapter when no noun is set", () => {
    expect(fmtDelta({ current_section: 3 }, null, null)).toBe(
      "**Current Progress**: Chapter 3",
    );
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

describe("changelog Directus helpers", () => {
  it("fetches revisions with the requested collection, fields, sort, and limit", async () => {
    const revisions = [{
      id: 5,
      item: "9",
      collection: "games",
      data: { title: "Example" },
      delta: null,
      activity: { action: "create", timestamp: "2026-08-01T00:00:00Z" },
    }];
    const fetchMock = mockDirectusFetch([{ match: "/revisions?", data: revisions }]);

    await expect(fetchRevisions("games", 7)).resolves.toEqual(revisions);

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("filter[collection][_eq]")).toBe("games");
    expect(url.searchParams.get("sort")).toBe("-id");
    expect(url.searchParams.get("limit")).toBe("7");
    expect(url.searchParams.get("fields")).toContain("activity.timestamp");
  });

  it("returns the previous revision or null when no previous snapshot exists", async () => {
    const previous = {
      id: 4,
      item: "9",
      collection: "games",
      data: { title: "Earlier" },
      delta: null,
      activity: null,
    };
    const fetchMock = mockDirectusFetch([{ match: "/revisions?", data: [previous] }]);

    await expect(fetchPrevRevision("games", "9", 5)).resolves.toEqual(previous);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("filter[item][_eq]")).toBe("9");
    expect(url.searchParams.get("filter[id][_lt]")).toBe("5");

    mockDirectusFetch([{ match: "/revisions?", data: [] }]);
    await expect(fetchPrevRevision("games", "9", 5)).resolves.toBeNull();

    mockDirectusFetch([{ match: "/revisions?", data: undefined }]);
    await expect(fetchPrevRevision("games", "9", 5)).resolves.toBeNull();
  });

  it("accepts one or several activity actions", async () => {
    const fetchMock = mockDirectusFetch([{ match: "/activity?", data: [] }]);

    await fetchActivity("games_links", "create", 3);
    await fetchActivity("games_links", ["create", "update"], 4);

    const first = new URL(String(fetchMock.mock.calls[0][0]));
    const second = new URL(String(fetchMock.mock.calls[1][0]));
    expect(first.searchParams.get("filter[action][_in]")).toBe("create");
    expect(second.searchParams.get("filter[action][_in]")).toBe("create,update");
    expect(second.searchParams.get("limit")).toBe("4");
  });

  it("avoids a request for an empty item set and maps fetched items by numeric ID", async () => {
    const emptyFetch = mockDirectusFetch([]);
    await expect(fetchItemMap("games", [], "id,title")).resolves.toEqual({});
    expect(emptyFetch).not.toHaveBeenCalled();

    const fetchMock = mockDirectusFetch([{
      match: "/items/games?",
      data: [{ id: "7", title: "Seven" }, { id: 8, title: "Eight" }],
    }]);
    await expect(fetchItemMap("games", [7, 8], "id,title")).resolves.toEqual({
      7: { id: "7", title: "Seven" },
      8: { id: 8, title: "Eight" },
    });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("filter[id][_in]")).toBe("7,8");
    expect(url.searchParams.get("fields")).toBe("id,title");
  });

  it("returns only non-empty genre names for a game", async () => {
    const fetchMock = mockDirectusFetch([{
      match: "/items/games_genres?",
      data: [
        { genres_id: { name: "Adventure" } },
        { genres_id: { name: "" } },
        { genres_id: null },
      ],
    }]);

    await expect(fetchGameGenres(42)).resolves.toEqual(["Adventure"]);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("filter[games_id][_eq]")).toBe("42");
  });
});
