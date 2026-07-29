const escapeCsv = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const listNames = (items: unknown[], getName: (item: unknown) => string | undefined): string => {
  const names = (items ?? [])
    .map((item) => getName(item))
    .filter((name): name is string => Boolean(name));
  return names.join("; ");
};

type EngineRef = { engines_id?: { title?: string } | null };
type GenreRef = { genres_id?: { name?: string } | null };
type DeveloperRef = { developers_id?: { name?: string } | null };
type CsvBundleMember = {
  title?: string;
  player_status?: string;
};

type CsvGame = {
  title?: string;
  slug?: string;
  release_year?: number;
  game_status?: string;
  player_status?: string;
  engines?: EngineRef[];
  genres?: GenreRef[];
  developers?: DeveloperRef[];
  bundle_members?: CsvBundleMember[];
};

const GAME_HEADERS = [
  "title",
  "slug",
  "release_year",
  "game_status",
  "player_status",
  "engines",
  "genres",
  "developers",
];

const gameCsvValues = (game: CsvGame): unknown[] => {
  const engines = listNames(game?.engines ?? [], (entry) => (entry as EngineRef)?.engines_id?.title);
  const genres = listNames(game?.genres ?? [], (entry) => (entry as GenreRef)?.genres_id?.name);
  const developers = listNames(game?.developers ?? [], (entry) => (entry as DeveloperRef)?.developers_id?.name);
  return [
    game?.title,
    game?.slug,
    game?.release_year,
    game?.game_status,
    game?.player_status,
    engines,
    genres,
    developers,
  ];
};

export const gamesToCsv = (games: CsvGame[]): string => {
  const rows = (games ?? []).map((game) =>
    gameCsvValues(game).map(escapeCsv).join(","),
  );
  return [GAME_HEADERS.join(","), ...rows].join("\n");
};

export const omnibusGamesToCsv = (games: CsvGame[]): string => {
  const headers = [
    ...GAME_HEADERS,
    "member_count",
    "completed_member_count",
    "in_progress_member",
  ];
  const rows = (games ?? []).map((game) => {
    const members = game.bundle_members ?? [];
    const completed = members.filter(
      (member) => member.player_status === "completed",
    ).length;
    const active = members
      .filter((member) => member.player_status === "in_progress")
      .map((member) => member.title)
      .filter((title): title is string => Boolean(title))
      .join("; ");
    return [
      ...gameCsvValues(game),
      members.length,
      completed,
      active,
    ].map(escapeCsv).join(",");
  });
  return [headers.join(","), ...rows].join("\n");
};

type CsvTierGame = {
  rating?: string;
  game_id?: {
    title?: string;
    slug?: string;
    release_year?: number;
    player_status?: string;
  };
};

export const tierListToCsv = (tierGames: CsvTierGame[]): string => {
  const ratingOrder = ["S", "A", "B", "C", "D", "F", "U"];
  const headers = ["tier", "title", "slug", "release_year", "player_status"];
  const rows = [...(tierGames ?? [])]
    .sort((a, b) => {
      const ai = ratingOrder.indexOf(a.rating ?? "U");
      const bi = ratingOrder.indexOf(b.rating ?? "U");
      if (ai !== bi) return ai - bi;
      return (a.game_id?.title || "").localeCompare(b.game_id?.title || "", undefined, { sensitivity: "base" });
    })
    .map((entry) => {
      const game = entry.game_id;
      return [entry.rating, game?.title, game?.slug, game?.release_year, game?.player_status]
        .map(escapeCsv)
        .join(",");
    });
  return [headers.join(","), ...rows].join("\n");
};

export const csvDataUri = (csv: string): string =>
  `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
