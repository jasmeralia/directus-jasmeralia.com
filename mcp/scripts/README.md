# MCP maintenance scripts

## Itch.io release-year backfill

`itch_published_dates.mjs` retrieves the account-gated `Published` field for games with no release year and an itch.io link. Export the authorized itch.io cookies from Firefox to the gitignored path `mcp/scripts/ignored/cookies.json`, then run:

```sh
node mcp/scripts/itch_published_dates.mjs
node mcp/scripts/itch_published_dates.mjs --apply
```

The first command saves the research results to `mcp/cache/itch_published_dates.json`; `--apply` updates only records with an unambiguous four-digit year. The script uses the Android Firefox user agent required for this source. Never commit the cookie export.
