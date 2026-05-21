import { marked } from "marked";
import type { Tokens } from "marked";

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
