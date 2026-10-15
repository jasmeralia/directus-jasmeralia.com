import { describe, expect, it } from "vitest";

import { buildGameHistory, deltaLinesToHtml } from "./game-history";

const emptyHistoryInputs = () => ({
  allGameRevisions: [],
  allReviewRevisions: [],
  allTierCreateActivities: [],
  allTierRevisions: [],
  allLinkActivities: [],
  allBundleMemberRevisions: [],
  genres: [],
});

describe("buildGameHistory", () => {
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
      genres: ["Adventure"],
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
          data: { title: "Launch Review" },
          delta: {},
          activity: { action: "create", timestamp: "2026-07-09T12:00:00Z" },
        },
        {
          id: 41,
          item: "11",
          collection: "reviews",
          data: { title: "Launch Review", rating: 4 },
          delta: { rating: 4 },
          activity: { action: "update", timestamp: "2026-07-08T12:00:00Z" },
        },
        {
          id: 40,
          item: "12",
          collection: "reviews",
          data: { title: "" },
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
      "Walkthrough Added",
      "Download Updated",
      "Included Game Added - Current Member",
      "Game Added",
    ]);
    expect(entries.map(({ date }) => date.getTime())).toEqual(
      entries.map(({ date }) => date.getTime()).toSorted((a, b) => b - a),
    );
    expect(entries[0].bodyHtml).toBe(
      '<ul class="history-changes"><li><strong>Title</strong>: Old &lt;Game&gt; → New &amp; &lt;Game&gt;</li></ul>',
    );
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
      bundleMembers: [{ id: 42, title: "Member Two" }],
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

describe("deltaLinesToHtml", () => {
  it("links play status, release status, section style, and year values", () => {
    expect(deltaLinesToHtml("**Play Status**: In Progress \u2192 Waiting for Update")).toBe(
      '<ul class="history-changes"><li><strong>Play Status</strong>: '
        + '<a href="/played_statuses/in_progress/index.html">In Progress</a> \u2192 '
        + '<a href="/played_statuses/waiting_for_update/index.html">Waiting for Update</a></li></ul>',
    );
    expect(deltaLinesToHtml("**Release Status**: Abandoned")).toContain(
      '<a href="/game_statuses/abandoned/index.html">Abandoned</a>',
    );
    expect(deltaLinesToHtml("**Section Style**: Nonlinear")).toContain(
      '<a href="/filters/section-style/nonlinear/index.html">Nonlinear</a>',
    );
    expect(deltaLinesToHtml("**Year**: 2024")).toContain('<a href="/releases/2024/index.html">2024</a>');
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
    expect(deltaLinesToHtml("**Play Status**: \u2014 \u2192 Completed")).toContain(
      '\u2014 \u2192 <a href="/played_statuses/completed/index.html">Completed</a>',
    );
  });
});
