export const formatUnknown = (value: string, label: string): string =>
  value === "unknown" ? `<Unknown ${label}>` : value;

export const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

// Maps each letter to the index of the first entry in `labels` (assumed
// already sorted) starting with that letter. Non-alphabetic leading
// characters are grouped under "#".
export const buildAlphaAnchors = (labels: string[]): Map<string, number> => {
  const map = new Map<string, number>();
  labels.forEach((label, i) => {
    const ch = (label ?? "").trim().charAt(0).toUpperCase();
    const letter = /[A-Z]/.test(ch) ? ch : "#";
    if (!map.has(letter)) map.set(letter, i);
  });
  return map;
};

// Inverse of `buildAlphaAnchors`: index -> letter, for tagging the anchor element.
export const invertAlphaAnchors = (anchors: Map<string, number>): Map<number, string> =>
  new Map([...anchors].map(([letter, index]) => [index, letter]));

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
