export const GENRE_SUPERSETS: Record<string, string[]> = {
  "visual-novel": ["avn"],
  "rpg": ["arpg", "crpg", "jrpg"],
};

export const normalizeGenreSlugs = (slugs: string[]): string[] => {
  const unique = Array.from(new Set(slugs));
  const filtered = new Set(unique);

  for (const [superset, subsets] of Object.entries(GENRE_SUPERSETS)) {
    if (!unique.includes(superset)) continue;
    if (unique.some((slug) => subsets.includes(slug))) {
      filtered.delete(superset);
    }
  }

  return Array.from(filtered);
};

export const shouldExcludeSuperset = (targetGenre: string, slugs: string[]): boolean => {
  const subsets = GENRE_SUPERSETS[targetGenre];
  if (!subsets) return false;
  return slugs.some((slug) => subsets.includes(slug));
};
