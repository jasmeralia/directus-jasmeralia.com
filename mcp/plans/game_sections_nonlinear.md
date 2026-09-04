# Non-Linear (Quest/Mission) Section Tracking — Design Plan

Extends `mcp/plans/game_sections.md` (authoritative for the existing linear
chapter/act/episode model — this doc only covers the delta) to support games
whose "sections" are a pool of quests/missions completed in largely arbitrary
order rather than a strict 1..N sequence, per Odoo task #506. Primary example:
*A House in the Rift*'s in-game journal (`things_to_do_quests.txt`), which
lists quest titles grouped under headers (`MAIN STORY`, `RAE`, `CAIT`, ...,
`GROUP, SEASONAL, AND MISCELLANEOUS`) with no numbering and no single next
step — the player checks quests off in whatever order the game allows.

**Hard requirement driving this design:** marking a quest done must be doable
directly in the Directus admin, with the ability to select several quests at
once and mark them all complete in one action. No custom UI/extension is
budgeted for this — the plan leans entirely on Directus's stock Data Studio
batch-edit feature.

## Decisions / constraints

- **New discriminator: `games.section_style`** (string, nullable, values
  `null`/`"linear"` (default, existing behavior, zero-touch for the 76
  games that currently have `game_sections` rows) or `"nonlinear"`). Drives
  which population workflow
  applies and which rendering branch the site uses. `section_noun` is
  reused unchanged for the display label (e.g. `"Quest"`, `"Mission"`,
  `"Case"`) — `section_style` is behavior, `section_noun` is text, same split
  already established between `game_status`/`player_status`.
- **Progress is tracked per-row, not via a single ordinal.** The existing
  `current_section` integer (games-level, "the ordinal I'm on") has no
  meaning when quests are unordered — there is no single "current" quest.
  Add `game_sections.completed` (boolean, default `false`). **Scope rule:**
  `completed` is only meaningful, written, or rendered when the parent game's
  `section_style = "nonlinear"`. For linear games, completion is still
  derived from `current_section` exactly as today; `completed` on those rows
  stays unused. One boolean, two disjoint meanings by game type, never both
  read for the same game — avoids a dual-source-of-truth bug.
- **New field `game_sections.category`** (string, nullable) — the group
  label a quest belongs to (`"Main Story"`, `"Rae"`, `"Group, Seasonal, and
  Misc"`, ...). Null for all existing linear-game rows (no group headers in
  that model). The source `.txt` convention's blank-line-separated
  ALL-CAPS headers become this field's value, not separate rows — a header
  line is metadata about the quests that follow it, not a section itself.
- **`number` keeps its existing required-int column but changes meaning for
  nonlinear rows: ordinal *within its category*, not a global position.**
  Rejected: making `number` nullable/optional for nonlinear rows — that
  would require conditional-required validation Directus can't express at
  the schema level, and per-category ordinals are trivial to auto-assign
  (1..N in source-file order per category) so there's no real case where a
  value is unavailable. The digit occasionally embedded in a quest's own
  title (`"Rae's Story ch. 4"`) is left alone as plain text — the script
  does not try to parse it out of the title; `number` is assigned purely by
  position in the source list.
- **Global display order stays the existing `sort` field**, auto-assigned by
  the population script in source-file order (category blocks in file
  order, quests within a category in file order). This is the same field
  the linear workflow already writes (`sort: number`) and the same field
  Directus's Table layout already defaults to — no new ordering field
  needed, and grouping-by-`category` at render time (stable partition over
  `sort` order) reproduces the source file's layout exactly (Main Story
  first, character sections in file order, Group/Seasonal/Misc last).
- **Ending flag: `game_sections.is_ending`** (boolean, default `false`),
  answering the original ticket's second ask ("a flag for which, if any, is
  considered the end of the game") and applying to **both** linear and
  nonlinear games — a linear game can also have a true/non-obvious ending
  row (multi-ending titles, an epilogue chapter, etc.), so this isn't scoped
  to nonlinear only. Nullable/optional by design: most games, especially
  ongoing AVNs, have no defined ending yet.
  - **Enforced with a partial unique index, not app-level convention.**
    `game_sections.md` rejected a boolean "is current" flag for exactly this
    invariant risk (multi-true / zero-true drift across re-population), but
    that flag changes constantly as rows churn; `is_ending` is set once and
    almost never revisited, so a real DB constraint is safe and cheap and
    removes the class of bug entirely instead of just documenting it away:
    ```sql
    CREATE UNIQUE INDEX game_sections_one_ending_per_game
      ON game_sections (games_id) WHERE is_ending AND bundle_member_id IS NULL;
    CREATE UNIQUE INDEX game_sections_one_ending_per_member
      ON game_sections (bundle_member_id) WHERE is_ending AND bundle_member_id IS NOT NULL;
    ```
    Two indexes (not one on `(games_id, bundle_member_id)`) because SQL NULLs
    aren't equal to each other for uniqueness purposes — a single index would
    let multiple parent-level (`bundle_member_id IS NULL`) rows all claim
    `is_ending`. This can't be created through `POST /fields` (Directus's
    schema API doesn't expose partial indexes); it's a manual `psql` step in
    Phase 1, after the pg_dump backup, same trust level as any other raw-SQL
    schema step in this repo.
- **No half-credit progress formula for nonlinear games.** The existing
  `(current - 0.5) / total` half-credit exists to model "partway through the
  chapter you're currently on" for a linear game — there's no analogous
  partial state for a quest that's either done or not. Nonlinear progress is
  simply `completed_count / total_count`, clamped to 100% when
  `player_status === "completed"` (same clamp linear games already get).
- **Three population paths feed the same write function, in order of
  preference.** Unlike a chapter count (a single number WebSearch can often
  corroborate), a full quest list is either sourced verbatim from the game
  itself or from a wiki/guide — there's no "credible number" middle ground
  to fall back on, so all three paths converge on the same
  `upsert_quest_sections`/`--from-json` write path (Phase 2) rather than
  inventing separate storage per source:
  1. **Manual/exported journal text** (Phase 2.2, `--from-txt`) — the
     baseline, deterministic path. Covers any game where Morgan can get the
     in-game journal into a text file, by copy-paste or otherwise; this is
     how `things_to_do_quests.txt` itself was produced.
  2. **Local Ren'Py source extraction, LLM-driven** (Phase 2.3, deferred
     future direction, not built) — investigated a deterministic parser and
     rejected it: implementations vary too much per dev to regex reliably
     (confirmed by extracting *A House in the Rift* with `unrpa`). If ever
     built, this should be an LLM skill that reasons from a few example
     strings to the source pattern, not a scripted parser, and it would
     still always feed the same `--from-txt` convention rather than a
     separate write path.
  3. **WebSearch-driven skill** (Phase 3, new) — for non-Ren'Py or
     non-extractable quest-based games (AAA/mainstream open-world and
     sandbox RPGs are the primary case), mirroring `game-sections-lookup`'s
     WebSearch-only sourcing and "never fabricate" correctness gate, but
     applied to a named quest list instead of a bare count.
- **Marking quests complete is a pure Directus-admin action, not a CLI flag.**
  The population script only ever writes initial structure
  (`category`/`title`/`number`/`sort`); `completed` is edited live in the
  Directus Data Studio by hand. This is the actual point of the ticket, so
  it's covered in detail in Phase 3 rather than automated away.
- **Astro rules apply to Phase 4** exactly as in the base plan: new-field
  read grants on the Astro Readonly policy, ASCII-only text, JS-side sort
  (never Postgres), `CHANGELOG.md` entry + `site/package.json` patch bump in
  the same commit as the site change.
- **Schema creation is gated**, same as the base plan: Phase 1 does not run
  until an explicit go-ahead is given for the schema change specifically,
  separate from sign-off on this plan document, and only after a fresh
  `pg_dump` (see AGENTS.md "Rules for schema changes").

## Non-goals (explicitly out of scope for this pass)

- **Auto-flipping `player_status` to `completed` when the `is_ending` quest
  is marked done.** Would need a Directus Flow watching
  `game_sections.completed` updates scoped to `is_ending = true` rows. Real
  scope creep on top of the core ask; flag as a possible follow-up task once
  the base feature is live and has been used for a while, not built now.
- **Per-category progress bars on game cards/franchise lists** (only the
  detail page gets category grouping in Phase 4). Cards stay a single
  overall percentage, matching how linear games are shown today.
- **Parsing embedded chapter numbers out of quest titles** (e.g. reading
  "4" out of `"Rae's Story ch. 4"`). Titles are stored verbatim; `number` is
  assigned purely by source-file position, per the decision above.

---

## Prerequisites

- Same as the base plan: `.mcp.json` present with `DIRECTUS_TOKEN`/
  `DIRECTUS_URL`, explicit go-ahead for the Phase 1 schema change, fresh
  `pg_dump` before it runs.
- Base `game_sections` collection/relation already exists and is unaffected
  in shape — this plan only adds columns and one new `games` column.

---

## Phase 0: Pre-flight

1. Full `pg_dump` backup (`take_pg_dump_backup("game_sections_nonlinear_schema")`
   or the raw command in AGENTS.md).
2. Re-confirm the Astro Readonly policy's `games` and `game_sections` read
   permissions are still `fields: ["*"]` (checked once already for the base
   plan, but re-verify in case anything narrowed it since).

---

## Phase 1: Schema creation (GATED)

### 1.1 Add `games.section_style`

`POST /fields/games`:
```json
{ "field": "section_style", "type": "string",
  "meta": { "interface": "select-dropdown",
    "options": { "choices": [
      { "text": "Linear (chapters/acts/episodes)", "value": "linear" },
      { "text": "Nonlinear (quests/missions)", "value": "nonlinear" }
    ] },
    "note": "null/linear = existing ordered-chapter model; nonlinear = quest/mission pool, see mcp/plans/game_sections_nonlinear.md" },
  "schema": { "is_nullable": true } }
```

### 1.2 Add `game_sections.category`, `game_sections.completed`, `game_sections.is_ending`

`POST /fields/game_sections` x3:
```json
{ "field": "category", "type": "string",
  "meta": { "interface": "input", "note": "Quest/mission group label (nonlinear games only); null for linear games" },
  "schema": { "is_nullable": true } }
```
```json
{ "field": "completed", "type": "boolean",
  "meta": { "interface": "boolean",
    "note": "Meaningful for nonlinear games only — linear games track progress via games.current_section instead" },
  "schema": { "is_nullable": false, "default_value": false } }
```
```json
{ "field": "is_ending", "type": "boolean",
  "meta": { "interface": "boolean", "note": "At most one true per game (enforced by a partial unique index) — marks which section/quest, if any, is the game's ending" },
  "schema": { "is_nullable": false, "default_value": false } }
```

### 1.3 Partial unique indexes (raw SQL, after the pg_dump)

Via `psql` against the `cms-db` container (same access pattern as the
documented `pg_dump` command):
```sql
CREATE UNIQUE INDEX game_sections_one_ending_per_game
  ON game_sections (games_id) WHERE is_ending AND bundle_member_id IS NULL;
CREATE UNIQUE INDEX game_sections_one_ending_per_member
  ON game_sections (bundle_member_id) WHERE is_ending AND bundle_member_id IS NOT NULL;
```

### 1.4 Table layout / visible columns

`game_sections` is already a visible, non-hidden collection (`meta.hidden:
false` from the base plan's Phase 1.1) — no nav change needed. Set the
collection's default layout fields (`directus_settings` / collection
layout query, editable from Data Studio > collection > Layout Options) to
show `games_id`, `category`, `title`, `completed`, `is_ending` as table
columns, sorted by `sort`, so the Table layout is immediately useful for
batch-editing without per-user setup. This is a Directus admin UI
configuration action, not an API call with a fixed payload — do it by hand
in the browser after 1.1-1.3 land.

### 1.5 Astro read grants

Same pattern as the base plan: `PATCH` the Astro Readonly policy's `games`
and `game_sections` permissions to include the five new fields if either
grant is field-scoped rather than `*`.

---

## Phase 2: Population script

### 2.1 `mcp/scripts/game_sections_lib.py` additions

- `parse_quest_journal_txt(text: str) -> list[dict]` — pure text parser, no
  I/O. Convention (matches `things_to_do_quests.txt` exactly):
  - Skip everything before the first line that is entirely uppercase
    letters/punctuation/spaces (auto-detects the start of the first category
    block; skips the freeform 2-line title header at the top of the file
    without needing a hardcoded line count).
  - A line that is entirely uppercase and non-blank starts a new category;
    the category name is title-cased for storage (`"MAIN STORY"` ->
    `"Main Story"`) since ASCII-only shouting-case titles read poorly on
    the site.
  - Blank lines are separators only (not data, not a forced new category).
  - Any other non-blank line is a quest title in the current category, in
    file order.
  - Returns `[{category: str, title: str, number: int}]` with `number`
    auto-assigned 1..N per category in file order.
  - Raises a clear error if any quest line appears before a category header
    (malformed input — every quest must belong to a category for this
    model; unlike the base plan's default-title fallback, there's no
    sensible default category to fall back to).
- `upsert_quest_sections(client, game_id, *, noun, entries, replace=False, dry_run=False) -> dict`:
  1. Set `games.section_style = "nonlinear"` and `games.section_noun =
     normalize_noun(noun)` via `PATCH /items/games/{id}`. Does **not**
     touch `current_section` (stays null/untouched — meaningless for this
     game type).
  2. If `replace`: delete existing `game_sections` rows for the game
     first (full backup already covers this, same as the linear
     `--replace` path).
  3. For each entry in file order: `POST /items/game_sections` with
     `{games_id, category, title, number, sort: <1-based global position>,
     completed: false, is_ending: false}`.
  4. `dry_run` prints planned writes to stderr, performs none.
  Returns `{game_id, category_count, quest_count}`.

### 2.2 `mcp/scripts/populate_game_quests.py` (new CLI)

```
./mcp/scripts/populate_game_quests.py <game slug> --from-txt <path> [<section noun, defaults to Quest>]
```
- positional `slug`
- `--from-txt <path|->` (required) — read via `parse_quest_journal_txt`
- positional optional `noun` (default `"Quest"`, not `"Chapter"` — the
  sensible default differs by section style)
- `--replace` (delete existing rows before creating; required on any
  re-run against a game that already has rows, same idempotency guard
  philosophy as the linear script)
- `--dry-run` — prints per-category quest counts and a sample of parsed
  titles to stderr for a sanity check before writing
- Errors out (does not silently switch modes) if the target game already
  has `section_style = "linear"` rows — the two models are not meant to
  coexist on one game; converting a game from linear to nonlinear (or vice
  versa) is a manual `--replace` decision the operator makes explicitly,
  not something the script infers.
- `--from-json <path|->` — mirrors the linear script's mode. Reads
  `[{slug, noun, entries: [{category, title}]}]` and calls
  `upsert_quest_sections` per entry. This is how the Phase 3 skill writes
  its findings — same single write path as the manual/extracted-txt route,
  just skipping the text-parsing step since the skill already produces
  structured JSON.

Run `make lint-python` before committing, matching the base plan.

### 2.3 Ren'Py local extraction — decided against a deterministic script

**Investigated, not built.** `unrpa` is installed locally and *A House in
the Rift* ships plain unencrypted `.rpy` source inside `scripts.rpa` (no
`unrpyc` decompile step needed) — confirmed by extracting it directly:
each quest is a `class XQuest(Quest): __init__` with a clean, regexable
`name = _("...")` title field, and `scripts/engine/quests/quest_id_list.rpy`
groups quest IDs under `#region <category>` blocks that are close to (but
not identical to — the ID list has 9 regions where the in-game journal
shows 8, with two apparently folded into "Group, Seasonal, and
Miscellaneous" by UI code that wasn't easily located) the journal's actual
category display.

**Decision: do not build a deterministic Python parser for this.** The
exact convention (class-based quests, `name = _(...)`, region-delimited ID
list, which categories get merged where) is specific to this one game/dev
and would need re-discovering per title — a regex-based extractor tuned to
one game's source layout is exactly the kind of fragile, unmaintainable
one-off this repo's "no bespoke per-source parsing" instincts (see the
`resolve_targets`/shared-CLI-helper consolidation elsewhere in this plan)
argue against. LLM search-and-reason over `unrpa`-extracted source — given
a few example quest title strings, find where they live, infer the
surrounding pattern, and produce the same `--from-txt`-shaped output — is a
much better fit for that variability than scripted parsing.

**Future direction (not scoped or built now):** a Claude Code skill that,
given a game's install path and a handful of example quest/journal strings
Morgan already knows are in the game, extracts the relevant `.rpa`
archive(s) with `unrpa`, greps/reads around those example strings to find
the enclosing pattern, and reasons out the full category+title list from
there — always producing the same `.txt` convention Phase 2.2's parser
already expects, never writing to Directus directly. This is deliberately
deferred: the fully manual path (Morgan copies the in-game journal text,
`populate_game_quests.py --from-txt`) already covers every case with zero
extra tooling, so this is a nice-to-have for when hand-copying becomes a
real bottleneck, not a blocker for anything in this plan.

---

## Phase 3: WebSearch-driven skill for non-extractable games

For quest-based games with no local, parseable source — the common case for
AAA and mainstream titles, and (until/unless a Phase 2.3 skill materializes)
every AVN too, since the manual `--from-txt` path is the only shipped
Ren'Py-specific option today.
Sibling to `.claude/skills/game-sections-lookup/`, reusing its WebSearch-only
sourcing constraint (`WebFetch` is confirmed blocked on IGN/Fandom/GameFAQs/
StrategyWiki) and its "never fabricate" posture — but the bar being checked
is different.

### 3.1 What's being verified is harder than a bare count

The linear skill only ever needs a credible *total number*. This skill needs
a credible *named list*, which is a fuzzier claim — wikis disagree on
optional/repeatable content, quest names drift across game versions, and
"approximately 40 side quests" prose isn't a list. The correctness gate:

- Only write a quest/mission list when at least one reasonably authoritative
  source enumerates named quests directly (an established wiki's dedicated
  Quests/Missions page, an official quest log, patch notes listing named
  content) — not summary prose about how many exist.
- Use the source's own grouping for `category` when it has one (Main
  Quests/Side Quests/Faction/Companion, etc.); when the source is a flat
  list, write `category: null` for every entry rather than inventing a
  grouping that isn't really there — matches the schema's existing
  nullable `category` design.
- If no source clears that bar, the game is **not** written. Record
  `{slug, title, reason}` to `mcp/cache/game_quests_needs_manual.json` (a
  sibling file to the linear skill's `game_sections_needs_manual.json`, kept
  separate since the two "why this is unresolved" reasons don't overlap) and
  move on.

### 3.2 Skill files

- `.claude/skills/game-quests-lookup/SKILL.md`, frontmatter mirroring
  `game-sections-lookup` (`allowed-tools: WebSearch, Bash, Read`).
- Target resolution reuses the same `--list-targets` idiom, added to
  `populate_game_quests.py` (status/slug/genre/tier-list/raw-filter), scoped
  additionally to games without existing `game_sections` rows or explicitly
  flagged for refresh.
- Per game: 1-2 WebSearch queries (`"{title}" quest list`, `"{title}" side
  quests wiki`, `"{title}" missions`), reasoned over per the 3.1 gate,
  written via `Bash: populate_game_quests.py --from-json -` (Phase 2.2's new
  mode). `--dry-run` first for any multi-game batch, same as the linear
  skill.
- **Never sets `completed` or `is_ending`.** Same owner-knowledge boundary
  already established for `current_section` in the linear skill — the skill
  populates structure only; Phase 4 (Directus admin) is how progress and
  the ending flag actually get set.
- Rebuild + monitor step identical to the linear skill's Phase 3.4/3.5 (same
  trigger flow, same OpenSearch completion poll).

---

## Phase 4: Directus admin workflow (the actual point of the ticket)

No code in this phase — it documents how Morgan marks quests complete using
stock Directus Data Studio features, and is the thing to validate hardest
during rollout.

1. **Per-game saved bookmark.** For each actively-tracked nonlinear game,
   create a Data Studio bookmark on the `game_sections` collection filtered
   to that game (`games_id equals <game>`), sorted by `sort`. One-time setup
   per game (~1 minute), done by hand in the browser — not scripted, since
   bookmarks are a personal admin convenience, not project state. The
   collection's Table layout (configured in 1.4) means opening the bookmark
   immediately shows category/title/completed/is_ending as columns.
2. **Single-quest toggle.** In Table layout, the `completed` and `is_ending`
   columns render as inline switches — click one directly in the row to
   flip it without opening the item detail drawer.
3. **Multi-quest toggle (the explicit ask).** Use the row checkboxes to
   select several quests at once (supports shift-click range selection
   across a sorted/filtered view, plus "select all" for a whole category
   if the bookmark is filtered down to just that category). The selection
   toolbar's Edit (pencil) action opens a **Batch Edit** drawer; set
   `completed` = true (or false, for undoing a mistake) and save — applies
   to every selected row in one write. Entirely native Directus behavior,
   no custom extension required.
4. **Verifying the constraint.** Attempting to check `is_ending` on a
   second row for the same game surfaces a Directus save error (the unique
   index from 1.3 firing) rather than silently letting two rows both claim
   the ending — confirm this during Phase 6 smoke test.

---

## Phase 5: Astro surfacing

### 5.1 `site/src/lib/game-fields.ts` — card-level progress is already centralized

`GAME_THUMB_FIELDS` (consumed by `GameThumbCard.astro`, which is reused
across ~35 listing/filter pages — `games/index.astro`, every `filters/**`
page, franchise/genre/developer/engine/tier pages, etc.) already carries
`section_noun`, `current_section`, `sections.id`, `sections.number` for the
linear progress bar. Add `section_style` and `sections.completed` to that
same array. That's the only change needed for cards: `GameThumbCard.astro`
itself calls `sectionProgressSummary(game)` generically and renders whatever
`{ label, title, percent }` comes back — once that function branches on
`section_style` (5.2 below), every one of those ~35 pages picks up correct
nonlinear percentages with no per-page edits. This is the same
already-centralized path `bundleProgressSummary` uses, and is worth calling
out because it's the reason this feature doesn't need to touch 35 files.

### 5.2 `site/src/lib/game-sections.ts` additions

- Extend `GameSection` with `category?: string | null`, `completed?: boolean
  | null`, `is_ending?: boolean | null`.
- `groupSectionsByCategory(sections: GameSection[]): { category: string |
  null; sections: GameSection[] }[]` — stable partition over already-`sort`-
  ordered input (input assumed pre-ordered via `orderedSections`/`sort`, not
  re-sorted here); consecutive runs of the same `category` become one
  group, preserving source-file category order.
- `questProgressPercent(completedCount: number, total: number, playerStatus?):
  number` — `completedCount / total`, clamped to 100 when `player_status ===
  "completed"`, mirroring `sectionProgressPercent`'s clamp but with no
  half-credit branch.
- `sectionProgressSummary` gains a branch on `entry.section_style`: the
  existing ordinal-based logic for `"linear"`/null (unchanged), a new
  `completed_count/total (N%)` label for `"nonlinear"` using
  `questProgressPercent`.

### 5.3 `site/src/pages/games/[slug].astro`

- Extend the `games` query `fields` with `'section_style'`,
  `'sections.category'`, `'sections.completed'`, `'sections.is_ending'`
  (alongside the existing `sections.*` fields).
- Branch the existing Chapters panel (around the current `sections.length >
  0` block) on `game.section_style === "nonlinear"`:
  - Header line: `"{completed_count} of {total_count} {pluralizeNoun(noun)}
    completed"` instead of "Currently on {noun} {current} of {total}".
  - Render `groupSectionsByCategory(sections)` as a `<h4>{category}</h4>`
    per group followed by a `<ul>` of quest titles, `completed` rows shown
    with a checkmark + strikethrough/muted style (reusing the existing
    `#8c58ff` accent for the ending row instead of "current row", via
    `class:list={{ "is-ending": section.is_ending }}`) rather than the
    linear model's single highlighted "current" row.
  - A quest with `is_ending` gets a small inline badge (`"(Ending)"`) next
    to its title regardless of `completed` state.
- Linear rendering path is untouched.

### 5.4 Card tags + filter pages for `section_style`

`GameThumbCard.astro`'s `.tags` row already shows `player_status` and
`game_status` as clickable pill tags linking to `/played_statuses/<value>/`
and `/game_statuses/<value>/` — plain-enum-field tags, not m2m taxonomy tags
like genres/engines, which is exactly what `section_style` is. Follow the
`game_statuses` precedent (a fixed, short options list, not the
`played_statuses` precedent of scanning distinct values) since
`section_style` is a two-value enum, not open-ended data:

- **New page `site/src/pages/section_styles/[slug].astro`**, a straight
  copy of `game_statuses/[slug].astro`'s structure:
  - `STATUS_OPTIONS = [{slug: "linear", label: "Linear"}, {slug:
    "nonlinear", label: "Nonlinear"}]`, `getStaticPaths` always returns both
    (even if one has zero games yet, matching the `game_statuses`
    precedent of generating all fixed options rather than only observed
    ones).
  - Query `games` with `GAME_THUMB_FIELDS`, filter
    `{ section_style: { _eq: slug } }`, `sortByTitle`.
  - Title `Section Styles | {label}`, csv name `section-style-{slug}.csv`,
    description `Games with section style {label} - {count} tracked by
    Jasmeralia.`.
- **`GameThumbCard.astro` tag row**: add a `section_style` tag next to the
  existing `game_status`/`player_status` tags (same plain `.tag` styling,
  no special color — matches how genre/engine tags are unstyled):
  ```astro
  {game.section_style ? (
    <a class="tag" href={`/section_styles/${game.section_style}/index.html`}>{labelize(game.section_style)}</a>
  ) : null}
  ```
  `labelize("nonlinear")` already reads fine as "Nonlinear" with the
  existing helper (no separator to replace), so no `labelize` change is
  needed.
- `section_style` is already being added to `GAME_THUMB_FIELDS` in 5.1 for
  the progress-bar branch — this reuses that same field, no second addition.
- **Fix while touching this block: `Family Sharing Disabled` is currently
  the only tag in this row that's a plain `<span>`, not a link** —
  everything else (`player_status`, `game_status`, genres, engines) is an
  `<a>` to its filter page, but family sharing has one
  (`/filters/misc/steam-family-sharing-disabled/index.html`) and just isn't
  wired up. Change it to match the others:
  ```astro
  {isFamilySharingDisabled(game) ? (
    <a class="tag tag-fs-disabled" href="/filters/misc/steam-family-sharing-disabled/index.html">Family Sharing Disabled</a>
  ) : null}
  ```
  This fix has no dependency on `section_style` or the gated schema change —
  `family_sharing` and its filter page both already exist. It can ship as
  its own tiny standalone PR right now if preferred, independent of the
  rest of this plan; otherwise it rides along in this same Phase 5 commit
  since it's a one-line change to the exact block being edited anyway.

### 5.5 Changelog + version

Prepend a `## [x.y.z]` entry to `CHANGELOG.md` and bump `site/package.json`
in the same commit as the 5.1-5.4 changes, per the Astro rule. Run `make
lintfix && make lint` first.

---

## Phase 6: Smoke test, rollout, and rebuild

1. **Parser, dry run then apply, real data:** `populate_game_quests.py
   --dry-run a-house-in-the-rift --from-txt
   /mnt/thor-hdd/GamesLinux/AVNs/AHouseInTheRift-0.8.14r1-pc/things_to_do_quests.txt`
   — confirm category count matches the 8 headers in the source file
   (`Main Story`, `Rae`, `Cait`, `Naomi`, `Lyriel`, `Blair`, `Yona`, `Group,
   Seasonal, and Misc`) and total quest count matches a manual line count.
   Then apply for real (no `--dry-run`). Confirm `games.section_style =
   "nonlinear"` and `games.section_noun = "Quest"`.
2. **Ren'Py extraction investigation (Phase 2.3):** confirmed `unrpa` can
   extract *A House in the Rift*'s plain `.rpy` source with no decompile
   step, and that per-quest titles/categories are recoverable from it — but
   decided against building a deterministic parser for it (see Phase 2.3's
   final writeup: too dev-specific to regex reliably, better suited to an
   LLM-driven skill if ever built). No script shipped from this step; the
   manual path from step 1 remains the only Ren'Py-specific option.
3. **WebSearch skill (Phase 3):** run `game-quests-lookup` against 1-2
   AAA/mainstream quest-based games that have no local source to extract
   from. Confirm a deliberately obscure/optional-content case lands in
   `game_quests_needs_manual.json` rather than getting a fabricated entry.
4. **Admin workflow:** create the bookmark (Phase 4.1), tick a handful of
   individual quests via inline toggle, then select 5+ quests across two
   categories and batch-edit `completed = true` in one action. Confirm the
   selection survives a mixed-category selection (not just single-category).
   Try setting `is_ending` on two different rows for the same game and
   confirm the second save is rejected by the unique index.
5. **Astro:** land Phase 5 only after steps 1-4 pass. Trigger the documented
   rebuild flow for this game's id and watch OpenSearch
   (`container-logs`, `directus-site-builder`) for `Build/publish completed
   successfully.` with a timestamp after the trigger, per the existing
   monitoring pattern. Eyeball the detail page: category headers in the
   right order, completed quests visually distinct, progress line reads
   `"N of M Quests completed"`. Also check the card grid: the test game
   shows a "Nonlinear" tag linking to `/section_styles/nonlinear/`, a linear
   game shows "Linear" linking to `/section_styles/linear/`, and (if any
   game in the sample set has family sharing disabled) that tag now links
   to the existing filter page instead of being inert text.
6. **Deploy:** site change ships via the normal PR flow; `mcp/scripts`
   changes are script-only (no build needed for those).

---

## Output files summary

| File | Type | Purpose |
|---|---|---|
| `games.section_style` + `game_sections.category`/`completed`/`is_ending` + 2 partial unique indexes | Directus schema (Phase 1, gated) | Discriminator, quest grouping, completion tracking, single-ending invariant |
| `mcp/scripts/game_sections_lib.py` (edited) | Code | `parse_quest_journal_txt`, `upsert_quest_sections` |
| `mcp/scripts/populate_game_quests.py` | New CLI | `--from-txt`/`--from-json`/`--list-targets` quest population |
| `.claude/skills/game-quests-lookup/SKILL.md` | New skill | WebSearch-driven quest list lookup for non-extractable games |
| `mcp/cache/game_quests_needs_manual.json` | Cache (gitignored) | Games the skill couldn't find a credible named quest list for |
| `site/src/lib/game-fields.ts` (edited) | Site | Add `section_style`/`sections.completed` to `GAME_THUMB_FIELDS` so all ~35 card-consuming pages pick up nonlinear progress and the tag automatically |
| `site/src/lib/game-sections.ts` (edited) | Site | Category grouping, quest-style progress math |
| `site/src/components/GameThumbCard.astro` (edited) | Site | Add `section_style` tag; fix `Family Sharing Disabled` tag to link like the others |
| `site/src/pages/section_styles/[slug].astro` (new) | Site | Filter pages for Linear / Nonlinear, mirrors `game_statuses/[slug].astro` |
| `site/src/pages/games/[slug].astro` (edited) | Site | Nonlinear branch of the Chapters panel |
| `CHANGELOG.md` + `site/package.json` (edited) | Site | Version bump, same commit as the site change |

### Critical files for implementation
- /home/morgan/git/directus-jasmeralia.com/mcp/plans/game_sections.md
- /home/morgan/git/directus-jasmeralia.com/.claude/skills/game-sections-lookup/SKILL.md
- /home/morgan/git/directus-jasmeralia.com/mcp/scripts/game_sections_lib.py
- /home/morgan/git/directus-jasmeralia.com/mcp/scripts/populate_game_sections.py
- /home/morgan/git/directus-jasmeralia.com/site/src/lib/game-fields.ts
- /home/morgan/git/directus-jasmeralia.com/site/src/lib/game-sections.ts
- /home/morgan/git/directus-jasmeralia.com/site/src/components/GameThumbCard.astro
- /home/morgan/git/directus-jasmeralia.com/site/src/pages/game_statuses/[slug].astro (copy target for the new filter page)
- /home/morgan/git/directus-jasmeralia.com/site/src/pages/games/[slug].astro
- /mnt/thor-hdd/GamesLinux/AVNs/AHouseInTheRift-0.8.14r1-pc/things_to_do_quests.txt (reference data)
