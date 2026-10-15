import { describe, expect, it } from "vitest";

import { describeGenreAdded, describeLinkEvent, partitionGameGenres } from "./game-events";

const revision = (
  action: string,
  delta: Record<string, unknown> | null,
  data: Record<string, unknown> | null,
) => ({
  id: 1,
  item: "1",
  collection: "games_links",
  delta,
  data,
  activity: { id: 10, action, timestamp: "2026-10-01T00:00:00Z" },
});

describe("describeLinkEvent", () => {
  it("describes link creation using the revision snapshot, with delta fallback", () => {
    expect(describeLinkEvent({
      action: "create",
      link: { url: "https://live.test", kind: "gamestorylog" },
      revision: revision("create", {}, { url: "https://created.test", kind: "gamestorylog", label: "GSL" }),
    })).toEqual({
      type: "link_added",
      title: "GameStoryLog Link Added",
      body: "**URL**: https://created.test\n**Kind**: GameStoryLog\n**Label**: GSL",
    });
    expect(describeLinkEvent({
      action: "create",
      link: { kind: "unknown" },
      revision: revision("create", { url: "https://delta.test", kind: "mystery" }, null),
    })?.body).toBe("**URL**: https://delta.test\n**Kind**: mystery");
  });

  it("uses the live URL when no revision exists and leaves the body empty without a URL", () => {
    expect(describeLinkEvent({ action: "create", link: { url: "https://fallback.test" } })).toEqual({
      type: "link_added",
      title: "Download Link Added",
      body: "**URL**: https://fallback.test",
    });
    expect(describeLinkEvent({ action: "create", link: {} })?.body).toBe("");
  });

  it("describes URL, kind, and cleared-label updates and skips sort-only updates", () => {
    expect(describeLinkEvent({
      action: "update",
      link: { url: "https://new.test", kind: "walkthrough" },
      revision: revision("update", { url: "https://new.test" }, { url: "https://new.test" }),
      previousData: { url: "https://old.test" },
    })?.body).toBe("**URL**: https://old.test \u2192 https://new.test");
    expect(describeLinkEvent({
      action: "update",
      link: { url: "https://guide.test", kind: "download" },
      revision: revision("update", { kind: "download" }, { url: "https://guide.test", kind: "download" }),
      previousData: { url: "https://guide.test", kind: "walkthrough" },
    })?.body).toBe("**URL**: https://guide.test\n**Kind**: Walkthrough \u2192 Download");
    expect(describeLinkEvent({
      action: "update",
      link: { url: "https://guide.test", kind: "other" },
      revision: revision("update", { label: null }, { url: "https://guide.test", kind: "other", label: null }),
      previousData: { url: "https://guide.test", kind: "other", label: "Old" },
    })?.body).toBe("**URL**: https://guide.test\n**Label**: Old \u2192 \u2014");
    expect(describeLinkEvent({
      action: "update",
      link: { url: "https://guide.test" },
      revision: revision("update", { sort: 2 }, { url: "https://guide.test" }),
      previousData: { url: "https://guide.test" },
    })).toBeNull();
  });

  it("handles updates without a URL revision and displays unknown kinds as raw labels", () => {
    expect(describeLinkEvent({
      action: "update",
      link: { kind: "mystery" },
      revision: revision("update", { kind: "mystery" }, null),
      previousData: {},
    })?.body).toBe("**Kind**: \u2014 \u2192 mystery");
    expect(describeLinkEvent({
      action: "update",
      link: { kind: "text-note" },
    })).toEqual({ type: "link_updated", title: "Walkthrough Link Updated", body: "" });
  });
});

describe("partitionGameGenres", () => {
  const createdAt = new Date("2026-10-01T00:00:00Z");
  const links = [
    { id: 1, name: "First" },
    { id: 2, name: "Boundary" },
    { id: 3, name: "Later" },
    { id: 4, name: "No Activity" },
  ];
  const activities = [
    { id: 101, item: "1", action: "create", collection: "games_genres", timestamp: "2026-10-01T00:00:00Z" },
    { id: 102, item: "2", action: "create", collection: "games_genres", timestamp: "2026-10-01T00:05:00Z" },
    { id: 103, item: "3", action: "create", collection: "games_genres", timestamp: "2026-10-01T00:05:00.001Z" },
  ];

  it("partitions in join order and includes the exact five-minute boundary", () => {
    expect(partitionGameGenres({ genreLinks: links, activities, createdAt })).toEqual({
      initial: ["First", "Boundary", "No Activity"],
      added: [{ name: "Later", at: new Date("2026-10-01T00:05:00.001Z"), activityId: 103 }],
    });
  });

  it("treats every current genre as initial when the game creation time is unknown", () => {
    expect(partitionGameGenres({ genreLinks: links, activities, createdAt: null })).toEqual({
      initial: ["First", "Boundary", "Later", "No Activity"],
      added: [],
    });
  });
});

describe("describeGenreAdded", () => {
  it("returns the genre event shape", () => {
    expect(describeGenreAdded("Mystery")).toEqual({
      type: "genre_added",
      title: "Genre Added",
      body: "**Genre**: Mystery",
    });
  });
});
