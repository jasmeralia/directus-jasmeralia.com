import { directusFetchItems } from "./directus";
import { GAME_THUMB_FIELDS } from "./game-fields";
import { compareLabels, sortByTitle } from "./list-format";

type Developer = Record<string, unknown> & {
  slug?: string | null;
  name?: string | null;
  title?: string | null;
};

type DeveloperRelation = {
  developers_id?: { slug?: string | null } | null;
};

type Game = Record<string, unknown> & {
  id?: number | null;
  title?: string | null;
  game_status?: string | null;
  player_status?: string | null;
  developers?: DeveloperRelation[] | null;
};

type Review = Record<string, unknown> & {
  title?: string | null;
  published_at?: string | null;
  game?: { id?: number | null } | null;
};

type TierEntry = {
  game_id?: { id?: number | null } | null;
};

type DeveloperRouteSource = {
  developers: Developer[];
  games: Game[];
  reviews: Review[];
  sTierEntries: TierEntry[];
};

type StatusField = "game_status" | "player_status";

export const fetchDeveloperRouteSource = async (): Promise<DeveloperRouteSource> => {
  const [developers, games, reviews, sTierEntries] = await Promise.all([
    directusFetchItems<Developer>("developers", {
      fields: [
        "*",
        "logo.id",
        "logo.filename_disk",
        "links.id",
        "links.url",
        "links.label",
        "links.kind",
      ],
      limit: -1,
    }),
    directusFetchItems<Game>("games", {
      fields: GAME_THUMB_FIELDS,
      limit: -1,
    }),
    directusFetchItems<Review>("reviews", {
      fields: ["id", "title", "slug", "published_at", "rating", "game.id"],
      filter: { status: { _eq: "published" } },
      limit: -1,
    }),
    directusFetchItems<TierEntry>("tier_list_games", {
      fields: ["game_id.id"],
      filter: {
        rating: { _eq: "S" },
        tier_list_id: { status: { _eq: "published" } },
      },
      limit: -1,
    }),
  ]);
  return { developers, games, reviews, sTierEntries };
};

const developerSlugs = (game: Game): string[] => {
  const slugs = (game.developers ?? [])
    .map((entry) => entry?.developers_id?.slug)
    .filter((slug): slug is string => Boolean(slug));
  return [...new Set(slugs)];
};

const reviewedGameIds = (reviews: Review[]): Set<number> =>
  new Set(
    reviews
      .map((review) => review.game?.id)
      .filter((id): id is number => typeof id === "number"),
  );

const sTierGameIds = (entries: TierEntry[]): Set<number> =>
  new Set(
    entries
      .map((entry) => entry.game_id?.id)
      .filter((id): id is number => typeof id === "number"),
  );

const idsWithin = (games: Game[], ids: Set<number>): number[] =>
  games
    .map((game) => game.id)
    .filter((id): id is number => typeof id === "number" && ids.has(id));

const gamesForDeveloper = (games: Game[], slug: string): Game[] =>
  sortByTitle(
    games.filter((game) => {
      const slugs = developerSlugs(game);
      return slug === "unknown" ? slugs.length === 0 : slugs.includes(slug);
    }) as Array<Game & { title: string }>,
  );

const reviewsForGames = (reviews: Review[], games: Game[]): Review[] => {
  const gameIds = new Set(
    games
      .map((game) => game.id)
      .filter((id): id is number => typeof id === "number"),
  );
  return reviews
    .filter((review) => typeof review.game?.id === "number" && gameIds.has(review.game.id))
    .sort((left, right) => {
      const publishedOrder = (right.published_at ?? "") < (left.published_at ?? "")
        ? -1
        : (right.published_at ?? "") > (left.published_at ?? "")
          ? 1
          : 0;
      return publishedOrder || compareLabels(left.title ?? "", right.title ?? "");
    });
};

export const buildDeveloperDetailPaths = ({
  developers,
  games,
  reviews,
  sTierEntries,
}: DeveloperRouteSource) => {
  const reviewedIds = reviewedGameIds(reviews);
  const sTierIds = sTierGameIds(sTierEntries);
  const routeDevelopers: Array<Developer | null> = [
    ...developers.filter((developer) => Boolean(developer.slug)),
    null,
  ];

  return routeDevelopers.map((developer) => {
    const slug = developer?.slug ?? "unknown";
    const routeGames = gamesForDeveloper(games, slug);
    return {
      params: { slug },
      props: {
        developer,
        title: developer?.name ?? developer?.title ?? "Unknown",
        games: routeGames,
        reviews: reviewsForGames(reviews, routeGames),
        reviewedGameIdValues: idsWithin(routeGames, reviewedIds),
        sTierGameIdValues: idsWithin(routeGames, sTierIds),
      },
    };
  });
};

export const buildDeveloperStatusPaths = (
  { developers, games, reviews, sTierEntries }: DeveloperRouteSource,
  statusField: StatusField,
) => {
  const developerLabels = new Map(
    developers
      .filter((developer) => Boolean(developer.slug))
      .map((developer) => [developer.slug as string, developer.name ?? developer.slug]),
  );
  const statusValues = new Map<string, Set<string>>();
  const gamesByCombination = new Map<string, Game[]>();
  const reviewedIds = reviewedGameIds(reviews);
  const sTierIds = sTierGameIds(sTierEntries);

  for (const game of games) {
    const status = game[statusField];
    if (!status) continue;
    const slugs = developerSlugs(game);
    for (const slug of slugs.length ? slugs : ["unknown"]) {
      const key = `${slug}::${status}`;
      const combinationGames = gamesByCombination.get(key) ?? [];
      combinationGames.push(game);
      gamesByCombination.set(key, combinationGames);
      const values = statusValues.get(slug) ?? new Set<string>();
      values.add(status);
      statusValues.set(slug, values);
    }
  }

  return [...gamesByCombination.entries()]
    .filter(([key]) => {
      const [slug] = key.split("::");
      return statusValues.get(slug)!.size > 1;
    })
    .sort(([left], [right]) => compareLabels(left, right))
    .map(([key, combinationGames]) => {
      const [developer, status] = key.split("::");
      const routeGames = sortByTitle(combinationGames as Array<Game & { title: string }>);
      return {
        params: { developer, status },
        props: {
          developerLabel: developer === "unknown"
            ? "Unknown"
            : (developerLabels.get(developer) ?? developer),
          games: routeGames,
          reviewedGameIdValues: idsWithin(routeGames, reviewedIds),
          sTierGameIdValues: idsWithin(routeGames, sTierIds),
        },
      };
    });
};
