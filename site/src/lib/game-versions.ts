export type TrackedGameVersions = {
  slug?: string | null;
  version_orion?: string | null;
  version_typhoon?: string | null;
  version_gsl?: string | null;
};

export function formatTrackedVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized || null;
}

// GSL sometimes tracks a franchise as one combined game rather than splitting
// it by season/entry the way this site's Directus data does (the same pattern
// already accepted for Stray Incubus). When that happens, version_gsl reflects
// whichever entry is currently active on GSL, not the excluded one, so a raw
// differing-values comparison would be a false positive rather than a real
// out-of-date install.
const VERSION_MISMATCH_EXCLUDED_SLUGS = new Set<string>([
  // Companion of Darkness Season 1 is complete at Chapter 9; GSL's shared page
  // always reports Season 2's newest chapter instead.
  "companion-of-darkness-season-1",
]);

// Known-equivalent version label sets, keyed by slug. A game is not flagged as
// mismatched when every currently populated version value belongs to the same
// group below -- these are real installs/labels manually confirmed to
// describe the same (or a known-newer) release under a different naming
// convention than GSL uses, not an install that actually needs an update.
const KNOWN_VERSION_EQUIVALENCES: Record<string, string[][]> = {
  // The dev switched from decimal versioning to episode numbering; "0.6" and
  // "Ep. 6" name the same release.
  "beyond-time": [["0.6", "ep. 6"]],
  // GSL's version history has not caught up past the beta; the installed
  // "Public v1" build supersedes it.
  "house-of-hearts": [["ep. 2 pt. 1 beta", "ep. 2 pt. 1 public v1"]],
  // "r1" is the release build superseding the alpha GSL still lists as newest.
  "a-house-in-the-rift": [["0.8.14 alpha", "0.8.14r1"]],
};

function isKnownEquivalent(slug: string | null, distinctVersions: string[]): boolean {
  const groups = slug ? KNOWN_VERSION_EQUIVALENCES[slug] : undefined;
  if (!groups) return false;
  return groups.some((group) => distinctVersions.every((version) => group.includes(version)));
}

export function hasVersionMismatch(game: TrackedGameVersions): boolean {
  const slug = game.slug ?? null;
  if (slug && VERSION_MISMATCH_EXCLUDED_SLUGS.has(slug)) return false;

  const versions = [
    game.version_orion,
    game.version_typhoon,
    game.version_gsl,
  ]
    .map(formatTrackedVersion)
    .filter((version): version is string => version !== null)
    .map((version) => version.toLocaleLowerCase("en-US"));

  if (versions.length < 2) return false;
  const distinct = [...new Set(versions)];
  if (distinct.length <= 1) return false;
  return !isKnownEquivalent(slug, distinct);
}
