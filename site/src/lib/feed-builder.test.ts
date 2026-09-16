import { describe, expect, it } from "vitest";

import { mockDirectusFetch } from "../test/directus-mock";
import { buildFeedEntries, renderFeedXml, type FeedEntry } from "./feed-builder";

type FeedRouteConfig = {
  gameRevisions?: unknown[];
  reviewRevisions?: unknown[];
  tierListRevisions?: unknown[];
  bundleMemberRevisions?: unknown[];
  sectionRevisions?: unknown[];
  tlgActivities?: unknown[];
  linkActivities?: unknown[];
  games?: unknown[];
  sectionRows?: unknown[];
  bundleMembers?: unknown[];
  tierLists?: unknown[];
  tlgItems?: unknown[];
  linkItems?: unknown[];
  genreRows?: unknown[];
};

const feedRoutes = (config: FeedRouteConfig) => [
  { match: /\/revisions\?.*collection\]\[_eq\]=games(?:&|$)/, data: config.gameRevisions ?? [] },
  { match: /\/revisions\?.*collection\]\[_eq\]=reviews(?:&|$)/, data: config.reviewRevisions ?? [] },
  { match: /\/revisions\?.*collection\]\[_eq\]=tier_lists(?:&|$)/, data: config.tierListRevisions ?? [] },
  { match: /\/revisions\?.*collection\]\[_eq\]=game_bundle_members(?:&|$)/, data: config.bundleMemberRevisions ?? [] },
  { match: /\/revisions\?.*collection\]\[_eq\]=game_sections(?:&|$)/, data: config.sectionRevisions ?? [] },
  { match: /\/activity\?.*tier_list_games(?:&|$)/, data: config.tlgActivities ?? [] },
  { match: /\/activity\?.*games_links(?:&|$)/, data: config.linkActivities ?? [] },
  { match: "/items/tier_list_games?", data: config.tlgItems ?? [] },
  { match: "/items/games_links?", data: config.linkItems ?? [] },
  { match: "/items/reviews?", data: [] },
  { match: "/items/tier_lists?", data: config.tierLists ?? [] },
  { match: "/items/game_bundle_members?", data: config.bundleMembers ?? [] },
  { match: "/items/games?", data: config.games ?? [] },
  { match: "/items/game_sections?", data: config.sectionRows ?? [] },
  { match: "/items/games_genres?", data: config.genreRows ?? [] },
];

describe("buildFeedEntries", () => {
  it("suppresses game revisions containing only version fields and skipped noise", async () => {
    mockDirectusFetch(feedRoutes({
      gameRevisions: [
        {
          id: 2,
          item: "1",
          collection: "games",
          data: { title: "Versioned Game", slug: "versioned-game" },
          delta: {
            version_orion: "0.2",
            version_typhoon: "0.3",
            version_gsl: "0.4",
            date_updated: "2026-09-10T12:00:00Z",
          },
          activity: { action: "update", timestamp: "2026-09-10T12:00:00Z" },
        },
      ],
      games: [{ id: 1, title: "Versioned Game", slug: "versioned-game" }],
    }));

    await expect(buildFeedEntries()).resolves.toEqual([]);
  });

  it("emits mixed game revisions without version-field description lines", async () => {
    mockDirectusFetch(feedRoutes({
      gameRevisions: [
        {
          id: 3,
          item: "1",
          collection: "games",
          data: {
            title: "Versioned Game",
            slug: "versioned-game",
            player_status: "completed",
          },
          delta: {
            version_orion: "0.2",
            player_status: "completed",
          },
          activity: { action: "update", timestamp: "2026-09-10T13:00:00Z" },
        },
      ],
      games: [{ id: 1, title: "Versioned Game", slug: "versioned-game" }],
    }));

    const entries = await buildFeedEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("Game Updated: Versioned Game");
    expect(entries[0].description).toBe("**Play Status**: Completed");
    expect(entries[0].description).not.toContain("version_orion");
    expect(entries[0].guid).toContain(":play_status:");
  });

  describe("section count/completion tracking", () => {
    const game = { id: 10, title: "A House in the Rift", slug: "ahitr", section_style: "nonlinear", section_noun: "Mission" };

    // Three quest rows, all bulk-created together on 2026-07-01 (one run),
    // then row 102 is marked completed on 2026-08-01 (an older, separate
    // run) and row 101 is marked completed on 2026-09-16 (the most recent
    // run). Row 103 stays incomplete throughout.
    const bulkCreate = (item: string, id: number) => ({
      id,
      item,
      collection: "game_sections",
      data: { id: Number(item), games_id: 10, bundle_member_id: null, completed: false },
      delta: { games_id: 10, completed: false },
      activity: { action: "create", timestamp: "2026-07-01T00:00:00Z" },
    });

    const sectionRevisions = [
      bulkCreate("101", 5001),
      bulkCreate("102", 5002),
      bulkCreate("103", 5003),
      {
        id: 5004,
        item: "102",
        collection: "game_sections",
        data: { id: 102, games_id: 10, bundle_member_id: null, completed: true },
        delta: { completed: true },
        activity: { action: "update", timestamp: "2026-08-01T10:00:00Z" },
      },
      {
        id: 5005,
        item: "101",
        collection: "game_sections",
        data: { id: 101, games_id: 10, bundle_member_id: null, completed: true },
        delta: { completed: true },
        activity: { action: "update", timestamp: "2026-09-16T09:00:00Z" },
      },
    ];

    const sectionRows = [
      { id: 101, number: 1, title: "Mission 1", completed: true, games_id: 10, bundle_member_id: null },
      { id: 102, number: 2, title: "Mission 2", completed: true, games_id: 10, bundle_member_id: null },
      { id: 103, number: 3, title: "Mission 3", completed: false, games_id: 10, bundle_member_id: null },
    ];

    it("skips the initial bulk-population run (before.total === 0)", async () => {
      mockDirectusFetch(feedRoutes({
        // Only the bulk-create run, no later completion updates.
        sectionRevisions: sectionRevisions.slice(0, 3),
        games: [game],
        sectionRows,
      }));

      await expect(buildFeedEntries()).resolves.toEqual([]);
    });

    it("reports each historical completion run against its own point-in-time state, not today's live totals", async () => {
      mockDirectusFetch(feedRoutes({
        sectionRevisions,
        games: [game],
        sectionRows,
      }));

      const entries = await buildFeedEntries();
      const sectionEntries = entries.filter((e) => e.description.includes("**Missions**"));
      expect(sectionEntries).toHaveLength(2);

      // Sorted newest-first by buildFeedEntries.
      const [recent, historical] = sectionEntries;
      // The August run only reflects mission 102 flipping -- mission 101's
      // September completion must NOT leak into this older run's totals.
      expect(historical.description).toBe("**Missions**: 0/3 (0%) \u2192 1/3 (33%)");
      expect(historical.pubDate.toISOString()).toBe("2026-08-01T10:00:00.000Z");
      // The September run picks up from the true prior state (1/3, not 0/3).
      expect(recent.description).toBe("**Missions**: 1/3 (33%) \u2192 2/3 (67%)");
      expect(recent.pubDate.toISOString()).toBe("2026-09-16T09:00:00.000Z");
    });

    it("formats a linear game's section-count run as a bare count, not a percent", async () => {
      const linearGame = { id: 20, title: "Beyond Time", slug: "beyond-time", section_style: "linear", section_noun: "Chapter" };
      const linearRevisions = [
        {
          id: 6001,
          item: "201",
          collection: "game_sections",
          data: { id: 201, games_id: 20, bundle_member_id: null, completed: false },
          delta: { games_id: 20 },
          activity: { action: "create", timestamp: "2026-01-01T00:00:00Z" },
        },
        {
          id: 6002,
          item: "208",
          collection: "game_sections",
          data: { id: 208, games_id: 20, bundle_member_id: null, completed: false },
          delta: { games_id: 20 },
          activity: { action: "create", timestamp: "2026-09-16T08:00:00Z" },
        },
      ];
      mockDirectusFetch(feedRoutes({
        sectionRevisions: linearRevisions,
        games: [linearGame],
        sectionRows: [
          { id: 201, number: 1, title: "Chapter 1", completed: false, games_id: 20, bundle_member_id: null },
          { id: 208, number: 8, title: "Chapter 8", completed: false, games_id: 20, bundle_member_id: null },
        ],
      }));

      const entries = await buildFeedEntries();
      const sectionEntry = entries.find((e) => e.description.includes("**Chapters**"));
      expect(sectionEntry?.description).toBe("**Chapters**: 1 \u2192 2");
    });
  });

  describe("same-game consolidation", () => {
    const game = { id: 30, title: "Saints & Sinners", slug: "saints-sinners" };

    it("merges same-game entries landing within 30 minutes into one feed item", async () => {
      mockDirectusFetch(feedRoutes({
        gameRevisions: [
          {
            id: 40,
            item: "30",
            collection: "games",
            data: { title: "Saints & Sinners", slug: "saints-sinners", release_year: 2020 },
            delta: { release_year: 2020 },
            activity: { action: "create", timestamp: "2026-09-16T06:41:01Z" },
          },
        ],
        linkActivities: [
          { id: 900, action: "create", collection: "games_links", item: "70", timestamp: "2026-09-16T06:41:08Z" },
          { id: 901, action: "create", collection: "games_links", item: "71", timestamp: "2026-09-16T06:55:00Z" },
        ],
        linkItems: [
          { id: 70, games_id: 30, url: "https://store.steampowered.com/app/916840/", kind: "download" },
          { id: 71, games_id: 30, url: "https://store.playstation.com/product/XYZ", kind: "download" },
        ],
        games: [game],
      }));

      const entries = await buildFeedEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].title).toBe("Game Added: Saints & Sinners");
      expect(entries[0].description).toContain("store.steampowered.com");
      expect(entries[0].description).toContain("store.playstation.com");
      // Anchored/reported at the last event's time, per mergeGameSession.
      expect(entries[0].pubDate.toISOString()).toBe("2026-09-16T06:55:00.000Z");
    });

    it("does not merge same-game entries more than 30 minutes apart", async () => {
      mockDirectusFetch(feedRoutes({
        gameRevisions: [
          {
            id: 41,
            item: "30",
            collection: "games",
            data: { title: "Saints & Sinners", slug: "saints-sinners", release_year: 2020 },
            delta: { release_year: 2020 },
            activity: { action: "create", timestamp: "2026-09-16T06:00:00Z" },
          },
        ],
        linkActivities: [
          { id: 902, action: "create", collection: "games_links", item: "72", timestamp: "2026-09-16T07:00:00Z" },
        ],
        linkItems: [
          { id: 72, games_id: 30, url: "https://store.steampowered.com/app/916840/", kind: "download" },
        ],
        games: [game],
      }));

      const entries = await buildFeedEntries();
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.title).sort()).toEqual([
        "Download Added: Saints & Sinners",
        "Game Added: Saints & Sinners",
      ]);
    });

    it("does not merge entries across different games or non-game entry types", async () => {
      mockDirectusFetch(feedRoutes({
        gameRevisions: [
          {
            id: 42,
            item: "30",
            collection: "games",
            data: { title: "Saints & Sinners", slug: "saints-sinners", release_year: 2020 },
            delta: { release_year: 2020 },
            activity: { action: "create", timestamp: "2026-09-16T06:00:00Z" },
          },
          {
            id: 43,
            item: "31",
            collection: "games",
            data: { title: "Other Game", slug: "other-game", release_year: 2021 },
            delta: { release_year: 2021 },
            activity: { action: "create", timestamp: "2026-09-16T06:05:00Z" },
          },
        ],
        games: [game, { id: 31, title: "Other Game", slug: "other-game" }],
      }));

      const entries = await buildFeedEntries();
      expect(entries).toHaveLength(2);
    });
  });
});

describe("renderFeedXml", () => {
  it("renders channel metadata and entries without leaking the classification field", () => {
    const entries: FeedEntry[] = [{
      title: "Game Added: Example",
      link: "https://jasmeralia.com/games/example/index.html",
      description: "Example description",
      pubDate: new Date("2026-09-04T12:00:00Z"),
      imageUrl: "https://jasmeralia.com/media/example.png",
      guid: "game:example:created:2026-09-04T12:00:00Z",
      nsfw: true,
      completed: false,
    }];

    const xml = renderFeedXml(entries, {
      title: "Jasmeralia Feed (NSFW)",
      description: "NSFW-only feed.",
    });

    expect(xml).toContain("<title>Jasmeralia Feed (NSFW)</title>");
    expect(xml).toContain("<description>NSFW-only feed.</description>");
    expect(xml).toContain('type="image/png"');
    expect(xml).toContain("<guid isPermaLink=\"false\">game:example:created:2026-09-04T12:00:00Z</guid>");
    expect(xml).not.toContain("<nsfw>");
    expect(xml).not.toContain("<completed>");
  });
});
