import { compareLabels } from "./list-format";

export type TierChip = { slug: string; text: string };

export type TierChipEntry = {
  rating?: string | null;
  game_id?: { id?: number | null } | null;
  tier_list_id?: { slug?: string | null; title?: string | null } | null;
};

// Ordered best to worst; the index is the sort order.
const CHIP_RATINGS = ["S", "A", "B", "C", "D", "F"];

export function buildTierChips(entries: TierChipEntry[]): TierChip[] {
  const chipsBySlug = new Map<string, { chip: TierChip; rating: string; title: string }>();

  for (const entry of entries) {
    const rating = entry?.rating;
    const list = entry?.tier_list_id;
    if (
      typeof entry?.game_id?.id !== "number" ||
      !CHIP_RATINGS.includes(rating ?? "") ||
      !list?.slug ||
      typeof list.title !== "string"
    ) continue;

    const title = list.title.replace(/^[~\s]+/, "").trim();
    if (!title) continue;
    if (!chipsBySlug.has(list.slug)) {
      chipsBySlug.set(list.slug, {
        chip: { slug: list.slug, text: `${title} - ${rating} Tier` },
        rating: rating as string,
        title,
      });
    }
  }

  return [...chipsBySlug.values()]
    .sort((left, right) =>
      CHIP_RATINGS.indexOf(left.rating) - CHIP_RATINGS.indexOf(right.rating) ||
      compareLabels(left.title, right.title),
    )
    .map(({ chip }) => chip);
}

export function groupTierChipsByGame(entries: TierChipEntry[]): Map<number, TierChip[]> {
  const entriesByGame = new Map<number, TierChipEntry[]>();
  for (const entry of entries) {
    const gameId = entry?.game_id?.id;
    if (typeof gameId !== "number") continue;
    const rows = entriesByGame.get(gameId) ?? [];
    rows.push(entry);
    entriesByGame.set(gameId, rows);
  }

  return new Map([...entriesByGame].map(([gameId, rows]) => [gameId, buildTierChips(rows)]));
}
