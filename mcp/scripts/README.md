# MCP maintenance scripts

## Game links

The old `games.download_url` field no longer exists. Scripts that need a
storefront link must expand `games.links` with `links.url,links.kind`, filter to
the canonical `download` kind, and create new acquisition links as
`games_links` rows. A game may have more than one download destination, so
Steam-specific work must select its Steam URL rather than assume a scalar link.
The historical field migration has been retired and must not be run against the
current schema.

## Steam links for Epic/GOG-only games

`backfill_steam_links_from_stores.py` finds Steam equivalents for games whose
only PC storefront links are Epic Games Store and/or GOG (no Steam link of any
kind). Each game is searched on Steam (full title, edition-stripped title, then
the pre-subtitle title), the top candidates are verified through Steam
`appdetails` (must be `type: game`), and each match is scored on title
similarity, sequel-number agreement, and release-year consistency:

- `high`: near-identical title, year consistent (a later Steam re-release of an
  old GOG title is accepted only for an essentially exact title). `--apply`
  adds these as `games_links` rows with `kind: download`.
- `review`: weaker title match, year conflict, or a close runner-up. Inspect the
  report, then add chosen ones with `--apply --accept <game id>,<game id>`.
- Subtitles: a title that is the other plus a trailing subtitle ("The
  Textorcist" vs "The Textorcist: The Story of Ray Bibbia") scores 0.85, so it
  is found directly but always goes to `review`. A sequel number that differs
  ("Hades" vs "Hades II") is penalized instead, and ordinals like "25th" are
  ignored. Soundtrack/artbook/demo-style Steam extras are skipped so they do not
  crowd real candidates out of the detail lookups.
- DLC matches: some old titles exist on Steam only as an itemized DLC of a
  collection page (the Gold Box collections) or of a re-release. When Steam
  search returns such a DLC, the script links the DLC's parent app instead. A
  DLC match is scored at 0.75x so real game matches always outrank it (it then
  appears only as a lower "other candidates" entry in the report), and it is
  only ever `review`, never `high`, because the link points at a different
  app than the title searched for.
- `none`: nothing plausible on Steam. Expected for old GOG-only titles and Epic
  exclusives; Steam's search occasionally misses a real listing (Football
  Manager 2024 returned only its editor), so spot-check any `none` you suspect.

```sh
python3 mcp/scripts/backfill_steam_links_from_stores.py               # dry run + report
python3 mcp/scripts/backfill_steam_links_from_stores.py --missing-developers-only
python3 mcp/scripts/backfill_steam_links_from_stores.py --apply       # add high matches
```

Every Steam response is cached in `mcp/cache/steam_for_store_games_cache.json`
(so `--apply` never re-queries Steam), and the report is written to
`mcp/cache/steam_for_store_games_report.{md,json}` with Steam's developer names
for each match. Apply re-checks each game's current links first, so it is safe
alongside other sessions that add Steam links, and triggers a site rebuild for
the games it changed. The script never writes developer records itself; the
developer backfill picks the new Steam links up.

## IsThereAnyDeal links

`backfill_itad_links.py` resolves the primary Steam download app ID for each game
through ITAD’s `/games/lookup/v1` endpoint and adds the corresponding ITAD page
as a `games_links` row with `kind: itad`. It does not search by title or guess
slugs. Games without a Steam app link, games already linked to ITAD, and ITAD
no-matches are reported separately.

```sh
python3 mcp/scripts/backfill_itad_links.py                 # dry run + cache
python3 mcp/scripts/backfill_itad_links.py --apply         # add links + rebuild
python3 mcp/scripts/backfill_itad_links.py --refresh        # refresh lookups
python3 mcp/scripts/backfill_itad_links.py --only-slug foo  # one game
```

The default is a dry run. `--apply` rechecks the game’s current links before
creating a row and triggers one rebuild for changed games. ITAD results are
cached in `mcp/cache/itad_game_link_cache.json`, and the proposed plan is
written to `mcp/cache/itad_game_link_plan.json`. Uncached requests are spaced
at least one second apart. HTTP 429/503 responses honor `Retry-After` and use
exponential backoff capped at 15 minutes; repeated rate limiting or other API
errors stop the run without caching a false no-match. The `itad` choice is
registered in `games_links.kind` and displayed as a contextual link on the
game page.

## Steam developer links

`backfill_steam_developer_links.py` finds games with Steam download links,
looks up each unique Steam app once, and proposes official Steam developer
homepage links for their associated Directus developers. It strips query
strings from game and developer URLs and ignores Steam search, curator,
publisher, and community URLs. A developer may receive multiple Steam homepage
links because Directus sometimes consolidates studios that Steam lists as
separate divisions. When a game has multiple possible developer associations,
the script only writes exact normalized name matches; unresolved cases are
reported for manual review.

```sh
python3 mcp/scripts/backfill_steam_developer_links.py          # dry run
python3 mcp/scripts/backfill_steam_developer_links.py --apply  # add links
python3 mcp/scripts/backfill_steam_developer_links.py --refresh # ignore cache
```

The default is a dry run. `--apply` adds missing `developers_links` rows with
`kind: steam` and does not trigger a site rebuild. Steam metadata and extracted
developer homepages are cached in
`mcp/cache/steam_developer_link_backfill.json`. Uncached requests are spaced at
least two seconds apart. HTTP 429 responses honor `Retry-After` and use
exponential backoff starting at 60 seconds, capped at 15 minutes; after five
retries the script aborts instead of continuing to send requests.

## Steam game synopses

`backfill_steam_synopsis.py` fills empty synopses from a game's unambiguous
Steam app download link. It uses the full `about_the_game` description, with
`detailed_description` and `short_description` as fallbacks when no visible
text is available. HTML becomes paragraph text with heading, list-item, and
line-break boundaries, and retains bold, italic, links, and ordered/unordered
lists as controlled Markdown. Images and video poster/source URLs are preserved
only from HTTPS Steam CDN hosts; scripts, styles, and other embeds are dropped.
The page renders video with controls inside the synopsis and defers NSFW media
requests until the existing reveal. Linked Steam game and DLC entries are
supported. Typography is normalized to ASCII punctuation without truncating
the text.

```sh
python3 mcp/scripts/backfill_steam_synopsis.py --avn-only --refresh # all AVNs, dry run
python3 mcp/scripts/backfill_steam_synopsis.py --empty-only --refresh # blank synopses, entire catalog
python3 mcp/scripts/backfill_steam_synopsis.py --apply --empty-only # apply only blank-synopsis plan rows
python3 mcp/scripts/backfill_steam_synopsis.py --only-slug game-slug # dry run
python3 mcp/scripts/backfill_steam_synopsis.py --apply --only-slug game-slug
python3 mcp/scripts/backfill_steam_synopsis.py --refresh --only-slug game-slug
python3 mcp/scripts/backfill_steam_synopsis.py --self-test           # offline
```

`make test-python` runs this offline self-test with coverage for CI.

Repeat `--only-slug` to select several games; omit it to plan the entire
catalog. `--avn-only` limits the plan to games tagged with the AVN genre.
`--empty-only` limits both planning and applying to games whose synopsis is
blank. It protects existing GSL and Steam text even when combined with
`--refresh`; the apply step also skips any game whose synopsis became nonblank
after the plan was created.
Steam may replace GSL-owned synopses from cached data; `--refresh` fetches fresh
Steam data and permits updates to Steam-owned text. Manual, ITAD, and other
source-owned text stays protected. Review `mcp/cache/steam_synopsis_plan.json` and
`mcp/cache/steam_synopsis_review.md` before applying. Steam app details are
cached in `mcp/cache/steam_synopsis_cache.json`; uncached requests are spaced
at least 1.5 seconds apart, with the shared capped 403/429 retry helper.
`--refresh` fetches fresh Steam data and permits replacing GSL- or Steam-owned
text. Manual, ITAD, and other sources remain protected, including empty manual rows.

Apply makes no Steam requests. It rechecks the current synopsis, source, and
Steam link against the saved plan, skips stale or protected rows, and records
progress under `mcp/cache/steam_synopsis_progress.json`. Ambiguous app links and
non-game store entries are skipped. Directus credentials come from `.mcp.json`;
the script makes no schema changes and does not trigger a site rebuild.

## Steam wishlist imports

`wishlist_import.py` reads the Steam wishlist and current Directus catalog to
build import proposals. The default command only refreshes proposal/cache files;
`--apply` creates game rows, cover files, download links, and genre/developer
links, so review the proposal list and title matches before using it. The
`--dry-run` flag exercises the apply path without Directus writes. Steam
acquisition links belong in `games_links` with `kind: download`.

Steam-derived `game_status` is `unreleased` when the release year is unknown or
in the future, and `released` for a known current or past year. A release year
alone cannot distinguish an unreleased title scheduled later in the current
year, so verify those dates before applying proposals.

## Itch.io release-year backfill

`itch_published_dates.mjs` retrieves the account-gated `Published` field for games with no release year and an itch.io link. Export the authorized itch.io cookies from Firefox to the gitignored path `mcp/scripts/ignored/cookies.json`, then run:

```sh
node mcp/scripts/itch_published_dates.mjs
node mcp/scripts/itch_published_dates.mjs --apply
```

The first command saves the research results to `mcp/cache/itch_published_dates.json`; `--apply` updates records with an absolute year or a day-relative date resolved against that record's fetch time. The script uses the Android Firefox user agent required for this source. Never commit the cookie export.
