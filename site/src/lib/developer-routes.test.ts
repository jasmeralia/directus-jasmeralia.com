import { describe, expect, it } from "vitest";

import { mockDirectusFetch } from "../test/directus-mock";
import {
  buildDeveloperDetailPaths,
  buildDeveloperStatusPaths,
  fetchDeveloperRouteSource,
} from "./developer-routes";

const developers = [
  { slug: "alpha", name: "Alpha Studio" },
  { slug: "beta", name: "Beta Works" },
  { slug: null, name: "No Slug" },
];

const games = [
  {
    id: 1,
    title: "Zebra",
    game_status: "released",
    player_status: "completed",
    developers: [{ developers_id: { slug: "alpha" } }],
  },
  {
    id: 2,
    title: "alpha",
    game_status: "in_development",
    player_status: "in_progress",
    developers: [
      { developers_id: { slug: "alpha" } },
      { developers_id: { slug: "alpha" } },
      { developers_id: { slug: "beta" } },
    ],
  },
  {
    id: 3,
    title: "Unknown Game",
    game_status: "released",
    player_status: "not_started",
    developers: [],
  },
];

const reviews = [
  { id: 10, title: "Older", published_at: "2026-01-01", game: { id: 1 } },
  { id: 11, title: "Newer", published_at: "2026-02-01", game: { id: 2 } },
  { id: 12, title: "Unknown Review", published_at: "2026-03-01", game: { id: 3 } },
];

const sTierEntries = [
  { game_id: { id: 2 } },
  { game_id: { id: null } },
];

describe("developer route build data", () => {
  it("fetches each source collection once", async () => {
    const fetchMock = mockDirectusFetch([
      { match: "/items/developers?", data: developers },
      { match: "/items/games?", data: games },
      { match: "/items/reviews?", data: reviews },
      { match: "/items/tier_list_games?", data: sTierEntries },
    ]);

    await expect(fetchDeveloperRouteSource()).resolves.toEqual({
      developers,
      games,
      reviews,
      sTierEntries,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    const gamesUrl = new URL(urls.find((url) => url.includes("/items/games?")) ?? "");
    const reviewsUrl = new URL(urls.find((url) => url.includes("/items/reviews?")) ?? "");
    expect(gamesUrl.searchParams.get("limit")).toBe("-1");
    expect(reviewsUrl.searchParams.get("filter[status][_eq]")).toBe("published");
  });

  it("builds detail pages with sorted games and scoped review/tier metadata", () => {
    const paths = buildDeveloperDetailPaths({ developers, games, reviews, sTierEntries });
    expect(paths.map((path) => path.params.slug)).toEqual(["alpha", "beta", "unknown"]);

    const alpha = paths[0].props;
    expect(alpha.title).toBe("Alpha Studio");
    expect(alpha.games.map((game) => game.id)).toEqual([2, 1]);
    expect(alpha.reviews.map((review) => review.id)).toEqual([11, 10]);
    expect(alpha.reviewedGameIdValues).toEqual([2, 1]);
    expect(alpha.sTierGameIdValues).toEqual([2]);

    const unknown = paths[2].props;
    expect(unknown.developer).toBeNull();
    expect(unknown.games.map((game) => game.id)).toEqual([3]);
    expect(unknown.reviews.map((review) => review.id)).toEqual([12]);
  });

  it("sorts same-date reviews by title and handles missing relation data", () => {
    const paths = buildDeveloperDetailPaths({
      developers: [{ slug: "alpha", name: null, title: "Alpha Title" }],
      games: [
        { id: 1, title: "One", developers: [{ developers_id: { slug: "alpha" } }] },
        { id: 2, title: "Unknown", developers: undefined },
      ],
      reviews: [
        { id: 1, title: "Zulu", published_at: "2026-01-01", game: { id: 1 } },
        { id: 2, title: "alpha", published_at: "2026-01-01", game: { id: 1 } },
        { id: 3, title: null, published_at: null, game: { id: 1 } },
      ],
      sTierEntries: [],
    });

    expect(paths[0].props.title).toBe("Alpha Title");
    expect(paths[0].props.reviews.map((review) => review.id)).toEqual([2, 1, 3]);
    expect(paths[1].props.games.map((game) => game.id)).toEqual([2]);
  });

  it("builds only multi-status developer combinations without duplicate games", () => {
    const gameStatusPaths = buildDeveloperStatusPaths(
      { developers, games, reviews, sTierEntries },
      "game_status",
    );
    expect(gameStatusPaths.map((path) => path.params)).toEqual([
      { developer: "alpha", status: "in_development" },
      { developer: "alpha", status: "released" },
    ]);
    expect(gameStatusPaths[0].props.developerLabel).toBe("Alpha Studio");
    expect(gameStatusPaths[0].props.games.map((game) => game.id)).toEqual([2]);
    expect(gameStatusPaths[0].props.reviewedGameIdValues).toEqual([2]);
    expect(gameStatusPaths[0].props.sTierGameIdValues).toEqual([2]);

    const playerStatusPaths = buildDeveloperStatusPaths(
      { developers, games, reviews, sTierEntries },
      "player_status",
    );
    expect(playerStatusPaths).toHaveLength(2);
  });

  it("skips missing statuses and falls back to an unlisted developer slug label", () => {
    const paths = buildDeveloperStatusPaths(
      {
        developers: [{ slug: "listed", name: null }],
        games: [
          {
            id: 1,
            title: "Released",
            game_status: "released",
            developers: [{ developers_id: { slug: "unlisted" } }],
          },
          {
            id: 2,
            title: "Abandoned",
            game_status: "abandoned",
            developers: [{ developers_id: { slug: "unlisted" } }],
          },
          { id: 3, title: "No Status", game_status: null, developers: undefined },
        ],
        reviews: [],
        sTierEntries: [],
      },
      "game_status",
    );

    expect(paths).toHaveLength(2);
    expect(paths[0].props.developerLabel).toBe("unlisted");
  });
});
