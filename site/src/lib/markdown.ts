import { marked } from "marked";
import type { Tokens } from "marked";

marked.use({
  extensions: [
    {
      name: "spoiler",
      level: "inline",
      start(src: string) { return src.indexOf("||"); },
      tokenizer(src: string) {
        const match = /^\|\|([^|]+?)\|\|/.exec(src);
        if (match) return { type: "spoiler", raw: match[0], text: match[1] };
      },
      renderer(token: { text: string }) {
        return `<span class="spoiler">${token.text}</span>`;
      },
    },
  ],
});

const renderer = new marked.Renderer();

// marked v5+ passes a token object, not individual (href, title, text) args
renderer.link = ({ href, title, text }: Tokens.Link) => {
  if (!href) return text;
  const isExternal = /^https?:\/\//i.test(href);
  const attrs = [
    `href="${href}"`,
    title ? `title="${title}"` : null,
    isExternal ? 'target="_blank"' : null,
    isExternal ? 'rel="noopener noreferrer"' : null,
  ].filter(Boolean).join(" ");
  return `<a ${attrs}>${text}</a>`;
};

export const renderMarkdown = (value: string): string =>
  marked.parse(value ?? "", { renderer }) as string;

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'",
};

// Plain-text excerpt for use in meta descriptions (og:description, etc).
// Spoiler-tagged text (||...||) is dropped entirely, not just unmasked --
// a public link preview must never leak spoiler content.
export const plainTextExcerpt = (value: string | null | undefined, maxLen = 200): string => {
  if (!value) return "";
  const withoutSpoilers = value.replace(/\|\|[^|]+?\|\|/g, "");
  const html = renderMarkdown(withoutSpoilers);
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;|&lt;|&gt;|&quot;|&#39;/g, (m) => HTML_ENTITIES[m])
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : maxLen)}...`;
};
