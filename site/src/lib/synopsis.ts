import type { GameLink } from "./download-link";

export function synopsisParagraphs(text: string | null | undefined): string[] {
  return (text ?? "")
    .split(/\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
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
