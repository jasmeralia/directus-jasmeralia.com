# Game card tier-list chips - design plan

Status: approved by Morgan 2026-10-15, implementing. Site-only change; no schema change, no new Directus permissions.

## Decisions (final)

1. Chips for the `U` ("Too Early") rating are **hidden**. Only S, A, B, C, D, F produce a chip. Null/unknown ratings produce no chip.
2. Chip text is `<list title> - <rating> Tier`, e.g. `AVNs - B Tier`. There is no "Tier List:" prefix. A leading `~` (and
   surrounding whitespace) is trimmed from the list title, so the `~Completed Games` list reads `Completed Games - A Tier`.
3. The chip links to the top of the tier page: `/tiers/<slug>/index.html`.
4. Chips are **not colorized** - a plain neutral `tag` chip like the genre/engine tags. Color may be revisited later.

## Goal

Every game thumbnail card (`GameThumbCard.astro`) shows one chip per published tier list on which the game has a real
rating (S-F), e.g. A House in the Rift in `/filters/genre/avn/played_status/in_progress/` shows `AVNs - B Tier`.

## Design

### 1. Pure logic: `site/src/lib/tier-chips.ts` (new)

```ts
export type TierChip = { slug: string; text: string };
export function buildTierChips(entries): TierChip[]                       // one game's rows
export function groupTierChipsByGame(entries): Map<number, TierChip[]>
```

- Input row: `{ rating, game_id: { id }, tier_list_id: { slug, title } }`.
- Drop rows with null/orphaned `game_id` or `tier_list_id`, missing slug/title, or a rating that is not one of S, A, B, C, D, F
  (this hides `U` and null).
- `text` = `${trimmedTitle} - ${rating} Tier` where `trimmedTitle` removes leading `~` characters and whitespace (and
  trailing whitespace) from the list title. If trimming leaves an empty title, drop the row.
- Dedupe by list slug per game.
- Sort by rating order from `TIER_RATING_CONFIG[...].sort` (S first), then trimmed title via `compareLabels`
  (case-insensitive, JS-side, per the repo sorting rule).
- No network access in this module.

### 2. Fetch helper: `getTierChipsByGameId(gameIds)` in `site/src/lib/directus.ts`

Follows the `getSTierGameIds` / `getReviewedGameIds` pattern:

- One request to `tier_list_games`, fields `rating,game_id.id,tier_list_id.slug,tier_list_id.title`, filter
  `tier_list_id.status = published` and `rating != U` is **not** pushed to the query (keep it simple; filtering is in JS),
  `limit=-1`. Input IDs are filtered in JS, never put in the URL (HTTP 414 risk).
- Returns `Map<number, TierChip[]>` for only the requested IDs. Empty `gameIds` returns an empty Map with no request.

### 3. Card: `GameThumbCard.astro`

- New prop `tierChips = []`.
- Render in the existing `.tags` row after the player_status / game_status / section-style tags and before genres/engines.
- One `<a class="tag tag-tier" href={`/tiers/${chip.slug}/index.html`}>{chip.text}</a>` per chip. No color. `.tag-tier` only
  adds `overflow-wrap:anywhere`.

### 4. Call sites

- The ~41 pages that already `Promise.all([getReviewedGameIds, getSTierGameIds])` add `getTierChipsByGameId(gameIds)` and pass
  `tierChips={tierChipsByGame.get(game.id) ?? []}`.
- The three developer pages (`developers/[slug].astro`, `filters/developer/[developer]/{game_status,played_status}/[status].astro`)
  get S-tier data from `lib/developer-routes.ts`. Widen its `tier_list_games` query to all ratings (fields
  `rating,game_id.id,tier_list_id.slug,tier_list_id.title`, still published lists only), derive the S-tier ID set in JS from
  `rating === "S"`, and add serializable route props (`tierChipEntries: [number, TierChip[]][]` restricted to the route's
  games) that the pages turn into a Map. Update `developer-routes.test.ts`.
- Pages that do not use `GameThumbCard` are unchanged.

### 5. Docs / housekeeping

- `AGENTS.md`: one sentence pointing at `tier-chips.ts` and the `tierChips` prop on `GameThumbCard`.
- `CHANGELOG.md` + `site/package.json` version bump (patch from 1.0.237 unless master moved).
- `ThumbnailBorderLegend.astro` unchanged (chips are not borders).

### 6. Tests

- `tier-chips.test.ts`: ordering, `~` trimming, `U`/null/unknown hidden, orphan rows dropped, dedupe by slug, grouping.
- `directus.test.ts`: `getTierChipsByGameId` (no request on empty input, no `_in` in URL, published filter, only requested IDs).
- `developer-routes.test.ts` updated for the widened query and new route props.
- `make lintfix && make lint && make test-site` must pass. Acceptance on the real builder via OpenSearch after merge (no
  local `astro build`).

## Possible follow-up (not in scope)

Collapse `getSTierGameIds` into the new helper so each page makes one tier request instead of two.
