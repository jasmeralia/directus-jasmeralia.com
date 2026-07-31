import { describe, expect, it } from "vitest";

import {
  downloadLinks,
  getDeveloperLinkMeta,
  getLinkMeta,
  getUrlLinkMeta,
  getUrlPlatform,
  primaryDownloadLink,
  walkthroughLinks,
  type DeveloperLink,
  type GameLink,
  type UrlPlatform,
} from "./download-link";

const links: GameLink[] = [
  { url: "https://example.test/later", kind: "download", sort: 20 },
  { url: "https://example.test/walkthrough", kind: "walkthrough", sort: 1 },
  { url: "https://example.test/unsorted", kind: "download", sort: null },
  { url: "https://example.test/first", kind: "download", sort: 2 },
];

describe("game link selection", () => {
  it("filters and sorts download links with null sort values last", () => {
    expect(downloadLinks(links).map(({ url }) => url)).toEqual([
      "https://example.test/first",
      "https://example.test/later",
      "https://example.test/unsorted",
    ]);
    expect(links.map(({ sort }) => sort)).toEqual([20, 1, null, 2]);
    expect(primaryDownloadLink(links)?.url).toBe("https://example.test/first");
    expect(primaryDownloadLink(undefined)).toBeNull();
  });

  it("filters and sorts walkthrough links", () => {
    const values: GameLink[] = [
      ...links,
      { url: "https://example.test/walkthrough-2", kind: "walkthrough", sort: null },
    ];
    expect(walkthroughLinks(values).map(({ url }) => url)).toEqual([
      "https://example.test/walkthrough",
      "https://example.test/walkthrough-2",
    ]);
    expect(downloadLinks(null)).toEqual([]);
    expect(walkthroughLinks([])).toEqual([]);
  });
});

describe("URL platform and metadata", () => {
  const platformCases: [string, UrlPlatform][] = [
    ["https://store.steampowered.com/app/1", "steam"],
    ["https://creator.itch.io/game", "itch"],
    ["https://www.gog.com/game/example", "gog"],
    ["https://store.epicgames.com/p/example", "epic"],
    ["https://www.patreon.com/creator", "patreon"],
    ["https://store.playstation.com/product/example", "playstation"],
    ["https://www.xbox.com/games/example", "xbox"],
    ["https://www.ign.com/wikis/example", "ign"],
    ["https://www.scribd.com/document/1", "scribd"],
    ["https://f95zone.to/threads/example", "f95zone"],
    ["https://gamerant.com/example", "gamerant"],
    ["https://www.neoseeker.com/example/walkthrough", "neoseeker"],
    ["https://www.trueachievements.com/game/example", "trueachievements"],
    ["https://www.stealthoptional.com/guides/example", "stealthoptional"],
  ];

  it.each(platformCases)("recognizes %s as %s", (url, platform) => {
    expect(getUrlPlatform(url)).toBe(platform);
  });

  it("returns null for malformed and unknown URLs", () => {
    expect(getUrlPlatform("not a url")).toBeNull();
    expect(getUrlPlatform("https://example.com/file.zip")).toBeNull();
    expect(getUrlPlatform(null)).toBeNull();
  });

  it("resolves URL metadata and allows a game-link label override", () => {
    expect(getUrlLinkMeta("https://www.gog.com/game/example")).toEqual({
      icon: "/icons/simple/gogdotcom.svg",
      label: "GOG",
      host: "gog.com",
    });
    expect(getUrlLinkMeta("bad url")).toEqual({
      icon: null,
      label: "Download",
      host: null,
    });
    expect(getLinkMeta({
      url: "https://store.steampowered.com/app/1",
      kind: "download",
      label: "Store page",
    })).toMatchObject({
      icon: "/icons/simple/steam.svg",
      label: "Store page",
    });
  });

  it("resolves developer kind metadata, URL variants, and label overrides", () => {
    const steamDb: DeveloperLink = {
      url: "https://steamdb.info/app/1",
      kind: "steam",
    };
    expect(getDeveloperLinkMeta(steamDb)).toEqual({
      icon: "/icons/simple/steamdb.svg",
      label: "SteamDB",
    });
    expect(getDeveloperLinkMeta({
      url: "https://discord.gg/example",
      kind: "discord",
      label: "Community",
    })).toEqual({
      icon: "/icons/simple/discord.svg",
      label: "Community",
    });
    expect(getDeveloperLinkMeta({ url: "https://example.com", kind: "website" })).toEqual({
      icon: null,
      label: "Website",
    });
  });
});
