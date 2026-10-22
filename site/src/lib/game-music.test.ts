import { describe, expect, it } from "vitest";
import { groupTracksByCategory, hasMusic, normalizeCharacters, orderedMusicLists, type MusicList, type MusicTrack } from "./game-music";

describe("orderedMusicLists", () => {
  it("sorts by sort, then id, leaves null sorts last, and does not mutate input", () => {
    const lists: MusicList[] = [
      { id: 4, sort: null, title: "late", tracks: [{ id: 3, sort: null, title: "c", url: "x" }, { id: 2, sort: 2, title: "b", url: "x" }, { id: 1, sort: 2, title: "a", url: "x" }] },
      { id: 3, sort: 1, title: "first" },
      { id: 2, sort: 1, title: "second" },
    ];
    const before = structuredClone(lists);
    const result = orderedMusicLists(lists);
    expect(result.map((list) => list.id)).toEqual([2, 3, 4]);
    expect(result[2].tracks?.map((track) => track.id)).toEqual([1, 2, 3]);
    expect(lists).toEqual(before);
    expect(result).not.toBe(lists);
    expect(orderedMusicLists(null)).toEqual([]);
  });
});

describe("groupTracksByCategory", () => {
  it("groups in first appearance order after sort and treats blank categories as null", () => {
    const tracks: MusicTrack[] = [
      { id: 5, sort: 5, title: "second B", url: "x", category: "B" },
      { id: 3, sort: 3, title: "blank", url: "x", category: "  " },
      { id: 4, sort: 4, title: "second null", url: "x", category: null },
      { id: 2, sort: 2, title: "first B", url: "x", category: " B " },
      { id: 1, sort: 1, title: "A", url: "x", category: "A" },
    ];
    const groups = groupTracksByCategory(tracks);
    expect(groups.map((group) => group.category)).toEqual(["A", "B", null]);
    expect(groups.map((group) => group.tracks.map((track) => track.title))).toEqual([
      ["A"], ["first B", "second B"], ["blank", "second null"],
    ]);
    expect(tracks[0].title).toBe("second B");
    expect(groupTracksByCategory(undefined)).toEqual([]);
  });
});

describe("normalizeCharacters", () => {
  it("trims string array entries and rejects other JSON shapes", () => {
    expect(normalizeCharacters([" Alice ", "", "  ", 4, null, "Bob"])).toEqual(["Alice", "Bob"]);
    expect(normalizeCharacters({ name: "Alice" })).toEqual([]);
    expect(normalizeCharacters("Alice")).toEqual([]);
    expect(normalizeCharacters(null)).toEqual([]);
  });
});

describe("hasMusic", () => {
  it("requires a nonblank list URL or at least one track", () => {
    expect(hasMusic(null)).toBe(false);
    expect(hasMusic({ music_lists: [] })).toBe(false);
    expect(hasMusic({ music_lists: [{ title: "empty", url: "  " }] })).toBe(false);
    expect(hasMusic({ music_lists: [{ title: "link", url: "https://example.com" }] })).toBe(true);
    expect(hasMusic({ music_lists: [{ title: "tracks", tracks: [{ title: "song", url: "https://example.com" }] }] })).toBe(true);
  });
});
