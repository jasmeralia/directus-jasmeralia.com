export const formatUnknown = (value: string, label: string): string =>
  value === "unknown" ? `<Unknown ${label}>` : value;

export const compareLabels = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { sensitivity: "base" });

export const sortByTitle = <T extends { title: string }>(arr: T[]): T[] =>
  arr.slice().sort((a, b) =>
    (a.title ?? "").localeCompare(b.title ?? "", undefined, { sensitivity: "base" })
  );

export const sortByName = <T extends { name: string }>(arr: T[]): T[] =>
  arr.slice().sort((a, b) =>
    (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" })
  );

// Oldest first; games with no known release_year sort last, ties broken by title.
export const sortByReleaseYear = <T extends { title: string; release_year?: number | null }>(
  arr: T[],
): T[] =>
  arr.slice().sort((a, b) => {
    const yearA = a.release_year ?? null;
    const yearB = b.release_year ?? null;
    if (yearA === null && yearB === null) return compareLabels(a.title ?? "", b.title ?? "");
    if (yearA === null) return 1;
    if (yearB === null) return -1;
    return yearA - yearB || compareLabels(a.title ?? "", b.title ?? "");
  });
