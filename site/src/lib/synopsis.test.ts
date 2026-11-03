import { describe, expect, it } from "vitest";

import { renderSteamSynopsis, synopsisBlocks, synopsisParagraphs, synopsisSourceLink } from "./synopsis";

describe("synopsisParagraphs", () => {
  it.each([null, undefined, "", "  \n  \t\n"])("returns no paragraphs for blank input: %s", (text) => {
    expect(synopsisParagraphs(text)).toEqual([]);
  });

  it("returns a single trimmed paragraph", () => {
    expect(synopsisParagraphs("  A story.  ")).toEqual(["A story."]);
  });

  it("splits multiple paragraphs", () => {
    expect(synopsisParagraphs("First paragraph.\nSecond paragraph.")).toEqual([
      "First paragraph.",
      "Second paragraph.",
    ]);
  });

  it("splits CRLF paragraphs", () => {
    expect(synopsisParagraphs("First paragraph.\r\nSecond paragraph.")).toEqual([
      "First paragraph.",
      "Second paragraph.",
    ]);
  });

  it("drops extra blank and whitespace-only lines", () => {
    expect(synopsisParagraphs("\n First paragraph. \n\n   \n Second paragraph.\n\n")).toEqual([
      "First paragraph.",
      "Second paragraph.",
    ]);
  });
});

describe("synopsisBlocks", () => {
  it("keeps ordinary synopses as paragraph blocks", () => {
    expect(synopsisBlocks("First paragraph.\nSecond paragraph.", "gsl")).toEqual([
      { kind: "paragraph", text: "First paragraph." },
      { kind: "paragraph", text: "Second paragraph." },
    ]);
    expect(synopsisBlocks(null, "steam")).toEqual([]);
  });

  it("renders allowlisted Steam CDN image markers", () => {
    expect(synopsisBlocks(
      "![Banner](https://shared.akamai.steamstatic.com/extras/banner_%281%29.avif?t=42)",
      "steam",
    )).toEqual([{
      kind: "image",
      src: "https://shared.akamai.steamstatic.com/extras/banner_%281%29.avif?t=42",
      alt: "Banner",
    }]);
    expect(synopsisBlocks("![Legacy](https://steamcdn-a.akamaihd.net/a.jpg)", "steam")[0].kind)
      .toBe("image");
  });

  it("does not interpret non-Steam or untrusted image markers", () => {
    const marker = "![Image](https://evil.example/image.png)";
    expect(synopsisBlocks(marker, "gsl")).toEqual([{ kind: "paragraph", text: marker }]);
    expect(synopsisBlocks(marker, "steam")).toEqual([{ kind: "paragraph", text: marker }]);
    expect(synopsisBlocks("![Image](https://[broken)", "steam")).toEqual([
      { kind: "paragraph", text: "![Image](https://[broken)" },
    ]);
  });
});

describe("renderSteamSynopsis", () => {
  it("renders emphasis, links, headings, and lists from importer Markdown", () => {
    const html = renderSteamSynopsis(
      "## Chapter Two\n\n**Bold** and *italic* [Steam](https://store.steampowered.com/)\n\n- First\n- Second",
    );
    expect(html).toContain("<h2>Chapter Two</h2>");
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain('href="https://store.steampowered.com/"');
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>First</li>");
    expect(renderSteamSynopsis("Line one\nLine two")).toContain("Line one<br>Line two");
  });

  it("renders Steam video poster plus safe WebM and MP4 sources", () => {
    const html = renderSteamSynopsis(
      "![steam-video:https://shared.akamai.steamstatic.com/extras/clip.poster.avif|https://shared.akamai.steamstatic.com/extras/clip.mp4](https://shared.akamai.steamstatic.com/extras/clip.webm)",
    );
    expect(html).toContain('<video class="synopsis-video" poster="https://shared.akamai.steamstatic.com/extras/clip.poster.avif"');
    expect(html).toContain('<source src="https://shared.akamai.steamstatic.com/extras/clip.webm" type="video/webm">');
    expect(html).toContain('<source src="https://shared.akamai.steamstatic.com/extras/clip.mp4" type="video/mp4">');
    expect(html).toContain("controls playsinline preload=\"none\"");
  });

  it("defers Steam images and video media until the NSFW reveal", () => {
    const html = renderSteamSynopsis(
      "![Screenshot](https://shared.akamai.steamstatic.com/extras/scene.avif)\n\n![steam-video:https://shared.akamai.steamstatic.com/extras/clip.poster.avif|](https://shared.akamai.steamstatic.com/extras/clip.webm)",
      true,
    );
    expect(html).toContain('data-src="https://shared.akamai.steamstatic.com/extras/scene.avif"');
    expect(html).toContain('data-poster="https://shared.akamai.steamstatic.com/extras/clip.poster.avif"');
    expect(html).toContain('source data-src="https://shared.akamai.steamstatic.com/extras/clip.webm"');
    expect(html).not.toMatch(/(?:\s|<)src="https:\/\/shared\.akamai\.steamstatic\.com\/extras\//);
  });

  it("escapes raw HTML and rejects unsafe media and link URLs", () => {
    const html = renderSteamSynopsis(
      '<script>alert("xss")</script>\n\n![Bad](https://evil.example/image.png)\n\n![steam-video:https://evil.example/poster.jpg|](https://evil.example/clip.mp4)\n\n[Bad link](javascript:alert(1))',
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("evil.example");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("&lt;script&gt;");
  });

  it("rejects malformed HTTPS links", () => {
    const html = renderSteamSynopsis("[Broken link](https://[broken)");
    expect(html).not.toContain("href=");
  });
});

describe("synopsisSourceLink", () => {
  it("uses the matching source rather than another link on the game", () => {
    const links = [
      { kind: "gamestorylog" as const, url: "https://gamestorylog.com/games/example" },
      { kind: "download" as const, url: "https://store.steampowered.com/app/123/Example/?ref=test" },
    ];
    expect(synopsisSourceLink("gsl", links)).toEqual({ label: "GameStoryLog", url: links[0].url });
    expect(synopsisSourceLink("steam", links)).toEqual({ label: "Steam", url: "https://store.steampowered.com/app/123/" });
    expect(synopsisSourceLink("manual", links)).toBeNull();
  });

  it("rejects wrong kinds, lookalike hosts, unsafe URLs, and developer profiles", () => {
    expect(synopsisSourceLink("steam", [
      { kind: "other", url: "https://store.steampowered.com/app/123/" },
      { kind: "download", url: "https://store.steampowered.com.invalid/app/123/" },
      { kind: "download", url: "https://store.steampowered.com/developer/example" },
      { kind: "download", url: "javascript:alert(1)" },
      { kind: "download", url: "invalid" },
    ])).toBeNull();
    expect(synopsisSourceLink("gsl", [{ kind: "gamestorylog", url: "https://gamestorylog.com.invalid/games/example" }])).toBeNull();
  });

  it("deduplicates the same app but omits ambiguous Steam attribution", () => {
    const links = [
      { kind: "download" as const, url: "https://store.steampowered.com/app/123/" },
      { kind: "download" as const, url: "https://www.store.steampowered.com/app/123/Example" },
    ];
    expect(synopsisSourceLink("steam", links)?.label).toBe("Steam");
    expect(synopsisSourceLink("steam", [...links, { kind: "download", url: "https://store.steampowered.com/app/456/" }])).toBeNull();
    expect(synopsisSourceLink("steam", null)).toBeNull();
    expect(synopsisSourceLink(null, undefined)).toBeNull();
  });
});
