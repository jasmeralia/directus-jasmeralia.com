export type MusicTrack = {
  id?: number | string | null;
  sort?: number | null;
  title: string;
  artist?: string | null;
  url: string;
  category?: string | null;
  scene?: string | null;
  characters?: unknown;
  note?: string | null;
};

export type MusicList = {
  id?: number | string | null;
  sort?: number | null;
  title: string;
  description?: string | null;
  url?: string | null;
  tracks?: MusicTrack[] | null;
};

type Sortable = { sort?: number | null; id?: number | string | null };

function compareSortAndId(a: Sortable, b: Sortable): number {
  const leftSort = typeof a.sort === "number" ? a.sort : null;
  const rightSort = typeof b.sort === "number" ? b.sort : null;
  if (leftSort !== null && rightSort !== null && leftSort !== rightSort) return leftSort - rightSort;
  if (leftSort !== null && rightSort === null) return -1;
  if (leftSort === null && rightSort !== null) return 1;
  const leftId = a.id;
  const rightId = b.id;
  if (leftId === rightId) return 0;
  if (leftId === null || leftId === undefined) return 1;
  if (rightId === null || rightId === undefined) return -1;
  if (typeof leftId === "number" && typeof rightId === "number") return leftId - rightId;
  return String(leftId).localeCompare(String(rightId), undefined, { numeric: true, sensitivity: "base" });
}

export function orderedMusicLists(lists: MusicList[] | null | undefined): MusicList[] {
  return (lists ?? [])
    .map((list) => ({ ...list, tracks: [...(list.tracks ?? [])].sort(compareSortAndId) }))
    .sort(compareSortAndId);
}

export function groupTracksByCategory(tracks: MusicTrack[] | null | undefined): Array<{ category: string | null; tracks: MusicTrack[] }> {
  const groups: Array<{ category: string | null; tracks: MusicTrack[] }> = [];
  const byCategory = new Map<string | null, { category: string | null; tracks: MusicTrack[] }>();
  for (const track of [...(tracks ?? [])].sort(compareSortAndId)) {
    const categoryValue = typeof track.category === "string" ? track.category.trim() : "";
    const category = categoryValue || null;
    let group = byCategory.get(category);
    if (!group) {
      group = { category, tracks: [] };
      byCategory.set(category, group);
      groups.push(group);
    }
    group.tracks.push(track);
  }
  return groups;
}

export function normalizeCharacters(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function hasMusic(game: { music_lists?: MusicList[] | null } | null | undefined): boolean {
  return (game?.music_lists ?? []).some((list) =>
    Boolean(typeof list.url === "string" && list.url.trim()) || Boolean(list.tracks?.length),
  );
}
