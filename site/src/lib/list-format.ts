export const formatUnknown = (value: string, label: string): string =>
  value === "unknown" ? `<Unknown ${label}>` : value;

export const compareLabels = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { sensitivity: "base" });
