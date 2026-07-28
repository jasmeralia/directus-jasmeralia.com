import { directusFetchRaw } from "./directus";
import {
  fetchGameGenres,
  fmtDelta,
  fmtNewGame,
  type Activity,
  type Revision,
} from "./changelog";

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

async function fetchScopedRevisions(
  collection: string,
  itemIds: number[],
  filterOperator: "_eq" | "_in",
): Promise<Revision[]> {
  if (!itemIds.length) return [];
  const qs = new URLSearchParams({
    "filter[collection][_eq]": collection,
    [`filter[item][${filterOperator}]`]: filterOperator === "_eq"
      ? String(itemIds[0])
      : itemIds.join(","),
    "sort": "-id",
    "limit": "-1",
    "fields": "id,item,collection,delta,data,activity.action,activity.timestamp",
  });
  const res = await directusFetchRaw<{ data: Revision[] }>(`/revisions?${qs.toString()}`);
  return res.data ?? [];
}

async function fetchScopedActivity(
  collection: string,
  itemIds: number[],
  actions: string[],
): Promise<Activity[]> {
  if (!itemIds.length) return [];
  const qs = new URLSearchParams({
    "filter[collection][_eq]": collection,
    "filter[item][_in]": itemIds.join(","),
    "filter[action][_in]": actions.join(","),
    "sort": "-timestamp",
    "limit": "-1",
    "fields": "id,action,collection,item,timestamp",
  });
  const res = await directusFetchRaw<{ data: Activity[] }>(`/activity?${qs.toString()}`);
  return res.data ?? [];
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

export async function buildGameHistory(params: {
  gameId: number;
  reviews: Review[];
  tierEntries: TierEntry[];
  links: GameLink[];
}): Promise<HistoryEntry[]> {
  const reviewIds = params.reviews.map((review) => review.id);
  const tierEntryIds = params.tierEntries.map((entry) => entry.id);
  const linkIds = params.links.map((link) => link.id);

  const [
    gameRevisions,
    reviewRevisions,
    tierCreateActivities,
    tierRevisions,
    linkActivities,
    genres,
  ] = await Promise.all([
    fetchScopedRevisions("games", [params.gameId], "_eq"),
    fetchScopedRevisions("reviews", reviewIds, "_in"),
    fetchScopedActivity("tier_list_games", tierEntryIds, ["create"]),
    fetchScopedRevisions("tier_list_games", tierEntryIds, "_in"),
    fetchScopedActivity("games_links", linkIds, ["create", "update"]),
    fetchGameGenres(params.gameId),
  ]);

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

    const description = fmtDelta(revision.delta ?? {}, prevData);
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
