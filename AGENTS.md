# directus-jasmeralia.com

Astro-based static site + MCP tooling for a Directus CMS games library. The site is built from Directus content via a Docker builder on TrueNAS. The `mcp/scripts/` directory contains Python scripts for bulk-importing and enriching Steam, PSN, and Xbox game data.

## Setup: credentials

Copy `.mcp.json.example` to `.mcp.json` at the repo root and fill in all `<VALUE>` placeholders before running any scripts. The file is gitignored and must never be committed.

**All credentials must be loaded from `.mcp.json` — never hardcode tokens, API keys, or passwords in scripts or documentation.** See `.mcp.json.example` for the required key structure.

## Project context

- **Directus instance**: https://directus.jasmer.tools
- **Directus is home-LAN-only, not public internet.** It is only reachable from Morgan's home network (or a session/shell already networked into it, e.g. via an existing VPN/Tailscale path — which is why scripts and Claude Code sessions running there can reach it directly). It is **not** reachable from an arbitrary external client — an email client's `<img>` tag, a phone off the home network, a public visitor's browser, etc. **Never link directly to `https://directus.jasmer.tools/...` (including `/assets/<id>`) from anything meant to be viewed off-LAN** (emails, chat messages, public-facing content). For a publicly-viewable image URL, use the public CloudFront/S3 mirror instead: `https://jasmeralia.com/media/<filename_disk>` (see `site/src/lib/directus.ts`'s `fileUrl()` and `site/src/lib/feed-builder.ts`'s `mediaUrl()` for the established pattern; `~/git/steam-typhoon/scripts/avn_version_sync/sync_installed_versions.py`'s email digest follows the same pattern via its `SITE_MEDIA_BASE` constant). This bit us once already: an early version of that digest linked cover art via `/assets/<id>?width=100`, which silently rendered as a broken image in the actual email — it wasn't even a permissions issue, the domain itself isn't reachable from wherever the email was opened.
- **Auth**: static API token in `.mcp.json` (`DIRECTUS_TOKEN`). Never use email/password — it creates sessions that expire mid-run.
- **Steam ID**: 76561198124815726
- **SteamGridDB API key**: in `.mcp.json`

## Game imports and cover art

**Never add a game to Directus without cover art unless Morgan explicitly instructs you to omit it.** Before creating a game record, find and assign a suitable cover from Steam, SteamGridDB, or GameStoryLog. If none of those sources has a suitable cover, ask Morgan to provide one before creating the record. Do not create the game first and leave `cover_image` empty while waiting for art.

## Key collections (Directus schema)

| Collection | Notes |
|---|---|
| `games` | Primary library. Fields: `id`, `title`, `slug`, `cover_image` (file UUID), `release_year`, `player_status`, `game_status`, `family_sharing` (bool), `nsfw` (bool; explicit game-level flag), `section_style` (string, schema default `"linear"` = ordered chapter/act/episode model, `"nonlinear"` = quest/mission pool - see the `game_sections` row below; the site only ever displays/filters by this once real `game_sections` data exists for the game, via `effectiveSectionStyle()` in `site/src/lib/game-bundles.ts`, so a freshly created game defaulting to `"linear"` with no chapters populated yet does not show up as Linear anywhere), `section_noun` (string, e.g. "Chapter"/"Act"/"Episode"/"Mission"/"Quest", null defaults to "Chapter"), `current_section` (integer, ordinal of the section currently being played; meaningful for linear games only, null = not tracked), `cover_is_placeholder` (bool, default false - true when `cover_image` is one of a small set of known generic stand-in cover images rather than real box art; see `mcp/scripts/placeholder_covers.py` for the known-image hash set and `mcp/scripts/backfill_placeholder_covers.py` for the one-time backfill that flags existing matches - the site renders a red "Placeholder" corner ribbon on `GameThumbCard.astro` and the game detail page cover when true, and lists all flagged games at `/filters/misc/placeholder-covers/`), per-source installed/GSL versions live in `game_versions` (populated by `~/git/steam-typhoon/scripts/avn_version_sync/sync_installed_versions.py`); the former scalar `version_orion` / `version_typhoon` / `version_gsl` fields are retired - nothing reads or writes them, so never reintroduce them. `game_versions` stores one row per GSL update and one observation per Orion/Typhoon manifest installation, retaining raw labels and version-scoped comparison overrides. The game detail page shows source version history in a dedicated Versions tab (`#versions`, only for games with a GameStoryLog link: GSL rows by release date newest first, then Typhoon, then Orion by `recorded_at` newest first; `recorded_at` on backfilled rows is the shared migration timestamp, and redundant `legacy games.version_*` placeholder rows are hidden), and never in the Details panel or History tab (History ignores `version_*` field changes); `/filters/misc/version-mismatches/` compares each current install against current GSL and flags any install behind it, skipping completed, released, and abandoned games. That page renders a compact table with fixed GSL/Typhoon/Orion columns ("N/A" for a source with no install, a green check, yellow `!` (one-off: exactly one step behind, e.g. 0.8.15 vs 0.8.16 or 0.19.1 vs 0.20, or the same version with a different build suffix, or an exact match to the previous GSL release from `previousGslVersion()`) or red X (further behind, a major-version difference, or values too different to parse - those fall back to plain match/no match) per install from `compareInstallToGsl()`, a player-status dot using the `GameThumbCard` ring colors, and download icons ordered by site via `downloadLinksByDomain()` - that ordering is specific to this page; other pages keep `downloadLinks()`'s stored `sort`). `site/src/lib/game-versions.ts` also excludes games where GSL tracks a combined franchise/season rather than this site's per-entry record (e.g. Companion of Darkness Season 1). Version changes remain omitted from recent-update feeds, as scalar version changes were before migration. A game is effectively NSFW when `games.nsfw` is true or any linked `genres.nsfw` is true. **`download_url` no longer exists on `games`** -- it was migrated into the `games_links` junction table; create a Steam-sourced game's download link as a `games_links` row instead: `{"games_id": <id>, "url": "https://store.steampowered.com/app/{appid}/", "kind": "download"}`. Valid `player_status` values: `not_started`, `plan_to_play`, `in_progress`, `on_hold`, `waiting_for_update`, `did_not_finish`, `completed`. `not_started` is the baseline default and means unknown intent (it may be library filler that never gets touched), so imports always default to it; `plan_to_play` means not started yet but intended or at least of interest, set only by hand or by deliberate curation (never by an import script). Moving a game between `not_started` and `plan_to_play` is curation, not a play event: `fmtDelta` in `site/src/lib/changelog.ts` omits it from Game History, the RSS/Discord feed and Recent Updates, so bulk triage cannot flood them. Per-status filter pages and labels come from the Directus field choices, so a new status needs only the choice added to the field; also check the hard-coded status sets (e.g. `INCOMPLETE_STATUSES` in `site/src/pages/filters/index.astro` and `filters/misc/avn-incomplete/[genre].astro`). Valid `game_status` values: `unreleased`, `in_development`, `abandoned`, `released`, `on_hiatus`. |
| `genres` | id + name + slug + `nsfw` (bool; cascades to linked games). Cannot be written by the MCP user via the `genres` endpoint directly - use the REST API with the static token instead. |
| `developers` | id + name + slug. Per-developer external links are stored in `developers_links`. |
| `developers_links` | Junction: `developers_id`, `url`, `kind` (`"website" | "patreon" | "subscribestar" | "discord" | "itch" | "steam" | "other" | "gamestorylog"`). `gamestorylog` is for the developer's own GameStoryLog profile URL. For local-only GSL backfill tooling, see `mcp/scripts/ignored/README.md`. |
| `games_genres` | Junction: `games_id`, `genres_id`. Unique constraint on `(games_id, genres_id)` applied. |
| `games_developers` | Junction: `games_id`, `developers_id` |
| `game_sections` | Child of `games` (o2m `sections`, FK `games_id`). One row per chapter/act/episode/mission/quest: `number` (int, required - global ordinal for linear games, per-`category` ordinal for nonlinear games), `title` (string, required - defaults to `"{section_noun} {number}"` when no real name is known), `category` (string, nullable - quest/mission group label for nonlinear games, or act/chapter-group label for linear games; null when ungrouped), `completed` (bool, default false - meaningful for nonlinear games only; linear games track progress via `games.current_section` instead), `is_ending` (bool, default false - marks which section/quest, if any, is the game's ending; applies to both styles, at most one true per game/bundle-member enforced by partial unique indexes `game_sections_one_ending_per_game`/`game_sections_one_ending_per_member`), `is_active` (bool, default false - nonlinear games only; marks the quest(s) currently active per the in-game journal, deliberately unrestricted so multiple rows can be true at once, unlike `is_ending` - ignored for linear games, which continue to be driven only by `games.current_section`), and optional `bundle_member_id` for an included game (nonlinear sections are not supported for bundle members). Populate linear games via `mcp/scripts/populate_game_sections.py <slug> <count> [noun]` (add `--member <member-slug>` for omnibus members; act/chapter category grouping requires the `--from-json` mode, where each section object may include a `category` key) or nonlinear games via `mcp/scripts/populate_game_quests.py <slug> --from-txt <path> [noun]` (never write this collection directly). **When asked to put items into "groups"** (e.g. missions grouped by chapter, quests grouped by act), the default expectation is one `game_sections` row per individual item, each carrying the shared group label in its `category` field -- never one row per group with the individual item names concatenated into a single combined `title`. This does not imply switching `section_style` to `nonlinear`: a strictly ordered game (globally unique `number` 1..N across every row, `current_section` tracks overall progress) stays `linear` and still gets per-item category grouping via `populate_game_sections.py --from-json`; reserve `populate_game_quests.py`/`nonlinear` for games that are actually an unordered quest/mission pool rather than a fixed sequence. **A House in the Rift** uses the dedicated updater `mcp/scripts/ahitr_quest_sync.py` instead: it syncs quest catalog, `number`/`sort`, `completed`, and `is_active` from the installed game's `unrpa_scripts` tree and the newest Ren'Py `.save` (`--dry-run` to preview; apply aborts on stale rows unless `--allow-orphans`, but still aborts when an orphan occupies a required `sort` slot; `--force-rebuild` retriggers the site rebuild on a clean rerun after a prior run's rebuild request failed). `is_active` is synced as `active and not hidden and not manually_hidden` from each save quest object - AHITR can keep a quest active internally while hiding it from the journal (e.g. `BlairToys3SideJoiningIn`), so raw `.active` alone is not sufficient; the game's own `has_hint_or_objectives()` gate is not replicated since it depends on executable game logic the safe stub unpickler cannot run. The `game-sections-lookup` and `game-quests-lookup` Claude Code skills (`.claude/skills/`) handle research for each style respectively. See `mcp/plans/game_sections.md`, `mcp/plans/game_sections_nonlinear.md`, and `mcp/plans/omnibus_bundles.md`. **Section progress percentages** (game cards, franchise lists): completed games always show 100% even without section rows; for linear games, in-progress and on-hold games credit the current section at 50% (e.g. section 2 of 10 = 15%, halfway between the prior section's 10% and the upper bound of 20%), other statuses use the upper-bound formula (`current / total`); for nonlinear games, progress is simply `completed_count / total` (no half-credit branch - a quest is either done or not). Include DLC in section data under a clearly named category for both styles. Linear DLC rows keep globally unique numbers in play order and continue to use `current_section`; use a `DLC:` title prefix when it makes the optional content clearer. Do not create a bundle member solely because content is DLC - bundle members are for independently tracked games or campaigns inside a true omnibus. Nonlinear DLC rows retain per-row completion like the rest of the quest or mission pool. |
| `game_bundle_members` | Curated child records for independently tracked games or campaigns contained in an omnibus library entry. FK `games_id` identifies the parent; optional `source_game_id` links a standalone `games` record without sharing progress. Member-local fields include `sort`, `slug`, `title`, `player_status`, `section_data_status`, `section_noun`, and `current_section`. Populate through `mcp/scripts/populate_game_bundle.py`; never flatten members into franchises or direct parent sections **by default** -- doing so double-counts the bundle and its members together in franchise-level stats (the `/franchises` pie chart, game counts, etc). Only deviate when the owner explicitly asks for a specific franchise to list a bundle's members individually alongside the bundle itself (e.g. **The Walking Dead** franchise lists Season One/Two/Michonne/A New Frontier/The Final Season as their own entries *and* as members of `the-walking-dead-the-telltale-definitive-series`, per explicit instruction overriding the general rule). When doing this, annotate both directions via `franchise_games.notes` (rendered on the franchise page, see below) so the double-listing reads as intentional rather than a data error: each individually-listed member gets a "Listed separately -- also included in `<bundle title>`" note, and the bundle's own franchise entry gets the inverse "Listed in omnibus: `<member 1>`, `<member 2>`, ..." note. **This case also breaks the normal "`source_game_id` never syncs progress" rule (2.4 in `mcp/plans/omnibus_bundles.md`):** since the owner wants the standalone game's own detail page to show the same progress as the omnibus member, the standalone `games` row needs its own matching `player_status`/`current_section`/`section_noun` and its own flat `game_sections` copy (`bundle_member_id: null`) mirroring the member's episode/chapter list and progress -- this does not happen automatically and must be kept in sync by hand whenever progress changes on either side (see the Walking Dead seasons for the reference copy). |
| `games_links` | Junction: `games_id`, `url`, `kind` (`"download" \| "walkthrough" \| "text-note" \| "other" \| "gamestorylog"`), `label` (nullable, shown for `other`-kind links without a recognized host), `sort`. `download` covers every game-acquisition destination: storefronts (Steam, GOG, itch.io), direct-host URLs, and developer release pages including Patreon and SubscribeStar. **Patreon and SubscribeStar URLs are valid game links and must be retained/backfilled as `kind: "download"`, even when they point to a creator profile or are also present on the developer record. Never discard them as developer-only links or deduplicate them against `developers_links`.** Public or locked Patreon/SubscribeStar posts can provide access to a game's release, including via Mega, Google Drive, PixelDrain, or other hosts. Backfill scripts must consider Patreon/SubscribeStar URLs in both game-level metadata and the game's creator metadata; other creator-profile links are not automatically game links. Do not use platform-specific kinds; the site derives the icon and label from the URL. `other` is for non-download contextual links (social pages, tip jars, boards); the game page shows them below the download and GameStoryLog links, while thumbnail cards and platform filters ignore them. Do not file those as `download`. Replaces the old `games.download_url`/`games.walkthrough_url` fields (see above). |
| `games_art` | Per-game artwork for the Steam Deck / library workflow (task #622). Fields: `games_id` (M2O to `games`, o2m alias `games.art`, cascades on game delete), `kind` (`capsule` = portrait library cover 600x900, `wide_capsule` = Steam store header, `hero`, `logo`, `icon`), `file` (Directus file), `language` (default `en`), `scale` (`1x`/`2x`; 2x preferred when Steam has one), `source_url` (provenance), `sort`. A unique index `games_art_one_per_kind_language` allows one row per `(games_id, kind, language)`, so a manual Directus edit of a row's `file` corrects an asset without touching scripts. Kinds are optional per game. Steam assets come from `IStoreBrowseService/GetItems` (exact, possibly hashed asset paths with `_2x` variants; `assets` vs `assets_without_overrides` separates localized from unlocalized art - the app's supported-language list says nothing about an asset's language); the logo is probed at the unhashed `logo_2x.png`/`logo.png` path, which newer apps lack, and the icon is the app's `community_icon`. Ren'Py games with no logo/icon of their own default to the shared "Ren'Py default logo" / "Ren'Py default icon" files (looked up by title). `mcp/scripts/backfill_games_art.py` (dry run by default; `--steps covers,steam,renpy`) copies each `games.cover_image` into a `capsule` row and imports the rest; it never replaces an existing row and triggers no rebuild. Astro Readonly has read access. Surfaces beyond the cover (Art tab, manifests) are tracked in task #622. |
| `games_music_lists` / `games_tracks` | Per-game soundtrack and playlist lists. `games_music_lists` fields: `id`, `games_id`, `sort`, `title`, nullable `description`, nullable `url`; `games_tracks` fields: `id`, `games_music_lists_id`, `sort`, `title`, nullable `artist`, required `url`, nullable `category` (group label), `scene`, `characters` (JSON string array), and `note`. The game page shows these in a Music tab when a list has a URL or tracks. Only a list's own `url` renders an embedded player (Spotify and YouTube URLs, validated); other list URLs are shown as external links, and tracks are always links only (no per-track embeds). Track scene and character labels appear only for effectively NSFW games. The site does not host music media. `games_tracks` has no `games_id`, so `scriptlib.delete_game_junctions` deletes a game's tracks (via their list) before its `games_music_lists` rows. |
| `franchises` | id + `title` + `slug` + `status` (`"published"` to appear on `/franchises/`) + `sort` + `description`. **The `games` field on this collection is stale/unreliable — do not read or write it.** It returns IDs unrelated to the franchise's actual member games (confirmed: querying it for the Marvel franchise returned Pathfinder/Neverwinter Nights/Ori IDs). Always use the `franchise_games` junction below for real membership. |
| `franchise_games` | Junction: `franchise_id`, `game_id`, `sort` (drives display order on the franchise page), `notes`. A game may belong to multiple franchises (e.g. a LEGO DC game can sit in both `LEGO` and `DC`). No CLI script exists for this collection; write via `scriptlib.DirectusClient` directly (`POST`/`DELETE` `/items/franchise_games`). New franchises are conventionally ordered by `games.release_year` ascending (ties broken alphabetically by title), unless the franchise represents an in-story/numbering order instead (e.g. **Final Fantasy** is ordered by mainline entry number, not real-world release date, so FFVII Remake/Rebirth/Revelation sort before FFX/X-2 despite releasing later). |
| `engines` | id + title + slug. Common AVN engines: **Ren'py** (slug `ren-py`, id 1), **Daz 3D** (slug `daz-3d`, id 4), **Honey Select** (slug `honey-select`, id 3). These are engines, not genres — never tag them as genres. Set via nested update on the game record: `{"engines": [{"engines_id": N}]}`. |
| `tier_lists` | Curated rating boards. `nsfw` (bool) marks the list entry and treats every member image as NSFW on that tier board only. |

Game thumbnail cards show published S-F tier ratings as neutral linked chips; `site/src/lib/tier-chips.ts` builds them and `GameThumbCard.astro` accepts them through its `tierChips` prop.

Genre superset relationships are virtual site behavior configured in `site/src/lib/genre-supersets.ts` (currently AVN -> Visual Novel and ARPG/CRPG/JRPG -> RPG). Apply them in code for genre membership, counts, routes, and filters; do not add inherited `games_genres` rows to Directus. Distinct genre displays may continue to suppress a superset label when a more specific subset label is present.

## Key cache files

Cache lives in `mcp/cache/` (gitignored).

| File | Contents |
|---|---|
| `mcp/cache/steam_library.json` | 869 Steam games (appid, name, playtime, last_played) |
| `mcp/cache/directus_games.json` | Snapshot of Directus games at a point in time |
| `mcp/cache/crossref.json` | Steam ↔ Directus cross-reference (match_method: appid/fuzzy/no_match) |
| `mcp/cache/steam_not_in_directus.json` | Steam games not yet in Directus |
| `mcp/cache/proposed_import.json` | Filtered import candidates with full metadata |
| `mcp/cache/import_progress.json` | Per-appid import status (done/error_game) |
| `mcp/cache/game_bundle_lookup.json` | Resumable research findings for omnibus members |
| `mcp/cache/game_bundle_members_needs_manual.json` | Included games whose section structures need manual review |
| `mcp/cache/backup_YYYYMMDD_HHMMSS/` | Full Directus backup taken before bulk import |

## Git workflow

The `master` branch is protected — direct pushes are rejected. **All changes must go through a pull request.** Always push to a feature branch and open a PR via `gh pr create`.

Before creating any PR, fetch the latest `master` and rebase the feature branch against `origin/master`. Resolve any changelog/version conflicts before opening the PR so the PR starts mergeable.

### publish.sh — full deploy in one command

`mcp/scripts/publish.sh` automates the full post-commit deploy sequence: push branch -> create PR -> squash merge -> update local master -> rebuild trigger. It still performs a legacy TrueNAS pre-pull, but the builder now pulls the latest `master` itself, so that step is harmless and redundant.

```bash
mcp/scripts/publish.sh --title "fix: something" [--body "PR body"] [--no-build]
```

- `--title` is required; `--body` defaults to empty.
- `--no-build` skips the legacy TrueNAS pre-pull and rebuild trigger - use this for changes that don't affect the built site (e.g. script-only changes in `mcp/scripts/`).
- Reads `DIRECTUS_TOKEN` from `.mcp.json` for the rebuild trigger.
- Retains a legacy retry that cleans `.serena/` if its redundant TrueNAS pre-pull encounters untracked files.
- Must be run from a feature branch; exits with an error if already on `master`.

## Updating site source on TrueNAS

**Do not SSH to TrueNAS to `git pull` the Astro site after a PR merges.** The checkout at `/mnt/myzmirror/directus-jasmeralia` is updated automatically at the start of every build: `builder/run-build.sh` runs `git pull --ff-only` against that path when `GIT_AUTO_PULL=true` (the production default). After merging a site change, trigger a rebuild (or wait for the CMS flow) and monitor it through OpenSearch — that is enough.

Manual pulls on the TrueNAS host are only for repairing a failed automatic pull (conflicts, dirty checkout, missing `.git`) visible in build logs. Do not pre-pull "just to be safe"; it is redundant and can race with the builder's own pull.

`mcp/scripts/publish.sh` still includes a legacy TrueNAS pre-pull step from before `GIT_AUTO_PULL` was reliable; that step is harmless but unnecessary for normal deploys.

## Managing the builder on TrueNAS

The production builder runs as the **`directus-jasmeralia`** TrueNAS Compose YAML app (service `builder`, container `directus-site-builder`). TrueNAS tracks app state in middleware — **never manage this container with raw `docker run`, `docker start`, `docker restart`, `docker stop`, `docker rm`, or ad-hoc `docker compose`**. Bypassing middleware leaves TrueNAS's app state inconsistent with what is actually running.

Use the **`truenas-app`** wrapper on the host (`~/bin/truenas-app`; source in `~/git/truenas-typhoon/bin/truenas-app`). Full stack rules and fallbacks are in `~/git/truenas-typhoon/AGENTS.md`.

| Task | Command (on TrueNAS via SSH) |
|---|---|
| Verify app type | `truenas-app classify directus-jasmeralia` |
| Deploy new `:latest` builder image after GHCR publish | `truenas-app pull-latest directus-jasmeralia builder` |
| Restart all app services (e.g. after compose env change on disk) | `truenas-app restart directus-jasmeralia` |
| Stop / start the whole stack | `truenas-app stop directus-jasmeralia` / `truenas-app start directus-jasmeralia` |

`pull-latest` pulls the configured image tag, compares digests, and redeploys via `midclt` only when the image actually changed. `docker restart` does **not** pick up a newly published GHCR image — the container must be recreated through `pull-latest` (or `update-image` for pinned tags).

Read-only diagnostics (`docker logs directus-site-builder`, OpenSearch queries) are fine. Lifecycle changes go through `truenas-app` or, when the wrapper does not cover the edit (e.g. changing env vars in compose config), `midclt call app.update` as documented in `~/git/truenas-typhoon/AGENTS.md`.

## Checking build logs

OpenSearch is running on TrueNAS and indexes all container logs. Query it directly — no auth required from LAN:

```bash
curl -s "http://truenas.windsofstorm.net:9200/container-logs-write/_search" \
  -H "Content-Type: application/json" \
  -d '{"size":30,"query":{"term":{"container_name.keyword":"directus-site-builder"}},"sort":[{"@timestamp":{"order":"desc"}}],"_source":["@timestamp","log"]}' \
  | python3 -c "import json,sys; [print(h['_source']['@timestamp'][:19], h['_source']['log'].rstrip()) for h in reversed(json.load(sys.stdin)['hits']['hits'])]"
```

`container-logs-write` is an ISM rollover alias (backing indices `container-logs-000001`, `container-logs-000002`, ...) and holds logs for all TrueNAS containers — this is what Fluent Bit's output config (`/mnt/myzmirror/opensearch/docker-fluent-bit.conf`) actually writes to. **Do not query the plain `container-logs` index** — it's an orphaned, non-rollover index with a handful of stale docs unrelated to the live pipeline; querying it silently returns near-empty results instead of erroring, which looks like broken log shipping but isn't. Look for the final `Build/publish completed successfully.` or `Build/publish FAILED` line. The OpenSearch Dashboards UI is at https://opensearch.jasmer.tools/ (LAN only).

Each production publish also emits structured `[timing]` lines from `builder/run-build.sh` and `builder/sync-dist.mjs`. Filter for `log:*timing*` to collect per-stage durations. The final `[timing] summary total_ms=...` line lists top-level stage totals (`git_pull`, `staging_copy`, `npm_audit_fix`, `npm_ci`, `npm_audit`, `astro_build`, `pagefind_index`, `s3_publish`, `cloudfront_invalidation`). Nested S3 sub-stages (`s3_manifest_build`, `s3_manifest_diff`, `s3_upload_changed`, etc.) appear as separate `stage_end` lines inside `s3_publish`.

Inside `astro_build`, look for:
- `[timing] route_summary` / `[timing] route_slow` from `builder/parse-astro-build-log.mjs` (slowest generated pages)
- `[timing] directus_summary` / `[timing] directus_endpoint` from the Astro build-metrics integration (aggregate Directus API time by collection)

As a fallback, SSH and tail docker directly:
```bash
ssh morgan@truenas.windsofstorm.net "docker logs directus-site-builder --tail 100 2>&1"
```

## Site rebuild

To trigger a site rebuild after making changes:
```python
import urllib.request, json
token = '<DIRECTUS_FLOW_TOKEN>'  # from DIRECTUS_TOKEN in .mcp.json
url = 'https://directus.jasmer.tools/flows/trigger/e3aa03ad-3352-4ade-8156-22d53f107907'
data = json.dumps({'collection': 'games', 'keys': ['448']}).encode()
req = urllib.request.Request(url, data=data, headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}, method='POST')
resp = urllib.request.urlopen(req, timeout=30)
print(f'HTTP {resp.status}')  # expect 204
```
Use `https://directus.jasmer.tools` (public URL) — `truenas.local` is not reachable from WSL.

**After triggering a rebuild, always monitor it to completion via OpenSearch.** Record the exact trigger time before firing, then poll until a `Build/publish completed successfully.` or `Build/publish FAILED` line appears with a timestamp **strictly after** the trigger time. Never match the most-recent completed line without verifying its timestamp is newer than the trigger — the previous build's completion line will otherwise cause a false early exit. Notify the user of the result. Use the query from the "Checking build logs" section above, filtered to the last few `Build/publish` and `Starting build` lines.

**Report a change summary to the user BEFORE starting any multi-minute wait on a build, deploy, or publish.** Before a rebuild-monitor loop, `gh run watch`, `truenas-app` redeploy watch, or similar, first post a plain-text summary of what changed and what is being waited on: which files/records were touched, how many rows were written or updated, and any data fixes made along the way. The user needs that detail up front to tell whether the work matches what they wanted and to steer early, rather than having to interrupt a long-running tool call just to find out what was done. Do not put the summary only in the final message after the wait finishes.

## Typography rules

**Never use smart quotes, em-dashes, or en-dashes in source code, labels, or content strings.** Use only ASCII equivalents: straight quotes (`'` and `"`), hyphens (`-`). Smart punctuation (`"`, `"`, `'`, `'`, `—`, `–`) causes rendering inconsistencies and sorting anomalies.

## Dependency security

**When npm audit reports vulnerabilities, always fix them by upgrading the affected package — never by lowering the audit severity threshold.** Lowering `--audit-level` masks real issues and leaves the project in a permanently degraded security posture. If a vulnerability cannot be fixed without a breaking change, add a version override in `site/package.json` under `"overrides"` to force the patched version. Only relax the audit level as a last resort if no patched version exists yet, and create a tracking issue immediately.

## Linting

The whole repo lints through one root `Makefile`, patterned after `~/git/wishlist_monitor`'s:

| Command | Covers |
|---|---|
| `make lint` | Everything below, read-only |
| `make lintfix` | Auto-fixable subset (eslint --fix, ruff check --fix, ruff format) |
| `make lint-site` | `site/` — eslint (flat config, `eslint-plugin-astro` + `typescript-eslint`) |
| `make lint-builder` | `builder/*.mjs` — eslint (root flat config, shared site toolchain) |
| `make test-site` | `site/` - Vitest unit tests for `site/src/lib/` pure logic; runs without live Directus credentials or network access, with fixtures in `site/src/test/fixtures/` |
| `make lint-python` | `mcp/scripts/` — ruff, ruff format, pylint, mypy |
| `make lint-docker` | `builder/Dockerfile` — hadolint |
| `make lint-shell` | `builder/run-build.sh`, `mcp/scripts/publish.sh` — shellcheck |

**If a change is made on typhoon, run `make lintfix && make lint` before committing to verify it passes.** This isn't something that can be done on the TrueNAS host — it only runs the production build/deploy pipeline (`builder/run-build.sh` in a container with just Node + the AWS CLI) and has no dev tooling installed — so this rule doesn't apply there.

Python lint config lives in the root `pyproject.toml`:
- `broad-exception-caught` is disabled repo-wide for pylint — this repo's documented retry/backoff pattern (see "Rate limiting, retries, and exponential backoff" below) requires bare `except Exception:` with logging, which that rule would otherwise flag on every script.
- `[tool.pylint.format]`/`[tool.pylint.design]` calibrate line-length and complexity thresholds (max-branches/locals/statements/etc.) to fit this codebase's linear fetch-transform-write script style, rather than forcing artificial function splits to satisfy pylint's defaults.
- `mcp/scripts/ignored/` (gitignored, excluded from ruff/mypy/pylint via config) holds local-machine-specific scripts that must not enter this public repository. Put sensitive code in an appropriate private repository instead of leaving the canonical copy here; the AVN version sync now lives in the private `steam-typhoon` repository. The `game-sections-lookup` skill (`.claude/skills/game-sections-lookup/`) auto-discovers any script here tagged with a `# game-sections-lookup:` header comment — see that skill file for the discovery/usage convention rather than assuming a specific script name, since these files are not committed and may not exist in every checkout.

CI (`astro-builder-ghcr.yml`) runs `lint-site`, `lint-builder`, `test-site`, `lint-python`, `lint-docker`, and `lint-shell` as separate jobs on every push and PR, and the builder Docker image build (`build-publish-docker-image`) is gated on all six passing. CI never runs `npm run build` for the Astro site itself — the real build needs live Directus DB access that GHA runners don't have (see "Rules for Astro site changes" below).

## Rules for Astro site changes

**Do not use local Astro builds as the acceptance test for site changes.** Local builds can fail for unrelated Directus/query/environment issues and are not a reliable validation method for this project. After merging and deploying site changes, validate by watching the real TrueNAS builder through OpenSearch until it reports success or failure.

**Sorting must always be case-insensitive and done in JavaScript — never rely on PostgreSQL's sort order.** PostgreSQL's default collation is case-sensitive (lowercase sorts after uppercase), so `sort: ["title"]` or `sort: ["name"]` in Directus queries will place titles like "dev_hell" after all uppercase titles. Always omit `sort` from Directus queries for display lists and sort in JS instead:
- Use `sortByTitle(arr)` for arrays with a `.title` field.
- Use `sortByName(arr)` for arrays with a `.name` field.
- Use `compareLabels(a, b)` as a comparator in `.sort()` for other string fields.
All three are in `site/src/lib/list-format.ts`. All raw `localeCompare` calls must include `{ sensitivity: "base" }` as the third argument. Never use bare `.localeCompare(x)` or `.sort()` on title/name/label strings.

**Steam imports: set `game_status` to `"unreleased"` when `release_year` is null.** A missing release year means the game has not yet shipped. Do not default to `"released"`. This applies to `wishlist_import.py`, `generate_import_proposals.py`, `bulk_import.py`, and any future import scripts.

**Non-Steam AVN stub creation (`sync_installed_versions.py`): default `game_status` to `"in_development"`, never `"released"`.** Most non-Steam AVNs discovered via the shortcut docs are still actively receiving updates, not finished releases; defaulting to `"released"` misrepresents that and previously caused those games to be wrongly excluded from the AVN - Version Mismatches filter's completed/released exclusion (see below). Correct the status manually once a game's actual state is confirmed.

**After every change to the Astro site, update the changelog and bump the version before committing.**

- **Changelog**: `CHANGELOG.md` — prepend a new `## [x.y.z] - YYYY-MM-DD` section with bullet points describing what changed.
- **Version**: `site/package.json` — increment the patch version to match the new changelog entry.

Both files must be updated in the same commit as the site changes. Never batch multiple unrelated features under one version; each logical change gets its own version bump.

**Any new page under `site/src/pages/filters/` must be linked from `filters/index.astro`, or it's orphaned.** `filters/index.astro` is the only place these pages are discoverable from — there's no directory scan, no nav entry, nothing else pointing at them. The `developer/[developer]/...`, `engine/[engine]/...`, `genre/[genre]/...`, and `section-data/[state]/played_status/[status]` combinatorial routes are the exception: they're linked automatically because `filters/index.astro` derives `developerStatusEntries`, `developerPlayedEntries`, `engineStatusEntries`, `engineGenreEntries`, `enginePlayedEntries`, `genreStatusEntries`, `genrePlayedEntries`, and `sectionDataPlayedEntries` straight from the games data, so a new developer/engine/genre/section-data combination gets a link for free. Everything else — every one-off page under `filters/misc/*.astro` — is only linked because it has a matching hand-maintained entry (`{ label, href, count }`) in the `miscFilterEntries` array; adding the page without adding the entry leaves it deployed but unreachable except by typing its exact URL. `games-missing-sections.astro` shipped this way and went unlinked for a release before being caught (it was later replaced by the general `section-data`/`played_status` combinatorial section rather than re-added to `miscFilterEntries`). When adding any new filter page that doesn't fall under one of the auto-generated combinatorial sections, add its `miscFilterEntries` entry (and any supporting count computation, reusing the shared `games` fetch already in `filters/index.astro` where possible) in the same commit. **Filter labels follow two conventions:** ` + ` joins two independent filters that are intersected (`AVN + Missing Walkthrough URL`, `Download Platform + Steam`), and `Subject - State` names a single condition on one subject (`Cover Art - Missing`, `Cover Art - Non-Standard Aspect Ratio`, `AVN - Version Mismatches`); the two combine as `Tier List: ARPGs - Missing + Genre: ARPG` (a single-subject condition, then an intersected filter). The index sorts labels alphabetically, so a shared subject keeps related filters adjacent; pick the subject so they group. Do not use ` - ` for an intersection or ` + ` for a single condition.

**Game History, the RSS/Discord feed and the homepage Recent Updates widget share one event derivation - extend it there, never in one surface only.** What counts as an event (revision/activity -> title + markdown body, or "not an event") lives in `site/src/lib/game-events.ts` (links, genres, reviews, included games, tier entries, create detection), `site/src/lib/section-events.ts` (game_sections count/completion runs), and `site/src/lib/music-events.ts` (music list changes and grouped track runs); low-level formatters stay in `changelog.ts`. `game-history.ts` (History tab) and `feed-builder.ts` only fetch/scope data and wrap events (HTML and title punctuation for History; link, image, NSFW flag, GUID and 30-minute consolidation for the feed). The widget (`recentUpdates.ts`) is a thin adapter over `buildSourceEntries()` in `feed-builder.ts`: entries opt in through their `widget` metadata (`added`, `updated`, `review`, `tier-added`, `tier-updated`), while music events are History + feed only and have no widget metadata. Review, tier-list edits, and music events are deliberately feed-only. Music track event bodies contain counts and the list title only; never include track scene, characters, or note fields. When a new kind of change should show up, add a `describe*` function in the appropriate event module and call it from both History and feed. Feed constraints: existing RSS GUIDs must never change (readers re-announce items), the feed treats only explicit `create` revisions as creations (`isCreateRevision(rev, false)`), and consolidation uses `gameTitle`/`added` metadata on entries, not title-prefix parsing. Directus keeps no data on junction (`games_genres`) revisions, so genre additions come from `games_genres` create *activity* (genres added within 5 minutes of the game stay in "Game Added"), and genre removals cannot be attributed to a game and are not shown.

## Rules for schema changes

**Never make schema changes (field creation/deletion, relation changes, collection modifications) without explicit user confirmation — even if the user has discussed or approved the plan.** Discussion is not authorization. Wait for a clear "go ahead" directed at the specific schema change before touching `/fields`, `/relations`, or `/collections` endpoints.

**Always take a full-database `pg_dump` before any delete or schema change — no exceptions, no minimum size threshold, and never scoped to just the table(s) you think are affected.** This includes single-record deletes, game merges, link cleanup, junction sweeps, field creation/deletion, and collection modifications. Schema changes routinely touch Directus system tables you wouldn't think to check (`directus_fields`, `directus_relations`, `directus_permissions`, `directus_presets`, `directus_flows`/`directus_operations`, `directus_revisions`, `directus_activity`, etc.) — a `pg_dump -t <table>` scoped to only the "obviously affected" tables is not an acceptable substitute and can leave a restore inconsistent. Always dump the whole `directus` database. Use `pg_dump` via the `cms-db` container on TrueNAS; it produces a complete, binary-compatible dump that restores in seconds.

**Purely additive data writes do not need a backup.** Creating new rows (e.g. adding `games_links`/`developers_links` entries) or updating field values on existing rows, without deleting anything or touching the schema, is not covered by this rule - skip the dump.

```bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
ssh morgan@truenas.windsofstorm.net \
  "docker exec cms-db pg_dump -U directus directus | gzip > /mnt/myzmirror/directus-jasmeralia/backups/directus_${TIMESTAMP}.sql.gz"
echo "Backup: directus_${TIMESTAMP}.sql.gz"
```

To restore from a backup:
```bash
ssh morgan@truenas.windsofstorm.net \
  "gunzip -c /mnt/myzmirror/directus-jasmeralia/backups/directus_TIMESTAMP.sql.gz | docker exec -i cms-db psql -U directus directus"
```

The old pattern (fetching JSON via `GET /items/{collection}?limit=-1`) is **not** a substitute — it misses system tables, file metadata, relation data, and requires painful record-by-record re-insertion. Always use `pg_dump`.

**After creating any new collection that Astro queries (pages, components, feed — anything in the site build), grant the site builder read access before triggering a build.** The site builder runs as the "Astro Readonly" role/policy. Grant via `POST /permissions` with `policy: "84f316ac-2d5e-4b5a-8f56-99e27a8f1cdf"`, `collection: "<name>"`, `action: "read"`, `fields: ["*"]`. Missing permissions cause build-time 403 errors. This applies to both regular collections and system collections (e.g. `directus_revisions`, `directus_activity`).

## Rules for all scripts

Scripts live in `mcp/scripts/`. Run them from any directory — they resolve `mcp/cache/` relative to their own location via `Path(__file__).parent.parent / "cache"`.

### Credentials (REQUIRED)

**Never hardcode tokens, API keys, or passwords in scripts.** Always load from `.mcp.json` at the repo root:

```python
from pathlib import Path
import json

_mcp = json.load(open(Path(__file__).parent.parent.parent / ".mcp.json"))
TOKEN = _mcp["mcpServers"]["directus"]["env"]["DIRECTUS_TOKEN"]
```

### Rate limiting, retries, and exponential backoff (REQUIRED)

**Any script that communicates with an external API (anything other than our own Directus instance - see the Directus exemption below) must implement:**
1. **A per-request inter-request delay** — at least 1s between calls to the same host. Values below 0.5s will reliably trigger rate limiting on most public APIs.
2. **Retry with exponential backoff** on rate-limit responses (HTTP 429, and 403 on Steam which uses 403 instead of 429). Silent exception swallowing (`except Exception: return None`) is not acceptable — rate-limit hits must be surfaced so they are distinguishable from genuine no-results.
3. **A maximum retry cap** (5 attempts) with a clearly logged failure after exhaustion.

Use `fetch_with_backoff` / `RetryPolicy` from `scriptlib.py` rather than reimplementing this loop — every script listed as non-compliant in the mcp/scripts audit (2026-07) had a bespoke, slightly-wrong copy of this pattern.

Standard pattern used across this project:

```python
MAX_RETRIES = 5
BACKOFF_BASE = 2.0  # doubles each retry: 2s, 4s, 8s, 16s, 32s

def fetch_with_backoff(url, headers=None) -> tuple[dict | None, str | None]:
    delay = BACKOFF_BASE
    for attempt in range(MAX_RETRIES):
        try:
            req = urllib.request.Request(url, headers=headers or {})
            with urllib.request.urlopen(req, timeout=15) as resp:
                return json.loads(resp.read()), None
        except urllib.error.HTTPError as e:
            if e.code in (403, 429):
                print(f"  Rate limited (HTTP {e.code}), backing off {delay:.0f}s...", file=sys.stderr)
                time.sleep(delay)
                delay *= 2
            else:
                return None, f"http_{e.code}"
        except Exception as e:
            return None, f"error:{e}"
    return None, "rate_limit_exceeded"
```

For the Steam Store API specifically, a base inter-request delay of **1.5s** has been reliable for full-library runs.

**Directus is exempt from all of the above.** Directus (`https://directus.jasmer.tools`) is a purely internal, home-LAN service, not a third-party API, so Directus calls get no inter-request delay, no `time.sleep` pacing, and no HTTP 429 backoff. Do not add any when writing Directus read/write loops, and do not reintroduce a delay constant for it (the old `scriptlib.DIRECTUS_REQUEST_DELAY_S` and the 429 branch of the Directus retry helpers were removed for this reason). The retry helpers in `scriptlib.py` (`directus_request_with_retry`, `directus_operation_with_retry`, `RetryingDirectusClient`) still retry *ambiguous network failures* with exponential backoff, since that is resilience rather than rate limiting; HTTP errors from Directus (403, 429, ...) are raised immediately.

**The exemption covers only the Directus calls themselves.** External APIs (Steam Store, SteamSpy, SteamGridDB, IGDB, ITAD, PSN/Xbox, GameStoryLog, cover CDNs, ...) must keep every delay and backoff described above. When a loop mixes Directus writes with external calls, its end-of-loop `time.sleep` is usually the only thing pacing the external API (e.g. `bulk_import.py`/`wishlist_import.py` fetch a SteamGridDB cover then have Directus import it; `audit_cover_images.py`/`fetch_missing_covers.py` fetch from SteamGridDB/IGDB between Directus patches), so keep it. Only drop a sleep when the loop body makes no external call at all (e.g. an `--apply` phase that replays cached results into Directus).

### Dry-run / apply pattern: cache external API results (REQUIRED)

Scripts that support a dry-run phase followed by an `--apply` phase **must** cache all external API responses to disk during the dry run. The apply phase must load from that cache and skip re-querying the API entirely. Re-querying wastes rate-limit budget, doubles wall-clock time, and can produce different results between review and commit.

Standard pattern: write a JSON file to `mcp/cache/` keyed by a stable identifier (e.g. `"title|source"`), load it at startup if present, and only call the external API for keys not yet in the cache. Skip the inter-request sleep when serving from cache.

### Resumability (strongly preferred)

Bulk scripts should save progress incrementally (every 25 items) to a JSON file in `mcp/cache/`. On restart, skip already-processed items. Re-attempt transient errors (`api_error`, `rate_limit_exceeded`); skip permanent ones (`api_no_success`, `type=dlc`, `free`).

### Directus API calls

Use the static token directly via `urllib.request` for bulk operations — don't go through MCP tools, which add overhead and have no retry logic. Token: see `.mcp.json`.

**Always write data through the Directus API, never directly to the database.** Direct DB writes bypass Directus Flows, which means hooks like "Tier Row Games – Update Tier Row Date" never fire, `updated_at` timestamps don't update, and changes are invisible to the RSS feed. Use `psycopg2` for read-only queries where the REST API returns 403 or is inconvenient, but all inserts, updates, and deletes must go through the API.

**Before deleting any game record, explicitly delete its junction rows first.** Directus does not reliably cascade-delete junction table rows when a parent record is removed. Surviving orphan rows (with a null or dangling foreign key) cause build-time crashes in any Astro page that expands the relation. At minimum, clean up these collections before calling `DELETE /items/games/{id}`:

```python
GAME_JUNCTIONS = [
    ("tier_list_games", "game_id"),
    ("games_genres",    "games_id"),
    ("games_developers","games_id"),
    ("games_links",     "games_id"),
]

for collection, fk in GAME_JUNCTIONS:
    rows = d_get(f"/items/{collection}?fields=id&filter[{fk}][_eq]={game_id}&limit=-1").get("data", [])
    for row in rows:
        d_delete(f"/items/{collection}/{row['id']}")
```

This list and loop are also available as `scriptlib.GAME_JUNCTIONS` / `scriptlib.delete_game_junctions(client, game_id)` — call that instead of reimplementing the loop.

This has caused build failures more than once (orphaned `tier_list_games` rows leave `game_id: null` entries that crash the tiers page template).

### Import filters

When importing from Steam, always apply:
- `type == "game"` (excludes DLC, demos, mods, software)
- `is_free == False` by default (F2P excluded unless `--include-free`)
- Title does not contain "Playtest" (playtest builds)
- Title does not end with "VR Edition" / contain "(VR)" (VR-only versions)
