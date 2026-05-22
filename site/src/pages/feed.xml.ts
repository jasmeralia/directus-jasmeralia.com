import type { APIRoute } from "astro";
import { directusFetchRaw, assetsBaseUrl } from "../lib/directus";

// ─── config ──────────────────────────────────────────────────────────────────

const siteBase = (assetsBaseUrl() || "https://jasmeralia.com").replace(/\/$/, "");

// How many recent revisions/activities to pull per collection
const LIMIT_GAMES       = 100;
const LIMIT_REVIEWS     = 50;
const LIMIT_TIER_LISTS  = 50;
const LIMIT_JUNCTIONS   = 300; // tier_list_games activities

// ─── field / enum labels ─────────────────────────────────────────────────────

// Fields skipped when building delta descriptions
const SKIP_DELTA = new Set([
  "date_updated", "date_created", "sort", "id", "slug", "body", "updated_at",
  "engines",
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
  on_hold: "On Hold",
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

// Build one or more entries for a batch of tier_list_games additions to the same
// tier list within the same minute. Batching avoids flooding Discord when a tier
// list is first populated with many games at once.
function buildTierListGameEntries(
  batch: Activity[],
  tlgMap: Record<number, any>, // id → {game_id, tier_list_id, rating}
  gameMap: Record<number, any>,
  tierListMap: Record<number, any>,
): Entry[] {
  const resolved = batch
    .map((act) => {
      const tlg      = tlgMap[Number(act.item)];
      const game     = gameMap[Number(tlg?.game_id)];
      const tierList = tierListMap[Number(tlg?.tier_list_id)];
      if (!tlg || !game || !tierList) return null;
      return { act, game, tierList, rating: tlg.rating as string };
    })
    .filter(Boolean) as { act: Activity; game: any; tierList: any; rating: string }[];

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
      description: `**${game.title}** added to **${tierList.title}** — tier **${rating}**`,
      pubDate: date,
      guid: rssGuid("tier-list", tierSlug, "game_added", date, `tier list game activity ${resolved[0].act.id}`),
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
  }];
}

// ─── main handler ─────────────────────────────────────────────────────────────

export const GET: APIRoute = async () => {
  // 1. Fetch all revision/activity streams + move log in parallel
  const [gameRevs, reviewRevs, tierListRevs, tlgActs] = await Promise.all([
    fetchRevisions("games",       LIMIT_GAMES),
    fetchRevisions("reviews",     LIMIT_REVIEWS),
    fetchRevisions("tier_lists",  LIMIT_TIER_LISTS),
    fetchCreateActivity("tier_list_games", LIMIT_JUNCTIONS),
  ]);

  // 2. Resolve IDs needed for batch lookups

  // tier_list_games: fetch the actual records (for additions)
  const tlgItemIds = tlgActs.map((a) => Number(a.item));
  const reviewItemIds = reviewRevs.map((r) => Number(r.item));
  const gameRevisionIds = gameRevs.map((r) => Number(r.item));

  const [tlgItemMap, reviewItemMap] = await Promise.all([
    fetchItemMap("tier_list_games", tlgItemIds, "id,game_id,tier_list_id,rating"),
    fetchItemMap("reviews", reviewItemIds,
      "id,title,slug,status,rating,published_at,game.id,game.title,game.cover_image.id,game.cover_image.filename_disk"),
  ]);

  // Collect game IDs and tier_list IDs from tier additions
  const tierListIdsForAdd = new Set<number>();
  const gameIdsForTiers   = new Set<number>();
  for (const tlg of Object.values(tlgItemMap)) {
    if (tlg.tier_list_id) tierListIdsForAdd.add(Number(tlg.tier_list_id));
    if (tlg.game_id)      gameIdsForTiers.add(Number(tlg.game_id));
  }

  // 3. Batch-fetch support data
  const allGameIds = new Set([...gameIdsForTiers, ...gameRevisionIds]);
  const [tierListMap, gameMap] = await Promise.all([
    fetchItemMap("tier_lists", Array.from(tierListIdsForAdd), "id,title,slug"),
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

  // Tier list game additions — batch by tier_list + minute to avoid flood
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
