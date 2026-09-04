import type { APIRoute } from "astro";

import { buildFeedEntries, renderFeedXml } from "../lib/feed-builder";

export const GET: APIRoute = async () => {
  const entries = (await buildFeedEntries()).filter((entry) => entry.completed);
  const xml = renderFeedXml(entries, {
    title: "Jasmeralia Feed (Completed Games)",
    description: "Feed of games marked completed.",
  });
  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
};
