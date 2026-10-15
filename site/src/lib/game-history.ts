import {
  ENUM_LABEL,
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

const PLAYED_STATUSES = [
  "not_started", "in_progress", "on_hold", "waiting_for_update", "did_not_finish", "completed",
];
const GAME_STATUSES = ["unreleased", "in_development", "abandoned", "released", "on_hiatus"];
const SECTION_STYLES = ["linear", "nonlinear"];

// Delta-line labels whose values link to a listing page. Each resolves a
// displayed value (e.g. "Waiting for Update", "2026") to that page's URL.
const enumHref = (prefix: string, values: string[]) => (shown: string) => {
  const value = values.find((v) => ENUM_LABEL[v] === shown);
  return value ? `${prefix}/${value}/index.html` : null;
};
const LINKED_LABELS: Record<string, (shown: string) => string | null> = {
  "Play Status": enumHref("/played_statuses", PLAYED_STATUSES),
  "Release Status": enumHref("/game_statuses", GAME_STATUSES),
  "Section Style": enumHref("/filters/section-style", SECTION_STYLES),
  Year: (shown) => (/^\d{4}$/.test(shown) ? `/releases/${shown}/index.html` : null),
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Delta-line labels whose values are URLs, rendered as clickable links.
const URL_LABELS = new Set(["URL", "Download URL", "Walkthrough URL", "GameStoryLog URL"]);
const isHttpUrl = (value: string) => /^https?:\/\/\S+$/i.test(value);

// Render one "**Label**: value" or "**Label**: old \u2192 new" delta line,
// linking each value when the label has a listing page or holds URLs.
// `genreSlugs` maps genre names to slugs for the "Genres" list.
function deltaLineToHtml(line: string, genreSlugs: Record<string, string>): string {
  const match = /^\*\*(.+?)\*\*: (.*)$/.exec(line);
  if (!match) {
    return escapeHtml(line).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  }
  const [, label, rest] = match;
  const link = (href: string, text: string, external = false) =>
    `<a href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${escapeHtml(text)}</a>`;
  let render: ((shown: string) => string) | null = null;
  let separator = " \u2192 ";
  if (label === "Genres") {
    separator = ", ";
    render = (name) => (genreSlugs[name] ? link(`/genres/${genreSlugs[name]}/index.html`, name) : escapeHtml(name));
  } else if (URL_LABELS.has(label)) {
    render = (shown) => (isHttpUrl(shown) ? link(shown, shown, true) : escapeHtml(shown));
  } else if (LINKED_LABELS[label]) {
    const hrefFor = LINKED_LABELS[label];
    render = (shown) => {
      const href = hrefFor(shown);
      return href ? link(href, shown) : escapeHtml(shown);
    };
  }
  if (!render) {
    return escapeHtml(line).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  }
  return `<strong>${escapeHtml(label)}</strong>: ${rest.split(separator).map(render).join(separator)}`;
}

export function deltaLinesToHtml(
  markdown: string,
  genreSlugs: Record<string, string> = {},
): string {
  if (!markdown.trim()) return "";
  const items = markdown
    .split("\n")
    .map((line) => `<li>${deltaLineToHtml(line, genreSlugs)}</li>`);
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

const LINK_KIND_LABELS: Record<string, string> = {
  download: "Download",
  walkthrough: "Walkthrough",
  "text-note": "Walkthrough note",
  other: "Other link",
  gamestorylog: "GameStoryLog",
};

const LINK_EVENT_TITLES: Record<string, string> = {
  walkthrough: "Walkthrough Link",
  "text-note": "Walkthrough Link",
  other: "Other Link",
  gamestorylog: "GameStoryLog Link",
};

// Describe a games_links revision. A new link lists its URL, kind and label.
// An update always leads with the URL (old -> new if the URL itself changed) so
// the entry names which link it is about, then any changed kind/label. Returns
// "" for an update that changed nothing displayable (e.g. only the sort order).
function fmtLinkDelta(
  delta: Record<string, unknown>,
  prev: Record<string, unknown> | null,
  data: Record<string, unknown> | null,
  isCreate: boolean,
  currentUrl: string | undefined,
): string {
  const show = (field: string, value: unknown) =>
    field === "kind" ? (LINK_KIND_LABELS[String(value)] ?? String(value)) : String(value);
  const dash = "\u2014";
  const lines: string[] = [];
  if (isCreate) {
    const source = data ?? delta;
    for (const [field, label] of [["url", "URL"], ["kind", "Kind"], ["label", "Label"]] as const) {
      const value = source[field];
      if (value !== null && value !== undefined && value !== "") lines.push(`**${label}**: ${show(field, value)}`);
    }
    return lines.join("\n");
  }
  const changes: string[] = [];
  for (const [field, label] of [["kind", "Kind"], ["label", "Label"]] as const) {
    if (!(field in delta) || delta[field] === (prev?.[field] ?? null)) continue;
    const before = prev?.[field] ?? null;
    const next = delta[field];
    changes.push(
      `**${label}**: ${before === null ? dash : show(field, before)} \u2192 ${next === null ? dash : show(field, next)}`,
    );
  }
  const urlChanged = "url" in delta && delta.url !== prev?.url;
  if (!urlChanged && !changes.length) return "";
  const url = (data?.url ?? currentUrl) as string | undefined;
  const urlLine = urlChanged
    ? `**URL**: ${prev?.url ? String(prev.url) : dash} \u2192 ${String(delta.url)}`
    : url
      ? `**URL**: ${url}`
      : "";
  return [urlLine, ...changes].filter(Boolean).join("\n");
}

export function buildGameHistory(params: {
  gameId: number;
  reviews: Review[];
  tierEntries: TierEntry[];
  links: GameLink[];
  bundleMembers: BundleMember[];
  sections?: GameSection[] | null;
  genres: string[];
  // Genre name -> slug, so the new-game entry's genre list can link to genre pages.
  genreSlugs?: Record<string, string>;
  // Collection-wide revisions/activity, fetched once by the caller and
  // reused across every game (see scopedRevisions/scopedActivity above).
  allGameRevisions: Revision[];
  allReviewRevisions: Revision[];
  allTierCreateActivities: Activity[];
  allTierRevisions: Revision[];
  allLinkActivities: Activity[];
  // games_links revisions, so link events can show what was added or changed.
  allLinkRevisions?: Revision[];
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
        bodyHtml: deltaLinesToHtml(fmtNewGame(revision.data ?? {}, genres), params.genreSlugs),
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
  const linkRevisionsByItem = groupRevisionsByItem(
    scopedRevisions(params.allLinkRevisions ?? [], linkIds),
  );
  for (const activity of linkActivities) {
    const link = linkMap.get(Number(activity.item));
    if (!link) continue;
    const kindLabel = LINK_EVENT_TITLES[link.kind ?? ""] ?? "Download Link";
    const isCreate = activity.action !== "update";
    const itemRevisions = linkRevisionsByItem.get(String(activity.item)) ?? [];
    const revisionIndex = itemRevisions.findIndex((rev) => rev.activity?.id === activity.id);
    let body = "";
    if (revisionIndex >= 0) {
      const revision = itemRevisions[revisionIndex];
      body = fmtLinkDelta(
        revision.delta ?? {},
        itemRevisions[revisionIndex + 1]?.data ?? null,
        revision.data ?? null,
        isCreate,
        link.url,
      );
      // Nothing displayable changed (e.g. only the sort order): not an event.
      if (!isCreate && !body) continue;
    } else if (link.url) {
      body = `**URL**: ${link.url}`;
    }
    entries.push({
      date: requireHistoryDate(
        activity.timestamp,
        `games link activity ${activity.id}`,
      ),
      title: `${kindLabel} ${isCreate ? "Added" : "Updated"}`,
      bodyHtml: deltaLinesToHtml(body),
    });
  }


  entries.sort((a, b) => b.date.getTime() - a.date.getTime());
  return entries;
}
