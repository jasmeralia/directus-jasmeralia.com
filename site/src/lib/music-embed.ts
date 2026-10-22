export type MusicEmbed = {
  provider: "spotify" | "youtube";
  embedUrl: string;
  height: number;
  openUrl: string;
  label: string;
};

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function validId(value: string | null, maxLength = 64): value is string {
  return Boolean(value && value.length <= maxLength && ID_PATTERN.test(value));
}

/** Returns the URL only when it is a plain http(s) URL, else null (keeps javascript:/data: out of href attributes). */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

export function resolveMusicEmbed(url: string | null | undefined): MusicEmbed | null {
  if (typeof url !== "string" || !url.trim()) return null;

  try {
    const parsed = new URL(url);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) return null;
    const host = parsed.hostname.toLowerCase();

    if (host === "open.spotify.com") {
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts[0]?.match(/^intl-[a-z]{2}$/i)) parts.shift();
      const type = parts[0];
      const id = parts[1];
      if (parts.length !== 2 || !(["playlist", "album", "track"] as const).includes(type as "playlist" | "album" | "track") || !validId(id)) return null;
      const height = type === "track" ? 152 : 352;
      return {
        provider: "spotify",
        embedUrl: `https://open.spotify.com/embed/${type}/${id}`,
        height,
        openUrl: `https://open.spotify.com/${type}/${id}`,
        label: "Spotify",
      };
    }

    if (["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(host)) {
      let videoId: string | null = null;
      let playlistId: string | null = null;
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (host === "youtu.be") {
        videoId = parts.length === 1 ? parts[0] : null;
      } else if (parsed.pathname === "/watch") {
        videoId = parsed.searchParams.get("v");
      } else if (parts.length === 2 && ["embed", "shorts"].includes(parts[0])) {
        videoId = parts[1];
      } else if (parsed.pathname === "/playlist") {
        playlistId = parsed.searchParams.get("list");
      }

      if (validId(videoId, 11) && videoId.length === 11) {
        return {
          provider: "youtube",
          embedUrl: `https://www.youtube.com/embed/${videoId}`,
          height: 315,
          openUrl: `https://www.youtube.com/watch?v=${videoId}`,
          label: "YouTube",
        };
      }
      if (validId(playlistId)) {
        return {
          provider: "youtube",
          embedUrl: `https://www.youtube.com/embed?listType=playlist&list=${playlistId}`,
          height: 380,
          openUrl: `https://www.youtube.com/playlist?list=${playlistId}`,
          label: "YouTube",
        };
      }
    }
  } catch {
    return null;
  }
  return null;
}
