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

export const gamesToCsv = (games: any[]): string => {
  const headers = [
    "title",
    "slug",
    "release_year",
    "game_status",
    "player_status",
    "engines",
    "genres",
    "developers",
  ];

  const rows = (games ?? []).map((game) => {
    const engines = listNames(game?.engines ?? [], (entry) => entry?.engines_id?.title);
    const genres = listNames(game?.genres ?? [], (entry) => entry?.genres_id?.name);
    const developers = listNames(game?.developers ?? [], (entry) => entry?.developers_id?.name);

    return [
      game?.title,
      game?.slug,
      game?.release_year,
      game?.game_status,
      game?.player_status,
      engines,
      genres,
      developers,
    ].map(escapeCsv).join(",");
  });

  return [headers.join(","), ...rows].join("\n");
};

export const csvDataUri = (csv: string): string =>
  `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
