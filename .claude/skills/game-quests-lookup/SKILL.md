---
name: game-quests-lookup
description: Look up per-game quest/mission lists for nonlinear games via WebSearch and record them in Directus (game_sections, section_style=nonlinear), then trigger a site rebuild. Accepts a player_status, a single slug/title, a genre, a tier list, or a raw Directus filter. For AVNs with a local, parseable in-game journal export, prefer populate_game_quests.py --from-txt directly instead of this skill.
allowed-tools:
  - WebSearch
  - Bash
  - Read
---

# Game Quests Lookup

Sibling to `game-sections-lookup`, for games whose sections are a pool of
quests/missions completed in largely arbitrary order rather than a strict
1..N sequence (`games.section_style = "nonlinear"`). See
`mcp/plans/game_sections_nonlinear.md` for the full design.

## When To Use This Skill vs. The Manual Path

This skill is for games with no local, parseable source to read a quest list
from directly -- the common case for AAA/mainstream open-world and sandbox
titles. If the target is a locally installed Ren'Py AVN with an in-game
journal/quest-log the owner can export to text (see
`things_to_do_quests.txt`-style exports), prefer
`mcp/scripts/populate_game_quests.py --from-txt <path>` directly -- it is
deterministic and does not depend on a wiki having comprehensive coverage.
Only fall back to this skill when that path is not available.

## Safety Rules

- Make no schema changes. Do not create, alter, or delete Directus collections, fields, relations, or permissions.
- Use WebSearch as the only lookup mechanism. Do not use WebFetch or depend on fetching a specific wiki page -- WebFetch is confirmed blocked on IGN, Fandom, GameFAQs, and StrategyWiki.
- Never use `mcp__directus__*` for writes. Send all game and `game_sections` writes through `mcp/scripts/populate_game_quests.py`, which uses `scriptlib.DirectusClient`.
- Never guess or fabricate a quest title, and never invent a category grouping the source doesn't actually have.
- Never set `completed` or `is_ending`. Those are owner-knowledge, set by hand in the Directus admin -- this skill only ever populates structure.
- Use only ASCII punctuation in cache and payload text.

## Resolve Targets

Run one of these commands from the repository root:

| Intent | Input | Command |
|---|---|---|
| All in-progress games | `status=in_progress` | `mcp/scripts/populate_game_quests.py --list-targets --status in_progress` |
| A single game | `slug=example-game` | `mcp/scripts/populate_game_quests.py --list-targets --slug example-game` |
| A genre's members | `genre=open-world-rpg` | `mcp/scripts/populate_game_quests.py --list-targets --genre open-world-rpg` |
| A tier list's members | `tier-list=crpgs` | `mcp/scripts/populate_game_quests.py --list-targets --tier-list crpgs` |
| Arbitrary filter | `filter={"player_status":{"_eq":"in_progress"}}` | `mcp/scripts/populate_game_quests.py --list-targets --filter '{"player_status":{"_eq":"in_progress"}}'` |

Parse the JSON array printed to stdout. Each target includes `existing_section_count`
and `section_style`. Skip a game when `existing_section_count > 0` unless the
user explicitly requested a refresh, and skip (or flag to the user) any
target whose `section_style` is already `"linear"` -- converting an existing
linear game requires an explicit `--replace` decision by the operator, not
something this skill should do on its own initiative.

## Look Up Each Game

Read `mcp/cache/game_quests_lookup.json` when it exists. Treat it as a JSON
object keyed by slug and reuse a cached finding before searching. Update the
file after each game so the run is resumable.

Use 1-2 WebSearch queries per uncached game. Start with:

- `"<title>" quest list`
- `"<title>" side quests wiki`
- `"<title>" missions`

Detect the noun the game uses, such as Quest, Mission, Case, or Contract.
Default the noun to `Quest` only when no better noun appears.

## Mandatory Correctness Gate

Unlike a chapter count (a single number that can be corroborated), a full
quest list is either sourced verbatim or not sourced at all -- there is no
"credible number" middle ground to fall back on. This gate checks for a
**named list**, not a total:

- Only treat a source as usable when it enumerates named quests directly --
  an established wiki's dedicated Quests/Missions page, an official quest
  log, or patch notes listing named content. Summary prose ("approximately
  40 side quests") is not a list and does not clear this bar.
- Use the source's own grouping for `category` when it has one (Main
  Quests/Side Quests/Faction/Companion, etc.). When the source is a flat
  list, use `category: null` for every entry rather than inventing a
  grouping that isn't really there.
- If no source clears this bar, do not invent quest titles and do not write
  the game to Directus. Skip it and add or update this object in
  `mcp/cache/game_quests_needs_manual.json`:

```json
{
  "slug": "<slug>",
  "title": "<title>",
  "reason": "<why no credible named quest list could be established>"
}
```

Keep `game_quests_needs_manual.json` as a JSON array with at most one entry
per slug. This is a sibling file to `game_sections_needs_manual.json`, kept
separate since the two "why this is unresolved" reasons don't overlap (a
missing total count vs. a missing named list).

Save credible findings in `mcp/cache/game_quests_lookup.json` under the
slug, including at least `slug`, `title`, `noun`, `entries`, `reason`, and
the search queries or source descriptions used.

## Write Credible Findings

Build a JSON array in this shape:

```json
[
  {
    "slug": "example-game",
    "noun": "Quest",
    "entries": [
      {"category": "Main Quests", "title": "The First Step"},
      {"category": "Main Quests", "title": "A Difficult Choice"},
      {"category": "Side Quests", "title": "Lost Cargo"}
    ]
  }
]
```

`category` may be `null` for a flat, ungrouped list. `entries` order is
preserved as the site's category-grouped display order and as the
per-category `number` ordinal -- both are assigned by the population script,
not by this skill.

For more than two games, run and show the dry-run output before applying:

```bash
mcp/scripts/populate_game_quests.py --from-json - --dry-run < payload.json
mcp/scripts/populate_game_quests.py --from-json - < payload.json
```

For an explicitly requested refresh of an already-populated nonlinear game,
add `--replace` to both commands -- required, since (unlike the linear
script) there is no in-place upsert-by-number for quest lists. Record the
affected game ids from target enumeration for the rebuild.

The population CLI triggers one rebuild for the affected game IDs after an
applied batch. Save the timestamp printed immediately before invoking the
apply command, then monitor that triggered build.

## Rebuild and Monitor

Poll the OpenSearch `container-logs` index for container
`directus-site-builder` until either `Build/publish completed successfully.` or
`Build/publish FAILED with exit code N.` appears with a timestamp strictly
after the saved pre-apply timestamp. Never accept a completion line from an
older build.

Report the build result, the games written, the games skipped, and the
complete contents of `mcp/cache/game_quests_needs_manual.json`.
