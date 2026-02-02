# RSS Schema + Flow Changes

This document covers the Directus configuration needed so `feed.xml` can reliably include:
- New games
- New reviews
- Tier list publish events
- Tier list updates caused by tier entry changes, but only for already-published lists

## Overview

`feed.xml` already reads the following:
- Games: `id` (recency fallback in current schema)
- Reviews: `published_at`
- Tier lists: `rss_updated_at` (fallback `updated_at`)

The missing piece is stamping a tier-list-level timestamp whenever child `tier_entries` change.

## 1) Schema change: `tier_lists.rss_updated_at`

Add a nullable datetime field:
- Collection: `tier_lists`
- Field key: `rss_updated_at`
- Type: `datetime`
- Interface: any datetime interface
- Hidden: optional
- Readonly: optional (recommended true if only flows should set it)

Why:
- `tier_entries` updates happen in child rows, so `tier_lists.updated_at` is not always a dependable signal for feed updates.
- `rss_updated_at` gives a single stable "meaningful feed update" timestamp.

## 2) Flow A (create/update): stamp published tier lists when `tier_entries` change

Create flow:
- Name: `RSS - Touch tier list from tier_entries (create/update)`
- Trigger:
  - Type: Event Hook
  - Scope: `items.create`, `items.update`
  - Collections: `tier_entries`
- Accountability: full permissions (`$full`) recommended
- Emit Events on update operations: disabled (`false`) to avoid noisy cascades

Operations:

1. **Read Data: tier_rows**
   - Collection: `tier_rows`
   - IDs: `{{ $trigger.payload.tier_row }}`
   - Query:
     ```json
     {
       "fields": ["id", "tier_list"]
     }
     ```
   - Purpose: map tier entry -> parent tier list

2. **Read Data: tier_lists**
   - Collection: `tier_lists`
   - IDs: `{{ $last[0].tier_list }}`
   - Query:
     ```json
     {
       "fields": ["id", "status"]
     }
     ```
   - Purpose: check published state

3. **Condition**
   - In the Condition operation, use **Filter Rules JSON** (not a template expression).
   - Example (if the previous operation key is `read_tier_list`):
     ```json
     {
       "read_tier_list": {
         "status": {
           "_eq": "published"
         }
       }
     }
     ```
   - If your `Read Data` payload is an array, either:
     - set `Read Data` to return a single item by ID, or
     - add a small Run Script step that returns a boolean and condition on that boolean key.

4. **Update Data: tier_lists**
   - Collection: `tier_lists`
   - IDs: `{{ $last[0].id }}`
   - Payload (JSON):
     ```json
     {
       "rss_updated_at": "{{ $now }}"
     }
     ```
   - Emit Events: false

Result:
- Any create/update to tier entries touches `rss_updated_at`, but only when parent list is already published.

## 3) Flow B (delete): stamp published tier lists when `tier_entries` are deleted

Delete events are harder because `payload` may not contain full row fields.
Use a dedicated delete flow and pull `tier_row` from trigger data available at delete time.

Create flow:
- Name: `RSS - Touch tier list from tier_entries (delete)`
- Trigger:
  - Type: Event Hook
  - Scope: `items.delete`
  - Collections: `tier_entries`
- Accountability: full permissions (`$full`) recommended

Operations:

1. **Condition (guard for available tier_row)**
   - Verify delete trigger includes needed relation (usually in `$trigger.payload` or `$trigger.keys` + extra read step).
   - If your delete trigger has `tier_row` directly, continue.
   - If not, use an alternate strategy (below).

2. **Read Data: tier_rows**
   - IDs from delete payload relation (if available)
   - Query:
     ```json
     {
       "fields": ["id", "tier_list"]
     }
     ```

3. **Read Data: tier_lists**
   - IDs: resolved parent tier list id
   - Query:
     ```json
     {
       "fields": ["id", "status"]
     }
     ```

4. **Condition**
   - Example Filter Rules JSON (if operation key is `read_tier_list`):
     ```json
     {
       "read_tier_list": {
         "status": {
           "_eq": "published"
         }
       }
     }
     ```

5. **Update Data: tier_lists**
   - Payload (JSON):
     ```json
     {
       "rss_updated_at": "{{ $now }}"
     }
     ```
   - Emit Events: false

### If delete payload does not include `tier_row`

If your Directus version does not expose enough delete context, use one of these:
- Preferred: convert row removal workflow to soft-delete/update where possible, so create/update flow handles it.
- Or: add a "before delete" custom extension hook (advanced).
- Or: accept that delete events won’t bump feed timestamp (least preferred).

## 4) Flow C: initialize/refresh on publish transitions

Create flow:
- Name: `RSS - Stamp tier list on publish`
- Trigger:
  - Type: Event Hook
  - Scope: `items.create`, `items.update`
  - Collections: `tier_lists`

Operations:

1. **Condition**
   - Set timestamp when:
     - new item is published, or
     - status changes to published, or
     - item is published and `rss_updated_at` is null

2. **Update Data**
   - Collection: `tier_lists`
   - IDs: `{{ $trigger.key }}`
   - Note: the Update Data payload box expects valid JSON, not YAML or key/value shorthand.
   - Payload (JSON):
     ```json
     {
       "rss_updated_at": "{{ $now }}"
     }
     ```
   - Emit Events: false

This ensures newly-published tier lists appear in the feed even before child entry changes.

### Condition JSON tip (important)

Directus Condition operations evaluate **Filter Rules JSON** against the data chain, not inline template expressions.

- ❌ Not recommended in Condition rules:
  - `{{ $last[0].status == "published" }}`
- ✅ Use rule JSON keyed by operation key:
  ```json
  {
    "read_tier_list": {
      "status": {
        "_eq": "published"
      }
    }
  }
  ```

If this is still awkward in your UI, use this robust pattern:
1. Add **Run Script** operation (key `is_published`) returning `true/false`.
2. Condition rules:
   ```json
   {
     "is_published": {
       "_eq": true
     }
   }
   ```

## 5) Access policy for Astro readonly token

Ensure the token used during Astro build can read:
- `games`: `id`, `title`, `slug`
- `reviews`: `id`, `title`, `slug`, `summary`, `published_at`, `status`
- `tier_lists`: `id`, `title`, `slug`, `description`, `status`, `updated_at`, `rss_updated_at`

Also ensure filters on `status` and non-empty slugs are allowed under that policy.

## 6) Validation checklist

After adding schema + flows:

1. Set one published tier list.
2. Create a `tier_entries` item for that list:
   - Verify `tier_lists.rss_updated_at` changes to current timestamp.
3. Update a `tier_entries` item:
   - Verify timestamp changes again.
4. Update a draft tier list’s entries:
   - Verify `rss_updated_at` does not change (no draft noise).
5. Publish a new tier list:
   - Verify Flow C sets `rss_updated_at`.
6. Run Astro build:
   - `feed.xml` should include tier list items sorted by `rss_updated_at` (fallback `updated_at`).

## 7) Notes

- `feed.xml` currently falls back to `updated_at` if `rss_updated_at` does not exist yet, so rollout can be incremental.
- If you later add an explicit game publish/create timestamp, switch feed ordering from `id` fallback to that datetime field.
