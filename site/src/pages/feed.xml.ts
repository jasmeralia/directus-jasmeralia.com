import type { APIRoute } from "astro";
import { directusFetchItems } from "../lib/directus";

const siteBase =
  (import.meta.env.ASSETS_BASE_URL ??
    import.meta.env.ASSETS_URL ??
    "https://jasmeralia.com")
    .toString()
    .replace(/\/$/, "");

const xmlEscape = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const asDate = (value: unknown): Date | null => {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const itemXml = (item: {
  title: string;
  link: string;
  description: string;
  pubDate: Date;
  guid?: string;
}) => {
  const title = xmlEscape(item.title);
  const link = xmlEscape(item.link);
  const description = xmlEscape(item.description);
  const guid = xmlEscape(item.guid ?? item.link);
  return [
    "<item>",
    `<title>${title}</title>`,
    `<link>${link}</link>`,
    `<guid isPermaLink="false">${guid}</guid>`,
    `<description>${description}</description>`,
    `<pubDate>${item.pubDate.toUTCString()}</pubDate>`,
    "</item>",
  ].join("");
};

export const GET: APIRoute = async () => {
  const [games, reviews] = await Promise.all([
    directusFetchItems("games", {
      fields: ["id", "title", "slug", "date_created"],
      filter: { slug: { _nempty: true } },
      sort: ["-date_created"],
      limit: 100,
    }),
    directusFetchItems("reviews", {
      fields: ["id", "title", "slug", "summary", "published_at"],
      filter: {
        status: { _eq: "published" },
        slug: { _nempty: true },
        published_at: { _null: false },
      },
      sort: ["-published_at"],
      limit: 100,
    }),
  ]);

  let tiers: any[] = [];
  try {
    tiers = await directusFetchItems("tier_lists", {
      fields: ["id", "title", "slug", "description", "status", "updated_at", "rss_updated_at"],
      filter: { status: { _eq: "published" }, slug: { _nempty: true } },
      sort: ["-rss_updated_at", "-updated_at"],
      limit: 100,
    });
  } catch {
    tiers = await directusFetchItems("tier_lists", {
      fields: ["id", "title", "slug", "description", "status", "updated_at"],
      filter: { status: { _eq: "published" }, slug: { _nempty: true } },
      sort: ["-updated_at"],
      limit: 100,
    });
  }

  const entries = [
    ...games
      .map((game: any) => {
        const date = asDate(game.date_created);
        if (!date) return null;
        return {
          title: `New Game: ${game.title}`,
          link: `${siteBase}/games/${game.slug}/index.html`,
          description: `New game added: ${game.title}`,
          pubDate: date,
          guid: `game:${game.id}:${date.toISOString()}`,
        };
      })
      .filter(Boolean),
    ...reviews
      .map((review: any) => {
        const date = asDate(review.published_at);
        if (!date) return null;
        return {
          title: `New Review: ${review.title}`,
          link: `${siteBase}/reviews/${review.slug}/index.html`,
          description: review.summary
            ? `New review published: ${review.summary}`
            : `New review published: ${review.title}`,
          pubDate: date,
          guid: `review:${review.id}:${date.toISOString()}`,
        };
      })
      .filter(Boolean),
    ...tiers
      .map((tier: any) => {
        const date = asDate(tier.rss_updated_at ?? tier.updated_at);
        if (!date) return null;
        return {
          title: `Tier List Updated: ${tier.title}`,
          link: `${siteBase}/tiers/${tier.slug}/index.html`,
          description: tier.description || `Tier list update: ${tier.title}`,
          pubDate: date,
          guid: `tier:${tier.id}:${date.toISOString()}`,
        };
      })
      .filter(Boolean),
  ]
    .sort((a: any, b: any) => b.pubDate.getTime() - a.pubDate.getTime())
    .slice(0, 150);

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "<channel>",
    `<title>${xmlEscape("Jasmeralia Feed")}</title>`,
    `<link>${xmlEscape(siteBase)}</link>`,
    `<description>${xmlEscape("Unified feed for games, reviews, and tier list updates.")}</description>`,
    ...entries.map(itemXml),
    "</channel>",
    "</rss>",
  ].join("");

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
};
