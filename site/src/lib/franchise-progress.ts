import { isCurrentlyCompleteGame } from "./avn-filters";
import { hasGenreSlug } from "./nsfw";

export type FranchiseGameEntry = {
  franchise_id?: number | null;
  game_id?: {
    player_status?: string | null;
    genres?: { genres_id?: { slug?: string | null } | null }[] | null;
  } | null;
} | null | undefined;

export type FranchiseCounts = { total: number; completed: number };

// AVNs are usually never "finished" while the developer keeps releasing, so an
// AVN waiting for an update counts as completed (the same "currently complete"
// rule the AVN filters use). Every other game needs player_status "completed".
export const isFranchiseGameCompleted = (game: NonNullable<FranchiseGameEntry>["game_id"]): boolean => {
  if (!game) return false;
  if (game.player_status === "completed") return true;
  return hasGenreSlug(game, "avn") && isCurrentlyCompleteGame(game);
};

// Tallies, per franchise_id, how many franchise_games rows exist and how many of
// them point at a completed game (see isFranchiseGameCompleted). Every row counts
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
    if (isFranchiseGameCompleted(entry?.game_id)) current.completed += 1;
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
