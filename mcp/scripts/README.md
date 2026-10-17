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
