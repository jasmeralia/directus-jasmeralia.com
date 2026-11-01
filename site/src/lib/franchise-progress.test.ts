import { describe, expect, it } from "vitest";

import { countFranchiseGames, formatFranchiseCount } from "./franchise-progress";

describe("countFranchiseGames", () => {
  it("counts total and completed games per franchise", () => {
    const counts = countFranchiseGames([
      { franchise_id: 1, game_id: { player_status: "completed" } },
      { franchise_id: 1, game_id: { player_status: "in_progress" } },
      { franchise_id: 1, game_id: { player_status: "completed" } },
      { franchise_id: 2, game_id: { player_status: "not_started" } },
    ]);
    expect(counts.get(1)).toEqual({ total: 3, completed: 2 });
    expect(counts.get(2)).toEqual({ total: 1, completed: 0 });
  });

  it("counts waiting_for_update as completed for AVNs only", () => {
    const avn = [{ genres_id: { slug: "avn" } }];
    const other = [{ genres_id: { slug: "rpg" } }];
    const counts = countFranchiseGames([
      { franchise_id: 1, game_id: { player_status: "waiting_for_update", genres: avn } },
      { franchise_id: 1, game_id: { player_status: "waiting_for_update", genres: other } },
      { franchise_id: 1, game_id: { player_status: "waiting_for_update" } },
      { franchise_id: 1, game_id: { player_status: "completed", genres: other } },
      { franchise_id: 1, game_id: { player_status: "in_progress", genres: avn } },
    ]);
    expect(counts.get(1)).toEqual({ total: 5, completed: 2 });
  });

  it("still counts rows whose game is missing and skips rows without a franchise id", () => {
    const counts = countFranchiseGames([
      { franchise_id: 5, game_id: null },
      { franchise_id: 5 },
      { franchise_id: null, game_id: { player_status: "completed" } },
      null,
      undefined,
    ]);
    expect([...counts.keys()]).toEqual([5]);
    expect(counts.get(5)).toEqual({ total: 2, completed: 0 });
  });

  it("handles null or undefined input", () => {
    expect(countFranchiseGames(null).size).toBe(0);
    expect(countFranchiseGames(undefined).size).toBe(0);
  });
});

describe("formatFranchiseCount", () => {
  it("keeps the plain count when nothing is completed", () => {
    expect(formatFranchiseCount({ total: 4, completed: 0 })).toBe("(4)");
    expect(formatFranchiseCount({ total: 0, completed: 0 })).toBe("(0)");
  });

  it("appends the completed number and percentage", () => {
    expect(formatFranchiseCount({ total: 4, completed: 3 })).toBe("(3 of 4 games completed, 75%)");
  });

  it("rounds the percentage to the nearest whole number", () => {
    expect(formatFranchiseCount({ total: 3, completed: 1 })).toBe("(1 of 3 games completed, 33%)");
    expect(formatFranchiseCount({ total: 3, completed: 2 })).toBe("(2 of 3 games completed, 67%)");
  });

  it("uses the singular for a single game", () => {
    expect(formatFranchiseCount({ total: 1, completed: 1 })).toBe("(1 of 1 game completed, 100%)");
  });
});
