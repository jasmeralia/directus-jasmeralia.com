export const formatDate = (value: string | null | undefined): string => {
  if (!value) return "";
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
  const raw = String(value);
  const trimmed = raw.split("T")[0].split(" ")[0];
  return trimmed || raw;
};
