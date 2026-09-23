export const formatDate = (value: string | null | undefined): string => {
  if (!value) return "";
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    const tz =
      (import.meta.env.SITE_TIMEZONE as string | undefined) ||
      "America/Los_Angeles";
    return parsed.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: tz,
    });
  }
  const raw = String(value);
  const trimmed = raw.split("T")[0].split(" ")[0];
  return trimmed || raw;
};
