export const formatUnknown = (value: string, label: string): string =>
  value === "unknown" ? `<Unknown ${label}>` : value;

export const compareLabels = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { sensitivity: "base" });

export const sortByTitle = <T extends { title: string }>(arr: T[]): T[] =>
  arr.slice().sort((a, b) =>
    (a.title ?? "").localeCompare(b.title ?? "", undefined, { sensitivity: "base" })
  );
