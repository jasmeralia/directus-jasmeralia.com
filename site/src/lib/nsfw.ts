import { isGameNsfw } from "./directus";

export { isGameNsfw };

export const CONTENT_RATINGS = ["sfw", "nsfw"] as const;

export type ContentRating = (typeof CONTENT_RATINGS)[number];

export const CONTENT_RATING_META: Record<
  ContentRating,
  { label: string; description: string }
> = {
  sfw: {
    label: "SFW",
    description: "Games not classified as NSFW by their game or genre flags.",
  },
  nsfw: {
    label: "NSFW",
    description: "Games classified as NSFW by their game or genre flags.",
  },
};

export function isContentRating(value: unknown): value is ContentRating {
  return CONTENT_RATINGS.includes(value as ContentRating);
}

export function contentRating(game: Parameters<typeof isGameNsfw>[0]): ContentRating {
  return isGameNsfw(game) ? "nsfw" : "sfw";
}

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
