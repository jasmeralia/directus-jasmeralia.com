# MCP maintenance scripts

## Game links

The old `games.download_url` field no longer exists. Scripts that need a
storefront link must expand `games.links` with `links.url,links.kind`, filter to
the canonical `download` kind, and create new acquisition links as
`games_links` rows. A game may have more than one download destination, so
Steam-specific work must select its Steam URL rather than assume a scalar link.
The historical field migration has been retired and must not be run against the
current schema.

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
least five seconds apart. HTTP 429 responses honor `Retry-After` and use
exponential backoff starting at 60 seconds, capped at 15 minutes; after five
retries the script aborts instead of continuing to send requests.

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
