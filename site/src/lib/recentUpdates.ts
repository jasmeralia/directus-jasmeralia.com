import { directusFetchRaw, assetsBaseUrl } from "./directus";
import { isGameNsfw, isTierListNsfw } from "./nsfw";

const siteBase = (assetsBaseUrl() || "https://jasmeralia.com").replace(/\/$/, "");

export type UpdateTag =
  | "added"
  | "updated"
  | "tier-added"
  | "tier-updated"
  | "review";

export type UpdateEntry = {
  tag: UpdateTag;
  subject: string;
  link: string;
  timestamp: Date;
  nsfw: boolean;
};

const SKIP_DELTA = new Set([
  "date_updated", "date_created", "sort", "id", "slug", "body", "updated_at",
  "engines",
]);

function hasMeaningfulDelta(delta: Record<string, unknown> | null): boolean {
  if (!delta) return false;
  return Object.keys(delta).some((k) => !SKIP_DELTA.has(k));
}

async function get<T>(path: string): Promise<T> {
  const res = await directusFetchRaw<T>(path);
  return res;
}

type RevisionRow = {
  item: string;
  data: Record<string, unknown> | null;
  delta: Record<string, unknown> | null;
  activity: { action: string; timestamp: string } | null;
};

type ActivityRow = {
  item: string;
  timestamp: string;
};

type GameSlugRow = {
  id: number;
  slug: string;
  nsfw?: boolean | null;
  genres?: { genres_id?: { nsfw?: boolean | null } | null }[] | null;
};

type TierListGameRow = {
  id: number;
  tier_list_id: { title: string; slug: string; nsfw?: boolean | null } | null;
};

type BundleMemberRow = {
  id: number;
  title: string;
  games_id: GameSlugRow & { title: string } | null;
};

type ReviewRow = {
  id: number;
  game: Omit<GameSlugRow, "slug"> | null;
};

type TierListRow = {
  id: number;
  nsfw?: boolean | null;
};

export async function fetchRecentUpdates(limit = 10): Promise<UpdateEntry[]> {
  const [
    gameRevs,
    reviewRevs,
    bundleMemberRevs,
    tierActivities,
    tierListRevs,
  ] = await Promise.all([
    get<{ data: RevisionRow[] }>(
      `/revisions?filter[collection][_eq]=games&sort=-id&limit=100` +
      `&fields=id,item,delta,data,activity.action,activity.timestamp`,
    ),
    get<{ data: RevisionRow[] }>(
      `/revisions?filter[collection][_eq]=reviews&sort=-id&limit=20` +
      `&fields=id,item,delta,data,activity.action,activity.timestamp`,
    ),
    get<{ data: RevisionRow[] }>(
      `/revisions?filter[collection][_eq]=game_bundle_members&sort=-id&limit=50` +
      `&fields=id,item,delta,data,activity.action,activity.timestamp`,
    ),
    get<{ data: ActivityRow[] }>(
      `/activity?filter[collection][_eq]=tier_list_games&filter[action][_eq]=create` +
      `&sort=-timestamp&limit=30&fields=id,item,timestamp`,
    ),
    get<{ data: RevisionRow[] }>(
      `/revisions?filter[collection][_eq]=tier_lists&sort=-id&limit=10` +
      `&fields=id,item,data,activity.action,activity.timestamp`,
    ),
  ]);

  // Fetch live slugs so a renamed slug doesn't produce a stale link
  const gameRevIds = (gameRevs.data ?? []).map((r) => Number(r.item)).filter(Boolean);
  const liveGameMap: Record<number, GameSlugRow> = {};
  if (gameRevIds.length) {
    const liveGames = await get<{ data: GameSlugRow[] }>(
      `/items/games?filter[id][_in]=${gameRevIds.join(",")}` +
      `&fields=id,slug,nsfw,genres.genres_id.nsfw&limit=${gameRevIds.length + 5}`,
    );
    for (const game of liveGames.data ?? []) liveGameMap[Number(game.id)] = game;
  }

  const reviewIds = (reviewRevs.data ?? []).map((revision) => Number(revision.item)).filter(Boolean);
  const reviewMap = new Map<number, ReviewRow>();
  if (reviewIds.length) {
    const reviews = await get<{ data: ReviewRow[] }>(
      `/items/reviews?filter[id][_in]=${reviewIds.join(",")}` +
      `&fields=id,game.id,game.nsfw,game.genres.genres_id.nsfw&limit=${reviewIds.length + 5}`,
    );
    for (const review of reviews.data ?? []) reviewMap.set(review.id, review);
  }

  const tierListRevisionIds = (tierListRevs.data ?? [])
    .map((revision) => Number(revision.item))
    .filter(Boolean);
  const tierListMap = new Map<number, TierListRow>();
  if (tierListRevisionIds.length) {
    const tierLists = await get<{ data: TierListRow[] }>(
      `/items/tier_lists?filter[id][_in]=${tierListRevisionIds.join(",")}` +
      `&fields=id,nsfw&limit=${tierListRevisionIds.length + 5}`,
    );
    for (const tierList of tierLists.data ?? []) tierListMap.set(tierList.id, tierList);
  }

  const entries: UpdateEntry[] = [];

  // ── Game revisions ────────────────────────────────────────────────────────
  for (const rev of gameRevs.data ?? []) {
    const ts = rev.activity?.timestamp;
    if (!ts || !rev.data?.title) continue;
    const date = new Date(ts);
    if (isNaN(date.getTime())) continue;
    const liveGame = liveGameMap[Number(rev.item)];
    const slug = String(liveGame?.slug ?? rev.data?.slug ?? rev.item);
    if (!slug) continue;
    const isCreate = rev.activity?.action === "create";
    if (!isCreate && !hasMeaningfulDelta(rev.delta)) continue;
    entries.push({
      tag: isCreate ? "added" : "updated",
      subject: String(rev.data.title),
      link: `${siteBase}/games/${slug}/index.html`,
      timestamp: date,
      nsfw: isGameNsfw(liveGame ?? {}),
    });
  }

  // Included-game revisions
  const bundleMemberIds = (bundleMemberRevs.data ?? [])
    .map((revision) => Number(revision.item))
    .filter(Boolean);
  if (bundleMemberIds.length) {
    const members = await get<{ data: BundleMemberRow[] }>(
      `/items/game_bundle_members?filter[id][_in]=${bundleMemberIds.join(",")}` +
      `&fields=id,title,games_id.id,games_id.title,games_id.slug,games_id.nsfw,` +
      `games_id.genres.genres_id.nsfw&limit=${bundleMemberIds.length + 5}`,
    );
    const memberMap = new Map(
      (members.data ?? []).map((member) => [member.id, member]),
    );
    for (const revision of bundleMemberRevs.data ?? []) {
      const timestamp = revision.activity?.timestamp;
      const member = memberMap.get(Number(revision.item));
      const parent = member?.games_id;
      if (!timestamp || !member?.title || !parent?.slug || !parent?.title) continue;
      const date = new Date(timestamp);
      if (Number.isNaN(date.getTime())) continue;
      const isCreate = revision.activity?.action === "create";
      if (!isCreate && !hasMeaningfulDelta(revision.delta)) continue;
      entries.push({
        tag: isCreate ? "added" : "updated",
        subject: `${parent.title}: ${member.title}`,
        link: `${siteBase}/games/${parent.slug}/index.html`,
        timestamp: date,
        nsfw: isGameNsfw(parent),
      });
    }
  }

  // ── Review revisions ──────────────────────────────────────────────────────
  for (const rev of reviewRevs.data ?? []) {
    const ts = rev.activity?.timestamp;
    if (!ts || !rev.data?.title) continue;
    if (rev.data?.status !== "published" && rev.delta?.status !== "published") continue;
    const date = new Date(ts);
    if (isNaN(date.getTime())) continue;
    const slug = String(rev.data?.slug ?? rev.item);
    if (!slug) continue;
    entries.push({
      tag: "review",
      subject: String(rev.data.title),
      link: `${siteBase}/reviews/${slug}/index.html`,
      timestamp: date,
      nsfw: isGameNsfw(reviewMap.get(Number(rev.item))?.game ?? {}),
    });
  }

  // ── Tier list game additions ──────────────────────────────────────────────
  const activityItems = (tierActivities.data ?? []).map((a) => Number(a.item)).filter(Boolean);
  if (activityItems.length) {
    const tlgRes = await get<{ data: TierListGameRow[] }>(
      `/items/tier_list_games?filter[id][_in]=${activityItems.join(",")}&limit=${activityItems.length + 5}` +
      `&fields=id,tier_list_id.title,tier_list_id.slug,tier_list_id.nsfw`,
    );
    const tlgMap: Record<number, TierListGameRow> = {};
    for (const tlg of tlgRes.data ?? []) tlgMap[tlg.id] = tlg;

    for (const act of tierActivities.data ?? []) {
      const ts = act.timestamp;
      if (!ts) continue;
      const date = new Date(ts);
      if (isNaN(date.getTime())) continue;
      const tlg = tlgMap[Number(act.item)];
      const tierList = tlg?.tier_list_id;
      if (!tierList?.slug || !tierList?.title) continue;
      entries.push({
        tag: "tier-updated",
        subject: tierList.title,
        link: `${siteBase}/tiers/${tierList.slug}/index.html`,
        timestamp: date,
        nsfw: isTierListNsfw(tierList),
      });
    }
  }

  // ── Tier list creations ───────────────────────────────────────────────────
  for (const rev of tierListRevs.data ?? []) {
    if (rev.activity?.action !== "create") continue;
    const ts = rev.activity?.timestamp;
    if (!ts || !rev.data?.title || !rev.data?.slug) continue;
    const date = new Date(ts);
    if (isNaN(date.getTime())) continue;
    entries.push({
      tag: "tier-added",
      subject: String(rev.data.title),
      link: `${siteBase}/tiers/${String(rev.data.slug)}/index.html`,
      timestamp: date,
      nsfw: isTierListNsfw(tierListMap.get(Number(rev.item)) ?? {}),
    });
  }

  return entries
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, limit);
}

export function formatUpdateTimestamp(date: Date): string {
  const tz =
    (import.meta.env.SITE_TIMEZONE as string | undefined) ||
    "America/Los_Angeles";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
    timeZoneName: "short",
  });
}
