import { describe, expect, it } from "vitest";

import { synopsisParagraphs } from "./synopsis";

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
