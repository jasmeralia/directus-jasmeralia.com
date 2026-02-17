export type DownloadLinkMeta = {
  icon: string | null;
  label: string;
};
export type DownloadPlatform = "steam" | "itch" | "gog" | "patreon";

const hostFromUrl = (value: string): string => {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
};

export const getDownloadLinkMeta = (value: string | null | undefined): DownloadLinkMeta => {
  const platform = getDownloadPlatform(value);
  if (!platform) return { icon: null, label: "Download" };
  if (platform === "itch") return { icon: "/icons/simple/itchdotio.svg", label: "itch.io" };
  if (platform === "gog") return { icon: "/icons/simple/gogdotcom.svg", label: "GOG" };
  if (platform === "patreon") return { icon: "/icons/simple/patreon.svg", label: "Patreon" };
  return { icon: "/icons/simple/steam.svg", label: "Steam" };
};

export const getDownloadPlatform = (value: string | null | undefined): DownloadPlatform | null => {
  if (!value) return null;
  const host = hostFromUrl(value);

  if (host.endsWith("itch.io")) {
    return "itch";
  }
  if (host === "gog.com" || host.endsWith(".gog.com")) {
    return "gog";
  }
  if (host === "patreon.com" || host.endsWith(".patreon.com")) {
    return "patreon";
  }
  if (host.endsWith("steampowered.com") || host.endsWith("steamcommunity.com")) {
    return "steam";
  }
  return null;
};
