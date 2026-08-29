import { describe, expect, it } from "vitest";

import { mockDirectusFetch, type DirectusMockRoute } from "../test/directus-mock";
import { buildGameHistory } from "./game-history";

const endpoint = {
  gameRevisions: /\/revisions\?.*%5B_eq%5D=games&/,
  reviewRevisions: /\/revisions\?.*%5B_eq%5D=reviews&/,
  tierActivities: /\/activity\?.*%5B_eq%5D=tier_list_games&/,
  tierRevisions: /\/revisions\?.*%5B_eq%5D=tier_list_games&/,
  linkActivities: /\/activity\?.*%5B_eq%5D=games_links&/,
  bundleRevisions: /\/revisions\?.*%5B_eq%5D=game_bundle_members&/,
  genres: "/items/games_genres?",
};

const emptyHistoryRoutes = (): DirectusMockRoute[] => [
  { match: endpoint.gameRevisions, data: [] },
  { match: endpoint.reviewRevisions, data: [] },
  { match: endpoint.tierActivities, data: [] },
  { match: endpoint.tierRevisions, data: [] },
  { match: endpoint.linkActivities, data: [] },
  { match: endpoint.bundleRevisions, data: [] },
  { match: endpoint.genres, data: [] },
];

describe("buildGameHistory", () => {
  it("combines meaningful game, review, bundle, tier, and link events newest first", async () => {
    mockDirectusFetch([
      {
        match: endpoint.gameRevisions,
        data: [
          {
            id: 30,
            item: "7",
            collection: "games",
            data: { title: "New & <Game>" },
            delta: { title: "New & <Game>" },
            activity: { action: "update", timestamp: "2026-07-10T12:00:00Z" },
          },
          {
            id: 20,
            item: "7",
            collection: "games",
            data: { title: "Old <Game>", release_year: 2025 },
            delta: { slug: "old-game" },
            activity: { action: "update", timestamp: "2026-07-02T12:00:00Z" },
          },
          {
            id: 10,
            item: "7",
            collection: "games",
            data: { release_year: 2024, player_status: "not_started" },
            delta: null,
            activity: { action: "update", timestamp: "2026-07-01T12:00:00Z" },
          },
        ],
      },
      {
        match: endpoint.reviewRevisions,
        data: [
          {
            id: 42,
            item: "11",
            collection: "reviews",
            data: { title: "Launch Review" },
            delta: {},
            activity: { action: "create", timestamp: "2026-07-09T12:00:00Z" },
          },
          {
            id: 41,
            item: "11",
            collection: "reviews",
            data: { title: "Launch Review", rating: 4 },
            delta: { rating: 4 },
            activity: { action: "update", timestamp: "2026-07-08T12:00:00Z" },
          },
          {
            id: 40,
            item: "12",
            collection: "reviews",
            data: { title: "" },
            delta: { status: "published" },
            activity: { action: "update", timestamp: "2026-07-07T12:00:00Z" },
          },
          {
            id: 39,
            item: "12",
            collection: "reviews",
            data: { title: "Ignored" },
            delta: { slug: "ignored" },
            activity: { action: "update", timestamp: "2026-07-06T12:00:00Z" },
          },
        ],
      },
      {
        match: endpoint.tierActivities,
        data: [
          {
            id: 70,
            item: "21",
            collection: "tier_list_games",
            action: "create",
            timestamp: "2026-07-05T12:00:00Z",
          },
          {
            id: 71,
            item: "999",
            collection: "tier_list_games",
            action: "create",
            timestamp: "2026-07-05T11:00:00Z",
          },
        ],
      },
      {
        match: endpoint.tierRevisions,
        data: [
          {
            id: 82,
            item: "21",
            collection: "tier_list_games",
            data: { rating: "B" },
            delta: { rating: "B" },
            activity: { action: "update", timestamp: "2026-07-04T12:00:00Z" },
          },
          {
            id: 81,
            item: "21",
            collection: "tier_list_games",
            data: { rating: "A" },
            delta: { title: "ignored" },
            activity: { action: "update", timestamp: "2026-07-03T12:00:00Z" },
          },
          {
            id: 80,
            item: "21",
            collection: "tier_list_games",
            data: { rating: null },
            delta: { rating: "A" },
            activity: { action: "create", timestamp: "2026-07-02T12:00:00Z" },
          },
        ],
      },
      {
        match: endpoint.linkActivities,
        data: [
          {
            id: 90,
            item: "31",
            collection: "games_links",
            action: "create",
            timestamp: "2026-07-03T18:00:00Z",
          },
          {
            id: 91,
            item: "32",
            collection: "games_links",
            action: "update",
            timestamp: "2026-07-03T17:00:00Z",
          },
          {
            id: 92,
            item: "999",
            collection: "games_links",
            action: "create",
            timestamp: "2026-07-03T16:00:00Z",
          },
        ],
      },
      {
        match: endpoint.bundleRevisions,
        data: [
          {
            id: 62,
            item: "41",
            collection: "game_bundle_members",
            data: { title: "Old Member", current_section: 2 },
            delta: { current_section: 2 },
            activity: { action: "update", timestamp: "2026-07-06T18:00:00Z" },
          },
          {
            id: 61,
            item: "41",
            collection: "game_bundle_members",
            data: { title: "Old Member", current_section: 1 },
            delta: null,
            activity: { action: "update", timestamp: "2026-07-01T18:00:00Z" },
          },
        ],
      },
      {
        match: endpoint.genres,
        data: [{ genres_id: { name: "Adventure" } }],
      },
    ]);

    const entries = await buildGameHistory({
      gameId: 7,
      reviews: [{ id: 11 }, { id: 12 }],
      tierEntries: [{ id: 21, rating: "B", tier_list_id: { title: "Favorites" } }],
      links: [
        { id: 31, kind: "walkthrough", url: "https://guide.test" },
        { id: 32, kind: "download", url: "https://store.test" },
      ],
      bundleMembers: [{ id: 41, title: "Current Member" }],
    });

    expect(entries.map(({ title }) => title)).toEqual([
      "Game Updated",
      "Review Published — Launch Review",
      "Review Updated — Launch Review",
      "Review Published — Untitled",
      "Included Game Updated - Current Member",
      "Added to Tier List — Favorites (B)",
      "Tier Changed — Favorites (A → B)",
      "Walkthrough Added",
      "Download Updated",
      "Included Game Added - Current Member",
      "Game Added",
    ]);
    expect(entries.map(({ date }) => date.getTime())).toEqual(
      entries.map(({ date }) => date.getTime()).toSorted((a, b) => b - a),
    );
    expect(entries[0].bodyHtml).toBe(
      '<ul class="history-changes"><li><strong>Title</strong>: Old &lt;Game&gt; → New &amp; &lt;Game&gt;</li></ul>',
    );
    expect(entries.at(-1)?.bodyHtml).toContain("<strong>Genres</strong>: Adventure");
  });

  it("formats a game update whose revision data snapshot is null", async () => {
    const routes = emptyHistoryRoutes();
    routes[0] = {
      match: endpoint.gameRevisions,
      data: [
        {
          id: 201,
          item: "7",
          collection: "games",
          data: null,
          delta: null,
          activity: { action: "update", timestamp: "2026-07-11T12:00:00Z" },
        },
        {
          id: 200,
          item: "7",
          collection: "games",
          data: { title: "Baseline" },
          delta: { title: "Baseline" },
          activity: { action: "create", timestamp: "2026-07-01T12:00:00Z" },
        },
      ],
    };
    mockDirectusFetch(routes);

    const entries = await buildGameHistory({
      gameId: 7,
      reviews: [],
      tierEntries: [],
      links: [],
      bundleMembers: [],
    });

    expect(entries.map(({ title }) => title)).toEqual(["Game Added"]);
  });

  it("formats an included-game update whose delta is null", async () => {
    const routes = emptyHistoryRoutes();
    routes[5] = {
      match: endpoint.bundleRevisions,
      data: [
        {
          id: 502,
          item: "42",
          collection: "game_bundle_members",
          data: { title: "Member Two", current_section: 2 },
          delta: null,
          activity: { action: "update", timestamp: "2026-07-12T12:00:00Z" },
        },
        {
          id: 501,
          item: "42",
          collection: "game_bundle_members",
          data: { title: "Member Two", current_section: 1 },
          delta: { title: "Member Two" },
          activity: { action: "update", timestamp: "2026-07-11T12:00:00Z" },
        },
      ],
    };
    mockDirectusFetch(routes);

    const entries = await buildGameHistory({
      gameId: 7,
      reviews: [],
      tierEntries: [],
      links: [],
      bundleMembers: [{ id: 42, title: "Member Two" }],
    });

    expect(entries.map(({ title }) => title)).toEqual(["Included Game Added - Member Two"]);
  });

  it("rejects a revision without a valid required timestamp", async () => {
    const routes = emptyHistoryRoutes();
    routes[0] = {
      match: endpoint.gameRevisions,
      data: [{
        id: 101,
        item: "7",
        collection: "games",
        data: { title: "No Date" },
        delta: null,
        activity: { action: "create" },
      }],
    };
    mockDirectusFetch(routes);

    await expect(buildGameHistory({
      gameId: 7,
      reviews: [],
      tierEntries: [],
      links: [],
      bundleMembers: [],
    })).rejects.toThrow("Missing required history timestamp: game revision 101");
  });
});
