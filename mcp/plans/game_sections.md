# Game Section / Chapter Tracking Plan

Per-game tracking of a title's chapter / act / episode / mission structure (the "section" noun varies per game), plus the section the owner is currently on. Delivery is three-pronged: a deterministic manual script, a Claude Code skill that drives WebSearch to look up section structure, and Astro surfacing on the game detail page and a filter page. Scope covers AAA titles (Final Fantasy VII Remake, Detroit: Become Human) down to niche itch.io / Patreon AVNs.

## Decisions / constraints

- **Schema shape: dedicated child collection `game_sections` (o2m from `games`), plus two scalar fields on `games`.** This follows the codebase's established rule that repeatable structured per-game data lives in a dedicated child/junction collection (`games_links`, `tier_list_games`), never a JSON blob or multi-value field. The repeatable data here is the ordered list of titled sections -> `game_sections` rows. The two genuinely singular per-game values (the section noun, and which section the owner is on) are scalars and belong directly on `games`, exactly as `release_year` / `player_status` are scalars while `genres` / `links` are children. A flat "count + noun + JSON-array-of-titles + current-index" design on `games` was rejected: it breaks the junction convention, can't be linked/filtered relationally, and would need bespoke JSON handling in every consumer.
- **"Current section" is represented as an integer `current_section` on `games`, holding the ordinal `number` of the section the owner is on (null = not tracked).** Rejected: a boolean `is_current` flag on one `game_sections` row (invites the multi-true / zero-true invariant bug and breaks on re-population). Rejected: an FK from `games` to a specific `game_sections` row (fragile across delete-and-recreate cycles). An integer ordinal survives full row re-population unchanged.
- **No denormalized `section_count` field.** The total is `game_sections` row count for the game, derived trivially in JS/queries. Storing a count invites sync drift for no gain; "count known but rows not yet created" never occurs because when the count is known we create the rows immediately (with default titles).
- **`game_sections` is added to `scriptlib.GAME_JUNCTIONS`** (FK `games_id`) so `delete_game_junctions` cleans it up before any game delete, per the mandatory junction-sweep rule.
- **Manual script is pure/deterministic: Directus-only, no LLM, no external HTTP.** Because it never touches an external API, the AGENTS.md external-API backoff / disk-cache requirement does not apply to it (same as `populate_tier_list.py`, which is Directus-only). It writes through `scriptlib.DirectusClient`.
- **The skill shells out to the shared Python script for all Directus writes, rather than using `mcp__directus__*` tools from its own instructions.** This keeps every write in this repo on the one audited path (static token via `urllib.request` through `DirectusClient`), reusing slug resolution, default-title generation, idempotent upsert, and ASCII-only typography in one place instead of re-specifying write logic in skill prose. The skill's LLM role is confined to what only an LLM can do: enumerate targets, run WebSearch, reason over ambiguous snippets, and decide count / noun / titles, then hand a structured JSON payload to the script.
- **WebSearch is the only lookup mechanism.** `WebFetch` against IGN / Fandom / GameFAQs / StrategyWiki is confirmed blocked (402/403/refused) and no component may depend on fetching a specific wiki URL. WebSearch is Claude Code's own tool, so the external-API backoff rule does not apply to it; the skill still paces itself (1-2 queries per game) and caches per-game findings to disk for resumability.
- **Never fabricate a section count.** If the skill cannot find a credible total, it leaves that game unpopulated (no rows, `current_section` null) and records it in `mcp/cache/game_sections_needs_manual.json`. Defaulting applies only to individual section *titles* when the count IS known but per-section names are not: title defaults to `"{Noun} {N}"` (e.g. `Chapter 5`, `Mission 3`), where `{Noun}` is the term that game actually uses (detected during lookup or supplied manually), defaulting to `Chapter` only when no better noun is known.
- **The skill never guesses `current_section`.** Which section the owner is on is owner-knowledge, set via the manual script's `--current` flag or in the Directus admin; the skill leaves it untouched.
- **Section progress percentages on cards and franchise lists** are computed in `site/src/lib/game-sections.ts` (`sectionProgressPercent`, `sectionProgressSummary`). Completed games always show 100% even when section rows or `current_section` are absent. In-progress and on-hold games credit the current section at 50% of its span (e.g. section 2 of 10 = 15%, between the 10% lower bound after section 1 and the 20% upper bound at section completion). Other player statuses use the upper-bound formula (`current / total`). Optional DLC is excluded from linear section data today; if added later, model it like `game_bundle_members` with per-DLC section rows. Nonlinear quest or mission pools should include DLC entries under clearly named DLC categories because per-row completion preserves their optional nature.
- **Schema creation is gated.** Per AGENTS.md, field/collection/relation creation requires an explicit "go ahead" directed at the schema change at execution time, separate from approval of this plan. Phase 1 must not run until that go-ahead is given, and a `pg_dump` is taken first.
- **Astro rules apply:** new-collection read grant for the Astro Readonly policy before the next build; section ordering sorted in JS (never Postgres); ASCII only; `CHANGELOG.md` entry + `site/package.json` patch bump (1.0.150 -> 1.0.151) in the same commit as the site change.

## Prerequisites

- Repo `.mcp.json` present with `DIRECTUS_TOKEN` / `DIRECTUS_URL` (already the case).
- Explicit user go-ahead for the Phase 1 schema change (see gate above).
- No new external credentials are required (WebSearch and Directus only).

---

## Phase 0: Pre-flight

1. Take a full backup before any schema change (mandatory, no size threshold):
   ```
   scriptlib.take_pg_dump_backup("game_sections_schema")
   ```
   or the raw command from AGENTS.md "Rules for schema changes". Record the returned filename.
2. Confirm the Astro Readonly policy id and games read-permission scope:
   - `GET /permissions?filter[policy][_eq]=84f316ac-2d5e-4b5a-8f56-99e27a8f1cdf&filter[collection][_eq]=games` -> confirm `fields` is `["*"]`. If it is field-scoped rather than `*`, the two new `games` fields (`section_noun`, `current_section`) must be added to that permission in Phase 1; if `*`, they are covered automatically.

---

## Phase 1: Schema creation (GATED - requires explicit go-ahead)

**No output file. Directus schema mutations + one scriptlib edit.** Do not start until the user says go ahead for the schema change and Phase 0 backup exists.

### 1.1 Create collection `game_sections`

`POST /collections`:
```json
{
  "collection": "game_sections",
  "schema": {},
  "meta": {
    "icon": "list",
    "note": "Ordered chapter/act/episode/mission structure per game",
    "sort_field": "sort",
    "hidden": false
  }
}
```

### 1.2 Create `game_sections` fields

`POST /fields/game_sections` once per field:

| field | type | interface / schema | notes |
|---|---|---|---|
| `id` | integer | auto-increment PK | created with the collection |
| `games_id` | integer | m2o -> `games` | FK; relation created in 1.3 |
| `sort` | integer | manual sort | Directus row ordering; display order is by `number` in JS regardless |
| `number` | integer | numeric input, required | canonical ordinal 1..N |
| `title` | string | text input, required | e.g. `Chapter 5` or a real name like `Nibelheim` |

### 1.3 Create the o2m relation

`POST /relations`:
```json
{
  "collection": "game_sections",
  "field": "games_id",
  "related_collection": "games",
  "meta": { "one_field": "sections", "sort_field": "sort", "one_deselect_action": "delete" },
  "schema": { "on_delete": "SET NULL" }
}
```
This also creates the `sections` o2m alias field on `games`, mirroring the existing `games` -> `games_links` (`links`) relation. Junction cleanup is still handled explicitly via `GAME_JUNCTIONS` (1.6) rather than relying on cascade, per AGENTS.md.

### 1.4 Add scalar fields to `games`

`POST /fields/games`:
```json
{ "field": "section_noun", "type": "string",
  "meta": { "interface": "input", "note": "Chapter/Act/Episode/Mission/... (null = Chapter)" },
  "schema": { "is_nullable": true } }
```
```json
{ "field": "current_section", "type": "integer",
  "meta": { "interface": "input", "note": "Ordinal of the section currently being played (null = not tracked)" },
  "schema": { "is_nullable": true } }
```

### 1.5 Grant Astro Readonly read on `game_sections`

`POST /permissions`:
```json
{ "policy": "84f316ac-2d5e-4b5a-8f56-99e27a8f1cdf",
  "collection": "game_sections", "action": "read", "fields": ["*"] }
```
If Phase 0.2 found the `games` read permission is field-scoped, also PATCH it to include `section_noun` and `current_section`. Missing grants cause build-time 403s.

### 1.6 Register the junction (code, not schema; no version bump)

Edit `mcp/scripts/scriptlib.py` -> add to `GAME_JUNCTIONS`:
```python
("game_sections", "games_id"),
```
This is an `mcp/scripts` change only (no `site/` change, so no CHANGELOG / package bump).

---

## Phase 2: Manual population + shared write library

### 2.1 `mcp/scripts/game_sections_lib.py` (new shared module)

Shared write/resolve logic reused by both the manual CLI and the skill's CLI, so there is exactly one write path. Functions:

- `default_title(noun: str, number: int) -> str` -> `f"{noun} {number}"`.
- `normalize_noun(noun: str | None) -> str` -> stripped noun, defaulting to `"Chapter"` when falsy. ASCII-only (reject / strip smart punctuation).
- `resolve_game(client, slug) -> dict` -> slug -> id/title lookup (same idiom as `populate_tier_list.py`; exits with a clear error if not found).
- `resolve_targets(client, *, filter_obj=None, slug=None, status=None, genre=None, tier_list=None) -> list[dict]` -> returns `[{id, slug, title, player_status, existing_section_count, section_noun, current_section}]`. Convenience kwargs translate to Directus filters; `filter_obj` is the raw escape-hatch filter applied to `/items/games`. `tier_list` resolves via `tier_list_games` -> game ids -> `id[_in]`. Existing section count is read from the `sections` o2m (or a `game_sections?filter[games_id][_eq]` count).
- `upsert_game_sections(client, game_id, *, noun, sections, current=None, replace=False, dry_run=False) -> dict` where `sections` is `[{number:int, title:str|None}]`:
  1. Set `games.section_noun = normalize_noun(noun)` (and `current_section` if `current` is not None) via `PATCH /items/games/{id}`.
  2. Fetch existing `game_sections` rows for the game.
  3. If `replace`: delete existing rows first. Otherwise upsert by `number` (patch existing same-number row's title, create missing).
  4. For each requested section: `title = title or default_title(noun, number)`; `POST` / `PATCH /items/game_sections` with `{games_id, number, title, sort: number}`.
  5. In `dry_run`, print planned writes to stderr and perform none.
  Returns `{game_id, created, updated, deleted}`.

### 2.2 `mcp/scripts/populate_game_sections.py` (new CLI)

Deterministic manual tool. Required invocation preserved exactly:
```
./mcp/scripts/populate_game_sections.py <game slug> <number of sections> [<section noun, defaults to Chapter>]
```
argparse (sibling in style to `populate_tier_list.py`):
- positional `slug`
- positional `count` (int)
- positional optional `noun` (default `"Chapter"`)
- `--current N` (optional; set `games.current_section`)
- `--replace` (delete existing rows before creating)
- `--dry-run`

Behavior: resolve slug -> game via `resolve_game`; build `sections = [{number: n, title: None} for n in 1..count]` (None -> default `"{noun} {n}"` inside `upsert_game_sections`); call `upsert_game_sections(..., noun=noun, sections=sections, current=args.current, replace=args.replace, dry_run=args.dry_run)`. Prints a per-row summary to stderr. No external HTTP, so no backoff/cache (documented rationale above).

Additional non-positional modes on the same script for the skill (guarded so the documented positional form remains the default path):
- `--list-targets` with any of `--filter '<json>'` / `--slug` / `--status` / `--genre` / `--tier-list` -> prints a JSON array from `resolve_targets` to stdout (machine-readable for the skill). No writes.
- `--from-json <path|->` -> reads `[{slug, noun, current, sections:[{number, title}]}]` and calls `upsert_game_sections` per entry (this is how the skill writes real per-section titles it found). Honors `--dry-run` / `--replace`.

Run `make lint-python` (ruff / ruff format / pylint / mypy) before committing this phase.

---

## Phase 3: Claude Code skill

### 3.1 Skill format (confirmed against the installed skills)

Project skills live at `<repo>/.claude/skills/<name>/SKILL.md` with YAML frontmatter (`name`, `description`, `allowed-tools`) followed by markdown instructions, optionally a `templates/` subdir. Confirmed by inspecting `~/.claude/skills/codex-worklist-loop/SKILL.md` (frontmatter keys `name` / `description` / `allowed-tools`, plus a `templates/` dir). The skill is placed in the repo so it is version-controlled and shipped with the project.

### 3.2 Files

- `.claude/skills/game-sections-lookup/SKILL.md`

Frontmatter:
```yaml
---
name: game-sections-lookup
description: Look up per-game chapter/act/episode/mission structure via WebSearch and record it in Directus (game_sections), then trigger a site rebuild. Accepts a player_status, a single slug/title, a genre, a tier list, or a raw Directus filter.
allowed-tools:
  - WebSearch
  - Bash
  - Read
---
```

### 3.3 Invocation interface (documented in the skill body)

The skill resolves a flexible target set. The user (or the skill's own instructions) expresses the target one of these ways, all mapped to `populate_game_sections.py --list-targets`:

| Intent | User phrasing / arg | Resolver flag |
|---|---|---|
| All in-progress games | `status=in_progress` | `--status in_progress` |
| A single game | `slug=final-fantasy-vii-remake` | `--slug ...` |
| A genre's members | `genre=crpg` | `--genre crpg` |
| A tier list's members | `tier-list=crpgs` | `--tier-list crpgs` |
| Arbitrary escape hatch | `filter={"player_status":{"_eq":"in_progress"}}` | `--filter '<json>'` |

The raw `--filter` accepts a Directus-style filter object, consistent with how the rest of the codebase expresses filters.

### 3.4 Skill procedure (in SKILL.md body)

1. **Enumerate targets:** `Bash: mcp/scripts/populate_game_sections.py --list-targets <resolver flag>` -> parse the JSON array. Skip games that already have `existing_section_count > 0` unless the user asked to refresh.
2. **Per game, look up structure with WebSearch** (1-2 queries; cache each game's finding to `mcp/cache/game_sections_lookup.json` keyed by slug for resumability):
   - Queries such as `"{title}" number of chapters`, `"{title}" chapter list`, and for AVNs `"{title}" latest version chapters` / `"{title}" episode list`.
   - **Detect the noun** from the results (Chapter / Act / Episode / Mission / Case / Day / Route ...); default to `Chapter` only when nothing better appears.
   - **Reason over the snippets** to decide a credible total count. Require corroboration; treat AVN devlog phrasing ("Chapter 3 is now available") as evidence of count; on conflicting numbers prefer the more authoritative / most recent.
3. **Correctness gate (mandatory):** if no credible total is found, do NOT guess. Record `{slug, title, reason}` to `mcp/cache/game_sections_needs_manual.json` and move on. Never write a fabricated count.
4. **Write findings:** build a JSON payload `[{slug, noun, current: null, sections:[{number, title}]}]` where `title` is the real per-section name if found, else omitted/null (the script fills `"{Noun} {N}"`). Pipe it to `Bash: mcp/scripts/populate_game_sections.py --from-json -`. Do a `--dry-run` pass first when operating on more than a couple of games and show the diff before applying. Do not set `current_section`.
5. **Rebuild + monitor:** after writes, trigger the documented flow with the affected game ids as string keys:
   - `POST https://directus.jasmer.tools/flows/trigger/e3aa03ad-3352-4ade-8156-22d53f107907`, bearer `DIRECTUS_TOKEN`, body `{"collection":"games","keys":["<id>", ...]}`.
   - Record the trigger timestamp, then poll OpenSearch (`container-logs`, container `directus-site-builder`) for `Build/publish completed successfully.` or `Build/publish FAILED with exit code N.` with a timestamp strictly after the trigger. Report the result and the contents of `game_sections_needs_manual.json` to the user.

The skill body must state explicitly that it makes no schema changes and never uses `mcp__directus__*` for writes (all writes go through `populate_game_sections.py`).

---

## Phase 4: Astro surfacing (site change -> CHANGELOG + version bump)

### 4.1 New typed helper `site/src/lib/game-sections.ts`

Mirrors the `walkthrough-link.ts` style. Exports:
- `type GameSection = { id?: number; number: number; title: string }`.
- `sectionNoun(raw: string | null | undefined): string` -> raw or `"Chapter"`.
- `pluralizeNoun(noun: string): string` -> `Episode` -> `Episodes`, `Act` -> `Acts` (simple `+ "s"`, with the `y` -> `ies` case if it ever arises).
- `orderedSections(sections: GameSection[] | null | undefined): GameSection[]` -> `.slice().sort((a,b) => a.number - b.number)`. Ordering is done in JS here (never a Directus `sort` on the collation), per AGENTS.md.
- `sectionProgressPercent(current, total, playerStatus?)` and `sectionProgressSummary(entry, { nested? })` -> shared card/list progress math. Completed = 100% regardless of section rows; in-progress/on-hold = half credit on the current section; other statuses = upper-bound `current / total`.

### 4.2 Game detail page `site/src/pages/games/[slug].astro`

- Extend the `games` query `fields` with: `'section_noun'`, `'current_section'`, `'sections.id'`, `'sections.number'`, `'sections.title'`.
- Compute `const noun = sectionNoun(game.section_noun); const sections = orderedSections(game.sections); const current = game.current_section ?? null;`.
- Render a new sibling `.panel` section (not crammed into the Details `<li>` list, because an 18-item chapter list is too long for that row - a dedicated panel matches the existing "Reviews" sibling-panel pattern), only when `sections.length > 0`:
  - Label: `{pluralizeNoun(noun)}` (e.g. "Chapters").
  - A header line: when `current` is set, `Currently on {noun} {current} of {sections.length}`; otherwise `{sections.length} {pluralizeNoun(noun)}`.
  - An ordered list of `sections`, each showing `{section.title}`, with the row where `section.number === current` visually highlighted (reuse the existing `#8c58ff` / status-color accents already used in this file rather than new chrome).
- Follows the existing Walkthrough row precedent for how structured per-game link/label data is surfaced (labeled block inside the existing panel styling).

### 4.3 Filter/listing page `site/src/pages/filters/misc/games-missing-sections.astro` (add now)

Justification for adding now rather than deferring: the owner's workflow explicitly produces a "needs manual entry" set (skill correctness gate + `game_sections_needs_manual.json`), and surfacing that on the site closes the loop cheaply by reusing the exact `avn-missing-walkthrough.astro` scaffold (`CsvHeader`, `ThumbnailBorderLegend`, `GameThumbCard`, `sortByTitle`, `getSTierGameIds`). A progress-percentage filter ("games with X% chapter progress") is deferred - it needs a per-game count/current join that adds complexity without a proven need yet.

- Query `games` with `GAME_THUMB_FIELDS`, `limit: -1`, filter `{ player_status: { _eq: "in_progress" } }` (the primary population the owner tracks while playing).
- Separately query `game_sections` for `games_id` of those ids (mirroring how the AVN page queries `reviews` separately) to build a `Set` of game ids that already have sections. Do NOT add `sections` to `GAME_THUMB_FIELDS` (that field list feeds many thumb consumers; keep the blast radius zero by querying separately here).
- `filteredGames` = in-progress games whose id is not in that set. Render with `GameThumbCard`, plus `CsvHeader` CSV export, matching the AVN page exactly.

### 4.4 Changelog + version

Prepend a `## [1.0.151] - <date>` entry to `CHANGELOG.md` describing the sections panel + missing-sections filter, and bump `site/package.json` `version` to `1.0.151`, in the same commit. Run `make lintfix && make lint` before committing.

---

## Phase 5: Smoke test, rollout, and rebuild

Ordered so each layer is validated before the next is wired up.

1. **Manual script, dry run then apply, known title:** `populate_game_sections.py --dry-run final-fantasy-vii-remake 18` then without `--dry-run` (real 18-chapter structure). Verify 18 `game_sections` rows (`number` 1..18, titles `Chapter 1..18`, `sort` matching) and `games.section_noun = "Chapter"`. Try `--current 5` and confirm `current_section`. Test `--replace` idempotency (re-run yields no duplicates).
2. **Skill, small filtered set:** run the skill against a 2-3 game filter (e.g. `slug=detroit-become-human`, plus one AVN). Confirm: credible finds are written with correct noun; at least one deliberately-obscure title lands in `game_sections_needs_manual.json` rather than getting a fabricated count; `current_section` left null.
3. **Astro:** only after 1-2 pass, land the Phase 4 site change. Because local Astro builds are not an acceptance test here, validate by triggering the documented rebuild flow (keys = the ids touched in steps 1-2) and watching OpenSearch to `Build/publish completed successfully.` (timestamp strictly after trigger). Then eyeball the FF7R detail page (Chapters panel, "Currently on Chapter 5 of 18") and `/filters/misc/games-missing-sections/`.
4. **Deploy:** site change ships via the normal PR flow (`publish.sh`); the `mcp/scripts` + skill changes are script-only (`--no-build`). Report the needs-manual list to the owner for follow-up manual entry.

---

## Output files summary

| File | Type | Purpose |
|---|---|---|
| `game_sections` collection + `games.section_noun` / `games.current_section` | Directus schema (Phase 1, gated) | Storage for ordered sections, per-game noun, and current position |
| `mcp/scripts/scriptlib.py` (edited) | Code | Add `("game_sections", "games_id")` to `GAME_JUNCTIONS` |
| `mcp/scripts/game_sections_lib.py` | New module | Shared resolve/upsert/default-title logic (single write path) |
| `mcp/scripts/populate_game_sections.py` | New CLI | Manual deterministic population; `--list-targets` / `--from-json` modes for the skill |
| `.claude/skills/game-sections-lookup/SKILL.md` | New skill | WebSearch-driven lookup + write + rebuild |
| `mcp/cache/game_sections_lookup.json` | Cache (gitignored) | Per-slug skill findings, for resumability |
| `mcp/cache/game_sections_needs_manual.json` | Cache (gitignored) | Games with no credible count found - needs manual entry |
| `site/src/lib/game-sections.ts` | New lib | Noun formatting / pluralization / JS ordering |
| `site/src/pages/games/[slug].astro` (edited) | Site | Sections panel on the game detail page |
| `site/src/pages/filters/misc/games-missing-sections.astro` | New page | In-progress games with no section data |
| `CHANGELOG.md` + `site/package.json` (edited) | Site | `## [1.0.151]` entry + patch bump, same commit |

### Critical Files for Implementation
- /home/morgan/git/directus-jasmeralia.com/mcp/scripts/scriptlib.py
- /home/morgan/git/directus-jasmeralia.com/mcp/scripts/populate_tier_list.py
- /home/morgan/git/directus-jasmeralia.com/site/src/pages/games/[slug].astro
- /home/morgan/git/directus-jasmeralia.com/site/src/pages/filters/misc/avn-missing-walkthrough.astro
- /home/morgan/git/directus-jasmeralia.com/site/src/lib/download-link.ts

---

## Omnibus bundle extension

The original design above describes ordinary games. Omnibus library entries
use the extension in `mcp/plans/omnibus_bundles.md`:

- `game_bundle_members` stores each included game or campaign independently.
- `game_sections.bundle_member_id` scopes rows to one included game while
  `games_id` continues to identify the owning parent.
- `populate_game_sections.py --member <member-slug>` writes member-local
  sections and rejects direct parent sections when members exist.
- `populate_game_bundle.py` is the only supported bulk membership writer.
- `section_data_status` distinguishes unknown, tracked, and not-applicable
  member data without inventing a section count.
- Any `--replace` operation takes a full database backup before deleting rows.

The omnibus plan is authoritative wherever it extends this original design.
