import { describe, expect, it } from "vitest";

import { effectiveVersion, formatTrackedVersion, hasVersionMismatch } from "./game-versions";

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
