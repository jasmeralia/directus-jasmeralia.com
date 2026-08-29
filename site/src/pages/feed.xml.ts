import type { APIRoute } from "astro";
import { assetsBaseUrl, type DirectusFile } from "../lib/directus";
import { directGameSections, type GameSection } from "../lib/game-sections";
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
  previousRevisionDataMap,
  type Activity,
  type Revision,
} from "../lib/changelog";

type DirectusRecord = Record<string, unknown>;

// ─── config ──────────────────────────────────────────────────────────────────

const siteBase = (assetsBaseUrl() || "https://jasmeralia.com").replace(/\/$/, "");

// How many recent revisions/activities to pull per collection
const LIMIT_GAMES       = 100;
const LIMIT_REVIEWS     = 50;
const LIMIT_TIER_LISTS  = 50;
const LIMIT_JUNCTIONS   = 300; // tier_list_games activities
const LIMIT_LINKS       = 400; // games_links activities (create + update)
const LIMIT_BUNDLE_MEMBERS = 200;

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
  const changedFields = Object.keys(rev.delta ?? {}).filter((field) => !SKIP_DELTA.has(field));
  if (changedFields.length === 1 && changedFields[0] === "player_status") return "play_status";
  if (changedFields.length === 1 && changedFields[0] === "game_status") return "release_status";
  return "updated";
}

const fetchCreateActivity = (collection: string, limit: number) =>
  fetchActivity(collection, "create", limit);

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
    };
  }

  const desc = fmtDelta(rev.delta ?? {}, prevData, data, sections);
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
  };
}

// ─── main handler ─────────────────────────────────────────────────────────────

export const GET: APIRoute = async () => {
  // 1. Fetch all revision/activity streams + move log in parallel
  const [
    allGameRevs,
    reviewRevs,
    tierListRevs,
    allBundleMemberRevs,
    tlgActs,
    glinkActs,
  ] = await Promise.all([
    fetchRevisions("games",       -1),
    fetchRevisions("reviews",     LIMIT_REVIEWS),
    fetchRevisions("tier_lists",  LIMIT_TIER_LISTS),
    fetchRevisions("game_bundle_members", -1),
    fetchCreateActivity("tier_list_games", LIMIT_JUNCTIONS),
    fetchActivity("games_links", ["create", "update"], LIMIT_LINKS),
  ]);
  const gameRevs = allGameRevs.slice(0, LIMIT_GAMES);
  const bundleMemberRevs = allBundleMemberRevs.slice(0, LIMIT_BUNDLE_MEMBERS);

  // 2. Resolve IDs needed for batch lookups

  // tier_list_games: fetch the actual records (for additions)
  const tlgItemIds   = tlgActs.map((a) => Number(a.item));
  const glinkItemIds = glinkActs.map((a) => Number(a.item));
  const reviewItemIds = reviewRevs.map((r) => Number(r.item));
  const gameRevisionIds = gameRevs.map((r) => Number(r.item));
  const bundleMemberItemIds = bundleMemberRevs.map((r) => Number(r.item));

  const [tlgItemMap, glinkItemMap, reviewItemMap, bundleMemberItemMap] = await Promise.all([
    fetchItemMap("tier_list_games", tlgItemIds, "id,game_id,tier_list_id,rating"),
    fetchItemMap("games_links",     glinkItemIds, "id,games_id,url,kind"),
    fetchItemMap("reviews", reviewItemIds,
      "id,title,slug,status,rating,published_at,game.id,game.title,game.cover_image.id,game.cover_image.filename_disk"),
    fetchItemMap(
      "game_bundle_members",
      bundleMemberItemIds,
      "id,games_id,title,player_status,section_data_status,section_noun,current_section",
    ),
  ]);

  // Collect game IDs and tier_list IDs from tier additions
  const tierListIdsForAdd = new Set<number>();
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

  // 3. Batch-fetch support data
  const allGameIds = new Set([
    ...gameIdsForTiers,
    ...gameIdsForLinks,
    ...gameIdsForBundleMembers,
    ...gameRevisionIds,
  ]);
  const [
    tierListMap,
    gameMap,
    gameSectionsMap,
    bundleMemberSectionsMap,
    allGameGenreMap,
  ] = await Promise.all([
    fetchItemMap("tier_lists", Array.from(tierListIdsForAdd), "id,title,slug"),
    fetchItemMap("games", Array.from(allGameIds),
      "id,title,slug,cover_image.id,cover_image.filename_disk"),
    fetchGameSectionsByGameIds(Array.from(new Set(gameRevisionIds))),
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

  // Games link additions (download/walkthrough URLs added to games_links)
  for (const act of glinkActs) {
    const glink    = glinkItemMap[Number(act.item)];
    const gameItem = glink ? gameMap[Number(glink.games_id)] : null;
    const entry    = buildGameLinkEntry(act, glink ?? null, gameItem ?? null);
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
