import { directusFetchRaw, assetsBaseUrl } from "./directus";
import { isGameNsfw, isTierListNsfw } from "./nsfw";

const siteBase = (assetsBaseUrl() || "https://jasmeralia.com").replace(/\/$/, "");

// See collapseBursts() usage below: collapses a burst of same-item edits
// (e.g. a tier-list-game addition spree, or several quick edits to one game
// record) into one widget entry, matching the RSS feed's
// GAME_CONSOLIDATION_WINDOW_MS in feed-builder.ts.
const UPDATE_BURST_WINDOW_MS = 30 * 60 * 1000;

// Groups candidates by `key`, then within each group collapses runs of
// entries landing within `windowMs` of the first entry in the run into a
// single representative (the last, i.e. newest, entry of that run) - an
// anchored sliding window, not a rolling one, so a long steady trickle of
// edits still gets split into multiple bursts rather than merging into one.
function collapseBursts<T extends { key: string; date: Date }>(
  candidates: T[],
  windowMs: number,
): T[] {
  const byKey = new Map<string, T[]>();
  for (const candidate of candidates) {
    const group = byKey.get(candidate.key) ?? [];
    group.push(candidate);
    byKey.set(candidate.key, group);
  }

  const collapsed: T[] = [];
  for (const group of byKey.values()) {
    group.sort((a, b) => a.date.getTime() - b.date.getTime());
    let session: T[] = [];
    let anchor = 0;
    const flush = () => {
      if (!session.length) return;
      collapsed.push(session[session.length - 1]);
      session = [];
    };
    for (const candidate of group) {
      if (session.length && candidate.date.getTime() - anchor > windowMs) {
        flush();
      }
      if (!session.length) anchor = candidate.date.getTime();
      session.push(candidate);
    }
    flush();
  }
  return collapsed;
}

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
  "engines", "version_orion", "version_typhoon", "version_gsl",
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
  // Several quick successive edits to the same game (e.g. setting section
  // data, then player_status, then current_section a minute later) each
  // produce their own revision row. Without collapsing, that floods the
  // widget with near-duplicate "Updated" entries for one game - so "updated"
  // candidates are batched below and run through collapseBursts() per game;
  // "added" (create) entries are pushed immediately since a game is only
  // ever created once.
  type GameUpdateCandidate = {
    key: string;
    date: Date;
    subject: string;
    link: string;
    nsfw: boolean;
  };
  const gameUpdateCandidates: GameUpdateCandidate[] = [];
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
    const candidate: GameUpdateCandidate = {
      key: String(rev.item),
      date,
      subject: String(rev.data.title),
      link: `${siteBase}/games/${slug}/index.html`,
      nsfw: isGameNsfw(liveGame ?? {}),
    };
    if (isCreate) {
      entries.push({
        tag: "added",
        subject: candidate.subject,
        link: candidate.link,
        timestamp: candidate.date,
        nsfw: candidate.nsfw,
      });
    } else {
      gameUpdateCandidates.push(candidate);
    }
  }
  for (const candidate of collapseBursts(gameUpdateCandidates, UPDATE_BURST_WINDOW_MS)) {
    entries.push({
      tag: "updated",
      subject: candidate.subject,
      link: candidate.link,
      timestamp: candidate.date,
      nsfw: candidate.nsfw,
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
    const bundleMemberUpdateCandidates: GameUpdateCandidate[] = [];
    for (const revision of bundleMemberRevs.data ?? []) {
      const timestamp = revision.activity?.timestamp;
      const member = memberMap.get(Number(revision.item));
      const parent = member?.games_id;
      if (!timestamp || !member?.title || !parent?.slug || !parent?.title) continue;
      const date = new Date(timestamp);
      if (Number.isNaN(date.getTime())) continue;
      const isCreate = revision.activity?.action === "create";
      if (!isCreate && !hasMeaningfulDelta(revision.delta)) continue;
      const candidate: GameUpdateCandidate = {
        key: String(revision.item),
        date,
        subject: `${parent.title}: ${member.title}`,
        link: `${siteBase}/games/${parent.slug}/index.html`,
        nsfw: isGameNsfw(parent),
      };
      if (isCreate) {
        entries.push({
          tag: "added",
          subject: candidate.subject,
          link: candidate.link,
          timestamp: candidate.date,
          nsfw: candidate.nsfw,
        });
      } else {
        bundleMemberUpdateCandidates.push(candidate);
      }
    }
    for (const candidate of collapseBursts(bundleMemberUpdateCandidates, UPDATE_BURST_WINDOW_MS)) {
      entries.push({
        tag: "updated",
        subject: candidate.subject,
        link: candidate.link,
        timestamp: candidate.date,
        nsfw: candidate.nsfw,
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

    type TierUpdateCandidate = {
      tierList: NonNullable<TierListGameRow["tier_list_id"]>;
      date: Date;
    };
    const tierCandidates: TierUpdateCandidate[] = [];
    for (const act of tierActivities.data ?? []) {
      const ts = act.timestamp;
      if (!ts) continue;
      const date = new Date(ts);
      if (isNaN(date.getTime())) continue;
      const tlg = tlgMap[Number(act.item)];
      const tierList = tlg?.tier_list_id;
      if (!tierList?.slug || !tierList?.title) continue;
      tierCandidates.push({ tierList, date });
    }

    // A burst of tier-list additions (e.g. rating a dozen games in one sitting)
    // otherwise floods the widget with one row per row created. Collapse
    // same-tier-list additions landing within UPDATE_BURST_WINDOW_MS of the
    // first entry in a burst into a single entry, mirroring
    // feed-builder.ts's GAME_CONSOLIDATION_WINDOW_MS anchor pattern. This
    // predates collapseBursts() above and isn't rewritten to use it directly
    // since it also ORs nsfw across the whole session, not just the last
    // entry - a different reduction than the generic helper does.
    const byTierList = new Map<string, TierUpdateCandidate[]>();
    for (const candidate of tierCandidates) {
      const group = byTierList.get(candidate.tierList.slug) ?? [];
      group.push(candidate);
      byTierList.set(candidate.tierList.slug, group);
    }
    for (const group of byTierList.values()) {
      group.sort((a, b) => a.date.getTime() - b.date.getTime());
      let session: TierUpdateCandidate[] = [];
      let anchor = 0;
      const flush = () => {
        if (!session.length) return;
        const last = session[session.length - 1];
        entries.push({
          tag: "tier-updated",
          subject: last.tierList.title,
          link: `${siteBase}/tiers/${last.tierList.slug}/index.html`,
          timestamp: last.date,
          nsfw: session.some((c) => isTierListNsfw(c.tierList)),
        });
        session = [];
      };
      for (const candidate of group) {
        if (session.length && candidate.date.getTime() - anchor > UPDATE_BURST_WINDOW_MS) {
          flush();
        }
        if (!session.length) anchor = candidate.date.getTime();
        session.push(candidate);
      }
      flush();
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
