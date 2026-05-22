import { directusFetchItems } from "../lib/directus";
import { sortByTitle } from "../lib/list-format";

export async function GET() {
  const games = sortByTitle(await directusFetchItems<{ title: string }>("games", {
    fields: ["title"],
    filter: { genres: { genres_id: { slug: { _eq: "avn" } } } },
    limit: -1,
  }));

  const body = games.map((game) => game.title).join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
