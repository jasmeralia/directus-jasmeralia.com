import { describe, expect, it } from "vitest";

import {
  CONTENT_RATINGS,
  CONTENT_RATING_META,
  contentRating,
  hasGenreSlug,
  isContentRating,
  isGameNsfw,
  isTierBoardEntryNsfw,
  isTierListNsfw,
} from "./nsfw";

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

describe("content rating", () => {
  it("buckets a game into exactly one rating slug", () => {
    expect(contentRating({ nsfw: true })).toBe("nsfw");
    expect(contentRating({ genres: [{ genres_id: { nsfw: true } }] })).toBe("nsfw");
    expect(contentRating({ nsfw: false, genres: [{ genres_id: { nsfw: false } }] })).toBe("sfw");
    expect(contentRating({})).toBe("sfw");
  });

  it("validates route params", () => {
    expect(isContentRating("sfw")).toBe(true);
    expect(isContentRating("nsfw")).toBe(true);
    expect(isContentRating("mature")).toBe(false);
    expect(isContentRating(undefined)).toBe(false);
  });

  it("has metadata for every rating", () => {
    for (const rating of CONTENT_RATINGS) {
      expect(CONTENT_RATING_META[rating].label).toBeTruthy();
      expect(CONTENT_RATING_META[rating].description).toBeTruthy();
    }
  });
});
