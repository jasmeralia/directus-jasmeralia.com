import { isGameNsfw } from "./directus";

export { isGameNsfw };

export function isTierListNsfw(tierList: { nsfw?: boolean | null }): boolean {
  return tierList.nsfw === true;
}

export function isTierBoardEntryNsfw(
  game: Parameters<typeof isGameNsfw>[0],
  tierList: { nsfw?: boolean | null },
): boolean {
  return isGameNsfw(game) || isTierListNsfw(tierList);
}

export function hasGenreSlug(
  game: { genres?: { genres_id?: { slug?: string | null } | null }[] | null },
  slug: string,
): boolean {
  return (game.genres ?? []).some((genre) => genre?.genres_id?.slug === slug);
}
