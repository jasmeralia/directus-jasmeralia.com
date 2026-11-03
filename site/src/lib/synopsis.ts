import type { GameLink } from "./download-link";

export function synopsisParagraphs(text: string | null | undefined): string[] {
  return (text ?? "")
    .split(/\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

export type SynopsisBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "image"; src: string; alt: string };

const LEGACY_STEAM_IMAGE_HOSTS = new Set([
  "steamcdn-a.akamaihd.net",
  "steamcommunity-a.akamaihd.net",
  "steamstore-a.akamaihd.net",
]);

function safeSteamImageUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port !== "" && url.port !== "443") ||
      !(host.endsWith(".steamstatic.com") || LEGACY_STEAM_IMAGE_HOSTS.has(host))
    ) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

/** Parse paragraph text and the controlled Steam image markers used by the backfill. */
export function synopsisBlocks(
  text: string | null | undefined,
  source: string | null | undefined,
): SynopsisBlock[] {
  return (text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line): SynopsisBlock => {
      if (source === "steam") {
        const image = /^!\[([^\]\r\n]*)\]\((https:\/\/[^)\s]+)\)$/.exec(line);
        if (image) {
          const src = safeSteamImageUrl(image[2]);
          if (src) return { kind: "image", src, alt: image[1] };
        }
      }
      return { kind: "paragraph", text: line };
    });
}

export function synopsisSourceLink(
  source: string | null | undefined,
  links: GameLink[] | null | undefined,
): { label: string; url: string } | null {
  const steamIds = new Set<string>();
  for (const link of links ?? []) {
    let url: URL;
    try {
      url = new URL(link.url);
    } catch {
      continue;
    }
    if (!['http:', 'https:'].includes(url.protocol)) continue;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (source === "gsl" && link.kind === "gamestorylog"
      && host === "gamestorylog.com" && /^\/games\/[^/]+\/?$/.test(url.pathname)) {
      return { label: "GameStoryLog", url: url.href };
    }
    if (source === "steam" && link.kind === "download" && host === "store.steampowered.com") {
      const match = url.pathname.match(/^\/app\/([1-9]\d*)(?:\/|$)/);
      if (match) steamIds.add(match[1]);
    }
  }
  if (steamIds.size !== 1) return null;
  return { label: "Steam", url: `https://store.steampowered.com/app/${[...steamIds][0]}/` };
}
