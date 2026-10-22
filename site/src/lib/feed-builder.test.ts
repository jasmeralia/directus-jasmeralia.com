import { describe, expect, it } from "vitest";

import { mockDirectusFetch } from "../test/directus-mock";
import { buildFeedEntries, renderFeedXml, type FeedEntry } from "./feed-builder";

type FeedRouteConfig = {
  gameRevisions?: unknown[];
  reviewRevisions?: unknown[];
  tierListRevisions?: unknown[];
  bundleMemberRevisions?: unknown[];
  sectionRevisions?: unknown[];
  musicListRevisions?: unknown[];
  musicTrackRevisions?: unknown[];
  linkRevisions?: unknown[];
  tlgActivities?: unknown[];
  linkActivities?: unknown[];
  genreActivities?: unknown[];
  games?: unknown[];
  sectionRows?: unknown[];
  bundleMembers?: unknown[];
  tierLists?: unknown[];
  tlgItems?: unknown[];
  linkItems?: unknown[];
  musicLists?: unknown[];
  musicLists?: unknown[];
  genreRows?: unknown[];
};

const feedRoutes = (config: FeedRouteConfig) => [
  { match: /\/revisions\?.*collection\]\[_eq\]=games(?:&|$)/, data: config.gameRevisions ?? [] },
  { match: /\/revisions\?.*collection\]\[_eq\]=reviews(?:&|$)/, data: config.reviewRevisions ?? [] },
  { match: /\/revisions\?.*collection\]\[_eq\]=tier_lists(?:&|$)/, data: config.tierListRevisions ?? [] },
  { match: /\/revisions\?.*collection\]\[_eq\]=game_bundle_members(?:&|$)/, data: config.bundleMemberRevisions ?? [] },
  { match: /\/revisions\?.*collection\]\[_eq\]=game_sections(?:&|$)/, data: config.sectionRevisions ?? [] },
  { match: /\/revisions\?.*collection\]\[_eq\]=games_music_lists(?:&|$)/, data: config.musicListRevisions ?? [] },
  { match: /\/revisions\?.*collection\]\[_eq\]=games_tracks(?:&|$)/, data: config.musicTrackRevisions ?? [] },
  { match: /\/revisions\?.*collection\]\[_eq\]=games_music_lists(?:&|$)/, data: config.musicListRevisions ?? [] },
  { match: /\/revisions\?.*collection\]\[_eq\]=games_tracks(?:&|$)/, data: config.musicTrackRevisions ?? [] },
  { match: /\/revisions\?.*collection\]\[_eq\]=games_music_lists(?:&|$)/, data: config.musicListRevisions ?? [] },
  { match: /\/revisions\?.*collection\]\[_eq\]=games_tracks(?:&|$)/, data: config.musicTrackRevisions ?? [] },
  { match: /\/revisions\?.*collection\]\[_eq\]=games_links(?:&|$)/, data: config.linkRevisions ?? [] },
  { match: /\/activity\?.*tier_list_games(?:&|$)/, data: config.tlgActivities ?? [] },
  { match: /\/activity\?.*games_links(?:&|$)/, data: config.linkActivities ?? [] },
  { match: /\/activity\?.*games_genres(?:&|$)/, data: config.genreActivities ?? [] },
  { match: "/items/tier_list_games?", data: config.tlgItems ?? [] },
  { match: "/items/games_links?", data: config.linkItems ?? [] },
  { match: "/items/reviews?", data: [] },
  { match: "/items/tier_lists?", data: config.tierLists ?? [] },
  { match: "/items/game_bundle_members?", data: config.bundleMembers ?? [] },
  { match: "/items/games?", data: config.games ?? [] },
  { match: "/items/game_sections?", data: config.sectionRows ?? [] },
  { match: "/items/games_music_lists?", data: config.musicLists ?? [] },
  { match: "/items/games_music_lists?", data: config.musicLists ?? [] },
  { match: "/items/games_music_lists?", data: config.musicLists ?? [] },
  { match: "/items/games_genres?", data: config.genreRows ?? [] },
];

describe("buildFeedEntries", () => {
  it("characterizes existing feed output for event families affected by the refactor", async () => {
    const cases: { name: string; config: FeedRouteConfig; expected: Record<string, unknown> }[] = [
      {
        name: "game created",
        config: {
          gameRevisions: [{ id: 1, item: "1", collection: "games", data: { title: "New Game", slug: "new-game", release_year: 2024 }, delta: {}, activity: { id: 101, action: "create", timestamp: "2026-10-01T01:02:03Z" } }],
          games: [{ id: 1, title: "New Game", slug: "new-game" }],
        },
        expected: { title: "Game Added: New Game", description: "**Year**: 2024", guid: "game:new-game:created:2026-10-01T01:02:03Z", pubDate: "2026-10-01T01:02:03.000Z", nsfw: false, completed: false },
      },
      {
        name: "game updated",
        config: {
          gameRevisions: [{ id: 2, item: "2", collection: "games", data: { title: "Updated Game", slug: "updated-game", player_status: "completed" }, delta: { player_status: "completed" }, activity: { id: 102, action: "update", timestamp: "2026-10-02T01:02:03Z" } }],
          games: [{ id: 2, title: "Updated Game", slug: "updated-game" }],
        },
        expected: { title: "Game Updated: Updated Game", description: "**Play Status**: Completed", guid: "game:updated-game:play_status:2026-10-02T01:02:03Z", pubDate: "2026-10-02T01:02:03.000Z", nsfw: false, completed: true },
      },
      {
        name: "download link added",
        config: {
          linkActivities: [{ id: 201, action: "create", collection: "games_links", item: "21", timestamp: "2026-10-03T01:02:03Z" }],
          linkItems: [{ id: 21, games_id: 3, url: "https://store.test/game", kind: "download" }],
          games: [{ id: 3, title: "Linked Game", slug: "linked-game" }],
        },
        expected: { title: "Download Link Added: Linked Game", description: "**URL**: https://store.test/game", guid: "game:linked-game:link_create_download_201:2026-10-03T01:02:03Z", pubDate: "2026-10-03T01:02:03.000Z", nsfw: false, completed: false },
      },
      {
        name: "walkthrough link updated",
        config: {
          linkActivities: [{ id: 202, action: "update", collection: "games_links", item: "22", timestamp: "2026-10-04T01:02:03Z" }],
          linkItems: [{ id: 22, games_id: 4, url: "https://guide.test/new", kind: "walkthrough" }],
          games: [{ id: 4, title: "Guide Game", slug: "guide-game" }],
        },
        expected: { title: "Walkthrough Link Updated: Guide Game", description: "**URL**: https://guide.test/new", guid: "game:guide-game:link_update_walkthrough_202:2026-10-04T01:02:03Z", pubDate: "2026-10-04T01:02:03.000Z", nsfw: false, completed: false },
      },
      {
        name: "other link added",
        config: {
          linkActivities: [{ id: 203, action: "create", collection: "games_links", item: "23", timestamp: "2026-10-05T01:02:03Z" }],
          linkItems: [{ id: 23, games_id: 5, url: "https://social.test/page", kind: "other" }],
          games: [{ id: 5, title: "Other Game", slug: "other-game" }],
        },
        expected: { title: "Other Link Added: Other Game", description: "**URL**: https://social.test/page", guid: "game:other-game:link_create_other_203:2026-10-05T01:02:03Z", pubDate: "2026-10-05T01:02:03.000Z", nsfw: false, completed: false },
      },
      {
        name: "included game added",
        config: {
          bundleMemberRevisions: [{ id: 301, item: "31", collection: "game_bundle_members", data: { id: 31, games_id: 6, title: "First Included", release_year: 2020 }, delta: {}, activity: { id: 3010, action: "create", timestamp: "2026-10-06T01:02:03Z" } }],
          games: [{ id: 6, title: "Bundle Game", slug: "bundle-game" }],
        },
        expected: { title: "Included Game Added - First Included", description: "**Title**: First Included\n**Year**: 2020", guid: "game:bundle-game:member_created_31_301:2026-10-06T01:02:03Z", pubDate: "2026-10-06T01:02:03.000Z", nsfw: false, completed: false },
      },
      {
        name: "included game updated",
        config: {
          bundleMemberRevisions: [
            { id: 312, item: "32", collection: "game_bundle_members", data: { id: 32, games_id: 7, title: "Second Included", player_status: "completed" }, delta: { player_status: "completed" }, activity: { id: 3120, action: "update", timestamp: "2026-10-07T01:02:03Z" } },
            { id: 311, item: "32", collection: "game_bundle_members", data: { id: 32, games_id: 7, title: "Second Included", player_status: "in_progress" }, delta: { sort: 1 }, activity: { id: 3110, action: "update", timestamp: "2026-10-06T01:02:03Z" } },
          ],
          games: [{ id: 7, title: "Bundle Game Two", slug: "bundle-game-two" }],
        },
        expected: { title: "Included Game Updated - Second Included", description: "**Play Status**: In Progress \u2192 Completed", guid: "game:bundle-game-two:member_updated_32_312:2026-10-07T01:02:03Z", pubDate: "2026-10-07T01:02:03.000Z", nsfw: false, completed: true },
      },
      {
        name: "included game removed",
        config: {
          bundleMemberRevisions: [{ id: 321, item: "33", collection: "game_bundle_members", data: { id: 33, games_id: 8, title: "Removed Included" }, delta: null, activity: { id: 3210, action: "delete", timestamp: "2026-10-08T01:02:03Z" } }],
          games: [{ id: 8, title: "Bundle Game Three", slug: "bundle-game-three" }],
        },
        expected: { title: "Included Game Removed - Removed Included", description: "Included game removed.", guid: "game:bundle-game-three:member_removed_33_3210:2026-10-08T01:02:03Z", pubDate: "2026-10-08T01:02:03.000Z", nsfw: false, completed: false },
      },
      {
        name: "review published",
        config: {
          reviewRevisions: [{ id: 401, item: "41", collection: "reviews", data: { title: "A Review", slug: "a-review", status: "published", rating: 8, published_at: "2026-10-09T00:00:00Z" }, delta: {}, activity: { id: 4010, action: "create", timestamp: "2026-10-09T01:02:03Z" } }],
          tlgItems: [],
        },
        expected: { title: "Review Published: A Review", description: "**Rating**: 8/10\n**Published**: 2026-10-09", guid: "review:a-review:published:2026-10-09T01:02:03Z", pubDate: "2026-10-09T01:02:03.000Z", nsfw: false, completed: false },
      },
      {
        name: "review updated",
        config: {
          reviewRevisions: [{ id: 402, item: "42", collection: "reviews", data: { title: "A Review Update", slug: "a-review-update", status: "published" }, delta: { rating: 9 }, activity: { id: 4020, action: "update", timestamp: "2026-10-10T01:02:03Z" } }],
        },
        expected: { title: "Review Updated: A Review Update", description: "**Rating**: 9", guid: "review:a-review-update:updated:2026-10-10T01:02:03Z", pubDate: "2026-10-10T01:02:03.000Z", nsfw: false, completed: false },
      },
      {
        name: "tier list published",
        config: {
          tierListRevisions: [{ id: 501, item: "51", collection: "tier_lists", data: { title: "Top Games", slug: "top-games", description: "Favorites", status: "published" }, delta: { status: "published" }, activity: { id: 5010, action: "update", timestamp: "2026-10-11T01:02:03Z" } }],
          tierLists: [{ id: 51, title: "Top Games", slug: "top-games" }],
        },
        expected: { title: "Tier List Published: Top Games", description: "**Title**: Top Games\n**Description**: Favorites", guid: "tier-list:top-games:published:2026-10-11T01:02:03Z", pubDate: "2026-10-11T01:02:03.000Z", nsfw: false, completed: false },
      },
    ];

    for (const { name, config, expected } of cases) {
      mockDirectusFetch(feedRoutes(config));
      const entries = await buildFeedEntries();
      expect(entries, name).toHaveLength(1);
      const { title, description, guid, pubDate, nsfw, completed } = entries[0];
      expect({ title, description, guid, pubDate: pubDate.toISOString(), nsfw, completed }, name).toEqual(expected);
    }
  });

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

  it("shows old and new values on a review update when the previous revision is in the window", async () => {
    mockDirectusFetch(feedRoutes({
      reviewRevisions: [
        { id: 431, item: "43", collection: "reviews", data: { title: "R", slug: "r", status: "published", rating: 4 }, delta: { rating: 4 }, activity: { id: 4310, action: "update", timestamp: "2026-10-12T00:00:00Z" } },
        { id: 430, item: "43", collection: "reviews", data: { title: "R", slug: "r", status: "published", rating: 3 }, delta: { rating: 3 }, activity: { id: 4300, action: "update", timestamp: "2026-10-11T00:00:00Z" } },
      ],
    }));
    const entries = await buildFeedEntries();
    expect(entries.map(({ title, description, guid }) => ({ title, description, guid }))).toEqual([
      { title: "Review Updated: R", description: "**Rating**: 3 \u2192 4", guid: "review:r:updated:2026-10-12T00:00:00Z" },
      { title: "Review Updated: R", description: "**Rating**: 3", guid: "review:r:updated:2026-10-11T00:00:00Z" },
    ]);
  });

  it("emits a genre event and lists only initial genres in a new-game description", async () => {
    mockDirectusFetch(feedRoutes({
      gameRevisions: [{
        id: 700, item: "70", collection: "games",
        data: { title: "Genre Game", slug: "genre-game", release_year: 2025 }, delta: {},
        activity: { id: 7000, action: "create", timestamp: "2026-10-01T00:00:00Z" },
      }],
      genreRows: [
        { id: 701, games_id: 70, genres_id: { name: "Initial" } },
        { id: 702, games_id: 70, genres_id: { name: "Added Later" } },
      ],
      genreActivities: [
        { id: 7010, action: "create", collection: "games_genres", item: "701", timestamp: "2026-10-01T00:04:00Z" },
        { id: 7020, action: "create", collection: "games_genres", item: "702", timestamp: "2026-10-01T01:00:00Z" },
      ],
      games: [{ id: 70, title: "Genre Game", slug: "genre-game" }],
    }));

    const entries = await buildFeedEntries();
    expect(entries.map(({ title, description, guid }) => ({ title, description, guid }))).toEqual([
      {
        title: "Genre Added: Genre Game",
        description: "**Genre**: Added Later",
        guid: "game:genre-game:genre_added_7020:2026-10-01T01:00:00Z",
      },
      {
        title: "Game Added: Genre Game",
        description: "**Year**: 2025\n**Genres**: Initial",
        guid: "game:genre-game:created:2026-10-01T00:00:00Z",
      },
    ]);
  });

  it("uses shared event titles for other and GameStoryLog link kinds", async () => {
    mockDirectusFetch(feedRoutes({
      linkActivities: [
        { id: 801, action: "create", collection: "games_links", item: "81", timestamp: "2026-10-02T00:00:00Z" },
        { id: 802, action: "create", collection: "games_links", item: "82", timestamp: "2026-10-02T00:40:00Z" },
      ],
      linkItems: [
        { id: 81, games_id: 80, url: "https://other.test", kind: "other" },
        { id: 82, games_id: 80, url: "https://gsl.test", kind: "gamestorylog" },
      ],
      linkRevisions: [
        { id: 812, item: "82", collection: "games_links", data: { url: "https://gsl.test", kind: "gamestorylog" }, delta: {}, activity: { id: 802, action: "create", timestamp: "2026-10-02T00:40:00Z" } },
        { id: 811, item: "81", collection: "games_links", data: { url: "https://other.test", kind: "other" }, delta: {}, activity: { id: 801, action: "create", timestamp: "2026-10-02T00:00:00Z" } },
      ],
      games: [{ id: 80, title: "Kinds Game", slug: "kinds-game" }],
    }));
    const entries = await buildFeedEntries();
    expect(entries.map(({ title, description }) => ({ title, description }))).toEqual([
      { title: "GameStoryLog Link Added: Kinds Game", description: "**URL**: https://gsl.test\n**Kind**: GameStoryLog" },
      { title: "Other Link Added: Kinds Game", description: "**URL**: https://other.test\n**Kind**: Other link" },
    ]);
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

  it("adds music list and batched track feed entries with stable game links and no track metadata", async () => {
    const timestamp = "2026-10-04T01:02:03Z";
    mockDirectusFetch(feedRoutes({
      musicListRevisions: [
        { id: 70, item: "70", collection: "games_music_lists", data: { games_id: 7, title: "Soundtrack", url: "https://music.test" }, delta: null, activity: { id: 700, action: "create", timestamp } },
      ],
      musicTrackRevisions: Array.from({ length: 30 }, (_, index) => ({
        id: 80 + index, item: String(80 + index), collection: "games_tracks",
        data: { games_music_lists_id: 70, title: `secret track ${index}`, artist: "secret artist", url: "https://secret.track", scene: "secret scene", characters: ["secret character"], note: "secret note" },
        delta: null, activity: { id: 800 + index, action: "create", timestamp },
      })),
      musicLists: [{ id: 70, games_id: 7, title: "Soundtrack", url: "https://music.test" }],
      games: [{ id: 7, title: "Music Game", slug: "music-game", nsfw: true }],
    }));
    const entries = await buildFeedEntries();
    expect(entries).toHaveLength(1); // Same-game events consolidate into one feed item.
    expect(entries[0]).toMatchObject({
      title: "Game Updated: Music Game",
      link: "https://assets.test/games/music-game/index.html",
      nsfw: true,
      guid: expect.stringMatching(/^game:music-game:consolidated_/),
    });
    expect(entries[0].description).toContain("30 added");
    expect(entries[0].description).not.toMatch(/secret track|secret artist|secret\.track|secret scene|secret character|secret note/);
  });

  it("adds music list and batched track feed entries with stable game links and no track metadata", async () => {
    const timestamp = "2026-10-04T01:02:03Z";
    mockDirectusFetch(feedRoutes({
      musicListRevisions: [
        { id: 70, item: "70", collection: "games_music_lists", data: { games_id: 7, title: "Soundtrack", url: "https://music.test" }, delta: null, activity: { id: 700, action: "create", timestamp } },
      ],
      musicTrackRevisions: Array.from({ length: 30 }, (_, index) => ({
        id: 80 + index, item: String(80 + index), collection: "games_tracks",
        data: { games_music_lists_id: 70, title: `secret track ${index}`, artist: "secret artist", url: "https://secret.track", scene: "secret scene", characters: ["secret character"], note: "secret note" },
        delta: null, activity: { id: 800 + index, action: "create", timestamp },
      })),
      musicLists: [{ id: 70, games_id: 7, title: "Soundtrack", url: "https://music.test" }],
      games: [{ id: 7, title: "Music Game", slug: "music-game", nsfw: true }],
    }));
    const entries = await buildFeedEntries();
    expect(entries).toHaveLength(1); // Same-game events consolidate into one feed item.
    expect(entries[0]).toMatchObject({
      title: "Game Updated: Music Game",
      link: "https://assets.test/games/music-game/index.html",
      nsfw: true,
      guid: expect.stringMatching(/^game:music-game:consolidated_/),
    });
    expect(entries[0].description).toContain("30 added");
    expect(entries[0].description).not.toMatch(/secret track|secret artist|secret\.track|secret scene|secret character|secret note/);
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
        "Download Link Added: Saints & Sinners",
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

    it("merges a link and game update using the explicit bare game title", async () => {
      mockDirectusFetch(feedRoutes({
        gameRevisions: [{
          id: 44, item: "30", collection: "games",
          data: { title: "Saints & Sinners", slug: "saints-sinners", release_year: 2020, player_status: "on_hold" },
          delta: { player_status: "on_hold" },
          activity: { action: "update", timestamp: "2026-09-16T06:41:01Z" },
        }],
        linkActivities: [{ id: 903, action: "create", collection: "games_links", item: "73", timestamp: "2026-09-16T06:41:08Z" }],
        linkItems: [{ id: 73, games_id: 30, url: "https://guide.test", kind: "walkthrough" }],
        games: [game],
      }));
      const entries = await buildFeedEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].title).toBe("Game Updated: Saints & Sinners");
      expect(entries[0].description).toContain("**Play Status**: On Hold");
      expect(entries[0].description).toContain("**URL**: https://guide.test");
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
