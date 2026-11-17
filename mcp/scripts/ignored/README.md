# Local-only scripts

Scripts in this directory are machine-specific or otherwise intentionally
excluded from version control. Do not move them into the tracked
`mcp/scripts/` directory or describe an individual ignored script in tracked
project documentation.

## Backfill GameStoryLog developer links

`backfill_gsl_developer_links.py` finds games with `games_links.kind ==
"gamestorylog"`, resolves their GSL creator profile, and adds a missing
`developers_links` row with `kind == "gamestorylog"` for the associated
developer.

The script groups game rows by normalized GSL URL before looking up GSL
metadata, so a shared page (such as the four Lust Academy seasons) is looked
up once. After a developer's profile is found or already exists, their other
games do not trigger more GSL lookups. Ambiguous game-to-developer matches are
reported for manual review and are not written.

Run from the repository root:

```bash
python3 mcp/scripts/ignored/backfill_gsl_developer_links.py
python3 mcp/scripts/ignored/backfill_gsl_developer_links.py --apply
python3 mcp/scripts/ignored/backfill_gsl_developer_links.py --refresh
```

The default is a dry run. `--apply` adds the planned link rows without
triggering a site rebuild. `--refresh` ignores cached GSL game metadata and
fetches needed pages again. Each unique GSL URL and each added link reports
numeric progress as `(X/Y processed: Z%)`. GSL responses use the shared
`mcp/cache/gsl_game_data.json` cache.

## Backfill GameStoryLog synopses

`backfill_gsl_synopsis.py` plans synopsis values from the full descriptions on
GameStoryLog pages linked from `games_links`. It groups Directus games by GSL
slug, protects existing non-GSL synopses, and writes the same GSL text to every
Directus game that links a shared GSL page (duplicates are intended). Text is normalized to plain text with paragraph breaks preserved; the
review report lists anomalies and inserted paragraph breaks.

Run from the repository root:

```bash
python3 mcp/scripts/ignored/backfill_gsl_synopsis.py
python3 mcp/scripts/ignored/backfill_gsl_synopsis.py --refresh
python3 mcp/scripts/ignored/backfill_gsl_synopsis.py --only-slug game-slug
python3 mcp/scripts/ignored/backfill_gsl_synopsis.py --apply
python3 mcp/scripts/ignored/backfill_gsl_synopsis.py --self-test
```

The default is a dry run. It reads cached GSL responses first, then saves a
plan and review file under `mcp/cache/`; `--refresh` refetches selected pages.
`--apply` uses only the saved plan and never requests GSL data. Apply writes through the
Directus REST API and saves resumable progress every 25 rows; it does not
trigger a site rebuild.


Apply rechecks both synopsis text and source against the saved plan, protecting
manual rows even when their text is empty. Regenerate older plans that lack the
recorded source. Directus pagination is supplied by `fetch_all`; callers must not
add their own `limit` parameter.

The initial rollout on 2026-11-03 filled all 363 linked games (including shared
page duplicates) with no errors. All 363 were unchanged on the verification
dry run. The production publish and public masking/search/feed checks passed.

## Import GameStoryLog metadata

`gsl_import.py` captures GSL's average playtime in minutes and tag labels from
the Genre, Gameplay, Protagonist, Relationship, Orientation, and Media
categories. It writes those values to `games.gsl_average_playtime_minutes` and
`games.gsl_tags` when importing or refreshing games. Media tags are retained in
Directus but omitted from the TitleDeck synopsis header. Genre tags continue to
be linked to matching Directus genres; unmatched genre names are reported for
review.
