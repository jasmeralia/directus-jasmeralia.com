import { describe, expect, it } from "vitest";

import { plainTextExcerpt, renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("renders spoiler syntax", () => {
    expect(renderMarkdown("Secret: ||the answer||")).toContain(
      '<span class="spoiler">the answer</span>',
    );
  });

  it("adds safe new-window attributes only to external links", () => {
    expect(renderMarkdown("[External](https://example.com)")).toContain(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">External</a>',
    );
    const relative = renderMarkdown("[Local](/games/example)");
    expect(relative).toContain('<a href="/games/example">Local</a>');
    expect(relative).not.toContain('target="_blank"');
    expect(renderMarkdown('[Titled](/games/example "Game page")')).toContain(
      '<a href="/games/example" title="Game page">Titled</a>',
    );
    expect(renderMarkdown("[No target]()")).toContain("<p>No target</p>");
  });

  it("renders basic bold text and lists", () => {
    const html = renderMarkdown("**Bold**\n\n- One\n- Two");
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>One</li>");
  });

  it("handles nullish input safely", () => {
    expect(renderMarkdown(null as unknown as string)).toBe("");
    expect(renderMarkdown(undefined as unknown as string)).toBe("");
  });
});

describe("plainTextExcerpt", () => {
  it("strips markdown formatting down to plain text", () => {
    expect(plainTextExcerpt("**Bold** and _italic_ with a [link](https://example.com)"))
      .toBe("Bold and italic with a link");
  });

  it("drops spoiler-tagged text entirely, not just its markers", () => {
    const result = plainTextExcerpt("The hero survives, but ||the mentor dies|| in the end.");
    expect(result).not.toContain("mentor dies");
    expect(result).toBe("The hero survives, but in the end.");
  });

  it("truncates long text at a word boundary and appends an ellipsis", () => {
    const long = "word ".repeat(60).trim();
    const result = plainTextExcerpt(long, 20);
    expect(result.length).toBeLessThanOrEqual(23);
    expect(result.endsWith("...")).toBe(true);
    expect(result).not.toContain("  ");
  });

  it("leaves short text untouched aside from whitespace collapsing", () => {
    expect(plainTextExcerpt("A short review.", 200)).toBe("A short review.");
  });

  it("decodes HTML entities produced by markdown rendering", () => {
    expect(plainTextExcerpt("Rock & Roll -- \"quoted\"")).toBe('Rock & Roll -- "quoted"');
  });

  it("handles nullish and empty input safely", () => {
    expect(plainTextExcerpt(null)).toBe("");
    expect(plainTextExcerpt(undefined)).toBe("");
    expect(plainTextExcerpt("")).toBe("");
  });
});
