import { describe, expect, it, vi } from "vitest";

import { mockDirectusFetch } from "../test/directus-mock";
import { fetchRecentUpdates, formatUpdateTimestamp } from "./recentUpdates";

const baseRoutes = (gameRevisions: unknown[]) => [
  { match: "/revisions?filter[collection][_eq]=games", data: gameRevisions },
  { match: "/revisions?filter[collection][_eq]=reviews", data: [] },
  { match: "/revisions?filter[collection][_eq]=game_bundle_members", data: [] },
  { match: "/activity?filter[collection][_eq]=tier_list_games", data: [] },
  { match: "/revisions?filter[collection][_eq]=tier_lists", data: [] },
];

describe("fetchRecentUpdates", () => {
  it("builds each update kind and filters invalid or incomplete source rows", async () => {
    mockDirectusFetch([
      {
        match: "/revisions?filter[collection][_eq]=games",
        data: [
          {
            item: "1",
            data: { title: "Added Game", slug: "stale-slug" },
            delta: null,
            activity: { action: "create", timestamp: "2026-08-10T12:00:00Z" },
          },
          {
            item: "2",
            data: { title: "Updated Game", slug: "snapshot-slug" },
            delta: { player_status: "completed" },
            activity: { action: "update", timestamp: "2026-08-09T12:00:00Z" },
          },
          {
            item: "3",
            data: { title: "Metadata Only", slug: "metadata-only" },
            delta: { slug: "metadata-only", engines: [] },
            activity: { action: "update", timestamp: "2026-08-08T12:00:00Z" },
          },
          {
            item: "4",
            data: { title: "Invalid Date", slug: "invalid-date" },
            delta: { title: "Invalid Date" },
            activity: { action: "update", timestamp: "not-a-date" },
          },
          {
            item: "5",
            data: { slug: "no-title" },
            delta: { title: "No Title" },
            activity: { action: "update", timestamp: "2026-08-08T12:00:00Z" },
          },
        ],
      },
      {
        match: "/revisions?filter[collection][_eq]=reviews",
        data: [
          {
            item: "40",
            data: { title: "Published Review", slug: "published-review", status: "published" },
            delta: {},
            activity: { action: "update", timestamp: "2026-08-08T12:00:00Z" },
          },
          {
            item: "41",
            data: { title: "New Review", slug: "new-review", status: "draft" },
            delta: { status: "published" },
            activity: { action: "update", timestamp: "2026-08-07T12:00:00Z" },
          },
          {
            item: "42",
            data: { title: "Draft Review", slug: "draft-review", status: "draft" },
            delta: { title: "Draft Review" },
            activity: { action: "update", timestamp: "2026-08-06T12:00:00Z" },
          },
        ],
      },
      {
        match: "/revisions?filter[collection][_eq]=game_bundle_members",
        data: [
          {
            item: "10",
            data: { title: "Snapshot Member" },
            delta: null,
            activity: { action: "create", timestamp: "2026-08-06T12:00:00Z" },
          },
          {
            item: "11",
            data: { title: "Updated Member" },
            delta: { current_section: 2 },
            activity: { action: "update", timestamp: "2026-08-05T12:00:00Z" },
          },
          {
            item: "12",
            data: { title: "Orphan Member" },
            delta: null,
            activity: { action: "create", timestamp: "2026-08-04T12:00:00Z" },
          },
          {
            item: "13",
            data: { title: "Metadata Member" },
            delta: { updated_at: "today" },
            activity: { action: "update", timestamp: "2026-08-03T12:00:00Z" },
          },
        ],
      },
      {
        match: "/activity?filter[collection][_eq]=tier_list_games",
        data: [
          { item: "20", timestamp: "2026-08-04T12:00:00Z" },
          { item: "21", timestamp: "2026-08-03T12:00:00Z" },
          { item: "22", timestamp: "bad-date" },
        ],
      },
      {
        match: "/revisions?filter[collection][_eq]=tier_lists",
        data: [
          {
            item: "30",
            data: { title: "Fresh Tier List", slug: "fresh-tier-list" },
            delta: null,
            activity: { action: "create", timestamp: "2026-08-03T18:00:00Z" },
          },
          {
            item: "31",
            data: { title: "Edited Tier List", slug: "edited-tier-list" },
            delta: { title: "Edited Tier List" },
            activity: { action: "update", timestamp: "2026-08-03T17:00:00Z" },
          },
          {
            item: "32",
            data: { title: "Missing Slug" },
            delta: null,
            activity: { action: "create", timestamp: "2026-08-03T16:00:00Z" },
          },
        ],
      },
      {
        match: "/items/games?filter[id][_in]=1,2,3,4,5",
        data: [
          { id: 1, slug: "live-slug", genres: [{ genres_id: { nsfw: true } }] },
          { id: 2, slug: "snapshot-slug", nsfw: false },
        ],
      },
      {
        match: "/items/reviews?filter[id][_in]=40,41,42",
        data: [
          { id: 40, game: { id: 1, nsfw: true } },
          { id: 41, game: { id: 2, nsfw: false } },
        ],
      },
      {
        match: "/items/tier_lists?filter[id][_in]=30,31,32",
        data: [{ id: 30, nsfw: true }],
      },
      {
        match: "/items/game_bundle_members?filter[id][_in]=10,11,12,13",
        data: [
          { id: 10, title: "First Member", games_id: { id: 50, title: "Collection", slug: "collection", nsfw: true } },
          { id: 11, title: "Second Member", games_id: { title: "Collection", slug: "collection" } },
          { id: 12, title: "Orphan Member", games_id: null },
          { id: 13, title: "Metadata Member", games_id: { title: "Collection", slug: "collection" } },
        ],
      },
      {
        match: "/items/tier_list_games?filter[id][_in]=20,21,22",
        data: [
          { id: 20, tier_list_id: { title: "Favorites", slug: "favorites", nsfw: true } },
          { id: 21, tier_list_id: { title: "Incomplete", slug: "" } },
          { id: 22, tier_list_id: { title: "Bad Date", slug: "bad-date" } },
        ],
      },
    ]);

    const entries = await fetchRecentUpdates(20);

    expect(entries.map(({ tag, subject }) => [tag, subject])).toEqual([
      ["added", "Added Game"],
      ["updated", "Updated Game"],
      ["review", "Published Review"],
      ["review", "New Review"],
      ["added", "Collection: First Member"],
      ["updated", "Collection: Second Member"],
      ["tier-updated", "Favorites"],
      ["tier-added", "Fresh Tier List"],
    ]);
    expect(entries[0].link).toBe("https://assets.test/games/live-slug/index.html");
    expect(entries[1].link).toBe("https://assets.test/games/snapshot-slug/index.html");
    expect(Object.fromEntries(entries.map(({ subject, nsfw }) => [subject, nsfw]))).toMatchObject({
      "Added Game": true,
      "Updated Game": false,
      "Published Review": true,
      "New Review": false,
      "Favorites": true,
      "Fresh Tier List": true,
    });
    expect(entries.map(({ subject }) => subject)).not.toContain("Metadata Only");
    expect(entries.map(({ timestamp }) => timestamp.getTime())).toEqual(
      entries.map(({ timestamp }) => timestamp.getTime()).toSorted((a, b) => b - a),
    );
  });

  it("falls back to the revision item for a slug and applies the requested limit", async () => {
    mockDirectusFetch([
      ...baseRoutes([
        {
          item: "101",
          data: { title: "Newest" },
          delta: null,
          activity: { action: "create", timestamp: "2026-08-03T12:00:00Z" },
        },
        {
          item: "102",
          data: { title: "Middle", slug: "middle" },
          delta: null,
          activity: { action: "create", timestamp: "2026-08-02T12:00:00Z" },
        },
        {
          item: "103",
          data: { title: "Oldest", slug: "oldest" },
          delta: null,
          activity: { action: "create", timestamp: "2026-08-01T12:00:00Z" },
        },
      ]),
      { match: "/items/games?filter[id][_in]=101,102,103", data: [] },
    ]);

    const entries = await fetchRecentUpdates(2);

    expect(entries.map(({ subject }) => subject)).toEqual(["Newest", "Middle"]);
    expect(entries[0].link).toBe("https://assets.test/games/101/index.html");
  });
});

describe("formatUpdateTimestamp", () => {
  it("formats a fixed timestamp in the configured site timezone", () => {
    vi.stubEnv("SITE_TIMEZONE", "America/Los_Angeles");
    expect(formatUpdateTimestamp(new Date("2026-08-14T20:05:00Z"))).toBe(
      "Aug 14, 1:05 PM PDT",
    );
  });
});
