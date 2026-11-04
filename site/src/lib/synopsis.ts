import type { GameLink } from "./download-link";
import { marked } from "marked";

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

function safeSteamVideoUrl(value: string): string | null {
  const safe = safeSteamImageUrl(value);
  if (!safe) return null;
  return /\.(?:mp4|webm)$/i.test(new URL(safe).pathname) ? safe : null;
}

function safeHttpsLink(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (character) => entities[character] ?? character);
}

function videoSource(source: string, deferred: boolean): string {
  const type = new URL(source).pathname.toLowerCase().endsWith(".webm")
    ? "video/webm"
    : "video/mp4";
  const attribute = deferred ? "data-src" : "src";
  return `<source ${attribute}="${escapeHtml(source)}" type="${type}">`;
}

/** Render importer-generated Steam Markdown with a strict output and media allowlist. */
export function renderSteamSynopsis(
  text: string | null | undefined,
  deferMedia = false,
): string {
  const renderer = new marked.Renderer();
  renderer.html = ({ text: raw }) => escapeHtml(raw);
  renderer.link = ({ href, title, text: label }) => {
    const safe = safeHttpsLink(href);
    if (!safe) return label;
    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
    return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer"${titleAttribute}>${label}</a>`;
  };
  renderer.image = ({ href, title, text: alt }) => {
    const video = /^steam-video:([^|]*)\|(.*)$/.exec(alt);
    if (video) {
      const primary = href ? safeSteamVideoUrl(href) : null;
      const fallback = safeSteamVideoUrl(video[2]);
      if (!primary) return "";
      const poster = video[1] ? safeSteamImageUrl(video[1]) : null;
      const posterAttribute = poster
        ? ` ${deferMedia ? "data-poster" : "poster"}="${escapeHtml(poster)}"`
        : "";
      const titleAttribute = title ? ` aria-label="${escapeHtml(title)}"` : "";
      return `<video class="synopsis-video"${posterAttribute}${titleAttribute} controls playsinline preload="none" data-synopsis-video>${videoSource(primary, deferMedia)}${fallback && fallback !== primary ? videoSource(fallback, deferMedia) : ""}</video>`;
    }
    const safe = href ? safeSteamImageUrl(href) : null;
    if (!safe) return "";
    const sourceAttribute = deferMedia ? "data-src" : "src";
    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
    return `<img class="synopsis-image" ${sourceAttribute}="${escapeHtml(safe)}" alt="${escapeHtml(alt)}"${titleAttribute} loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
  };
  return marked.parse(text ?? "", { renderer, breaks: true }) as string;
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
  const itchUrls = new Set<string>();
  for (const link of links ?? []) {
    let url: URL;
    try {
      url = new URL(link.url);
    } catch {
      continue;
    }
    if (!["http:", "https:"].includes(url.protocol)) continue;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (source === "gsl" && link.kind === "gamestorylog"
      && host === "gamestorylog.com" && /^\/games\/[^/]+\/?$/.test(url.pathname)) {
      return { label: "GameStoryLog", url: url.href };
    }
    if (source === "steam" && link.kind === "download" && host === "store.steampowered.com") {
      const match = url.pathname.match(/^\/app\/([1-9]\d*)(?:\/|$)/);
      if (match) steamIds.add(match[1]);
    }
    if (source === "itch" && link.kind === "download"
      && url.protocol === "https:"
      && host.endsWith(".itch.io")
      && url.pathname.split("/").filter(Boolean).length >= 1) {
      itchUrls.add(url.href);
    }
  }
  if (itchUrls.size === 1) return { label: "itch.io", url: [...itchUrls][0] };
  if (steamIds.size !== 1) return null;
  return { label: "Steam", url: `https://store.steampowered.com/app/${[...steamIds][0]}/` };
}
