import { describe, expect, it } from "vitest";

import type { Revision } from "./changelog";
import {
  describeMusicListEvent,
  describeMusicTrackRun,
  groupMusicTrackRuns,
  resolveMusicListGames,
} from "./music-events";

const revision = (
  id: number,
  collection: string,
  item: number,
  data: Record<string, unknown> | null,
  delta: Record<string, unknown> | null,
  action: string,
  timestamp = "2026-10-01T12:00:00Z",
): Revision => ({
  id, collection, item: String(item), data, delta,
  activity: { id: id + 1000, action, timestamp },
});

describe("music events", () => {
  it("describes list creation with a URL or a non-empty fallback", () => {
    expect(describeMusicListEvent({ revision: revision(1, "games_music_lists", 4, { title: "OST", url: "https://music.test" }, null, "create") })).toMatchObject({
      type: "music_list_added", title: "Music List Added", subject: "OST", body: "**URL**: https://music.test",
    });
    expect(describeMusicListEvent({ revision: revision(2, "games_music_lists", 4, { title: "OST" }, null, "create") })?.body).toBe("New music list.");
  });

  it("describes visible list updates and omits sort-only changes", () => {
    const old = { title: "Original", url: "https://old.test", description: "secret old description" };
    const update = (delta: Record<string, unknown>) => describeMusicListEvent({
      revision: revision(3, "games_music_lists", 4, { ...old, ...delta }, delta, "update"), previousData: old,
    });
    expect(update({ sort: 2 })).toBeNull();
    expect(update({ description: "secret new description" })?.body).toBe("**Description**: updated");
    expect(update({ url: "https://new.test" })?.body).toBe("**URL**: https://old.test -> https://new.test");
    expect(update({ title: "Renamed", url: "https://new.test", description: "new" })?.body).toBe(
      "**Title**: Original -> Renamed\n**URL**: https://old.test -> https://new.test\n**Description**: updated",
    );
  });

  it("groups track creates, mixed revisions, and a 30-track import into one run", () => {
    const makeTrack = (id: number, action: string, delta: Record<string, unknown> | null = null) => revision(
      id, "games_tracks", id, {
        games_music_lists_id: 9,
        title: `track title ${id}`, artist: "artist secret", url: "https://track.secret",
        scene: "scene secret", characters: ["character secret"], note: "note secret",
      }, delta, action,
    );
    const creates = groupMusicTrackRuns(Array.from({ length: 30 }, (_, index) => makeTrack(index + 1, "create")));
    expect(creates).toHaveLength(1);
    expect(describeMusicTrackRun(creates[0], "Soundtrack")?.event).toMatchObject({
      type: "music_tracks_changed", title: "Tracks Added", subject: "Soundtrack", body: "**Tracks**: 30 added",
    });
    const mixed = groupMusicTrackRuns([
      makeTrack(40, "create"), makeTrack(41, "update", { artist: "new" }),
    ]);
    expect(describeMusicTrackRun(mixed[0], "Soundtrack")?.event).toMatchObject({ title: "Tracks Changed", body: "**Tracks**: 1 added, 1 updated" });
    const onlyUpdates = groupMusicTrackRuns([makeTrack(42, "update", { title: "new" })]);
    expect(describeMusicTrackRun(onlyUpdates[0], "Soundtrack")?.event.title).toBe("Tracks Updated");
    const onlySort = groupMusicTrackRuns([makeTrack(43, "update", { sort: 2 })]);
    expect(describeMusicTrackRun(onlySort[0], "Soundtrack")).toBeNull();
    const removed = groupMusicTrackRuns([makeTrack(44, "delete")]);
    expect(describeMusicTrackRun(removed[0], "Soundtrack")?.event.body).toBe("**Tracks**: 1 removed");
    const body = describeMusicTrackRun(mixed[0], "Soundtrack")?.event.body ?? "";
    for (const secret of ["track title", "artist secret", "https://track.secret", "scene secret", "character secret", "note secret"]) {
      expect(body).not.toContain(secret);
    }
  });

  it("attributes lists from revisions or current game data and leaves unresolved lists out", () => {
    expect(resolveMusicListGames(
      [revision(1, "games_music_lists", 8, { games_id: 22 }, null, "delete")],
      [{ id: 9, title: "Current" }], 23,
    )).toEqual(new Map([[8, 22], [9, 23]]));
    expect(resolveMusicListGames([], [{ id: 10, title: "No parent" }]).has(10)).toBe(false);
    const orphan = groupMusicTrackRuns([revision(2, "games_tracks", 2, { title: "orphan" }, null, "create")]);
    expect(orphan).toEqual([]);
  });
});
