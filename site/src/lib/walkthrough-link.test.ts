import { describe, expect, it } from "vitest";

import { classifyWalkthroughValue, type WalkthroughKind } from "./walkthrough-link";

describe("classifyWalkthroughValue", () => {
  it.each([undefined, null, "", "   ", 42])("classifies %s as none provided", (value) => {
    expect(classifyWalkthroughValue(value)).toBe("none-provided");
  });

  it("classifies non-URL content as a text note", () => {
    expect(classifyWalkthroughValue("Choose the second dialogue option.")).toBe("text-note");
  });

  const recognized: [string, WalkthroughKind][] = [
    ["https://steamcommunity.com/sharedfiles/filedetails/?id=1", "steam"],
    ["https://example.itch.io/game/devlog/1", "itch"],
    ["https://gog.com/forum/game/guide", "gog"],
    ["https://patreon.com/posts/guide-1", "patreon"],
    ["https://playstation.com/en-us/support/games/example", "playstation"],
    ["https://xbox.com/en-US/games/example", "xbox"],
    ["https://ign.com/wikis/example", "ign"],
    ["https://scribd.com/document/1", "scribd"],
    ["https://f95zone.to/threads/example", "f95zone"],
    ["https://gamerant.com/example-guide", "gamerant"],
    ["https://neoseeker.com/example/walkthrough", "neoseeker"],
    ["https://trueachievements.com/game/example/walkthrough", "trueachievements"],
    ["https://stealthoptional.com/guides/example", "stealthoptional"],
  ];

  it.each(recognized)("classifies %s as %s", (url, expected) => {
    expect(classifyWalkthroughValue(url)).toBe(expected);
  });

  it("classifies an unrecognized HTTP URL as unknown", () => {
    expect(classifyWalkthroughValue("https://example.com/guide")).toBe("unknown");
    expect(classifyWalkthroughValue("https://store.epicgames.com/p/example")).toBe("unknown");
  });
});
