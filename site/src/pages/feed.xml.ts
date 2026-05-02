import type { APIRoute } from "astro";
import { directusFetchRaw, assetsBaseUrl } from "../lib/directus";

// ─── config ──────────────────────────────────────────────────────────────────

const siteBase = (assetsBaseUrl() || "https://jasmeralia.com").replace(/\/$/, "");

// How many recent revisions/activities to pull per collection
const LIMIT_GAMES       = 100;
const LIMIT_REVIEWS     = 50;
const LIMIT_TIER_LISTS  = 50;
const LIMIT_JUNCTIONS   = 300; // tier_row_games activities
const LIMIT_TIER_MOVES  = 100;

// ─── field / enum labels ─────────────────────────────────────────────────────

// Fields skipped when building delta descriptions
const SKIP_DELTA = new Set([
  "date_updated", "date_created", "sort", "id", "slug", "body", "updated_at",
]);

const FIELD_LABEL: Record<string, string> = {
  title: "Title",
  release_year: "Year",
  player_status: "Play Status",
  game_status: "Release Status",
  download_url: "Download",
  walkthrough_url: "Walkthrough",
  gamestorylog_url: "Story Log",
  family_sharing: "Family Sharing",
  cover_image: "Cover Image",
  status: "Status",
  description: "Description",
  rating: "Rating",
  published_at: "Published",
};

const ENUM_LABEL: Record<string, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  completed: "Completed",
  did_not_finish: "Did Not Finish",
  waiting_for_update: "Waiting for Update",
  released: "Released",
  in_development: "In Development",
  cancelled: "Cancelled",
  draft: "Draft",
  published: "Published",
};

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
  const id   = typeof file === "string" ? file : (file as any)?.id;
  const disk = typeof file === "string" ? null  : ((file as any)?.filename_disk ?? null);
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

// ─── value formatting ─────────────────────────────────────────────────────────

function humanVal(field: string, val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (field === "cover_image") return val ? "[image]" : "—";
  if (typeof val === "boolean") return val ? "Yes" : "No";
  if (typeof val === "string") return ENUM_LABEL[val] ?? val;
  return String(val);
}

// Build a Discord-markdown description from a revision delta.
// prevData is the full data snapshot from the previous revision (for "from" values).
function fmtDelta(
  delta: Record<string, unknown>,
  prev: Record<string, unknown> | null,
): string {
  const lines: string[] = [];
  for (const [f, newVal] of Object.entries(delta)) {
    if (SKIP_DELTA.has(f)) continue;
    // Special-case cover_image: just note whether it was added/updated/removed
    if (f === "cover_image") {
      const oldVal = prev?.[f] ?? null;
      if (!oldVal && newVal)       lines.push(`**Cover Image**: Added`);
      else if (oldVal && !newVal)  lines.push(`**Cover Image**: Removed`);
      else if (oldVal && newVal)   lines.push(`**Cover Image**: Updated`);
      continue;
    }
    const label  = FIELD_LABEL[f] ?? f;
    const oldVal = prev?.[f] ?? null;
    if (oldVal !== null && oldVal !== undefined) {
      lines.push(`**${label}**: ${humanVal(f, oldVal)} → ${humanVal(f, newVal)}`);
    } else {
      lines.push(`**${label}**: ${humanVal(f, newVal)}`);
    }
  }
  return lines.join("\n");
}

// Build description for a newly added game (creation snapshot).
function fmtNewGame(data: Record<string, unknown>, genres: string[]): string {
  const lines: string[] = [];
  const fields: [string, string][] = [
    ["release_year", "Year"],
    ["player_status", "Play Status"],
    ["game_status", "Release Status"],
    ["download_url", "Download"],
    ["walkthrough_url", "Walkthrough"],
    ["gamestorylog_url", "Story Log"],
    ["family_sharing", "Family Sharing"],
  ];
  for (const [f, label] of fields) {
    const v = data[f];
    if (v !== null && v !== undefined) lines.push(`**${label}**: ${humanVal(f, v)}`);
  }
  if (genres.length) lines.push(`**Genres**: ${genres.join(", ")}`);
  return lines.join("\n");
}

function gameGuidEvent(rev: Revision): string {
  if (rev.activity?.action === "create") return "created";
  const changedFields = Object.keys(rev.delta ?? {}).filter((field) => !SKIP_DELTA.has(field));
  if (changedFields.length === 1 && changedFields[0] === "player_status") return "play_status";
  if (changedFields.length === 1 && changedFields[0] === "game_status") return "release_status";
  return "updated";
}

// ─── Directus API helpers ────────────────────────────────────────────────────

type Revision = {
  id: number;
  item: string;
  collection: string;
  data: Record<string, unknown> | null;
  delta: Record<string, unknown> | null;
  activity: { action: string; timestamp: string } | null;
};

type Activity = {
  id: number;
  action: string;
  collection: string;
  item: string;
  timestamp: string;
};

// Fetch the most recent revisions for a collection (ordered by id DESC).
async function fetchRevisions(collection: string, limit: number): Promise<Revision[]> {
  const qs = new URLSearchParams({
    "filter[collection][_eq]": collection,
    "sort": "-id",
    "limit": String(limit),
    "fields": "id,item,collection,delta,data,activity.action,activity.timestamp",
  });
  const res = await directusFetchRaw<{ data: Revision[] }>(`/revisions?${qs.toString()}`);
  return res.data ?? [];
}

// Fetch the revision immediately before a given revision id for an item.
async function fetchPrevRevision(collection: string, item: string, beforeId: number): Promise<Revision | null> {
  const qs = new URLSearchParams({
    "filter[collection][_eq]": collection,
    "filter[item][_eq]": item,
    "filter[id][_lt]": String(beforeId),
    "sort": "-id",
    "limit": "1",
    "fields": "id,data",
  });
  const res = await directusFetchRaw<{ data: Revision[] }>(`/revisions?${qs.toString()}`);
  return res.data?.[0] ?? null;
}

// Fetch recent create activities for a junction collection (no revision data available).
async function fetchCreateActivity(collection: string, limit: number): Promise<Activity[]> {
  const qs = new URLSearchParams({
    "filter[collection][_eq]": collection,
    "filter[action][_eq]": "create",
    "sort": "-timestamp",
    "limit": String(limit),
    "fields": "id,action,collection,item,timestamp",
  });
  const res = await directusFetchRaw<{ data: Activity[] }>(`/activity?${qs.toString()}`);
  return res.data ?? [];
}

// Batch-fetch items from any collection by ID, returning a map of id → item.
async function fetchItemMap(collection: string, ids: number[], fields: string): Promise<Record<number, any>> {
  if (!ids.length) return {};
  const qs = new URLSearchParams({
    "filter[id][_in]": ids.join(","),
    "fields": fields,
    "limit": String(ids.length + 10),
  });
  const res = await directusFetchRaw<{ data: any[] }>(`/items/${collection}?${qs.toString()}`);
  return Object.fromEntries((res.data ?? []).map((x: any) => [x.id, x]));
}

// Fetch current genre names for a game (for new-game entries).
async function fetchGameGenres(gameId: number): Promise<string[]> {
  const qs = new URLSearchParams({
    "filter[games_id][_eq]": String(gameId),
    "fields": "genres_id.name",
    "limit": "50",
  });
  const res = await directusFetchRaw<{ data: any[] }>(`/items/games_genres?${qs.toString()}`);
  return (res.data ?? []).map((r: any) => r.genres_id?.name).filter(Boolean);
}

// ─── entry types ─────────────────────────────────────────────────────────────

type Entry = {
  title: string;
  link: string;
  description: string;
  pubDate: Date;
  imageUrl?: string;
  guid: string;
};

// ─── entry builders ───────────────────────────────────────────────────────────

function buildGameEntry(
  rev: Revision,
  prevData: Record<string, unknown> | null,
  genres: string[],
  gameItem: any | null,
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
    };
  }

  const desc = fmtDelta(rev.delta ?? {}, prevData);
  if (!desc.trim()) return null; // only skipped fields changed (e.g. just date_updated)

  return {
    title: `Game Updated: ${data.title}`,
    link,
    description: desc,
    pubDate: date,
    imageUrl: imgUrl,
    guid: rssGuid("game", slug, gameGuidEvent(rev), date, `game revision ${rev.id}`),
  };
}

function buildReviewEntry(
  rev: Revision,
  reviewItem: any | null, // live-fetched with game expanded
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
  const imgUrl = mediaUrl(reviewItem?.game?.cover_image) ?? undefined;

  if (isNewlyPublished) {
    const lines: string[] = [];
    const game = reviewItem?.game;
    if (game?.title) lines.push(`**Game**: ${game.title}`);
    if (data.rating)  lines.push(`**Rating**: ${data.rating}/10`);
    if (data.published_at) lines.push(`**Published**: ${String(data.published_at).slice(0, 10)}`);
    return {
      title: `Review Published: ${data.title}`,
      link,
      description: lines.join("\n") || "New review published.",
      pubDate: date,
      imageUrl: imgUrl,
      guid: rssGuid("review", slug, "published", date, `review revision ${rev.id}`),
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
  };
}

function buildTierListEntry(rev: Revision): Entry | null {
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
  };
}

// Build one or more entries for a batch of tier_row_games additions to the same
// tier list within the same minute. Batching avoids flooding Discord when a tier
// list is first populated with many games at once.
function buildTierRowGameEntries(
  batch: Activity[],
  tierRowGameMap: Record<number, any>, // id → {game_id, tier_row_id}
  gameMap: Record<number, any>,
  tierRowMap: Record<number, any>,
): Entry[] {
  // Resolve items
  const resolved = batch
    .map((act) => {
      const trg     = tierRowGameMap[Number(act.item)];
      const game    = gameMap[Number(trg?.game_id)];
      const tierRow = tierRowMap[Number(trg?.tier_row_id)];
      if (!trg || !game || !tierRow?.tier_list) return null;
      return { act, game, tierRow };
    })
    .filter(Boolean) as { act: Activity; game: any; tierRow: any }[];

  if (!resolved.length) return [];

  const date      = requireDate(resolved[0].act.timestamp, `tier row game activity ${resolved[0].act.id}`);
  const tierList  = resolved[0].tierRow.tier_list;
  const tierSlug  = requireGuidPart(tierList?.slug ?? tierList?.id, `tier row game activity ${resolved[0].act.id} tier list slug`);
  const link      = `${siteBase}/tiers/${tierSlug}/index.html`;

  if (resolved.length === 1) {
    const { game, tierRow } = resolved[0];
    return [{
      title: `Game Added to Tier List: ${game.title}`,
      link,
      description: `**${game.title}** added to **${tierList.title}** — tier **${tierRow.label}**`,
      pubDate: date,
      guid: rssGuid("tier-list", tierSlug, "game_added", date, `tier row game activity ${resolved[0].act.id}`),
    }];
  }

  // Multiple games added at once
  const lines = resolved.map(({ game, tierRow }) =>
    `**${tierRow.label}**: ${game.title}`
  );
  return [{
    title: `Games Added to Tier List: ${tierList.title}`,
    link,
    description: lines.join("\n"),
    pubDate: date,
    guid: rssGuid("tier-list", tierSlug, "games_added", date, `tier row game activity batch ${tierList.id}`),
  }];
}

function buildTierMoveEntry(
  move: any,
  game: any,
  fromRow: any,
  toRow: any,
): Entry | null {
  const date = requireDate(move.moved_at, `tier move ${move.id}`);
  if (!game || !fromRow || !toRow) return null;
  const tierList = toRow.tier_list;
  const tierSlug = requireGuidPart(tierList?.slug ?? tierList?.id, `tier move ${move.id} tier list slug`);

  return {
    title: `Game Moved in Tier List: ${game.title}`,
    link: `${siteBase}/tiers/${tierSlug}/index.html`,
    description: `**${game.title}** moved **${fromRow.label}** → **${toRow.label}** in **${tierList.title}**`,
    pubDate: date,
    guid: rssGuid("tier-list", tierSlug, "game_moved", date, `tier move ${move.id}`),
  };
}

// ─── main handler ─────────────────────────────────────────────────────────────

export const GET: APIRoute = async () => {
  // 1. Fetch all revision/activity streams + move log in parallel
  const [gameRevs, reviewRevs, tierListRevs, trGameActs, tierMoves] = await Promise.all([
    fetchRevisions("games",       LIMIT_GAMES),
    fetchRevisions("reviews",     LIMIT_REVIEWS),
    fetchRevisions("tier_lists",  LIMIT_TIER_LISTS),
    fetchCreateActivity("tier_row_games", LIMIT_JUNCTIONS),
    directusFetchRaw<{ data: any[] }>(
      `/items/tier_row_game_moves?sort=-moved_at&limit=${LIMIT_TIER_MOVES}` +
      `&fields=id,tier_row_game_id,game_id,from_tier_row_id,to_tier_row_id,moved_at`
    ).then((r) => r.data ?? []),
  ]);

  // 2. Resolve IDs needed for batch lookups

  // tier_row_games: fetch the actual junction records (for additions)
  const trGameItemIds = trGameActs.map((a) => Number(a.item));
  const reviewItemIds = reviewRevs.map((r) => Number(r.item));
  const gameRevisionIds = gameRevs.map((r) => Number(r.item));

  const [trGameItemMap, reviewItemMap] = await Promise.all([
    fetchItemMap("tier_row_games", trGameItemIds, "id,game_id,tier_row_id"),
    fetchItemMap("reviews", reviewItemIds,
      "id,title,slug,status,rating,published_at,game.id,game.title,game.cover_image.id,game.cover_image.filename_disk"),
  ]);

  // Collect referenced game / tier_row IDs for tier additions
  const tierRowIds      = new Set<number>();
  const gameIdsForTiers = new Set<number>();
  for (const trg of Object.values(trGameItemMap)) {
    if (trg.tier_row_id) tierRowIds.add(Number(trg.tier_row_id));
    if (trg.game_id)     gameIdsForTiers.add(Number(trg.game_id));
  }

  // Collect IDs for tier move log
  const moveGameIds   = new Set<number>();
  const moveTierRowIds = new Set<number>();
  for (const m of tierMoves) {
    if (m.game_id)          moveGameIds.add(Number(m.game_id));
    if (m.from_tier_row_id) moveTierRowIds.add(Number(m.from_tier_row_id));
    if (m.to_tier_row_id)   moveTierRowIds.add(Number(m.to_tier_row_id));
  }
  // Merge tier row IDs for a single batch fetch
  for (const id of moveTierRowIds) tierRowIds.add(id);

  // 3. Batch-fetch support data
  const allGameIds = new Set([...gameIdsForTiers, ...moveGameIds, ...gameRevisionIds]);
  const [tierRowMap, gameMap] = await Promise.all([
    fetchItemMap("tier_rows", Array.from(tierRowIds),
      "id,label,tier_list.id,tier_list.title,tier_list.slug"),
    fetchItemMap("games", Array.from(allGameIds),
      "id,title,slug,cover_image.id,cover_image.filename_disk"),
  ]);

  // 4. Process game revisions: fetch prev revisions and genres for new games in parallel
  const createGameRevs = gameRevs.filter((r) => r.activity?.action === "create");
  const updateGameRevs = gameRevs.filter((r) => r.activity?.action === "update");
  const newGameIds     = createGameRevs.map((r) => Number(r.item));

  const [prevResults, genreResults] = await Promise.all([
    Promise.all(updateGameRevs.map((r) => fetchPrevRevision("games", r.item, r.id))),
    Promise.all(newGameIds.map((id) => fetchGameGenres(id))),
  ]);

  const gamePrevMap: Record<number, Record<string, unknown> | null> = Object.fromEntries(
    updateGameRevs.map((r, i) => [r.id, prevResults[i]?.data ?? null])
  );
  const newGameGenreMap: Record<number, string[]> = Object.fromEntries(
    newGameIds.map((id, i) => [id, genreResults[i] ?? []])
  );

  // 5. Build all feed entries
  const entries: Entry[] = [];

  // Games
  for (const rev of gameRevs) {
    const prevData = gamePrevMap[rev.id] ?? null;
    const genres   = newGameGenreMap[Number(rev.item)] ?? [];
    const liveItem = gameMap[Number(rev.item)] ?? null;
    const entry    = buildGameEntry(rev, prevData, genres, liveItem);
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
    const entry = buildTierListEntry(rev);
    if (entry) entries.push(entry);
  }

  // Tier row game additions — batch by tier_list + minute to avoid flood
  const trBuckets = new Map<string, Activity[]>();
  for (const act of trGameActs) {
    const trg     = trGameItemMap[Number(act.item)];
    const tierRow = trg ? tierRowMap[Number(trg.tier_row_id)] : null;
    const tlId    = tierRow?.tier_list?.id ?? "?";
    const bucket  = `${tlId}_${act.timestamp.slice(0, 16)}`; // group by tier_list + minute
    if (!trBuckets.has(bucket)) trBuckets.set(bucket, []);
    trBuckets.get(bucket)!.push(act);
  }
  for (const batch of trBuckets.values()) {
    const batchEntries = buildTierRowGameEntries(
      batch, trGameItemMap, gameMap, tierRowMap
    );
    entries.push(...batchEntries);
  }

  // Tier row moves (game moved from one tier to another)
  for (const move of tierMoves) {
    const game    = gameMap[Number(move.game_id)];
    const fromRow = tierRowMap[Number(move.from_tier_row_id)];
    const toRow   = tierRowMap[Number(move.to_tier_row_id)];
    const entry   = buildTierMoveEntry(move, game, fromRow, toRow);
    if (entry) entries.push(entry);
  }

  // 6. Sort, dedupe guids, limit, and render
  entries.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
  const seen  = new Set<string>();
  const top   = entries.filter((e) => {
    if (seen.has(e.guid)) return false;
    seen.add(e.guid);
    return true;
  }).slice(0, 200);
  validateFeedEntries(top);

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "<channel>",
    `<title>${xmlEscape("Jasmeralia Feed")}</title>`,
    `<link>${xmlEscape(siteBase)}</link>`,
    `<description>${xmlEscape("Changelog feed: games, reviews, and tier list updates.")}</description>`,
    ...top.map(itemXml),
    "</channel>",
    "</rss>",
  ].join("");

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
};
