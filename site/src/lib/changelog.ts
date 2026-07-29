import { directusFetchRaw } from "./directus";

type DirectusRecord = Record<string, unknown>;

// ─── field / enum labels ─────────────────────────────────────────────────────

// Fields skipped when building delta descriptions
export const SKIP_DELTA = new Set([
  "date_updated", "date_created", "sort", "id", "slug", "body", "updated_at",
  "engines",
]);

export const FIELD_LABEL: Record<string, string> = {
  title: "Title",
  release_year: "Year",
  player_status: "Play Status",
  game_status: "Release Status",
  family_sharing: "Family Sharing",
  current_section: "Current Section",
  section_data_status: "Section Data",
  section_noun: "Section Noun",
  cover_image: "Cover Image",
  status: "Status",
  description: "Description",
  rating: "Rating",
  published_at: "Published",
};

export const ENUM_LABEL: Record<string, string> = {
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
  unknown: "Unknown",
  not_applicable: "Not Applicable",
  tracked: "Tracked",
};

// ─── value formatting ─────────────────────────────────────────────────────────

export function humanVal(field: string, val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (field === "cover_image") return val ? "[image]" : "—";
  if (typeof val === "boolean") return val ? "Yes" : "No";
  if (typeof val === "string") return ENUM_LABEL[val] ?? val;
  return String(val);
}

// Build a Discord-markdown description from a revision delta.
// prevData is the full data snapshot from the previous revision (for "from" values).
export function fmtDelta(
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
export function fmtNewGame(data: Record<string, unknown>, genres: string[]): string {
  const lines: string[] = [];
  const fields: [string, string][] = [
    ["release_year", "Year"],
    ["player_status", "Play Status"],
    ["game_status", "Release Status"],
    ["family_sharing", "Family Sharing"],
  ];
  for (const [f, label] of fields) {
    const v = data[f];
    if (v !== null && v !== undefined) lines.push(`**${label}**: ${humanVal(f, v)}`);
  }
  if (genres.length) lines.push(`**Genres**: ${genres.join(", ")}`);
  return lines.join("\n");
}

// ─── Directus API helpers ────────────────────────────────────────────────────

export type Revision = {
  id: number;
  item: string;
  collection: string;
  data: Record<string, unknown> | null;
  delta: Record<string, unknown> | null;
  activity: { id?: number; action: string; timestamp: string } | null;
};

export type Activity = {
  id: number;
  action: string;
  collection: string;
  item: string;
  timestamp: string;
};

// Fetch the most recent revisions for a collection (ordered by id DESC).
export async function fetchRevisions(collection: string, limit: number): Promise<Revision[]> {
  const qs = new URLSearchParams({
    "filter[collection][_eq]": collection,
    "sort": "-id",
    "limit": String(limit),
    "fields": "id,item,collection,delta,data,activity.id,activity.action,activity.timestamp",
  });
  const res = await directusFetchRaw<{ data: Revision[] }>(`/revisions?${qs.toString()}`);
  return res.data ?? [];
}

// Fetch the revision immediately before a given revision id for an item.
export async function fetchPrevRevision(collection: string, item: string, beforeId: number): Promise<Revision | null> {
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

// Fetch recent activities for a junction collection by one or more actions.
export async function fetchActivity(collection: string, actions: string | string[], limit: number): Promise<Activity[]> {
  const qs = new URLSearchParams({
    "filter[collection][_eq]": collection,
    "filter[action][_in]": Array.isArray(actions) ? actions.join(",") : actions,
    "sort": "-timestamp",
    "limit": String(limit),
    "fields": "id,action,collection,item,timestamp",
  });
  const res = await directusFetchRaw<{ data: Activity[] }>(`/activity?${qs.toString()}`);
  return res.data ?? [];
}

// Batch-fetch items from any collection by ID, returning a map of id → item.
export async function fetchItemMap(collection: string, ids: number[], fields: string): Promise<Record<number, DirectusRecord>> {
  if (!ids.length) return {};
  const qs = new URLSearchParams({
    "filter[id][_in]": ids.join(","),
    "fields": fields,
    "limit": String(ids.length + 10),
  });
  const res = await directusFetchRaw<{ data: DirectusRecord[] }>(`/items/${collection}?${qs.toString()}`);
  return Object.fromEntries((res.data ?? []).map((x): [number, DirectusRecord] => [Number(x.id), x]));
}

type GenreJoinRow = { genres_id?: { name?: string } | null };

// Fetch current genre names for a game (for new-game entries).
export async function fetchGameGenres(gameId: number): Promise<string[]> {
  const qs = new URLSearchParams({
    "filter[games_id][_eq]": String(gameId),
    "fields": "genres_id.name",
    "limit": "50",
  });
  const res = await directusFetchRaw<{ data: GenreJoinRow[] }>(`/items/games_genres?${qs.toString()}`);
  return (res.data ?? [])
    .map((r) => r.genres_id?.name)
    .filter((name): name is string => Boolean(name));
}
