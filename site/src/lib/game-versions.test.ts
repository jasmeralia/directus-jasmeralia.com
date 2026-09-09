import { describe, expect, it } from "vitest";

import { formatTrackedVersion, hasVersionMismatch } from "./game-versions";

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

  it("treats known differently-named releases as equivalent", () => {
    expect(hasVersionMismatch({
      slug: "beyond-time",
      version_orion: "0.6",
      version_typhoon: "0.6",
      version_gsl: "Ep. 6",
    })).toBe(false);
    expect(hasVersionMismatch({
      slug: "house-of-hearts",
      version_orion: "Ep. 2 Pt. 1 Public v1",
      version_typhoon: "Ep. 2 Pt. 1 Public v1",
      version_gsl: "Ep. 2 Pt. 1 Beta",
    })).toBe(false);
    expect(hasVersionMismatch({
      slug: "a-house-in-the-rift",
      version_orion: "0.8.14r1",
      version_typhoon: "0.8.14r1",
      version_gsl: "0.8.14 Alpha",
    })).toBe(false);
  });

  it("still flags a known slug when a value falls outside every equivalence group", () => {
    expect(hasVersionMismatch({
      slug: "beyond-time",
      version_orion: "0.7",
      version_typhoon: "0.6",
      version_gsl: "Ep. 6",
    })).toBe(true);
  });
});
