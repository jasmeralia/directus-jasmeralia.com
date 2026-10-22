import { describe, expect, it } from "vitest";

import { buildGameHistory, deltaLinesToHtml } from "./game-history";

const emptyHistoryInputs = () => ({
  allGameRevisions: [],
  allReviewRevisions: [],
  allTierCreateActivities: [],
  allTierRevisions: [],
  allLinkActivities: [],
  allBundleMemberRevisions: [],
  genreLinks: [],
});

describe("buildGameHistory", () => {
  it("includes music list and track runs without exposing track metadata", () => {
    const entries = buildGameHistory({
      gameId: 7,
      reviews: [], tierEntries: [], links: [], bundleMembers: [], genreLinks: [],
      musicLists: [{ id: 90, games_id: 7, title: "Soundtrack" }],
      ...emptyHistoryInputs(),
      allMusicListRevisions: [
        { id: 1, item: "90", collection: "games_music_lists", data: { games_id: 7, title: "Soundtrack", url: "https://music.test" }, delta: null, activity: { action: "create", timestamp: "2026-10-01T12:00:00Z" } },
      ],
      allMusicTrackRevisions: [
        { id: 2, item: "100", collection: "games_tracks", data: { games_music_lists_id: 90, title: "track secret", artist: "artist secret", url: "https://track.secret", scene: "scene secret", characters: ["character secret"], note: "note secret" }, delta: null, activity: { action: "create", timestamp: "2026-10-01T12:01:00Z" } },
      ],
    });
    expect(entries.map(({ title }) => title)).toEqual(["Tracks Added - Soundtrack", "Music List Added - Soundtrack"]);
    expect(entries[0].bodyHtml).toContain("1 added");
    expect(entries[0].bodyHtml).not.toMatch(/track secret|artist secret|track\.secret|scene secret|character secret|note secret/);
  });

  it("combines meaningful game, review, bundle, tier, and link events newest first", () => {
    const entries = buildGameHistory({
      gameId: 7,
      reviews: [{ id: 11 }, { id: 12 }],
      tierEntries: [{ id: 21, rating: "B", tier_list_id: { title: "Favorites" } }],
      links: [
        { id: 31, kind: "walkthrough", url: "https://guide.test" },
        { id: 32, kind: "download", url: "https://store.test" },
      ],
      bundleMembers: [{ id: 41, title: "Current Member" }],
      genreLinks: [{ id: 1, name: "Adventure" }],
      allGameRevisions: [
        {
          id: 30,
          item: "7",
          collection: "games",
          data: { title: "New & <Game>" },
          delta: { title: "New & <Game>" },
          activity: { action: "update", timestamp: "2026-07-10T12:00:00Z" },
        },
        {
          id: 20,
          item: "7",
          collection: "games",
          data: { title: "Old <Game>", release_year: 2025 },
          delta: { slug: "old-game" },
          activity: { action: "update", timestamp: "2026-07-02T12:00:00Z" },
        },
        {
          id: 10,
          item: "7",
          collection: "games",
          data: { release_year: 2024, player_status: "not_started" },
          delta: null,
          activity: { action: "update", timestamp: "2026-07-01T12:00:00Z" },
        },
      ],
      allReviewRevisions: [
        {
          id: 42,
          item: "11",
          collection: "reviews",
          data: { title: "Launch Review", status: "published", rating: 8, published_at: "2026-07-09T00:00:00Z" },
          delta: {},
          activity: { action: "create", timestamp: "2026-07-09T12:00:00Z" },
        },
        {
          id: 41,
          item: "11",
          collection: "reviews",
          data: { title: "Launch Review", status: "published", rating: 4 },
          delta: { rating: 4 },
          activity: { action: "update", timestamp: "2026-07-08T12:00:00Z" },
        },
        {
          id: 40,
          item: "12",
          collection: "reviews",
          data: { title: "", status: "published" },
          delta: { status: "published" },
          activity: { action: "update", timestamp: "2026-07-07T12:00:00Z" },
        },
        {
          id: 39,
          item: "12",
          collection: "reviews",
          data: { title: "Ignored" },
          delta: { slug: "ignored" },
          activity: { action: "update", timestamp: "2026-07-06T12:00:00Z" },
        },
        {
          id: 38,
          item: "999",
          collection: "reviews",
          data: { title: "Unrelated review" },
          delta: { title: "Unrelated review" },
          activity: { action: "update", timestamp: "2026-07-06T13:00:00Z" },
        },
      ],
      allTierCreateActivities: [
        {
          id: 70,
          item: "21",
          collection: "tier_list_games",
          action: "create",
          timestamp: "2026-07-05T12:00:00Z",
        },
        {
          id: 71,
          item: "999",
          collection: "tier_list_games",
          action: "create",
          timestamp: "2026-07-05T11:00:00Z",
        },
      ],
      allTierRevisions: [
        {
          id: 82,
          item: "21",
          collection: "tier_list_games",
          data: { rating: "B" },
          delta: { rating: "B" },
          activity: { action: "update", timestamp: "2026-07-04T12:00:00Z" },
        },
        {
          id: 81,
          item: "21",
          collection: "tier_list_games",
          data: { rating: "A" },
          delta: { title: "ignored" },
          activity: { action: "update", timestamp: "2026-07-03T12:00:00Z" },
        },
        {
          id: 80,
          item: "21",
          collection: "tier_list_games",
          data: { rating: null },
          delta: { rating: "A" },
          activity: { action: "create", timestamp: "2026-07-02T12:00:00Z" },
        },
      ],
      allLinkActivities: [
        {
          id: 90,
          item: "31",
          collection: "games_links",
          action: "create",
          timestamp: "2026-07-03T18:00:00Z",
        },
        {
          id: 91,
          item: "32",
          collection: "games_links",
          action: "update",
          timestamp: "2026-07-03T17:00:00Z",
        },
        {
          id: 92,
          item: "999",
          collection: "games_links",
          action: "create",
          timestamp: "2026-07-03T16:00:00Z",
        },
      ],
      allBundleMemberRevisions: [
        {
          id: 62,
          item: "41",
          collection: "game_bundle_members",
          data: { title: "Old Member", current_section: 2 },
          delta: { current_section: 2 },
          activity: { action: "update", timestamp: "2026-07-06T18:00:00Z" },
        },
        {
          id: 61,
          item: "41",
          collection: "game_bundle_members",
          data: { title: "Old Member", current_section: 1 },
          delta: null,
          activity: { action: "update", timestamp: "2026-07-01T18:00:00Z" },
        },
      ],
    });

    expect(entries.map(({ title }) => title)).toEqual([
      "Game Updated",
      "Review Published — Launch Review",
      "Review Updated — Launch Review",
      "Review Published — Untitled",
      "Included Game Updated - Current Member",
      "Added to Tier List — Favorites (B)",
      "Tier Changed — Favorites (A → B)",
      "Walkthrough Link Added",
      "Download Link Updated",
      "Included Game Added - Current Member",
      "Game Added",
    ]);
    expect(entries.map(({ date }) => date.getTime())).toEqual(
      entries.map(({ date }) => date.getTime()).toSorted((a, b) => b - a),
    );
    expect(entries[0].bodyHtml).toBe(
      '<ul class="history-changes"><li><strong>Title</strong>: Old &lt;Game&gt; → New &amp; &lt;Game&gt;</li></ul>',
    );
    expect(entries[1].bodyHtml).toBe(
      '<ul class="history-changes"><li><strong>Rating</strong>: 8/10</li><li><strong>Published</strong>: 2026-07-09</li></ul>',
    );
    expect(entries[5].bodyHtml).toBe(
      '<ul class="history-changes"><li><strong>Tier</strong>: B</li></ul>',
    );
    expect(entries[9].bodyHtml).toContain("<strong>Title</strong>: Old Member");
    expect(entries.at(-1)?.bodyHtml).toContain("<strong>Genres</strong>: Adventure");
  });

  it("formats a game update whose revision data snapshot is null", () => {
    const entries = buildGameHistory({
      gameId: 7,
      reviews: [],
      tierEntries: [],
      links: [],
      bundleMembers: [],
      ...emptyHistoryInputs(),
      allGameRevisions: [
        {
          id: 201,
          item: "7",
          collection: "games",
          data: null,
          delta: null,
          activity: { action: "update", timestamp: "2026-07-11T12:00:00Z" },
        },
        {
          id: 200,
          item: "7",
          collection: "games",
          data: { title: "Baseline" },
          delta: { title: "Baseline" },
          activity: { action: "create", timestamp: "2026-07-01T12:00:00Z" },
        },
      ],
    });

    expect(entries.map(({ title }) => title)).toEqual(["Game Added"]);
  });

  it("formats an included-game update whose delta is null", () => {
    const entries = buildGameHistory({
      gameId: 7,
      reviews: [],
      tierEntries: [],
      links: [],
      bundleMembers: [{ id: 42 }],
      ...emptyHistoryInputs(),
      allBundleMemberRevisions: [
        {
          id: 502,
          item: "42",
          collection: "game_bundle_members",
          data: { title: "Member Two", current_section: 2 },
          delta: null,
          activity: { action: "update", timestamp: "2026-07-12T12:00:00Z" },
        },
        {
          id: 501,
          item: "42",
          collection: "game_bundle_members",
          data: { title: "Member Two", current_section: 1 },
          delta: { title: "Member Two" },
          activity: { action: "update", timestamp: "2026-07-11T12:00:00Z" },
        },
      ],
    });

    expect(entries.map(({ title }) => title)).toEqual(["Included Game Added - Member Two"]);
    expect(entries[0].bodyHtml).toContain("<strong>Title</strong>: Member Two");
  });

  it("keeps removed included games out of History", () => {
    const entries = buildGameHistory({
      gameId: 7,
      reviews: [],
      tierEntries: [],
      links: [],
      bundleMembers: [{ id: 42, title: "Removed Member" }],
      ...emptyHistoryInputs(),
      allBundleMemberRevisions: [{
        id: 601,
        item: "42",
        collection: "game_bundle_members",
        data: { title: "Removed Member" },
        delta: null,
        activity: { action: "delete", timestamp: "2026-07-13T12:00:00Z" },
      }],
    });

    expect(entries).toEqual([]);
  });

  it("rejects a revision without a valid required timestamp", () => {
    expect(() =>
      buildGameHistory({
        gameId: 7,
        reviews: [],
        tierEntries: [],
        links: [],
        bundleMembers: [],
        ...emptyHistoryInputs(),
        allGameRevisions: [{
          id: 101,
          item: "7",
          collection: "games",
          data: { title: "No Date" },
          delta: null,
          activity: { action: "create", timestamp: "" },
        }],
      })
    ).toThrow("Missing required history timestamp: game revision 101");
  });

  it("returns no entries when nothing is scoped to this game", () => {
    const entries = buildGameHistory({
      gameId: 7,
      reviews: [],
      tierEntries: [],
      links: [],
      bundleMembers: [],
      ...emptyHistoryInputs(),
    });

    expect(entries).toEqual([]);
  });
});

describe("link history details", () => {
  const revision = (
    id: number,
    item: string,
    activityId: number,
    action: string,
    timestamp: string,
    data: Record<string, unknown>,
    delta: Record<string, unknown>,
  ) => ({ id, item, collection: "games_links", data, delta, activity: { id: activityId, action, timestamp } });
  const activity = (id: number, item: string, action: string, timestamp: string) => ({
    id, item, action, collection: "games_links", timestamp,
  });

  it("shows what a link event added or changed, and skips sort-only edits", () => {
    const entries = buildGameHistory({
      ...emptyHistoryInputs(),
      gameId: 7,
      reviews: [],
      tierEntries: [],
      links: [
        { id: 31, kind: "download", url: "https://b.test/new" },
        { id: 32, kind: "other", url: "https://youtube.com/@x" },
      ],
      bundleMembers: [],
      allLinkActivities: [
        activity(1, "31", "create", "2026-07-01T00:00:00Z"),
        activity(2, "31", "update", "2026-07-02T00:00:00Z"),
        activity(3, "31", "update", "2026-07-03T00:00:00Z"),
        activity(4, "32", "update", "2026-07-04T00:00:00Z"),
      ],
      allLinkRevisions: [
        revision(11, "31", 1, "create", "2026-07-01T00:00:00Z",
          { url: "https://a.test/old", kind: "download", label: null, sort: 1, games_id: 7 }, {}),
        revision(12, "31", 2, "update", "2026-07-02T00:00:00Z",
          { url: "https://b.test/new", kind: "download", label: null, sort: 1 }, { url: "https://b.test/new" }),
        revision(13, "31", 3, "update", "2026-07-03T00:00:00Z",
          { url: "https://b.test/new", kind: "download", label: null, sort: 2 }, { sort: 2 }),
        revision(14, "32", 4, "update", "2026-07-04T00:00:00Z",
          { url: "https://youtube.com/@x", kind: "other", label: null }, { kind: "other" }),
      ],
    });

    expect(entries.map(({ title }) => title)).toEqual([
      "Other Link Updated",
      "Download Link Updated",
      "Download Link Added",
    ]);
    expect(entries[2].bodyHtml).toBe(
      '<ul class="history-changes"><li><strong>URL</strong>: '
        + '<a href="https://a.test/old" target="_blank" rel="noopener noreferrer">https://a.test/old</a></li>'
        + "<li><strong>Kind</strong>: Download</li></ul>",
    );
    expect(entries[1].bodyHtml).toContain(
      '<a href="https://a.test/old" target="_blank" rel="noopener noreferrer">https://a.test/old</a>'
        + ' \u2192 <a href="https://b.test/new" target="_blank" rel="noopener noreferrer">https://b.test/new</a>',
    );
    // A kind-only change still names the link it is about.
    expect(entries[0].bodyHtml).toBe(
      '<ul class="history-changes"><li><strong>URL</strong>: '
        + '<a href="https://youtube.com/@x" target="_blank" rel="noopener noreferrer">https://youtube.com/@x</a></li>'
        + "<li><strong>Kind</strong>: \u2014 \u2192 Other link</li></ul>",
    );
  });

  it("includes section-count runs for this game and its bundle members only", () => {
    const sectionRevision = (
      id: number,
      item: number,
      timestamp: string,
      data: Record<string, unknown>,
    ) => ({
      id,
      item: String(item),
      collection: "game_sections",
      data,
      delta: {},
      activity: { action: "create", timestamp },
    });
    const allSectionRevisions = [
      sectionRevision(1, 101, "2026-01-01T00:00:00Z", { games_id: 7, completed: false }),
      sectionRevision(2, 102, "2026-01-01T00:00:00Z", { games_id: 7, completed: false }),
      sectionRevision(3, 103, "2026-02-01T00:00:00Z", { games_id: 7, completed: false }),
      sectionRevision(4, 201, "2026-01-01T00:00:00Z", { bundle_member_id: 41, completed: false }),
      sectionRevision(5, 202, "2026-02-02T00:00:00Z", { bundle_member_id: 41, completed: false }),
      sectionRevision(6, 301, "2026-01-01T00:00:00Z", { games_id: 8, completed: false }),
      sectionRevision(7, 302, "2026-02-03T00:00:00Z", { games_id: 8, completed: false }),
    ];
    const entries = buildGameHistory({
      ...emptyHistoryInputs(),
      gameId: 7,
      reviews: [],
      tierEntries: [],
      links: [],
      bundleMembers: [{
        id: 41,
        title: "Included Story",
        sectionNoun: "Episode",
      }],
      sections: [
        { id: 101, number: 1, title: "Chapter 1", completed: false },
        { id: 102, number: 2, title: "Chapter 2", completed: false },
        { id: 103, number: 3, title: "Chapter 3", completed: false },
      ],
      sectionMeta: { style: "linear", noun: "Chapter" },
      allSectionRevisions,
    });
    expect(entries.filter((entry) => entry.bodyHtml)).toEqual([
      {
        date: new Date("2026-02-02T00:00:00Z"),
        title: "Included Game Updated - Included Story",
        bodyHtml: '<ul class="history-changes"><li><strong>Episodes</strong>: 1 \u2192 2</li></ul>',
      },
      {
        date: new Date("2026-02-01T00:00:00Z"),
        title: "Game Updated",
        bodyHtml: '<ul class="history-changes"><li><strong>Chapters</strong>: 2 \u2192 3</li></ul>',
      },
    ]);
  });

  it("does not add section entries when collection revisions are absent", () => {
    const entries = buildGameHistory({
      ...emptyHistoryInputs(),
      gameId: 7,
      reviews: [],
      tierEntries: [],
      links: [],
      bundleMembers: [],
      sections: [{ id: 1, number: 1, title: "Chapter 1", completed: false }],
      sectionMeta: { style: "linear", noun: "Chapter" },
    });
    expect(entries).toEqual([]);
  });

  it("uses empty live sections and default metadata when section details are omitted", () => {
    const entries = buildGameHistory({
      ...emptyHistoryInputs(),
      gameId: 7,
      reviews: [],
      tierEntries: [],
      links: [],
      bundleMembers: [],
      allSectionRevisions: [
        {
          id: 1,
          item: "101",
          collection: "game_sections",
          data: { games_id: 7, completed: false },
          delta: {},
          activity: { action: "create", timestamp: "2026-01-01T00:00:00Z" },
        },
        {
          id: 2,
          item: "102",
          collection: "game_sections",
          data: { games_id: 7, completed: false },
          delta: {},
          activity: { action: "create", timestamp: "2026-02-01T00:00:00Z" },
        },
      ],
    });
    expect(entries).toEqual([{
      date: new Date("2026-02-01T00:00:00Z"),
      title: "Game Updated",
      bodyHtml: '<ul class="history-changes"><li><strong>Chapters</strong>: 1 \u2192 2</li></ul>',
    }]);
  });
});

describe("link history identity", () => {
  it("names the link on a label-only or kind-only update when earlier revisions exist", () => {
    const rev = (id: number, activityId: number, action: string, data: Record<string, unknown>, delta: Record<string, unknown>) => ({
      id, item: "40", collection: "games_links", data, delta,
      activity: { id: activityId, action, timestamp: `2026-07-0${activityId}T00:00:00Z` },
    });
    const entries = buildGameHistory({
      ...emptyHistoryInputs(),
      gameId: 7,
      reviews: [],
      tierEntries: [],
      links: [{ id: 40, kind: "other", url: "https://bsky.app/profile/x" }],
      bundleMembers: [],
      allLinkActivities: [
        { id: 1, item: "40", action: "create", collection: "games_links", timestamp: "2026-07-01T00:00:00Z" },
        { id: 2, item: "40", action: "update", collection: "games_links", timestamp: "2026-07-02T00:00:00Z" },
        { id: 3, item: "40", action: "update", collection: "games_links", timestamp: "2026-07-03T00:00:00Z" },
      ],
      allLinkRevisions: [
        rev(1, 1, "create", { url: "https://bsky.app/profile/x", kind: "download", label: null }, {}),
        rev(2, 2, "update", { url: "https://bsky.app/profile/x", kind: "other", label: null }, { kind: "other" }),
        rev(3, 3, "update", { url: "https://bsky.app/profile/x", kind: "other", label: "Bluesky" }, { label: "Bluesky" }),
      ],
    });
    const link = '<li><strong>URL</strong>: <a href="https://bsky.app/profile/x" target="_blank" rel="noopener noreferrer">https://bsky.app/profile/x</a></li>';
    expect(entries.map(({ title }) => title)).toEqual(["Other Link Updated", "Other Link Updated", "Other Link Added"]);
    expect(entries[0].bodyHtml).toBe(`<ul class="history-changes">${link}<li><strong>Label</strong>: \u2014 \u2192 Bluesky</li></ul>`);
    expect(entries[1].bodyHtml).toBe(`<ul class="history-changes">${link}<li><strong>Kind</strong>: Download \u2192 Other link</li></ul>`);
  });
});

describe("link history with sparse revision data", () => {
  const act = (id: number, item: string, action: string, day: number) => ({
    id, item, action, collection: "games_links", timestamp: `2026-07-${String(day).padStart(2, "0")}T00:00:00Z`,
  });
  const rev = (
    id: number, item: string, activityId: number, action: string, day: number,
    data: Record<string, unknown> | null, delta: Record<string, unknown> | null,
  ) => ({ id, item, collection: "games_links", data, delta, activity: { id: activityId, action, timestamp: act(activityId, item, action, day).timestamp } });

  const entries = buildGameHistory({
    ...emptyHistoryInputs(),
    gameId: 7,
    reviews: [],
    tierEntries: [],
    links: [
      { id: 50 },
      { id: 51, kind: "mystery", url: "https://m.test/x" },
      { id: 52, kind: "other", url: "https://n.test" },
    ],
    bundleMembers: [],
    allLinkActivities: [
      act(1, "51", "create", 1), act(2, "51", "update", 2), act(3, "51", "update", 3), act(4, "51", "update", 4),
      act(6, "52", "create", 6), act(7, "52", "update", 7),
      act(8, "50", "update", 8), act(9, "50", "update", 9),
      act(10, "99", "create", 10), // link since deleted
    ],
    allLinkRevisions: [
      rev(1, "51", 1, "create", 1, null, { url: "https://m.test/x", kind: "mystery" }),
      rev(2, "51", 2, "update", 2, null, null),
      rev(3, "51", 3, "update", 3, null, { url: "https://m.test/y" }),
      rev(4, "51", 4, "update", 4, null, { kind: "download" }),
      rev(6, "52", 6, "create", 6, { url: "https://n.test", kind: "other", label: "Old" }, {}),
      rev(7, "52", 7, "update", 7, { url: "https://n.test", kind: "other", label: null }, { label: null }),
      rev(9, "50", 9, "update", 9, null, { kind: "other" }),
    ],
  });
  const body = (day: number) =>
    entries.find(({ date }) => date.getUTCDate() === day)?.bodyHtml ?? "(missing)";
  const link = (url: string) => `<strong>URL</strong>: <a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;

  it("falls back to the revision delta, shows unknown kinds raw, and skips empty updates", () => {
    expect(body(1)).toBe(`<ul class="history-changes"><li>${link("https://m.test/x")}</li><li><strong>Kind</strong>: mystery</li></ul>`);
    expect(body(2)).toBe("(missing)");
  });

  it("shows a URL change with no earlier value, and falls back to the link's current URL", () => {
    expect(body(3)).toBe(`<ul class="history-changes"><li><strong>URL</strong>: \u2014 \u2192 <a href="https://m.test/y" target="_blank" rel="noopener noreferrer">https://m.test/y</a></li></ul>`);
    expect(body(4)).toBe(`<ul class="history-changes"><li>${link("https://m.test/x")}</li><li><strong>Kind</strong>: \u2014 \u2192 Download</li></ul>`);
  });

  it("shows a cleared label, and handles links with no URL or kind", () => {
    expect(body(7)).toBe(`<ul class="history-changes"><li>${link("https://n.test")}</li><li><strong>Label</strong>: Old \u2192 \u2014</li></ul>`);
    expect(body(8)).toBe("");
    expect(body(9)).toBe('<ul class="history-changes"><li><strong>Kind</strong>: \u2014 \u2192 Other link</li></ul>');
    expect(entries.find(({ date }) => date.getUTCDate() === 8)?.title).toBe("Download Link Updated");
    expect(body(10)).toBe("(missing)");
  });
});

describe("game creation history", () => {
  it("renders an empty Game Added body when the creation revision carries no data", () => {
    const entries = buildGameHistory({
      ...emptyHistoryInputs(),
      gameId: 7,
      reviews: [],
      tierEntries: [],
      links: [],
      bundleMembers: [],
      allGameRevisions: [{
        id: 1, item: "7", collection: "games", data: null, delta: null,
        activity: { id: 1, action: "create", timestamp: "2026-07-01T00:00:00Z" },
      }],
    });
    expect(entries.map(({ title, bodyHtml }) => ({ title, bodyHtml }))).toEqual([{ title: "Game Added", bodyHtml: "" }]);
  });
});

describe("review history", () => {
  it("shows old and new values on a review update", () => {
    const rev = (id: number, rating: number, action: string, day: number) => ({
      id, item: "11", collection: "reviews", data: { title: "R", status: "published", rating }, delta: { rating },
      activity: { id, action, timestamp: `2026-07-0${day}T00:00:00Z` },
    });
    const entries = buildGameHistory({
      ...emptyHistoryInputs(),
      gameId: 7,
      reviews: [{ id: 11 }],
      tierEntries: [],
      links: [],
      bundleMembers: [],
      allReviewRevisions: [rev(2, 4, "update", 2), rev(1, 3, "update", 1)],
    });
    expect(entries.map(({ bodyHtml }) => bodyHtml)).toEqual([
      '<ul class="history-changes"><li><strong>Rating</strong>: 3 \u2192 4</li></ul>',
      '<ul class="history-changes"><li><strong>Rating</strong>: 3</li></ul>',
    ]);
  });
});

describe("genre history", () => {
  const revision = (timestamp: string, action: string, data: Record<string, unknown>) => ({
    id: 1, item: "7", collection: "games", data, delta: data, activity: { id: 1, action, timestamp },
  });
  const genreActivity = (id: number, item: string, timestamp: string) => ({
    id, item, action: "create", collection: "games_genres", timestamp,
  });
  const base = {
    ...emptyHistoryInputs(),
    gameId: 7,
    reviews: [],
    tierEntries: [],
    links: [],
    bundleMembers: [],
    genreSlugs: { Adventure: "adventure", AVN: "avn" },
    allGameRevisions: [revision("2026-10-10T23:03:02.487Z", "create", { title: "G" })],
  };

  it("keeps genres added with the game in Game Added and lists later ones as Genre Added", () => {
    const entries = buildGameHistory({
      ...base,
      genreLinks: [{ id: 1, name: "Adventure" }, { id: 2, name: "AVN" }],
      allGenreActivities: [
        genreActivity(10, "1", "2026-10-10T23:03:02.614Z"),
        genreActivity(11, "2", "2026-10-15T13:13:41.517Z"),
        genreActivity(12, "99", "2026-10-15T13:13:41.517Z"), // another game's genre
      ],
    });
    expect(entries.map(({ title }) => title)).toEqual(["Genre Added", "Game Added"]);
    expect(entries[0].bodyHtml).toBe(
      '<ul class="history-changes"><li><strong>Genre</strong>: <a href="/genres/avn/index.html">AVN</a></li></ul>',
    );
    expect(entries[1].bodyHtml).toContain('<a href="/genres/adventure/index.html">Adventure</a>');
    expect(entries[1].bodyHtml).not.toContain("AVN");
  });

  it("keeps a genre with no recorded activity in Game Added", () => {
    const withLink = buildGameHistory({ ...base, genreLinks: [{ id: 1, name: "Adventure" }] });
    expect(withLink.map(({ title }) => title)).toEqual(["Game Added"]);
    expect(withLink[0].bodyHtml).toContain("Adventure");
  });
});

describe("deltaLinesToHtml", () => {
  it("links play status, release status, section style, and year values", () => {
    const enumChoices = {
      player_status: [
        { value: "in_progress", label: "In Progress" },
        { value: "waiting_for_update", label: "Waiting for Update" },
      ],
      game_status: [{ value: "abandoned", label: "Abandoned" }],
      section_style: [{ value: "nonlinear", label: "Nonlinear" }],
    };
    expect(deltaLinesToHtml("**Play Status**: In Progress \u2192 Waiting for Update", {}, enumChoices)).toBe(
      '<ul class="history-changes"><li><strong>Play Status</strong>: '
        + '<a href="/played_statuses/in_progress/index.html">In Progress</a> \u2192 '
        + '<a href="/played_statuses/waiting_for_update/index.html">Waiting for Update</a></li></ul>',
    );
    expect(deltaLinesToHtml("**Release Status**: Abandoned", {}, enumChoices)).toContain(
      '<a href="/game_statuses/abandoned/index.html">Abandoned</a>',
    );
    expect(deltaLinesToHtml("**Section Style**: Nonlinear", {}, enumChoices)).toContain(
      '<a href="/filters/section-style/nonlinear/index.html">Nonlinear</a>',
    );
    expect(deltaLinesToHtml("**Year**: 2024")).toContain('<a href="/releases/2024/index.html">2024</a>');
  });

  it("uses Directus choice labels and values for newly configured enum options", () => {
    const html = deltaLinesToHtml("**Play Status**: Playing Now", {}, {
      player_status: [{ value: "playing_now", label: "Playing Now" }],
    });

    expect(html).toContain('<a href="/played_statuses/playing_now/index.html">Playing Now</a>');
  });

  it("links genres by name and leaves unknown genres as text", () => {
    expect(
      deltaLinesToHtml("**Genres**: Adventure, Mystery & Co", { Adventure: "adventure" }),
    ).toBe(
      '<ul class="history-changes"><li><strong>Genres</strong>: '
        + '<a href="/genres/adventure/index.html">Adventure</a>, Mystery &amp; Co</li></ul>',
    );
  });

  it("labels and links URL fields, escaping anything that is not a plain http(s) URL", () => {
    expect(
      deltaLinesToHtml(
        "**Walkthrough URL**: https://a.test/x?y=1&z=2 \u2192 javascript:alert(1)\"",
      ),
    ).toBe(
      '<ul class="history-changes"><li><strong>Walkthrough URL</strong>: '
        + '<a href="https://a.test/x?y=1&amp;z=2" target="_blank" rel="noopener noreferrer">'
        + 'https://a.test/x?y=1&amp;z=2</a> \u2192 javascript:alert(1)&quot;</li></ul>',
    );
  });

  it("leaves unlinked labels and unrecognised values as escaped text", () => {
    expect(deltaLinesToHtml("**Title**: A <b> \u2192 B")).toBe(
      '<ul class="history-changes"><li><strong>Title</strong>: A &lt;b&gt; \u2192 B</li></ul>',
    );
    expect(deltaLinesToHtml("**Play Status**: \u2014 \u2192 Completed", {}, {
      player_status: [{ value: "completed", label: "Completed" }],
    })).toContain(
      '\u2014 \u2192 <a href="/played_statuses/completed/index.html">Completed</a>',
    );
  });
});
