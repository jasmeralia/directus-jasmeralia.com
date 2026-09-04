import { describe, expect, it } from "vitest";

import { hasGenreSlug, isGameNsfw, isTierBoardEntryNsfw, isTierListNsfw } from "./nsfw";

describe("NSFW status", () => {
  it("cascades from the game and linked genres", () => {
    expect(isGameNsfw({ nsfw: true })).toBe(true);
    expect(isGameNsfw({ genres: [{ genres_id: { nsfw: true } }] })).toBe(true);
    expect(isGameNsfw({ nsfw: false, genres: [{ genres_id: { nsfw: false } }] })).toBe(false);
  });

  it("cascades a tier list only on its board", () => {
    expect(isTierListNsfw({ nsfw: true })).toBe(true);
    expect(isTierBoardEntryNsfw({ nsfw: false }, { nsfw: true })).toBe(true);
    expect(isTierBoardEntryNsfw({ nsfw: true }, { nsfw: false })).toBe(true);
  });

  it("finds an exact genre slug", () => {
    const game = { genres: [{ genres_id: { slug: "avn" } }] };
    expect(hasGenreSlug(game, "avn")).toBe(true);
    expect(hasGenreSlug(game, "visual-novel")).toBe(false);
  });
});
