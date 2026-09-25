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
};

export type TrackedGameVersions = {
  slug?: string | null;
  player_status?: string | null;
  game_status?: string | null;
  versions?: GameVersion[] | null;
  // Kept as a read fallback while the scalar fields are dual-written.
  version_orion?: string | null;
  version_typhoon?: string | null;
  version_gsl?: string | null;
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
  const versions = (game.versions ?? []).filter((row) => row.is_current !== false);
  if (versions.length) return versions;
  const legacy: GameVersion[] = [];
  for (const source of ["orion", "typhoon", "gsl"] as const) {
    const value = game[`version_${source}`];
    if (value) legacy.push({ source, reported_version: value, is_current: true });
  }
  return legacy;
}

export function hasVersionMismatch(game: TrackedGameVersions): boolean {
  if (game.slug && VERSION_MISMATCH_EXCLUDED_SLUGS.has(game.slug)) return false;
  if (game.player_status === "completed" || game.game_status === "released") return false;
  const versions = currentVersions(game);
  const gsl = versions.find((row) => row.source === "gsl");
  const gslValue = gsl ? effectiveVersion(gsl) : null;
  const installs = versions.filter((row) => row.source !== "gsl");
  const usable = installs.filter((row) => {
    const value = effectiveVersion(row);
    return value && !PREVIEW_INSTALL_PATTERN.test(value);
  });
  if (!gslValue || usable.length === 0) return false;
  return usable.some((install) => {
    const value = effectiveVersion(install);
    if (!value) return false;
    const left = parseSemver(value.toLocaleLowerCase("en-US"));
    const right = parseSemver(gslValue.toLocaleLowerCase("en-US"));
    if (left && right) return compareSemver(left, right) < 0;
    return value.toLocaleLowerCase("en-US") !== gslValue.toLocaleLowerCase("en-US");
  });
}
