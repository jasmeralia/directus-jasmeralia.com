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
