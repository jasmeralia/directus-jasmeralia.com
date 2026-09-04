import { describe, expect, it } from "vitest";

import { renderFeedXml, type FeedEntry } from "./feed-builder";

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
  });
});
