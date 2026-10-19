import { describe, expect, it, vi } from "vitest";

import gamesFixture from "../test/fixtures/games.json";
import { mockDirectusFetch } from "../test/directus-mock";
import {
  assetsBaseUrl,
  directusBaseUrl,
  directusFieldChoices,
  directusFieldChoiceMap,
  directusFetchItems,
  directusFetchRaw,
  directusToken,
  fileUrl,
  getPublishedTierListBySlug,
  getReviewedGameIds,
  getSTierGameIds,
  getTierChipsByGameId,
  isFamilySharingDisabled,
  listPublishedTierListSlugs,
  siteBaseUrl,
} from "./directus";

describe("Directus configuration helpers", () => {
  it("normalizes the Directus base URL and requires it", () => {
    vi.stubEnv("DIRECTUS_URL", "https://directus.example/");
    expect(directusBaseUrl()).toBe("https://directus.example");

    vi.stubEnv("DIRECTUS_URL", undefined);
    expect(() => directusBaseUrl()).toThrow("Missing required env var: DIRECTUS_URL");
  });

  it("prefers the primary Directus token and falls back to the static token", () => {
    vi.stubEnv("DIRECTUS_TOKEN", "primary-token");
    vi.stubEnv("DIRECTUS_STATIC_TOKEN", "static-token");
    expect(directusToken()).toBe("primary-token");

    vi.stubEnv("DIRECTUS_TOKEN", undefined);
    expect(directusToken()).toBe("static-token");

    vi.stubEnv("DIRECTUS_STATIC_TOKEN", undefined);
    expect(directusToken()).toBeNull();
  });

  it("prefers and normalizes the asset base URL with ASSETS_URL as fallback", () => {
    vi.stubEnv("ASSETS_BASE_URL", "https://cdn.example/");
    vi.stubEnv("ASSETS_URL", "https://fallback.example/");
    expect(assetsBaseUrl()).toBe("https://cdn.example");

    vi.stubEnv("ASSETS_BASE_URL", undefined);
    expect(assetsBaseUrl()).toBe("https://fallback.example");

    vi.stubEnv("ASSETS_URL", undefined);
    expect(assetsBaseUrl()).toBe("");
  });

  it("uses the asset base URL for the site origin, falling back to jasmeralia.com", () => {
    vi.stubEnv("ASSETS_BASE_URL", "https://cdn.example/");
    expect(siteBaseUrl()).toBe("https://cdn.example");

    vi.stubEnv("ASSETS_BASE_URL", undefined);
    vi.stubEnv("ASSETS_URL", undefined);
    expect(siteBaseUrl()).toBe("https://jasmeralia.com");
  });

  it("builds public file URLs from file objects and IDs", () => {
    vi.stubEnv("ASSETS_BASE_URL", "https://assets.example/");
    expect(fileUrl({ id: "file-id", filename_disk: "cover.webp" })).toBe(
      "https://assets.example/media/cover.webp",
    );
    expect(fileUrl("file-id")).toBe("https://assets.example/media/file-id");
    expect(fileUrl({ id: "file-id", filename_disk: null })).toBe(
      "https://assets.example/media/file-id",
    );
    expect(fileUrl(null)).toBeNull();

    vi.stubEnv("ASSETS_BASE_URL", undefined);
    vi.stubEnv("ASSETS_URL", undefined);
    expect(fileUrl("file-id")).toBeNull();
  });

  it("flags only Steam downloads with explicitly disabled family sharing", () => {
    expect(isFamilySharingDisabled({
      family_sharing: false,
      links: [{
        url: "https://store.steampowered.com/app/1/",
        kind: "download",
      }],
    })).toBe(true);
    expect(isFamilySharingDisabled({
      family_sharing: true,
      links: [{
        url: "https://store.steampowered.com/app/1/",
        kind: "download",
      }],
    })).toBe(false);
    expect(isFamilySharingDisabled({
      family_sharing: false,
      links: [{ url: "https://example.com/game.zip", kind: "download" }],
    })).toBe(false);
  });
});

describe("Directus fetch helpers", () => {
  it("loads and caches field choices with their configured labels", async () => {
    const fetchMock = mockDirectusFetch([{
      match: "/fields/test_collection/status",
      data: {
        meta: {
          options: {
            choices: [
              { text: "Ready to Play", value: "ready" },
              { value: "on_hold" },
              { text: "Invalid", value: 7 },
              null,
            ],
          },
        },
      },
    }]);

    const choices = await directusFieldChoices("test_collection", "status");
    const labels = await directusFieldChoiceMap("test_collection", "status");

    expect(choices).toEqual([
      { value: "ready", label: "Ready to Play" },
      { value: "on_hold", label: "on_hold" },
    ]);
    expect(labels.get("ready")).toBe("Ready to Play");
    expect(labels.get("on_hold")).toBe("on_hold");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails clearly when a requested Directus field has no configured choices", async () => {
    mockDirectusFetch([{
      match: "/fields/test_collection/no_choices",
      data: { meta: { options: {} } },
    }]);

    await expect(directusFieldChoices("test_collection", "no_choices")).rejects.toThrow(
      "Directus field test_collection.no_choices does not expose choice options",
    );
  });

  it("builds fields, sort, limit, nested filter, and deep query parameters", async () => {
    const fetchMock = mockDirectusFetch([{
      match: "/items/games?",
      data: gamesFixture,
    }]);

    const result = await directusFetchItems("games", {
      fields: ["id", "title", "links.url"],
      sort: ["-id", "title"],
      limit: 5,
      filter: {
        status: { _eq: "published" },
        id: { _in: [101, 102] },
      },
      deep: {
        links: { _filter: { kind: { _eq: "download" } } },
      },
    });

    expect(result).toEqual(gamesFixture);
    const requestedUrl = String(fetchMock.mock.calls[0][0]);
    const url = new URL(requestedUrl);
    expect(url.origin).toBe("http://directus.test");
    expect(url.pathname).toBe("/items/games");
    expect(url.searchParams.get("fields")).toBe("id,title,links.url");
    expect(url.searchParams.get("sort")).toBe("-id,title");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.get("filter[status][_eq]")).toBe("published");
    expect(url.searchParams.get("filter[id][_in]")).toBe("101,102");
    expect(url.searchParams.get("deep[links][_filter][kind][_eq]")).toBe("download");
  });

  it("auto-lifts the default 100-row cap on games.sections", async () => {
    const fetchMock = mockDirectusFetch([{ match: "/items/games?", data: [] }]);

    await directusFetchItems("games", {
      fields: ["id", "sections.id", "sections.title"],
    });

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("deep[sections][_limit]")).toBe("-1");
  });

  it("auto-lifts the default 100-row cap on bundle_members.sections", async () => {
    const fetchMock = mockDirectusFetch([{ match: "/items/games?", data: [] }]);

    await directusFetchItems("games", {
      fields: ["id", "bundle_members.id", "bundle_members.sections.id"],
    });

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("deep[bundle_members][sections][_limit]")).toBe("-1");
  });

  it("does not add a sections deep default for non-games collections or explicit overrides", async () => {
    const noSections = mockDirectusFetch([{ match: "/items/reviews?", data: [] }]);
    await directusFetchItems("reviews", { fields: ["id", "sections.id"] });
    expect(new URL(String(noSections.mock.calls[0][0])).searchParams.has("deep[sections][_limit]")).toBe(false);

    const explicit = mockDirectusFetch([{ match: "/items/games?", data: [] }]);
    await directusFetchItems("games", {
      fields: ["id", "sections.id"],
      deep: { sections: { _limit: 5 } },
    });
    expect(new URL(String(explicit.mock.calls[0][0])).searchParams.get("deep[sections][_limit]")).toBe("5");
  });

  it("sends the configured authorization header", async () => {
    vi.stubEnv("DIRECTUS_TOKEN", "header-token");
    const fetchMock = mockDirectusFetch([{ match: "/items/games", data: [] }]);

    await directusFetchItems("games");

    expect(fetchMock.mock.calls[0][1]).toEqual({
      headers: {
        Accept: "application/json",
        Authorization: "Bearer header-token",
      },
    });
  });

  it("omits the authorization header when neither token is configured", async () => {
    vi.stubEnv("DIRECTUS_TOKEN", undefined);
    vi.stubEnv("DIRECTUS_STATIC_TOKEN", undefined);
    const fetchMock = mockDirectusFetch([{ match: "/items/games", data: [] }]);

    await directusFetchItems("games");

    expect(fetchMock.mock.calls[0][1]).toEqual({
      headers: { Accept: "application/json" },
    });
  });

  it("returns an empty item list when the response omits data", async () => {
    mockDirectusFetch([{ match: "/items/games", data: undefined }]);
    await expect(directusFetchItems("games")).resolves.toEqual([]);
  });

  it("returns the raw response envelope", async () => {
    mockDirectusFetch([{ match: /\/revisions$/, data: [{ id: 9 }] }]);
    await expect(directusFetchRaw<{ data: { id: number }[] }>("/revisions")).resolves.toEqual({
      data: [{ id: 9 }],
    });
  });

  it("throws a useful error for non-OK responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("server exploded", {
      status: 503,
      statusText: "Service Unavailable",
    })));

    await expect(directusFetchItems("games")).rejects.toThrow(
      "Directus request failed (503) http://directus.test/items/games: server exploded",
    );
  });

  it("fails loudly when no fixture route matches", async () => {
    mockDirectusFetch([{ match: "/items/genres", data: [] }]);
    await expect(directusFetchItems("games")).rejects.toThrow(
      "No Directus mock route matched: http://directus.test/items/games",
    );
  });
});

describe("published tier-list helpers", () => {
  it("lists only non-empty published tier-list slugs", async () => {
    const fetchMock = mockDirectusFetch([{
      match: "/items/tier_lists?",
      data: [{ slug: "favorites" }, { slug: "" }, { slug: "completed" }],
    }]);

    await expect(listPublishedTierListSlugs()).resolves.toEqual(["favorites", "completed"]);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("filter[status][_eq]")).toBe("published");
    expect(url.searchParams.get("limit")).toBe("-1");
  });

  it("returns null when no published tier list matches", async () => {
    mockDirectusFetch([{ match: "/items/tier_lists?", data: [] }]);
    await expect(getPublishedTierListBySlug("missing")).resolves.toBeNull();
  });

  it("attaches a matching tier list's game rows", async () => {
    const tierList = {
      id: 12,
      title: "Favorites",
      slug: "favorites",
      description: "Top games",
      status: "published",
    };
    const games = [{
      id: 30,
      rating: "S",
      game_id: { id: 7, title: "Example", slug: "example" },
    }];
    const fetchMock = mockDirectusFetch([
      { match: "/items/tier_lists?", data: [tierList] },
      { match: "/items/tier_list_games?", data: games },
    ]);

    await expect(getPublishedTierListBySlug("favorites")).resolves.toEqual({
      ...tierList,
      tier_list_games: games,
    });
    const listUrl = new URL(String(fetchMock.mock.calls[0][0]));
    const gamesUrl = new URL(String(fetchMock.mock.calls[1][0]));
    expect(listUrl.searchParams.get("filter[slug][_eq]")).toBe("favorites");
    expect(gamesUrl.searchParams.get("filter[tier_list_id][_eq]")).toBe("12");
    expect(gamesUrl.searchParams.get("fields")).toContain("game_id.links.url");
  });

  it("returns no S-tier IDs without numeric input and filters malformed result rows", async () => {
    const emptyFetch = mockDirectusFetch([]);
    await expect(getSTierGameIds([])).resolves.toEqual(new Set());
    expect(emptyFetch).not.toHaveBeenCalled();

    const fetchMock = mockDirectusFetch([{
      match: "/items/tier_list_games?",
      data: [
        { game_id: { id: 1 } },
        { game_id: { id: "2" } },
        { game_id: null },
        { game_id: { id: 3 } },
      ],
    }]);
    await expect(getSTierGameIds([1, "2" as unknown as number, 3])).resolves.toEqual(
      new Set([1, 3]),
    );
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.has("filter[game_id][_in]")).toBe(false);
    expect(url.searchParams.get("filter[rating][_eq]")).toBe("S");
    expect(url.searchParams.get("filter[tier_list_id][status][_eq]")).toBe("published");
    expect(url.searchParams.get("limit")).toBe("-1");
  });

  it("finds reviewed games without serializing the input IDs into the URL", async () => {
    const emptyFetch = mockDirectusFetch([]);
    await expect(getReviewedGameIds([])).resolves.toEqual(new Set());
    expect(emptyFetch).not.toHaveBeenCalled();

    const fetchMock = mockDirectusFetch([{
      match: "/items/reviews?",
      data: [
        { game: { id: 1 } },
        { game: { id: 2 } },
        { game: { id: "3" } },
        { game: null },
      ],
    }]);
    await expect(getReviewedGameIds([1, 3, 4])).resolves.toEqual(new Set([1]));

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.has("filter[game][_in]")).toBe(false);
    expect(url.searchParams.get("filter[status][_eq]")).toBe("published");
    expect(url.searchParams.get("fields")).toBe("game.id");
    expect(url.searchParams.get("limit")).toBe("-1");
  });

  it("gets published tier chips without serializing input IDs and scopes results in JS", async () => {
    const emptyFetch = mockDirectusFetch([]);
    await expect(getTierChipsByGameId([])).resolves.toEqual(new Map());
    expect(emptyFetch).not.toHaveBeenCalled();

    const fetchMock = mockDirectusFetch([{
      match: "/items/tier_list_games?",
      data: [
        { rating: "B", game_id: { id: 1 }, tier_list_id: { slug: "avn", title: "AVNs" } },
        { rating: "S", game_id: { id: 2 }, tier_list_id: { slug: "other", title: "Other" } },
        { rating: "U", game_id: { id: 1 }, tier_list_id: { slug: "early", title: "Early" } },
        { rating: "A", game_id: { id: 4 }, tier_list_id: { slug: "outside", title: "Outside" } },
      ],
    }]);

    await expect(getTierChipsByGameId([1, "2" as unknown as number, 3])).resolves.toEqual(
      new Map([[1, [{ slug: "avn", text: "AVNs - B Tier" }]]]),
    );
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.has("filter[game_id][_in]")).toBe(false);
    expect(url.searchParams.get("filter[tier_list_id][status][_eq]")).toBe("published");
    expect(url.searchParams.get("fields")).toBe(
      "rating,game_id.id,tier_list_id.slug,tier_list_id.title",
    );
    expect(url.searchParams.get("limit")).toBe("-1");
  });
});
