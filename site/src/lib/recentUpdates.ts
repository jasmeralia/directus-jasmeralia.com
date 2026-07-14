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
};

type TierListGameRow = {
  id: number;
  tier_list_id: { title: string; slug: string } | null;
};

export async function fetchRecentUpdates(limit = 10): Promise<UpdateEntry[]> {
  const [gameRevs, reviewRevs, tierActivities, tierListRevs] = await Promise.all([
    get<{ data: RevisionRow[] }>(
      `/revisions?filter[collection][_eq]=games&sort=-id&limit=100` +
      `&fields=id,item,delta,data,activity.action,activity.timestamp`,
    ),
    get<{ data: RevisionRow[] }>(
      `/revisions?filter[collection][_eq]=reviews&sort=-id&limit=20` +
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
  const liveSlugMap: Record<number, string> = {};
  if (gameRevIds.length) {
    const liveGames = await get<{ data: GameSlugRow[] }>(
      `/items/games?filter[id][_in]=${gameRevIds.join(",")}&fields=id,slug&limit=${gameRevIds.length + 5}`,
    );
    for (const g of liveGames.data ?? []) liveSlugMap[Number(g.id)] = g.slug;
  }

  const entries: UpdateEntry[] = [];

  // ── Game revisions ────────────────────────────────────────────────────────
  for (const rev of gameRevs.data ?? []) {
    const ts = rev.activity?.timestamp;
    if (!ts || !rev.data?.title) continue;
    const date = new Date(ts);
    if (isNaN(date.getTime())) continue;
    const slug = String(liveSlugMap[Number(rev.item)] ?? rev.data?.slug ?? rev.item);
    if (!slug) continue;
    const isCreate = rev.activity?.action === "create";
    if (!isCreate && !hasMeaningfulDelta(rev.delta)) continue;
    entries.push({
      tag: isCreate ? "added" : "updated",
      subject: String(rev.data.title),
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
    const slug = String(rev.data?.slug ?? rev.item);
    if (!slug) continue;
    entries.push({
      tag: "review",
      subject: String(rev.data.title),
      link: `${siteBase}/reviews/${slug}/index.html`,
      timestamp: date,
    });
  }

  // ── Tier list game additions ──────────────────────────────────────────────
  const activityItems = (tierActivities.data ?? []).map((a) => Number(a.item)).filter(Boolean);
  if (activityItems.length) {
    const tlgRes = await get<{ data: TierListGameRow[] }>(
      `/items/tier_list_games?filter[id][_in]=${activityItems.join(",")}&limit=${activityItems.length + 5}` +
      `&fields=id,tier_list_id.title,tier_list_id.slug`,
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
