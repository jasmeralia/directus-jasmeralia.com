export type DownloadLinkMeta = {
  icon: string | null;
  label: string;
  host: string | null;
};
export type DownloadPlatform = "steam" | "itch" | "gog" | "patreon";

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

export const getDownloadLinkMeta = (value: string | null | undefined): DownloadLinkMeta => {
  const platform = getDownloadPlatform(value);
  const host = shortHostFromUrl(value ?? "");
  if (!platform) return { icon: null, label: "Download", host };
  if (platform === "itch") return { icon: "/icons/simple/itchdotio.svg", label: "itch.io", host };
  if (platform === "gog") return { icon: "/icons/simple/gogdotcom.svg", label: "GOG", host };
  if (platform === "patreon") return { icon: "/icons/simple/patreon.svg", label: "Patreon", host };
  return { icon: "/icons/simple/steam.svg", label: "Steam", host };
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
