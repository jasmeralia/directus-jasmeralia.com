import { directusFetchRaw, assetsBaseUrl } from "./directus";

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
};

const SKIP_DELTA = new Set([
  "date_updated", "date_created", "sort", "id", "slug", "body", "updated_at",
]);

function hasMeaningfulDelta(delta: Record<string, unknown> | null): boolean {
  if (!delta) return false;
  return Object.keys(delta).some((k) => !SKIP_DELTA.has(k));
}

async function get<T>(path: string): Promise<T> {
  const res = await directusFetchRaw<T>(path);
  return res;
}

export async function fetchRecentUpdates(limit = 10): Promise<UpdateEntry[]> {
  const [gameRevs, reviewRevs, tierActivities, tierMoves, tierListRevs] = await Promise.all([
    get<{ data: any[] }>(
      `/revisions?filter[collection][_eq]=games&sort=-id&limit=40` +
      `&fields=id,item,delta,data,activity.action,activity.timestamp`,
    ),
    get<{ data: any[] }>(
      `/revisions?filter[collection][_eq]=reviews&sort=-id&limit=20` +
      `&fields=id,item,delta,data,activity.action,activity.timestamp`,
    ),
    get<{ data: any[] }>(
      `/activity?filter[collection][_eq]=tier_row_games&filter[action][_eq]=create` +
      `&sort=-timestamp&limit=30&fields=id,item,timestamp`,
    ),
    get<{ data: any[] }>(
      `/items/tier_row_game_moves?sort=-moved_at&limit=20` +
      `&fields=id,moved_at,game_id.title,game_id.slug,to_tier_row_id.tier_list.title,to_tier_row_id.tier_list.slug`,
    ),
    get<{ data: any[] }>(
      `/revisions?filter[collection][_eq]=tier_lists&sort=-id&limit=10` +
      `&fields=id,item,data,activity.action,activity.timestamp`,
    ),
  ]);

  const entries: UpdateEntry[] = [];

  // ── Game revisions ────────────────────────────────────────────────────────
  for (const rev of gameRevs.data ?? []) {
    const ts = rev.activity?.timestamp;
    if (!ts || !rev.data?.title) continue;
    const date = new Date(ts);
    if (isNaN(date.getTime())) continue;
    const slug = rev.data?.slug ?? rev.item;
    if (!slug) continue;
    const isCreate = rev.activity?.action === "create";
    if (!isCreate && !hasMeaningfulDelta(rev.delta)) continue;
    entries.push({
      tag: isCreate ? "added" : "updated",
      subject: rev.data.title,
      link: `${siteBase}/games/${slug}/index.html`,
      timestamp: date,
    });
  }

  // ── Review revisions ──────────────────────────────────────────────────────
  for (const rev of reviewRevs.data ?? []) {
    const ts = rev.activity?.timestamp;
    if (!ts || !rev.data?.title) continue;
    if (rev.data?.status !== "published" && rev.delta?.status !== "published") continue;
    const date = new Date(ts);
    if (isNaN(date.getTime())) continue;
    const slug = rev.data?.slug ?? rev.item;
    if (!slug) continue;
    entries.push({
      tag: "review",
      subject: rev.data.title,
      link: `${siteBase}/reviews/${slug}/index.html`,
      timestamp: date,
    });
  }

  // ── Tier row game additions ───────────────────────────────────────────────
  const activityItems = (tierActivities.data ?? []).map((a: any) => Number(a.item)).filter(Boolean);
  if (activityItems.length) {
    const trgRes = await get<{ data: any[] }>(
      `/items/tier_row_games?filter[id][_in]=${activityItems.join(",")}&limit=${activityItems.length + 5}` +
      `&fields=id,tier_row_id.tier_list.title,tier_row_id.tier_list.slug`,
    );
    const trgMap: Record<number, any> = {};
    for (const trg of trgRes.data ?? []) trgMap[trg.id] = trg;

    for (const act of tierActivities.data ?? []) {
      const ts = act.timestamp;
      if (!ts) continue;
      const date = new Date(ts);
      if (isNaN(date.getTime())) continue;
      const trg = trgMap[Number(act.item)];
      const tierList = trg?.tier_row_id?.tier_list;
      if (!tierList?.slug || !tierList?.title) continue;
      entries.push({
        tag: "tier-updated",
        subject: tierList.title,
        link: `${siteBase}/tiers/${tierList.slug}/index.html`,
        timestamp: date,
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
      subject: rev.data.title,
      link: `${siteBase}/tiers/${rev.data.slug}/index.html`,
      timestamp: date,
    });
  }

  // ── Tier moves ────────────────────────────────────────────────────────────
  for (const move of tierMoves.data ?? []) {
    const ts = move.moved_at;
    if (!ts) continue;
    const date = new Date(ts);
    if (isNaN(date.getTime())) continue;
    const tierList = move.to_tier_row_id?.tier_list;
    if (!tierList?.slug || !tierList?.title) continue;
    entries.push({
      tag: "tier-updated",
      subject: tierList.title,
      link: `${siteBase}/tiers/${tierList.slug}/index.html`,
      timestamp: date,
    });
  }

  return entries
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, limit);
}

export function formatUpdateTimestamp(date: Date): string {
  const tz =
    ((import.meta as any).env?.SITE_TIMEZONE as string | undefined) ||
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
