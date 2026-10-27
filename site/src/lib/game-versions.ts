export type GameVersion = {
  id?: number;
  games_id?: number | { id?: number };
  source: "gsl" | "orion" | "typhoon";
  reported_version?: string | null;
  comparison_override?: string | null;
  override_reason?: string | null;
  source_reference?: string | null;
  installation_key?: string | null;
  is_current?: boolean;
  release_date?: string | null;
  recorded_at?: string | null;
};

export type TrackedGameVersions = {
  slug?: string | null;
  player_status?: string | null;
  game_status?: string | null;
  versions?: GameVersion[] | null;
};

export function formatTrackedVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized || null;
}

export function effectiveVersion(version: GameVersion): string | null {
  return formatTrackedVersion(version.comparison_override ?? version.reported_version);
}

const VERSION_MISMATCH_EXCLUDED_SLUGS = new Set<string>([
  "companion-of-darkness-season-1",
]);

function parseSemver(value: string): number[] | null {
  const normalized = value.replace(/^v(?=\d)/i, "");
  if (!/^\d+(\.\d+)*$/.test(normalized)) return null;
  return normalized.split(".").map(Number);
}

function compareSemver(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

const PREVIEW_INSTALL_PATTERN = /^(demo|intro|prologue)\b/i;

function currentVersions(game: TrackedGameVersions): GameVersion[] {
  return (game.versions ?? []).filter((row) => row.is_current !== false);
}

// "close" is a one-off difference: an install exactly one step behind GSL
// (0.8.15 vs 0.8.16, or 0.19.1 vs 0.20, but not 0.5 vs 0.6.9, which skips
// patch releases), or the same version with a different build or qualifier
// suffix (0.8.15r1 vs 0.8.15). An install that exactly matches the previous
// GSL release is also "close", however far apart the two numbers are. Anything
// further behind is "behind", as is a major-version difference or any value
// that cannot be parsed well enough to compare (those fall back to plain
// match / no match).
export type InstallComparison = "current" | "close" | "behind" | "preview" | "unrecorded";

type FuzzyResult = "equal" | "ahead" | "close" | "behind";

const QUALIFIER_WORDS = /\b(?:pre-?alpha|alpha|beta|early(?: access)?|final|hotfix)\b/g;

function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

type Difference = { index: number; gap: number; oneOff: boolean };

// First differing component of two padded numeric sequences. The difference is
// one-off when GSL is a single step ahead and nothing follows that component
// in GSL's number (it is the first release of the next step).
function firstDifference(install: number[], gsl: number[]): Difference | null {
  for (let index = 0; index < Math.max(install.length, gsl.length); index += 1) {
    const gap = (gsl[index] ?? 0) - (install[index] ?? 0);
    if (gap) return { index, gap, oneOff: gap === 1 && gsl.slice(index + 1).every((part) => part === 0) };
  }
  return null;
}

// Version-led values: "0.8.15r1", "v1.02.01-2", "0.8.16 Alpha", "26.9.0e".
function parseLeadingVersion(value: string): { core: number[]; suffix: string } | null {
  const match = /^v?(\d+(?:\.\d+)*)(.*)$/.exec(value);
  if (!match) return null;
  return { core: match[1].split(".").map(Number), suffix: match[2].trim() };
}

// Label-style values: "Chapter 4 Episode 5", "S2 Ch. 11". The skeleton keeps
// the words with every number replaced by "#", so two labels are only compared
// when they are the same shape.
function parseLabel(value: string): { skeleton: string; numbers: number[] } | null {
  const numbers: number[] = [];
  const skeleton = value
    .replace(QUALIFIER_WORDS, " ")
    .replace(/\bchapter\b/g, "ch")
    .replace(/\bepisode\b/g, "ep")
    .replace(/\bseason\b/g, "s")
    .replace(/\d+(?:\.\d+)*/g, (token) => {
      numbers.push(...token.split(".").map(Number));
      return " # ";
    })
    .replace(/[^a-z#]+/g, " ")
    .trim();
  return numbers.length > 0 ? { skeleton, numbers } : null;
}

function fuzzyCompare(value: string, gslValue: string): FuzzyResult {
  const left = normalizeLabel(value);
  const right = normalizeLabel(gslValue);
  if (left === right) return "equal";

  const leftVersion = parseLeadingVersion(left);
  const rightVersion = parseLeadingVersion(right);
  if (leftVersion && rightVersion) {
    const diff = firstDifference(leftVersion.core, rightVersion.core);
    if (!diff) return leftVersion.suffix === rightVersion.suffix ? "equal" : "close";
    if (diff.gap < 0) return "ahead";
    return diff.index > 0 && diff.oneOff ? "close" : "behind";
  }

  const leftLabel = parseLabel(left);
  const rightLabel = parseLabel(right);
  if (!leftVersion && !rightVersion && leftLabel && rightLabel && leftLabel.skeleton === rightLabel.skeleton) {
    const diff = firstDifference(leftLabel.numbers, rightLabel.numbers);
    if (!diff) return "equal";
    if (diff.gap < 0) return "ahead";
    return diff.oneOff ? "close" : "behind";
  }
  return "behind";
}

// How one Orion/Typhoon installation stands against the current GSL value.
// "preview" is a demo/intro/prologue install, which is never held against GSL.
export function compareInstallToGsl(
  install: GameVersion,
  gslValue: string | null,
  previousGslValue: string | null = null,
): InstallComparison {
  const value = effectiveVersion(install);
  if (!value || !gslValue) return "unrecorded";
  if (PREVIEW_INSTALL_PATTERN.test(value)) return "preview";
  const result = fuzzyCompare(value, gslValue);
  if (result === "equal" || result === "ahead") return "current";
  if (result === "behind" && previousGslValue && fuzzyCompare(value, previousGslValue) === "equal") return "close";
  return result;
}

export function hasVersionMismatch(game: TrackedGameVersions): boolean {
  if (game.slug && VERSION_MISMATCH_EXCLUDED_SLUGS.has(game.slug)) return false;
  if (
    game.player_status === "completed" ||
    game.game_status === "released" ||
    game.game_status === "abandoned"
  ) {
    return false;
  }
  const versions = currentVersions(game);
  const gsl = versions.find((row) => row.source === "gsl");
  const gslValue = gsl ? effectiveVersion(gsl) : null;
  if (!gslValue) return false;
  return versions
    .filter((row) => row.source !== "gsl")
    .some((install) => {
      const comparison = compareInstallToGsl(install, gslValue);
      return comparison === "behind" || comparison === "close";
    });
}

export type VersionsTabGroup = {
  source: GameVersion["source"];
  label: string;
  rows: GameVersion[];
};

const LEGACY_REFERENCE_PREFIX = "legacy games.version_";

function compareVersionStrings(a: string, b: string): number {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (left && right) return compareSemver(left, right);
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

// Orion/Typhoon rows migrated from the retired scalar fields carry a
// "legacy games.version_*" placeholder reference. Hide one only when a real
// install row of the same source and version exists, so a placeholder that is
// the sole record of a version is kept.
function dropRedundantLegacyRows(rows: GameVersion[]): GameVersion[] {
  const realVersions = new Set(
    rows
      .filter((row) => !row.source_reference?.startsWith(LEGACY_REFERENCE_PREFIX))
      .map((row) => `${row.source}\u0000${effectiveVersion(row) ?? ""}`),
  );
  return rows.filter(
    (row) =>
      !row.source_reference?.startsWith(LEGACY_REFERENCE_PREFIX) ||
      !realVersions.has(`${row.source}\u0000${effectiveVersion(row) ?? ""}`),
  );
}

function compareByVersionDesc(a: GameVersion, b: GameVersion): number {
  return compareVersionStrings(b.reported_version ?? "", a.reported_version ?? "");
}

// GSL rows have a real release_date (newest first, undated last). Orion and
// Typhoon rows have none; recorded_at is when the sync first saw the install
// (bulk-backfilled rows share one migration timestamp), so it orders newest
// first with the version string breaking ties.
function compareGsl(a: GameVersion, b: GameVersion): number {
  if (a.release_date && b.release_date && a.release_date !== b.release_date) {
    return b.release_date.localeCompare(a.release_date);
  }
  if (Boolean(a.release_date) !== Boolean(b.release_date)) return a.release_date ? -1 : 1;
  return compareByVersionDesc(a, b);
}

// The GSL release immediately before the current one (newest first by release
// date), or null when there is none.
export function previousGslVersion(versions: GameVersion[] | null | undefined): string | null {
  const gsl = (versions ?? []).filter((row) => row.source === "gsl").sort(compareGsl);
  const currentIndex = gsl.findIndex((row) => row.is_current !== false);
  const previous = currentIndex < 0 ? undefined : gsl[currentIndex + 1];
  return previous ? effectiveVersion(previous) : null;
}

function compareInstall(a: GameVersion, b: GameVersion): number {
  const byRecorded = (b.recorded_at ?? "").localeCompare(a.recorded_at ?? "");
  return byRecorded || compareByVersionDesc(a, b);
}

// Groups for the game detail Versions tab, in display order: GSL, Typhoon,
// Orion. Empty groups are omitted.
export function buildVersionsTab(versions: GameVersion[] | null | undefined): VersionsTabGroup[] {
  const rows = versions ?? [];
  const gsl = rows.filter((row) => row.source === "gsl").sort(compareGsl);
  const installs = dropRedundantLegacyRows(rows.filter((row) => row.source !== "gsl"));
  const typhoon = installs.filter((row) => row.source === "typhoon").sort(compareInstall);
  const orion = installs.filter((row) => row.source === "orion").sort(compareInstall);
  const groups: VersionsTabGroup[] = [
    { source: "gsl", label: "GameStoryLog", rows: gsl },
    { source: "typhoon", label: "Typhoon", rows: typhoon },
    { source: "orion", label: "Orion", rows: orion },
  ];
  return groups.filter((group) => group.rows.length > 0);
}
