export const GENRE_SUPERSETS: Record<string, string[]> = {
  "visual-novel": ["avn"],
  "rpg": ["arpg", "crpg", "jrpg"],
};

/** Return each explicitly tagged genre plus every superset it implies. */
export const expandGenreSlugs = (slugs: string[]): string[] => {
  const expanded = new Set(slugs);
  let changed = true;

  while (changed) {
    changed = false;
    for (const [superset, subsets] of Object.entries(GENRE_SUPERSETS)) {
      if (expanded.has(superset) || !subsets.some((slug) => expanded.has(slug))) continue;
      expanded.add(superset);
      changed = true;
    }
  }

  return Array.from(expanded);
};

/** Check genre membership, including inherited membership in configured supersets. */
export const hasGenreMembership = (slugs: string[], targetGenre: string): boolean =>
  expandGenreSlugs(slugs).includes(targetGenre);

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
