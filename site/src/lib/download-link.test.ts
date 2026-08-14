import { describe, expect, it } from "vitest";

import {
  downloadLinks,
  getDeveloperLinkMeta,
  getLinkMeta,
  getUrlLinkMeta,
  getUrlPlatform,
  primaryDownloadLink,
  walkthroughLinks,
  walkthroughTextNotes,
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

  it("filters and sorts text notes independently from walkthroughs", () => {
    const values: GameLink[] = [
      { url: "https://example.test/note-later", kind: "text-note", sort: null },
      { url: "https://example.test/walkthrough", kind: "walkthrough", sort: 1 },
      { url: "https://example.test/note-first", kind: "text-note", sort: 2 },
    ];

    expect(walkthroughTextNotes(values).map(({ url }) => url)).toEqual([
      "https://example.test/note-first",
      "https://example.test/note-later",
    ]);
    expect(walkthroughTextNotes(undefined)).toEqual([]);
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
    expect(getLinkMeta({
      url: "https://creator.itch.io/game",
      kind: "download",
      label: null,
    })).toEqual({
      icon: "/icons/simple/itchdotio.svg",
      label: "itch.io",
      host: "creator.itch.io",
    });
  });

  it.each([
    ["https://creator.itch.io/game", "/icons/simple/itchdotio.svg", "itch.io", "creator.itch.io"],
    ["https://store.epicgames.com/p/example", "/icons/simple/epicgames.svg", "Epic Games", "store.epicgames.com"],
    ["https://www.patreon.com/creator", "/icons/simple/patreon.svg", "Patreon", "patreon.com"],
    ["https://store.playstation.com/product/example", "/icons/simple/playstation.svg", "PlayStation", "store.playstation.com"],
    ["https://www.xbox.com/games/example", "/icons/simple/xbox.svg", "Xbox", "xbox.com"],
    ["https://www.ign.com/wikis/example", "/icons/simple/ign.svg", "IGN", "ign.com"],
    ["https://www.scribd.com/document/1", "/icons/simple/scribd.svg", "Scribd", "scribd.com"],
    ["https://f95zone.to/threads/example", "/icons/f95zone.png", "F95Zone", "f95zone.to"],
    ["https://gamerant.com/example", "/icons/gamerant.png", "Game Rant", "gamerant.com"],
    ["https://www.neoseeker.com/example", "/icons/neoseeker.ico", "Neoseeker", "neoseeker.com"],
    ["https://www.trueachievements.com/game/example", "/icons/trueachievements.png", "TrueAchievements", "trueachievements.com"],
    ["https://www.stealthoptional.com/guides/example", "/icons/stealthoptional.png", "Stealth Optional", "stealthoptional.com"],
  ])("returns metadata for %s", (url, icon, label, host) => {
    expect(getUrlLinkMeta(url)).toEqual({ icon, label, host });
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
    expect(getDeveloperLinkMeta({
      url: "https://subscribestar.adult/creator",
      kind: "subscribestar",
    })).toEqual({
      icon: "/icons/simple/subscribestar.svg",
      label: "SubscribeStar",
    });
    expect(getDeveloperLinkMeta({ url: "https://discord.gg/example", kind: "discord" })).toEqual({
      icon: "/icons/simple/discord.svg",
      label: "Discord",
    });
    expect(getDeveloperLinkMeta({ url: "https://creator.itch.io", kind: "itch" })).toEqual({
      icon: "/icons/simple/itchdotio.svg",
      label: "itch.io",
    });
  });

  it.each([
    ["patreon", "/icons/simple/patreon.svg"],
    ["subscribestar", "/icons/simple/subscribestar.svg"],
    ["discord", "/icons/simple/discord.svg"],
    ["itch", "/icons/simple/itchdotio.svg"],
    ["other", null],
  ] as const)("keeps a custom %s developer label with its kind icon", (kind, icon) => {
    expect(getDeveloperLinkMeta({
      url: "https://example.com/profile",
      kind,
      label: "Creator profile",
    })).toEqual({ icon, label: "Creator profile" });
  });
});
