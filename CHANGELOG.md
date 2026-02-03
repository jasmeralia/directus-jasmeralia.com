# Changelog

## [1.0.45] - 2026-02-02
- Add blue thumbnail borders for games with player_status=in_progress.
- Update border legend notes to include blue in_progress meaning.

## [1.0.44] - 2026-02-02
- Add red thumbnail borders for games with player_status=did_not_finish.
- Preserve combined border signals with reviewed/completed and S-tier priority styling.
- Update border legend notes to include did_not_finish red borders.

## [1.0.43] - 2026-02-02
- Add rainbow borders for published S-tier games across thumbnail views.
- Preserve gold (reviewed) and silver (completed) border signals, with S-tier styling taking visual priority.
- Update thumbnail border legend notes to include rainbow S-tier meaning.

## [1.0.42] - 2026-02-02
- Add silver thumbnail borders for games with player_status=completed.
- Keep gold review borders and show both markers when both conditions apply.
- Update games index border legend note.

## [1.0.41] - 2026-02-02
- Add feed item image enclosures using game/review cover art with hero-image fallback.
- Update RSS schema doc with required cover-image read permissions.

## [1.0.40] - 2026-02-02
- Expand RSS schema doc with snapshot-based datetime audit and games.published_at recommendation for true mixed chronology.

## [1.0.39] - 2026-02-02
- Use excerpted review body text in feed items instead of title-only review descriptions.
- Update RSS schema doc permissions to include reviews.body.

## [1.0.38] - 2026-02-02
- Remove reviews.summary usage from feed query and docs (field not present in schema).

## [1.0.37] - 2026-02-02
- Fix feed games query to use id-based ordering instead of unavailable date_created.
- Update RSS schema doc to reflect games id fallback behavior.

## [1.0.36] - 2026-02-02
- Fix RSS flow doc Update Data examples to use valid JSON payload format.

## [1.0.35] - 2026-02-02
- Clarify RSS flow Condition setup with proper Filter Rules JSON examples.

## [1.0.34] - 2026-02-02
- Add JSON query examples to RSS flow doc Read Data steps.

## [1.0.33] - 2026-02-02
- Expand RSS schema doc with step-by-step flow configuration and validation guidance.

## [1.0.32] - 2026-02-02
- Add combination counts to filter index jump links.

## [1.0.31] - 2026-02-02
- Sort filter index panels alphabetically by header name.
- Add a top jump panel with anchor links to each filter section.

## [1.0.30] - 2026-02-02
- Add unified RSS feed endpoint at /feed.xml for games, reviews, and tier list updates.
- Add RSS autodiscovery link in the base layout.
- Document required Directus schema and flow changes for tier-list RSS updates.

## [1.0.29] - 2026-02-02
- Fix Walkthroughs filter to use _nempty.

## [1.0.28] - 2026-02-02
- Fix Walkthroughs index filter query for Directus.

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
