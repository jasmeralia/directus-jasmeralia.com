import type { Revision } from "./changelog";
import { fmtSectionCountDelta, type SectionCountState } from "./changelog";
import type { GameEvent } from "./game-events";
import { sectionNoun, type GameSection } from "./game-sections";

// Section count/completion tracking
//
// game_sections rows have no field on the parent games/game_bundle_members
// record tracking their own count or how many are completed, so unlike every
// other entry type above, this can't be read off a single revision's delta.
// Instead: group the game_sections collection's own revisions into per-parent
// "runs" (mirroring the tier_list_games minute-bucketing above, so one bulk
// import or sync doesn't become one entry per row), then reconstruct a full
// point-in-time snapshot of every row's existence/completed state just
// before and just after each run.
//
// A point-in-time model (rather than "roll touched rows back/forward, use
// today's live rows for everything else") is required here specifically
// because a game can rack up several *separate* update sessions over time
// (e.g. a mission count bumped last month, then bumped again this week --
// exactly the "before/after" tracking this feature exists for). Using today's
// live state for any row not touched by a given run would leak a *later* run's
// changes into an *older* run's reported totals whenever that other row was
// touched in between -- e.g. the older run would appear to jump straight to
// today's count instead of the count as of its own end.

export type SectionParent = { kind: "game" | "bundle_member"; id: number };

export type SectionRun = {
  key: string;
  parent: SectionParent;
  timestamp: string; // latest revision's activity timestamp in the run
  revisions: Revision[];
};

export type RowTimeline = { parent: SectionParent; revisions: Revision[] }; // revisions sorted oldest -> newest by id
export type TimelinesByParent = Map<string, Map<number, RowTimeline>>;

export type SectionIndex = { runs: SectionRun[]; timelinesByParent: TimelinesByParent };

const sectionIndexCache = new WeakMap<Revision[], SectionIndex>();

// Group a collection-wide game_sections revision list into runs and per-parent
// timelines. Callers such as games/[slug].astro hand the same array to every
// game's history, so the result is cached per array instance instead of being
// rebuilt once per game.
export function indexSectionRevisions(revisions: Revision[]): SectionIndex {
  const cached = sectionIndexCache.get(revisions);
  if (cached) return cached;
  const rowParents = resolveRowParents(revisions);
  const index = {
    runs: groupSectionRuns(revisions, rowParents),
    timelinesByParent: buildRowTimelinesByParent(revisions, rowParents),
  };
  sectionIndexCache.set(revisions, index);
  return index;
}

export const relationId = (value: unknown): number | null => {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value) return Number(value);
  if (typeof value === "object" && value !== null && "id" in value) {
    return Number((value as { id: unknown }).id);
  }
  return null;
};

function sectionRevisionParent(rev: Revision): SectionParent | null {
  const data = (rev.data ?? {}) as Record<string, unknown>;
  const bundleMemberId = relationId(data.bundle_member_id);
  if (bundleMemberId) return { kind: "bundle_member", id: bundleMemberId };
  const gamesId = relationId(data.games_id);
  if (gamesId) return { kind: "game", id: gamesId };
  return null;
}

// Resolve each row's parent once, from whichever of its revisions happens to
// carry the games_id/bundle_member_id FK (a delete revision's data may lack
// it) -- so every revision for that row, including a delete with no FK, can
// still be attributed to the right run/timeline.
export function resolveRowParents(revisions: Revision[]): Map<number, SectionParent> {
  const rowParents = new Map<number, SectionParent>();
  for (const rev of revisions) {
    const rowId = Number(rev.item);
    if (!rowId || rowParents.has(rowId)) continue;
    const parent = sectionRevisionParent(rev);
    if (parent) rowParents.set(rowId, parent);
  }
  return rowParents;
}

// A colon-free bucket key: guid event segments can't contain colons (see
// GUID_RE), and ISO timestamps do.
const runBucket = (timestamp: string): string => timestamp.slice(0, 16).replace(/[-:]/g, "");

export function groupSectionRuns(
  revisions: Revision[],
  rowParents: Map<number, SectionParent>,
): SectionRun[] {
  const runs = new Map<string, SectionRun>();
  for (const rev of revisions) {
    const ts = rev.activity?.timestamp;
    if (!ts) continue;
    const parent = rowParents.get(Number(rev.item));
    if (!parent) continue;
    const key = `${parent.kind}_${parent.id}_${runBucket(ts)}`;
    let run = runs.get(key);
    if (!run) {
      run = { key, parent, timestamp: ts, revisions: [] };
      runs.set(key, run);
    }
    run.revisions.push(rev);
    if (ts > run.timestamp) run.timestamp = ts;
  }
  return Array.from(runs.values());
}

const parentKey = (parent: SectionParent): string => `${parent.kind}_${parent.id}`;

export function buildRowTimelinesByParent(
  revisions: Revision[],
  rowParents: Map<number, SectionParent>,
): TimelinesByParent {
  const byParent: TimelinesByParent = new Map();
  for (const rev of revisions) {
    const rowId = Number(rev.item);
    const parent = rowId ? rowParents.get(rowId) : undefined;
    if (!parent) continue;
    const rows = byParent.get(parentKey(parent)) ?? new Map<number, RowTimeline>();
    const timeline = rows.get(rowId) ?? { parent, revisions: [] as Revision[] };
    timeline.revisions.push(rev);
    rows.set(rowId, timeline);
    byParent.set(parentKey(parent), rows);
  }
  for (const rows of byParent.values()) {
    for (const timeline of rows.values()) timeline.revisions.sort((a, b) => a.id - b.id);
  }
  return byParent;
}

// A row's existence/completed state as of (i.e. immediately after) the
// latest revision with id <= asOfRevisionId. exists=false means either the
// row had no revision at or before this point (didn't exist yet) or its
// latest qualifying revision was a delete.
function rowStateAsOf(
  timeline: RowTimeline,
  asOfRevisionId: number,
): { exists: boolean; completed: boolean } {
  let exists = false;
  let completed = false;
  for (const rev of timeline.revisions) {
    if (rev.id > asOfRevisionId) break;
    if (rev.activity?.action === "delete" || !rev.data) {
      exists = false;
    } else {
      exists = true;
      completed = Boolean(rev.data.completed);
    }
  }
  return { exists, completed };
}

// Reconstruct a parent's total/completed section counts as of a given
// revision id. Rows with no revision history at all (e.g. predating
// revision tracking) fall back to today's live value, treated as constant
// across all points in time -- a reasonable best effort since there is no
// way to know their historical state.
export function sectionCountsAt(
  parent: SectionParent,
  asOfRevisionId: number,
  timelinesByParent: TimelinesByParent,
  liveRows: GameSection[],
): SectionCountState {
  const rows = timelinesByParent.get(parentKey(parent));
  const trackedIds = new Set<number>();
  let total = 0;
  let completed = 0;
  if (rows) {
    for (const [rowId, timeline] of rows) {
      trackedIds.add(rowId);
      const state = rowStateAsOf(timeline, asOfRevisionId);
      if (!state.exists) continue;
      total += 1;
      if (state.completed) completed += 1;
    }
  }
  for (const row of liveRows) {
    if (row.id !== undefined && trackedIds.has(row.id)) continue;
    total += 1;
    if (row.completed) completed += 1;
  }
  return { total, completed };
}

export function describeSectionRun(
  run: SectionRun,
  ctx: {
    liveRows: GameSection[];
    timelinesByParent: TimelinesByParent;
    style: string | null;
    noun: string | null | undefined;
  },
): { event: GameEvent; at: string } | null {
  const runIds = run.revisions.map((rev) => rev.id);
  const runStartId = Math.min(...runIds) - 1;
  const runEndId = Math.max(...runIds);
  const before = sectionCountsAt(run.parent, runStartId, ctx.timelinesByParent, ctx.liveRows);
  if (before.total === 0) return null;
  const after = sectionCountsAt(run.parent, runEndId, ctx.timelinesByParent, ctx.liveRows);
  const body = fmtSectionCountDelta(ctx.style, sectionNoun(ctx.noun), before, after);
  if (!body.trim()) return null;
  return {
    event: { type: "sections_changed", title: "Game Updated", body },
    at: run.timestamp,
  };
}
