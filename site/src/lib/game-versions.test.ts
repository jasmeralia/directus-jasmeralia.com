import { describe, expect, it } from "vitest";

import {
  buildVersionsTab,
  compareInstallToGsl,
  effectiveVersion,
  formatTrackedVersion,
  hasVersionMismatch,
} from "./game-versions";

type Source = "orion" | "typhoon" | "gsl";

const current = (source: Source, reported_version: string | null) => ({
  source,
  reported_version,
  is_current: true,
});

// Build a game's current game_versions rows; a null source is simply absent.
const versionsOf = (
  orion: string | null,
  typhoon: string | null,
  gsl: string | null,
  extra: Record<string, unknown> = {},
) => ({
  ...extra,
  versions: [
    ...(orion === null ? [] : [current("orion", orion)]),
    ...(typhoon === null ? [] : [current("typhoon", typhoon)]),
    ...(gsl === null ? [] : [current("gsl", gsl)]),
  ],
});

describe("tracked game versions", () => {
  it("requires at least two populated sources before declaring a mismatch", () => {
    expect(hasVersionMismatch({})).toBe(false);
    expect(hasVersionMismatch(versionsOf("0.9", null, null))).toBe(false);
  });

  it("treats whitespace and casing differences as equivalent", () => {
    expect(hasVersionMismatch(versionsOf(" Ch. 4   Ep. 3 ", "ch. 4 ep. 3", "CH. 4 EP. 3"))).toBe(false);
  });

  it("detects a difference between any populated sources", () => {
    expect(hasVersionMismatch(versionsOf("0.8", null, "0.9"))).toBe(true);
  });

  it("normalizes version values for display", () => {
    expect(formatTrackedVersion(" Update  32a ")).toBe("Update 32a");
    expect(formatTrackedVersion("   ")).toBeNull();
    expect(formatTrackedVersion(null)).toBeNull();
  });

  it("excludes games where GSL is known to track a different season/entry", () => {
    expect(hasVersionMismatch(versionsOf("S1 Ch.9", "S1 Ch.9", "S2 Ch. 12.5", { slug: "companion-of-darkness-season-1" }))).toBe(false);
  });

  it("excludes completed, released, and abandoned games", () => {
    expect(hasVersionMismatch(versionsOf("0.8", null, "0.9", { player_status: "completed" }))).toBe(false);
    expect(hasVersionMismatch(versionsOf("0.8", null, "0.9", { game_status: "released" }))).toBe(false);
    expect(hasVersionMismatch(versionsOf("0.8", null, "0.9", { game_status: "abandoned" }))).toBe(false);
    expect(hasVersionMismatch(versionsOf("0.8", null, "0.9", { game_status: "in_development" }))).toBe(true);
  });

  it("does not exclude other games sharing an otherwise-differing slug", () => {
    expect(hasVersionMismatch(versionsOf("S2 Ch. 12", "S2 Ch. 12", "S2 Ch. 12.5", { slug: "companion-of-darkness-season-2" }))).toBe(true);
  });

  it("uses update-scoped overrides for differently named GSL releases", () => {
    const gslVersion = {
      source: "gsl" as const,
      reported_version: "Update 4 Final",
      comparison_override: "0.4.6",
      is_current: true,
    };
    expect(effectiveVersion(gslVersion)).toBe("0.4.6");
    expect(gslVersion.reported_version).toBe("Update 4 Final");
    expect(hasVersionMismatch({
      versions: [
        { source: "orion", reported_version: "0.4.6", is_current: true },
        gslVersion,
      ],
    })).toBe(false);
    expect(hasVersionMismatch({
      versions: [
        { source: "typhoon", reported_version: "1.0.2", is_current: true },
        { source: "gsl", reported_version: "Ch. 1 P2", comparison_override: "1.0.2", is_current: true },
      ],
    })).toBe(false);
  });

  it("does not carry an override onto a newer GSL update", () => {
    expect(hasVersionMismatch({
      versions: [
        { source: "orion", reported_version: "0.8.14r1", is_current: true },
        { source: "gsl", reported_version: "0.8.15 Alpha", is_current: true },
        { source: "gsl", reported_version: "0.8.14 Alpha", comparison_override: "0.8.14r1", is_current: false },
      ],
    })).toBe(true);
  });

  it("still flags a known slug when a value falls outside every equivalence group", () => {
    expect(hasVersionMismatch(versionsOf("0.7", "0.6", "Ep. 6", { slug: "beyond-time" }))).toBe(true);
  });

  it("treats zero-padded semver labels as equal", () => {
    expect(hasVersionMismatch(versionsOf("1.0.0", "1.0.0", "1.0"))).toBe(false);
  });

  it("excludes a game whose installed semver is already ahead of GSL's stale record", () => {
    expect(hasVersionMismatch(versionsOf("0.9.21", "0.9.21", "0.9.0"))).toBe(false);
  });

  it("still flags a game whose installed semver is behind GSL", () => {
    expect(hasVersionMismatch(versionsOf("0.9.0", "0.9.0", "0.9.21"))).toBe(true);
  });

  it("excludes installs that are only a demo, intro, or prologue", () => {
    expect(hasVersionMismatch(versionsOf("Demo", null, "Ep. 3"))).toBe(false);
    expect(hasVersionMismatch(versionsOf("Prologue: Part 1", "Prologue: Part 1", "0.3"))).toBe(false);
  });

  it("excludes completed or released games", () => {
    expect(hasVersionMismatch(versionsOf("1.0.0", "1.0.0", "1.0", { player_status: "completed" }))).toBe(false);
    expect(hasVersionMismatch(versionsOf("0.8", null, "0.9", { game_status: "released" }))).toBe(false);
  });
});

describe("buildVersionsTab", () => {
  const row = (source: Source, reported_version: string, extra: Record<string, unknown> = {}) => ({
    source,
    reported_version,
    ...extra,
  });

  it("orders groups GSL, Typhoon, Orion and omits empty ones", () => {
    const groups = buildVersionsTab([
      row("orion", "1.0"),
      row("gsl", "1.0", { release_date: "2025-01-01" }),
      row("typhoon", "1.0"),
    ]);
    expect(groups.map((group) => group.source)).toEqual(["gsl", "typhoon", "orion"]);
    expect(buildVersionsTab([row("gsl", "1.0")]).map((group) => group.source)).toEqual(["gsl"]);
    expect(buildVersionsTab(null)).toEqual([]);
  });

  it("sorts GSL rows by release date, newest first, undated last", () => {
    const [gsl] = buildVersionsTab([
      row("gsl", "0.1", { release_date: "2024-01-25" }),
      row("gsl", "0.0"),
      row("gsl", "0.10", { release_date: "2026-09-11" }),
      row("gsl", "0.2", { release_date: "2024-04-07" }),
    ]);
    expect(gsl.rows.map((r) => r.reported_version)).toEqual(["0.10", "0.2", "0.1", "0.0"]);
  });

  it("sorts installs by recorded_at, then version, newest first", () => {
    const bulk = "2026-09-25T05:35:15.000Z";
    const [typhoon] = buildVersionsTab([
      row("typhoon", "0.9.5", { recorded_at: bulk }),
      row("typhoon", "0.10.1", { recorded_at: bulk }),
      row("typhoon", "0.9.21", { recorded_at: "2026-10-12T10:02:54.000Z" }),
    ]);
    expect(typhoon.rows.map((r) => r.reported_version)).toEqual(["0.9.21", "0.10.1", "0.9.5"]);
  });

  it("hides a legacy placeholder only when a real install has the same version", () => {
    const legacy = "legacy games.version_orion";
    const [orion] = buildVersionsTab([
      row("orion", "0.9.5", { source_reference: legacy }),
      row("orion", "0.9.5", { source_reference: "Eternum-0.9.5-pc" }),
      row("orion", "0.7", { source_reference: legacy }),
    ]);
    expect(orion.rows.map((r) => `${r.reported_version}:${r.source_reference}`).sort()).toEqual([
      `0.7:${legacy}`,
      "0.9.5:Eternum-0.9.5-pc",
    ]);
  });
});

describe("install comparison against GSL", () => {
  const install = (reported_version: string | null, comparison_override?: string) => ({
    source: "typhoon" as const,
    reported_version,
    comparison_override,
    is_current: true,
  });
  const compare = (value: string, gsl: string) => compareInstallToGsl(install(value), gsl);

  it("classifies the basics: matching, ahead, preview, unrecorded", () => {
    expect(compare("0.9.0", "0.9")).toBe("current");
    expect(compare("0.9.21", "0.9.0")).toBe("current");
    expect(compare("Demo 0.1", "0.9")).toBe("preview");
    expect(compareInstallToGsl(install(null), "0.9")).toBe("unrecorded");
    expect(compareInstallToGsl(install("0.8"), null)).toBe("unrecorded");
  });

  it("calls an install exactly one step behind close", () => {
    expect(compare("0.8.15", "0.8.16")).toBe("close");
    expect(compare("0.8.15r1", "0.8.16 Alpha")).toBe("close");
    expect(compare("0.3.3", "0.4")).toBe("close");
    expect(compare("0.19.1", "0.20 Pre-Alpha")).toBe("close");
    expect(compare("0.2.5.1", "0.2.6")).toBe("close");
  });

  it("calls the same version with a different build or qualifier close", () => {
    expect(compare("0.8.15r1", "0.8.15")).toBe("close");
    expect(compare("0.6.1", "0.6.1_ch5")).toBe("close");
    expect(compare("0.ZF", "0.Z")).toBe("close");
  });

  it("calls anything further behind, or a major difference, behind", () => {
    expect(compare("0.8", "0.9.9")).toBe("behind");
    expect(compare("0.5", "0.6.1")).toBe("behind");
    expect(compare("0.5.1", "0.6.1")).toBe("behind");
    expect(compare("0.5.25", "0.5.75")).toBe("behind");
    expect(compare("0.1.200", "0.3")).toBe("behind");
    expect(compare("1.8.0", "1.9.5")).toBe("behind");
    expect(compare("0.91", "1.0")).toBe("behind");
    expect(compare("25.7.0", "26.9.0e")).toBe("behind");
  });

  it("fuzzy-matches label-style versions of the same shape", () => {
    expect(compare("Chapter 4 Episode 5", "Ch. 4 Ep. 5")).toBe("current");
    expect(compare("Chapter 4 Episode 4", "Ch. 4 Ep. 5")).toBe("close");
    expect(compare("Ch. 3", "Ch. 4")).toBe("close");
    expect(compare("S2 Ch. 9 Early", "S2 Ch. 11")).toBe("behind");
    expect(compare("S2 Ch. 12", "S2 Ch. 11")).toBe("current");
  });

  it("falls back to match / no match when the values cannot be compared", () => {
    expect(compare("Ch. 4", "ch. 4")).toBe("current");
    expect(compare("Ch6269", "Amber & Gold P4 (Ch. 63)")).toBe("behind");
    expect(compare("0.19", "Chapter 20")).toBe("behind");
    expect(compare("1.0", "Episode 2.1")).toBe("behind");
    expect(compare("alpha", "beta")).toBe("behind");
  });

  it("honors comparison overrides", () => {
    expect(compareInstallToGsl(install("0.4.6r1", "0.4.6"), "0.4.6")).toBe("current");
  });

  it("still lists close and behind installs as mismatches", () => {
    expect(hasVersionMismatch(versionsOf(null, "0.8.15", "0.8.16"))).toBe(true);
    expect(hasVersionMismatch(versionsOf(null, "0.8.16", "0.8.16"))).toBe(false);
  });
});
