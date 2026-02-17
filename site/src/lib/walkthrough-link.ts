import { getDownloadPlatform } from "./download-link";

export type WalkthroughKind =
  | "steam"
  | "itch"
  | "gog"
  | "patreon"
  | "unknown"
  | "text-note"
  | "none-provided";

export const WALKTHROUGH_KIND_LABEL: Record<WalkthroughKind, string> = {
  steam: "Steam",
  itch: "itch.io",
  gog: "GOG",
  patreon: "Patreon",
  unknown: "<Unknown Walkthrough Platform>",
  "text-note": "Text Note",
  "none-provided": "None Provided",
};

const isUrl = (value: string): boolean => /^https?:\/\//i.test(value);

export const classifyWalkthroughValue = (value: unknown): WalkthroughKind => {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "none-provided";
  if (!isUrl(text)) return "text-note";
  const platform = getDownloadPlatform(text);
  if (platform === "steam") return "steam";
  if (platform === "itch") return "itch";
  if (platform === "gog") return "gog";
  if (platform === "patreon") return "patreon";
  return "unknown";
};

