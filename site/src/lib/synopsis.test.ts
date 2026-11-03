import { describe, expect, it } from "vitest";

import { synopsisBlocks, synopsisParagraphs, synopsisSourceLink } from "./synopsis";

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
