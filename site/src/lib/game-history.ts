import {
  fmtDelta,
  fmtNewGame,
  type Activity,
  type Revision,
} from "./changelog";
import type { GameSection } from "./game-sections";

export type HistoryEntry = {
  date: Date;
  title: string;
  bodyHtml: string;
};

type Review = {
  id: number;
  title?: string;
  status?: string;
  rating?: number;
  published_at?: string;
};

type TierEntry = {
  id: number;
  rating?: string;
  tier_list_id?: { id?: number; title?: string } | null;
};

type GameLink = {
  id: number;
  url?: string;
  kind?: string;
};

type BundleMember = {
  id: number;
  title?: string;
  sections?: GameSection[] | null;
};

function deltaLinesToHtml(markdown: string): string {
  if (!markdown.trim()) return "";
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const items = markdown
    .split("\n")
    .map((line) => `<li>${escape(line).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</li>`);
  return `<ul class="history-changes">${items.join("")}</ul>`;
}

function requireHistoryDate(value: string | undefined, context: string): Date {
  const date = value ? new Date(value) : new Date(Number.NaN);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Missing required history timestamp: ${context}`);
  }
  return date;
}

// Filter an already-fetched, collection-wide revisions/activity array down
// to just the given item ids, in memory. buildGameHistory used to issue a
// filtered Directus request per game for each of these; callers now fetch
// each collection once (e.g. games/[slug].astro's getStaticPaths, for all
// ~2000 games at once) and reuse the same arrays across every game.
function scopedRevisions(all: Revision[], itemIds: (number | string)[]): Revision[] {
  if (!itemIds.length) return [];
  const idSet = new Set(itemIds.map(String));
  return all.filter((revision) => idSet.has(String(revision.item)));
}

function scopedActivity(all: Activity[], itemIds: (number | string)[]): Activity[] {
  if (!itemIds.length) return [];
  const idSet = new Set(itemIds.map(String));
  return all.filter((activity) => idSet.has(String(activity.item)));
}

function groupRevisionsByItem(revisions: Revision[]): Map<string, Revision[]> {
  const groups = new Map<string, Revision[]>();
  for (const revision of revisions) {
    const group = groups.get(String(revision.item)) ?? [];
    group.push(revision);
    groups.set(String(revision.item), group);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => b.id - a.id);
  }
  return groups;
}

function recordTitle(value: unknown): string {
  return typeof value === "string" && value.trim() ? value : "Untitled";
}

export function buildGameHistory(params: {
  gameId: number;
  reviews: Review[];
  tierEntries: TierEntry[];
  links: GameLink[];
  bundleMembers: BundleMember[];
  sections?: GameSection[] | null;
  genres: string[];
  // Collection-wide revisions/activity, fetched once by the caller and
  // reused across every game (see scopedRevisions/scopedActivity above).
  allGameRevisions: Revision[];
  allReviewRevisions: Revision[];
  allTierCreateActivities: Activity[];
  allTierRevisions: Revision[];
  allLinkActivities: Activity[];
  allBundleMemberRevisions: Revision[];
}): HistoryEntry[] {
  const reviewIds = params.reviews.map((review) => review.id);
  const tierEntryIds = params.tierEntries.map((entry) => entry.id);
  const linkIds = params.links.map((link) => link.id);
  const bundleMemberIds = params.bundleMembers.map((member) => member.id);

  const gameRevisions = scopedRevisions(params.allGameRevisions, [params.gameId]);
  const reviewRevisions = scopedRevisions(params.allReviewRevisions, reviewIds);
  const tierCreateActivities = scopedActivity(params.allTierCreateActivities, tierEntryIds);
  const tierRevisions = scopedRevisions(params.allTierRevisions, tierEntryIds);
  const linkActivities = scopedActivity(params.allLinkActivities, linkIds);
  const bundleMemberRevisions = scopedRevisions(params.allBundleMemberRevisions, bundleMemberIds);
  const genres = params.genres;

  const entries: HistoryEntry[] = [];

  for (const [index, revision] of gameRevisions.entries()) {
    const prevData = gameRevisions[index + 1]?.data ?? null;
    const date = requireHistoryDate(
      revision.activity?.timestamp,
      `game revision ${revision.id}`,
    );
    const isCreate = revision.activity?.action === "create"
      || (index === gameRevisions.length - 1 && prevData === null);

    if (isCreate) {
      entries.push({
        date,
        title: "Game Added",
        bodyHtml: deltaLinesToHtml(fmtNewGame(revision.data ?? {}, genres)),
      });
      continue;
    }

    const description = fmtDelta(revision.delta ?? {}, prevData, revision.data ?? null, params.sections);
    if (!description.trim()) continue;
    entries.push({
      date,
      title: "Game Updated",
      bodyHtml: deltaLinesToHtml(description),
    });
  }

  const reviewGroups = groupRevisionsByItem(reviewRevisions);
  for (const revisions of reviewGroups.values()) {
    for (const revision of revisions) {
      const data = revision.data ?? {};
      const date = requireHistoryDate(
        revision.activity?.timestamp,
        `review revision ${revision.id}`,
      );
      const title = recordTitle(data.title);
      if (
        revision.activity?.action === "create"
        || revision.delta?.status === "published"
      ) {
        entries.push({
          date,
          title: `Review Published — ${title}`,
          bodyHtml: "",
        });
        continue;
      }

      const description = fmtDelta(revision.delta ?? {}, null);
      if (!description.trim()) continue;
      entries.push({
        date,
        title: `Review Updated — ${title}`,
        bodyHtml: deltaLinesToHtml(description),
      });
    }
  }

  const bundleMemberMap = new Map(
    params.bundleMembers.map((member) => [member.id, member]),
  );
  const memberRevisionGroups = groupRevisionsByItem(bundleMemberRevisions);
  for (const [itemId, revisions] of memberRevisionGroups) {
    const currentMember = bundleMemberMap.get(Number(itemId));
    for (const [index, revision] of revisions.entries()) {
      const data = revision.data ?? {};
      const title = recordTitle(currentMember?.title ?? data.title);
      const date = requireHistoryDate(
        revision.activity?.timestamp,
        `bundle member revision ${revision.id}`,
      );
      const isCreate = revision.activity?.action === "create"
        || (index === revisions.length - 1 && !revisions[index + 1]);
      if (isCreate) {
        entries.push({
          date,
          title: `Included Game Added - ${title}`,
          bodyHtml: "",
        });
        continue;
      }

      const previousData = revisions[index + 1]?.data ?? null;
      const description = fmtDelta(revision.delta ?? {}, previousData, data, currentMember?.sections);
      if (!description.trim()) continue;
      entries.push({
        date,
        title: `Included Game Updated - ${title}`,
        bodyHtml: deltaLinesToHtml(description),
      });
    }
  }

  const tierEntryMap = new Map(
    params.tierEntries.map((entry) => [entry.id, entry]),
  );
  for (const activity of tierCreateActivities) {
    const tierEntry = tierEntryMap.get(Number(activity.item));
    if (!tierEntry) continue;
    const tierListTitle = tierEntry.tier_list_id?.title ?? "Untitled";
    const rating = tierEntry.rating ?? "";
    entries.push({
      date: requireHistoryDate(
        activity.timestamp,
        `tier list game activity ${activity.id}`,
      ),
      title: `Added to Tier List — ${tierListTitle} (${rating})`,
      bodyHtml: "",
    });
  }

  const tierRevisionGroups = groupRevisionsByItem(tierRevisions);
  for (const [itemId, revisions] of tierRevisionGroups) {
    const tierEntry = tierEntryMap.get(Number(itemId));
    if (!tierEntry) continue;
    for (const [index, revision] of revisions.entries()) {
      if (!Object.prototype.hasOwnProperty.call(revision.delta ?? {}, "rating")) {
        continue;
      }
      const previousRating = revisions[index + 1]?.data?.rating;
      const newRating = revision.delta?.rating;
      if (
        previousRating === null
        || previousRating === undefined
        || previousRating === newRating
      ) {
        continue;
      }
      const tierListTitle = tierEntry.tier_list_id?.title ?? "Untitled";
      entries.push({
        date: requireHistoryDate(
          revision.activity?.timestamp,
          `tier list game revision ${revision.id}`,
        ),
        title: `Tier Changed — ${tierListTitle} (${String(previousRating)} → ${String(newRating)})`,
        bodyHtml: "",
      });
    }
  }

  const linkMap = new Map(params.links.map((link) => [link.id, link]));
  for (const activity of linkActivities) {
    const link = linkMap.get(Number(activity.item));
    if (!link) continue;
    const isWalkthrough = link.kind === "walkthrough" || link.kind === "text-note";
    const kindLabel = isWalkthrough ? "Walkthrough" : "Download";
    entries.push({
      date: requireHistoryDate(
        activity.timestamp,
        `games link activity ${activity.id}`,
      ),
      title: `${kindLabel} ${activity.action === "update" ? "Updated" : "Added"}`,
      bodyHtml: "",
    });
  }

  entries.sort((a, b) => b.date.getTime() - a.date.getTime());
  return entries;
}
