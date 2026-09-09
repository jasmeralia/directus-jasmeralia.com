export type TrackedGameVersions = {
  slug?: string | null;
  player_status?: string | null;
  game_status?: string | null;
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
// Purely numeric dotted labels (e.g. "1.0" vs "1.0.0") don't need an entry
// here -- see the semver-aware comparison below instead.
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

// A purely numeric dotted label (e.g. "0.9.21") only -- letters/words push a
// version out of this fast path and into the known-equivalence table above.
function parseSemver(value: string): number[] | null {
  if (!/^\d+(\.\d+)*$/.test(value)) return null;
  return value.split(".").map(Number);
}

// Compares zero-padded so "1.0" and "1.0.0" are equal, matching how these
// installs actually describe the same release.
function compareSemver(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// Orion/Typhoon installs that are only a taste-test demo/intro/prologue
// aren't the real target version -- they exist to gauge interest, not to
// track for updates, so they shouldn't drive a mismatch flag either way.
const PREVIEW_INSTALL_PATTERN = /^(demo|intro|prologue)\b/i;

function isPreviewInstall(value: string | null): boolean {
  return value !== null && PREVIEW_INSTALL_PATTERN.test(value);
}

export function hasVersionMismatch(game: TrackedGameVersions): boolean {
  const slug = game.slug ?? null;
  if (slug && VERSION_MISMATCH_EXCLUDED_SLUGS.has(slug)) return false;
  if (game.player_status === "completed" || game.game_status === "released") return false;

  const orion = formatTrackedVersion(game.version_orion);
  const typhoon = formatTrackedVersion(game.version_typhoon);
  const gsl = formatTrackedVersion(game.version_gsl);
  if (isPreviewInstall(orion) || isPreviewInstall(typhoon)) return false;

  const versions = [orion, typhoon, gsl]
    .filter((version): version is string => version !== null)
    .map((version) => version.toLocaleLowerCase("en-US"));
  if (versions.length < 2) return false;

  const distinct = [...new Set(versions)];
  if (distinct.length <= 1) return false;
  if (isKnownEquivalent(slug, distinct)) return false;

  // If GSL's own record is a parseable version and every populated installed
  // copy is a parseable version at or ahead of it, GSL is simply stale --
  // there is nothing newer to install, so this isn't a real mismatch.
  const gslSemver = gsl ? parseSemver(gsl.toLocaleLowerCase("en-US")) : null;
  if (gslSemver) {
    const installedSemvers = [orion, typhoon]
      .filter((version): version is string => version !== null)
      .map((version) => parseSemver(version.toLocaleLowerCase("en-US")));
    if (
      installedSemvers.length > 0 &&
      installedSemvers.every((version) => version !== null && compareSemver(version, gslSemver) >= 0)
    ) {
      return false;
    }
  }

  return true;
}
