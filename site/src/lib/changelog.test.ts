import { describe, expect, it } from "vitest";

import { mockDirectusFetch } from "../test/directus-mock";
import {
  fetchActivity,
  fetchAllGameGenres,
  fetchGameGenres,
  fetchGameSectionsByBundleMemberIds,
  fetchGameSectionsByGameIds,
  fetchItemMap,
  fetchRevisions,
  fmtDelta,
  fmtNewGame,
  humanVal,
  previousRevisionDataMap,
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
    expect(humanVal("section_style", "linear")).toBe("Linear");
    expect(humanVal("section_style", "nonlinear")).toBe("Nonlinear");
  });

  it("formats deltas with and without previous values", () => {
    const result = fmtDelta(
      { player_status: "completed", release_year: 2024 },
      { player_status: "in_progress" },
    );

    expect(result).toContain(`**Play Status**: In Progress ${deltaArrow} Completed`);
    expect(result).toContain("**Year**: 2024");
  });

  it("formats section style changes with human-readable labels", () => {
    expect(
      fmtDelta(
        { section_style: "nonlinear" },
        { section_style: "linear" },
      ),
    ).toBe(`**Section Style**: Linear ${deltaArrow} Nonlinear`);
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

  it("prefers a matching section's own title over the noun and number", () => {
    const sections = [
      { number: 1, title: "The Arrival" },
      { number: 2, title: "The Storm" },
    ];
    expect(
      fmtDelta(
        { current_section: 2 },
        { current_section: 1, section_noun: "Episode" },
        { section_noun: "Episode" },
        sections,
      ),
    ).toBe("**Current Progress**: The Arrival → The Storm");
  });

  it("falls back to noun + number for a section with no matching title row", () => {
    const sections = [{ number: 1, title: "The Arrival" }];
    expect(
      fmtDelta(
        { current_section: 2 },
        { current_section: 1, section_noun: "Episode" },
        { section_noun: "Episode" },
        sections,
      ),
    ).toBe("**Current Progress**: The Arrival → Episode 2");
  });

  it("shows an em dash when current_section becomes undefined", () => {
    expect(
      fmtDelta(
        { current_section: undefined },
        { current_section: 1, section_noun: "Chapter" },
      ),
    ).toBe("**Current Progress**: Chapter 1 → —");
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

  it("maps targets to the immediately previous same-item revision data", () => {
    const revisions = [
      { id: 12, item: "9", collection: "games", data: { title: "Newest" }, delta: null, activity: null },
      { id: 11, item: "8", collection: "games", data: { title: "Other" }, delta: null, activity: null },
      { id: 10, item: "9", collection: "games", data: { title: "Middle" }, delta: null, activity: null },
      { id: 7, item: "9", collection: "games", data: { title: "Oldest" }, delta: null, activity: null },
    ];

    expect(previousRevisionDataMap(revisions, [revisions[0], revisions[2], revisions[1]])).toEqual({
      12: { title: "Middle" },
      10: { title: "Oldest" },
      11: null,
    });
  });

  it("handles unsorted revisions, null snapshots, and absent targets", () => {
    const revisions = [
      { id: 2, item: "4", collection: "games", data: null, delta: null, activity: null },
      { id: 5, item: "4", collection: "games", data: { title: "Current" }, delta: null, activity: null },
    ];
    const absentTarget = {
      id: 99,
      item: "missing",
      collection: "games",
      data: null,
      delta: null,
      activity: null,
    };

    expect(previousRevisionDataMap(revisions, [revisions[1], absentTarget])).toEqual({
      5: null,
      99: null,
    });
  });

  it("accepts one or several activity actions", async () => {
    const fetchMock = mockDirectusFetch([{ match: "/activity?", data: [] }]);

    await fetchActivity("games_links", "create", 3);
    await fetchActivity("games_links", ["create", "update"], 4);

    const first = new URL(String(fetchMock.mock.calls[0][0]));
    const second = new URL(String(fetchMock.mock.calls[1][0]));
    expect(first.searchParams.get("filter[action][_in]")).toBe("create");
    expect(first.searchParams.get("limit")).toBe("3");
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

  it("groups genre names by games_id, dropping rows with no game or genre name", async () => {
    const fetchMock = mockDirectusFetch([{
      match: "/items/games_genres?",
      data: [
        { games_id: 7, genres_id: { name: "Adventure" } },
        { games_id: 7, genres_id: { name: "RPG" } },
        { games_id: 8, genres_id: { name: "Adventure" } },
        { games_id: null, genres_id: { name: "Orphan" } },
        { games_id: 9, genres_id: { name: "" } },
        { games_id: 9, genres_id: null },
      ],
    }]);

    await expect(fetchAllGameGenres()).resolves.toEqual({
      7: ["Adventure", "RPG"],
      8: ["Adventure"],
    });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("fields")).toBe("games_id,genres_id.name");
    expect(url.searchParams.get("limit")).toBe("-1");
  });

  it("avoids a request for an empty id set and groups sections by game id", async () => {
    const emptyFetch = mockDirectusFetch([]);
    await expect(fetchGameSectionsByGameIds([])).resolves.toEqual({});
    expect(emptyFetch).not.toHaveBeenCalled();

    const fetchMock = mockDirectusFetch([{
      match: "/items/game_sections?",
      data: [
        { id: 1, number: 1, title: "The Arrival", games_id: 7 },
        { id: 2, number: 2, title: "The Storm", games_id: 7 },
        { id: 3, number: 1, title: "Chapter 1", games_id: 8 },
      ],
    }]);

    await expect(fetchGameSectionsByGameIds([7, 8])).resolves.toEqual({
      7: [
        { id: 1, number: 1, title: "The Arrival" },
        { id: 2, number: 2, title: "The Storm" },
      ],
      8: [{ id: 3, number: 1, title: "Chapter 1" }],
    });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("filter[games_id][_in]")).toBe("7,8");
    expect(url.searchParams.get("fields")).toBe("id,number,title,games_id");
  });

  it("groups sections by bundle member id", async () => {
    const fetchMock = mockDirectusFetch([{
      match: "/items/game_sections?",
      data: [{ id: 9, number: 1, title: "Episode 1", bundle_member_id: 41 }],
    }]);

    await expect(fetchGameSectionsByBundleMemberIds([41])).resolves.toEqual({
      41: [{ id: 9, number: 1, title: "Episode 1" }],
    });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("filter[bundle_member_id][_in]")).toBe("41");
  });

  it("skips rows with a missing foreign key and tolerates an absent data array", async () => {
    mockDirectusFetch([{
      match: "/items/game_sections?",
      data: [
        { id: 1, number: 1, title: "Orphan", games_id: null },
        { id: 2, number: 1, title: "Valid", games_id: 7 },
      ],
    }]);
    await expect(fetchGameSectionsByGameIds([7])).resolves.toEqual({
      7: [{ id: 2, number: 1, title: "Valid" }],
    });

    mockDirectusFetch([{ match: "/items/game_sections?", data: undefined }]);
    await expect(fetchGameSectionsByGameIds([7])).resolves.toEqual({});
  });
});
