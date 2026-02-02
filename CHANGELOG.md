# Changelog

## [1.0.27] - 2026-02-02
- Add Walkthroughs index page and navbar link.
- Tighten navbar divider spacing.

## [1.0.26] - 2026-02-01
- Add pipe separators between navbar links.

## [1.0.25] - 2026-01-31
- Remove underlined whitespace in composite filter links.

## [1.0.24] - 2026-01-31
- Filter out superset genre status combos with zero distinct matches and note it.

## [1.0.23] - 2026-01-31
- Note superset-genre filtering on the composite filters index.

## [1.0.22] - 2026-01-31
- Skip superset-genre composite filter pages when distinct count is zero.

## [1.0.21] - 2026-01-31
- Suppress status-based composite filter pages when only one status exists per dimension.

## [1.0.20] - 2026-01-31
- Add filtering notes to all status-based composite filter sections.

## [1.0.19] - 2026-01-31
- Hide genre + status composite filters when only one status exists per genre, with a note.

## [1.0.18] - 2026-01-31
- Add a developer index pie chart with tooltip-only labels.

## [1.0.17] - 2026-01-31
- Show a dedicated unknown-genre message when no games are missing genres.

## [1.0.16] - 2026-01-31
- Hide developer + status composite filters when only one status exists per developer.
- Show a single unknown developer message when no games are missing developers.

## [1.0.15] - 2026-01-31
- Remove developer + genre composite filter pages and index section.

## [1.0.14] - 2026-01-28
- Pin npm 11.8.0 in builder image to avoid lockfile mismatches.

## [1.0.13] - 2026-01-28
- Show distinct and total counts for superset genres on composite filter index.
- Ensure composite filter genre pages include total matches for superset genres.

## [1.0.12] - 2026-01-28
- Fix GHCR workflow version tag extraction step.

## [1.0.11] - 2026-01-28
- Open external markdown and developer links in new tabs.
- Tag builder image with Astro package version in GHCR workflow.

## [1.0.10] - 2026-01-28
- Fail builder builds when `npm audit` reports vulnerabilities.

## [1.0.9] - 2026-01-28
- Add CSV download links to all game-thumbnail pages and include relationship data in exports.
- Add shared CSV helpers and extend game fields to include developer data.

## [1.0.8] - 2026-01-28
- Add Directus and Astro links to README.

## [1.0.7] - 2026-01-28
- Linkify jasmeralia.com in README.

## [1.0.6] - 2026-01-28
- Add README.md for the `directus-jasmeralia` stack.

## [1.0.5] - 2026-01-28
- Add game counts to headers on slug pages that render game thumbnail grids (including composite filters).

## [1.0.4] - 2026-01-28
- Show distinct vs total counts for superset genres on the Genres index (e.g., Visual Novel), while keeping pie chart behavior unchanged.

## [1.0.3] - 2026-01-28
- Add composite filter pages and index under `/filters`, including game_status and played_status dimensions, with counts and sorting.
- Add shared genre superset logic (visual-novel > avn; rpg > arpg/crpg/jrpg) and apply to composite filters.
- Add shared list-format helpers (formatUnknown, case-insensitive sorting) and update index pages to use them.
- Update engines chart legend/tooltips to use `<Unknown Engine>` and hide unknown when zero.
- Add genres index pie chart with superset-aware counting and legend/tooltips.
- Hide unknown list items on index pages when count is zero.
- Fix filter build issues (deep import paths, developer title field).
- Rename Astro package to `astro-jasmeralia` and bump version to 1.0.0, then subsequent bumps to 1.0.3.
