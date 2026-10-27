import { describe, expect, it } from "vitest";

import {
  artFields,
  artFile,
  artTabFields,
  buildArtTab,
  coverImage,
  hasArtTab,
  type GameArtRow,
} from "./game-art";

const art = (
  kind: string,
  id: string,
  options: Partial<GameArtRow> & { title?: string; width?: number; height?: number } = {},
): GameArtRow => ({
  kind,
  language: options.language,
  scale: options.scale,
  sort: options.sort,
  file: options.title === undefined && options.width === undefined && options.height === undefined
    ? { id, filename_disk: `${id}.png` }
    : {
        id,
        filename_disk: `${id}.png`,
        title: options.title,
        width: options.width,
        height: options.height,
      },
});

describe("game art tab", () => {
  it("excludes portrait capsule art", () => {
    expect(buildArtTab({ art: [art("capsule", "cover")] })).toEqual([]);
  });

  it("excludes shared Ren'Py default logo and icon files", () => {
    expect(buildArtTab({ art: [
      art("logo", "default-logo", { title: "Ren'Py default logo" }),
      art("icon", "default-icon", { title: "Ren'Py default icon" }),
    ] })).toEqual([]);
  });

  it("orders groups by kind and items by language, scale, and sort", () => {
    const groups = buildArtTab({ art: [
      art("icon", "icon", { language: "en", scale: "1x" }),
      art("hero", "hero-fr", { language: "fr", scale: "1x" }),
      art("logo", "logo-null-sort", { language: "en", scale: "2x" }),
      art("wide_capsule", "wide-en-1x", { language: "en", scale: "1x", sort: 2 }),
      art("wide_capsule", "wide-en-2x-null-sort", { language: "en", scale: "2x" }),
      art("wide_capsule", "wide-en-2x-sort-2", { language: "en", scale: "2x", sort: 2 }),
      art("wide_capsule", "wide-de", { language: "de", scale: "2x", sort: 1 }),
      art("wide_capsule", "wide-en-2x-sort-1", { language: "en", scale: "2x", sort: 1 }),
      art("hero", "hero-en", { language: "en", scale: "1x" }),
    ] });

    expect(groups.map((group) => group.kind)).toEqual(["wide_capsule", "hero", "logo", "icon"]);
    expect(groups[0].items.map((item) => item.url)).toEqual([
      "https://assets.test/media/wide-en-2x-sort-1.png",
      "https://assets.test/media/wide-en-2x-sort-2.png",
      "https://assets.test/media/wide-en-2x-null-sort.png",
      "https://assets.test/media/wide-en-1x.png",
      "https://assets.test/media/wide-de.png",
    ]);
    expect(groups[1].items.map((item) => item.url)).toEqual([
      "https://assets.test/media/hero-en.png",
      "https://assets.test/media/hero-fr.png",
    ]);
  });

  it("breaks ties between equal rows by language name, scale and sort", () => {
    const urls = (rows: GameArtRow[]) => buildArtTab({ art: rows })[0].items.map((item) => item.url);
    expect(urls([
      art("hero", "hero-fr", { language: "fr", scale: "2x" }),
      art("hero", "hero-de", { language: "de", scale: "2x" }),
    ])).toEqual([
      "https://assets.test/media/hero-de.png",
      "https://assets.test/media/hero-fr.png",
    ]);
    expect(urls([
      art("hero", "hero-odd", { language: "en", scale: "3x" }),
      art("hero", "hero-none", { language: "en" }),
      art("hero", "hero-1x", { language: "en", scale: "1x" }),
    ])).toEqual([
      "https://assets.test/media/hero-1x.png",
      "https://assets.test/media/hero-odd.png",
      "https://assets.test/media/hero-none.png",
    ]);
    expect(urls([
      art("hero", "hero-a"),
      art("hero", "hero-b"),
    ])).toEqual([
      "https://assets.test/media/hero-a.png",
      "https://assets.test/media/hero-b.png",
    ]);
    expect(urls([
      art("hero", "hero-sort-1", { language: "en", scale: "2x", sort: 1 }),
      art("hero", "hero-unsorted", { language: "en", scale: "2x" }),
      art("hero", "hero-sort-0", { language: "en", scale: "2x", sort: 0 }),
    ])).toEqual([
      "https://assets.test/media/hero-sort-0.png",
      "https://assets.test/media/hero-sort-1.png",
      "https://assets.test/media/hero-unsorted.png",
    ]);
  });

  it("carries language, scale and pixel size, and accepts a bare file id", () => {
    const [group] = buildArtTab({ art: [
      art("logo", "sized", { language: "en", scale: "2x", width: 1280, height: 720 }),
      { kind: "logo", file: "bare-id" },
      { kind: "screenshot", file: { id: "ignored", filename_disk: "ignored.png" } },
    ] });
    expect(group.items).toEqual([
      {
        kind: "logo",
        label: "Logo",
        url: "https://assets.test/media/sized.png",
        language: "en",
        scale: "2x",
        width: 1280,
        height: 720,
      },
      {
        kind: "logo",
        label: "Logo",
        url: "https://assets.test/media/bare-id",
        language: null,
        scale: null,
        width: null,
        height: null,
      },
    ]);
  });

  it("drops rows without files or a public file URL", () => {
    expect(buildArtTab({ art: [
      { kind: "hero" },
      { kind: "logo", file: null },
      { kind: "icon", file: { id: "", title: "Icon" } },
    ] })).toEqual([]);
  });

  it("returns no groups for empty art", () => {
    expect(buildArtTab({})).toEqual([]);
    expect(buildArtTab({ art: [] })).toEqual([]);
  });

  it("reports whether a game has visible tab art", () => {
    expect(hasArtTab({ art: [art("capsule", "cover")] })).toBe(false);
    expect(hasArtTab({ art: [art("hero", "hero")] })).toBe(true);
    expect(hasArtTab(null)).toBe(false);
  });

  it("builds art fields with and without a relation prefix", () => {
    const fields = [
      "art.kind",
      "art.language",
      "art.scale",
      "art.sort",
      "art.file.id",
      "art.file.filename_disk",
      "art.file.title",
      "art.file.width",
      "art.file.height",
    ];
    expect(artTabFields()).toEqual(fields);
    expect(artTabFields("game_id.")).toEqual(fields.map((field) => `game_id.${field}`));
  });
});

describe("game art cover helpers", () => {
  it("returns capsule art as the cover", () => {
    const game = {
      art: [
        { kind: "hero", language: "en", file: { id: "hero", filename_disk: "hero.jpg" } },
        { kind: "capsule", language: "en", file: { id: "cover", filename_disk: "cover.jpg" } },
      ],
    };
    expect(coverImage(game)).toEqual({ id: "cover", filename_disk: "cover.jpg" });
    expect(artFile(game, "hero")).toEqual({ id: "hero", filename_disk: "hero.jpg" });
    expect(artFile(game, "logo")).toBeNull();
  });

  it("prefers the requested language and falls back to another row", () => {
    const game = {
      art: [
        { kind: "capsule", language: "fr", file: { id: "fr", filename_disk: "fr.jpg" } },
        { kind: "capsule", language: "en", file: { id: "en", filename_disk: "en.jpg" } },
      ],
    };
    expect(artFile(game, "capsule")).toEqual({ id: "en", filename_disk: "en.jpg" });
    expect(artFile(game, "capsule", "fr")).toEqual({ id: "fr", filename_disk: "fr.jpg" });
    expect(artFile({ art: [{ kind: "capsule", language: "fr", file: { id: "fr" } }] }, "capsule"))
      .toEqual({ id: "fr" });
  });

  it("wraps bare file ids and skips rows without files", () => {
    expect(coverImage({ art: [{ kind: "capsule", language: "en", file: "abc" }] }))
      .toEqual({ id: "abc" });
    expect(coverImage({ art: [{ kind: "capsule", language: "en", file: null }] })).toBeNull();
  });

  it("returns null for missing art or entity", () => {
    expect(coverImage(null)).toBeNull();
    expect(coverImage(undefined)).toBeNull();
    expect(coverImage({})).toBeNull();
    expect(coverImage({ art: null })).toBeNull();
  });

  it("builds art fields with an optional prefix and file sizes", () => {
    expect(artFields()).toEqual([
      "art.kind",
      "art.language",
      "art.file.id",
      "art.file.filename_disk",
    ]);
    expect(artFields("game_id.", true)).toContain("game_id.art.file.width");
    expect(artFields("game_id.", true)).toContain("game_id.art.file.height");
  });
});
