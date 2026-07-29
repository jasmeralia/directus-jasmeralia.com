# Omnibus Bundles Implementation Record

## Authorization

- Authorized by the user on 2026-07-28 with the message `authorized`.
- Authorized scope:
  - Create `game_bundle_members` and its documented fields.
  - Add `game_sections.bundle_member_id`.
  - Create the documented relations and reverse aliases.
  - Grant the Astro Readonly policy read access.
  - Add `game_bundle_members` to the automatic rebuild Flow.

## Schema Migration

- Applied: 2026-07-28 PDT
- Required pre-change backup:
  `directus_20260729_005353_omnibus_schema.sql.gz`
- Backup location:
  `/mnt/myzmirror/directus-jasmeralia/backups/`
- Before-state:
  - `game_bundle_members` was absent.
  - `game_sections.bundle_member_id` was absent.
  - Astro Readonly permissions for `games` and `game_sections` used
    wildcard fields.
- Collection created: `game_bundle_members`
- Physical fields created:
  - `id`
  - `games_id`
  - `sort`
  - `slug`
  - `title`
  - `source_game_id`
  - `release_year`
  - `cover_image`
  - `player_status`
  - `section_data_status`
  - `section_noun`
  - `current_section`
  - `date_created`
  - `date_updated`
- Existing collection field created:
  `game_sections.bundle_member_id`
- Relations and aliases:
  - `game_bundle_members.games_id -> games`
    with reverse alias `games.bundle_members`
  - `game_bundle_members.source_game_id -> games`
    with reverse alias `games.included_in_bundles`
  - `game_bundle_members.cover_image -> directus_files`
  - `game_sections.bundle_member_id -> game_bundle_members`
    with reverse alias `game_bundle_members.sections`
- Delete behavior:
  - Parent and member ownership relations use `RESTRICT` so the documented
    child-first deletion order is enforced.
  - Optional source-game and cover relations use `SET NULL`.
- Astro Readonly permission:
  - Policy: `84f316ac-2d5e-4b5a-8f56-99e27a8f1cdf`
  - Permission ID: `30`
  - Action: `read`
  - Fields: `["*"]`
- Readback result: passed.
  - All physical fields, required/nullability rules, and defaults matched.
  - All four relations and three aliases resolved.
  - The new permission matched the authorized policy and field scope.

### Alias Metadata Correction

- Applied: 2026-07-28 PDT
- Required pre-change backup:
  `directus_20260729_010251_omnibus_alias_metadata_fix.sql.gz`
- The relation API created the three reverse alias records, but their initial
  field metadata omitted Directus' required `special: ["o2m"]`,
  `interface: "list-o2m"`, and `display: "related-values"` values.
- Patched aliases:
  - `games.bundle_members`
  - `games.included_in_bundles`
  - `game_bundle_members.sections`
- Readback result: passed.
  - All three aliases report type `alias`, special `o2m`, interface
    `list-o2m`, and display `related-values`.
  - Nested parent members, member sections, and standalone backlinks expand
    through the items API.

## Automatic Rebuild Flow

- Applied: 2026-07-28 PDT
- Required pre-change backup:
  `directus_20260729_005653_omnibus_rebuild_flow.sql.gz`
- Flow ID: `4c1f75c8-87bd-4cfc-b262-85a3195632d5`
- Name: `Rebuild Site on Content Change`
- Before-state:
  - Status: `active`
  - Trigger: `event`
  - Type: `filter`
  - Scope: `items.create`, `items.update`, `items.delete`
  - Operation ID: `4a926100-846f-480a-81b4-428f3d18ab9a`
  - Collection count: 16
  - Collections:
    - `engines`
    - `games_engines`
    - `games_genres`
    - `news`
    - `games`
    - `games_engines_1`
    - `genres`
    - `review_screenshots`
    - `tier_row_games`
    - `reviews`
    - `tier_lists`
    - `tier_rows`
    - `directus_files`
    - `about`
    - `developers`
    - `games_developers`
- Applied change:
  - Appended `game_bundle_members` to `options.collections`.
- After-state:
  - Collection count: 17
  - `game_bundle_members` was the only addition.
  - Status, trigger, type, scope, operation, and every other option were
    unchanged.
- Readback result: passed.

The separate manual rebuild Flow
`e3aa03ad-3352-4ade-8156-22d53f107907` was not modified.

## Initial Fixtures

- Run: 2026-07-28 PDT
- Payload:
  `mcp/cache/omnibus_initial_fixtures.json` (gitignored)
- Result: passed with 14 planned member creates and no writes.
- Halo MCC:
  - Six members.
  - Halo: Combat Evolved Anniversary is `in_progress`.
  - Current mission remains null.
- Mass Effect Legendary Edition:
  - Mass Effect, Mass Effect 2, and Mass Effect 3 only.
  - Mass Effect: Andromeda is excluded.
  - Standalone completed statuses are not copied.
- Devil May Cry HD Collection:
  - Devil May Cry 1-3 only.
  - Devil May Cry 4 is excluded.
- Final Fantasy X/X-2 HD Remaster:
  - Final Fantasy X is `on_hold`.
  - Final Fantasy X-2 is `not_started`.
- All member section-data states remain `unknown` until independently
  researched.
- Apply authorized by the user on 2026-07-28 with the message `apply`.
- Apply started: `2026-07-29T01:01:30Z`
- Applied member IDs:
  - Halo MCC: 1-6
  - Mass Effect Legendary Edition: 7-9
  - Devil May Cry HD Collection: 10-12
  - Final Fantasy X/X-2 HD Remaster: 13-14
- Content readback result: passed.
  - All 14 members matched the reviewed order, status, current-section, and
    source-game values.
  - Every `section_data_status` remained `unknown`.
  - No member section rows were created.
  - Parent `bundle_members`, member `sections`, and standalone
    `included_in_bundles` expansions succeeded.
  - Mass Effect: Andromeda and Devil May Cry 4 remained excluded.
- Content apply status: complete.

### Fixture Build Validation

- The 14 automatic create webhooks were received and debounced.
- The population script's final manual webhook bypassed the debounce.
- Build start: `2026-07-29T01:01:37.703Z`
- Production source version during this validation: `1.0.156`
- Terminal result:
  `2026-07-29T01:05:04.658Z Build/publish completed successfully.`
- The terminal result is strictly newer than the apply timestamp.
