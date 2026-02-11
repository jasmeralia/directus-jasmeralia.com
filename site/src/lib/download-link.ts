export type DownloadLinkMeta = {
  icon: string | null;
  label: string;
};

const hostFromUrl = (value: string): string => {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
};

export const getDownloadLinkMeta = (value: string | null | undefined): DownloadLinkMeta => {
  if (!value) return { icon: null, label: "Download" };
  const host = hostFromUrl(value);

  if (host.endsWith("itch.io")) {
    return { icon: "/icons/simple/itchdotio.svg", label: "itch.io" };
  }
  if (host === "gog.com" || host.endsWith(".gog.com")) {
    return { icon: "/icons/simple/gogdotcom.svg", label: "GOG" };
  }
  if (host === "patreon.com" || host.endsWith(".patreon.com")) {
    return { icon: "/icons/simple/patreon.svg", label: "Patreon" };
  }
  if (host.endsWith("steampowered.com") || host.endsWith("steamcommunity.com")) {
    return { icon: "/icons/simple/steam.svg", label: "Steam" };
  }
  return { icon: null, label: "Download" };
};
