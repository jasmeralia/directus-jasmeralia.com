import { getUrlPlatform, primaryDownloadLink, type GameLink } from "./download-link";
import { recordDirectusFetch } from "./build-metrics";
import type { GameBundleMember } from "./game-bundles";
import type { GameSection } from "./game-sections";

export type DirectusFile = {
  id: string;
  filename_download?: string;
  filename_disk?: string | null;
  title?: string;
};

export type Game = {
  id: number;
  title: string;
  slug: string;
  cover_image?: DirectusFile | string | null;
  links?: GameLink[] | null;
  player_status?: string | null;
  family_sharing?: boolean | null;
  sections?: GameSection[] | null;
  bundle_members?: GameBundleMember[] | null;
};

export function isFamilySharingDisabled(game: { family_sharing?: boolean | null; links?: GameLink[] | null }): boolean {
  const dl = primaryDownloadLink(game.links);
  return game.family_sharing === false && getUrlPlatform(dl?.url) === "steam";
}

export type { GameLink };

export const TIER_RATING_CONFIG: Record<string, { color: string; displayLabel: string; sort: number }> = {
  S: { color: "#FFD700", displayLabel: "S",         sort: 0 },
  A: { color: "#4CAF50", displayLabel: "A",         sort: 1 },
  B: { color: "#2196F3", displayLabel: "B",         sort: 2 },
  C: { color: "#FFC107", displayLabel: "C",         sort: 3 },
  D: { color: "#FF9800", displayLabel: "D",         sort: 4 },
  F: { color: "#F44336", displayLabel: "F",         sort: 5 },
  U: { color: "#FFFFFF", displayLabel: "Too Early", sort: 6 },
};

export type TierListGame = {
  id: number;
  rating: string;
  game_id: {
    id: number;
    title: string;
    slug: string;
    player_status?: string | null;
    release_year?: number | null;
    links?: GameLink[] | null;
    cover_image?: { id: string; filename_disk: string } | null;
  };
};

export type TierList = {
  id: number;
  title: string;
  slug: string;
  description?: string | null;
  status: "draft" | "published";
  tier_list_games: TierListGame[];
};

function mustEnv(name: string): string {
  const v = import.meta.env[name] ?? process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return String(v);
}

export function directusBaseUrl(): string {
  // Example: http://truenas.local:8055
  return mustEnv("DIRECTUS_URL").replace(/\/$/, "");
}

export function directusToken(): string | null {
  return (import.meta.env.DIRECTUS_TOKEN ??
    process.env.DIRECTUS_TOKEN ??
    import.meta.env.DIRECTUS_STATIC_TOKEN ??
    process.env.DIRECTUS_STATIC_TOKEN ??
    null) as string | null;
}

export function assetsBaseUrl(): string {
  // If you configured Directus ASSETS_URL to CloudFront, you can set ASSETS_BASE_URL the same.
  // Example: https://d123.cloudfront.net
  return (import.meta.env.ASSETS_BASE_URL ??
    process.env.ASSETS_BASE_URL ??
    import.meta.env.ASSETS_URL ??
    process.env.ASSETS_URL ??
    "").toString().replace(/\/$/, "");
}

// The site's own public origin. In practice this is the same CloudFront
// distribution that serves /media/*, so it shares a value with assetsBaseUrl().
export function siteBaseUrl(): string {
  return (assetsBaseUrl() || "https://jasmeralia.com").replace(/\/$/, "");
}

export function fileUrl(file: unknown): string | null {
  if (!file) return null;
  const base = assetsBaseUrl();

  // Directus may return a file as an id string or an object (id, filename_disk, ...).
  const id = typeof file === "string" ? file : (file as DirectusFile).id;
  const filenameDisk = typeof file === "string" ? null : ((file as DirectusFile).filename_disk ?? null);
  if (!id) return null;

  // Public CloudFront/S3 URLs served under /media/<filename_disk>.
  if (!base) return null;
  // If we don't have filename_disk, fall back to /media/<id> (only works if keys are ids).
  return `${base}/media/${filenameDisk || id}`;
}

export async function directusFetchRaw<T = Record<string, unknown>>(path: string): Promise<T> {
  return directusFetch<T>(path);
}

async function directusFetch<T>(path: string): Promise<T> {
  const url = `${directusBaseUrl()}${path}`;
  const token = directusToken();
  const headers: Record<string, string> = { "Accept": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const started = Date.now();
  try {
    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Directus request failed (${resp.status}) ${url}: ${text}`);
    }
    return await resp.json() as T;
  } finally {
    recordDirectusFetch(path, Date.now() - started);
  }
}

function appendParams(target: URLSearchParams, prefix: string, value: unknown) {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    target.set(prefix, value.join(","));
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      appendParams(target, `${prefix}[${key}]`, child);
    }
    return;
  }
  target.set(prefix, String(value));
}

type FetchItemsParams = {
  fields?: string[];
  sort?: string[];
  filter?: Record<string, unknown>;
  deep?: Record<string, unknown>;
  limit?: number;
};

// Directus caps a nested one-to-many relation at 100 rows unless a `deep`
// `_limit` override is supplied for it. Every `games` query requesting
// `sections.*` fields needs that override -- a quest-style game can easily
// exceed 100 rows (e.g. 269 for a single AVN's quest journal), silently
// truncating the fetched list otherwise. Centralized here instead of in
// each of the ~40 call sites that request `sections.*` via
// `GAME_THUMB_FIELDS`/`GAME_FIELDS`, so every one of them is covered
// automatically rather than requiring each page to remember it.
function gamesSectionsDeepDefaults(
  fields: string[] | undefined,
  explicitDeep: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const deep = { ...(explicitDeep ?? {}) };
  if (!fields) return deep;
  if (
    !("sections" in deep) &&
    fields.some((field) => field === "sections" || field.startsWith("sections."))
  ) {
    deep.sections = { _limit: -1 };
  }
  if (
    !("bundle_members" in deep) &&
    fields.some((field) => field.startsWith("bundle_members.sections."))
  ) {
    deep.bundle_members = { sections: { _limit: -1 } };
  }
  return deep;
}

export async function directusFetchItems<T = Record<string, unknown>>(collection: string, params: FetchItemsParams = {}): Promise<T[]> {
  const qs = new URLSearchParams();
  if (params.fields?.length) qs.set("fields", params.fields.join(","));
  if (params.sort?.length) qs.set("sort", params.sort.join(","));
  if (typeof params.limit === "number") qs.set("limit", String(params.limit));
  if (params.filter) appendParams(qs, "filter", params.filter);
  const deep = collection === "games"
    ? gamesSectionsDeepDefaults(params.fields, params.deep)
    : params.deep;
  if (deep && Object.keys(deep).length) appendParams(qs, "deep", deep);

  const suffix = qs.toString();
  const path = suffix ? `/items/${collection}?${suffix}` : `/items/${collection}`;
  const data = await directusFetch<{ data: T[] }>(path);
  return data.data ?? [];
}

export async function listPublishedTierListSlugs(): Promise<string[]> {
  // Get all published tier_lists slugs for static generation
  const qs = new URLSearchParams({
    "fields": "slug",
    "filter[status][_eq]": "published",
    "limit": "-1",
  });
  const data = await directusFetch<{ data: { slug: string }[] }>(`/items/tier_lists?${qs.toString()}`);
  return data.data.map(x => x.slug).filter(Boolean);
}

export async function getPublishedTierListBySlug(slug: string): Promise<TierList | null> {
  const qs = new URLSearchParams({
    "filter[slug][_eq]": slug,
    "filter[status][_eq]": "published",
    "fields": "id,title,slug,description,status",
    "limit": "1",
  });

  const res = await directusFetch<{ data: TierList[] }>(`/items/tier_lists?${qs.toString()}`);
  const item = res.data?.[0];
  if (!item) return null;

  const games = await directusFetchItems<TierListGame>("tier_list_games", {
    fields: [
      "id", "rating",
      "game_id.id", "game_id.title", "game_id.slug", "game_id.player_status", "game_id.release_year",
      "game_id.links.id", "game_id.links.url", "game_id.links.kind", "game_id.links.sort",
      "game_id.cover_image.id", "game_id.cover_image.filename_disk",
    ],
    filter: { tier_list_id: { _eq: item.id } },
    limit: -1,
  });

  item.tier_list_games = games ?? [];
  return item;
}

export async function getSTierGameIds(gameIds: number[]): Promise<Set<number>> {
  const ids = new Set(gameIds.filter((id) => typeof id === "number"));
  if (!ids.size) return new Set();

  const entries = await directusFetchItems<{ game_id?: { id?: number } }>("tier_list_games", {
    fields: ["game_id.id"],
    filter: {
      rating: { _eq: "S" },
      tier_list_id: { status: { _eq: "published" } },
    },
    limit: -1,
  });

  const result = new Set<number>();
  for (const entry of entries ?? []) {
    const id = entry?.game_id?.id;
    if (typeof id === "number" && ids.has(id)) result.add(id);
  }
  return result;
}

export async function getReviewedGameIds(gameIds: number[]): Promise<Set<number>> {
  const ids = new Set(gameIds.filter((id) => typeof id === "number"));
  if (!ids.size) return new Set();

  // Reviews are a small collection, while some generated filter pages contain
  // thousands of games. Fetching the published review IDs once avoids putting
  // the entire page's game-id set into a GET query string, which can exceed the
  // request-line limit and fail with HTTP 414.
  const reviews = await directusFetchItems<{ game?: { id?: number } | null }>("reviews", {
    fields: ["game.id"],
    filter: { status: { _eq: "published" } },
    limit: -1,
  });

  const result = new Set<number>();
  for (const review of reviews ?? []) {
    const id = review?.game?.id;
    if (typeof id === "number" && ids.has(id)) result.add(id);
  }
  return result;
}
