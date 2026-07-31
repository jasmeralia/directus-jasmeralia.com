import { describe, expect, it, vi } from "vitest";

import gamesFixture from "../test/fixtures/games.json";
import { mockDirectusFetch } from "../test/directus-mock";
import {
  assetsBaseUrl,
  directusBaseUrl,
  directusFetchItems,
  directusFetchRaw,
  directusToken,
  fileUrl,
  isFamilySharingDisabled,
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
