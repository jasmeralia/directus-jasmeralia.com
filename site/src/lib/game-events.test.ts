import { describe, expect, it } from "vitest";

import {
  describeGenreAdded,
  describeLinkEvent,
  describeMemberEvent,
  describeReviewEvent,
  describeTierEntryAdded,
  isCreateRevision,
  partitionGameGenres,
} from "./game-events";

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

describe("review, member, tier, and create events", () => {
  it("describes published reviews, includes optional game and metadata, and skips drafts or blank updates", () => {
    const published = {
      ...revision("create", {}, { title: "Review", status: "published", rating: 8, published_at: "2026-10-01T12:00:00Z" }),
      collection: "reviews",
    };
    expect(describeReviewEvent({ revision: published, includeGame: true, gameTitle: "Game" })).toEqual({
      type: "review_published",
      title: "Review Published",
      subject: "Review",
      body: "**Game**: Game\n**Rating**: 8/10\n**Published**: 2026-10-01",
    });
    expect(describeReviewEvent({ revision: published, includeGame: false })).toEqual({
      type: "review_published",
      title: "Review Published",
      subject: "Review",
      body: "**Rating**: 8/10\n**Published**: 2026-10-01",
    });
    expect(describeReviewEvent({
      revision: { ...published, activity: { id: 11, action: "update", timestamp: "2026-10-01T00:00:00Z" }, data: { title: "Review", status: "published" }, delta: { rating: 9 } },
      previousData: { title: "Review", status: "published", rating: 8 },
      includeGame: false,
    })?.body).toBe("**Rating**: 8 \u2192 9");
    expect(describeReviewEvent({
      revision: { ...published, activity: { id: 13, action: "update", timestamp: "2026-10-01T00:00:00Z" }, data: { title: "Review", status: "published" }, delta: null },
      includeGame: false,
    })).toBeNull();
    expect(describeReviewEvent({
      revision: { ...published, activity: { id: 14, action: "update", timestamp: "2026-10-01T00:00:00Z" }, data: null, delta: { status: "published" } },
      includeGame: false,
    })).toEqual({
      type: "review_published",
      title: "Review Published",
      subject: "Untitled",
      body: "New review published.",
    });
    expect(describeReviewEvent({ revision: { ...published, data: { title: "Draft", status: "draft" } }, includeGame: false })).toBeNull();
    expect(describeReviewEvent({
      revision: { ...published, activity: { id: 12, action: "update", timestamp: "2026-10-01T00:00:00Z" }, data: { title: "Review", status: "draft" }, delta: { status: "draft" } },
      previousData: published.data,
      includeGame: false,
    })).toBeNull();
  });

  it("describes member creation, meaningful updates, and removals", () => {
    const memberRevision = {
      ...revision("create", {}, { title: "Member", release_year: 2020, player_status: "not_started" }),
      collection: "game_bundle_members",
    };
    expect(describeMemberEvent({ revision: memberRevision, previousData: null, sections: null, isCreate: true, isDelete: false })).toEqual({
      type: "member_added",
      title: "Included Game Added",
      subject: "Member",
      body: "**Title**: Member\n**Year**: 2020\n**Play Status**: Not Started",
    });
    expect(describeMemberEvent({
      revision: { ...memberRevision, activity: { id: 11, action: "update", timestamp: "2026-10-01T00:00:00Z" }, data: { title: "Member", player_status: "completed" }, delta: { player_status: "completed" } },
      previousData: { title: "Member", player_status: "in_progress" },
      sections: null,
      isCreate: false,
      isDelete: false,
    })?.body).toBe("**Play Status**: In Progress \u2192 Completed");
    expect(describeMemberEvent({
      revision: { ...memberRevision, delta: { sort: 2 } }, previousData: null, sections: null, isCreate: false, isDelete: false,
    })).toBeNull();
    expect(describeMemberEvent({ revision: { ...memberRevision, data: null }, previousData: null, sections: null, isCreate: false, isDelete: true })).toEqual({
      type: "member_removed",
      title: "Included Game Removed",
      subject: "Untitled",
      body: "Included game removed.",
    });
  });

  it("describes tier additions and distinguishes explicit creates from oldest snapshots", () => {
    expect(describeTierEntryAdded({ tierListTitle: "Favorites", rating: "S" })).toEqual({
      type: "tier_entry_added",
      title: "Added to Tier List",
      subject: "Favorites",
      body: "**Tier**: S",
    });
    expect(isCreateRevision(revision("create", {}, {}), false)).toBe(true);
    expect(isCreateRevision(revision("update", {}, {}), true)).toBe(true);
    expect(isCreateRevision(revision("update", {}, {}), false)).toBe(false);
  });
});
