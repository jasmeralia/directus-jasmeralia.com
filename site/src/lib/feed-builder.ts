import { siteBaseUrl, type DirectusFile } from "./directus";
import { directGameSections, type GameSection } from "./game-sections";
import { isGameNsfw, isTierBoardEntryNsfw, isTierListNsfw } from "./nsfw";
import {
  SKIP_DELTA,
  fetchActivity,
  fetchAllGameGenreLinks,
  fetchGameSectionsByBundleMemberIds,
  fetchGameSectionsByGameIds,
  fetchItemMap,
  fetchRevisions,
  fmtDelta,
  fmtNewGame,
  previousRevisionDataMap,
  type Activity,
  type Revision,
} from "./changelog";
import {
  describeGenreAdded,
  describeLinkEvent,
  describeMemberEvent,
  describeReviewEvent,
  isCreateRevision,
  partitionGameGenres,
} from "./game-events";
import {
  buildRowTimelinesByParent,
  describeSectionRun,
  groupSectionRuns,
  relationId,
  resolveRowParents,
} from "./section-events";
import { describeMusicListEvent, describeMusicTrackRun, groupMusicTrackRuns } from "./music-events";

type DirectusRecord = Record<string, unknown>;

// ─── config ──────────────────────────────────────────────────────────────────

const siteBase = siteBaseUrl();

// How many recent revisions/activities to pull per collection
const LIMIT_GAMES       = 100;
const LIMIT_REVIEWS     = 50;
const LIMIT_TIER_LISTS  = 50;
const LIMIT_JUNCTIONS   = 300; // tier_list_games activities
const LIMIT_LINKS       = 400; // games_links activities (create + update)
const LIMIT_GENRES      = 300;
const LIMIT_BUNDLE_MEMBERS = 200;

// Game-related feed entries (direct game revisions, included-game revisions,
// download/walkthrough links, section-count changes) landing within this
// window of the first entry in a burst are merged into one feed item, so a
// flurry of edits to the same game reads as one Discord notification instead
// of several near-simultaneous ones. The window is anchored to the first
// entry in each burst, not a sliding per-gap window.
const GAME_CONSOLIDATION_WINDOW_MS = 30 * 60 * 1000;

const feedDelta = (delta: Record<string, unknown> | null): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(delta ?? {}).filter(([field]) => !SKIP_DELTA.has(field)),
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
    (field) => !SKIP_DELTA.has(field),
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

export type UpdateTag = "added" | "updated" | "tier-added" | "tier-updated" | "review";

export type SourceEntry = FeedEntry & {
  widget?: { tag: UpdateTag; subject: string };
  gameTitle?: string;
  added?: boolean;
};

type Entry = SourceEntry;

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

  // Keep feed creation limited to explicit create revisions so old games are not re-announced.
  const isCreate = isCreateRevision(rev, false);
  const slug     = requireGuidPart(gameItem?.slug ?? data.slug ?? rev.item, `game revision ${rev.id} slug`);
  const link     = `${siteBase}/games/${slug}/index.html`;
  const imgUrl   = mediaUrl(gameItem?.cover_image ?? data.cover_image) ?? undefined;

  if (isCreate) {
    return {
      title: `Game Added: ${data.title}`,
      gameTitle: String(data.title),
      added: true,
      widget: { tag: "added", subject: String(data.title) },
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
    gameTitle: String(data.title),
    widget: { tag: "updated", subject: String(data.title) },
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
  previousData: Record<string, unknown> | null,
  reviewItem: DirectusRecord | null, // live-fetched with game expanded
): Entry | null {
  const data = rev.data;
  const date = requireDate(rev.activity?.timestamp, `review revision ${rev.id}`);
  if (!data?.title) return null;
  const slug   = requireGuidPart(reviewItem?.slug ?? data.slug ?? rev.item, `review revision ${rev.id} slug`);
  const link   = `${siteBase}/reviews/${slug}/index.html`;
  const reviewGame = reviewItem?.game as DirectusRecord | undefined;
  const imgUrl = mediaUrl(reviewGame?.cover_image) ?? undefined;
  const reviewGameTitle = reviewGame?.title ? String(reviewGame.title) : undefined;
  const event = describeReviewEvent({
    revision: rev,
    previousData,
    includeGame: true,
    gameTitle: reviewGameTitle,
  });
  if (!event) return null;

  if (event.type === "review_published") {
    return {
      title: `${event.title}: ${event.subject}`,
      widget: { tag: "review", subject: String(event.subject) },
      link,
      description: event.body,
      pubDate: date,
      imageUrl: imgUrl,
      guid: rssGuid("review", slug, "published", date, `review revision ${rev.id}`),
      nsfw: isGameNsfw(reviewGame ?? {}),
      completed: false,
    };
  }

  return {
    title: `${event.title}: ${event.subject}`,
    link,
    description: event.body,
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
      widget: { tag: "tier-added", subject: String(data.title) },
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
      widget: { tag: "tier-updated", subject: String(tierList.title) },
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
    widget: { tag: "tier-updated", subject: String(tierList.title) },
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
  revision: Revision | null,
  previousData: Record<string, unknown> | null,
): Entry | null {
  if (!glinkItem || !gameItem) return null;
  const date = requireDate(act.timestamp, `games_link activity ${act.id}`);
  const slug = requireGuidPart(gameItem.slug, `games_link activity ${act.id} game slug`);
  const link = `${siteBase}/games/${slug}/index.html`;
  const imgUrl = mediaUrl(gameItem.cover_image) ?? undefined;
  const kind: string = String(glinkItem.kind ?? "download");
  const event = describeLinkEvent({
    action: act.action,
    link: glinkItem as { url?: string; kind?: string },
    revision,
    previousData,
  });
  if (!event) return null;
  return {
    title: `${event.title}: ${gameItem.title}`,
    gameTitle: String(gameItem.title),
    widget: { tag: "updated", subject: String(gameItem.title) },
    link,
    description: event.body,
    pubDate: date,
    imageUrl: imgUrl,
    guid: rssGuid("game", slug, `link_${act.action}_${kind}_${act.id}`, date, `games_link activity ${act.id}`),
    nsfw: isGameNsfw(gameItem),
    completed: false,
  };
}

// ─── cross-type consolidation ───────────────────────────────────────────────

function mergeGameSession(session: Entry[]): Entry {
  const last = session[session.length - 1];
  const addedEntry = session.find((entry) => entry.added);
  const gameTitle = last.gameTitle ?? "Untitled";
  const title = addedEntry ? `Game Added: ${addedEntry.gameTitle ?? gameTitle}` : `Game Updated: ${gameTitle}`;
  const description = session
    .map((entry) => entry.description)
    .filter((text) => text.trim().length > 0)
    .join("\n\n");
  const imageUrl = session.map((entry) => entry.imageUrl).find(Boolean);
  const addedWidgetEntry = session.find((entry) => entry.widget?.tag === "added");
  const widgetEntry = addedWidgetEntry ?? [...session].reverse().find((entry) => entry.widget);
  const slug = requireGuidPart(last.guid.split(":")[1], "consolidated session slug");
  const anchorMs = session[0].pubDate.getTime();
  return {
    title,
    gameTitle,
    added: Boolean(addedEntry),
    ...(widgetEntry?.widget
      ? { widget: {
        tag: addedWidgetEntry ? "added" : "updated",
        subject: addedWidgetEntry?.widget?.subject ?? widgetEntry.widget.subject,
      } as const }
      : {}),
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
  // Keep feed creation limited to explicit create revisions so old members are not presented as new.
  const isCreate = isCreateRevision(rev, false);
  const isDelete = action === "delete";
  const activityId = rev.activity?.id ?? rev.id;
  const eventKey = isCreate
    ? `member_created_${memberId}_${rev.id}`
    : isDelete
      ? `member_removed_${memberId}_${activityId}`
      : `member_updated_${memberId}_${rev.id}`;
  const actionLabel = isCreate ? "Added" : isDelete ? "Removed" : "Updated";
  const event = describeMemberEvent({
    revision: { ...rev, data },
    previousData,
    sections,
    isCreate,
    isDelete,
  });
  if (!event) return null;
  return {
    title: `Included Game ${actionLabel} - ${title}`,
    gameTitle: title,
    widget: {
      tag: isCreate ? "added" : "updated",
      subject: `${gameItem.title}: ${title}`,
    },
    link: `${siteBase}/games/${gameSlug}/index.html`,
    description: event.body,
    pubDate: date,
    imageUrl: mediaUrl(gameItem.cover_image) ?? undefined,
    guid: rssGuid(
      "game",
      gameSlug,
      eventKey,
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

export async function buildSourceEntries(): Promise<SourceEntry[]> {
  // 1. Fetch all revision/activity streams + move log in parallel
  const [
    allGameRevs,
    reviewRevs,
    tierListRevs,
    allBundleMemberRevs,
    tlgActs,
    glinkActs,
    allSectionRevs,
    allMusicListRevs,
    allMusicTrackRevs,
    allLinkRevs,
    genreActs,
    allGenreLinks,
  ] = await Promise.all([
    fetchRevisions("games",       -1),
    fetchRevisions("reviews",     LIMIT_REVIEWS),
    fetchRevisions("tier_lists",  LIMIT_TIER_LISTS),
    fetchRevisions("game_bundle_members", -1),
    fetchCreateActivity("tier_list_games", LIMIT_JUNCTIONS),
    fetchActivity("games_links", ["create", "update"], LIMIT_LINKS),
    fetchRevisions("game_sections", -1),
    fetchRevisions("games_music_lists", -1),
    fetchRevisions("games_tracks", -1),
    fetchRevisions("games_links", -1),
    fetchCreateActivity("games_genres", LIMIT_GENRES),
    fetchAllGameGenreLinks(),
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
  const musicListIds = new Set<number>([
    ...allMusicListRevs.map((revision) => Number(revision.item)),
    ...allMusicTrackRevs.map((revision) => relationId(revision.data?.games_music_lists_id) ?? -1),
  ].filter((id) => id > 0));
  const genreLinksById = new Map<number, { gameId: number; id: number; name: string }>();
  for (const [gameIdText, links] of Object.entries(allGenreLinks)) {
    for (const genreLink of links) {
      genreLinksById.set(genreLink.id, { gameId: Number(gameIdText), ...genreLink });
    }
  }
  const genrePartitions = new Map<number, ReturnType<typeof partitionGameGenres>>();
  const genrePartitionForGame = (gameId: number) => {
    const cached = genrePartitions.get(gameId);
    if (cached) return cached;
    const gameRevisions = allGameRevs.filter((revision) => Number(revision.item) === gameId);
    const firstRevision = gameRevisions.reduce<Revision | null>(
      (smallest, revision) => !smallest || revision.id < smallest.id ? revision : smallest,
      null,
    );
    const createdAtValue = firstRevision?.activity?.timestamp;
    const activities = genreActs.filter((activity) =>
      genreLinksById.get(Number(activity.item))?.gameId === gameId,
    );
    const partition = partitionGameGenres({
      genreLinks: allGenreLinks[gameId] ?? [],
      activities,
      createdAt: createdAtValue ? asDate(createdAtValue) : null,
    });
    genrePartitions.set(gameId, partition);
    return partition;
  };

  const [tlgItemMap, glinkItemMap, reviewItemMap, bundleMemberItemMap, musicListItemMap] = await Promise.all([
    fetchItemMap("tier_list_games", tlgItemIds, "id,game_id,tier_list_id,rating"),
    fetchItemMap("games_links",     glinkItemIds, "id,games_id,url,kind"),
    fetchItemMap("reviews", reviewItemIds,
      "id,title,slug,status,rating,published_at,game.id,game.title,game.cover_image.id,game.cover_image.filename_disk,game.nsfw,game.genres.genres_id.nsfw"),
    fetchItemMap(
      "game_bundle_members",
      bundleMemberItemIds,
      "id,games_id,title,player_status,section_data_status,section_noun,current_section",
    ),
    fetchItemMap("games_music_lists", Array.from(musicListIds), "id,games_id,title,sort,description,url"),
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
  const gameIdsForGenres = new Set<number>();
  for (const activity of genreActs) {
    const genreLink = genreLinksById.get(Number(activity.item));
    if (genreLink) gameIdsForGenres.add(genreLink.gameId);
  }
  const gameIdsForMusic = new Set<number>();
  for (const revision of allMusicListRevs) {
    const gameId = relationId(musicListItemMap[Number(revision.item)]?.games_id ?? revision.data?.games_id);
    if (gameId) gameIdsForMusic.add(gameId);
  }
  for (const list of Object.values(musicListItemMap)) {
    const gameId = relationId(list.games_id);
    if (gameId) gameIdsForMusic.add(gameId);
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
    ...gameIdsForGenres,
    ...gameIdsForMusic,
    ...gameIdsForBundleMembers,
    ...gameRevisionIds,
    ...sectionGameIds,
  ]);
  const [
    tierListMap,
    gameMap,
    gameSectionsMap,
    bundleMemberSectionsMap,
  ] = await Promise.all([
    fetchItemMap("tier_lists", Array.from(tierListIdsForAdd), "id,title,slug,nsfw"),
    fetchItemMap("games", Array.from(allGameIds),
      "id,title,slug,cover_image.id,cover_image.filename_disk,nsfw,genres.genres_id.nsfw,section_style,section_noun"),
    fetchGameSectionsByGameIds(Array.from(new Set([...gameRevisionIds, ...sectionGameIds]))),
    fetchGameSectionsByBundleMemberIds(Array.from(new Set(bundleMemberItemIds))),
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
    newGameIds.map((id) => [id, genrePartitionForGame(id).initial]),
  );
  const bundleMemberPrevMap = previousRevisionDataMap(
    allBundleMemberRevs,
    updateBundleMemberRevs,
  );
  // Previous review snapshots come from the fetched window, so the oldest
  // review revision in it has none and shows only the new value.
  const reviewPrevMap = previousRevisionDataMap(reviewRevs, reviewRevs);
  const linkRevisionByActivity = new Map(
    allLinkRevs.filter((revision) => revision.activity?.id !== undefined)
      .map((revision) => [revision.activity!.id!, revision]),
  );
  const activityLinkRevisions = glinkActs
    .map((activity) => linkRevisionByActivity.get(activity.id))
    .filter((revision): revision is Revision => Boolean(revision));
  const linkPrevMap = previousRevisionDataMap(allLinkRevs, activityLinkRevisions);
  const musicListPrevMap = previousRevisionDataMap(allMusicListRevs, allMusicListRevs);
  const musicListGames = new Map<number, number>();
  const musicListTitles = new Map<number, string>();
  for (const revision of allMusicListRevs) {
    const listId = Number(revision.item);
    const gameId = relationId(musicListItemMap[listId]?.games_id ?? revision.data?.games_id);
    if (listId && gameId && !musicListGames.has(listId)) musicListGames.set(listId, gameId);
    if (listId && typeof revision.data?.title === "string" && !musicListTitles.has(listId)) {
      musicListTitles.set(listId, revision.data.title);
    }
  }
  for (const [listIdText, list] of Object.entries(musicListItemMap)) {
    const gameId = relationId(list.games_id);
    if (gameId) musicListGames.set(Number(listIdText), gameId);
    if (typeof list.title === "string") musicListTitles.set(Number(listIdText), list.title);
  }

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
    if (!metaRecord) continue;
    const gameItem = run.parent.kind === "game"
      ? gameMap[run.parent.id] ?? null
      : gameMap[relationId(metaRecord?.games_id) ?? -1] ?? null;
    if (!gameItem) continue;
    const described = describeSectionRun(run, {
      liveRows,
      timelinesByParent: sectionTimelinesByParent,
      style: run.parent.kind === "game" ? metaRecord.section_style as string | null : "linear",
      noun: metaRecord.section_noun as string | null | undefined,
    });
    if (!described) continue;
    const date = requireDate(described.at, `game_sections run ${run.key}`);
    const slug = requireGuidPart(gameItem.slug, `game_sections run ${run.key} slug`);
    const title = String(metaRecord.title ?? gameItem.title ?? "Untitled");
    entries.push({
      title: `${described.event.title}: ${title}`,
      gameTitle: title,
      widget: { tag: "updated", subject: title },
      link: `${siteBase}/games/${slug}/index.html`,
      description: described.event.body,
      pubDate: date,
      imageUrl: mediaUrl(gameItem.cover_image) ?? undefined,
      guid: rssGuid("game", slug, `sections_${run.key}`, date, `game_sections run ${run.key}`),
      nsfw: isGameNsfw(gameItem),
      completed: false,
    });
  }

  // Reviews
  for (const rev of reviewRevs) {
    const liveItem = reviewItemMap[Number(rev.item)] ?? null;
    const entry    = buildReviewEntry(rev, reviewPrevMap[rev.id], liveItem);
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
    const revision = linkRevisionByActivity.get(act.id) ?? null;
    const entry    = buildGameLinkEntry(
      act,
      glink ?? null,
      gameItem ?? null,
      revision,
      revision ? linkPrevMap[revision.id] ?? null : null,
    );
    if (entry) entries.push(entry);
  }

  // Music list and track changes are feed-only. Track text and adult scene
  // metadata never enter the event body; only per-run counts are exposed.
  for (const revision of allMusicListRevs) {
    const listId = Number(revision.item);
    const gameId = musicListGames.get(listId);
    const gameItem = gameId ? gameMap[gameId] : null;
    if (!gameItem) continue;
    const event = describeMusicListEvent({ revision, previousData: musicListPrevMap[revision.id] ?? null });
    if (!event) continue;
    const date = requireDate(revision.activity?.timestamp, `games_music_lists revision ${revision.id}`);
    const slug = requireGuidPart(gameItem.slug, `games_music_lists revision ${revision.id} game slug`);
    entries.push({
      title: `${event.title}: ${gameItem.title} - ${event.subject}`,
      gameTitle: String(gameItem.title ?? "Untitled"),
      link: `${siteBase}/games/${slug}/index.html`,
      description: event.body,
      pubDate: date,
      imageUrl: mediaUrl(gameItem.cover_image) ?? undefined,
      guid: rssGuid("game", slug, `music_list_${revision.id}`, date, `games_music_lists revision ${revision.id}`),
      nsfw: isGameNsfw(gameItem),
      completed: false,
    });
  }
  const musicTrackRuns = groupMusicTrackRuns(allMusicTrackRevs);
  for (const run of musicTrackRuns) {
    const gameId = musicListGames.get(run.listId);
    const gameItem = gameId ? gameMap[gameId] : null;
    const list = musicListItemMap[run.listId];
    const listName = String(list?.title ?? musicListTitles.get(run.listId) ?? "Untitled");
    if (!gameItem) continue;
    const described = describeMusicTrackRun(run, listName);
    if (!described) continue;
    const date = requireDate(described.at, `games_tracks run ${run.key}`);
    const slug = requireGuidPart(gameItem.slug, `games_tracks run ${run.key} game slug`);
    entries.push({
      title: `${described.event.title}: ${gameItem.title} - ${listName}`,
      gameTitle: String(gameItem.title ?? "Untitled"),
      link: `${siteBase}/games/${slug}/index.html`,
      description: described.event.body,
      pubDate: date,
      imageUrl: mediaUrl(gameItem.cover_image) ?? undefined,
      guid: rssGuid("game", slug, `music_tracks_${gameId}_${run.listId}_${run.key.split("_").at(-1)}`, date, `games_tracks run ${run.key}`),
      nsfw: isGameNsfw(gameItem),
      completed: false,
    });
  }

  // Genre additions are derived from junction-row create activities and the
  // current games_genres rows, since Directus stores no revision data there.
  for (const activity of genreActs) {
    const genreLink = genreLinksById.get(Number(activity.item));
    if (!genreLink) continue;
    const gameItem = gameMap[genreLink.gameId];
    if (!gameItem) continue;
    const partition = genrePartitionForGame(genreLink.gameId);
    const added = partition.added.find((genre) => genre.activityId === activity.id);
    if (!added) continue;
    const date = requireDate(activity.timestamp, `games_genres activity ${activity.id}`);
    const slug = requireGuidPart(gameItem.slug, `games_genres activity ${activity.id} game slug`);
    const event = describeGenreAdded(added.name);
    entries.push({
      title: `${event.title}: ${gameItem.title}`,
      gameTitle: String(gameItem.title),
      widget: { tag: "updated", subject: String(gameItem.title) },
      link: `${siteBase}/games/${slug}/index.html`,
      description: event.body,
      pubDate: date,
      imageUrl: mediaUrl(gameItem.cover_image) ?? undefined,
      guid: rssGuid("game", slug, `genre_added_${activity.id}`, date, `games_genres activity ${activity.id}`),
      nsfw: isGameNsfw(gameItem),
      completed: false,
    });
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

export async function buildFeedEntries(): Promise<FeedEntry[]> {
  const entries = await buildSourceEntries();
  return entries.map(({ title, link, description, pubDate, imageUrl, guid, nsfw, completed }) => ({
    title,
    link,
    description,
    pubDate,
    ...(imageUrl ? { imageUrl } : {}),
    guid,
    nsfw,
    completed,
  }));
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
