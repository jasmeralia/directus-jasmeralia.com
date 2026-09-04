# SFW / NSFW Toggle Plan

Implements [Odoo task #149](https://winds-of-storm.odoo.com/odoo/all-tasks/149) ("Add SFW vs NSFW Toggle"): "Should be a user toggle on the site to flip between SFW and NSFW. NSFW content should be collapsed where suitable or (in the case of images) blurred out when SFW mode is enabled."

**Implementation status (2026-09-04): complete.** The feature is implemented, including the previously applied schema/data flags, sitewide toggle and rendering, Recent Updates classification, split feeds, filters/chart, tests, and the maintenance script. Same-day follow-ups add green SFW/red NSFW classifications to reviews and every shared game card, keep tier-list titles visible while collapsing NSFW descriptions, move the toggle below search, group the charts with SFW/NSFW last, flag Harem as NSFW, and record the removal of incorrect AVN/VN tags from the two explicitly flagged games. The optional Phase 5.2 candidate sweep remains a separately approved content follow-up; Phase 6 records the rollout procedure used to publish and validate the release.

A clarifying-question round was offered before writing this plan and was skipped by the user, so every open design fork below was resolved with an explicit, stated default rather than left ambiguous. The three new boolean fields plus the initial `AVN`/`AVNs`/two-named-games data flags received the explicit authorization required by AGENTS.md and are documented as applied in Phases 1 and 1.5. The remaining phases were subsequently implemented according to the decisions below.

## Decisions / constraints

- **Blur-and-reveal in place, not removal.** An NSFW game/tier-list stays exactly where it would normally appear in every grid, list, count, progress bar, and pie chart; only its cover image is visually blurred, with a per-image click-to-reveal (session-only, not persisted). Title and genre/engine tags stay visible and unblurred. This directly extends the one NSFW pattern that already exists in the codebase -- the per-screenshot blur/reveal toggle on `site/src/pages/reviews/[slug].astro` (`.nsfw-hidden` class, `#nsfw-toggle` checkbox, `.nsfw-badge`) -- instead of inventing a second UX. It also means **no dual-count logic is needed anywhere**: `filters/index.astro`'s genre/engine/developer counts, the `/genres` pie chart, franchise progress bars, and every `GAME_THUMB_FIELDS` consumer keep computing totals exactly as today. Rejected: fully removing NSFW entries from grids in SFW mode -- this would require a second code path through every one of the ~35 pages that currently do a single unconditional `.map()`/count over a games array, for a site whose owner is also its primary visitor.
- **Default state for a first-time visitor (no cookie yet) is SFW.** Blur is the CSS default with no JS required (`filter: blur(...)` unconditionally on `.nsfw-cover`), so a visitor with JavaScript disabled still gets the safe default -- the reveal-toggle is what requires JS, not the hiding. An early inline script in `BaseLayout.astro`'s `<head>` reads the cookie synchronously and adds a class to `<html>` before first paint if the visitor previously opted into NSFW, avoiding a flash-of-blurred-then-unblurred (or worse, the reverse) content on every page load.
- **Cascading effective-NSFW flag**: a game is treated as NSFW if `games.nsfw === true`, OR any of its linked `genres.nsfw === true`, OR (for the tier-board page only) the containing `tier_lists.nsfw === true`. This is what makes "flag all AVNs as NSFW" a single `PATCH /items/genres/{avn_id}` instead of a bulk per-game backfill, matching the user's own example. It is also corroborated by the task's own comment history: on 2026-09-01 the user noted *Tamer: King of Dinosaurs* and *Witch Potions - Craft of Lust* were mistagged with AVN/VN but deferred correcting them until this toggle shipped. Those genre tags were removed on 2026-09-04 after the direct game flags were applied; both games still resolve as NSFW through `games.nsfw = true`. Rejected: fully independent flags (genre.nsfw only affecting its own `/genres/[slug]` page, tier_list.nsfw only affecting its own board) -- this would require setting `games.nsfw` on every individual AVN, defeating the stated goal.
- **`tier_lists.nsfw` cascades one level (tier list -> its member games, for board-rendering purposes only)**, letting a curated "definitely adult" tier list bulk-flag its members the same way a genre does, without a matching reverse relationship (a game's NSFW status never un-hides a tier list). On `/tiers/index.astro`, the harmless tier-list title stays visible with a red NSFW badge while its potentially sensitive description uses the same collapsed/reveal treatment as Recent Updates.
- **Detail pages get inline blur + a banner, not a full interstitial gate.** `games/[slug].astro` renders normally; the cover image and any other NSFW-flagged media on the page get the same blur/reveal treatment as everywhere else, plus a small "This game is marked NSFW" banner line. Consistent with the "collapse where suitable, blur images" wording in the task description, and avoids a second gate-style UX pattern.
- **RSS feed entries are classified by the underlying game's (or tier list's) effective-NSFW status, computed from *current* data, not point-in-time revision data.** Historical fidelity ("was this game NSFW at the moment this revision fired") is not worth the complexity of joining `games_genres` at revision time; genre tagging is comparatively stable, and misclassifying an old feed entry for a day or two around a genre edit is an acceptable trade-off versus adding a second join path to `feed.xml.ts`'s already-heavy batch-fetch logic.
- **Three feed endpoints: `/feed.xml` (combined, unchanged behavior and URL), `/feed-sfw.xml`, `/feed-nsfw.xml`.** `/feed.xml` keeps existing subscribers working with zero behavior change. The two new endpoints are the same entries with an `nsfw: boolean` filter applied post-build, sharing one extraction of the existing entry-building pipeline (see Phase 4) rather than duplicating ~600 lines three times.
- **No per-game override field beyond `games.nsfw` itself.** If a genre-level flag ever mis-flags a game (the two AVN-mistagged titles above are exactly this case), the fix is correcting that game's genre tags, not adding a suppression flag -- an "NSFW except this one" escape hatch multiplies the states that have to be reasoned about for one avoidable edge case that already has a real fix (fix the genre tag).
- **The `AVN` genre, the `AVNs` tier list, and the two mistagged games (`Tamer: King of Dinosaurs`, `Witch Potions - Craft of Lust`) are flagged `nsfw = true` immediately after schema creation, as part of Phase 1, not deferred to a later follow-up.** The user explicitly approved the schema change and this initial data flagging together. Applying real NSFW data immediately (rather than leaving every row `false` until some future confirmation) lets whoever implements Phases 2-6 exercise the actual blur/reveal UI, the filter counts, the new pie chart, and the RSS feed split against real content during local `astro dev`/`astro build` runs, catching rendering bugs before a PR is raised -- instead of discovering them only after a squash-merge and a TrueNAS GHCR image rebuild, which is a much slower feedback loop to iterate against. The two mistagged games received the *game-level* flag directly (not just inherited through `AVN`) because their AVN/VN genre tags were known to be incorrect. Those tags have now been removed, and `games.nsfw = true` continues to classify both games correctly without depending on the former genre memberships.
- **Cookie**: name `nsfw_mode`, value `"1"` (present at all = opted in; absent = default SFW), `Path=/`, `Max-Age=31536000` (365 days, matching the user's "1 year?"), `SameSite=Lax`, `Secure` appended only when `location.protocol === "https:"` (keeps `astro dev`/local preview over `http://localhost` working). Plain `document.cookie`, no library -- the codebase has zero existing cookie/localStorage usage to build on or conform to (confirmed via full-repo search), and a cookie (not `localStorage`) was explicitly requested in the task.
- **No server-side cookie reading anywhere.** `astro.config.mjs` has no `output` override, so Astro 7 defaults to full static SSG with no adapter; there is no request-time hook to read a cookie at build time even if we wanted one (confirmed: only `feed.xml.ts`, `build-info.json.ts`, and `avns.txt.ts` are non-`.astro` endpoints, and all three are pre-rendered at build time same as every page). Every page ships the same static HTML with the SFW-blurred default baked in; the toggle is 100% client-side CSS + a tiny inline script, per the existing "Rules for Astro site changes" constraint against treating this as anything but a static build.
- **Flagging beyond `AVN` / `AVNs` / the two named games is explicitly OUT of scope for this plan's phases.** `AVN` (genre), `AVNs` (tier list), and the two mistagged games are flagged now (Phase 1.5, explicitly authorized alongside the schema change itself). Any *other* genre/game that might also warrant `nsfw = true` is a separate, separately confirmed follow-up -- this both matches the repo's standing rule that content changes need their own explicit go-ahead, and avoids assuming the user wants every plausibly-adult genre flagged just because the mechanism now exists. Phase 5.2 below produces the *candidate list* for that follow-up but does not apply it.
- **Astro Readonly permissions and the auto-rebuild Flow need no changes.** Live-checked 2026-09-04: the `84f316ac-2d5e-4b5a-8f56-99e27a8f1cdf` policy's read permissions on `games` (`id 2`), `genres` (`id 5`), and `tier_lists` (`id 9`) are all `fields: ["*"]` (tier_lists additionally lists the `tier_list_games` alias), and the `Rebuild Site on Content Change` flow (`4c1f75c8-87bd-4cfc-b262-85a3195632d5`) already includes `games`, `genres`, and `tier_lists` in its `options.collections`. Unlike the `game_sections` and `game_bundle_members` plans, this is a same-collection field addition, not a new collection, so both of those usual Phase-1 steps are no-ops here -- confirmed rather than assumed, to avoid silently skipping a real gap.

## Prerequisites

- Repo `.mcp.json` present with `DIRECTUS_TOKEN` / `DIRECTUS_URL` (already the case).
- Explicit user go-ahead for the Phase 1 schema change -- **given 2026-09-04, see Phase 1** -- separate from approval of this plan document.
- No new external credentials. No WebSearch/LLM research component (unlike `game_sections`/`game_quests`, there is nothing to look up externally -- every flag here is either a manual owner decision or mechanically derived).

---

## Phase 0: Pre-flight

1. Take a full backup before any schema change (mandatory, no size threshold), per AGENTS.md "Rules for schema changes":
   ```bash
   TIMESTAMP=$(date +%Y%m%d_%H%M%S)
   ssh morgan@truenas.windsofstorm.net \
     "docker exec cms-db pg_dump -U directus directus | gzip > /mnt/myzmirror/directus-jasmeralia/backups/directus_${TIMESTAMP}_sfw_nsfw_schema.sql.gz"
   ```
2. Permission/Flow scope already confirmed live (see last bullet above) -- no re-check needed unless a long delay passes before Phase 1 executes, in which case re-verify with:
   ```bash
   curl -s "https://directus.jasmer.tools/permissions?filter[policy][_eq]=84f316ac-2d5e-4b5a-8f56-99e27a8f1cdf&filter[collection][_in]=games,genres,tier_lists&fields=id,collection,action,fields" \
     -H "Authorization: Bearer $DIRECTUS_TOKEN"
   ```

---

## Phase 1: Schema creation - APPLIED 2026-09-04

**No collections, no relations -- three boolean fields on existing collections, each independently backward-compatible (nullable-safe default `false`).**

**Authorization**: explicit user go-ahead given 2026-09-04 ("Do have the plan flag the AVN genre, the AVNs tier list, and the 2 games mentioned in the comment as NSFW after applying the schema updates, which are approved"), covering both this field creation and the Phase 1.5 initial data flags below.

**Backup**: `directus_20260904_090035_sfw_nsfw_schema.sql.gz` (`/mnt/myzmirror/directus-jasmeralia/backups/` on TrueNAS), taken immediately before the field creates below.

### 1.1 `games.nsfw`

`POST /fields/games`:
```json
{ "field": "nsfw", "type": "boolean",
  "meta": { "interface": "boolean", "note": "Marks this specific game as adult/NSFW content, independent of genre.", "special": ["cast-boolean"] },
  "schema": { "is_nullable": false, "default_value": false } }
```

### 1.2 `genres.nsfw`

`POST /fields/genres`:
```json
{ "field": "nsfw", "type": "boolean",
  "meta": { "interface": "boolean", "note": "Every game tagged with this genre is treated as NSFW site-wide (e.g. AVN).", "special": ["cast-boolean"] },
  "schema": { "is_nullable": false, "default_value": false } }
```
Per AGENTS.md, `genres` cannot be written by the MCP user via its own endpoint directly for content rows -- but field/schema creation on `genres` goes through `/fields`, not `/items`, so this is unaffected by that content-write restriction. Confirm with a scratch `GET /fields/genres/nsfw` readback after creation.

### 1.3 `tier_lists.nsfw`

`POST /fields/tier_lists`:
```json
{ "field": "nsfw", "type": "boolean",
  "meta": { "interface": "boolean", "note": "Marks every game in this tier list as NSFW on the board and hides/blurs the list's own entry on /tiers.", "special": ["cast-boolean"] },
  "schema": { "is_nullable": false, "default_value": false } }
```

### 1.4 Readback - passed

Field metadata confirmed via `GET /fields/{collection}/nsfw`: `type: boolean`, `is_nullable: false`, `default_value: false` on `games` (meta id `196`), `genres` (meta id `197`), and `tier_lists` (meta id `198`). Spot-checked one existing row per collection via `GET /items/{collection}/{id}?fields=nsfw` -- all three read back `false` (not `null`), confirming the default applied to pre-existing rows rather than leaving them unset.

No permission or Flow changes needed (see Decisions) -- not re-verified a second time since the live check in Decisions was same-day.

---

## Phase 1.5: Initial data flags - APPLIED 2026-09-04

Same authorization as Phase 1 (see above). Applied immediately after the Phase 1 field creates, using the script built for this purpose (see Phase 5.1, built and delivered here rather than deferred, since it's needed now):

```bash
python3 mcp/scripts/backfill_nsfw.py \
  --genre avn --tier-list avns \
  --game tamer-king-of-dinosaurs --game witch-potions-craft-of-lust \
  --apply
```

| Collection | Row | id | nsfw |
|---|---|---|---|
| `genres` | AVN | 1 | `true` |
| `tier_lists` | AVNs | 1 | `true` |
| `games` | Tamer: King of Dinosaurs | 1574 | `true` |
| `games` | Witch Potions - Craft of Lust | 1568 | `true` |

**Readback result: passed.** All four rows confirmed `nsfw: true` via `GET /items/{collection}/{id}?fields=nsfw` immediately after apply.

**Genre-tag correction (2026-09-04): applied by the site owner.** The incorrect AVN/VN tags were removed from both named games. Live readback shows *Witch Potions - Craft of Lust* now has only Adventure, while *Tamer: King of Dinosaurs* has Action, Adventure, RPG, and Strategy. Both retain `games.nsfw: true`.

No further genre/game/tier-list flagging is bundled into this pass -- the broader "which other genres look adult-oriented" sweep is still a separate, explicitly-confirmed follow-up (Phase 5.2), not assumed here just because the mechanism now exists.

---

## Phase 2: Site types + shared logic

### 2.1 `directus.ts` type + helper

```1:104:site/src/lib/directus.ts
// (existing Game type, around line 13)
```
Add `nsfw?: boolean | null;` to `Game`. Add a `Genre` field shape wherever genres are typed inline (there is no dedicated `Genre` type today -- genres are always fetched as ad hoc `{ id, name, slug }` shapes per call site; add `nsfw?: boolean | null` to each of those inline shapes/fetches, see 2.3).

Add `TierList.nsfw?: boolean | null` next to `TierList.status` (`directus.ts` line ~61), and add `nsfw` to `getPublishedTierListBySlug`'s `fields` string (line ~220) and to `TierListGame.game_id`'s nested game shape if genre-derived NSFW needs to reach the tier board (it does, per the cascading decision -- see 2.2).

New helper, colocated with `isFamilySharingDisabled` since it's the same "derive a display flag from raw fields" shape:
```ts
export function isGameNsfw(game: {
  nsfw?: boolean | null;
  genres?: { genres_id?: { nsfw?: boolean | null } | null }[] | null;
}): boolean {
  if (game.nsfw === true) return true;
  return (game.genres ?? []).some((g) => g?.genres_id?.nsfw === true);
}
```

### 2.2 New `site/src/lib/nsfw.ts`

Small dedicated module (mirrors `game-sections.ts` / `game-bundles.ts` being separate from `directus.ts` for feature-specific logic) holding:
- Re-export or wrap `isGameNsfw` (keep the raw field-shape helper in `directus.ts` next to `Game`/`TierList` per existing convention; put anything tier-list-aware here since `isFamilySharingDisabled`-style helpers in `directus.ts` are game-only today).
- `isTierListNsfw(tierList: { nsfw?: boolean | null }): boolean` -- trivial, but centralizes the field name in case the cascading rule changes later.
- `isTierBoardEntryNsfw(game, tierList)`: `isGameNsfw(game) || isTierListNsfw(tierList)` -- the one place the tier-list-level cascade is applied, used only by `tiers/[slug].astro`.
- The client-side cookie/CSS-class script text as a exported string constant OR (simpler, matches existing `is:inline` convention) skip the shared-constant approach and just write the inline script directly in `BaseLayout.astro` per Phase 3 -- decide at implementation time based on whether Nav.astro also needs to read the same cookie value (it does, for the toggle button's initial checked state), in which case a tiny shared inline snippet duplicated in both `<script is:inline>` blocks (as the codebase already does for other one-off inline scripts) is more consistent with existing style than introducing the first shared client-JS module in the repo.

### 2.3 Field-list plumbing

- `game-fields.ts`: add `"nsfw"` to `GAME_THUMB_FIELDS` (next to `family_sharing`, line ~5), and add `"genres.genres_id.nsfw"` next to the existing `genres.genres_id.*` fields (lines 11-13).
- `games/[slug].astro`'s inline `GAME_FIELDS` (detail page): add `"nsfw"` and `"genres.genres_id.nsfw"` the same way.
- Every genre fetch (`filters/index.astro` line ~18, `genres/index.astro` line ~7, `genres/[slug].astro`, any other `directusFetchItems("genres", ...)` call -- grep for `"genres"` collection fetches to enumerate the full call-site list at implementation time) adds `"nsfw"` to its `fields` array.
- `getPublishedTierListBySlug` (`directus.ts` line ~217): add `"nsfw"` to the `tier_lists` fetch fields, and add `"game_id.genres.genres_id.nsfw"`-equivalent to the `tier_list_games` fetch (line ~231-238) -- needs `"game_id.nsfw"` and the genre-expansion path for cascading to reach the tier board; confirm Directus supports that nesting depth through the `game_id` m2o (it already nests `game_id.links.*`, so `game_id.genres.genres_id.nsfw` should follow the same pattern used in `GAME_THUMB_FIELDS`).
- `listPublishedTierListSlugs` unaffected (slug-only fetch).

---

## Phase 3: Client-side toggle + rendering

### 3.1 Cookie + anti-flash script (`BaseLayout.astro`)

Add near the top of `<head>`, before the existing `<style>` block, a synchronous inline script:
```html
<script is:inline>
  if (document.cookie.split("; ").some((c) => c === "nsfw_mode=1")) {
    document.documentElement.classList.add("nsfw-on");
  }
</script>
```
Must run before any `.nsfw-cover` element paints -- placing it before the `<style>` tag (rather than after, or in `<body>`) means the class is already present by the time the CSS rule below is evaluated, since `<head>` is fully parsed before `<body>` renders.

### 3.2 Global CSS (`BaseLayout.astro` existing `<style>` block, next to `.spoiler`)

```css
.nsfw-cover{position:relative;}
.nsfw-cover img{filter:blur(20px) brightness(0.5);transition:filter .15s;}
html.nsfw-on .nsfw-cover img,.nsfw-cover.revealed img{filter:none;}
.nsfw-cover::after{content:"NSFW - click to reveal";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;font-size:.75rem;padding:.5rem;background:rgba(0,0,0,.35);color:#eaeaea;cursor:pointer;}
html.nsfw-on .nsfw-cover::after,.nsfw-cover.revealed::after{display:none;}
.nsfw-text{background:#2a2a2a;color:transparent;border-radius:3px;padding:0 3px;cursor:pointer;user-select:none;transition:color .15s;}
html.nsfw-on .nsfw-text,.nsfw-text.revealed{color:inherit;}
```
Default (no class, no JS) = blurred with a "click to reveal" label -- safe with JS disabled, matching the "no server-side toggle possible" constraint. `html.nsfw-on` (global opt-in via the sitewide toggle) or `.revealed` (per-card click, session-only) both remove the blur, exactly paralleling the existing `.spoiler`/`.spoiler.revealed` pair one section above it.

`.nsfw-text` is the "collapsed" half of the task's "collapsed where suitable or (in the case of images) blurred out" wording -- a text-only spoiler-style box for NSFW content that has no cover image to blur (see 3.6, Recent Updates). It is **intentionally a separate class from `.spoiler`**, not a reuse of it: `.spoiler` hides narrative spoilers and must stay hidden regardless of NSFW mode, while `.nsfw-text` is driven by `html.nsfw-on` exactly like `.nsfw-cover` -- conflating the two would make the sitewide NSFW toggle accidentally reveal unrelated story spoilers, or vice versa.

### 3.3 Global click-delegate (`BaseLayout.astro` existing inline script, next to the `.spoiler` handler)

```js
document.addEventListener('click', function(e) {
  var s = e.target.closest('.spoiler');
  if (s) s.classList.toggle('revealed');
  var n = e.target.closest('.nsfw-cover, .nsfw-text');
  if (n) n.classList.toggle('revealed');
});
```
One shared listener, same pattern already used for spoilers -- no new event-binding infrastructure.

### 3.4 Sitewide toggle button (`Nav.astro`)

Add a small button to the `.site-nav` header (next to the search box, matching its `flex-shrink: 0` treatment), e.g.:
```html
<button id="nsfw-mode-toggle" class="nsfw-mode-toggle" type="button" aria-pressed="false">Show NSFW</button>
```
Inline script (own `<script is:inline>` block, or appended to the existing pagefind script in `Nav.astro`):
```js
(function () {
  var btn = document.getElementById('nsfw-mode-toggle');
  if (!btn) return;
  var on = document.documentElement.classList.contains('nsfw-on');
  function render() {
    btn.textContent = on ? 'Hide NSFW' : 'Show NSFW';
    btn.setAttribute('aria-pressed', String(on));
  }
  render();
  btn.addEventListener('click', function () {
    on = !on;
    document.documentElement.classList.toggle('nsfw-on', on);
    var secure = location.protocol === 'https:' ? '; Secure' : '';
    if (on) {
      document.cookie = 'nsfw_mode=1; Max-Age=31536000; Path=/; SameSite=Lax' + secure;
    } else {
      document.cookie = 'nsfw_mode=1; Max-Age=0; Path=/; SameSite=Lax' + secure;
    }
    render();
  });
})();
```
No page reload -- every already-rendered `.nsfw-cover` on the current page unblurs instantly via the CSS class flip, and the cookie carries the choice to the next page load / next visit (up to a year).

### 3.5 Wire `.nsfw-cover` into every cover-image render site

- **`GameThumbCard.astro`** (line ~77): wrap the existing `{img ? <img ... /> : ...}` thumb in a container carrying `nsfw-cover` when `isGameNsfw(game)`. Needs `game.genres[].genres_id.nsfw` present (Phase 2.3).
- **`tiers/[slug].astro`** (lines ~136-148, `.tier-thumb-media`): apply `nsfw-cover` when `isTierBoardEntryNsfw(game, tierList)` (cascades the tier list's own flag too).
- **`games/[slug].astro`** hero cover image, plus bundle-member cover thumbs if any bundle member's parent game is NSFW: apply `nsfw-cover`, plus render the "This game is marked NSFW" banner line (Decisions) directly above the hero when `isGameNsfw(game)`.
- **`franchises/[slug].astro`** member cover thumbnails: same `isGameNsfw` check per member's underlying game.
- **`WalkthroughGameList.astro`** row cover thumbs: same.
- **`Nav.astro` pagefind search results**: investigate at implementation time whether pagefind's `r.data()` result snippet (`Nav.astro` line ~90-95) is built from the indexed page's live DOM (in which case the `nsfw-cover` class on `GameThumbCard`/detail-page markup is inherited automatically) or from a separately-serialized `meta.image` value with no class information (in which case the search-result `<img>` needs its own explicit blur applied at render time in the search JS, checking the same effective-NSFW signal -- would require exposing an `nsfw` boolean via pagefind's `data-pagefind-meta` on the source page). This is the one line item in this plan whose exact fix can't be nailed down without checking pagefind's actual output shape in a build, so budget investigation time here rather than assuming the DOM-inheritance case.
- **`reviews/[slug].astro`** hero game cover (separate from the existing per-screenshot NSFW toggle already on that page) -- apply `nsfw-cover` there too if the reviewed game is NSFW; leave the existing screenshot-level `.nsfw-hidden`/`#nsfw-toggle` mechanism untouched (it is a different, more granular per-screenshot flag unrelated to the game-level `nsfw` field, and out of scope here).
- **`/tiers/index.astro`**: apply the blur/reveal treatment to a tier list's own listing entry (name/description) when `tierList.nsfw`, per the Decisions bullet on tier-list self-hiding.
- **`/genres/index.astro`** pie chart / genre list: no blur (genre *names* like "AVN" aren't themselves explicit), but consider a small "NSFW" badge next to a flagged genre's label for owner-facing clarity -- cosmetic, low priority, can be dropped if it clutters the pie chart legend.

### 3.6 New misc filter: NSFW games that are not AVN

Surfaces games that are effectively NSFW (cascading rule) via some path *other* than the obvious `AVN` genre bucket -- e.g. a game with an explicit `games.nsfw = true` override, a different NSFW-flagged genre, or membership in an NSFW-flagged tier list that isn't itself AVN-related.

- New page `site/src/pages/filters/misc/nsfw-not-avn.astro`, modeled directly on the existing `avn-*` misc filter pages (e.g. `avn-harem.astro`) for structure: fetch all games with `GAME_THUMB_FIELDS`-equivalent fields (needs `nsfw` + `genres.genres_id.nsfw` per Phase 2.3), filter with `isGameNsfw(game) && !hasAvnGenre(game)` (reusing the `hasAvnGenre` helper already defined in `filters/index.astro` line ~340, hoisted to a shared spot if not already), and render through `GameThumbCard` like the rest of the misc pages.
- **Required per AGENTS.md**: add a matching `miscFilterEntries` entry in `filters/index.astro` (`{ label: "NSFW + Not AVN", href: "/filters/misc/nsfw-not-avn/index.html", count: nsfwNotAvnCount }`, with `nsfwNotAvnCount` computed alongside the other `avn*Count` values already in that file) -- a page under `filters/misc/` with no entry there is deployed but unreachable except by typing the exact URL, exactly the `games-missing-sections.astro` mistake AGENTS.md calls out.

### 3.7 New pie chart on `/filters` (index page): SFW vs NSFW distribution

`filters/index.astro` already has a working pie-chart pattern (`describeArc`/`polarToCartesian` helpers, `pie-grid`/`pie-panel` markup, labeled-arc computation) used for the Download Platform / Walkthrough Platform charts in the Misc section (lines ~950-1060). Add one more segment set and one more `pie-panel` using the exact same helpers rather than introducing a second charting approach:
- Extend the top-of-file `games` fetch (`filters/index.astro` line ~34-47) to include `"nsfw"` and `"genres.genres_id.nsfw"`.
- Compute `nsfwCount = games.filter(isGameNsfw).length` and `sfwCount = games.length - nsfwCount`, then a two-segment `nsfwPieSegments = [{ label: "SFW", value: sfwCount, color: "#4aa3ff" }, { label: "NSFW", value: nsfwCount, color: "#e36b6b" }].filter(s => s.value > 0)`, plus the matching `nsfwPieArcs`/`nsfwLabeledArcs` built with the file's existing `describeArc`/`polarToCartesian` calls (copy the `platformPieArcs`/`platformLabeledArcs` block pattern verbatim, substituting the new segment set).
- Render as a new `<div class="pie-panel"><h3>SFW / NSFW</h3>...</div>` in whichever existing `pie-grid` row has room, or its own new `pie-grid` row directly above them -- exact placement is a layout call at implementation time, not a design fork worth gating on.
- This chart reflects the same "blur, don't remove" counting model already used everywhere else on this page (Decisions): it counts every game regardless of the viewer's current toggle state, exactly like the genre/engine/developer counts elsewhere on this same page are unaffected by NSFW mode.

### 3.8 Recent Updates widget (home page) respects the toggle

`site/src/pages/index.astro`'s "Recent Updates" sidebar (fed by `fetchRecentUpdates()` in `site/src/lib/recentUpdates.ts`) renders **plain text only** -- a tag pill plus a `subject` string, no cover images (confirmed: no `<img>` in that widget's markup). There is nothing to blur; per the task's own "collapsed where suitable... blurred out [for] images" wording, this is exactly the "collapsed" case, using the new `.nsfw-text` class from 3.2 rather than `.nsfw-cover`.

- `UpdateEntry` (`recentUpdates.ts` line ~11) gains `nsfw: boolean`.
- `fetchRecentUpdates` needs the effective-NSFW signal for whatever the entry is about, computed from *current* data (same "not point-in-time" call as Phase 4.2's RSS entries, for the same reason: not worth a second historical-join path):
  - **Game / included-game entries**: extend the existing live-slug lookup (`liveGames`, line ~94-100) to also fetch `nsfw,genres.genres_id.nsfw` (it already round-trips through `/items/games` for slugs, so this is one field-list addition, not a new request) and the bundle-member lookup (`members`, line ~127-130) to fetch `games_id.nsfw,games_id.genres.genres_id.nsfw` alongside the existing `games_id.title,games_id.slug`. Apply `isGameNsfw(...)` from the shared `nsfw.ts` helper (Phase 2.2).
  - **Review entries**: the current review-revision loop (line ~152-167) never fetches the reviewed game at all (only `rev.data.title/slug`). Add one batch fetch of `reviews` by the revision item ids with `fields=id,game.nsfw,game.genres.genres_id.nsfw`, mirroring `reviewItemMap` in `feed.xml.ts`, and apply `isGameNsfw(review.game)`.
  - **Tier list entries** (`tier-added`, `tier-updated`): both are about the tier list as a whole (the widget never names a specific member game for these), so the signal is simply that tier list's own `nsfw` flag, not the cascading per-game rule. Batch-fetch current `nsfw` for every tier list id referenced by `tierActivities`/`tlgMap` (line ~172-194) and `tierListRevs` (line ~196-208) in one `fetchItemMap`-style call, and apply `isTierListNsfw(...)`.
- `site/src/pages/index.astro`'s render loop (line ~155-162): wrap `entry.subject` in `<span class="nsfw-text">{entry.subject}</span>` when `entry.nsfw` is true, instead of the current bare `<a>{entry.subject}</a>` -- keep the tag pill and timestamp visible either way (only the subject text itself is sensitive).
- Extend `site/src/lib/recentUpdates.test.ts`'s fixtures/assertions to cover at least one NSFW-flagged entry per branch (game, review, tier list) so this doesn't silently regress.

---

## Phase 4: RSS feed split

### 4.1 Extract the shared entry pipeline

`feed.xml.ts` currently does fetch -> build `Entry[]` -> sort/dedupe/limit -> serialize, all inline in one `GET` handler (lines 429-621). Refactor into:
- `site/src/lib/feed-builder.ts` (new): move everything from step 1 (parallel revision/activity fetches) through step 5 (`entries: Entry[]` built) into an exported `buildFeedEntries(): Promise<Entry[]>`, unchanged in behavior. `Entry` gains one field:
  ```ts
  type Entry = {
    title: string; link: string; description: string;
    pubDate: Date; imageUrl?: string; guid: string;
    nsfw: boolean; // new
  };
  ```
- Also export `renderFeedXml(entries: Entry[], opts: { title: string; description: string }): string`, extracted from the current step 6's `xml = [...]` block, parameterized on the channel `<title>`/`<description>` (currently hardcoded `"Jasmeralia Feed"` / the changelog description) so all three endpoints share one serializer with a different channel title.

### 4.2 Compute `nsfw` per entry

Each entry builder (`buildGameEntry`, `buildReviewEntry`, `buildTierListEntry`, `buildTierListGameEntries`, `buildGameLinkEntry`, `buildBundleMemberEntry`) needs the effective-NSFW signal for whatever game/tier-list it's about:
- **Game entries**: fetch `nsfw` + `genres.genres_id.nsfw` in the existing `gameMap` fetch (`feed.xml.ts` line ~505, currently `"id,title,slug,cover_image.id,cover_image.filename_disk"`) and apply `isGameNsfw(liveItem)`.
- **Bundle member entries**: `isGameNsfw(gameMap[gameId])` (the parent game).
- **Review entries**: `isGameNsfw(reviewItem.game)` -- extend the existing `reviewItemMap` fetch fields (line ~461-462) to include `game.nsfw,game.genres.genres_id.nsfw`.
- **Tier list entries** (publish/update): `tierListMap`/live tier list fetch needs `nsfw` added; use `isTierListNsfw`.
- **Tier-list-game addition entries**: `isGameNsfw(game) || isTierListNsfw(tierList)` (same cascading rule as the board), using the already-fetched `gameMap`/`tierListMap` -- extend their fetched fields similarly.
- **Games-link entries**: `isGameNsfw(gameMap[glink.games_id])`.
- Entries with genuinely no associated game/tier list (none currently exist in this feed, but guard defensively): default `nsfw: false` so they only ever show in the SFW and combined feeds, never silently vanish from all three.

### 4.3 Three thin endpoint files

- `site/src/pages/feed.xml.ts`: becomes `const entries = await buildFeedEntries(); return renderFeedXml(entries, { title: "Jasmeralia Feed", description: "Changelog feed: games, reviews, and tier list updates." })` -- same URL, same unfiltered entry set, same GUIDs (no subscriber-visible change beyond nothing).
- `site/src/pages/feed-sfw.xml.ts` (new): `renderFeedXml(entries.filter(e => !e.nsfw), { title: "Jasmeralia Feed (SFW)", description: "SFW-only changelog feed: games, reviews, and tier list updates." })`.
- `site/src/pages/feed-nsfw.xml.ts` (new): `renderFeedXml(entries.filter(e => e.nsfw), { title: "Jasmeralia Feed (NSFW)", description: "NSFW-only changelog feed: games, reviews, and tier list updates." })`.
- The existing `validateFeedEntries` GUID/enclosure invariant checks run once against the full unfiltered `entries` array (inside `buildFeedEntries`, before any filtering) so both filtered feeds inherit already-validated GUIDs without re-checking.

### 4.4 Discoverability

- `BaseLayout.astro` `<head>` (line ~26): add two more `<link rel="alternate" type="application/rss+xml">` tags for the SFW and NSFW feeds alongside the existing combined one.
- Footer (`BaseLayout.astro` lines ~68-73): keep the existing RSS icon + "RSS" text linking to `/feed.xml` (combined, unchanged), and append `" (SFW / NSFW)"` immediately after it, with "SFW" linking to `/feed-sfw.xml` and "NSFW" linking to `/feed-nsfw.xml` -- i.e. exactly `RSS (SFW / NSFW)` as three separate links sharing one footer entry, matching the format specified for this plan:
  ```html
  <a class="footer-link" href="/feed.xml" aria-label="RSS feed">
    <svg>...</svg>
    RSS
  </a>
  <span class="footer-rss-variants">(<a href="/feed-sfw.xml">SFW</a> / <a href="/feed-nsfw.xml">NSFW</a>)</span>
  ```
  Keep the `.footer-link`'s existing icon+flex styling untouched; the `(SFW / NSFW)` span is plain inline text/links needing no new icon.

---

## Phase 5: Backfill script (delivered) + NSFW-candidate proposal (still open)

### 5.1 `mcp/scripts/backfill_nsfw.py` - delivered and already used in Phase 1.5

Built ahead of the rest of the implementation specifically so Phase 1.5 above had a real tool to apply through (per AGENTS.md, all content writes go through the Directus API, never a one-off ad hoc script outside version control). Mirrors `backfill_family_sharing.py`'s structure (`scriptlib.DirectusClient`); no `ProgressCache`/resumability was added since this patches at most a handful of rows per invocation by design (explicit `--game`/`--genre`/`--tier-list` slugs on the command line), not a Steam-library-sized sweep:
```python
def find_by_slug(client: DirectusClient, collection: str, slug: str) -> dict | None: ...
```
CLI surface actually implemented: `--game SLUG` / `--genre SLUG` / `--tier-list SLUG` (each repeatable), `--unset` (default is to set `nsfw = true`), `--apply` (default is dry run, printing current-vs-proposed values -- same dry-run/apply convention as every other bulk script in this repo). It remains available for the candidate-list follow-up below and any future one-off flag correction. The two corrected games intentionally retain their explicit game-level NSFW flags after their incorrect AVN/VN tags were removed.

### 5.2 Candidate list (proposal only, still not applied)

`AVN`, the `AVNs` tier list, and the two named games are the only rows flagged so far (Phase 1.5). Producing a short list of *other* genres that plausibly warrant `nsfw = true` (enumerate via `GET /items/genres?fields=id,name,slug&limit=-1` at implementation time rather than guessing the list now) for the user to explicitly confirm is still a separate follow-up conversation, not a step this plan executes automatically just because the mechanism now exists and one genre has already been flagged.

---

## Phase 6: Site-change bookkeeping + rollout

1. **`CHANGELOG.md`**: prepend a new `## [x.y.z] - YYYY-MM-DD` entry describing the toggle, the three new fields (and that `AVN`/`AVNs`/the two named games are already flagged live), the two new RSS feeds, the new "NSFW + Not AVN" misc filter, the new SFW/NSFW pie chart on `/filters`, and the Recent Updates widget respecting the toggle. Current version at plan-writing time is `1.0.178` (`site/package.json`) -- bump to the next patch version matching the changelog entry actually used at implementation time (may have moved further by then; always read the live head of `CHANGELOG.md`/`package.json` immediately before bumping, don't hardcode `1.0.179` here).
2. **`site/package.json`**: patch-bump `version` to match, same commit as the site change.
3. `make lintfix && make lint` before committing (this repo's standing rule for any change made off-TrueNAS).
4. Because the schema and initial data flags (Phases 1 and 1.5) are already live in Directus, local `astro dev`/`astro build` runs during implementation can render real blurred/collapsed NSFW content (AVN-genre games, the AVNs tier list board, the two named games, and their Recent Updates/RSS entries) end-to-end before a PR is ever opened -- verify the full toggle/blur/reveal/RSS/pie-chart/filter behavior locally against this real data first, per the reason this ordering was requested (avoid PR churn and GHCR image wait cycles from finding rendering bugs only after merge).
5. `mcp/scripts/publish.sh --title "feat: add SFW/NSFW toggle with per-genre/tier-list cascading and split RSS feeds"` -- push branch, PR, squash-merge, trigger rebuild (this touches `site/`, so no `--no-build`).
6. Monitor the triggered build to completion via OpenSearch (`Build/publish completed successfully.` strictly after the trigger timestamp), per the standing rule against trusting local `astro build` as an acceptance test.
7. Live spot-check after deploy: toggle the button on a page with an NSFW-flagged game (e.g. any `AVN`-genre game, `Tamer: King of Dinosaurs`, or `Witch Potions - Craft of Lust` -- already flagged, no manual flip needed), confirm blur/reveal + cookie persistence across a hard reload, confirm the Recent Updates widget and the `/filters` SFW/NSFW pie chart render correctly, confirm `/filters/misc/nsfw-not-avn/index.html` loads, and fetch all three `/feed.xml`, `/feed-sfw.xml`, `/feed-nsfw.xml` to confirm they parse as valid RSS and partition entries as expected.
