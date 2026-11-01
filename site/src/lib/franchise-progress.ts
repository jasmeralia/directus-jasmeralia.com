export type FranchiseGameEntry = {
  franchise_id?: number | null;
  game_id?: { player_status?: string | null } | null;
} | null | undefined;

export type FranchiseCounts = { total: number; completed: number };

// Tallies, per franchise_id, how many franchise_games rows exist and how many of
// them point at a game whose player_status is "completed". Every row counts
// toward `total` (matching the previous plain game count), even when the
// related game could not be expanded.
export const countFranchiseGames = (
  entries: readonly FranchiseGameEntry[] | null | undefined
): Map<number, FranchiseCounts> => {
  const counts = new Map<number, FranchiseCounts>();
  for (const entry of entries ?? []) {
    const id = entry?.franchise_id;
    if (typeof id !== "number") continue;
    const current = counts.get(id) ?? { total: 0, completed: 0 };
    current.total += 1;
    if (entry?.game_id?.player_status === "completed") current.completed += 1;
    counts.set(id, current);
  }
  return counts;
};

// "(4)" when nothing is completed, otherwise "(3 of 4 games completed, 75%)".
export const formatFranchiseCount = ({ total, completed }: FranchiseCounts): string => {
  if (completed <= 0 || total <= 0) return `(${total})`;
  const percent = Math.round((completed / total) * 100);
  return `(${completed} of ${total} ${total === 1 ? "game" : "games"} completed, ${percent}%)`;
};
