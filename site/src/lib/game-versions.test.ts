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
});
