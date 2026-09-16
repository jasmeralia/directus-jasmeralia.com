import { siteBaseUrl, type DirectusFile } from "./directus";
import { directGameSections, sectionNoun, type GameSection } from "./game-sections";
import { isGameNsfw, isTierBoardEntryNsfw, isTierListNsfw } from "./nsfw";
import {
  SKIP_DELTA,
  fetchActivity,
  fetchAllGameGenres,
  fetchGameSectionsByBundleMemberIds,
  fetchGameSectionsByGameIds,
  fetchItemMap,
  fetchRevisions,
  fmtDelta,
  fmtNewGame,
  fmtSectionCountDelta,
  previousRevisionDataMap,
  type Activity,
  type Revision,
  type SectionCountState,
} from "./changelog";

type DirectusRecord = Record<string, unknown>;

// ─── config ──────────────────────────────────────────────────────────────────

const siteBase = siteBaseUrl();

// How many recent revisions/activities to pull per collection
const LIMIT_GAMES       = 100;
const LIMIT_REVIEWS     = 50;
const LIMIT_TIER_LISTS  = 50;
const LIMIT_JUNCTIONS   = 300; // tier_list_games activities
const LIMIT_LINKS       = 400; // games_links activities (create + update)
const LIMIT_BUNDLE_MEMBERS = 200;

// Game-related feed entries (direct game revisions, included-game revisions,
// download/walkthrough links, section-count changes) landing within this
// window of the first entry in a burst are merged into one feed item, so a
// flurry of edits to the same game reads as one Discord notification instead
// of several near-simultaneous ones. The window is anchored to the first
// entry in each burst, not a sliding per-gap window.
const GAME_CONSOLIDATION_WINDOW_MS = 30 * 60 * 1000;

const SKIP_FEED_DELTA = new Set([
  ...SKIP_DELTA,
  "version_orion",
  "version_typhoon",
  "version_gsl",
]);

const feedDelta = (delta: Record<string, unknown> | null): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(delta ?? {}).filter(([field]) => !SKIP_FEED_DELTA.has(field)),
  );

// ─── XML helpers ─────────────────────────────────────────────────────────────

const xmlEscape = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
   .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const asDate = (v: unknown): Date | null => {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

const requireDate = (value: unknown, context: string): Date => {
  const date = asDate(value);
  if (!date) throw new Error(`Missing required timestamp for RSS GUID: ${context}`);
  return date;
};

const requireGuidPart = (value: unknown, context: string): string => {
  const part = value === null || value === undefined ? "" : String(value).trim();
  if (!part || part === "undefined") throw new Error(`Missing required RSS GUID value: ${context}`);
  return part;
};

const guidTimestamp = (date: Date, context: string): string => {
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid RSS GUID timestamp: ${context}`);
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
};

const rssGuid = (
  type: "game" | "review" | "tier-list",
  stableKey: unknown,
  event: string,
  date: Date,
  context: string,
): string => {
  const key = requireGuidPart(stableKey, `${context} stable key`);
  const eventKey = requireGuidPart(event, `${context} event`);
  return `${type}:${key}:${eventKey}:${guidTimestamp(date, context)}`;
};

const GUID_RE = /^(game|review|tier-list):[^:]+:[^:]+:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

const validateFeedEntries = (entries: Entry[]): void => {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.guid.includes("undefined")) {
      throw new Error(`Invalid RSS GUID contains undefined: ${entry.guid}`);
    }
    if (!GUID_RE.test(entry.guid)) {
      throw new Error(`Invalid RSS GUID format: ${entry.guid}`);
    }
    if (seen.has(entry.guid)) {
      throw new Error(`Duplicate RSS GUID: ${entry.guid}`);
    }
    seen.add(entry.guid);
    if (entry.guid.startsWith("tier-list:") && entry.imageUrl) {
      throw new Error(`Tier-list RSS item must not have an enclosure: ${entry.guid}`);
    }
  }
};

const imageMimeType = (url: string): string => {
  const l = url.toLowerCase();
  if (l.endsWith(".png"))  return "image/png";
  if (l.endsWith(".webp")) return "image/webp";
  if (l.endsWith(".gif"))  return "image/gif";
  if (l.endsWith(".avif")) return "image/avif";
  return "image/jpeg";
};

const mediaUrl = (file: unknown): string | null => {
  if (!file) return null;
  const id   = typeof file === "string" ? file : (file as DirectusFile)?.id;
  const disk = typeof file === "string" ? null  : ((file as DirectusFile)?.filename_disk ?? null);
  if (!id) return null;
  return `${siteBase}/media/${disk || id}`;
};

const itemXml = (e: {
  title: string; link: string; description: string;
  pubDate: Date; imageUrl?: string; guid: string;
}) => {
  const t = xmlEscape(e.title), l = xmlEscape(e.link);
  const d = xmlEscape(e.description), g = xmlEscape(e.guid);
  const img  = e.imageUrl ? xmlEscape(e.imageUrl) : "";
  const mime = img ? xmlEscape(imageMimeType(e.imageUrl!)) : "";
  return [
    "<item>",
    `<title>${t}</title>`,
    `<link>${l}</link>`,
    `<guid isPermaLink="false">${g}</guid>`,
    `<description>${d}</description>`,
    img ? `<enclosure url="${img}" type="${mime}" />` : "",
    `<pubDate>${e.pubDate.toUTCString()}</pubDate>`,
    "</item>",
  ].join("");
};

function gameGuidEvent(rev: Revision): string {
  if (rev.activity?.action === "create") return "created";
  const changedFields = Object.keys(rev.delta ?? {}).filter(
    (field) => !SKIP_FEED_DELTA.has(field),
  );
  if (changedFields.length === 1 && changedFields[0] === "player_status") return "play_status";
  if (changedFields.length === 1 && changedFields[0] === "game_status") return "release_status";
  return "updated";
}

const fetchCreateActivity = (collection: string, limit: number) =>
  fetchActivity(collection, "create", limit);

// ─── entry types ─────────────────────────────────────────────────────────────

export type FeedEntry = {
  title: string;
  link: string;
  description: string;
  pubDate: Date;
  imageUrl?: string;
  guid: string;
  nsfw: boolean;
  completed: boolean;
};

type Entry = FeedEntry;

// ─── entry builders ───────────────────────────────────────────────────────────

function buildGameEntry(
  rev: Revision,
  prevData: Record<string, unknown> | null,
  genres: string[],
  gameItem: DirectusRecord | null,
  sections: GameSection[] | null,
): Entry | null {
  const data = rev.data;
  const date = requireDate(rev.activity?.timestamp, `game revision ${rev.id}`);
  if (!data?.title) return null;

  const isCreate = rev.activity?.action === "create";
  const slug     = requireGuidPart(gameItem?.slug ?? data.slug ?? rev.item, `game revision ${rev.id} slug`);
  const link     = `${siteBase}/games/${slug}/index.html`;
  const imgUrl   = mediaUrl(gameItem?.cover_image ?? data.cover_image) ?? undefined;

  if (isCreate) {
    return {
      title: `Game Added: ${data.title}`,
      link,
      description: fmtNewGame(data, genres),
      pubDate: date,
      imageUrl: imgUrl,
      guid: rssGuid("game", slug, "created", date, `game revision ${rev.id}`),
      nsfw: isGameNsfw(gameItem ?? {}),
      completed: data.player_status === "completed",
    };
  }

  const desc = fmtDelta(feedDelta(rev.delta), prevData, data, sections);
  if (!desc.trim()) return null; // only skipped fields changed (e.g. just date_updated)

  return {
    title: `Game Updated: ${data.title}`,
    link,
    description: desc,
    pubDate: date,
    imageUrl: imgUrl,
    guid: rssGuid("game", slug, gameGuidEvent(rev), date, `game revision ${rev.id}`),
    nsfw: isGameNsfw(gameItem ?? {}),
    completed: rev.delta?.player_status === "completed",
  };
}

function buildReviewEntry(
  rev: Revision,
  reviewItem: DirectusRecord | null, // live-fetched with game expanded
): Entry | null {
  const data = rev.data;
  const date = requireDate(rev.activity?.timestamp, `review revision ${rev.id}`);
  if (!data?.title) return null;
  if (data.status !== "published" && rev.delta?.status !== "published") return null;

  const isNewlyPublished =
    rev.activity?.action === "create" ||
    rev.delta?.status === "published";

  const slug   = requireGuidPart(reviewItem?.slug ?? data.slug ?? rev.item, `review revision ${rev.id} slug`);
  const link   = `${siteBase}/reviews/${slug}/index.html`;
  const reviewGame = reviewItem?.game as DirectusRecord | undefined;
  const imgUrl = mediaUrl(reviewGame?.cover_image) ?? undefined;

  if (isNewlyPublished) {
    const lines: string[] = [];
    const game = reviewGame;
    if (game?.title) lines.push(`**Game**: ${String(game.title)}`);
    if (data.rating)  lines.push(`**Rating**: ${String(data.rating)}/10`);
    if (data.published_at) lines.push(`**Published**: ${String(data.published_at).slice(0, 10)}`);
    return {
      title: `Review Published: ${data.title}`,
      link,
      description: lines.join("\n") || "New review published.",
      pubDate: date,
      imageUrl: imgUrl,
      guid: rssGuid("review", slug, "published", date, `review revision ${rev.id}`),
      nsfw: isGameNsfw(reviewGame ?? {}),
      completed: false,
    };
  }

  const desc = fmtDelta(rev.delta ?? {}, null);
  if (!desc.trim()) return null;

  return {
    title: `Review Updated: ${data.title}`,
    link,
    description: desc,
    pubDate: date,
    imageUrl: imgUrl,
    guid: rssGuid("review", slug, "updated", date, `review revision ${rev.id}`),
    nsfw: isGameNsfw(reviewGame ?? {}),
    completed: false,
  };
}

function buildTierListEntry(rev: Revision, tierListItem: DirectusRecord | null): Entry | null {
  const data = rev.data;
  const date = requireDate(rev.activity?.timestamp, `tier list revision ${rev.id}`);
  if (!data?.title) return null;

  const isCreate    = rev.activity?.action === "create";
  const isPublished = rev.delta?.status === "published";
  const slug        = requireGuidPart(data.slug ?? rev.item, `tier list revision ${rev.id} slug`);
  const link        = `${siteBase}/tiers/${slug}/index.html`;

  if (isCreate || isPublished) {
    const lines = [`**Title**: ${data.title}`];
    if (data.description) lines.push(`**Description**: ${data.description}`);
    return {
      title: `Tier List Published: ${data.title}`,
      link,
      description: lines.join("\n"),
      pubDate: date,
      guid: rssGuid("tier-list", slug, "published", date, `tier list revision ${rev.id}`),
      nsfw: isTierListNsfw(tierListItem ?? data),
      completed: false,
    };
  }

  const desc = fmtDelta(rev.delta ?? {}, null);
  if (!desc.trim()) return null;

  return {
    title: `Tier List Updated: ${data.title}`,
    link,
    description: desc,
    pubDate: date,
    guid: rssGuid("tier-list", slug, "updated", date, `tier list revision ${rev.id}`),
    nsfw: isTierListNsfw(tierListItem ?? data),
    completed: false,
  };
}

// Build one or more entries for a batch of tier_list_games additions to the same
// tier list within the same minute. Batching avoids flooding Discord when a tier
// list is first populated with many games at once.
function buildTierListGameEntries(
  batch: Activity[],
  tlgMap: Record<number, DirectusRecord>, // id → {game_id, tier_list_id, rating}
  gameMap: Record<number, DirectusRecord>,
  tierListMap: Record<number, DirectusRecord>,
): Entry[] {
  const resolved = batch
    .map((act) => {
      const tlg      = tlgMap[Number(act.item)];
      const game     = gameMap[Number(tlg?.game_id)];
      const tierList = tierListMap[Number(tlg?.tier_list_id)];
      if (!tlg || !game || !tierList) return null;
      return { act, game, tierList, rating: tlg.rating as string };
    })
    .filter(Boolean) as { act: Activity; game: DirectusRecord; tierList: DirectusRecord; rating: string }[];

  if (!resolved.length) return [];

  const date     = requireDate(resolved[0].act.timestamp, `tier list game activity ${resolved[0].act.id}`);
  const tierList = resolved[0].tierList;
  const tierSlug = requireGuidPart(tierList?.slug ?? tierList?.id, `tier list game activity ${resolved[0].act.id} tier list slug`);
  const link     = `${siteBase}/tiers/${tierSlug}/index.html`;

  if (resolved.length === 1) {
    const { game, rating } = resolved[0];
    return [{
      title: `Game Added to Tier List: ${game.title}`,
      link,
      description: `**${game.title}** added to **${tierList.title}** -- tier **${rating}**`,
      pubDate: date,
      guid: rssGuid("tier-list", tierSlug, "game_added", date, `tier list game activity ${resolved[0].act.id}`),
      nsfw: isTierBoardEntryNsfw(game, tierList),
      completed: false,
    }];
  }

  // Multiple games added at once
  const lines = resolved.map(({ game, rating }) => `**${rating}**: ${game.title}`);
  return [{
    title: `Games Added to Tier List: ${tierList.title}`,
    link,
    description: lines.join("\n"),
    pubDate: date,
    guid: rssGuid("tier-list", tierSlug, "games_added", date, `tier list game activity batch ${tierList.id}`),
    nsfw: isTierListNsfw(tierList) || resolved.some(({ game }) => isGameNsfw(game)),
    completed: false,
  }];
}

function buildGameLinkEntry(
  act: Activity,
  glinkItem: DirectusRecord | null,
  gameItem: DirectusRecord | null,
): Entry | null {
  if (!glinkItem || !gameItem) return null;
  const date = requireDate(act.timestamp, `games_link activity ${act.id}`);
  const slug = requireGuidPart(gameItem.slug, `games_link activity ${act.id} game slug`);
  const link = `${siteBase}/games/${slug}/index.html`;
  const imgUrl = mediaUrl(gameItem.cover_image) ?? undefined;
  const kind: string = String(glinkItem.kind ?? "download");
  const isWalkthrough = kind === "walkthrough" || kind === "text-note";
  const isUpdate = act.action === "update";
  const kindLabel = isWalkthrough ? "Walkthrough" : "Download";
  return {
    title: `${kindLabel} ${isUpdate ? "Updated" : "Added"}: ${gameItem.title}`,
    link,
    description: `**${kindLabel}**: ${glinkItem.url}`,
    pubDate: date,
    imageUrl: imgUrl,
    guid: rssGuid("game", slug, `link_${act.action}_${kind}_${act.id}`, date, `games_link activity ${act.id}`),
    nsfw: isGameNsfw(gameItem),
    completed: false,
  };
}

const relationId = (value: unknown): number | null => {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value) return Number(value);
  if (typeof value === "object" && value !== null && "id" in value) {
    return Number((value as { id: unknown }).id);
  }
  return null;
};

const bundleDelta = (record: Record<string, unknown> | null): Record<string, unknown> => {
  if (!record) return {};
  const fields = [
    "title",
    "release_year",
    "cover_image",
    "player_status",
    "section_data_status",
    "section_noun",
    "current_section",
  ];
  return Object.fromEntries(
    fields
      .filter((field) => Object.prototype.hasOwnProperty.call(record, field))
      .map((field) => [field, record[field]]),
  );
};

// ─── section count/completion tracking ─────────────────────────────────────
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
// exactly the "before/after" tracking this feature exists for). Using
// today's live state for any row not touched by a given run would leak a
// *later* run's changes into an *older* run's reported totals whenever that
// other row was touched in between -- e.g. the older run would appear to
// jump straight to today's count instead of the count as of its own end.

type SectionParent = { kind: "game" | "bundle_member"; id: number };

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
function resolveRowParents(revisions: Revision[]): Map<number, SectionParent> {
  const rowParents = new Map<number, SectionParent>();
  for (const rev of revisions) {
    const rowId = Number(rev.item);
    if (!rowId || rowParents.has(rowId)) continue;
    const parent = sectionRevisionParent(rev);
    if (parent) rowParents.set(rowId, parent);
  }
  return rowParents;
}

type SectionRun = {
  key: string;
  parent: SectionParent;
  timestamp: string; // latest revision's activity timestamp in the run
  revisions: Revision[];
};

// A colon-free bucket key: guid event segments can't contain colons (see
// GUID_RE), and ISO timestamps do.
const runBucket = (timestamp: string): string => timestamp.slice(0, 16).replace(/[-:]/g, "");

function groupSectionRuns(
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

type RowTimeline = { parent: SectionParent; revisions: Revision[] }; // revisions sorted oldest -> newest by id

const parentKey = (parent: SectionParent): string => `${parent.kind}_${parent.id}`;

function buildRowTimelinesByParent(
  revisions: Revision[],
  rowParents: Map<number, SectionParent>,
): Map<string, Map<number, RowTimeline>> {
  const byParent = new Map<string, Map<number, RowTimeline>>();
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
function sectionCountsAt(
  parent: SectionParent,
  asOfRevisionId: number,
  timelinesByParent: Map<string, Map<number, RowTimeline>>,
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

function buildSectionCountEntry(
  run: SectionRun,
  liveRows: GameSection[],
  timelinesByParent: Map<string, Map<number, RowTimeline>>,
  metaRecord: DirectusRecord | null, // games row (kind "game") or game_bundle_members row (kind "bundle_member")
  gameItem: DirectusRecord | null,   // top-level game record, for the link/cover/nsfw
): Entry | null {
  if (!metaRecord || !gameItem) return null;
  const runIds = run.revisions.map((rev) => rev.id);
  const runStartId = Math.min(...runIds) - 1; // just before this run's earliest change
  const runEndId = Math.max(...runIds);       // just after this run's latest change
  const before = sectionCountsAt(run.parent, runStartId, timelinesByParent, liveRows);
  if (before.total === 0) return null; // initial population -- covered by the Added entry
  const after = sectionCountsAt(run.parent, runEndId, timelinesByParent, liveRows);
  const style = run.parent.kind === "game" ? (metaRecord.section_style as string | null) : "linear";
  const noun  = sectionNoun(metaRecord.section_noun as string | null | undefined);
  const description = fmtSectionCountDelta(style, noun, before, after);
  if (!description.trim()) return null;

  const date  = requireDate(run.timestamp, `game_sections run ${run.key}`);
  const slug  = requireGuidPart(gameItem.slug, `game_sections run ${run.key} slug`);
  const title = String(metaRecord.title ?? gameItem.title ?? "Untitled");
  return {
    title: `Game Updated: ${title}`,
    link: `${siteBase}/games/${slug}/index.html`,
    description,
    pubDate: date,
    imageUrl: mediaUrl(gameItem.cover_image) ?? undefined,
    guid: rssGuid("game", slug, `sections_${run.key}`, date, `game_sections run ${run.key}`),
    nsfw: isGameNsfw(gameItem),
    completed: false,
  };
}

// ─── cross-type consolidation ───────────────────────────────────────────────

const KNOWN_TITLE_PREFIXES = [
  "Game Added: ", "Game Updated: ",
  "Download Added: ", "Download Updated: ",
  "Walkthrough Added: ", "Walkthrough Updated: ",
  "Included Game Added - ", "Included Game Updated - ", "Included Game Removed - ",
];

function coreEntryTitle(entryTitle: string): string {
  for (const prefix of KNOWN_TITLE_PREFIXES) {
    if (entryTitle.startsWith(prefix)) return entryTitle.slice(prefix.length);
  }
  return entryTitle;
}

function mergeGameSession(session: Entry[]): Entry {
  const last = session[session.length - 1];
  const addedEntry = session.find((entry) => entry.title.startsWith("Game Added: "));
  const title = addedEntry ? addedEntry.title : `Game Updated: ${coreEntryTitle(last.title)}`;
  const description = session
    .map((entry) => entry.description)
    .filter((text) => text.trim().length > 0)
    .join("\n\n");
  const imageUrl = session.map((entry) => entry.imageUrl).find(Boolean);
  const slug = requireGuidPart(last.guid.split(":")[1], "consolidated session slug");
  const anchorMs = session[0].pubDate.getTime();
  return {
    title,
    link: last.link,
    description,
    pubDate: last.pubDate,
    imageUrl,
    guid: rssGuid("game", slug, `consolidated_${anchorMs}`, last.pubDate, "consolidated session"),
    nsfw: session.some((entry) => entry.nsfw),
    completed: last.completed,
  };
}

// Merge same-game entries emitted within GAME_CONSOLIDATION_WINDOW_MS of each
// other into one feed item. Only "game:"-guid entries participate (direct
// games, included/bundle-member games, download/walkthrough links, and
// section-count changes all resolve to the same game page); reviews and tier
// lists pass through untouched.
function consolidateGameEntries(entries: Entry[]): Entry[] {
  const byGame = new Map<string, Entry[]>();
  const others: Entry[] = [];
  for (const entry of entries) {
    const [type, key] = entry.guid.split(":");
    if (type !== "game") {
      others.push(entry);
      continue;
    }
    const groupKey = `${type}:${key}`;
    const group = byGame.get(groupKey) ?? [];
    group.push(entry);
    byGame.set(groupKey, group);
  }

  const merged: Entry[] = [];
  for (const group of byGame.values()) {
    group.sort((a, b) => a.pubDate.getTime() - b.pubDate.getTime());
    let session: Entry[] = [];
    let anchor = 0;
    const flush = () => {
      if (!session.length) return;
      merged.push(session.length === 1 ? session[0] : mergeGameSession(session));
      session = [];
    };
    for (const entry of group) {
      if (session.length && entry.pubDate.getTime() - anchor > GAME_CONSOLIDATION_WINDOW_MS) {
        flush();
      }
      if (!session.length) anchor = entry.pubDate.getTime();
      session.push(entry);
    }
    flush();
  }
  return [...others, ...merged];
}

function buildBundleMemberEntry(
  rev: Revision,
  previousData: Record<string, unknown> | null,
  memberItem: DirectusRecord | null,
  gameItem: DirectusRecord | null,
  sections: GameSection[] | null,
): Entry | null {
  if (!gameItem) return null;
  const data = memberItem ?? rev.data ?? {};
  const memberId = Number(rev.item);
  const title = String(data.title ?? rev.data?.title ?? "Untitled");
  const date = requireDate(
    rev.activity?.timestamp,
    `game_bundle_members revision ${rev.id}`,
  );
  const gameSlug = requireGuidPart(
    gameItem.slug,
    `game_bundle_members revision ${rev.id} parent slug`,
  );
  const action = rev.activity?.action;
  const isCreate = action === "create";
  const isDelete = action === "delete";
  const activityId = rev.activity?.id ?? rev.id;
  const event = isCreate
    ? `member_created_${memberId}_${rev.id}`
    : isDelete
      ? `member_removed_${memberId}_${activityId}`
      : `member_updated_${memberId}_${rev.id}`;
  const actionLabel = isCreate ? "Added" : isDelete ? "Removed" : "Updated";
  const description = isDelete
    ? "Included game removed."
    : isCreate
    ? fmtDelta(bundleDelta(data), null, data, sections)
    : fmtDelta(bundleDelta(rev.delta), bundleDelta(previousData), data, sections);
  if (!isCreate && !isDelete && !description.trim()) return null;
  return {
    title: `Included Game ${actionLabel} - ${title}`,
    link: `${siteBase}/games/${gameSlug}/index.html`,
    description,
    pubDate: date,
    imageUrl: mediaUrl(gameItem.cover_image) ?? undefined,
    guid: rssGuid(
      "game",
      gameSlug,
      event,
      date,
      `game_bundle_members revision ${rev.id}`,
    ),
    nsfw: isGameNsfw(gameItem),
    completed: isDelete
      ? false
      : isCreate
        ? data.player_status === "completed"
        : rev.delta?.player_status === "completed",
  };
}

// ─── main handler ─────────────────────────────────────────────────────────────

export async function buildFeedEntries(): Promise<FeedEntry[]> {
  // 1. Fetch all revision/activity streams + move log in parallel
  const [
    allGameRevs,
    reviewRevs,
    tierListRevs,
    allBundleMemberRevs,
    tlgActs,
    glinkActs,
    allSectionRevs,
  ] = await Promise.all([
    fetchRevisions("games",       -1),
    fetchRevisions("reviews",     LIMIT_REVIEWS),
    fetchRevisions("tier_lists",  LIMIT_TIER_LISTS),
    fetchRevisions("game_bundle_members", -1),
    fetchCreateActivity("tier_list_games", LIMIT_JUNCTIONS),
    fetchActivity("games_links", ["create", "update"], LIMIT_LINKS),
    fetchRevisions("game_sections", -1),
  ]);
  const gameRevs = allGameRevs.slice(0, LIMIT_GAMES);
  const bundleMemberRevs = allBundleMemberRevs.slice(0, LIMIT_BUNDLE_MEMBERS);

  // Section runs are resolved up front (no network access) so their parent
  // ids can be folded into the batch id sets below instead of triggering a
  // second round of fetches.
  const sectionRowParents = resolveRowParents(allSectionRevs);
  const sectionRuns = groupSectionRuns(allSectionRevs, sectionRowParents);
  const sectionTimelinesByParent = buildRowTimelinesByParent(allSectionRevs, sectionRowParents);
  const sectionGameIds = new Set<number>(
    sectionRuns.filter((run) => run.parent.kind === "game").map((run) => run.parent.id),
  );
  const sectionBundleMemberIds = new Set<number>(
    sectionRuns.filter((run) => run.parent.kind === "bundle_member").map((run) => run.parent.id),
  );

  // 2. Resolve IDs needed for batch lookups

  // tier_list_games: fetch the actual records (for additions)
  const tlgItemIds   = tlgActs.map((a) => Number(a.item));
  const glinkItemIds = glinkActs.map((a) => Number(a.item));
  const reviewItemIds = reviewRevs.map((r) => Number(r.item));
  const gameRevisionIds = gameRevs.map((r) => Number(r.item));
  const bundleMemberItemIds = Array.from(new Set([
    ...bundleMemberRevs.map((r) => Number(r.item)),
    ...sectionBundleMemberIds,
  ]));
  const tierListRevisionIds = tierListRevs.map((revision) => Number(revision.item));

  const [tlgItemMap, glinkItemMap, reviewItemMap, bundleMemberItemMap] = await Promise.all([
    fetchItemMap("tier_list_games", tlgItemIds, "id,game_id,tier_list_id,rating"),
    fetchItemMap("games_links",     glinkItemIds, "id,games_id,url,kind"),
    fetchItemMap("reviews", reviewItemIds,
      "id,title,slug,status,rating,published_at,game.id,game.title,game.cover_image.id,game.cover_image.filename_disk,game.nsfw,game.genres.genres_id.nsfw"),
    fetchItemMap(
      "game_bundle_members",
      bundleMemberItemIds,
      "id,games_id,title,player_status,section_data_status,section_noun,current_section",
    ),
  ]);

  // Collect game IDs and tier_list IDs from tier additions
  const tierListIdsForAdd = new Set<number>(tierListRevisionIds);
  const gameIdsForTiers   = new Set<number>();
  for (const tlg of Object.values(tlgItemMap)) {
    if (tlg.tier_list_id) tierListIdsForAdd.add(Number(tlg.tier_list_id));
    if (tlg.game_id)      gameIdsForTiers.add(Number(tlg.game_id));
  }

  // Collect game IDs referenced by games_links activities
  const gameIdsForLinks = new Set<number>();
  for (const glink of Object.values(glinkItemMap)) {
    if (glink.games_id) gameIdsForLinks.add(Number(glink.games_id));
  }
  const gameIdsForBundleMembers = new Set<number>();
  for (const rev of bundleMemberRevs) {
    const liveItem = bundleMemberItemMap[Number(rev.item)];
    const gameId = relationId(liveItem?.games_id ?? rev.data?.games_id);
    if (gameId) gameIdsForBundleMembers.add(gameId);
  }
  for (const memberId of sectionBundleMemberIds) {
    const gameId = relationId(bundleMemberItemMap[memberId]?.games_id);
    if (gameId) gameIdsForBundleMembers.add(gameId);
  }

  // 3. Batch-fetch support data
  const allGameIds = new Set([
    ...gameIdsForTiers,
    ...gameIdsForLinks,
    ...gameIdsForBundleMembers,
    ...gameRevisionIds,
    ...sectionGameIds,
  ]);
  const [
    tierListMap,
    gameMap,
    gameSectionsMap,
    bundleMemberSectionsMap,
    allGameGenreMap,
  ] = await Promise.all([
    fetchItemMap("tier_lists", Array.from(tierListIdsForAdd), "id,title,slug,nsfw"),
    fetchItemMap("games", Array.from(allGameIds),
      "id,title,slug,cover_image.id,cover_image.filename_disk,nsfw,genres.genres_id.nsfw,section_style,section_noun"),
    fetchGameSectionsByGameIds(Array.from(new Set([...gameRevisionIds, ...sectionGameIds]))),
    fetchGameSectionsByBundleMemberIds(Array.from(new Set(bundleMemberItemIds))),
    fetchAllGameGenres(),
  ]);

  // 4. Process game revisions. Previous snapshots come from the collection-wide
  // revision lists above instead of one Directus request per update.
  const createGameRevs = gameRevs.filter((r) => r.activity?.action === "create");
  const updateGameRevs = gameRevs.filter((r) => r.activity?.action === "update");
  const updateBundleMemberRevs = bundleMemberRevs.filter(
    (revision) => revision.activity?.action === "update",
  );
  const newGameIds     = createGameRevs.map((r) => Number(r.item));
  const gamePrevMap = previousRevisionDataMap(allGameRevs, updateGameRevs);
  const newGameGenreMap: Record<number, string[]> = Object.fromEntries(
    newGameIds.map((id) => [id, allGameGenreMap[id] ?? []]),
  );
  const bundleMemberPrevMap = previousRevisionDataMap(
    allBundleMemberRevs,
    updateBundleMemberRevs,
  );

  // 5. Build all feed entries
  const entries: Entry[] = [];

  // Games
  for (const rev of gameRevs) {
    const prevData = gamePrevMap[rev.id] ?? null;
    const genres   = newGameGenreMap[Number(rev.item)] ?? [];
    const liveItem = gameMap[Number(rev.item)] ?? null;
    const sections = directGameSections(gameSectionsMap[Number(rev.item)]);
    const entry    = buildGameEntry(rev, prevData, genres, liveItem, sections);
    if (entry) entries.push(entry);
  }

  // Included games
  for (const rev of bundleMemberRevs) {
    const liveItem = bundleMemberItemMap[Number(rev.item)] ?? null;
    const gameId = relationId(liveItem?.games_id ?? rev.data?.games_id);
    const gameItem = gameId ? gameMap[gameId] ?? null : null;
    const sections = bundleMemberSectionsMap[Number(rev.item)] ?? null;
    const entry = buildBundleMemberEntry(
      rev,
      bundleMemberPrevMap[rev.id] ?? null,
      liveItem,
      gameItem,
      sections,
    );
    if (entry) entries.push(entry);
  }

  // Section count/completion changes (chapters/missions/quests added, or
  // nonlinear completion progress), batched into per-parent runs above.
  for (const run of sectionRuns) {
    const liveRows = run.parent.kind === "game"
      ? directGameSections(gameSectionsMap[run.parent.id])
      : (bundleMemberSectionsMap[run.parent.id] ?? []);
    const metaRecord = run.parent.kind === "game"
      ? gameMap[run.parent.id] ?? null
      : bundleMemberItemMap[run.parent.id] ?? null;
    const gameItem = run.parent.kind === "game"
      ? gameMap[run.parent.id] ?? null
      : gameMap[relationId(metaRecord?.games_id) ?? -1] ?? null;
    const entry = buildSectionCountEntry(run, liveRows, sectionTimelinesByParent, metaRecord, gameItem);
    if (entry) entries.push(entry);
  }

  // Reviews
  for (const rev of reviewRevs) {
    const liveItem = reviewItemMap[Number(rev.item)] ?? null;
    const entry    = buildReviewEntry(rev, liveItem);
    if (entry) entries.push(entry);
  }

  // Tier lists
  for (const rev of tierListRevs) {
    const entry = buildTierListEntry(rev, tierListMap[Number(rev.item)] ?? null);
    if (entry) entries.push(entry);
  }

  // Games link additions (download/walkthrough URLs added to games_links)
  for (const act of glinkActs) {
    const glink    = glinkItemMap[Number(act.item)];
    const gameItem = glink ? gameMap[Number(glink.games_id)] : null;
    const entry    = buildGameLinkEntry(act, glink ?? null, gameItem ?? null);
    if (entry) entries.push(entry);
  }

  // Tier list game additions -- batch by tier_list + minute to avoid flood
  const tlgBuckets = new Map<string, Activity[]>();
  for (const act of tlgActs) {
    const tlg  = tlgItemMap[Number(act.item)];
    const tlId = tlg?.tier_list_id ?? "?";
    const bucket = `${tlId}_${act.timestamp.slice(0, 16)}`; // group by tier_list + minute
    if (!tlgBuckets.has(bucket)) tlgBuckets.set(bucket, []);
    tlgBuckets.get(bucket)!.push(act);
  }
  for (const batch of tlgBuckets.values()) {
    const batchEntries = buildTierListGameEntries(batch, tlgItemMap, gameMap, tierListMap);
    entries.push(...batchEntries);
  }

  // 6. Consolidate bursts of same-game activity, sort, dedupe guids, limit
  const consolidated = consolidateGameEntries(entries);
  consolidated.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
  const seen  = new Set<string>();
  const top   = consolidated.filter((e) => {
    if (seen.has(e.guid)) return false;
    seen.add(e.guid);
    return true;
  }).slice(0, 200);
  validateFeedEntries(top);

  return top;
}

export function renderFeedXml(
  entries: FeedEntry[],
  options: { title: string; description: string },
): string {
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "<channel>",
    `<title>${xmlEscape(options.title)}</title>`,
    `<link>${xmlEscape(siteBase)}</link>`,
    `<description>${xmlEscape(options.description)}</description>`,
    ...entries.map(itemXml),
    "</channel>",
    "</rss>",
  ].join("");

  return xml;
}
