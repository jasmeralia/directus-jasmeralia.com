import { directusFetchRaw } from "./directus";
import { sectionNoun, type GameSection } from "./game-sections";

type DirectusRecord = Record<string, unknown>;

// ─── field / enum labels ─────────────────────────────────────────────────────

// Fields skipped when building delta descriptions
export const SKIP_DELTA = new Set([
  "date_updated", "date_created", "sort", "id", "slug", "body", "updated_at",
  "engines",
]);

// current_section is formatted specially (see fmtDelta) using the game's
// section_noun, so it has no plain FIELD_LABEL entry.
export const FIELD_LABEL: Record<string, string> = {
  title: "Title",
  release_year: "Year",
  player_status: "Play Status",
  game_status: "Release Status",
  family_sharing: "Family Sharing",
  section_data_status: "Section Data",
  section_style: "Section Style",
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
  linear: "Linear",
  nonlinear: "Nonlinear",
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
// currentData is the full snapshot as of this revision, used to look up
// section_noun for formatting current_section changes.
// sections is the game's (or bundle member's) own ordered section list, used to
// prefer a real section title over a generic "noun + number" label.
export function fmtDelta(
  delta: Record<string, unknown>,
  prev: Record<string, unknown> | null,
  currentData?: Record<string, unknown> | null,
  sections?: GameSection[] | null,
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
    // Special-case current_section: prefer the section's own title (e.g.
    // "The Arrival"); fall back to the game's section noun + number
    // (e.g. "Episode 1") when no matching section row exists.
    if (f === "current_section") {
      const noun = sectionNoun(
        (currentData?.section_noun as string | null | undefined)
          ?? (prev?.section_noun as string | null | undefined),
      );
      const fmtProgress = (v: unknown) => {
        if (v === null || v === undefined) return humanVal(f, v);
        return sections?.find((section) => section.number === v)?.title
          ?? `${noun} ${humanVal(f, v)}`;
      };
      const oldVal = prev?.[f] ?? null;
      if (oldVal !== null && oldVal !== undefined) {
        lines.push(`**Current Progress**: ${fmtProgress(oldVal)} → ${fmtProgress(newVal)}`);
      } else {
        lines.push(`**Current Progress**: ${fmtProgress(newVal)}`);
      }
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

// Resolve each target revision's immediately preceding same-item snapshot from
// a collection-wide revision list, preserving the old API-query semantics
// without issuing one Directus request per feed entry.
export function previousRevisionDataMap(
  revisions: Revision[],
  targets: Revision[],
): Record<number, Record<string, unknown> | null> {
  const targetIds = new Set(targets.map((revision) => revision.id));
  const revisionsByItem = new Map<string, Revision[]>();

  for (const revision of revisions) {
    const itemRevisions = revisionsByItem.get(String(revision.item)) ?? [];
    itemRevisions.push(revision);
    revisionsByItem.set(String(revision.item), itemRevisions);
  }

  const result: Record<number, Record<string, unknown> | null> = Object.fromEntries(
    targets.map((revision) => [revision.id, null]),
  );
  for (const itemRevisions of revisionsByItem.values()) {
    itemRevisions.sort((left, right) => right.id - left.id);
    for (const [index, revision] of itemRevisions.entries()) {
      if (!targetIds.has(revision.id)) continue;
      result[revision.id] = itemRevisions[index + 1]?.data ?? null;
    }
  }
  return result;
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

// Batch-fetch game_sections rows grouped by one of their foreign keys, for
// resolving current_section titles in fmtDelta.
async function fetchSectionsGroupedBy(
  fkField: "games_id" | "bundle_member_id",
  ids: number[],
): Promise<Record<number, GameSection[]>> {
  if (!ids.length) return {};
  const qs = new URLSearchParams({
    [`filter[${fkField}][_in]`]: ids.join(","),
    "fields": `id,number,title,${fkField}`,
    "limit": String(ids.length * 50 + 10),
  });
  const res = await directusFetchRaw<{ data: Record<string, unknown>[] }>(`/items/game_sections?${qs.toString()}`);
  const map: Record<number, GameSection[]> = {};
  for (const row of res.data ?? []) {
    const key = Number(row[fkField]);
    if (!key) continue;
    (map[key] ??= []).push({
      id: row.id as number,
      number: row.number as number,
      title: row.title as string,
    });
  }
  return map;
}

// Fetch each game's own (non-bundle-member) sections, keyed by game id.
export const fetchGameSectionsByGameIds = (gameIds: number[]): Promise<Record<number, GameSection[]>> =>
  fetchSectionsGroupedBy("games_id", gameIds);

// Fetch each included game's sections, keyed by game_bundle_members id.
export const fetchGameSectionsByBundleMemberIds = (memberIds: number[]): Promise<Record<number, GameSection[]>> =>
  fetchSectionsGroupedBy("bundle_member_id", memberIds);

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

// Batch variant of fetchGameGenres: fetch every games_genres row once and
// group genre names by games_id, for callers building per-game data for
// many games at once (e.g. games/[slug].astro's getStaticPaths) instead of
// issuing one filtered request per game.
export async function fetchAllGameGenres(): Promise<Record<number, string[]>> {
  const qs = new URLSearchParams({
    "fields": "games_id,genres_id.name",
    "limit": "-1",
  });
  const res = await directusFetchRaw<{ data: (GenreJoinRow & { games_id?: number })[] }>(`/items/games_genres?${qs.toString()}`);
  const map: Record<number, string[]> = {};
  for (const row of res.data ?? []) {
    const gameId = Number(row.games_id);
    const name = row.genres_id?.name;
    if (!gameId || !name) continue;
    (map[gameId] ??= []).push(name);
  }
  return map;
}
