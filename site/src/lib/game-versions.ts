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

function isBehindGsl(value: string, gslValue: string): boolean {
  const left = parseSemver(value.toLocaleLowerCase("en-US"));
  const right = parseSemver(gslValue.toLocaleLowerCase("en-US"));
  if (left && right) return compareSemver(left, right) < 0;
  return value.toLocaleLowerCase("en-US") !== gslValue.toLocaleLowerCase("en-US");
}

export type InstallComparison = "current" | "behind" | "preview" | "unrecorded";

// How one Orion/Typhoon installation stands against the current GSL value.
// "preview" is a demo/intro/prologue install, which is never held against GSL.
export function compareInstallToGsl(install: GameVersion, gslValue: string | null): InstallComparison {
  const value = effectiveVersion(install);
  if (!value || !gslValue) return "unrecorded";
  if (PREVIEW_INSTALL_PATTERN.test(value)) return "preview";
  return isBehindGsl(value, gslValue) ? "behind" : "current";
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
    .some((install) => compareInstallToGsl(install, gslValue) === "behind");
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
