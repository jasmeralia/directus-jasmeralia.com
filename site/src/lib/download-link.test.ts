import { describe, expect, it } from "vitest";

import {
  downloadLinks,
  downloadLinksByDomain,
  getDeveloperLinkMeta,
  getLinkMeta,
  getUrlLinkMeta,
  getUrlPlatform,
  hasSteamDownloadLink,
  isMissingDownloadLink,
  otherLinks,
  otherLinkText,
  primaryDownloadLink,
  steamDbAppUrl,
  steamDbSearchUrl,
  steamGridDbSearchUrl,
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

describe("other links", () => {
  it("selects only other-kind links, sorted with null sort values last", () => {
    expect(
      otherLinks([
        { url: "https://x.test/dl", kind: "download", sort: 1 },
        { url: "https://x.test/b", kind: "other", sort: null },
        { url: "https://x.test/a", kind: "other", sort: 2 },
      ]).map(({ url }) => url),
    ).toEqual(["https://x.test/a", "https://x.test/b"]);
    expect(otherLinks(undefined)).toEqual([]);
  });
});

describe("other link text", () => {
  const text = (url: string, label?: string) => otherLinkText({ url, kind: "other", label });

  it("uses the label, else Visit plus the site name, else Visit plus the host", () => {
    expect(text("https://www.youtube.com/@x", "Dev channel")).toBe("Dev channel");
    expect(text("https://www.youtube.com/@x")).toBe("Visit YouTube");
    expect(text("https://m.youtube.com/@x")).toBe("Visit YouTube");
    expect(text("https://bsky.app/profile/x")).toBe("Visit Bluesky");
    expect(text("https://twitter.com/x")).toBe("Visit X (Twitter)");
    expect(text("https://www.example.org/page")).toBe("Visit example.org");
  });

  it("does not match a lookalike host and falls back to the raw text for non-URLs", () => {
    expect(text("https://notyoutube.com/x")).toBe("Visit notyoutube.com");
    expect(text("not a url")).toBe("not a url");
  });
});

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

  it("does not treat unreleased games as missing a download link", () => {
    expect(isMissingDownloadLink({ game_status: "released", links: [] })).toBe(true);
    expect(isMissingDownloadLink({ game_status: "unreleased", links: [] })).toBe(false);
    expect(isMissingDownloadLink({ game_status: "released", links })).toBe(false);
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

  it("derives SteamDB app URLs from Steam Store app IDs only", () => {
    expect(steamDbAppUrl("https://store.steampowered.com/app/4354570/FINAL_FANTASY_VII_REVELATION/")).toBe(
      "https://steamdb.info/app/4354570/",
    );
    expect(steamDbAppUrl("https://www.store.steampowered.com/app/12345?utm_source=steam")).toBe(
      "https://steamdb.info/app/12345/",
    );
    expect(steamDbAppUrl("https://store.steampowered.com/agecheck/app/12345/")).toBeNull();
    expect(steamDbAppUrl("https://steamdb.info/app/12345/")).toBeNull();
  });

  it("builds encoded SteamGridDB and SteamDB title searches", () => {
    expect(steamGridDbSearchUrl("The witcher 4")).toBe(
      "https://www.steamgriddb.com/search/grids?term=The+witcher+4",
    );
    expect(steamDbSearchUrl("The witcher 4")).toBe(
      "https://steamdb.info/search/?a=all&q=The+witcher+4",
    );
    expect(steamGridDbSearchUrl("A & B")).toBe(
      "https://www.steamgriddb.com/search/grids?term=A+%26+B",
    );
  });

  it("detects whether any download link points to Steam", () => {
    expect(hasSteamDownloadLink([{ url: "https://store.steampowered.com/app/1/name/", kind: "download" }])).toBe(true);
    expect(hasSteamDownloadLink([{ url: "https://gog.com/game/name", kind: "download" }])).toBe(false);
    expect(hasSteamDownloadLink([])).toBe(false);
  });

  it("resolves URL metadata and allows a game-link label override", () => {
    expect(getUrlLinkMeta("https://www.gog.com/game/example")).toEqual({
      icon: "/icons/simple/gogdotcom.svg",
      label: "GOG",
      host: "gog.com",
    });
    expect(getUrlLinkMeta("https://www.youtube.com/@creator")).toEqual({
      icon: "/icons/link.svg",
      label: "Download",
      host: "youtube.com",
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
    expect(getLinkMeta({
      url: "https://gamestorylog.com/games/example",
      kind: "gamestorylog",
    })).toEqual({
      icon: "/icons/gamestorylog.png",
      label: "GameStoryLog",
      host: "gamestorylog.com",
    });
  });

  it("keeps SubscribeStar out of the platform filters", () => {
    expect(getUrlPlatform("https://subscribestar.adult/creator")).toBeNull();
  });

  it.each([
    ["https://creator.itch.io/game", "/icons/simple/itchdotio.svg", "itch.io", "creator.itch.io"],
    ["https://store.epicgames.com/p/example", "/icons/simple/epicgames.svg", "Epic Games", "store.epicgames.com"],
    ["https://www.patreon.com/creator", "/icons/simple/patreon.svg", "Patreon", "patreon.com"],
    ["https://subscribestar.adult/creator", "/icons/simple/subscribestar.svg", "SubscribeStar", "subscribestar.adult"],
    ["https://www.subscribestar.com/creator", "/icons/simple/subscribestar.svg", "SubscribeStar", "subscribestar.com"],
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
      icon: "/icons/link.svg",
      label: "Website",
    });
    expect(getDeveloperLinkMeta({
      url: "https://example.com/profile",
      kind: "website",
      label: "Creator profile",
    })).toEqual({
      icon: "/icons/link.svg",
      label: "Creator profile",
    });
    expect(getDeveloperLinkMeta({
      url: "https://gamestorylog.com/developer/example",
      kind: "gamestorylog",
      label: "Website",
    })).toEqual({
      icon: "/icons/gamestorylog.png",
      label: "GameStoryLog",
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

describe("download links by domain", () => {
  const dl = (url: string, sort: number | null = null): GameLink => ({ url, kind: "download", sort });

  it("orders by site so itch.io subdomains group together, ignoring stored sort", () => {
    const input: GameLink[] = [
      dl("https://www.patreon.com/someone", 1),
      dl("https://zanithone.itch.io/game", 2),
      dl("https://subscribestar.adult/someone", 3),
      dl("https://store.steampowered.com/app/1/", 4),
      dl("https://aliencatgames.itch.io/game", 5),
      { url: "https://example.test/walkthrough", kind: "walkthrough", sort: 0 },
    ];
    expect(downloadLinksByDomain(input).map(({ url }) => url)).toEqual([
      "https://aliencatgames.itch.io/game",
      "https://zanithone.itch.io/game",
      "https://www.patreon.com/someone",
      "https://store.steampowered.com/app/1/",
      "https://subscribestar.adult/someone",
    ]);
    expect(input.map(({ sort }) => sort)).toEqual([1, 2, 3, 4, 5, 0]);
  });

  it("handles empty input", () => {
    expect(downloadLinksByDomain(undefined)).toEqual([]);
    expect(downloadLinksByDomain([])).toEqual([]);
  });
});
