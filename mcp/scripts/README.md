# MCP maintenance scripts

## Game links

The old `games.download_url` field no longer exists. Scripts that need a
storefront link must expand `games.links` with `links.url,links.kind`, filter to
the canonical `download` kind, and create new acquisition links as
`games_links` rows. A game may have more than one download destination, so
Steam-specific work must select its Steam URL rather than assume a scalar link.

`migrate_games_links.py` is the sole historical exception: it intentionally
reads the former fields only when restoring or replaying a pre-migration
database snapshot. Do not run it against the current schema.

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
