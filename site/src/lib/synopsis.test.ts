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
    expect(synopsisBlocks("![Image](https://evil.example/image.png)", "steam")).toEqual([
      { kind: "paragraph", text: "![Image](https://evil.example/image.png)" },
    ]);
  });

  it("renders itch images only from the source page's approved media hosts", () => {
    expect(synopsisBlocks(
      "![Gameplay 1](https://cdn.imgchest.com/files/4z9cvqpk837.gif)\n![Gameplay 2](https://img.itch.zone/aW1nLzE5MTM3OTY2LmpwZw==/original/IQzIME.jpg)",
      "itch",
    )).toEqual([
      { kind: "image", src: "https://cdn.imgchest.com/files/4z9cvqpk837.gif", alt: "Gameplay 1" },
      { kind: "image", src: "https://img.itch.zone/aW1nLzE5MTM3OTY2LmpwZw==/original/IQzIME.jpg", alt: "Gameplay 2" },
    ]);
    for (const marker of [
      "![Bad](https://[broken)",
      "![Bad](http://cdn.imgchest.com/files/a.gif)",
      "![Bad](https://cdn.imgchest.com.evil.example/a.gif)",
      "![Bad](https://img.itch.zone.evil.example/a.jpg)",
      "![Bad](https://cdn.imgchest.com:444/a.gif)",
      "![Bad](https://cdn.imgchest.com/a.svg)",
    ]) {
      expect(synopsisBlocks(marker, "itch")).toEqual([{ kind: "paragraph", text: marker }]);
    }
    expect(synopsisBlocks("![Image](https://cdn.imgchest.com/files/a.gif)", "gsl")[0].kind)
      .toBe("paragraph");
  });

  it("allows validated YouTube embed markers only for itch synopses", () => {
    const marker = "![itch-video:Trailer](https://www.youtube.com/embed/DYfUZOydMZY)";
    expect(synopsisBlocks(marker, "itch")).toEqual([{
      kind: "video",
      src: "https://www.youtube-nocookie.com/embed/DYfUZOydMZY",
      title: "Trailer",
    }]);
    expect(synopsisBlocks(marker, "steam")).toEqual([{ kind: "paragraph", text: marker }]);
    for (const url of [
      "https://[broken",
      "https://youtube.com.evil.example/embed/DYfUZOydMZY",
      "http://www.youtube.com/embed/DYfUZOydMZY",
      "https://www.youtube.com/watch?v=DYfUZOydMZY",
      "https://www.youtube.com/embed/short",
      "https://www.youtube.com:444/embed/DYfUZOydMZY",
    ]) {
      const unsafeMarker = `![itch-video:Trailer](${url})`;
      expect(synopsisBlocks(unsafeMarker, "itch")).toEqual([{ kind: "paragraph", text: unsafeMarker }]);
    }
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

  it("renders source titles and ordinary images without deferring them", () => {
    const html = renderSteamSynopsis(
      '[Steam](https://store.steampowered.com/ "Store page")\n\n![Scene](https://shared.akamai.steamstatic.com/extras/scene.avif "Screenshot")',
    );
    expect(html).toContain('title="Store page"');
    expect(html).toContain('src="https://shared.akamai.steamstatic.com/extras/scene.avif"');
    expect(html).toContain('alt="Scene" title="Screenshot"');
  });

  it("rejects invalid media and preserves text for an empty HTTPS link", () => {
    const html = renderSteamSynopsis(
      "[No URL]()\n\n![steam-video:|](https://shared.akamai.steamstatic.com/extras/clip.avi)\n\n![steam-video:|](https://shared.akamai.steamstatic.com/extras/clip.webm)",
    );
    expect(html).toContain("No URL");
    expect(html).not.toContain('href="');
    expect(html).not.toContain("clip.avi");
    expect(html).toContain('src="https://shared.akamai.steamstatic.com/extras/clip.webm"');
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

  it("attributes itch synopses to one unique itch.io download page", () => {
    const link = { kind: "download" as const, url: "https://creator.itch.io/example-game" };
    expect(synopsisSourceLink("itch", [link])).toEqual({ label: "itch.io", url: link.url });
    expect(synopsisSourceLink("itch", [
      link,
      { kind: "other", url: "https://other.itch.io/profile" },
    ])).toEqual({ label: "itch.io", url: link.url });
    expect(synopsisSourceLink("itch", [link, {
      kind: "download",
      url: "https://creator.itch.io/another-game",
    }])).toBeNull();
    expect(synopsisSourceLink("itch", [
      { kind: "download", url: "http://creator.itch.io/example-game" },
      { kind: "download", url: "https://itch.io/profile/creator" },
    ])).toBeNull();
  });

  it.each([
    ["gog", "https://www.gog.com/en/game/example?ref=test#details", "GOG", "https://www.gog.com/en/game/example"],
    ["psn", "https://store.playstation.com/en-us/product/UP0001-CUSA00001_00-EXAMPLE000000000?smcid=test#details", "PlayStation Store", "https://store.playstation.com/en-us/product/UP0001-CUSA00001_00-EXAMPLE000000000"],
    ["xbox", "https://www.xbox.com/en-US/games/store/example/9N0000000000?ref=test#details", "Xbox Store", "https://www.xbox.com/en-US/games/store/example/9N0000000000"],
    ["egs", "https://store.epicgames.com/en-US/p/example?ref=test#details", "Epic Games Store", "https://store.epicgames.com/en-US/p/example"],
  ])("attributes %s synopses to a unique official game link", (source, url, label, expectedUrl) => {
    expect(synopsisSourceLink(source, [{ kind: "download", url }])).toEqual({ label, url: expectedUrl });
  });

  it("rejects unsafe and non-game storefront URLs", () => {
    expect(synopsisSourceLink("gog", [
      { kind: "download", url: "https://user@gog.com/en/game/example" },
    ])).toBeNull();
    expect(synopsisSourceLink("gog", [
      { kind: "download", url: "https://:password@gog.com/en/game/example" },
    ])).toBeNull();
    expect(synopsisSourceLink("gog", [
      { kind: "download", url: "http://www.gog.com/en/game/example" },
    ])).toBeNull();
    expect(synopsisSourceLink("psn", [
      { kind: "download", url: "https://store.playstation.com.invalid/en-us/product/123" },
      { kind: "download", url: "https://store.playstation.com/en-us/search/example" },
    ])).toBeNull();
    expect(synopsisSourceLink("xbox", [
      { kind: "download", url: "https://xbox.com.invalid/en-us/games/store/example/123" },
      { kind: "download", url: "https://www.xbox.com/en-us/search/example" },
    ])).toBeNull();
    expect(synopsisSourceLink("egs", [
      { kind: "download", url: "https://store.epicgames.com.invalid/en-us/p/example" },
      { kind: "download", url: "https://store.epicgames.com/en-us/search/example" },
    ])).toBeNull();
    expect(synopsisSourceLink("gog", [
      { kind: "other", url: "https://www.gog.com/en/game/example" },
    ])).toBeNull();
  });

  it("omits ambiguous store attribution and links for a different synopsis source", () => {
    expect(synopsisSourceLink("gog", [
      { kind: "download", url: "https://www.gog.com/en/game/example" },
      { kind: "download", url: "https://www.gog.com/en/game/another-example" },
    ])).toBeNull();
    expect(synopsisSourceLink("gog", [
      { kind: "download", url: "https://store.steampowered.com/app/123/" },
    ])).toBeNull();
  });
});
