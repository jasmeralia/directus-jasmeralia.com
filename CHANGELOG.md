# Changelog

## [1.0.181] - 2026-09-04
- Game cards: show every game's effective content classification as the first card tag, with SFW in green and NSFW in red across all grids that use the shared card component.
- Guides: label every game entry as green SFW or red NSFW while retaining the existing NSFW thumbnail blur.
- Games: remove the redundant Directus-side title sort from the main index; the existing JavaScript case-insensitive sort remains the display-order source of truth.

## [1.0.180] - 2026-09-04
- Reviews: label every review's game as SFW or NSFW, with green SFW badges and red NSFW badges.
- Tier lists: keep NSFW tier-list titles visible, clearly label them in red, and collapse only their potentially sensitive descriptions until NSFW mode is enabled.
- Navigation: move the NSFW toggle beneath the search bar and remove the search field's focus expansion so the navigation has more room on tablet-sized displays.
- Filters: move all distribution charts into a dedicated linked section, place the SFW/NSFW chart last, and color its SFW segment green and NSFW segment red.
- Content: classify the Harem genre as NSFW so its games inherit the NSFW treatment.

## [1.0.179] - 2026-09-04
- Site: add a safe-by-default SFW/NSFW mode with a one-year opt-in cookie, navigation toggle, click-to-reveal cover blurring across game surfaces, collapsed NSFW Recent Updates text, and no NSFW cover art in social preview metadata.
- Content: cascade NSFW classification from games and genres, plus tier lists on their boards. Directus now has `nsfw` flags on `games`, `genres`, and `tier_lists`; AVN, AVNs, Tamer: King of Dinosaurs, and Witch Potions - Craft of Lust are initially flagged.
- Feeds/Filters: retain the combined `/feed.xml`, add `/feed-sfw.xml` and `/feed-nsfw.xml`, add an SFW/NSFW distribution chart, and add a discoverable "NSFW + Not AVN" game filter.
- Search: carry NSFW metadata into Pagefind thumbnails so SFW mode blurs them, and HTML-escape dynamic Pagefind result values before inserting result markup.
- Tooling: add `backfill_nsfw.py` for dry-run-first game, genre, and tier-list flag maintenance.

## [1.0.178] - 2026-09-04
- RSS/History: display `section_style` changes as `Section Style` with human-readable `Linear` and `Nonlinear` values instead of exposing raw Directus field and enum names.

## [1.0.177] - 2026-09-03
- Site: fix Directus's default 100-row cap silently truncating `games.sections` on any game with more than 100 chapters/quests, discovered live on *A House in the Rift*'s 269-quest journal (only the first 100 rendered). `directusFetchItems` now auto-adds a `deep[sections][_limit]=-1` override (and the `bundle_members.sections` equivalent) whenever a `games` query requests those fields, covering all ~40 existing call sites without editing each one.

## [1.0.176] - 2026-09-03
- Site: add nonlinear (quest/mission) section tracking alongside the existing linear chapter/act/episode model. Games with `section_style=nonlinear` show a category-grouped quest list on their detail page (progress reported as completed/total instead of "currently on chapter N"), and a `Linear`/`Nonlinear` tag now appears on game cards everywhere, linking to new `/section_styles/linear/` and `/section_styles/nonlinear/` filter pages. Also fixed the `Family Sharing Disabled` card tag, which was inert text unlike every other tag in that row - it now links to its existing filter page like an engine or genre tag does.
- Backend: add `mcp/scripts/populate_game_quests.py` for deterministic quest-journal-text population (`--from-txt`, matching the ALL-CAPS-category-header convention used by AVN in-game journal exports) and a `game-quests-lookup` Claude Code skill for WebSearch-sourced quest lists on games with no local journal to parse. Both share a write path (`game_sections_lib.upsert_quest_sections`) that always requires `--replace` for existing rows, since a quest list has no stable per-row identity to upsert against.

## [1.0.175] - 2026-09-01
- Site: add Open Graph and Twitter Card link previews. Every page now emits `og:*`/`twitter:*` meta tags, a canonical link, and a sitewide-default description/image, so sharing a jasmeralia.com URL in Discord/Slack/etc. renders a rich card. Game pages get a status-aware synopsis and cover art; review pages get a spoiler-safe markdown excerpt; other collection pages get a generated description (with a per-tier rating breakdown for tier lists).

## [1.0.174] - 2026-08-29
- Builder: prevent HTTP 414 failures in filter and detail pages by fetching the small published-review and S-tier collections without serializing each page's full game-ID set into the query string, then intersecting IDs in memory. All 27 affected review lookups now use the shared safe helper, and pages request their review and tier markers concurrently.

## [1.0.173] - 2026-08-29
- Builder: batch the 1,025 developer detail pages and 257 developer/status filter pages from collection-wide developer, game, review, and S-tier data in `getStaticPaths`, replacing roughly 1,282 per-page requests to each supporting collection with three batch route builds.
- Developers: replace en dashes in the developer-count chart's numeric ranges with ASCII hyphens.

## [1.0.172] - 2026-08-29
- Builder: eliminate the RSS feed's remaining Directus revision N+1. The feed now fetches complete game and bundle-member revision streams once, slices the same recent windows for output, and resolves each update's previous snapshot in memory instead of issuing one `/revisions` request per update. New-game genre names now reuse the collection-wide grouped lookup as well.

## [1.0.171] - 2026-08-29
- Builder: fix `GAME_FIELDS is not defined` build failure introduced in 1.0.170. Astro's compiler hoists `getStaticPaths()` out of its enclosing frontmatter scope, so top-level `const`/function declarations sitting alongside it (as opposed to imports) are undefined at runtime inside it. Moved `GAME_FIELDS` and the local `groupBy` helper inside `getStaticPaths()` itself.

## [1.0.170] - 2026-08-29
- Builder: eliminate the N+1 Directus fetch pattern in `games/[slug].astro`. Every one of the ~1,986 game detail pages used to independently fetch its own game record, reviews, franchise memberships, tier-list entries, and (inside `buildGameHistory`) revisions/activity/genres — roughly 14,000 of the ~25,000 Directus calls in a production build. `getStaticPaths` now batch-fetches each collection once, groups results in memory by game id, and passes each page its own pre-sliced data via Astro props; `buildGameHistory` is now a pure synchronous function instead of doing its own I/O.

## [1.0.169] - 2026-08-29
- Feed/History: the "Current Progress" changelog line now prefers a game's real per-section title (e.g. "The Arrival") over the generic noun + number, falling back to noun + number (e.g. "Episode 2") only when no matching `game_sections` row exists for that number.

## [1.0.168] - 2026-08-28
- Builder: fix Directus build-time fetch metrics (`directus_summary`/`directus_endpoint`) always reporting zero. Astro loads `astro.config.mjs`'s build-metrics integration through a separate config-bundling step from the Vite SSR pipeline that runs `directus.ts`, producing two distinct module instances of the metrics state in the same process; state now lives on `globalThis` so both share it.

## [1.0.167] - 2026-08-28
- Feed/History: rename the "Current Section" changelog field to "Current Progress" and format it using the game's own section noun (e.g. "Episode 1 → Episode 2" instead of a bare "1 → 2"), on both the RSS/Discord feed and the on-site game History tab.

## [1.0.166] - 2026-08-26
- Builder: split `astro_build` and `pagefind_index` timing stages and summarize slowest generated routes from Astro build output.
- Site: add build-time Directus fetch metrics (`directus_summary` / `directus_endpoint` timing lines) via a build-metrics Astro integration.

## [1.0.165] - 2026-08-25
- Builder: add structured `[timing]` instrumentation to `run-build.sh` and `sync-dist.mjs` for per-stage production publish profiling.

## [1.0.164] - 2026-08-25
- Games: section progress bars now give in-progress and on-hold games half credit on the current section (e.g. section 2 of 10 shows 15% instead of 20%) and always show 100% for completed games even without section data.

## [1.0.163] - 2026-08-14
- Testing: raise Vitest line coverage across `site/src/lib/` above 80% with behavioral coverage for history, recent updates, Directus helpers, and remaining edge cases.
- CI: make Codecov project and patch checks enforce their existing 80% targets instead of reporting informationally.

## [1.0.162] - 2026-08-14
- Testing: measure Vitest coverage across production TypeScript in `site/src/lib/`.
- CI: upload coverage to Codecov in informational mode while current coverage is below 80%.

## [1.0.161] - 2026-08-12
- Security: upgrade the transitive nanoid dependency to 3.3.18 to resolve CVE-2026-67213.

## [1.0.160] - 2026-07-31
- Testing: add a Vitest suite for `site/src/lib/` pure logic with fixture-based Directus mocking.
- CI: add `make test-site` and a `test-site` job that gates the builder Docker image build.
- CI: rename the ambiguous `build-publish` job to `build-publish-docker-image`.

## [1.0.159] - 2026-07-28
- Builder: use a persistent SHA-256 content manifest so only byte-changed output files are uploaded while still detecting same-size changes before CloudFront invalidation.

## [1.0.158] - 2026-07-28
- Franchises: show omnibus indicators, played status, and section or included-game progress without exposing internal slugs.
- Franchises: list omnibus members that do not already have a corresponding standalone franchise entry.
- Franchises: support per-entry notes for contextual details such as reboots and retcons.

## [1.0.157] - 2026-07-28
- Games: add explicit omnibus bundle support with independently tracked included games, member-local section progress, standalone-game backlinks, and natural detail/card presentation.
- Filters: add discoverable omnibus listings with a dedicated CSV export, and make Section Data filters bundle-aware with Partial and Not Applicable states.
- Activity: include meaningful included-game changes in game History, recent updates, and RSS using collision-resistant member event identifiers and consistent human-readable titles.
- Tooling: add curated bundle population and member-scoped section workflows with invariant checks, deletion ordering, backups, and parent rebuild triggering.

## [1.0.156] - 2026-07-28
- Filters: replace the single "In Progress + Missing Sections" misc filter with a general "Section Data + Played Status" combinatorial section, crossing whether a game has any chapter/act/episode/mission data recorded (Missing/Present) with every played status, matching the pattern used for Developer/Engine/Genre combinations.
- Filters: right-align the "Jump to top" link at the bottom of each section on `/filters`.

## [1.0.155] - 2026-07-28
- Filters: add a "Jump to top" link at the bottom of each section on `/filters` so long lists (e.g. Misc, Download Platform) don't require manual scrolling back up.

## [1.0.154] - 2026-07-28
- Games: add a History tab to game detail pages showing revision/activity history (edits, reviews, tier list entries, download/walkthrough links).

## [1.0.153] - 2026-07-28
- Filters: link the "In Progress + Missing Sections" misc filter page from the Misc panel on `/filters`; it shipped in 1.0.151 but was never added to the panel's link list, so it was only reachable by typing its exact URL.

## [1.0.152] - 2026-07-27
- Games: show a chapter/act/episode/mission progress bar on game cards wherever a current section is set (played statuses, filters, tier lists).

## [1.0.151] - 2026-07-27
- Games: add an ordered sections panel with current chapter, act, episode, or mission highlighting to game detail pages.
- Filters: add an in-progress games missing sections page with CSV export.

## [1.0.150] - 2026-07-13
- Build: add ESLint (flat config, eslint-plugin-astro + typescript-eslint) for `site/`; fix all violations surfaced across `.astro` and `.ts` sources (replace `any` with concrete/loosely-typed shapes, remove dead assignments and unused code, fix `no-var` and triple-slash-reference lint errors).

## [1.0.149] - 2026-06-14
- Build: add esbuild override to >=0.28.1 to resolve GHSA-g7r4-m6w7-qqqr and GHSA-gv7w-rqvm-qjhr (high-severity advisories in esbuild 0.17.0-0.28.0).

## [1.0.148] - 2026-06-12
- Filters: add "AVN + [Genre] + Incomplete" misc filter pages for each genre, listing AVN games with that genre in a non-terminal played status (not started, in progress, on hold, or waiting for update).

## [1.0.147] - 2026-06-07
- Tier lists: fix cover art letterboxing for non-standard aspect ratios using position-based image containment.

## [1.0.146] - 2026-06-07
- Filters: add "AVN + Download Platform Steam" misc filter page.

## [1.0.145] - 2026-06-07
- Markdown: add Discord-style spoiler tag support (`||text||`); spoilers render as hidden text revealed on click.

## [1.0.144] - 2026-06-04
- Reviews: add NSFW toggle for screenshots; NSFW images show as greyscale with a label by default and reveal on click-through.

## [1.0.143] - 2026-05-31
- Filters: add "AVN + Harem" and "AVN + Not Harem" misc filter pages.
- Filters: replace en-dashes in Cover Art filter labels with hyphens.

## [1.0.142] - 2026-05-31
- Filters: add a "Download Platform Count" pie chart showing how many games have 1, 2, 3, or more distinct download platforms.

## [1.0.141] - 2026-05-31
- Releases: show x-axis labels every 3 years instead of every year to reduce cramping.

## [1.0.140] - 2026-05-31
- Tiers: skip orphaned tier entries (null game_id) instead of crashing the build.

## [1.0.139] - 2026-05-28
- Filters: add bottom padding to pie chart panels so labels near the bottom of the chart are not clipped.

## [1.0.138] - 2026-05-28
- Filters: move walkthrough pie chart to its own row below the two download platform charts.

## [1.0.137] - 2026-05-28
- Filters: shorten pie chart titles to "Download Platform" and "Download Platform (Exclusives)".

## [1.0.136] - 2026-05-28
- Filters: add "Download URL Platform – Exclusive" pie chart alongside the existing platform chart; move walkthrough chart after both platform charts.

## [1.0.135] - 2026-05-28
- Site: add Epic Games Store support — URL detection (epicgames.com → "epic"), icon (epicgames.svg), platform filter page (/filters/misc/platform/epic), pie chart segment, and filter list entry with total/exclusive counts.
- Data: fix Moonlight: Season One Steam link kind from "steam" to "download" so it is correctly picked up by download link helpers.

## [1.0.134] - 2026-05-27
- Builder: skip re-uploading unchanged pagefind shards using --size-only (content-addressed shard filenames are identical when the hash matches, so same-name files in S3 are safe to skip); force-upload pagefind-entry.json after sync to ensure the shard index is always current.

## [1.0.133] - 2026-05-26
- Site: redesign walkthrough index and walkthrough filter pages with franchise-style game rows, visible walkthrough links, and walkthrough-targeted card links.

## [1.0.132] - 2026-05-26
- Site: fix missing genre-not-in-tier detail pages for pluralized tier list names ending in `es`, such as Hack and Slash.

## [1.0.131] - 2026-05-26
- Site: platform filter detail pages now include games with matching secondary download links instead of only matching the primary download link.

## [1.0.130] - 2026-05-26
- Site: show total and exclusive counts for all download platforms in the Misc filter list (e.g. "788 total, 42 exclusive"). Refactor platform count logic to use inclusive any-link matching for all platforms.

## [1.0.129] - 2026-05-26
- Site: fix Download URL Platform pie chart counting PlayStation and Xbox inclusively (any link) instead of exclusively (primary link only).

## [1.0.128] - 2026-05-25
- Site: game detail page now shows all download links instead of only the primary one; grid/tier/status pages now show all platform icons in the thumb card instead of preferring Steam when multiple links exist.

## [1.0.127] - 2026-05-25
- Data: merge 15 Ubisoft studio entries (Annecy, Belgrade, Bordeaux, Bucharest & Craiova, Chengdu, Montpellier, Montreal, Osaka, Philippines, Québec, Shanghai, Singapore, Sofia, Toronto, Ukraine) into canonical Ubisoft (id=445); reparented 7 games.

## [1.0.126] - 2026-05-25
- Site: add size-distribution pie chart to /developers index alongside the existing per-developer chart; buckets: 1 game, 2 games, 3–5, 6–10, 11+. Reorganize into two-column chart grid matching /franchises layout.

## [1.0.125] - 2026-05-25
- Schema: add `gamestorylog` kind to `games_links.kind` dropdown.
- Data: migrate 220 `games.gamestorylog_url` rows to `games_links` kind=gamestorylog; migrate 287 `developers.website_url` rows (21 already present) to `developers_links` kind=website.
- Schema: drop legacy scalar fields `games.download_url`, `games.walkthrough_url`, `games.gamestorylog_url`, `developers.website_url` — all data now lives in the junction tables.
- Site: update `games/[slug].astro`, `filters/index.astro`, `avn-with-gamestorylog.astro`, `avn-missing-gamestorylog.astro` to use `games_links` kind=gamestorylog instead of `gamestorylog_url`; remove `website_url` from developer page field fetch; remove dead field references from `feed.xml.ts`.

## [1.0.124] - 2026-05-25
- Data: merge 32 duplicate developer entries into canonical records (format variants, legal-suffix variants, rebrands, subdivisions). Reparented all games_developers and developers_links associations; deleted one orphaned null-game junction row; removed 32 spare developer records.
- Data: consolidate SIE Japan Studio, SIE San Diego Studio, and Sony XDev into SIE Santa Monica Studio; rename the unified entry to "Sony Interactive Entertainment" (slug: sony-interactive-entertainment).
- Scripts: add mcp/scripts/analyze_dev_dupes.py (game/link count report) and mcp/scripts/merge_dev_dupes.py (merge executor with dry-run support).

## [1.0.123] - 2026-05-25
- Data: remove 14 duplicate patreon/itch developer links (exact URL duplicates, UTM-param duplicates, and post-URL entries that are not profile pages).
- Data: merge developer "Andrealphus" (id=1025) into "Andrealphus Games" (id=1055) — reparented one game, deleted the standalone developer record.
- Schema: add "steam" kind to developers_links.kind dropdown.
- Data: reclassify 252 developer links from kind=website to kind=steam (all steampowered.com and steamdb.info URLs).
- Site: add steam/steamdb support to DeveloperLink type, DEVELOPER_LINK_KINDS, getDeveloperLinkMeta, and getDeveloperKindIcon; steamdb.info URLs use the SteamDB icon, steampowered.com URLs use the Steam icon.
- Site: add steamdb.svg icon (from simple-icons); add KIND_LABEL entry and filter count for steam in filters/index.astro and developer-links/[kind].astro.
- Odoo: created backlog task #272 to replace steamdb.info search URLs with direct Steam developer/publisher/curator pages.

## [1.0.122] - 2026-05-25
- Data: fix 37 developer links misclassified as "website" kind where URL is an itch.io profile (kind→itch); fix 1 misclassified as website where URL is Patreon (kind→patreon); delete 1 duplicate.
- Data: add Patreon links for 14 developers matched from bookmarks (Classy Lemon, Slate Interactive, Drooskati, JDOR, Jestur, Debatingpanda, Duskduck, Flipdashit, Katanavn, Magnumstories, Noglory, Oppaiodyssey, Saintmcdaniels, Sondertalesstudios).
- Developer pages: change links section from pill badges to bullet list; show full URL alongside each link.
- Misc filters: rename "Developer + {kind}" headings/labels to "Developer Links + {kind}"; show full URL for each link on filter detail pages.
- Add SubscribeStar icon (subscribestar.svg) and wire up in getDeveloperLinkMeta/getDeveloperKindIcon.
- Nav: sort links alphabetically (Home remains first); Guides moves from last to between Genres and Play Status.
- Game status tags: Unreleased now shown with blue styling (matching Abandoned/Family Sharing Disabled pattern using red).

## [1.0.121] - 2026-05-25
- Fix build: export DEVELOPER_LINK_KINDS from download-link.ts and import it in developer-links/[kind].astro so getStaticPaths can access it (inline frontmatter constants are not available in Astro's getStaticPaths build context).

## [1.0.120] - 2026-05-25
- Add text-note support to games_links: add "text-note" kind to the Directus field dropdown; add walkthroughTextNotes() helper to download-link.ts; render text notes as plain text (not links) on game detail, walkthroughs index, and walkthrough filter pages; count text-notes correctly in /filters walkthrough pie and filter entries.
- Re-insert the deleted walkthrough text note for Forbidden Fantasy (games_id 30, games_links id 1675): "Walkthrough is available in the game settings."
- RSS feed: track games_links update activities alongside creates using a generalized fetchActivity() helper; emit "Download Link Updated" / "Walkthrough Updated" entries with per-action GUIDs.

## [1.0.119] - 2026-05-25
- Fix: import scripts (wishlist_import, bulk_import, import_psn_xbox) now create a `games_links` download row after creating each game record, so newly imported games have a populated download link on the site.
- Fix: RSS feed (feed.xml.ts) tracks `games_links` create activities; download/walkthrough link additions now produce feed entries ("Download Link Added: {title}" / "Walkthrough Added: {title}").
- Fix: walkthrough filter counts and pie segments in /filters now driven from the full WALKTHROUGH_KINDS list instead of a hardcoded subset; platforms like ign, f95zone, trueachievements etc. no longer produce uninitialized counts.

## [1.0.118] - 2026-05-25
- Refactor: replace scalar `download_url`/`walkthrough_url` game fields with relational `games_links` junction collection (M2O→games, fields: url, label, kind, sort). Add `developers_links` junction collection (M2O→developers).
- Data: migrate 1569 download links, 57 walkthrough links, 46 extra links from GSL cache to `games_links`; migrate 507 developer links (Patreon, website, Discord, SubscribeStar, itch) to `developers_links`.
- Site: update all pages (GameThumbCard, games/[slug], tiers/[slug], filters/index, platform/[platform], walkthrough/[kind], avn-missing-walkthrough, walkthroughs/index) to use new link helpers (primaryDownloadLink, walkthroughLinks, getLinkMeta).
- Add GameLink, DeveloperLink types and link helper functions to download-link.ts; update game-fields.ts GAME_THUMB_FIELDS and directus.ts types accordingly.
- Developer detail pages now display developer links (Patreon, Discord, SubscribeStar, itch, website) as pill badges with platform icons.
- Add misc filter pages: Developer + {Patreon, Discord, SubscribeStar, itch, website, other} and Developer + Missing Links; surface counts on /filters.
- Add discord.svg to public/icons/simple/; add getDeveloperLinkMeta helper to download-link.ts.


## [1.0.117] - 2026-05-24
- Fix search: sync pagefind/ directory to S3 without --size-only so content-addressed shard files are always re-uploaded; fixes broken search after any build.
- Data: remove duplicate Borderlands GOTY entry, rename GOTY Enhanced to "Borderlands"; remove DMC4 "Special Edition" suffix; delete FFXV Windows Edition; mark Marvel's Avengers and Shadowrun Chronicles - Boston Lockdown as Abandoned; remove STALKER Ukrainian-spelling duplicate entries.

## [1.0.116] - 2026-05-25
- Add second pie chart to /franchises index showing each franchise as a slice proportional to its game count.

## [1.0.115] - 2026-05-25
- Add franchise size distribution pie chart to /franchises index; list items color-coded by bucket (3–4, 5–7, 8–10, 11–19, 20+ games).

## [1.0.114] - 2026-05-24
- Add franchise support: franchises collection with ordered game lists, /franchises index and detail pages, franchise membership on game detail pages, Franchises nav link.
- Directus: franchises + franchise_games collections with M2M relation, sort field for drag ordering, cover/title/slug shown in Directus editor, Astro Readonly permissions granted.

## [1.0.113] - 2026-05-24
- Move build timestamp out of static HTML into /build-info.json loaded by inline JS; HTML pages no longer change on every build, speeding up S3 sync.

## [1.0.112] - 2026-05-21
- Replace all remaining DB-level title/name sorts with JS sortByTitle/sortByName across all pages; add sortByName to list-format.ts.

## [1.0.111] - 2026-05-21
- Remove feed.xml.ts and recentUpdates.ts references to dropped tier_row_game_moves and tier_rows collections.

## [1.0.110] - 2026-05-21
- Fix releases/[slug].astro to sort games case-insensitively using sortByTitle instead of DB-level sort.

## [1.0.109] - 2026-05-21
- Fix all localeCompare calls in filters/index.astro to use sensitivity:"base" for case-insensitive sort.
- Fix developer sort in reviews/[slug].astro to use sensitivity:"base".
- Document case-insensitive sort rule and unreleased game_status rule in AGENTS.md.
- Fix wishlist_import.py and generate_import_proposals.py to set game_status="unreleased" when release_year is null.

## [1.0.108] - 2026-05-21
- Migrate tier list rendering from tier_rows/tier_row_games to tier_list_games with static rating config.
- tier_list_games collection: 353 records migrated, unique constraint on (tier_list_id, game_id) added.
- Update tiers/[slug].astro, tiers/index.astro, games/[slug].astro, filters/index.astro, and misc filter pages to query tier_list_games.
- Add TIER_RATING_CONFIG static rating config to directus.ts for consistent colors and display labels.
- Update tierListToCsv to work with flat tier_list_games format.
- Grant Astro Readonly policy read access to tier_list_games collection.
- Migrate sync_completed_tier.py to read/write tier_list_games instead of tier_row_games.
- Migrate feed.xml.ts and recentUpdates.ts tier addition tracking to tier_list_games.
- Add .claude/*.lock to .gitignore.

## [1.0.107] - 2026-05-21
- Add "Missing from ~Completed Games Tier List + Completed Player Status" misc filter page and index entry.

## [1.0.106] - 2026-05-21
- Fix tier list matching for "FPSes" tier list (was not matching FPS genre due to "es" plural suffix).
- Add "Cover Art – Non-Standard Aspect Ratio" misc filter page listing games whose cover image deviates more than 2% from the 2:3 ratio.
- Add "Cover Art – Non-Standard Aspect Ratio" entry to filters index misc list.

## [1.0.105] - 2026-05-21
- Add top padding to pie chart wrappers on the filters page so inline SVG labels don't overlap the panel title.

## [1.0.104] - 2026-05-21
- Exclude "None Provided" from the walkthrough URL platform pie chart so remaining segments are readable.

## [1.0.103] - 2026-05-21
- Replace pie chart legend lists with inline SVG labels on the filters index page, matching the pattern used by other pie chart pages.
- Sort all misc filter links alphabetically on the filters index page.
- Rename genre tier coverage entries from "{Genre} + Missing from … Tier List" to "Missing from … Tier List + {Genre}".

## [1.0.102] - 2026-05-21
- Add PlayStation, Xbox, and Unknown download platform filter links to the filters index page, and add them to the platform pie chart.

## [1.0.101] - 2026-05-21
- Add "Unknown" download platform filter page for games with unrecognized or missing download URLs.

## [1.0.100] - 2026-05-21
- Fix game grid cards: all cards in a row now stretch to equal height, with tags pushed to the bottom of each card.

## [1.0.99] - 2026-05-21
- Replace pie chart legend lists with inline SVG labels positioned at each slice's midpoint, on game statuses, played statuses, genres, and engines pages. Labels float outside the pie circle using SVG overflow:visible.

## [1.0.98] - 2026-05-21
- Fix news article links rendering as "undefined": update custom marked renderer to use the v5+ token-object API instead of the old `(href, title, text)` signature.
- Fix homepage Recent Updates widget showing engine-patch "Game Updated" noise instead of new game additions: add `engines` to SKIP_DELTA in both the widget and the RSS feed, and bump the widget's game revision fetch limit from 40 to 100.

## [1.0.97] - 2026-05-20
- Reposition pie chart legends to sit alongside the chart (flex row) instead of beneath it, on game statuses, played statuses, genres, and engines pages.

## [1.0.96] - 2026-05-20
- Show percentage alongside raw count in pie chart legends on game statuses, played statuses, genres, and engines pages (e.g. "Action (123, 45%)").

## [1.0.94] - 2026-05-20
- Fix pie chart list swatches: all bullet items now always show their color, no cap on the list.
- Chart legends below the pie are now capped to the top 3 items by count when there are more than 6 segments (applies to genres), keeping the legend readable.

## [1.0.93] - 2026-05-20
- Add color swatches next to list items on pie chart index pages (game statuses, played statuses, genres, engines, developers), matching the corresponding pie chart segment colors.
- For pages with more than 8 items (genres, developers), only the top 3 items by count receive a swatch to avoid clutter.

## [1.0.92] - 2026-05-15
- Add `mcp/` directory consolidating all Directus/Steam enrichment scripts from the former standalone `directus-steam-enhancer` repo.
- `mcp/scripts/` contains 18 Python scripts for bulk import, metadata enrichment, cover fetching, tier list management, and crossref work.
- `mcp/plans/` contains planning docs (PSN/Xbox import plan).
- `mcp/cache/` is gitignored local state.
- Add `.mcp.json.example` documenting required credential structure; `.mcp.json` itself is gitignored.
- Add `AGENTS.md` with full project instructions (schema rules, script conventions, credential policy, exponential backoff pattern); `CLAUDE.md` is a one-line stub pointing to it.
- Scrub all hardcoded credentials from scripts; all tokens and API keys now load from `.mcp.json` at runtime.

## [1.0.91] - 2026-05-15
- Abbreviate nav bar labels to reduce wrap on tablet: Developers→Devs, Game Statuses→Game Status, Played Statuses→Play Status, Release Years→Releases, Walkthroughs→Guides.

## [1.0.90] - 2026-05-15
- Fix search result images rendering at full resolution: Astro scopes component styles with a data attribute that dynamically-injected HTML doesn't receive; switch affected selectors to `:global()`.
- Scale search result thumbnails down to 28×28px icon size.
- Restructure nav bar so search input is a separate flex child of the header and never wraps with the nav links on tablet/narrow viewports.

## [1.0.89] - 2026-05-15
- Add nav bar search powered by Pagefind: a search input in the sticky nav instantly queries a build-time index and shows a dropdown of up to 8 matching games with cover thumbnails.
- Index covers game title, genres, developers, release year, and player/game status; non-game pages are excluded via `data-pagefind-filter="type:game"`.
- Pagefind runs automatically after `astro build` via an updated `build` script; search is a no-op in `astro dev` mode (gracefully silent).
- Add `data-pagefind-ignore` to nav and footer to prevent boilerplate from polluting the search index.

## [1.0.88] - 2026-05-11
- Sort games case-insensitively on all grid pages and tier lists using `localeCompare` with `sensitivity: "base"`.
- Add `sortByTitle` helper to `list-format.ts`; apply it after every game fetch across all grid and filter pages.
- Rename `getDownloadPlatform`/`DownloadPlatform`/`getDownloadLinkMeta`/`DownloadLinkMeta` to `getUrlPlatform`/`UrlPlatform`/`getUrlLinkMeta`/`UrlLinkMeta` (old names kept as deprecated aliases).
- Add platform icon support for: PlayStation, Xbox, IGN, Scribd, F95Zone, Game Rant, Neoseeker, TrueAchievements, Stealth Optional.
- Extend `WalkthroughKind` and walkthrough filter page static paths to cover all new platforms.
- Add PlayStation and Xbox to the download-platform filter page.

## [1.0.87] - 2026-05-02
- Fix Recent Updates badge logic: tier row game additions now emit "Tier Updated" instead of "Tier Added".
- Add tier list creation detection via `tier_lists` revisions so "Tier Added" only fires when a new tier list is created.

## [1.0.86] - 2026-05-02
- Add Recent Updates sidebar widget to the home page showing the 10 most recent feed events (game adds/updates, tier list additions/moves, reviews) with colored type badges and `America/Los_Angeles` timestamps.
- Switch home page layout from centered fixed-width to full-width flex so the widget sits flush with the right viewport edge and the news column fills remaining space.

## [1.0.85] - 2026-05-02
- Fix S-tier rainbow ring visibility on tier list pages by adding `isolation: isolate` to `.tier-stack`, preventing the `z-index: -1` pseudo-element from rendering behind the parent container background.

## [1.0.84] - 2026-05-02
- Add RSS feed validation to fail generation for malformed GUIDs, duplicate GUIDs, `undefined` GUID values, or tier-list item enclosures.

## [1.0.83] - 2026-05-02
- Standardize RSS GUIDs to `<type>:<stable-key>:<event>:<timestamp>` with required slug/id values and second-precision ISO timestamps.

## [1.0.82] - 2026-05-02
- Fix RSS game update items so their enclosure images use the current game cover art even when the Directus revision snapshot omits `cover_image`.

## [1.0.81] - 2026-05-02
- Update RSS feed enclosure images so game items use their cover art, review items use the reviewed game's cover art, and tier list items omit enclosure images.

## [1.0.80] - 2026-05-01
- Migrate tier list relationships from `tier_entries` to `tier_row_games` across feed, filters, game detail pages, and tier list pages.
- Add RSS timestamp handling for tier list updates and tier row game activity.
- Add tier move tracking to the RSS feed and remove genre relationship noise from feed descriptions.
- Add Steam Family Sharing disabled indicators and a corresponding Misc filter.
- Style abandoned game status tags red on grid cards.
- Add CSV export support to tier list pages and include `release_year` in tier row game data.
- Sort the tier list index alphabetically and tighten tier card sizing/alignment.

## [1.0.79] - 2026-05-01
- Upgrade Astro to 6.x and refresh the lockfile.
- Replace invalid Directus `limit` values across static page queries.
- Add the RSS feed link to the footer and position it next to the Discord link.

## [1.0.78] - 2026-05-01
- Remove `site/**` from the builder workflow trigger paths.
- Bump package metadata to `1.0.78`.

## [1.0.77] - 2026-05-01
- Remove the 500-item Directus query limit across page queries.
- Upgrade the builder from Node.js 20 to Node.js 22 for Astro compatibility.
- Add an `npm audit --force` fallback to the builder audit flow.
- Fix GHCR workflow triggers and version tagging.

## [1.0.76] - 2026-04-06
- Stage the Astro site into a temporary writable build directory before install/build/publish in the builder.
- Attempt `npm audit fix --package-lock-only` automatically during builder runs, then fail only if `npm audit` still reports unresolved vulnerabilities.

## [1.0.75] - 2026-04-06
- Resolve the new `npm audit` finding by updating the lockfile copy of `vite` from `6.4.1` to `6.4.2`.

## [1.0.74] - 2026-04-05
- Add unknown-host fallback labels for `download_url` and `walkthrough_url`, appending the shortened hostname in parentheses when no platform icon is available.
- Split `games.walkthrough_url` on `|` in game detail pages and render each URL independently with per-link icon/label handling.
- Surface unknown-host download labels on thumbnail cards and walkthrough index entries.
- Add package overrides for `picomatch`, `smol-toml`, and `defu`, and refresh the lockfile to match.

## [1.0.73] - 2026-03-18
- Resolve `npm audit` vulnerability by updating `astro` to `5.18.1` and refreshing transitive dependencies in the lockfile, including `h3` to `1.15.8`.
- Keep package metadata in sync by bumping `astro-jasmeralia` version to `1.0.73`.

## [1.0.72] - 2026-03-07
- Resolve `npm audit` build failure by updating Astro dependency resolution and lockfile transitive packages, including `svgo` to 4.0.1.
- Keep package metadata in sync by bumping `astro-jasmeralia` version to 1.0.72.

## [1.0.71] - 2026-02-28
- Add a new Misc composite filter page for AVN-tagged games with missing `walkthrough_url` at `/filters/misc/avn-missing-walkthrough/`.
- Add the corresponding count/link entry to `/filters/index.html` Misc section.

## [1.0.70] - 2026-02-27
- Resolve `npm audit` findings by updating transitive dependencies in the lockfile, including `rollup` to 4.59.0 and `devalue` to 5.6.3.

## [1.0.69] - 2026-02-17
- Fix GameStoryLog icon rendering on `games/[slug].astro` by scoping the link-color image filter to platform icons only.
- Keep the GameStoryLog PNG unfiltered so it displays correctly.

## [1.0.68] - 2026-02-17
- Reorder border stacking so walkthrough is the innermost indicator and switch walkthrough color from pink to purple.
- Keep player-status color as its own ring outside walkthrough when both are present, while preserving reviewed (gold) and S-tier (rainbow) outer layers.
- Apply the same stacked border treatment to the game cover image on `games/[slug].astro`.

## [1.0.67] - 2026-02-17
- Fix walkthrough Misc filter static path generation by making `getStaticPaths` self-contained in `src/pages/filters/misc/walkthrough/[kind].astro`.

## [1.0.66] - 2026-02-17
- Fix walkthrough platform pie-chart data on `/filters/index.html` by including `games.walkthrough_url` in the source query.
- Add Misc walkthrough filter links and route pages at `/filters/misc/walkthrough/<kind>/` for platform, unknown URL host, text-note, and none-provided categories.
- Reuse shared walkthrough classification logic via `site/src/lib/walkthrough-link.ts`.

## [1.0.65] - 2026-02-17
- Add a second Misc pie chart on `/filters/index.html` for walkthrough URL distribution.
- Classify walkthrough values as supported platforms, `<Unknown Walkthrough Platform>`, `Text Note` (non-link text), and `None Provided` (null/empty).

## [1.0.64] - 2026-02-17
- Add a Misc-section pie chart on `/filters/index.html` for download platform distribution (Steam, itch.io, GOG, Patreon, and `<Unknown Download Platform>`).
- Include hover tooltips and a legend with counts for each download platform segment.

## [1.0.63] - 2026-02-17
- Add pink walkthrough border indicator to thumbnail and tier card stacks with full gap layering support.
- Update thumbnail legend and data queries to include walkthrough-based border rendering.

## [1.0.62] - 2026-02-17
- Fix platform misc filter build failure by making `getStaticPaths` self-contained.

## [1.0.61] - 2026-02-11
- Make game-card platform icons link to `games.download_url` when URL-based.
- Make game-card status/genre/engine tags link to their corresponding index pages.

## [1.0.60] - 2026-02-11
- Add download-platform indicators to game cards based on `games.download_url`.
- Add Misc platform filters for Steam, itch.io, GOG, and Patreon.
- Rename nav item from "Composite Filters" to "Filters".

## [1.0.59] - 2026-02-11
- Hide Misc genre-tier filter entries on index when their missing-game count is zero.

## [1.0.58] - 2026-02-11
- Make genre-to-tier-list misc filter matching tolerant (case/punctuation/plural variants, published-first preference).

## [1.0.57] - 2026-02-11
- Add waiting_for_update (dark green) support to stacked border indicators and legend text.
- Improve game detail walkthrough rendering with platform icons/labels for URLs and plain-text fallback for non-URLs.
- Update tier list cards to include game titles and waiting_for_update border handling.

## [1.0.56] - 2026-02-11
- Add misc composite filters for genre games missing from matching published tier lists (genres.name == tier_lists.title).
- Apply platform icon/link handling on walkthrough index with safe non-URL plain-text rendering.

## [1.0.55] - 2026-02-11
- Add explicit black separators for 2-layer border combinations without introducing double-gap spacing.

## [1.0.54] - 2026-02-11
- Apply stacked borders around full game cards (thumbnail + metadata) with explicit 3-layer gaps.
- Align tier thumbnail stacks to the same outward border layering behavior.

## [1.0.53] - 2026-02-11
- Move stacked borders to the thumbnail frame (not metadata panel) and add visible spacing only for 3-layer combinations.

## [1.0.52] - 2026-02-11
- Enforce visible nested thumbnail border stacking for combined states (status inside reviewed inside S-tier).

## [1.0.51] - 2026-02-11
- Make all thumbnail border indicators stack together (rainbow, gold, and status color).
- Simplify shared border legend copy now that multi-indicator stacking is always shown.

## [1.0.50] - 2026-02-11
- Show both S-tier rainbow and reviewed gold indicators together on thumbnail borders.
- Add a shared thumbnail border legend component and render it on all thumbnail pages.

## [1.0.49] - 2026-02-11
- Add a Misc section to composite filters with AVN + missing/has GameStoryLog URL pages.

## [1.0.48] - 2026-02-11
- Add GameStoryLog link support on game pages using `games.gamestorylog_url` with a vendored local icon.

## [1.0.47] - 2026-02-11
- Change detected download links to read "Download from <platform>" and keep fallback as "Download".

## [1.0.46] - 2026-02-11
- Add local Simple Icons for Steam, itch.io, GOG, and Patreon download links on game detail pages.

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
