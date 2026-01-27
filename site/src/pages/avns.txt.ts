import { directusFetchItems } from "../lib/directus";

export async function GET() {
  const games = await directusFetchItems<{ title: string }>("games", {
    fields: ["title"],
    filter: { genres: { genres_id: { slug: { _eq: "avn" } } } },
    sort: ["title"],
    limit: 1000,
  });

  const body = games.map((game) => game.title).join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
