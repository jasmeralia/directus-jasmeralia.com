import { getUrlPlatform } from "./download-link";

export type WalkthroughKind =
  | "steam"
  | "itch"
  | "gog"
  | "patreon"
  | "playstation"
  | "xbox"
  | "ign"
  | "scribd"
  | "f95zone"
  | "gamerant"
  | "neoseeker"
  | "trueachievements"
  | "stealthoptional"
  | "unknown"
  | "text-note"
  | "none-provided";

export const WALKTHROUGH_KINDS: WalkthroughKind[] = [
  "steam", "itch", "gog", "patreon",
  "playstation", "xbox",
  "ign", "scribd", "f95zone",
  "gamerant", "neoseeker", "trueachievements", "stealthoptional",
  "unknown", "text-note", "none-provided",
];

export const WALKTHROUGH_KIND_LABEL: Record<WalkthroughKind, string> = {
  steam: "Steam",
  itch: "itch.io",
  gog: "GOG",
  patreon: "Patreon",
  playstation: "PlayStation",
  xbox: "Xbox",
  ign: "IGN",
  scribd: "Scribd",
  f95zone: "F95Zone",
  gamerant: "Game Rant",
  neoseeker: "Neoseeker",
  trueachievements: "TrueAchievements",
  stealthoptional: "Stealth Optional",
  unknown: "<Unknown Walkthrough Platform>",
  "text-note": "Text Note",
  "none-provided": "None Provided",
};

const isUrl = (value: string): boolean => /^https?:\/\//i.test(value);

export const classifyWalkthroughValue = (value: unknown): WalkthroughKind => {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "none-provided";
  if (!isUrl(text)) return "text-note";
  const platform = getUrlPlatform(text);
  switch (platform) {
    case "steam":
    case "itch":
    case "gog":
    case "patreon":
    case "playstation":
    case "xbox":
    case "ign":
    case "scribd":
    case "f95zone":
    case "gamerant":
    case "neoseeker":
    case "trueachievements":
    case "stealthoptional":
      return platform;
    default:
      return "unknown";
  }
};
