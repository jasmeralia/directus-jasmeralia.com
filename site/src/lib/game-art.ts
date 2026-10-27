import type { DirectusFile } from "./directus";

// A games_art row as returned when expanding a game's `art` relation.
export type GameArtRow = {
  kind?: string | null;
  language?: string | null;
  scale?: string | null;
  file?: DirectusFile | string | null;
};

export type HasArt = { art?: GameArtRow[] | null };

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
