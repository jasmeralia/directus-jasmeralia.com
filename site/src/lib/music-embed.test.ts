import { describe, expect, it } from "vitest";
import { resolveMusicEmbed, safeHttpUrl } from "./music-embed";

describe("resolveMusicEmbed", () => {
  it.each([
    ["https://open.spotify.com/playlist/AbCd_123?si=ignored", "playlist", "AbCd_123", 352],
    ["https://open.spotify.com/album/album-1", "album", "album-1", 352],
    ["https://open.spotify.com/track/track_1", "track", "track_1", 152],
    ["https://open.spotify.com/intl-de/playlist/AbCd_123?si=x&foo=y", "playlist", "AbCd_123", 352],
  ])("resolves Spotify URL %s", (url, type, id, height) => {
    expect(resolveMusicEmbed(url)).toEqual({
      provider: "spotify",
      embedUrl: `https://open.spotify.com/embed/${type}/${id}`,
      height,
      openUrl: `https://open.spotify.com/${type}/${id}`,
      label: "Spotify",
    });
  });

  it.each([
    "https://youtube.com/watch?v=abcdefghijk",
    "https://www.youtube.com/watch?v=abcdefghijk&list=PL123",
    "https://m.youtube.com/watch?v=abcdefghijk",
    "https://music.youtube.com/watch?v=abcdefghijk",
    "https://youtu.be/abcdefghijk",
    "https://www.youtube.com/embed/abcdefghijk",
    "https://www.youtube.com/shorts/abcdefghijk",
  ])("resolves YouTube video URL %s", (url) => {
    expect(resolveMusicEmbed(url)).toEqual({
      provider: "youtube",
      embedUrl: "https://www.youtube.com/embed/abcdefghijk",
      height: 315,
      openUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      label: "YouTube",
    });
  });

  it.each([
    "https://youtube.com/playlist?list=PL_123",
    "https://www.youtube.com/playlist?list=PL_123&feature=share",
    "https://m.youtube.com/playlist?list=PL_123",
    "https://music.youtube.com/playlist?list=PL_123",
  ])("resolves YouTube playlist URL %s", (url) => {
    expect(resolveMusicEmbed(url)).toEqual({
      provider: "youtube",
      embedUrl: "https://www.youtube.com/embed?listType=playlist&list=PL_123",
      height: 380,
      openUrl: "https://www.youtube.com/playlist?list=PL_123",
      label: "YouTube",
    });
  });

  it.each([
    null,
    undefined,
    "",
    "   ",
    "javascript:alert(1)",
    "data:text/html,hello",
    "https://notspotify.com/playlist/abc",
    "https://open.spotify.com.evil.com/playlist/abc",
    "https://open.spotify.com@evil.com/playlist/abc",
    "https://evil.com@open.spotify.com/playlist/abc",
    "https://spotify.com/playlist/abc",
    "https://youtube.com.evil.com/watch?v=abcdefghijk",
    "https://youtu.be.evil.com/abcdefghijk",
    "https://open.spotify.com/artist/abc",
    "https://open.spotify.com/show/abc",
    "https://open.spotify.com/playlist/abc/extra",
    "https://open.spotify.com/playlist/bad.id",
    `https://open.spotify.com/track/${"a".repeat(65)}`,
    "https://youtube.com/channel/abcdefghijk",
    "https://youtube.com/watch?v=short",
    "https://youtube.com/watch?v=bad.id12345",
    "https://youtube.com/playlist?list=bad.id",
    "https://youtube.com/playlist",
    "https://youtube.com/shorts/abcdefghij",
    "https://youtube.com/watch?v=abcdefghijk&list=PL123".replace("abcdefghijk", "short"),
  ])("rejects unsupported or unsafe URL %s", (url) => {
    expect(resolveMusicEmbed(url)).toBeNull();
  });
});

describe("safeHttpUrl", () => {
  it("passes through http and https URLs", () => {
    expect(safeHttpUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeHttpUrl("  http://example.com/  ")).toBe("http://example.com/");
  });

  it.each(["javascript:alert(1)", "data:text/html,hi", "ftp://example.com/x", "not a url", "", "   ", null, undefined])(
    "rejects %s",
    (value) => {
      expect(safeHttpUrl(value as string | null | undefined)).toBeNull();
    },
  );
});
