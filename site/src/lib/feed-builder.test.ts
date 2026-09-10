import { describe, expect, it } from "vitest";

import { mockDirectusFetch } from "../test/directus-mock";
import { buildFeedEntries, renderFeedXml, type FeedEntry } from "./feed-builder";

const feedRoutes = (gameRevisions: unknown[], games: unknown[]) => [
  { match: /\/revisions\?.*games(?:&|$)/, data: gameRevisions },
  { match: /\/revisions\?.*reviews(?:&|$)/, data: [] },
  { match: /\/revisions\?.*tier_lists(?:&|$)/, data: [] },
  { match: /\/revisions\?.*game_bundle_members(?:&|$)/, data: [] },
  { match: /\/activity\?.*tier_list_games(?:&|$)/, data: [] },
  { match: /\/activity\?.*games_links(?:&|$)/, data: [] },
  { match: "/items/games?", data: games },
  { match: "/items/game_sections?", data: [] },
  { match: "/items/games_genres?", data: [] },
];

describe("buildFeedEntries", () => {
  it("suppresses game revisions containing only version fields and skipped noise", async () => {
    mockDirectusFetch(feedRoutes([
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
    ], [{ id: 1, title: "Versioned Game", slug: "versioned-game" }]));

    await expect(buildFeedEntries()).resolves.toEqual([]);
  });

  it("emits mixed game revisions without version-field description lines", async () => {
    mockDirectusFetch(feedRoutes([
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
    ], [{ id: 1, title: "Versioned Game", slug: "versioned-game" }]));

    const entries = await buildFeedEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("Game Updated: Versioned Game");
    expect(entries[0].description).toBe("**Play Status**: Completed");
    expect(entries[0].description).not.toContain("version_orion");
    expect(entries[0].guid).toContain(":play_status:");
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
