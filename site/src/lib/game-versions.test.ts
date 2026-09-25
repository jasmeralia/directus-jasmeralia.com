import { describe, expect, it } from "vitest";

import { effectiveVersion, formatTrackedVersion, hasVersionMismatch } from "./game-versions";

describe("tracked game versions", () => {
  it("requires at least two populated sources before declaring a mismatch", () => {
    expect(hasVersionMismatch({})).toBe(false);
    expect(hasVersionMismatch({ version_orion: "0.9" })).toBe(false);
  });

  it("treats whitespace and casing differences as equivalent", () => {
    expect(hasVersionMismatch({
      version_orion: " Ch. 4   Ep. 3 ",
      version_typhoon: "ch. 4 ep. 3",
      version_gsl: "CH. 4 EP. 3",
    })).toBe(false);
  });

  it("detects a difference between any populated sources", () => {
    expect(hasVersionMismatch({
      version_orion: "0.8",
      version_typhoon: null,
      version_gsl: "0.9",
    })).toBe(true);
  });

  it("normalizes version values for display", () => {
    expect(formatTrackedVersion(" Update  32a ")).toBe("Update 32a");
    expect(formatTrackedVersion("   ")).toBeNull();
    expect(formatTrackedVersion(null)).toBeNull();
  });

  it("excludes games where GSL is known to track a different season/entry", () => {
    expect(hasVersionMismatch({
      slug: "companion-of-darkness-season-1",
      version_orion: "S1 Ch.9",
      version_typhoon: "S1 Ch.9",
      version_gsl: "S2 Ch. 12.5",
    })).toBe(false);
  });

  it("does not exclude other games sharing an otherwise-differing slug", () => {
    expect(hasVersionMismatch({
      slug: "companion-of-darkness-season-2",
      version_orion: "S2 Ch. 12",
      version_typhoon: "S2 Ch. 12",
      version_gsl: "S2 Ch. 12.5",
    })).toBe(true);
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
    expect(hasVersionMismatch({
      slug: "beyond-time",
      version_orion: "0.7",
      version_typhoon: "0.6",
      version_gsl: "Ep. 6",
    })).toBe(true);
  });

  it("treats zero-padded semver labels as equal", () => {
    expect(hasVersionMismatch({
      version_orion: "1.0.0",
      version_typhoon: "1.0.0",
      version_gsl: "1.0",
    })).toBe(false);
  });

  it("excludes a game whose installed semver is already ahead of GSL's stale record", () => {
    expect(hasVersionMismatch({
      version_orion: "0.9.21",
      version_typhoon: "0.9.21",
      version_gsl: "0.9.0",
    })).toBe(false);
  });

  it("still flags a game whose installed semver is behind GSL", () => {
    expect(hasVersionMismatch({
      version_orion: "0.9.0",
      version_typhoon: "0.9.0",
      version_gsl: "0.9.21",
    })).toBe(true);
  });

  it("excludes installs that are only a demo, intro, or prologue", () => {
    expect(hasVersionMismatch({
      version_orion: "Demo",
      version_typhoon: null,
      version_gsl: "Ep. 3",
    })).toBe(false);
    expect(hasVersionMismatch({
      version_orion: "Prologue: Part 1",
      version_typhoon: "Prologue: Part 1",
      version_gsl: "0.3",
    })).toBe(false);
  });

  it("excludes completed or released games", () => {
    expect(hasVersionMismatch({
      player_status: "completed",
      version_orion: "1.0.0",
      version_typhoon: "1.0.0",
      version_gsl: "1.0",
    })).toBe(false);
    expect(hasVersionMismatch({
      game_status: "released",
      version_orion: "0.8",
      version_typhoon: null,
      version_gsl: "0.9",
    })).toBe(false);
  });
});
