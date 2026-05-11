export type UrlLinkMeta = {
  icon: string | null;
  label: string;
  host: string | null;
};
export type UrlPlatform =
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
  | "stealthoptional";

/** @deprecated Use UrlLinkMeta */
export type DownloadLinkMeta = UrlLinkMeta;
/** @deprecated Use UrlPlatform */
export type DownloadPlatform = UrlPlatform;

const hostFromUrl = (value: string): string => {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
};

const shortHostFromUrl = (value: string): string | null => {
  const host = hostFromUrl(value).replace(/^www\./, "");
  return host || null;
};

export const getUrlLinkMeta = (value: string | null | undefined): UrlLinkMeta => {
  const platform = getUrlPlatform(value);
  const host = shortHostFromUrl(value ?? "");
  switch (platform) {
    case "itch":           return { icon: "/icons/simple/itchdotio.svg",    label: "itch.io",          host };
    case "gog":            return { icon: "/icons/simple/gogdotcom.svg",     label: "GOG",              host };
    case "patreon":        return { icon: "/icons/simple/patreon.svg",       label: "Patreon",          host };
    case "playstation":    return { icon: "/icons/simple/playstation.svg",   label: "PlayStation",      host };
    case "xbox":           return { icon: "/icons/simple/xbox.svg",          label: "Xbox",             host };
    case "ign":            return { icon: "/icons/simple/ign.svg",           label: "IGN",              host };
    case "scribd":         return { icon: "/icons/simple/scribd.svg",        label: "Scribd",           host };
    case "f95zone":        return { icon: "/icons/f95zone.png",              label: "F95Zone",          host };
    case "gamerant":       return { icon: "/icons/gamerant.png",             label: "Game Rant",        host };
    case "neoseeker":      return { icon: "/icons/neoseeker.ico",            label: "Neoseeker",        host };
    case "trueachievements": return { icon: "/icons/trueachievements.png",   label: "TrueAchievements", host };
    case "stealthoptional": return { icon: "/icons/stealthoptional.png",     label: "Stealth Optional", host };
    case "steam":          return { icon: "/icons/simple/steam.svg",         label: "Steam",            host };
    default:               return { icon: null,                              label: "Download",         host };
  }
};

/** @deprecated Use getUrlLinkMeta */
export const getDownloadLinkMeta = getUrlLinkMeta;

export const getUrlPlatform = (value: string | null | undefined): UrlPlatform | null => {
  if (!value) return null;
  const host = hostFromUrl(value);

  if (host.endsWith("itch.io")) return "itch";
  if (host === "gog.com" || host.endsWith(".gog.com")) return "gog";
  if (host === "patreon.com" || host.endsWith(".patreon.com")) return "patreon";
  if (host.endsWith("steampowered.com") || host.endsWith("steamcommunity.com")) return "steam";
  if (host === "playstation.com" || host.endsWith(".playstation.com")) return "playstation";
  if (host === "xbox.com" || host.endsWith(".xbox.com")) return "xbox";
  if (host === "ign.com" || host.endsWith(".ign.com")) return "ign";
  if (host === "scribd.com" || host.endsWith(".scribd.com")) return "scribd";
  if (host === "f95zone.to" || host.endsWith(".f95zone.to")) return "f95zone";
  if (host === "gamerant.com" || host.endsWith(".gamerant.com")) return "gamerant";
  if (host === "neoseeker.com" || host.endsWith(".neoseeker.com")) return "neoseeker";
  if (host === "trueachievements.com" || host.endsWith(".trueachievements.com")) return "trueachievements";
  if (host === "stealthoptional.com" || host.endsWith(".stealthoptional.com")) return "stealthoptional";
  return null;
};

/** @deprecated Use getUrlPlatform */
export const getDownloadPlatform = getUrlPlatform;
