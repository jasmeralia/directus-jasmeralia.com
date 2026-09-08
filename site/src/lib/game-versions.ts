export type TrackedGameVersions = {
  version_orion?: string | null;
  version_typhoon?: string | null;
  version_gsl?: string | null;
};

export function formatTrackedVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized || null;
}

export function hasVersionMismatch(game: TrackedGameVersions): boolean {
  const versions = [
    game.version_orion,
    game.version_typhoon,
    game.version_gsl,
  ]
    .map(formatTrackedVersion)
    .filter((version): version is string => version !== null)
    .map((version) => version.toLocaleLowerCase("en-US"));

  return versions.length >= 2 && new Set(versions).size > 1;
}
