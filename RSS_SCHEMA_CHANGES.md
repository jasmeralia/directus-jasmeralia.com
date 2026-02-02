# RSS Schema + Flow Changes

This document covers the Directus changes needed for `feed.xml` to reliably include:
- New games
- New reviews
- Tier list publishes
- Tier list updates caused by tier entry changes (only when tier list is already published)

## 1) `tier_lists` field for meaningful update timestamp

Add a new datetime field:
- Collection: `tier_lists`
- Field: `rss_updated_at`
- Type: `datetime` (nullable)

Why:
- `tier_entries` changes happen in child collections.
- `tier_lists.updated_at` may not always reflect those child changes.
- `rss_updated_at` gives a stable timestamp specifically for feed events.

## 2) Flow: stamp `rss_updated_at` when tier entries change

Create a Directus flow:
- Trigger: `items.create`, `items.update`, `items.delete`
- Collection: `tier_entries`

Flow logic:
1. Read the `tier_entries` row (or prior row for delete) to get `tier_row`.
2. Read `tier_rows` to get parent `tier_list`.
3. Read `tier_lists.status`.
4. If `status == "published"`, update that tier list:
   - `rss_updated_at = $NOW`
5. If `status != "published"`, do nothing.

Why:
- Prevents draft edits from generating noisy feed updates.
- Emits feed updates only for already-published tier lists.

## 3) Flow: initialize `rss_updated_at` on publish

Create another flow on `tier_lists`:
- Trigger: `items.create`, `items.update`
- Collection: `tier_lists`

Condition:
- If `status == "published"` and `rss_updated_at` is null, set it to `$NOW`.

Why:
- Ensures a newly published tier list has a feed timestamp even before entry edits.

## 4) Permissions for Astro readonly token

Ensure the readonly token used by Astro can read:
- `games`: `id`, `title`, `slug`, `date_created`
- `reviews`: `id`, `title`, `slug`, `summary`, `published_at`, `status`
- `tier_lists`: `id`, `title`, `slug`, `description`, `status`, `updated_at`, `rss_updated_at`

Without `rss_updated_at`, feed still works (fallback to `updated_at`) but child entry updates may be missed.
