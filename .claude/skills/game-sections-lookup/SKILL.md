---
name: game-sections-lookup
description: Look up per-game chapter/act/episode/mission structure via WebSearch and record it in Directus (game_sections), then trigger a site rebuild. Accepts a player_status, a single slug/title, a genre, a tier list, or a raw Directus filter.
allowed-tools:
  - WebSearch
  - Bash
  - Read
---

# Game Sections Lookup

Look up credible game section structures, cache the findings, write them through the deterministic population CLI, and rebuild the site.

## Safety Rules

- Make no schema changes. Do not create, alter, or delete Directus collections, fields, relations, or permissions.
- Use WebSearch, plus any discovered local lookup script (see "Optional Local Lookup Scripts" below), as the only lookup mechanisms. Do not use WebFetch or depend on fetching a specific wiki page.
- Never use `mcp__directus__*` for writes. Send all game and `game_sections` writes through `mcp/scripts/populate_game_sections.py`, which uses `scriptlib.DirectusClient`.
- Never guess or fabricate a total section count.
- Never guess or set `current_section`. Preserve the owner's existing value.
- Use only ASCII punctuation in cache and payload text.

## Optional Local Lookup Scripts

`mcp/scripts/ignored/` is gitignored and may or may not exist in a given checkout. It can hold extra, credentialed lookup scripts that are too sensitive to commit. Some of these may be relevant to this skill.

Before searching each game, check once per run whether any such script is available:

```bash
grep -l "^# game-sections-lookup:" mcp/scripts/ignored/*.py 2>/dev/null
```

If nothing matches, the directory may not exist or may hold no relevant script -- silently continue with WebSearch only, no error, no complaint.

If one or more scripts match, for each one:

1. Run it with `--help` (or read its module docstring) to learn its argument and output format. Do not guess at its interface.
2. Invoke it **only** in its documented default/read-only mode. Never pass a flag that looks like it would write, apply, import, or commit anything (e.g. `--apply`, `--write`, `--import`, `--commit`) -- this directory also holds unrelated scripts with real write flags, and this skill must never trigger one. If a discovered script's only documented mode is a write mode, skip it and do not run it.
3. Treat its output as an additional research signal, on top of WebSearch, particularly for AVN titles. A dev-sourced changelog/update feed is usually more authoritative than a third-party guide for figuring out how far an actively-updating game has progressed, but most changelog entries won't state a chapter number outright -- read the text for an explicit chapter/episode mention before treating it as evidence of a *total* count. A changelog confirming the latest known version/update is good evidence for the *current* released section, independent of whether a final total is known.

## Resolve Targets

Run one of these commands from the repository root:

| Intent | Input | Command |
|---|---|---|
| All in-progress games | `status=in_progress` | `mcp/scripts/populate_game_sections.py --list-targets --status in_progress` |
| A single game | `slug=final-fantasy-vii-remake` | `mcp/scripts/populate_game_sections.py --list-targets --slug final-fantasy-vii-remake` |
| A genre's members | `genre=crpg` | `mcp/scripts/populate_game_sections.py --list-targets --genre crpg` |
| A tier list's members | `tier-list=crpgs` | `mcp/scripts/populate_game_sections.py --list-targets --tier-list crpgs` |
| Arbitrary filter | `filter={"player_status":{"_eq":"in_progress"}}` | `mcp/scripts/populate_game_sections.py --list-targets --filter '{"player_status":{"_eq":"in_progress"}}'` |

The `--filter` value is a Directus-style filter object. Parse the JSON array printed to stdout. Skip a game when `existing_section_count > 0` unless the user explicitly requested a refresh.

Before researching a target, run:

```bash
mcp/scripts/populate_game_bundle.py <slug> --list
```

If the result contains bundle members, do not flatten their sections onto the
parent. Research each `section_data_status=unknown` member independently. Use
the cache key `<parent-slug>|<member-slug>` and include both `slug` and `member`
in every section payload. Skip members already marked `tracked` or
`not_applicable` unless the user explicitly requested a refresh.

## Look Up Each Game

Read `mcp/cache/game_sections_lookup.json` when it exists. Treat it as a JSON object keyed by slug and reuse a cached finding before searching. Update the file after each game so the run is resumable.

For AVN titles, if an "Optional Local Lookup Scripts" match was found (see above), run it for this game first and factor its output in alongside WebSearch, not instead of it.

Use 1-2 WebSearch queries per uncached game. Start with:

- `"<title>" number of chapters`
- `"<title>" chapter list`
- For AVNs, `"<title>" latest version chapters` or `"<title>" episode list`

Detect the noun the game uses, such as Chapter, Act, Episode, Mission, Case, Day, or Route. Default the noun to `Chapter` only when no better noun appears.

Determine a credible total from the search snippets. Require corroboration. AVN devlog text such as "Chapter 3 is now available" is valid evidence that at least three chapters exist. When sources conflict, prefer the more authoritative and most recent evidence, and save the reasoning with the cached finding.

Save credible findings in `mcp/cache/game_sections_lookup.json` under the slug, including at least `slug`, `title`, `noun`, `count`, `sections`, `reason`, and the search queries or source descriptions used.

## Mandatory Correctness Gate

If WebSearch cannot establish a credible total count, do not invent one, do not create default rows, and do not write that game to Directus. Skip the game and add or update this object in `mcp/cache/game_sections_needs_manual.json`:

```json
{
  "slug": "<slug>",
  "title": "<title>",
  "reason": "<why no credible total could be established>"
}
```

Keep `game_sections_needs_manual.json` as a JSON array with at most one entry
per ordinary-game slug or per `<parent-slug>|<member-slug>` pair. Bundle entries
must include a `member` field so two unresolved campaigns under one parent do
not overwrite one another.

The `"{Noun} {N}"` default is allowed only for an individual section title after a credible total count is already known. It is never evidence for, or a substitute for, the total count. A missing credible total always means skip and record for manual follow-up.

## Write Credible Findings

Build a JSON array in this shape:

```json
[
  {
    "slug": "final-fantasy-vii-remake",
    "member": null,
    "noun": "Chapter",
    "current": null,
    "sections": [
      {"number": 1, "title": null},
      {"number": 2, "title": "Fateful Encounters"}
    ]
  }
]
```

Use the real per-section title when credible evidence provides it. Otherwise omit `title` or set it to `null`; the population CLI will supply `"{Noun} {N}"`. Always pass `"current": null`, which leaves `current_section` untouched.

For a bundle member, set `member` to its stable member slug:

```json
{
  "slug": "halo-the-master-chief-collection",
  "member": "halo-combat-evolved-anniversary",
  "noun": "Mission",
  "current": null,
  "sections": [
    {"number": 1, "title": "The Pillar of Autumn"}
  ]
}
```

For more than two games, run and show the dry-run output before applying:

```bash
mcp/scripts/populate_game_sections.py --from-json - --dry-run < payload.json
mcp/scripts/populate_game_sections.py --from-json - < payload.json
```

For an explicitly requested refresh, add `--replace` to both commands. Otherwise rely on the script's idempotent upsert by section number. Record the affected game ids from target enumeration for the rebuild.

The population CLI triggers one rebuild for the affected parent game IDs after
an applied batch. Save the timestamp printed immediately before invoking the
apply command, then monitor that triggered build.

## Rebuild and Monitor

Poll the OpenSearch `container-logs` index for container
`directus-site-builder` until either `Build/publish completed successfully.` or
`Build/publish FAILED with exit code N.` appears with a timestamp strictly
after the saved pre-apply timestamp. Never accept a completion line from an
older build.

Report the build result, the games written, the games skipped, and the complete contents of `mcp/cache/game_sections_needs_manual.json`.
