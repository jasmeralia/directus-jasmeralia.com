import type { APIRoute } from "astro";
import { directusFetchItems } from "../lib/directus";

const siteBase =
  (import.meta.env.ASSETS_BASE_URL ??
    import.meta.env.ASSETS_URL ??
    "https://jasmeralia.com")
    .toString()
    .replace(/\/$/, "");
const HERO_IMAGE = { id: "1ddf76e1-bbf2-42f4-9250-bd17bc3bb92c", filename_disk: "1ddf76e1-bbf2-42f4-9250-bd17bc3bb92c.png" };

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

const reviewExcerpt = (body: unknown, maxLen = 220): string => {
  if (!body) return "";
  const text = String(body)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~>-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length > maxLen ? `${text.slice(0, maxLen - 1).trimEnd()}…` : text;
};

const itemXml = (item: {
  title: string;
  link: string;
  description: string;
  pubDate: Date;
  imageUrl?: string;
  guid?: string;
}) => {
  const title = xmlEscape(item.title);
  const link = xmlEscape(item.link);
  const description = xmlEscape(item.description);
  const guid = xmlEscape(item.guid ?? item.link);
  const imageUrl = item.imageUrl ? xmlEscape(item.imageUrl) : "";
  const imageType = item.imageUrl ? xmlEscape(imageMimeType(item.imageUrl)) : "";
  return [
    "<item>",
    `<title>${title}</title>`,
    `<link>${link}</link>`,
    `<guid isPermaLink="false">${guid}</guid>`,
    `<description>${description}</description>`,
    imageUrl ? `<enclosure url="${imageUrl}" type="${imageType}" />` : "",
    `<pubDate>${item.pubDate.toUTCString()}</pubDate>`,
    "</item>",
  ].join("");
};

const mediaUrl = (file: any): string | null => {
  if (!file) return null;
  const id = typeof file === "string" ? file : file.id;
  const filenameDisk = typeof file === "string" ? null : file.filename_disk ?? null;
  if (!id) return null;
  return `${siteBase}/media/${filenameDisk || id}`;
};

const imageMimeType = (url: string): string => {
  const lower = url.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".avif")) return "image/avif";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "image/jpeg";
};

export const GET: APIRoute = async () => {
  const [games, reviews] = await Promise.all([
    directusFetchItems("games", {
      fields: ["id", "title", "slug", "cover_image.id", "cover_image.filename_disk"],
      filter: { slug: { _nempty: true } },
      sort: ["-id"],
      limit: 100,
    }),
    directusFetchItems("reviews", {
      fields: ["id", "title", "slug", "body", "published_at", "game.cover_image.id", "game.cover_image.filename_disk"],
      filter: {
        status: { _eq: "published" },
        slug: { _nempty: true },
        published_at: { _null: false },
      },
      sort: ["-published_at"],
      limit: 100,
    }),
  ]);
  const fallbackImage = mediaUrl(HERO_IMAGE);

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
      .map((game: any, index: number) => {
        // games collection does not expose a created timestamp in current schema/policy.
        // Keep recency ordering by id and synthesize a stable per-build date for RSS metadata.
        const date = new Date(Date.now() - index * 1000);
        return {
          title: `New Game: ${game.title}`,
          link: `${siteBase}/games/${game.slug}/index.html`,
          description: `New game added: ${game.title}`,
          imageUrl: mediaUrl(game.cover_image) || fallbackImage || undefined,
          pubDate: date,
          guid: `game:${game.id}:${date.toISOString()}`,
        };
      })
      .filter(Boolean),
    ...reviews
      .map((review: any) => {
        const date = asDate(review.published_at);
        if (!date) return null;
        const excerpt = reviewExcerpt(review.body);
        return {
          title: `New Review: ${review.title}`,
          link: `${siteBase}/reviews/${review.slug}/index.html`,
          description: excerpt || `New review published: ${review.title}`,
          imageUrl: mediaUrl(review.game?.cover_image) || fallbackImage || undefined,
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
          imageUrl: fallbackImage || undefined,
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
