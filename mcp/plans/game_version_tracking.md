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

Create the Directus collection named `game_versions`; schema inspection
confirmed no collection by that name currently exists. Grant the site builder
read access before deploying collection-backed consumers.

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
| `recorded_at` | When this source version row was first imported or observed; do not rewrite it during unchanged daily syncs |
| `is_current` | Current GSL update, or current version observation for a manifest-listed host installation; multiple host paths can be current |
| `parse_error` | Optional explanation when a host manifest directory cannot be resolved to a version |
| `comparison_override` | Optional human-entered value used only by mismatch comparison; initially supported for GSL records |
| `override_reason` | Why the raw GSL label and comparison value refer to the same release |

Keep one GSL row per source update, and one Orion/Typhoon row per observed
version of a manifest installation. A unique `source_key`, derived from source,
game, and source record identity, makes repeated syncs idempotent. For GSL,
prefer the source's stable update ID; otherwise use a stable composite derived
from release date and reported label. For host records, derive the key from
host, game, manifest directory, and reported version. This preserves prior
versions when a directory is renamed or its reported version changes. Track
the stable host installation identity separately so the sync can mark its
latest row current and older observations not current.

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
   for an existing installation changes, add a new observation and mark its
   prior version row not current.
5. Mark host version rows not current when their installation directory
   disappears from that host's manifest; do not delete version history.

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
  explicitly. Any active Orion or Typhoon installation behind the current GSL
  comparison value flags the game.

## Migration and rollout

1. **Schema discovery:** verified `game_versions` was absent. GSL update UUIDs
   are stable and retained as `source_reference`; `source_key` is a unique
   SHA-256 identity across the collection.
2. **Backup:** before each schema or live Flow change, take a full `pg_dump`
   of the Directus database through `cms-db` on TrueNAS.
3. **Create schema — complete:** created `game_versions`, its `games_id`
   relation, source choices, unique `source_key`, override fields, and the
   Astro Readonly `fields: ["*"]` grant. The setup is in
   `mcp/scripts/setup_game_versions.py`.
4. **Backfill — complete:** pagination, blank optional trailing manifest
   cells, transient GSL retries, and the shared excluded-directory rule are
   handled. The collection has 2,612 rows: 2,215 GSL records (271 current,
   one per linked game) and 397 Orion/Typhoon observations. All 93 Orion and
   144 Typhoon included manifest installations match Directus by host, game,
   directory, and parsed version; there are no duplicate current rows. The
   older `Eternum-0.8.5-pc` directory is intentionally excluded on both hosts
   and retained as inactive history. Sixty Typhoon and 93 Orion observations
   remain as history, alongside seven current legacy scalar observations for
   games without a manifest-listed install. Stormside's GSL current value is
   `0.23.1.4`, sourced from its game page's `current_version` because the GSL
   update-history list is empty. The rebuild Flow was paused for the corrected
   run, then restored after a full backup at
   `/mnt/myzmirror/directus-jasmeralia/backups/directus_20260925_064123_before_restoring_game_versions_rebuild_flow_after_repair.sql.gz`.
   The earlier backup before that pause is
   `/mnt/myzmirror/directus-jasmeralia/backups/directus_20260925_063259_before_repausing_game_versions_rebuild_flow.sql.gz`.
   Seven confirmed comparison overrides are current, including the four
   recent examples. A House in the Rift's old override was not carried
   forward because GSL has since published 0.8.15 Alpha.
5. **Update sync — deployed and run:** private commit `03b6840` records
   individual manifest installations and all linked GSL histories, including
   games outside the AVN manifests. It continues dual-writing the scalar
   fields during migration. The TrueNAS parser cache remains diagnostic state
   only. The TrueNAS job completed successfully at 2026-09-25 07:12:58 UTC:
   144 shortcut candidates, 148 GSL-linked games outside the candidates, zero
   newly created games, zero manual-review additions, zero removed installs,
   and zero email-worthy changes. A follow-up commit `d85a7ba` ensures the
   sync also consults the shared curated mapping; comparison against every
   installed manifest directory confirms it produces the same versions for
   the current manifests.
6. **Update consumers — deployed:** game detail pages show raw source labels
   and overrides; mismatch detection uses current collection rows and flags
   any active install behind GSL; filter counts read the same records. Version
   rows remain out of recent-update feeds, matching the prior behavior that
   excluded scalar version changes and preventing a historical backfill from
   appearing as thousands of editorial updates. The corrected production
   rebuild completed successfully at 2026-09-25 06:42:14 UTC. Public pages
   for Perfect Son-In-Law, IRYS, Fleeting Memories, and Cross Realms show each
   raw GSL label and comparison value; all four are absent from the mismatch
   filter.
7. **Validate:** schema, both host manifests, all 271 GSL links/current rows,
   comparison overrides, and deployed example pages passed their audits. The
   sync run reported zero changes and zero removed installations to
   deactivate. Before scalar-field retirement, still confirm a genuinely
   removed path becomes inactive. A newer GSL update naturally becomes
   current without inheriting the older row's override.
8. **Deploy — complete:** the site PR is merged, the corrected production
   TrueNAS build succeeded, and the private sync is on `master` and has run
   successfully on TrueNAS.
9. **Retire scalar fields:** later work, after deployment and parity checks:
   take a fresh full backup and remove `games.version_orion`,
   `games.version_typhoon`, and `games.version_gsl` only after every consumer
   has moved to `game_versions`.

The production `Rebuild Site on Content Change` Flow is active and includes
`game_versions`. Its original definition was saved to the ignored
`mcp/cache/rebuild_flow_before_game_versions.json`; it was paused and restored
around each backfill repair, with full backups recorded above. The original
Flow-change backup was
`/mnt/myzmirror/directus-jasmeralia/backups/directus_20260925_054745_before_game_versions_rebuild_flow.sql.gz`.
The schema backup is
`/mnt/myzmirror/directus-jasmeralia/backups/directus_20260925_053017_before_game_versions_schema.sql.gz`.

## Settled decisions

1. Import all available GSL update history, then continue ingesting new
   updates.
2. If any active Orion/Typhoon installation is behind the current GSL value,
   flag the game as a mismatch. Show each active installation separately so
   the outdated copy is clear.
3. Overrides affect comparison only. Always preserve and display the raw
   source-reported label, marking when an override is used.
4. Keep the three scalar fields only during migration. Remove them after all
   consumers use `game_versions` and parity checks pass.

## Implementation authorization

The user has directed implementation of this plan. The full-database backup
and API-only write requirements in `AGENTS.md` still apply before schema
changes.

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
