import { sectionDataState, type BundleAwareGame } from "./game-bundles";

// Shared definitions for the AVN + Missing Section Data misc filters. The
// AVN genre itself is matched by the caller (a Directus filter on the pages,
// hasAvnGenre on the filters index).

export const INCOMPLETE_PLAYER_STATUSES = new Set([
  "not_started",
  "plan_to_play",
  "in_progress",
  "on_hold",
  "waiting_for_update",
]);

// Not out yet, or dead: never "incomplete" to play. Games with no release
// status stay in.
export const INCOMPLETE_EXCLUDED_GAME_STATUSES = new Set(["unreleased", "abandoned"]);

export const CURRENTLY_COMPLETE_PLAYER_STATUSES = new Set(["completed", "waiting_for_update"]);

type FilterGame = BundleAwareGame & {
  player_status?: string | null;
  game_status?: string | null;
};

export const isIncompleteGame = (game: FilterGame | null | undefined): boolean =>
  INCOMPLETE_PLAYER_STATUSES.has(game?.player_status ?? "")
  && !INCOMPLETE_EXCLUDED_GAME_STATUSES.has(game?.game_status ?? "");

export const isCurrentlyCompleteGame = (game: FilterGame | null | undefined): boolean =>
  CURRENTLY_COMPLETE_PLAYER_STATUSES.has(game?.player_status ?? "");

// Only the "missing" state: omnibus games with some members tracked
// ("partial") and games where sections do not apply are not missing data.
export const hasMissingSectionData = (game: BundleAwareGame | null | undefined): boolean =>
  sectionDataState(game) === "missing";
