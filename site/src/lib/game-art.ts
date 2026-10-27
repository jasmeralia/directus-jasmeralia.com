import type { DirectusFile } from "./directus";
import { fileUrl } from "./directus";

export const ART_TAB_KINDS = [
  ["wide_capsule", "Wide capsule"],
  ["hero", "Hero"],
  ["logo", "Logo"],
  ["icon", "Icon"],
] as const;

export const SHARED_DEFAULT_ART_TITLES = new Set([
  "Ren'Py default logo",
  "Ren'Py default icon",
]);

// A games_art row as returned when expanding a game's `art` relation.
export type GameArtRow = {
  kind?: string | null;
  language?: string | null;
  scale?: string | null;
  sort?: number | null;
  file?: DirectusFile | string | null;
};

export type HasArt = { art?: GameArtRow[] | null };

export type ArtTabItem = {
  kind: string;
  label: string;
  url: string;
  language: string | null;
  scale: string | null;
  width: number | null;
  height: number | null;
};

export type ArtTabGroup = { kind: string; label: string; items: ArtTabItem[] };

// Directus `fields` entries that expand a game's art rows. `prefix` is the
// relation path to the game (e.g. "game_id." for a tier list entry). Pass
// `withSize` to also read the file's pixel size.
export function artFields(prefix = "", withSize = false): string[] {
  return [
    `${prefix}art.kind`,
    `${prefix}art.language`,
    `${prefix}art.file.id`,
    `${prefix}art.file.filename_disk`,
    ...(withSize ? [`${prefix}art.file.width`, `${prefix}art.file.height`] : []),
  ];
}

export function artTabFields(prefix = ""): string[] {
  return [
    `${prefix}art.kind`,
    `${prefix}art.language`,
    `${prefix}art.scale`,
    `${prefix}art.sort`,
    `${prefix}art.file.id`,
    `${prefix}art.file.filename_disk`,
    `${prefix}art.file.title`,
    `${prefix}art.file.width`,
    `${prefix}art.file.height`,
  ];
}

type SortableArtTabItem = { item: ArtTabItem; sort: number | null };

const languageRank = (language: string | null) => (language === "en" ? 0 : 1);
const scaleRank = (scale: string | null) => (scale === "2x" ? 0 : scale === "1x" ? 1 : 2);
const sortRank = (sort: number | null) => sort ?? Number.MAX_SAFE_INTEGER;

// English first, then other languages alphabetically; 2x before 1x; then the
// row's own `sort` ascending with unsorted rows last.
function compareArtItems(a: SortableArtTabItem, b: SortableArtTabItem): number {
  return (
    languageRank(a.item.language) - languageRank(b.item.language) ||
    (a.item.language ?? "").localeCompare(b.item.language ?? "") ||
    scaleRank(a.item.scale) - scaleRank(b.item.scale) ||
    sortRank(a.sort) - sortRank(b.sort)
  );
}

export function buildArtTab(entity: HasArt | null | undefined): ArtTabGroup[] {
  const items = new Map<string, SortableArtTabItem[]>();

  for (const row of entity?.art ?? []) {
    const definition = ART_TAB_KINDS.find(([kind]) => kind === row?.kind);
    if (!definition || !row.file) continue;
    const file = typeof row.file === "string" ? { id: row.file } : row.file;
    if (SHARED_DEFAULT_ART_TITLES.has(file.title ?? "")) continue;
    const url = fileUrl(file);
    if (!url) continue;

    const [kind, label] = definition;
    const groupItems = items.get(kind) ?? [];
    groupItems.push({
      item: {
        kind,
        label,
        url,
        language: row.language ?? null,
        scale: row.scale ?? null,
        width: file.width ?? null,
        height: file.height ?? null,
      },
      sort: row.sort ?? null,
    });
    items.set(kind, groupItems);
  }

  return ART_TAB_KINDS.flatMap(([kind, label]) => {
    const groupItems = items.get(kind);
    return groupItems?.length
      ? [{ kind, label, items: groupItems.sort(compareArtItems).map(({ item }) => item) }]
      : [];
  });
}

export function hasArtTab(entity: HasArt | null | undefined): boolean {
  return buildArtTab(entity).length > 0;
}

// The file of a game's art of one kind. An English row wins; otherwise the
// first row of that kind with a file is used.
export function artFile(
  entity: HasArt | null | undefined,
  kind: string,
  language = "en",
): DirectusFile | null {
  const rows = (entity?.art ?? []).filter((row) => row?.kind === kind && row.file);
  const row = rows.find((candidate) => candidate.language === language) ?? rows[0];
  if (!row?.file) return null;
  return typeof row.file === "string" ? { id: row.file } : row.file;
}

// The portrait cover (games_art kind "capsule"), replacing games.cover_image.
export function coverImage(entity: HasArt | null | undefined): DirectusFile | null {
  return artFile(entity, "capsule");
}
