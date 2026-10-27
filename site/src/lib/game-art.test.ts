import { describe, expect, it } from "vitest";

import { artFields, artFile, coverImage } from "./game-art";

const file = (id: string) => ({ id, filename_disk: `${id}.jpg` });

describe("game art", () => {
  it("returns the capsule file as the cover", () => {
    const game = {
      art: [
        { kind: "hero", language: "en", file: file("hero") },
        { kind: "capsule", language: "en", file: file("cover") },
      ],
    };
    expect(coverImage(game)).toEqual(file("cover"));
    expect(artFile(game, "hero")).toEqual(file("hero"));
    expect(artFile(game, "logo")).toBeNull();
  });

  it("prefers the requested language and falls back to any row of that kind", () => {
    const game = {
      art: [
        { kind: "capsule", language: "fr", file: file("fr") },
        { kind: "capsule", language: "en", file: file("en") },
      ],
    };
    expect(artFile(game, "capsule")).toEqual(file("en"));
    expect(artFile(game, "capsule", "fr")).toEqual(file("fr"));
    expect(artFile({ art: [{ kind: "capsule", language: "fr", file: file("fr") }] }, "capsule")).toEqual(file("fr"));
  });

  it("wraps a bare file id and skips rows without a file", () => {
    expect(coverImage({ art: [{ kind: "capsule", language: "en", file: "abc" }] })).toEqual({ id: "abc" });
    expect(coverImage({ art: [{ kind: "capsule", language: "en", file: null }] })).toBeNull();
  });

  it("returns null for missing art or entity", () => {
    expect(coverImage(null)).toBeNull();
    expect(coverImage(undefined)).toBeNull();
    expect(coverImage({})).toBeNull();
    expect(coverImage({ art: null })).toBeNull();
  });

  it("builds field lists with an optional prefix and file size", () => {
    expect(artFields()).toEqual(["art.kind", "art.language", "art.file.id", "art.file.filename_disk"]);
    expect(artFields("game_id.", true)).toContain("game_id.art.file.width");
    expect(artFields("game_id.", true)).toContain("game_id.art.file.height");
  });
});
