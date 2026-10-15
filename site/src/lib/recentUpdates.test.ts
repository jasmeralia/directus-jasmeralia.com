import { describe, expect, it, vi } from "vitest";

import { mockDirectusFetch } from "../test/directus-mock";
import { fetchRecentUpdates, formatUpdateTimestamp } from "./recentUpdates";

type FeedFixture = {
  games?: unknown[];
  reviews?: unknown[];
  tierLists?: unknown[];
  bundleMembers?: unknown[];
  sections?: unknown[];
  links?: unknown[];
  tierActivities?: unknown[];
  linkActivities?: unknown[];
  genreActivities?: unknown[];
  gameRows?: unknown[];
  reviewRows?: unknown[];
  tierListRows?: unknown[];
  bundleMemberRows?: unknown[];
  sectionRows?: unknown[];
  linkRows?: unknown[];
  genreRows?: unknown[];
  tierGameRows?: unknown[];
};

function mockFeed(fixture: FeedFixture = {}) {
  mockDirectusFetch([
    { match: /\/revisions\?.*collection\]\[_eq\]=games(?:&|$)/, data: fixture.games ?? [] },
    { match: /\/revisions\?.*collection\]\[_eq\]=reviews(?:&|$)/, data: fixture.reviews ?? [] },
    { match: /\/revisions\?.*collection\]\[_eq\]=tier_lists(?:&|$)/, data: fixture.tierLists ?? [] },
    { match: /\/revisions\?.*collection\]\[_eq\]=game_bundle_members(?:&|$)/, data: fixture.bundleMembers ?? [] },
    { match: /\/revisions\?.*collection\]\[_eq\]=game_sections(?:&|$)/, data: fixture.sections ?? [] },
    { match: /\/revisions\?.*collection\]\[_eq\]=games_links(?:&|$)/, data: fixture.links ?? [] },
    { match: /\/activity\?.*tier_list_games(?:&|$)/, data: fixture.tierActivities ?? [] },
    { match: /\/activity\?.*games_links(?:&|$)/, data: fixture.linkActivities ?? [] },
    { match: /\/activity\?.*games_genres(?:&|$)/, data: fixture.genreActivities ?? [] },
    { match: /\/items\/tier_list_games\?/, data: fixture.tierGameRows ?? [] },
    { match: /\/items\/games_links\?/, data: fixture.linkRows ?? [] },
    { match: /\/items\/reviews\?/, data: fixture.reviewRows ?? [] },
    { match: /\/items\/tier_lists\?/, data: fixture.tierListRows ?? [] },
    { match: /\/items\/game_bundle_members\?/, data: fixture.bundleMemberRows ?? [] },
    { match: /\/items\/games\?/, data: fixture.gameRows ?? [] },
    { match: /\/items\/game_sections\?/, data: fixture.sectionRows ?? [] },
    { match: /\/items\/games_genres\?/, data: fixture.genreRows ?? [] },
  ]);
}

const rev = (id: number, item: number, data: Record<string, unknown>, delta: Record<string, unknown> | null, action: string, timestamp: string) => ({
  id,
  item: String(item),
  collection: "games",
  data,
  delta,
  activity: { id: id + 1000, action, timestamp },
});

describe("fetchRecentUpdates", () => {
  it("adapts game, review, included-game, and tier events and filters metadata-only or incomplete rows", async () => {
    mockFeed({
      games: [
        rev(1, 1, { title: "Added Game", slug: "stale-slug" }, null, "create", "2026-08-10T12:00:00Z"),
        rev(2, 2, { title: "Updated Game", slug: "snapshot-slug" }, { player_status: "completed" }, "update", "2026-08-09T12:00:00Z"),
        rev(3, 3, { title: "Metadata Only", slug: "metadata-only" }, { slug: "metadata-only", engines: [], version_orion: "0.2" }, "update", "2026-08-08T12:00:00Z"),
        rev(4, 4, { slug: "no-title" }, { title: "No Title" }, "update", "2026-08-07T12:00:00Z"),
      ],
      reviews: [
        rev(40, 40, { title: "Published Review", slug: "published-review", status: "published", rating: 8 }, { status: "published" }, "update", "2026-08-08T12:00:00Z"),
        rev(41, 41, { title: "New Review", slug: "new-review", status: "draft" }, { status: "published" }, "update", "2026-08-07T12:00:00Z"),
        rev(42, 42, { title: "Draft Review", slug: "draft-review", status: "draft" }, { title: "Draft" }, "update", "2026-08-06T12:00:00Z"),
      ],
      bundleMembers: [
        rev(10, 10, { title: "First Member", games_id: 50, release_year: 2020 }, null, "create", "2026-08-06T12:00:00Z"),
        rev(11, 11, { title: "Second Member", games_id: 50 }, { current_section: 2 }, "update", "2026-08-05T12:00:00Z"),
        rev(12, 12, { title: "Orphan Member" }, null, "create", "2026-08-04T12:00:00Z"),
      ],
      tierActivities: [{ id: 20, item: "20", timestamp: "2026-08-04T12:00:00Z" }],
      tierLists: [rev(30, 30, { title: "Fresh Tier List", slug: "fresh-tier-list" }, null, "create", "2026-08-03T18:00:00Z")],
      gameRows: [
        { id: 1, title: "Added Game", slug: "live-slug", genres: [{ genres_id: { nsfw: true } }] },
        { id: 2, title: "Updated Game", slug: "snapshot-slug" },
        { id: 3, title: "Metadata Only", slug: "metadata-only" },
        { id: 50, title: "Collection", slug: "collection", nsfw: true },
      ],
      reviewRows: [
        { id: 40, title: "Published Review", slug: "published-review", game: { id: 1, title: "Added Game", nsfw: true } },
        { id: 41, title: "New Review", slug: "new-review", game: { id: 2, title: "Updated Game", nsfw: false } },
      ],
      bundleMemberRows: [
        { id: 10, title: "First Member", games_id: 50 },
        { id: 11, title: "Second Member", games_id: 50 },
      ],
      tierGameRows: [{ id: 20, tier_list_id: 31, game_id: 1, rating: "S" }],
      tierListRows: [
        { id: 30, title: "Fresh Tier List", slug: "fresh-tier-list", nsfw: true },
        { id: 31, title: "Favorites", slug: "favorites", nsfw: true },
      ],
    });

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

  it("uses the revision item as the slug fallback and applies the requested limit", async () => {
    mockFeed({
      games: [
        rev(101, 101, { title: "Newest" }, null, "create", "2026-08-03T12:00:00Z"),
        rev(102, 102, { title: "Middle", slug: "middle" }, null, "create", "2026-08-02T12:00:00Z"),
        rev(103, 103, { title: "Oldest", slug: "oldest" }, null, "create", "2026-08-01T12:00:00Z"),
      ],
    });

    const entries = await fetchRecentUpdates(2);
    expect(entries.map(({ subject }) => subject)).toEqual(["Newest", "Middle"]);
    expect(entries[0].link).toBe("https://assets.test/games/101/index.html");
  });

  it("filters incomplete source rows that cannot be resolved to a game", async () => {
    mockFeed({
      bundleMembers: [rev(1, 1, { title: "Orphan" }, null, "create", "2026-08-01T12:00:00Z")],
      bundleMemberRows: [{ id: 1, title: "Orphan", games_id: null }],
    });
    expect(await fetchRecentUpdates()).toEqual([]);
  });

  it("collapses same-tier-list additions within 30 minutes but keeps a later burst and ORs nsfw", async () => {
    mockFeed({
      tierActivities: [
        { id: 1, item: "1", timestamp: "2026-08-10T12:00:00Z" },
        { id: 2, item: "2", timestamp: "2026-08-10T12:15:00Z" },
        { id: 3, item: "3", timestamp: "2026-08-10T12:29:00Z" },
        { id: 4, item: "4", timestamp: "2026-08-10T12:45:00Z" },
        { id: 5, item: "5", timestamp: "2026-08-10T12:05:00Z" },
      ],
      tierGameRows: [1, 2, 3, 4].map((id) => ({ id, tier_list_id: 7, game_id: id, rating: "A" })).concat([{ id: 5, tier_list_id: 8, game_id: 5, rating: "B" }]),
      tierListRows: [
        { id: 7, title: "AVNs", slug: "avns", nsfw: false },
        { id: 8, title: "Isekai", slug: "isekai", nsfw: false },
      ],
      gameRows: [1, 2, 3, 4, 5].map((id) => ({ id, title: `Game ${id}`, slug: `game-${id}`, nsfw: id === 2 })),
    });
    const entries = await fetchRecentUpdates(20);
    expect(entries.filter((entry) => entry.subject === "AVNs")).toHaveLength(2);
    expect(entries.filter((entry) => entry.subject === "AVNs").map(({ timestamp }) => timestamp.toISOString()))
      .toEqual(["2026-08-10T12:45:00.000Z", "2026-08-10T12:29:00.000Z"]);
    expect(entries.find((entry) => entry.subject === "AVNs" && entry.timestamp.toISOString() === "2026-08-10T12:29:00.000Z")?.nsfw).toBe(true);
    expect(entries.filter((entry) => entry.subject === "Isekai")).toHaveLength(1);
  });

  it("collapses same-game update revisions within 30 minutes, but not across a gap or games", async () => {
    mockFeed({
      games: [
        rev(1, 1, { title: "Valhalla: Lilith Rising", slug: "valhalla" }, { player_status: "in_progress" }, "update", "2026-09-22T22:46:00Z"),
        rev(2, 1, { title: "Valhalla: Lilith Rising", slug: "valhalla" }, { section_noun: "Level" }, "update", "2026-09-22T22:51:00Z"),
        rev(3, 1, { title: "Valhalla: Lilith Rising", slug: "valhalla" }, { current_section: 1 }, "update", "2026-09-22T22:52:00Z"),
        rev(4, 1, { title: "Valhalla: Lilith Rising", slug: "valhalla" }, { player_status: "on_hold" }, "update", "2026-09-22T23:20:00Z"),
        rev(5, 2, { title: "Goddesses' Whim", slug: "goddesses-whim" }, { player_status: "in_progress" }, "update", "2026-09-22T22:50:00Z"),
      ],
      gameRows: [
        { id: 1, title: "Valhalla: Lilith Rising", slug: "valhalla" },
        { id: 2, title: "Goddesses' Whim", slug: "goddesses-whim" },
      ],
    });
    const entries = await fetchRecentUpdates(20);
    expect(entries.map(({ tag, subject, timestamp }) => [tag, subject, timestamp.toISOString()])).toEqual([
      ["updated", "Valhalla: Lilith Rising", "2026-09-22T23:20:00.000Z"],
      ["updated", "Valhalla: Lilith Rising", "2026-09-22T22:52:00.000Z"],
      ["updated", "Goddesses' Whim", "2026-09-22T22:50:00.000Z"],
    ]);
  });

  it("collapses same-bundle-member updates and keeps the parent title in the widget subject", async () => {
    mockFeed({
      bundleMembers: [
        rev(1, 10, { title: "First Member", games_id: 50 }, { current_section: 1 }, "update", "2026-09-22T22:00:00Z"),
        rev(2, 10, { title: "First Member", games_id: 50 }, { current_section: 2 }, "update", "2026-09-22T22:10:00Z"),
      ],
      bundleMemberRows: [{ id: 10, title: "First Member", games_id: 50 }],
      gameRows: [{ id: 50, title: "Collection", slug: "collection" }],
    });
    const entries = await fetchRecentUpdates(20);
    expect(entries.map(({ tag, subject, timestamp }) => [tag, subject, timestamp.toISOString()]))
      .toEqual([["updated", "Collection: First Member", "2026-09-22T22:10:00.000Z"]]);
  });

  it("merges a game creation, genre addition, and link event into one added entry", async () => {
    mockFeed({
      games: [rev(1, 1, { title: "Morningstar", slug: "morningstar" }, null, "create", "2026-10-01T10:00:00Z")],
      genreActivities: [{ id: 2, item: "20", collection: "games_genres", action: "create", timestamp: "2026-10-01T10:10:00Z" }],
      genreRows: [{ id: 20, games_id: 1, genres_id: { name: "Adventure" } }],
      linkActivities: [{ id: 3, item: "30", collection: "games_links", action: "create", timestamp: "2026-10-01T10:15:00Z" }],
      linkRows: [{ id: 30, games_id: 1, url: "https://example.test", kind: "gamestorylog" }],
      gameRows: [{ id: 1, title: "Morningstar", slug: "morningstar", section_style: "linear", section_noun: "Chapter" }],
    });
    const entries = await fetchRecentUpdates(20);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ tag: "added", subject: "Morningstar", link: "https://assets.test/games/morningstar/index.html" });
  });

  it("shows genre, link, section-count, and included-game changes as updated entries", async () => {
    mockFeed({
      games: [rev(1, 1, { title: "Morningstar", slug: "morningstar" }, { slug: "morningstar" }, "update", "2026-10-01T09:00:00Z")],
      genreActivities: [{ id: 2, item: "20", collection: "games_genres", action: "create", timestamp: "2026-10-01T10:00:00Z" }],
      genreRows: [{ id: 20, games_id: 1, genres_id: { name: "Adventure" } }],
      linkActivities: [{ id: 3, item: "30", collection: "games_links", action: "create", timestamp: "2026-10-01T11:00:00Z" }],
      linkRows: [{ id: 30, games_id: 1, url: "https://example.test", kind: "gamestorylog" }],
      sections: [
        { id: 2, item: "2", collection: "game_sections", data: { games_id: 1, number: 2, title: "Chapter 2" }, delta: {}, activity: { action: "create", timestamp: "2026-10-01T12:00:00Z" } },
        { id: 1, item: "1", collection: "game_sections", data: { games_id: 1, number: 1, title: "Chapter 1" }, delta: {}, activity: { action: "create", timestamp: "2026-10-01T08:00:00Z" } },
      ],
      bundleMembers: [rev(10, 10, { title: "Bonus Story", games_id: 2 }, { current_section: 2 }, "update", "2026-10-01T13:00:00Z")],
      bundleMemberRows: [{ id: 10, title: "Bonus Story", games_id: 2 }],
      gameRows: [
        { id: 1, title: "Morningstar", slug: "morningstar", section_style: "linear", section_noun: "Chapter" },
        { id: 2, title: "Collection", slug: "collection" },
      ],
      sectionRows: [
        { id: 1, games_id: 1, number: 1, title: "Chapter 1" },
        { id: 2, games_id: 1, number: 2, title: "Chapter 2" },
      ],
    });
    const entries = await fetchRecentUpdates(20);
    expect(entries.map(({ tag, subject, timestamp }) => [tag, subject, timestamp.toISOString()])).toEqual([
      ["updated", "Collection: Bonus Story", "2026-10-01T13:00:00.000Z"],
      ["updated", "Morningstar", "2026-10-01T12:00:00.000Z"],
      ["updated", "Morningstar", "2026-10-01T11:00:00.000Z"],
      ["updated", "Morningstar", "2026-10-01T10:00:00.000Z"],
    ]);
  });

  it("does not show review updates or tier-list updates in the widget", async () => {
    mockFeed({
      reviews: [rev(1, 1, { title: "Review", slug: "review", status: "published" }, { title: "Edited" }, "update", "2026-10-01T10:00:00Z")],
      tierLists: [rev(2, 2, { title: "Tier List", slug: "tiers" }, { title: "Changed" }, "update", "2026-10-01T09:00:00Z")],
      reviewRows: [{ id: 1, title: "Review", slug: "review", game: { title: "Game" } }],
      tierListRows: [{ id: 2, title: "Tier List", slug: "tiers" }],
    });
    expect(await fetchRecentUpdates()).toEqual([]);
  });
});

describe("formatUpdateTimestamp", () => {
  it("formats a fixed timestamp in the configured site timezone", () => {
    vi.stubEnv("SITE_TIMEZONE", "America/Los_Angeles");
    expect(formatUpdateTimestamp(new Date("2026-08-14T20:05:00Z"))).toBe("Aug 14, 1:05 PM PDT");
    vi.stubEnv("SITE_TIMEZONE", "");
    expect(formatUpdateTimestamp(new Date("2026-08-14T20:05:00Z"))).toBe("Aug 14, 1:05 PM PDT");
  });
});
