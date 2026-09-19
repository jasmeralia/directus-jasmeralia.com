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

## Itch.io release-year backfill

`itch_published_dates.mjs` retrieves the account-gated `Published` field for games with no release year and an itch.io link. Export the authorized itch.io cookies from Firefox to the gitignored path `mcp/scripts/ignored/cookies.json`, then run:

```sh
node mcp/scripts/itch_published_dates.mjs
node mcp/scripts/itch_published_dates.mjs --apply
```

The first command saves the research results to `mcp/cache/itch_published_dates.json`; `--apply` updates records with an absolute year or a day-relative date resolved against that record's fetch time. The script uses the Android Firefox user agent required for this source. Never commit the cookie export.
