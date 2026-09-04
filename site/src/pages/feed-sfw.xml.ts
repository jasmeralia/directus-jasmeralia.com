import type { APIRoute } from "astro";

import { buildFeedEntries, renderFeedXml } from "../lib/feed-builder";

export const GET: APIRoute = async () => {
  const entries = (await buildFeedEntries()).filter((entry) => !entry.nsfw);
  const xml = renderFeedXml(entries, {
    title: "Jasmeralia Feed (SFW)",
    description: "SFW-only changelog feed: games, reviews, and tier list updates.",
  });
  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
};
