# Omnibus Bundle Support Design

Status: Draft

Date: 2026-07-28

Related Odoo tasks:

- 180 - Add support for omnibus bundles
- 362 - Review content of `game_sections_needs_manual.json`

## 1. Summary

Some library entries are one purchased or launched product containing several
independently playable games or campaigns. Examples include:

- Halo: The Master Chief Collection
- Mass Effect Legendary Edition
- Devil May Cry HD Collection
- Final Fantasy X/X-2 HD Remaster

The existing `games` and `game_sections` model assumes one game has one flat
section list, one `section_noun`, and one `current_section`. That works for a
normal game, but it cannot represent an omnibus whose included games each have
their own status and mission or chapter list.

This design adds an explicitly curated `game_bundle_members` child collection.
Each member belongs to one parent game, has independent player progress, and
may optionally link to an existing standalone `games` record. Existing
`game_sections` rows remain attached to the parent game and gain an optional
`bundle_member_id` that scopes a row to one included game.

The parent `games` record remains the canonical library entry. It continues to
own download links, genres, developers, franchises, reviews, tier ratings, and
the site-wide `player_status`. Bundle members provide only the additional
structure needed to describe and track independently playable content inside
that entry.

No membership is inferred from franchise data. A franchise answers "which
series does this game belong to?" while bundle membership answers "which
playable games are contained in this specific product?" Mass Effect: Andromeda
belongs to the Mass Effect franchise but is not contained in Mass Effect
Legendary Edition.

## 2. Decisions

The following decisions are approved for this design.

### 2.1 What qualifies as a bundle member

A bundle member is an independently playable game or campaign with its own
progress boundary.

Include:

- The three games in Mass Effect Legendary Edition
- The six campaigns in Halo: The Master Chief Collection
- Final Fantasy X and Final Fantasy X-2
- Each game in Devil May Cry HD Collection

Exclude:

- Soundtracks, art books, and other non-playable extras
- Ordinary DLC that does not form an independently tracked campaign
- Bonus missions within a game
- A normal game's chapters or episodes
- Franchise entries that are not included in the purchased product

Licensing or packaging does not decide membership. Halo 3: ODST is delivered as
MCC content, but it qualifies because it is an independently playable campaign.
Mass Effect DLC does not become a separate member because its progress remains
part of the containing Mass Effect game.

### 2.2 Membership is explicitly curated

Bundle contents must be created from a reviewed payload. Title heuristics may
produce an audit list, but they must never create membership automatically.
Words such as "Collection", "Saga", "Trilogy", and "Legendary Edition" produce
both real omnibus candidates and false positives.

Franchise membership must never be copied wholesale into a bundle.

### 2.3 Standalone game records are optional

A member may link to an existing standalone `games` row through
`source_game_id`. A member does not require one.

This means:

- Mass Effect Legendary Edition can link to the existing Mass Effect 1, 2, and
  3 records.
- Halo MCC can link the standalone records that already exist while keeping
  Halo 2 Anniversary or Halo 3 as self-contained member rows if no suitable
  standalone record exists.
- Devil May Cry HD Collection can represent DMC 1, 2, and 3 without creating
  hidden top-level library entries.

If a suitable standalone game is created later, it can be linked without
replacing the bundle member or losing its progress.

### 2.4 Progress is independent

`source_game_id` is a metadata and navigation reference only. It must never
copy or synchronize play status or current section.

For example, the original Mass Effect trilogy is completed in the current
library, but the three Mass Effect Legendary Edition members begin as
`not_started`.

The same standalone game may appear in more than one omnibus. Every membership
has independent progress.

### 2.5 Parent status remains authoritative

The existing `games.player_status` remains manually controlled and continues
to drive:

- Played Status pages and filters
- Card border colors
- Tier list presentation
- CSV exports
- Site-wide game counts

Member statuses are not automatically aggregated into the parent status.
Mixed states do not have a single reliable mapping. For example, an omnibus
could contain completed, on-hold, and did-not-finish members at the same time.

Scripts may warn about obvious inconsistencies, such as a `not_started` parent
with an `in_progress` member, but they must not silently rewrite the parent.

### 2.6 Section data state is explicit for members

Every member has a `section_data_status` value:

- `unknown` - Research has not established whether credible section data
  exists.
- `not_applicable` - The member has been reviewed and does not have a useful
  chapter, mission, act, or episode structure.
- `tracked` - Credible section rows have been populated.

This prevents a researched non-linear game from remaining indistinguishable
from an unresearched member.

### 2.7 Site terminology

Use these labels:

- Internal collection: `game_bundle_members`
- Parent detail panel: `Included Games`
- Reverse relationship: `Included In`
- Browse/filter label: `Omnibus Games`

The public UI uses familiar language even though the internal feature and task
name use "omnibus".

## 3. Goals

- Represent the exact contents of an omnibus independently of franchise data.
- Track player status separately for each included game or campaign.
- Track a separate mission, chapter, act, or episode list for each member.
- Reuse standalone game records when useful without requiring them.
- Preserve existing behavior for all ordinary games.
- Avoid adding embedded-only entries to top-level game, genre, developer,
  release, franchise, and status counts.
- Make bundle relationships discoverable from the parent, from linked
  standalone games, through search, and through the Filters page.
- Keep all writes in Directus and all credentials in `.mcp.json`.
- Keep research resumable and reviewable through cached payloads.

## 4. Non-goals

- Automatically identifying every omnibus in the library
- Treating every DLC item as a bundle member
- Creating a universal product or SKU model
- Synchronizing member status with standalone game status
- Giving lightweight members their own reviews or tier ratings
- Giving lightweight members their own genre or developer relationships
- Replacing the existing franchise model
- Replacing the existing `games` record as the unit used by the main site
- Automatically guessing personal progress

## 5. Current System Constraints

### 5.1 Directus

The current relevant fields and relations are:

- `games.section_noun`
- `games.current_section`
- `games.sections` o2m to `game_sections`
- `game_sections.games_id`
- `game_sections.number`
- `game_sections.title`
- `game_sections.sort`
- `franchise_games`, which only models series membership

There is currently no self-referential or child relationship describing which
games are included inside another game.

### 5.2 Section writer

`mcp/scripts/game_sections_lib.py` currently queries all `game_sections` rows
by `games_id`. Its `--replace` behavior deletes every matching row.

That behavior must be changed before any bundle member sections are populated.
After this feature, section replacement must always be scoped to either:

- Parent sections where `bundle_member_id IS NULL`
- One member where `bundle_member_id = <member id>`

An unscoped replace would delete every campaign's section rows.

### 5.3 Astro

The current game detail page renders one flat section list from
`game.sections`.

`GAME_THUMB_FIELDS` fetches `sections.id`, and `GameThumbCard.astro` assumes the
parent's `current_section` applies to that one list.

The Section Data + Played Status routes classify a game as Present when
`game.sections.length > 0`, otherwise Missing.

The History tab queries revisions for the parent game and selected related
collections, but not bundle members.

Pagefind indexes the rendered game detail page and filters search results to
game pages.

## 6. Directus Data Model

### 6.1 Relationship overview

```text
games
  |
  +-- bundle_members -> game_bundle_members
  |      |
  |      +-- source_game_id -> games (optional)
  |      |
  |      +-- sections -> game_sections
  |
  +-- sections -> game_sections

game_sections
  |
  +-- games_id -> games (always the owning parent game)
  |
  +-- bundle_member_id -> game_bundle_members (null for ordinary sections)
```

### 6.2 New collection: `game_bundle_members`

| Field | Type | Required | Default | Notes |
|---|---|---:|---|---|
| `id` | integer | yes | sequence | Primary key |
| `games_id` | m2o -> `games` | yes | none | Parent omnibus |
| `sort` | integer | yes | none | Display and play order |
| `slug` | string | yes | none | Stable member key within parent |
| `title` | string | yes | none | Title as represented in the omnibus |
| `source_game_id` | m2o -> `games` | no | null | Optional standalone reference |
| `release_year` | integer | no | null | Edition or original year for display |
| `cover_image` | m2o -> `directus_files` | no | null | Optional member-specific cover |
| `player_status` | string | yes | `not_started` | Same choices as `games.player_status` |
| `section_data_status` | string | yes | `unknown` | `unknown`, `not_applicable`, or `tracked` |
| `section_noun` | string | no | null | Null displays as `Chapter` when tracked |
| `current_section` | integer | no | null | Member section ordinal, never guessed |
| `date_created` | timestamp | no | automatic | Directus date-created special field |
| `date_updated` | timestamp | no | automatic | Directus date-updated special field |

Directus aliases:

- `games.bundle_members` is the o2m reverse of `game_bundle_members.games_id`.
- `games.included_in_bundles` is the o2m reverse of
  `game_bundle_members.source_game_id`.
- `game_bundle_members.sections` is the o2m reverse of
  `game_sections.bundle_member_id`.

### 6.3 Change to `game_sections`

Add:

| Field | Type | Required | Default | Notes |
|---|---|---:|---|---|
| `bundle_member_id` | m2o -> `game_bundle_members` | no | null | Scopes a section to one included game |

Every member section still stores the parent omnibus ID in `games_id`. This
keeps deletion, parent lookup, rebuild triggering, and Section Data queries
straightforward.

The existing section writer uses `sort = number`. That remains member-local
ordering even though two members under the same parent can therefore have the
same raw `sort` value. Astro always scopes sections by `bundle_member_id` and
sorts by `number` in JavaScript, so rendering is deterministic. The unfiltered
Directus admin list may interleave equal sort values; admin views should filter
by member and order by `number` when inspecting a campaign.

### 6.4 Invariants

All writers must enforce:

1. `(games_id, slug)` is unique in `game_bundle_members`.
2. `(games_id, sort)` is unique in `game_bundle_members`.
3. `sort` is a positive integer.
4. `source_game_id`, when present, must not equal `games_id`.
5. A `game_sections.bundle_member_id` row must reference a member whose
   `games_id` matches the section row's `games_id`.
6. `(games_id, bundle_member_id, number)` is unique for member sections.
7. `(games_id, number)` is unique among rows where `bundle_member_id IS NULL`.
8. `current_section`, when present, must match an existing section number for
   that member.
9. `section_data_status = tracked` requires at least one section row after an
   applied payload finishes.
10. `section_data_status = not_applicable` requires no section rows and a null
    `current_section`.
11. A parent with bundle members should not also have direct parent sections.
    Writers must reject this mixed representation unless a future design
    explicitly adds a use case for it.
12. Member slugs and all stored strings must follow the repository's ASCII
    typography rule.

Where Directus cannot express a composite unique constraint directly, the
scripts must perform a preflight check and fail clearly. A database-level
constraint may only be considered as a separately approved schema action; data
writes must still go through Directus.

### 6.5 Deletion behavior

Deleting a parent omnibus must remove records in this order:

1. `game_sections` rows for the parent
2. `game_bundle_members` rows where `games_id` is the parent
3. Existing junction and child rows
4. The parent `games` row

`scriptlib.delete_game_junctions` must be extended so this cleanup remains
centralized.

Removing one member from an existing parent, including through
`populate_game_bundle.py --replace`, must remove records in this order:

1. Resolve and retain the member's parent game ID for the eventual rebuild.
2. Delete every `game_sections` row where
   `bundle_member_id = <removed member id>`.
3. Verify by readback that no section row still references the member.
4. Delete the `game_bundle_members` row through the Directus API.
5. Trigger one rebuild for the retained parent game ID after the complete
   replacement batch.

The member row must never be deleted first or left for Directus to cascade.
This is the same orphan-row failure class covered by the existing parent game
cleanup rules.

Deleting a standalone source game must not delete a member. Its
`source_game_id` should be nullified, leaving the member title, metadata, and
progress intact.

All material deletions continue to require a full `pg_dump` first.

### 6.6 Permissions

Because Astro will query the new collection, create a read permission for the
Astro Readonly policy:

```json
{
  "policy": "84f316ac-2d5e-4b5a-8f56-99e27a8f1cdf",
  "collection": "game_bundle_members",
  "action": "read",
  "fields": ["*"]
}
```

Also verify that the existing Astro Readonly permissions for `games` and
`game_sections` use `["*"]`. If they are field-scoped, add the new alias and
`bundle_member_id` fields before any site build.

## 7. Schema and Production Configuration Change Procedure

This document is not authorization to change the schema or the live Directus
rebuild Flow.

Before implementation:

1. Obtain explicit user approval naming the new collection, new relations, and
   the `game_sections.bundle_member_id` field.
2. Obtain explicit user approval to add `game_bundle_members` to the collection
   list of the live `Rebuild Site on Content Change` Flow.
3. Read and save the current Flow definition in the implementation notes so
   the production configuration has a reviewable before-state and rollback
   target.
4. Take a full `pg_dump` through the `cms-db` container on TrueNAS immediately
   before the first schema or Flow configuration change. If the Flow is changed
   in a later implementation phase, take a fresh dump before that change.
5. Record every backup filename in the implementation notes.
6. Create the collection and fields through the Directus schema API.
7. Create the relations and aliases through the Directus schema API.
8. Grant Astro Readonly access immediately.
9. Read the resulting fields, relations, and permissions back from Directus
   and compare them with this design.
10. Do not populate data until the schema readback passes.

Before changing the Flow:

1. Confirm the explicit Flow authorization still applies to Flow
   `4c1f75c8-87bd-4cfc-b262-85a3195632d5`.
2. Take the fresh backup required above.
3. Re-read the Flow and compare it with the saved before-state so unrelated
   production edits are not overwritten.
4. Add only `game_bundle_members` to `options.collections`.
5. Read the Flow back and save the after-state in the implementation notes.
6. Test member create and update handling against a fixture parent.
7. Verify the member deletion script's explicit manual rebuild independently.

The Flow is live Directus configuration and has no normal PR diff. Its
before-state, after-state, approval, backup filename, readback, and test result
are mandatory implementation artifacts.

Read-only inspection on 2026-07-28 established this before-state:

- Flow ID: `4c1f75c8-87bd-4cfc-b262-85a3195632d5`
- Name: `Rebuild Site on Content Change`
- Status: `active`
- Trigger: `event`
- Type: `filter`
- Scope: `items.create`, `items.update`, and `items.delete`
- Operation: one request to the site builder's `/build` endpoint
- Behavior: a full site rebuild, not a parent-keyed partial rebuild
- Current collection list does not contain `game_bundle_members`

The separately configured `Rebuild Site (Manual)` Flow has ID
`e3aa03ad-3352-4ade-8156-22d53f107907`. Population scripts continue to invoke
that manual Flow once per completed batch using the affected parent IDs as
context. This feature does not require changing the manual Flow.

No direct database write is permitted.

## 8. Script Design

### 8.1 New script: `populate_game_bundle.py`

Responsibilities:

- Resolve the parent by game slug.
- Validate and normalize a reviewed member payload.
- Optionally resolve `source_game_slug` to `source_game_id`.
- Print a complete dry-run diff.
- Create or update member rows idempotently.
- Optionally replace members only when `--replace` is explicitly supplied.
- Refuse to remove members during replace unless the deletion backup
  requirement has been satisfied.
- For every removed member, delete and verify its scoped `game_sections` rows
  before deleting the member row, following Section 6.5.
- Preserve `current_section` unless a non-null value is explicitly supplied.
- Trigger one rebuild for the parent after a successful applied change.

Supported modes:

```text
populate_game_bundle.py --from-json <path|-> [--dry-run] [--replace]
populate_game_bundle.py <parent-slug> --list
```

Example payload shape:

```json
[
  {
    "slug": "mass-effecttm-legendary-edition",
    "members": [
      {
        "slug": "mass-effect",
        "title": "Mass Effect",
        "sort": 1,
        "source_game_slug": "mass-effect",
        "player_status": "not_started",
        "section_data_status": "unknown",
        "section_noun": "Mission",
        "current": null
      }
    ]
  }
]
```

Null current values mean "leave current progress unset". They must never
inherit the source game's current section.

### 8.2 Extend `game_sections_lib.py`

Add:

- `resolve_bundle_member(client, parent_slug, member_slug)`
- A section scope type representing either direct parent sections or one
  member
- `bundle_member_id` as an optional argument to `upsert_game_sections`
- Validation that the member belongs to the supplied parent
- Member-aware patch behavior:
  - Direct scope patches `games.section_noun` and `games.current_section`
  - Member scope patches `game_bundle_members.section_noun`,
    `game_bundle_members.current_section`, and
    `game_bundle_members.section_data_status`
- Member-aware existing row filters
- Member-aware replacement filters

The existing ordinary-game behavior must remain backward compatible.

Direct parent scope:

```text
games_id = <game id>
bundle_member_id IS NULL
```

Member scope:

```text
games_id = <parent id>
bundle_member_id = <member id>
```

### 8.3 Extend `populate_game_sections.py`

Add:

```text
--member <member-slug>
```

Positional example:

```text
populate_game_sections.py halo-the-master-chief-collection 10 Mission \
  --member halo-combat-evolved-anniversary
```

JSON entries may include:

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

The script must reject `--member` when the parent has no matching member.

### 8.4 Update `scriptlib.py`

Deletion support must account for both relationships:

- Parent deletion removes `game_sections` first, followed by
  `game_bundle_members`.
- Source-game deletion nullifies member source links rather than deleting
  member rows.

The generic `GAME_JUNCTIONS` tuple is not sufficient to express both actions.
Use a dedicated bundle cleanup step before the existing junction loop.

### 8.5 Update the section lookup workflow

The game-sections lookup workflow must:

1. Detect when a target has bundle members.
2. Refuse to flatten multiple member section lists onto the parent.
3. Research every `unknown` member independently.
4. Use a cache key of `parent-slug|member-slug`.
5. Mark a member `tracked` only when a credible section structure was found.
6. Mark a member `not_applicable` only when reviewed evidence supports that
   conclusion.
7. Leave unresolved members as `unknown`.
8. Never guess `current_section`.

`game_sections_needs_manual.json` entries for bundles should identify both the
parent and member:

```json
{
  "slug": "halo-the-master-chief-collection",
  "member": "halo-combat-evolved-anniversary",
  "title": "Halo: Combat Evolved Anniversary",
  "reason": "Conflicting sources list different mission counts"
}
```

Personal progress is not required to consider structural section research
complete. Once credible mission rows are populated, an unknown personal
current mission should be reported in the dry-run summary or a separate
progress follow-up report. It must not keep the member in
`game_sections_needs_manual.json` or classify it as missing structural data.

### 8.6 External data caching

Dry-run research must cache official store or publisher membership results and
mission or chapter lookup results under `mcp/cache/`.

Apply mode must use the reviewed cache and must not repeat external API calls.

Suggested files:

- `mcp/cache/game_bundle_lookup.json`
- `mcp/cache/game_bundle_members_needs_manual.json`

Each cache record should include:

- Parent slug
- Member slug
- Resolved membership title
- Source URLs
- Lookup timestamp
- Section noun
- Section list or explicit no-section result
- Review notes

The source URLs remain implementation evidence and are not displayed publicly
in the first version.

## 9. Astro Design

### 9.1 Shared types and helpers

Add bundle types to `site/src/lib/directus.ts` or a dedicated
`site/src/lib/game-bundles.ts`.

Suggested types:

- `GameBundleMember`
- `BundleProgressSummary`
- `SectionDataState`

Suggested helpers:

- `orderedBundleMembers(members)`
- `directGameSections(sections)`
- `memberSections(member)`
- `sectionDataState(game)`
- `bundleProgressSummary(game)`
- `sourceGameHref(member)`

All title ordering must use case-insensitive JavaScript comparators. Directus
query sorting must not be used for title display ordering.

### 9.2 Shared query fields

Extend `GAME_THUMB_FIELDS` with only the fields needed for compact progress:

- `bundle_members.id`
- `bundle_members.sort`
- `bundle_members.slug`
- `bundle_members.title`
- `bundle_members.player_status`
- `bundle_members.section_data_status`
- `bundle_members.section_noun`
- `bundle_members.current_section`
- `bundle_members.sections.id`
- `bundle_members.sections.number`

The detail page additionally fetches:

- Member release year and cover
- Optional source game ID, title, slug, release year, and cover
- Member section titles
- Reverse `included_in_bundles` parent title and slug

Because bundle membership is rare, this nested expansion should remain small.
Confirm actual builder response size during validation.

### 9.3 Game detail page

Ordinary games continue showing the existing flat Sections panel.

For a parent with bundle members:

1. Do not render member sections through the flat parent Sections panel.
2. Render an `Included Games` panel after Details and before Reviews.
3. Order members by numeric `sort`.
4. Show:
   - Cover image, using member cover then source cover as fallback
   - Member title
   - Release year when available
   - Member player status
   - Section-data state
   - Current progress summary
5. Link the title to the standalone game when `source_game_id` exists.
6. Render tracked section lists in a collapsible disclosure.
7. Highlight the member's current section using the existing visual language.
8. For an in-progress member with unknown current position, show
   `In Progress - Current mission unknown`.
9. For `not_applicable`, show `No chapter or mission tracking`.
10. For `unknown`, show `Section data not researched`.

For a standalone game with reverse memberships, add an `Included In` row to
the Details panel linking to each parent omnibus.

### 9.4 Thumbnail cards

Keep parent `player_status` as the status border source.

Bundle progress text:

1. If exactly one member is `in_progress` or `on_hold`:
   - With known current section:
     `<title>: <noun> <current>/<total>` with a progress bar using the shared
     half-credit formula from `sectionProgressPercent` (current section counts
     at 50% for these statuses)
   - Without known current section:
     `<title>: In Progress`
2. If multiple members are `in_progress` or `on_hold`:
   `<count> included games in progress`
3. Otherwise:
   `<completed count> of <member count> included games completed`

This bundle block replaces the existing single-game `showProgress` block in the
same card location: after release year and before platform links. It is not
additive. A parent with bundle members cannot also have direct sections under
Invariant 11, so the existing direct-section progress calculation must be
disabled for bundle parents and cannot render a second progress block.

Do not sum all missions into one cross-game progress bar. `Mission 30 of 67`
would obscure campaign boundaries and would not identify which campaign is
active.

### 9.5 Section Data + Played Status filters

Expand `SectionDataState` to:

- `missing`
- `partial`
- `present`
- `not_applicable`

Ordinary games:

- `present` when direct sections exist
- `missing` when direct sections do not exist

Omnibus games:

- `missing` when every member is `unknown`
- `partial` when at least one member is resolved and at least one is `unknown`
- `present` when every member is resolved, at least one is `tracked`, and the
  remaining members, if any, are explicitly `not_applicable`
- `not_applicable` when every member is `not_applicable`

An explicitly `not_applicable` member is resolved, not missing. It therefore
does not force an otherwise complete omnibus into the Partial state.

Update both:

- `filters/index.astro` combination counts
- `filters/section-data/[state]/played_status/[status].astro`

The route already derives links from data, so the new `partial` and
`not_applicable` combinations remain automatically discoverable.

### 9.6 Omnibus filter page

Add:

```text
/filters/misc/omnibus-games/index.html
```

The page lists games with at least one `bundle_members` row using normal game
cards. Its CSV link uses the dedicated omnibus serializer defined in Section
9.8, not the standard `gamesToCsv` output.

Add a matching `miscFilterEntries` entry and count to `filters/index.astro` in
the same commit. This is required because one-off Misc pages are not
auto-discovered.

### 9.7 Search

Member titles must be rendered as normal text within the parent game page's
`data-pagefind-body` region.

Expected behavior:

- Searching for `Halo 2 Anniversary` returns the MCC game page even if there
  is no standalone game record.
- Searching for `Mass Effect 2` may return both the standalone page and
  Legendary Edition. This is correct because both pages are relevant.

No separate static route is created for a lightweight member.

### 9.8 CSV

Keep existing game-list CSV rows at one row per parent game.

Add optional omnibus columns only to the Omnibus Games CSV:

- `member_count`
- `completed_member_count`
- `in_progress_member`

Add a distinct serializer in `site/src/lib/csv.ts`, such as
`omnibusGamesToCsv`. The Omnibus Games filter page in Section 9.6 is its only
initial consumer.

Do not expand every member into the general games CSV because that would
change its existing one-row-per-library-entry meaning.

### 9.9 History

Extend `buildGameHistory` so the parent game History tab includes meaningful
member events:

- `Included Game Added - <title>`
- `Included Game Updated - <title>`
- `Included Game Removed - <title>` when sufficient activity data remains

Status and current-section changes should be formatted explicitly.

Do not display one history entry for every section row created during a bulk
mission import. The member creation or structural update is enough; otherwise
a six-campaign import would overwhelm the History tab.

### 9.10 RSS and rebuild behavior

Member status or current-section changes are meaningful parent game updates.
Extend RSS revision handling so a `game_bundle_members` revision resolves its
`games_id` and links to the parent game page.

Member RSS entries must use the existing `game` GUID type and parent game slug,
but must have a member-specific event token that contains no colons:

```text
member_created_<member-id>_<revision-id>
member_updated_<member-id>_<revision-id>
member_removed_<member-id>_<activity-id>
```

For example:

```text
game:halo-the-master-chief-collection:member_updated_42_901:2026-07-28T20:00:00Z
```

Including the member ID and revision or activity ID makes the event token
distinct from a same-timestamp parent `updated` event and from another member
changed in the same second. The token also satisfies the current `GUID_RE`,
which permits exactly one colon-free event segment. Feed tests must include a
same-second parent update and member update and must pass strict duplicate GUID
validation.

Use the same human-readable event language in RSS and History:

- `Included Game Added - <title>`
- `Included Game Updated - <title>`
- `Included Game Removed - <title>`

The RSS description should format the meaningful member field changes, such as
player status and current section, while the item link continues to target the
parent game page.

Add `game_bundle_members` to the existing event Flow's collection list. The
Flow already covers create, update, and delete events and requests a full site
build, so no parent-key resolution branch is needed. Member deletion scripts
must still invoke the manual rebuild Flow after retaining the parent game ID;
this makes deletion rebuilding independent of the event payload.

Section population scripts trigger one parent rebuild after the complete batch,
not one rebuild per section row.

## 10. Initial Data Plan

### 10.1 Halo: The Master Chief Collection

Parent:

- Slug: `halo-the-master-chief-collection`
- Current parent status: `in_progress`

Members:

| Sort | Member | Initial status | Current mission | Source link |
|---:|---|---|---|---|
| 1 | Halo: Combat Evolved Anniversary | `in_progress` | null | Existing standalone record |
| 2 | Halo 2: Anniversary | `not_started` | null | Optional if a record is later added |
| 3 | Halo 3 | `not_started` | null | Optional if a record is later added |
| 4 | Halo 3: ODST Campaign | `not_started` | null | Existing standalone record |
| 5 | Halo: Reach | `not_started` | null | Existing standalone record |
| 6 | Halo 4 | `not_started` | null | Existing standalone record |

User-provided progress:

- The active game is the first Halo game.
- This design interprets that as Halo: Combat Evolved Anniversary, not Halo:
  Reach.
- The current mission is unknown and must remain null.

Before applying the backfill, show this interpretation in the dry-run output so
it can be corrected without data loss if "first game" meant the first entry in
a different MCC ordering.

Research and populate the real mission titles for each campaign. Keep each
campaign separate even though official product descriptions may provide a
combined mission total.

### 10.2 Mass Effect Legendary Edition

Parent:

- Slug: `mass-effecttm-legendary-edition`
- Current parent status: `not_started`

Members:

| Sort | Member | Initial status | Source link |
|---:|---|---|---|
| 1 | Mass Effect | `not_started` | `mass-effect` |
| 2 | Mass Effect 2 | `not_started` | `mass-effect-2` |
| 3 | Mass Effect 3 | `not_started` | `mass-effect-3` |

Mass Effect: Andromeda must not be included.

The standalone source games' completed statuses must not be copied.

Included DLC remains part of the appropriate game member rather than becoming
separate members.

### 10.3 Devil May Cry HD Collection

Parent:

- Slug: `devil-may-cry-hd-collection`
- Current parent status: `not_started`

Members:

| Sort | Member | Initial status |
|---:|---|---|
| 1 | Devil May Cry | `not_started` |
| 2 | Devil May Cry 2 | `not_started` |
| 3 | Devil May Cry 3 Special Edition | `not_started` |

Devil May Cry 4 is not included.

Standalone source links may remain null.

### 10.4 Final Fantasy X/X-2 HD Remaster

Parent:

- Slug: `final-fantasy-xx2-hd-remaster`
- Current parent status: `on_hold`

Members:

| Sort | Member | Initial status | Current section |
|---:|---|---|---|
| 1 | Final Fantasy X | `on_hold` | null |
| 2 | Final Fantasy X-2 | `not_started` | null |

User-provided progress:

- The on-hold playthrough was Final Fantasy X.
- Final Fantasy X-2 has not been started.
- No current Final Fantasy X position was supplied, so it remains null.

Research should determine whether Final Fantasy X has a credible section system
for this site's tracking model. Final Fantasy X-2 can be researched
independently. Do not force the two games into one shared chapter count.

## 11. Candidate Audit

After the four initial fixtures work, generate a reviewed candidate report from
the current library using conservative title heuristics.

Likely candidates include:

- Crash Bandicoot N. Sane Trilogy
- Evoland Legendary Edition
- Forgotten Realms archive collections
- Homeworld Remastered Collection
- Jill of the Jungle: The Complete Trilogy
- LEGO Harry Potter Collection
- Metal Gear Solid Master Collection
- Teenage Mutant Ninja Turtles: The Cowabunga Collection
- The Alto Collection
- The Bard's Tale Trilogy
- Uncharted collections
- WipEout Omega Collection

Potential false positives or judgment calls include:

- A Total War Saga titles
- The Banner Saga entries
- The Dark Pictures Anthology entries
- LEGO Star Wars saga titles
- Microsoft Solitaire Collection

The report should contain a recommendation and reason for every candidate:

- `omnibus`
- `single_game`
- `needs_review`

Only reviewed `omnibus` entries proceed to population.

## 12. Implementation Phases

### Phase 0 - Design and audit

1. Review and approve this document.
2. Produce the candidate audit without changing Directus.
3. Confirm exact member ordering for the four initial fixtures.
4. Confirm the Halo "first game" interpretation in the bundle population
   dry-run.

Exit criteria:

- No unresolved model decisions.
- Initial payloads are reviewable JSON.

### Phase 1 - Schema

Requires a new explicit authorization.

1. Verify the explicit schema and rebuild Flow authorizations required by
   Section 7.
2. Save the rebuild Flow before-state.
3. Take and record a full `pg_dump`.
4. Create `game_bundle_members`.
5. Add `game_sections.bundle_member_id`.
6. Create all relations and aliases.
7. Grant Astro Readonly access.
8. Read back and validate fields, relations, and permissions.

Exit criteria:

- Live schema exactly matches Section 6.
- The approved Flow target and before-state are recorded even though the Flow
  change is applied later.
- No data has been populated.
- Existing production build still succeeds.

### Phase 2 - Script support

1. Add `populate_game_bundle.py`.
2. Make the section library member-aware.
3. Add `--member` support.
4. Extend cleanup behavior.
5. Update the lookup workflow and cache formats.
6. Add unit tests for validation and scoping where practical.
7. Run `make lintfix && make lint`.
8. Ship script-only changes through a feature branch and PR using
   `publish.sh --no-build`.

Exit criteria:

- Ordinary section operations remain backward compatible.
- Member dry runs show correctly scoped writes.
- `--replace` cannot delete another member's sections.
- Removing one member deletes and verifies that member's sections before
  deleting the member row.

### Phase 3 - Initial data

1. Dry-run the four fixture payloads.
2. Review membership, ordering, source links, and initial statuses.
3. Apply membership rows.
4. Research and cache section structures.
5. Dry-run member section payloads.
6. Apply member sections.
7. Verify Directus records through read-only API calls.

Exit criteria:

- Halo has six members, with Combat Evolved in progress and current mission
  null.
- Legendary Edition has exactly ME1, ME2, and ME3.
- DMC HD Collection has exactly DMC1, DMC2, and DMC3 Special Edition.
- FFX is on hold and FFX-2 is not started.
- Standalone statuses remain unchanged.

### Phase 4 - Astro

1. Add bundle types and helpers.
2. Update shared game query fields.
3. Add Included Games and Included In presentation.
4. Add bundle card progress.
5. Extend Section Data filter states.
6. Add and link the Omnibus Games filter.
7. Extend search-visible content, History, and RSS handling.
8. Add a changelog entry and patch version bump.
9. Run `make lintfix && make lint`.
10. Rebase against the latest `origin/master`.
11. Open and merge the PR through the normal protected-branch workflow.
12. Pull the merged source on TrueNAS before rebuilding.
13. Re-read the live rebuild Flow and compare it with the recorded before-state.
14. Take and record a fresh full `pg_dump`.
15. Apply the separately authorized rebuild Flow change.
16. Read back and record the Flow after-state.
17. Test that member create and update events start a full rebuild, plus the
    scripted member deletion manual rebuild.

Exit criteria:

- The site code is merged and TrueNAS has the merged commit.
- The live Flow readback adds only `game_bundle_members` to the approved
  collection list.
- Event-trigger and scripted manual-trigger tests both start a build.

### Phase 5 - Production validation

1. Record the exact rebuild trigger time.
2. Trigger a rebuild using the affected parent game IDs.
3. Poll OpenSearch until a success or failure line appears strictly after the
   trigger time.
4. Validate the generated pages.
5. Validate Pagefind search after the production index is published.
6. Report the build and page results.

Exit criteria:

- `Build/publish completed successfully.` is recorded after the trigger.
- All acceptance criteria pass.

## 13. Validation Matrix

### 13.1 Script validation

- Creating the same member payload twice is idempotent.
- Duplicate member slugs fail before writing.
- Duplicate member sort values fail before writing.
- A source game equal to the parent fails.
- A source game missing from Directus produces a clear error or is accepted as
  null only when the payload explicitly allows no source.
- Direct section replacement leaves every member section untouched.
- Member A replacement leaves direct sections and Member B untouched.
- Removing Member A deletes and verifies Member A sections before deleting the
  member, leaves no `bundle_member_id` orphan, and leaves Member B untouched.
- `not_applicable` rejects section rows and current progress.
- `tracked` rejects an empty final section set.
- Apply mode does not repeat external research requests.

### 13.2 Astro validation

- Ordinary game detail pages are visually and functionally unchanged.
- Ordinary cards retain their existing section progress.
- Halo MCC shows six ordered members.
- Halo Combat Evolved shows In Progress with an unknown current mission.
- Halo member mission lists do not flatten into one 67-mission list.
- Legendary Edition includes ME1-3 and excludes Andromeda.
- Standalone Mass Effect pages link back to Legendary Edition.
- Original Mass Effect completed statuses remain visible and independent.
- DMC HD Collection lists three games, not four.
- FFX is on hold and FFX-2 is not started.
- Searching an embedded-only member title returns the parent page.
- Omnibus Games is linked from the Filters Misc panel.
- The Omnibus Games CSV uses the dedicated extended headers and the general
  games CSV remains unchanged.
- Section Data filters classify complete, partial, unknown, and
  not-applicable member sets correctly.
- History reports member progress without listing every imported section row.
- A same-second parent update and member update produce distinct valid RSS
  GUIDs and pass strict duplicate validation.
- CSV exports remain one row per parent outside the omnibus-specific export.

### 13.3 Production validation

- TrueNAS pulled the merged commit before the build trigger.
- The new collection is readable by Astro.
- No Directus query returns 403.
- No page crashes on a null `source_game_id`.
- No page crashes on an empty member list or unknown section state.
- The live rebuild Flow after-state matches the approved configuration and a
  member update starts a full rebuild.
- OpenSearch reports a completion line newer than the trigger timestamp.

## 14. Risks and Mitigations

### Accidental section deletion

Risk: The existing game-wide replace query deletes every member's sections.

Mitigation: Land and test scoped section writers before any member sections are
created.

### Franchise contamination

Risk: A bundle is populated from all franchise members.

Mitigation: Require explicit reviewed payloads and never query
`franchise_games` as a membership source.

### Standalone progress leakage

Risk: Completed source games make an unplayed omnibus appear completed.

Mitigation: Keep member status on `game_bundle_members`; never derive it from
`source_game_id`.

### Site count inflation

Risk: Embedded-only games appear in every top-level list and statistic.

Mitigation: Keep embedded-only content out of `games`.

### Partial research looks complete

Risk: One populated campaign causes an omnibus to appear fully researched.

Mitigation: Use per-member `section_data_status` and a `partial` filter state.

### Excessive Directus expansion

Risk: Fetching member sections on every card query increases build response
size.

Mitigation: Fetch only member section IDs and numbers in shared card fields;
fetch titles and cover metadata only on detail pages. Measure during the real
builder validation.

### Child edits do not rebuild the parent

Risk: Directus changes a member but no parent game build is triggered.

Mitigation: Add `game_bundle_members` to the existing full-rebuild event Flow
and retain an explicit script-triggered manual rebuild.

### Misinterpreted Halo ordering

Risk: "First game" means Reach in one presentation and Combat Evolved in
another.

Mitigation: The initial payload assumes Combat Evolved but must expose that
assumption in dry-run output before applying.

## 15. Rollback

If the Astro deployment fails:

1. Fix forward on the feature branch when practical.
2. The old site can continue ignoring the new collection and field.
3. Do not delete populated member data merely to restore the old display.

If schema rollback is required:

1. Stop all bundle writes.
2. Take another full `pg_dump` before deleting fields or collections.
3. Remove member section rows through the Directus API.
4. Remove member rows through the Directus API.
5. Remove permissions and relations through Directus.
6. Remove the field and collection only with explicit user authorization.
7. Restore from the original pre-change dump if a clean API rollback is not
   sufficient.

## 16. Expected File Changes

Script and workflow changes:

- `AGENTS.md`
- `mcp/scripts/populate_game_bundle.py` - new
- `mcp/scripts/populate_game_sections.py`
- `mcp/scripts/game_sections_lib.py`
- `mcp/scripts/scriptlib.py`
- `mcp/plans/game_sections.md`
- `mcp/plans/omnibus_bundles_implementation.md`
- `.claude/skills/game-sections-lookup/SKILL.md`

Astro changes:

- `site/src/lib/directus.ts`
- `site/src/lib/game-fields.ts`
- `site/src/lib/game-sections.ts`
- `site/src/lib/game-bundles.ts` - new, if helpers are not kept in
  `game-sections.ts`
- `site/src/lib/csv.ts`
- `site/src/lib/game-history.ts`
- `site/src/lib/recentUpdates.ts`
- `site/src/pages/feed.xml.ts`
- `site/src/components/GameThumbCard.astro`
- `site/src/pages/games/[slug].astro`
- `site/src/pages/filters/index.astro`
- `site/src/pages/filters/section-data/[state]/played_status/[status].astro`
- `site/src/pages/filters/misc/omnibus-games/index.astro` - new
- `CHANGELOG.md`
- `site/package.json`

Cache files, all gitignored:

- `mcp/cache/game_bundle_lookup.json`
- `mcp/cache/game_bundle_members_needs_manual.json`
- Reviewed initial backfill payloads under `mcp/cache/`

Live Directus changes with no normal PR diff:

- `game_bundle_members` collection, fields, relations, and aliases
- `game_sections.bundle_member_id`
- Astro Readonly permission for `game_bundle_members`
- Any field-scoped permission updates required for `games` or `game_sections`
- Add `game_bundle_members` to the collection list for event Flow
  `4c1f75c8-87bd-4cfc-b262-85a3195632d5`

The implementation handoff must list the authorization, backup filename,
before-state, after-state, and readback result for these changes.

## 17. Acceptance Criteria

The feature is complete when:

1. Bundle membership is explicit and independent of franchises.
2. A member can optionally link to a standalone game without inheriting its
   progress.
3. Member section lists are isolated from one another and from direct parent
   sections.
4. Halo MCC represents six campaigns, with Combat Evolved in progress and no
   guessed current mission.
5. Mass Effect Legendary Edition contains only ME1-3.
6. Devil May Cry HD Collection contains only DMC1-3.
7. Final Fantasy X is on hold and Final Fantasy X-2 is not started.
8. Ordinary game pages, cards, filters, and scripts remain backward
   compatible.
9. Included games are navigable, searchable, and visible in the linked
   Omnibus Games filter.
10. History, RSS, CSV, and rebuild behavior preserve the site's existing
    parent-game semantics.
11. Member removal cannot leave orphaned `game_sections` rows.
12. Member RSS events use collision-resistant, validator-compatible GUIDs.
13. The separately authorized Directus rebuild Flow change is recorded, read
    back, and proven to start a full build for a member change.
14. All repository lint commands pass.
15. The production TrueNAS build completes successfully after the merge and
    pull.
