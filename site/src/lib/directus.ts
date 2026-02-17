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
  download_url?: string | null;
  walkthrough_url?: string | null;
  player_status?: string | null;
};

export type TierEntry = {
  id: number;
  sort: number;
  game: Game;
};

export type TierRow = {
  id: number;
  label: string;
  color: string;
  sort: number;
  tier_entries: TierEntry[];
};

export type TierList = {
  id: number;
  title: string;
  slug: string;
  description?: string | null;
  status: "draft" | "published";
  tier_rows: TierRow[];
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

export function fileUrl(file: unknown): string | null {
  if (!file) return null;
  const base = assetsBaseUrl();

  // Directus may return a file as an id string or an object (id, filename_disk, ...).
  const id = typeof file === "string" ? file : (file as any).id;
  const filenameDisk = typeof file === "string" ? null : ((file as any).filename_disk ?? null);
  if (!id) return null;

  // Public CloudFront/S3 URLs served under /media/<filename_disk>.
  if (!base) return null;
  // If we don't have filename_disk, fall back to /media/<id> (only works if keys are ids).
  return `${base}/media/${filenameDisk || id}`;
}

async function directusFetch<T>(path: string): Promise<T> {
  const url = `${directusBaseUrl()}${path}`;
  const token = directusToken();
  const headers: Record<string, string> = { "Accept": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Directus request failed (${resp.status}) ${url}: ${text}`);
  }
  return await resp.json() as T;
}

function appendParams(target: URLSearchParams, prefix: string, value: any) {
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
  filter?: Record<string, any>;
  deep?: Record<string, any>;
  limit?: number;
};

export async function directusFetchItems<T = any>(collection: string, params: FetchItemsParams = {}): Promise<T[]> {
  const qs = new URLSearchParams();
  if (params.fields?.length) qs.set("fields", params.fields.join(","));
  if (params.sort?.length) qs.set("sort", params.sort.join(","));
  if (typeof params.limit === "number") qs.set("limit", String(params.limit));
  if (params.filter) appendParams(qs, "filter", params.filter);
  if (params.deep) appendParams(qs, "deep", params.deep);

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
    "limit": "500",
  });
  const data = await directusFetch<{ data: { slug: string }[] }>(`/items/tier_lists?${qs.toString()}`);
  return data.data.map(x => x.slug).filter(Boolean);
}

export async function getPublishedTierListBySlug(slug: string): Promise<TierList | null> {
  // Deep query:
  // - fetch tier_rows sorted
  // - fetch tier_entries sorted
  // - include game + cover_image
  const qs = new URLSearchParams({
    "filter[slug][_eq]": slug,
    "filter[status][_eq]": "published",
    "fields": [
      "id","title","slug","description","status",
      "tier_rows.id","tier_rows.label","tier_rows.color","tier_rows.sort",
      "tier_rows.tier_entries.id","tier_rows.tier_entries.sort",
      "tier_rows.tier_entries.game.id","tier_rows.tier_entries.game.title","tier_rows.tier_entries.game.slug","tier_rows.tier_entries.game.player_status",
      "tier_rows.tier_entries.game.walkthrough_url",
      "tier_rows.tier_entries.game.cover_image.id,tier_rows.tier_entries.game.cover_image.filename_disk",
    ].join(","),
    "deep[tier_rows][_sort]": "sort",
    "deep[tier_rows][tier_entries][_sort]": "sort",
    "deep[tier_rows][tier_entries][game][cover_image][_limit]": "1",
    "limit": "1",
  });

  const res = await directusFetch<{ data: TierList[] }>(`/items/tier_lists?${qs.toString()}`);
  const item = res.data?.[0];
  if (!item) return null;

  // Normalize: make sure arrays exist
  item.tier_rows = (item.tier_rows ?? []).map((r: any) => ({
    ...r,
    tier_entries: (r.tier_entries ?? []),
  }));
  return item as TierList;
}

export async function getSTierGameIds(gameIds: number[]): Promise<Set<number>> {
  const ids = gameIds.filter((id) => typeof id === "number");
  if (!ids.length) return new Set();

  const entries = await directusFetchItems("tier_entries", {
    fields: ["game.id"],
    filter: {
      game: { _in: ids },
      tier_row: {
        label: { _eq: "S" },
        tier_list: { status: { _eq: "published" } },
      },
    },
    limit: 1000,
  });

  const result = new Set<number>();
  for (const entry of entries ?? []) {
    const id = entry?.game?.id;
    if (typeof id === "number") result.add(id);
  }
  return result;
}
