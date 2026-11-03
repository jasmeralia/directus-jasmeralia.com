# Game Synopsis Plan

Implements [Odoo task #510](https://winds-of-storm.odoo.com/odoo/project/4/tasks/510): add a
description/synopsis field to `games`, populate it from GameStoryLog (GSL) for games with a GSL
link, later populate it for other games, and treat the synopsis of an NSFW game as a spoiler on the
site.

**Scope of this plan: Phase A (field, site rendering, GSL backfill) is fully designed. Phase B (the
non-GSL population script) is only sketched at the end and gets its own plan once Phase A ships.**

Status: design approved 2026-11-03 (including the dashed purple outline around the Synopsis panel, as
shown in the mockup). Schema created after explicit approval and a verified full-database backup;
site changes are in PR #399, and the live dry run reports 363 creates with no failures. Apply awaits
review of that dry run. Measurements below were taken on 2026-11-03.

## Findings that drive the design

- **At design time no such field existed.** `GET /fields/games` has no `description` or `synopsis`. The stale
  `description: "Description"` entry in `FIELD_LABEL` (`site/src/lib/changelog.ts`) is not a
  `games` field.
- **Name collision on the detail page.** `site/src/pages/games/[slug].astro` already has a local
  `const synopsis = gameSynopsis(title, game_status, player_status)`, a generated sentence used only
  as the page's meta/og description. Rename that local to `metaDescription` in the same PR so the
  new field is not confused with it.
- **GSL coverage is complete.** 363 games have a `games_links` row with `kind = "gamestorylog"`,
  pointing at 327 distinct GSL pages. All 327 are present in the shared cache
  `mcp/cache/gsl_game_data.json` (fetched 2026-10-28) and every one has a non-empty
  `data.game.description`. The backfill needs no network access if the cache is fresh enough.
- **24 GSL pages are shared by 60 games.** These are series pages that Directus tracks as separate
  per-season/book/episode records (e.g. Lust Academy seasons 1-4, The Seven Realms realms 1-4,
  My Dorm seasons 1-3, `i-have-known-you` plus its Halloween and Echoes editions). The other 303
  games each have a unique GSL page. A GSL description describes the series, not necessarily the
  individual season.
- **Every GSL-linked game is effectively NSFW.** All 327 pages are `adult_only`, and all 363
  Directus games resolve true under `isGameNsfw` (59 via `games.nsfw`, the rest via the AVN genre).
  The masking path is therefore the normal path for this backfill, not an edge case.
- **Use `description`, not `short_description`.** `short_description` is a truncated prefix of
  `description` for 191 pages (cut mid-sentence in places) and identical to it for 24. Full text:
  min 106, median 576, p90 1,229, max 3,621 characters.
- **Text hygiene.** No HTML, no URLs, no CR characters; 2 descriptions contain markdown-like
  syntax. Counted in descriptions (pages): 94 contain U+200B (zero-width space), 86 curly
  apostrophes, 34 em-dashes, 30 ellipsis characters, 22 curly double quotes, 9 en-dashes, plus a
  handful of accented letters and one emoji.
  `AGENTS.md` forbids smart quotes and dashes in content strings, and the sibling section-data
  tooling already normalizes payload text to ASCII punctuation.
- **The existing mask is CSS-only.** `.nsfw-text` (`BaseLayout.astro`) makes text transparent until
  `html.nsfw-on` or a click adds `.revealed`; the text stays in the DOM. That is acceptable for
  visible text (the same trade-off the Recent Updates widget and tier-list descriptions already
  make), but the synopsis text must not reach any surface that ignores CSS: og/meta description, the
  Pagefind search index and its result excerpts, feeds, and History.
- **Change feeds would be flooded.** History, the RSS/Discord feed and the Recent Updates widget all
  derive events from `directus_revisions` deltas via `fmtDelta`, minus `SKIP_DELTA`. Writing a
  synopsis to hundreds of games without a skip entry would announce hundreds of "updated" events.
- **Query weight.** `GAME_THUMB_FIELDS` feeds roughly 40 pages across all 2,218 games. A
  multi-kilobyte text field must not be added there.

## Decisions

1. **Field names: `synopsis` (text) and `synopsis_source` (string).** Not `description`, to avoid the
   stale label above and any future confusion with tier-list/review descriptions.
2. **Plain text, not markdown.** Stored as plain text with `\n` paragraph breaks; rendered by
   splitting into paragraphs and letting Astro escape the text (no `set:html`, no `renderMarkdown`).
   This avoids stray `||` or link syntax in source text being interpreted. The `||spoiler||`
   markdown extension is deliberately not used; the task's reuse requirement is met by the
   `.nsfw-text` pattern.
3. **A `synopsis_source` field exists for refresh safety.** Values: `gsl`, `steam`, `itad`,
   `manual`. A script may only overwrite a synopsis whose source is its own; a hand-edited synopsis
   is protected by setting the source to `manual` in Directus. The default for a script is
   fill-empty-only. This is also what lets Phase B coexist with Phase A.
4. **Source attribution is shown.** The panel shows a small muted "Source: GameStoryLog" caption
   linking to the game's existing GSL link, since the text is copied from another site.
5. **Normalization to ASCII punctuation** (see the pipeline below). Accented letters and emoji are
   kept; only invisible characters and the smart punctuation `AGENTS.md` prohibits are changed.
6. **The GSL script is local-only**, under `mcp/scripts/ignored/`, following the existing GSL
   tooling convention. `mcp/scripts/ignored/README.md` forbids naming individual ignored scripts in
   tracked docs, so this plan and `AGENTS.md` describe the behavior and point at that README only.

## Phase 0: pre-flight

1. Re-run `GET /fields/games` and confirm neither field exists.
2. Confirm Astro Readonly (`84f316ac-2d5e-4b5a-8f56-99e27a8f1cdf`) has `fields: ["*"]` on `games`
   and that the `Rebuild Site on Content Change` Flow already lists `games`. Same-collection field
   additions need no new permission or Flow change (same conclusion as the SFW/NSFW plan).
3. Confirm the builder's debounced rebuild webhook behavior so a ~300-row apply collapses into one
   build (it should, given the 5 minute debounce and a sub-minute apply).

## Phase 1: schema (needs explicit go-ahead before touching `/fields`)

1. Take a full-database `pg_dump` through `cms-db` per `AGENTS.md` (mandatory for any schema change,
   whole database, never table-scoped).
2. `POST /fields/games` for each:
   - `synopsis`: type `text`, nullable, interface `input-multiline`, no max length, note
     "Plain-text game synopsis; hidden as a spoiler for NSFW games".
   - `synopsis_source`: type `string`, nullable, interface `select-dropdown` with choices `gsl`,
     `steam`, `itad`, `manual`.
3. No data written in this step.

## Phase 2: site PR (merge and deploy BEFORE any backfill write)

Ordering matters: the backfill creates revisions, and the first build after it must already contain
the `SKIP_DELTA` entries.

1. `site/src/lib/changelog.ts`: add `synopsis` and `synopsis_source` to `SKIP_DELTA` (with a comment
   like the retired-version-fields one). Add tests proving a revision whose delta contains only
   those fields produces no History line, no feed entry and no Recent Updates entry
   (`changelog.test.ts`, `feed-builder.test.ts`, `recentUpdates.test.ts`).
2. Add `synopsis` and `synopsis_source` to the detail page's query fields only. Do not touch
   `GAME_THUMB_FIELDS`.
3. New pure helper (e.g. `site/src/lib/synopsis.ts`): `synopsisParagraphs(text)` splits on newlines,
   trims, drops empties. Unit-test it (blank input, single paragraph, CRLF, extra blank lines).
4. `games/[slug].astro`: when `synopsis` is non-empty, render a "Synopsis" `.section.panel` at the top
   of the Details tab, above the existing Details list.
   - One wrapper element holds all paragraphs. For `gameNsfw`, the wrapper gets class `nsfw-text` so
     a single click reveals the whole synopsis, and it follows the sitewide NSFW toggle.
   - `.nsfw-text` is styled as an inline highlight, so give `.synopsis-body.nsfw-text` its own
     `display:block` and padding so the masked box reads as one dark block. Leave the shared
     `.nsfw-text` rules in `BaseLayout.astro` untouched.
   - Provide a native Reveal/Hide button for NSFW text with `aria-controls` and synchronized
     `aria-expanded` / body `aria-hidden`; pointer reveals and global NSFW mode update the control.
   - For `gameNsfw`, also set `data-pagefind-ignore` on the wrapper (not the label or caption).
   - The panel has a dashed purple outline (`outline:1px dashed #8c58ff;outline-offset:3px`,
     matching the approved mockup) so it reads as a distinct, sourced block.
   - Caption "Source: GameStoryLog" (link to the game's `gamestorylog` link) when
     `synopsis_source === "gsl"`; generic captions for other sources in Phase B.
5. Leak surfaces (each gets a check, not an assumption):
   - **og/meta description:** keep `metaDescription` (the generated sentence) for NSFW games. Only a
     SFW game may use `plainTextExcerpt(synopsis)`. All 363 Phase A games are NSFW, so Phase A
     output is unchanged here; the branch exists for Phase B.
   - **Pagefind:** verify how `Nav.astro` renders search-result excerpts. If excerpts can show body
     text for NSFW games, `data-pagefind-ignore` on the wrapper is required; if not, it is still
     harmless.
   - **Feeds/History/Recent Updates:** covered by `SKIP_DELTA`; filter synopsis-only updates before
     the feed revision cap, retaining creates and the legacy window for all other revisions so
     published consolidation GUIDs stay unchanged. Keep the full list for previous-value lookup; `fmtNewGame` does not include the
     synopsis, so game-created entries are unchanged.
6. Process per `AGENTS.md`: bump `site/package.json` patch version, prepend a `CHANGELOG.md` entry,
   update the `AGENTS.md` `games` row (fields, plain-text/ASCII rule, `SKIP_DELTA`, query-weight
   rule, pointer to the ignored README), run `make lintfix && make lint && make test-site`, branch
   plus PR, rebase on `origin/master` first, and watch the TrueNAS build to `Build/publish completed
   successfully.` (no local Astro build as acceptance). A page with no synopsis must render exactly
   as before.

## Phase 3: GSL backfill script (local-only)

Lives in `mcp/scripts/ignored/` (gitignored, excluded from the repo lint). Because of that exclusion,
run `ruff`, `ruff format --check` and `mypy` on it by hand. Document it in the ignored directory's
own README, not in tracked docs. It must not carry the `# game-sections-lookup:` header: that tag
marks read-only lookup scripts, and this one writes.

### Inputs and resolution

- Directus: all `games_links` rows with `kind = "gamestorylog"` (paginated by `fetch_all`; do not
  pass an explicit `limit`, because the helper supplies it), joined
  to game `id`, `slug`, `title`, `synopsis`, `synopsis_source`. The GSL slug is the last path
  segment of the URL, as the sibling GSL scripts compute it. Group games by GSL slug.
- GSL data: read `mcp/cache/gsl_game_data.json` first. Only cache misses, or everything under
  `--refresh`, hit the public `game_details` endpoint (same endpoint and public read key as the
  sibling GSL scripts), using `fetch_with_backoff`/`RetryPolicy` from `scriptlib.py`: at least 1.0s
  between GSL requests, exponential backoff on 403/429, 5 attempt cap, failures logged and
  distinguishable from "no result". Merge new responses back into the shared cache file.
- Hard exclusion: Twice Burned is never touched (global rule), even though it is not expected to
  have a GSL link.

### Text selection and normalization (ordered)

1. Take `data.game.description`; use `short_description` only if `description` is blank (0 cases
   today), and flag such rows for review.
2. Normalize `\r\n`/`\r` to `\n`.
3. Remove U+200B, U+200C, U+200D, U+FEFF; U+00A0 and U+2011 become a space and `-`.
4. Curly single/double quotes become straight; U+2013 becomes `-`; U+2014 becomes ` - ` (then
   collapse spaces); U+2026 becomes `...`.
5. Trim each line, collapse runs of newlines to one paragraph separator, strip the whole value.
5a. Repair glued paragraphs: GSL text sometimes loses its paragraph break, leaving a sentence end
   directly against the next sentence (`intimacy.Beautiful girls`; A House in the Rift has two).
   Insert a `\n` where `[a-z0-9][.!?]` is immediately followed by `[A-Z][a-z]` with no space. This
   affects 18 of 330 cached pages (44 spots). It can false-positive on things like `Mr.Smith`, so
   the review file lists every spot it changed with 25 characters of context.
6. Never truncate. Flag, but do not alter, anything under 150 or over 3,000 characters, any
   remaining non-ASCII symbol beyond letters (emoji, trademark signs), and the 2 markdown-like
   descriptions.

### Eligibility per game

| Case | Games | Default action |
|---|---|---|
| Unique GSL page, `synopsis` null | up to 303 | `create`: set `synopsis` and `synopsis_source = "gsl"` |
| Unique page, `synopsis_source = "gsl"`, text differs | 0 today | `update` only under `--refresh`; otherwise reported as `stale` |
| `synopsis` non-null with any other source (or null source) | 0 today | `protected`: skipped and reported, never overwritten |
| Shared GSL page | 60 games on 24 pages | `create` like any other: decided 2026-11-03 that duplicate text across games sharing a GSL page is fine |

Shared-page members get the identical series text (decision recorded above; the old `--include-shared`
flag only matters for plans written before this decision). `--only-slug <slug>` (repeatable)
restricts any run to specific Directus slugs.

### Dry run, then apply

- **Dry run is the default.** It writes `mcp/cache/gsl_synopsis_plan.json` (one object per game:
  id, slug, GSL slug, action, old value, normalized new text, flags) and a
  `mcp/cache/gsl_synopsis_review.md` listing the shared groups (all member titles side by side), the
  flagged anomalies, and a summary count per action. It prints the same counts plus a few
  before/after samples showing exactly what normalization changed.
- **`--apply` reads the plan file and does no GSL requests**, as the repo dry-run/apply rule
  requires.
  - Writes only through the Directus REST API via `scriptlib.DirectusClient`, never the database.
  - One `PATCH /items/games/{id}` per game with `{synopsis, synopsis_source}`; no inter-request
    delay and no 429 handling (Directus is exempt), but keep the ambiguous-network-failure retries
    in `RetryingDirectusClient`.
  - Stale-plan guard: before each PATCH compare the row's current `synopsis` and
    `synopsis_source` to the plan's recorded old values and skip (and report) on mismatch. Always
    protect a `manual` source, even when its text is empty.
  - Resumable: progress is saved every 25 rows in `mcp/cache/gsl_synopsis_progress.json`; reruns
    skip rows already equal to the target, so the script is idempotent.
  - Triggers no rebuild itself; the content-change Flow's debounced build covers it (verify, see
    Phase 0).
- This is a purely additive value write (new field, no deletion, no schema change), so no
  `pg_dump` is required by `AGENTS.md`. `--refresh` updates of `gsl`-sourced rows are also value
  updates only.

## Phase 4: rollout and verification

1. Phase 0 checks.
2. Phase 1 schema, after explicit go-ahead and backup.
3. Phase 2 PR merged; wait for CI, then for the TrueNAS build to report
   `Build/publish completed successfully.` timestamped after the merge. Snapshot `/feed.xml`,
   `/feed-nsfw.xml` and `/feed-sfw.xml` item counts for later comparison.
4. Phase 3 dry run. Post a plain-text summary first (counts per action, shared groups, flagged
   anomalies) and get Morgan's review before applying.
5. Apply all 363 games, including shared-page duplicates (approved 2026-11-03). Record the trigger
   time, then monitor OpenSearch for a new `Starting build` and a `completed successfully` line
   strictly after it.
6. Re-run the dry run and confirm all 363 are unchanged.
7. Spot-check deployed pages (e.g. one short, one near-3,600-character, one shared-page game):
   - NSFW mode off: synopsis box is masked; one click reveals it; with NSFW mode on it shows by
     default; the source caption links to the right GSL page.
   - The page's `og:description` is still the generated sentence, with no synopsis text.
   - A search whose terms appear only in a synopsis does not surface it in results or excerpts.
   - The History tab and Recent Updates show no synopsis events; feed item counts are unchanged
     from step 3.
8. Update the ignored README and `AGENTS.md`; mark the task's Phase A done in Odoo (stage and
   `state = "1_done"` only once Phase B is also done, since the task covers both; otherwise leave it
   open and comment).

## Acceptance criteria (Phase A)

- `games.synopsis` and `games.synopsis_source` exist; no other schema change was made.
- All 363 GSL-linked games have a normalized `gsl` synopsis, including the same text on every
  member of a shared GSL page.
- No synopsis text appears in any meta description, search result, feed, History or Recent Updates
  entry, and the NSFW synopsis is masked until NSFW mode is on or the box is clicked.
- Re-running the script after apply reports zero changes.
- A hand-edited synopsis (`synopsis_source = "manual"`) is never overwritten by any script.
- Lint and unit tests pass; the production build succeeds with and without a synopsis present.

## Resolved decisions (2026-11-03)

1. Shared GSL pages are written to every linked game; duplicate synopsis text is intended.
2. Normalize ASCII punctuation as specified above.
3. Show the visible GameStoryLog source caption.
4. Use `synopsis` / `synopsis_source`.

## Phase B sketch: non-GSL games (separate plan later)

Population for games without a GSL link, using the same `synopsis`/`synopsis_source` fields.
Candidates named in the task: the video-game encyclopedia MCP server (its tools are not callable
from a standalone script, so the script would need the underlying Steam Store API directly, which
`steamlib.py` and the art backfill already use), SteamDB, and IsThereAnyDeal. Open points to settle
in that plan: SteamDB has no public API and scraping it may conflict with its terms (verify, likely
drop); whether ITAD exposes a usable description at all (verify); mapping Steam `short_description`
vs `about_the_game`; and SFW games becoming eligible for `plainTextExcerpt(synopsis)` as the meta
description. It follows the same dry-run/cache/apply, rate-limit and fill-empty-only conventions,
and must also respect the Twice Burned exclusion.
