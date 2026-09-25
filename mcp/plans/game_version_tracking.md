# Game Version Tracking Plan

Move the current Orion, Typhoon, and GameStoryLog version strings into a
structured Directus collection. Preserve each source's raw label, let a person
provide a version-specific comparison override when labels cannot be reconciled
reliably, and ensure an override stops applying when GSL publishes a newer
update.

## Current state

- `games.version_orion`, `games.version_typhoon`, and `games.version_gsl` are
  nullable strings consumed by game detail pages, the Version Mismatches
  filter, the recent-updates feed, and the AVN sync digest.
- `site/src/lib/game-versions.ts` contains general comparison logic and
  game-specific equivalence exceptions.
- The AVN sync reads Orion and Typhoon shortcut manifests. It resolves a
  Directus slug, then extracts a version from each row's Game Directory value
  or uses a curated mapping. It does not scan either host's filesystem.
- The GSL sync reads update history when present and falls back to
  `current_version` when history is empty.
- Recent examples are real label differences: `0.2.0` vs. `Act 3 & 4 Beta`,
  `1.0.2` vs. `Ch. 1 P2`, `0.4.6` vs. `Update 4 Final`, and `0.4.1` vs.
  `Ch. IV`.
- The TrueNAS `steam_shortcuts_versions_needs_manual.json` file is parser
  diagnostic state. It is not the source of version values or comparison
  overrides and remains outside this design.

## Goals

1. Store source-reported versions as structured records related to a game.
2. Keep raw source labels unchanged and auditable.
3. Allow a comparison-only override for an individual GSL update.
4. Expire the active override automatically when a newer GSL update is
   received.
5. Represent multiple installed directories for one host without silently
   collapsing disagreeing versions.
6. Migrate every site and sync consumer before considering removal of the
   three scalar fields.

## Proposed data model

Use a Directus collection named `game_versions`, unless schema inspection shows
that an existing collection can serve this purpose safely. The current API
token cannot read `/items/game_versions` (403), so confirm its schema through
an authorized Directus schema view before creating or reusing it.

| Field | Purpose |
|---|---|
| `id` | Directus primary key |
| `games_id` | Required many-to-one relation to `games` |
| `source` | `gsl`, `typhoon`, or `orion` |
| `reported_version` | Exact version label reported or extracted from the source; nullable when extraction is unresolved |
| `source_key` | Stable event/observation identity used for idempotent sync |
| `source_reference` | GSL update identifier, or the host manifest's Game Directory value |
| `installation_key` | Stable host + game + directory identity for relating successive observations of one install; null for GSL |
| `release_date` | Source release date when available; null for host installations or unavailable GSL dates |
| `observed_at` | When the sync last observed this source record |
| `is_active` | Whether this host installation is still present in its manifest; GSL currentness is derived from source ordering |
| `comparison_override` | Optional human-entered value used only by mismatch comparison; initially supported for GSL records |
| `override_reason` | Why the raw GSL label and comparison value refer to the same release |

Keep one GSL row per source update, and one Orion/Typhoon row per observed
version of a manifest installation. A unique constraint on
`(games_id, source, source_key)` makes repeated syncs idempotent. For GSL,
prefer the source's stable update ID; otherwise use a stable composite derived
from release date and reported label. For host records, derive the key from
host, game, manifest directory, and reported version. This preserves prior
versions when a directory is renamed or its reported version changes. Track
the stable host installation identity separately so the sync can mark its
latest row active and older observations inactive.

`comparison_override` is deliberately separate from `reported_version`.
Version details should continue to expose GSL's original wording, with the
comparison value clearly marked when one is set. This avoids presenting a
manual interpretation as if GSL had reported it.

## Source population and sync behavior

### Typhoon and Orion

Read `docs/steam_shortcuts_typhoon.md` and `docs/steam_shortcuts_orion.md`, as
the current sync does. For each row with a Directus slug:

1. Resolve the game record.
2. Use the Game Directory value as `source_reference` and as the installation
   identity input.
3. Extract `reported_version` using the existing platform cleanup, token
   parser, and curated mappings. Preserve unresolved rows with a null version
   and a parse status or diagnostic instead of inventing a value.
4. Upsert the host observation so reruns do not duplicate it. If the version
   for an existing installation changes, add a new observation and deactivate
   its prior version row.
5. Mark host installation records inactive when their directory disappears
   from that host's manifest; do not delete version history.

The manifests are the sync's authority. This records manifest-listed
installations; it does not prove that a directory still exists on disk. A
filesystem scanner would be a separate future source if that distinction
becomes important.

### GameStoryLog

Fetch the game's `game_versions` history and current version as today. Import
history records idempotently, preserving GSL's exact `version_number` and
release date. If history is empty, represent `current_version` as the current
GSL record. When a new GSL update appears, create a new row without an
override. The prior row's override remains attached to its original update
and no longer participates in current comparison.

If GSL provides neither a stable update ID nor a reliable release date,
validate the best source key during implementation. A label-only key is not
sufficient if GSL can publish separate updates with the same label.

## Comparison and display behavior

- Compare the active/current records for each source using
  `comparison_override ?? reported_version`.
- Keep general safe normalization, such as whitespace and optional `v`
  prefixes on numeric versions.
- Replace the growing hardcoded equivalence table with per-record overrides
  for source-specific labels that need human interpretation.
- The game detail page should show source, raw label, and a visible indication
  when an override affects comparisons.
- The Version Mismatches page should use the effective comparison value while
  retaining access to each raw source label.
- Completed/released exclusions, preview-install handling, and known
  cross-entry GSL exclusions must keep their current meaning during migration.
- If more than one active directory exists for a host, show each installation
  explicitly. Decide whether any outdated active copy should flag the game or
  whether a preferred installation should be selected before implementation.

## Migration and rollout

1. **Schema discovery:** inspect Directus for an existing `game_versions`
   collection, determine available GSL update identifiers, and document the
   exact unique constraints and relation behavior.
2. **Approval and backup:** schema work requires a separate explicit go-ahead.
   Before any schema change, take a full `pg_dump` of the Directus database
   through `cms-db` on TrueNAS.
3. **Create schema:** create or adapt the collection and relations; add the
   source choices, override fields, unique indexes, and site-builder read
   permission. All data writes must use the Directus API.
4. **Backfill:** create current Orion/Typhoon records from manifests and GSL
   history from its API. Copy existing scalar values first, preserving exact
   strings. Keep `games.version_*` during rollout.
5. **Update sync:** make GSL and manifest upserts idempotent; add a dry-run
   summary that shows created, changed, deactivated, and override-cleared
   records before applying.
6. **Update consumers:** migrate game detail display, mismatch detection,
   filters index counts, recent-updates/changelog/feed handling, and the AVN
   digest to read the collection. Avoid flooding feeds with historical
   backfill rows.
7. **Validate:** exercise the four label examples above, repeat a sync to
   prove no duplicates, and simulate a newer GSL update to prove the old
   override is no longer active. Confirm multiple host installations remain
   distinguishable and absent manifest rows become inactive.
8. **Deploy:** merge the site changes, trigger the production TrueNAS site
   build, and monitor the builder logs to completion.
9. **Retire scalar fields:** only after every consumer is migrated and a
   separate explicit approval, remove `games.version_orion`,
   `games.version_typhoon`, and `games.version_gsl`.

## Decisions to settle before schema work

1. Import all available GSL update history, or only the current GSL version
   plus future updates? The recommendation is to import all available history
   once so overrides and source labels have useful context.
2. For multiple active Orion/Typhoon directories, should any outdated copy
   cause a mismatch, or should one installation be designated as preferred?
3. Should an override affect comparison only (recommended), or also replace
   the displayed source label?
4. Keep scalar compatibility fields for a transition period, then remove
   them, or retain them indefinitely as derived current-value mirrors?

## Acceptance criteria

- A GSL override applies only to the specific GSL update row it describes.
- A newly observed GSL update becomes current without inheriting the prior
  update's override.
- Raw GSL labels remain available and visible after an override is set.
- Typhoon and Orion values can be traced back to their exact manifest
  directory entries and remain separated by host.
- Repeated syncs produce no duplicate records, and removed host paths do not
  erase history.
- The mismatch page and detail page agree on current/effective source values.
- Current scalar-field consumers are migrated before any scalar field is
  removed.
