import { marked } from "marked";

const renderer = new marked.Renderer();

renderer.link = (href, title, text) => {
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
  marked.parse(value ?? "", { renderer });
