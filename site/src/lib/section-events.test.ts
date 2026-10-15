import { describe, expect, it } from "vitest";

import type { Revision } from "./changelog";
import {
  buildRowTimelinesByParent,
  describeSectionRun,
  groupSectionRuns,
  indexSectionRevisions,
  resolveRowParents,
  sectionCountsAt,
} from "./section-events";

const revision = (
  id: number,
  item: string,
  timestamp: string | undefined,
  data: Record<string, unknown> | null,
  action: string = "create",
): Revision => ({
  id,
  item,
  collection: "game_sections",
  data,
  delta: {},
  activity: timestamp ? { action, timestamp } : null,
});

describe("section event derivation", () => {
  it("resolves parents from game or member relations and keeps each row's first known parent", () => {
    const revisions = [
      revision(1, "10", "2026-01-01T00:00:00Z", { games_id: 7 }),
      revision(2, "10", "2026-01-02T00:00:00Z", { games_id: 8 }),
      revision(3, "11", "2026-01-01T00:00:00Z", { bundle_member_id: { id: 4 } }),
      revision(4, "12", "2026-01-01T00:00:00Z", { games_id: "9" }),
      revision(5, "13", "2026-01-01T00:00:00Z", { games_id: null, bundle_member_id: null }),
      revision(6, "0", "2026-01-01T00:00:00Z", { games_id: 10 }),
      revision(7, "14", "2026-01-01T00:00:00Z", null),
    ];
    expect(Array.from(resolveRowParents(revisions))).toEqual([
      [10, { kind: "game", id: 7 }],
      [11, { kind: "bundle_member", id: 4 }],
      [12, { kind: "game", id: 9 }],
    ]);
  });

  it("groups same-parent revisions by minute and builds oldest-first row timelines", () => {
    const revisions = [
      revision(2, "22", "2026-02-01T10:00:10Z", { games_id: 7, completed: false }),
      revision(3, "22", "2026-02-01T10:00:55Z", { games_id: 7, completed: true }, "update"),
      revision(1, "23", undefined, { games_id: 7 }),
      revision(4, "24", "2026-02-01T10:01:00Z", { games_id: 7 }),
      revision(5, "25", "2026-02-01T10:00:20Z", { bundle_member_id: 5 }),
    ];
    const parents = resolveRowParents(revisions);
    const runs = groupSectionRuns(revisions, parents);
    expect(runs.map(({ key, timestamp, revisions: runRevisions }) => [key, timestamp, runRevisions.length])).toEqual([
      ["game_7_20260201T1000", "2026-02-01T10:00:55Z", 2],
      ["game_7_20260201T1001", "2026-02-01T10:01:00Z", 1],
      ["bundle_member_5_20260201T1000", "2026-02-01T10:00:20Z", 1],
    ]);
    expect(groupSectionRuns(revisions, new Map())).toEqual([]);
    const timelines = buildRowTimelinesByParent(revisions, parents);
    expect(timelines.get("game_7")?.get(22)?.revisions.map((rev) => rev.id)).toEqual([2, 3]);
    expect(timelines.get("game_7")?.get(23)?.revisions.map((rev) => rev.id)).toEqual([1]);
    expect(buildRowTimelinesByParent([revision(6, "0", "2026-01-01T00:00:00Z", {})], parents)).toEqual(new Map());
    expect(buildRowTimelinesByParent([revision(7, "99", "2026-01-01T00:00:00Z", {})], new Map())).toEqual(new Map());
  });

  it("indexes a revision list once per array instance", () => {
    const revisions = [revision(1, "30", "2026-03-01T00:00:00Z", { games_id: 9 })];
    const index = indexSectionRevisions(revisions);
    expect(index.runs.map(({ key }) => key)).toEqual(["game_9_20260301T0000"]);
    expect(index.timelinesByParent.get("game_9")?.get(30)?.revisions).toHaveLength(1);
    expect(indexSectionRevisions(revisions)).toBe(index);
    expect(indexSectionRevisions([...revisions])).not.toBe(index);
  });

  it("reconstructs counts through creates, updates, deletes, and untracked live rows", () => {
    const revisions = [
      revision(1, "1", "2026-01-01T00:00:00Z", { games_id: 7, completed: false }),
      revision(2, "2", "2026-01-01T00:00:00Z", { games_id: 7, completed: true }),
      revision(3, "1", "2026-01-02T00:00:00Z", null, "delete"),
    ];
    const parents = resolveRowParents(revisions);
    const timelines = buildRowTimelinesByParent(revisions, parents);
    const parent = { kind: "game" as const, id: 7 };
    expect(sectionCountsAt(parent, 0, timelines, [{ id: 3, number: 3, title: "Live", completed: true }])).toEqual({ total: 1, completed: 1 });
    expect(sectionCountsAt(parent, 2, timelines, [{ id: 3, number: 3, title: "Live" }])).toEqual({ total: 3, completed: 1 });
    expect(sectionCountsAt(parent, 3, timelines, [{ id: 3, number: 3, title: "Live" }])).toEqual({ total: 2, completed: 1 });
    expect(sectionCountsAt(parent, 3, new Map(), [])).toEqual({ total: 0, completed: 0 });
  });

  it("describes non-initial section changes and skips initial or blank runs", () => {
    const revisions = [
      revision(1, "1", "2026-01-01T00:00:00Z", { games_id: 7, completed: false }),
      revision(2, "2", "2026-01-01T00:00:00Z", { games_id: 7, completed: false }),
      revision(3, "3", "2026-02-01T10:00:00Z", { games_id: 7, completed: false }),
      revision(4, "2", "2026-03-01T10:00:00Z", { games_id: 7, completed: true }, "update"),
    ];
    const parents = resolveRowParents(revisions);
    const runs = groupSectionRuns(revisions, parents);
    const timelines = buildRowTimelinesByParent(revisions, parents);
    const ctx = { liveRows: [], timelinesByParent: timelines, style: "nonlinear", noun: "Quest" };
    expect(describeSectionRun(runs[0], ctx)).toBeNull();
    expect(describeSectionRun(runs[1], ctx)).toEqual({
      event: { type: "sections_changed", title: "Game Updated", body: "**Quests**: 0/2 (0%) \u2192 0/3 (0%)" },
      at: "2026-02-01T10:00:00Z",
    });
    expect(describeSectionRun(runs[2], { ...ctx, style: "linear" })).toBeNull();
  });
});
