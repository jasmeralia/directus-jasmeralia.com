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
  if (platform === "steam") return "steam";
  if (platform === "itch") return "itch";
  if (platform === "gog") return "gog";
  if (platform === "patreon") return "patreon";
  if (platform === "playstation") return "playstation";
  if (platform === "xbox") return "xbox";
  if (platform === "ign") return "ign";
  if (platform === "scribd") return "scribd";
  if (platform === "f95zone") return "f95zone";
  if (platform === "gamerant") return "gamerant";
  if (platform === "neoseeker") return "neoseeker";
  if (platform === "trueachievements") return "trueachievements";
  if (platform === "stealthoptional") return "stealthoptional";
  return "unknown";
};
