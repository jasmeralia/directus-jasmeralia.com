import { describe, expect, it } from "vitest";

import {
  hasMissingSectionData,
  isCurrentlyCompleteGame,
  isIncompleteGame,
} from "./avn-filters";

describe("isIncompleteGame", () => {
  it("includes the not-finished play statuses, including plan_to_play", () => {
    for (const player_status of ["not_started", "plan_to_play", "in_progress", "on_hold", "waiting_for_update"]) {
      expect(isIncompleteGame({ player_status, game_status: "released" })).toBe(true);
    }
    for (const player_status of ["completed", "did_not_finish", null, undefined]) {
      expect(isIncompleteGame({ player_status })).toBe(false);
    }
  });

  it("excludes unreleased and abandoned games but keeps ones with no release status", () => {
    expect(isIncompleteGame({ player_status: "not_started", game_status: "unreleased" })).toBe(false);
    expect(isIncompleteGame({ player_status: "in_progress", game_status: "abandoned" })).toBe(false);
    expect(isIncompleteGame({ player_status: "not_started", game_status: "in_development" })).toBe(true);
    expect(isIncompleteGame({ player_status: "not_started", game_status: null })).toBe(true);
    expect(isIncompleteGame(null)).toBe(false);
  });
});

describe("isCurrentlyCompleteGame", () => {
  it("matches completed and waiting_for_update only", () => {
    expect(isCurrentlyCompleteGame({ player_status: "completed" })).toBe(true);
    expect(isCurrentlyCompleteGame({ player_status: "waiting_for_update" })).toBe(true);
    expect(isCurrentlyCompleteGame({ player_status: "in_progress" })).toBe(false);
    expect(isCurrentlyCompleteGame({ player_status: "not_started" })).toBe(false);
    expect(isCurrentlyCompleteGame(undefined)).toBe(false);
  });

  it("does not look at the release status", () => {
    expect(isCurrentlyCompleteGame({ player_status: "completed", game_status: "unreleased" })).toBe(true);
  });
});

describe("hasMissingSectionData", () => {
  const member = (section_data_status: "unknown" | "not_applicable" | "tracked") => ({
    id: 1,
    slug: "m",
    title: "M",
    section_data_status,
  });

  it("is true only for the missing state", () => {
    expect(hasMissingSectionData({ sections: [] })).toBe(true);
    expect(hasMissingSectionData({ sections: null })).toBe(true);
    expect(hasMissingSectionData({ bundle_members: [member("unknown")] })).toBe(true);
    expect(hasMissingSectionData({ sections: [{ number: 1, title: "Chapter 1" }] })).toBe(false);
    expect(hasMissingSectionData({ bundle_members: [member("tracked"), member("unknown")] })).toBe(false);
    expect(hasMissingSectionData({ bundle_members: [member("not_applicable")] })).toBe(false);
  });
});
