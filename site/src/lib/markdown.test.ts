import { describe, expect, it } from "vitest";

import { renderMarkdown } from "./markdown";

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
