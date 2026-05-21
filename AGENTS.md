# directus-jasmeralia.com

Astro-based static site + MCP tooling for a Directus CMS games library. The site is built from Directus content via a Docker builder on TrueNAS. The `mcp/scripts/` directory contains Python scripts for bulk-importing and enriching Steam, PSN, and Xbox game data.

## Setup: credentials

Copy `.mcp.json.example` to `.mcp.json` at the repo root and fill in all `<VALUE>` placeholders before running any scripts. The file is gitignored and must never be committed.

**All credentials must be loaded from `.mcp.json` — never hardcode tokens, API keys, or passwords in scripts or documentation.** See `.mcp.json.example` for the required key structure.

## Project context

- **Directus instance**: https://directus.jasmer.tools
- **Auth**: static API token in `.mcp.json` (`DIRECTUS_TOKEN`). Never use email/password — it creates sessions that expire mid-run.
- **Steam ID**: 76561198124815726
- **SteamGridDB API key**: in `.mcp.json`

## Key collections (Directus schema)

| Collection | Notes |
|---|---|
| `games` | Primary library. Fields: `id`, `title`, `slug`, `cover_image` (file UUID), `release_year`, `player_status`, `game_status`, `download_url`, `family_sharing` (bool). **Always set `download_url` to `https://store.steampowered.com/app/{appid}/` when creating a Steam-sourced game.** Valid `player_status` values: `not_started`, `in_progress`, `on_hold`, `waiting_for_update`, `did_not_finish`, `completed`. |
| `genres` | id + name + slug. Cannot be written by the MCP user via the `genres` endpoint directly — use the REST API with the static token instead. |
| `developers` | id + name + slug |
| `games_genres` | Junction: `games_id`, `genres_id`. Unique constraint on `(games_id, genres_id)` applied. |
| `games_developers` | Junction: `games_id`, `developers_id` |

## Key cache files

Cache lives in `mcp/cache/` (gitignored).

| File | Contents |
|---|---|
| `mcp/cache/steam_library.json` | 869 Steam games (appid, name, playtime, last_played) |
| `mcp/cache/directus_games.json` | Snapshot of Directus games at a point in time |
| `mcp/cache/crossref.json` | Steam ↔ Directus cross-reference (match_method: appid/fuzzy/no_match) |
| `mcp/cache/steam_not_in_directus.json` | Steam games not yet in Directus |
| `mcp/cache/proposed_import.json` | Filtered import candidates with full metadata |
| `mcp/cache/import_progress.json` | Per-appid import status (done/error_game) |
| `mcp/cache/backup_YYYYMMDD_HHMMSS/` | Full Directus backup taken before bulk import |

## Git workflow

The `master` branch is protected — direct pushes are rejected. **All changes must go through a pull request.** Always push to a feature branch and open a PR via `gh pr create`.

## Updating site source on TrueNAS

**After merging any PR to master, always pull on TrueNAS immediately** — before triggering a build. Data-only changes (Directus field updates) don't require this, but any code change will silently build stale without it.

```bash
ssh morgan@truenas.windsofstorm.net "git -C /mnt/myzmirror/directus-jasmeralia pull"
```

If the pull fails due to untracked files (e.g. `.serena/`), clean them first:
```bash
ssh morgan@truenas.windsofstorm.net "git -C /mnt/myzmirror/directus-jasmeralia clean -f .serena/ && git -C /mnt/myzmirror/directus-jasmeralia pull"
```

## Checking build logs

OpenSearch is running on TrueNAS and indexes all container logs. Query it directly — no auth required from LAN:

```bash
curl -s "http://truenas.windsofstorm.net:9200/container-logs/_search" \
  -H "Content-Type: application/json" \
  -d '{"size":30,"query":{"term":{"container_name.keyword":"directus-site-builder"}},"sort":[{"@timestamp":{"order":"desc"}}],"_source":["@timestamp","log"]}' \
  | python3 -c "import json,sys; [print(h['_source']['@timestamp'][:19], h['_source']['log'].rstrip()) for h in reversed(json.load(sys.stdin)['hits']['hits'])]"
```

The `container-logs` index holds logs for all TrueNAS containers. Look for the final `Build/publish completed successfully.` or `Build/publish FAILED` line. The OpenSearch Dashboards UI is at https://opensearch.jasmer.tools/ (LAN only).

As a fallback, SSH and tail docker directly:
```bash
ssh morgan@truenas.windsofstorm.net "docker logs directus-site-builder --tail 100 2>&1"
```

## Site rebuild

To trigger a site rebuild after making changes:
```python
import urllib.request, json
token = '<DIRECTUS_FLOW_TOKEN>'  # from DIRECTUS_TOKEN in .mcp.json
url = 'https://directus.jasmer.tools/flows/trigger/e3aa03ad-3352-4ade-8156-22d53f107907'
data = json.dumps({'collection': 'games', 'keys': ['448']}).encode()
req = urllib.request.Request(url, data=data, headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}, method='POST')
resp = urllib.request.urlopen(req, timeout=30)
print(f'HTTP {resp.status}')  # expect 204
```
Use `https://directus.jasmer.tools` (public URL) — `truenas.local` is not reachable from WSL.

**After triggering a rebuild, always monitor it to completion via OpenSearch.** Use `ScheduleWakeup` with a 120s interval and poll until a `Build/publish completed successfully.` or `Build/publish FAILED` line appears with a timestamp after the trigger time. Notify the user of the result. Use the query from the "Checking build logs" section above, filtered to the last few `Build/publish` and `Starting build` lines.

## Rules for Astro site changes

**After every change to the Astro site, update the changelog and bump the version before committing.**

- **Changelog**: `CHANGELOG.md` — prepend a new `## [x.y.z] - YYYY-MM-DD` section with bullet points describing what changed.
- **Version**: `site/package.json` — increment the patch version to match the new changelog entry.

Both files must be updated in the same commit as the site changes. Never batch multiple unrelated features under one version; each logical change gets its own version bump.

## Rules for schema changes

**Never make schema changes (field creation/deletion, relation changes, collection modifications) without explicit user confirmation — even if the user has discussed or approved the plan.** Discussion is not authorization. Wait for a clear "go ahead" directed at the specific schema change before touching `/fields`, `/relations`, or `/collections` endpoints.

**Always take a full backup before any schema change session.** Use the backup pattern from `bulk_import.py` setup: fetch all collections (games, genres, developers, junction tables) via `GET /items/{collection}?limit=-1` and write to a timestamped directory under `mcp/cache/backup_YYYYMMDD_HHMMSS/`. Do this even for small or "safe-looking" changes.

**After creating any new collection that Astro queries (pages, components, feed — anything in the site build), grant the site builder read access before triggering a build.** The site builder runs as the "Astro Readonly" role/policy. Grant via `POST /permissions` with `policy: "84f316ac-2d5e-4b5a-8f56-99e27a8f1cdf"`, `collection: "<name>"`, `action: "read"`, `fields: ["*"]`. Missing permissions cause build-time 403 errors. This applies to both regular collections and system collections (e.g. `directus_revisions`, `directus_activity`).

## Rules for all scripts

Scripts live in `mcp/scripts/`. Run them from any directory — they resolve `mcp/cache/` relative to their own location via `Path(__file__).parent.parent / "cache"`.

### Credentials (REQUIRED)

**Never hardcode tokens, API keys, or passwords in scripts.** Always load from `.mcp.json` at the repo root:

```python
from pathlib import Path
import json

_mcp = json.load(open(Path(__file__).parent.parent.parent / ".mcp.json"))
TOKEN = _mcp["mcpServers"]["directus"]["env"]["DIRECTUS_TOKEN"]
```

### Exponential backoff on rate limits (REQUIRED)

Any script that calls the Steam Store API (`store.steampowered.com/api/appdetails`) **must** implement exponential backoff. The API returns HTTP 403 (not 429) when rate-limited. Without backoff, bulk runs will produce hundreds of failures.

Standard pattern used across this project:

```python
MAX_RETRIES = 5
BACKOFF_BASE = 2.0  # doubles each retry: 2s, 4s, 8s, 16s, 32s

def fetch_steam_details(appid: int) -> tuple[dict | None, str | None]:
    url = f"https://store.steampowered.com/api/appdetails?appids={appid}&cc=us&l=en"
    delay = BACKOFF_BASE
    for attempt in range(MAX_RETRIES):
        try:
            with urllib.request.urlopen(url, timeout=15) as resp:
                data = json.loads(resp.read())
            entry = data.get(str(appid), {})
            if not entry.get("success"):
                return None, "api_no_success"
            return entry["data"], None
        except urllib.error.HTTPError as e:
            if e.code in (403, 429):
                print(f"  Rate limited (HTTP {e.code}), backing off {delay:.0f}s...", file=sys.stderr)
                time.sleep(delay)
                delay *= 2
            else:
                return None, f"http_{e.code}"
        except Exception as e:
            return None, f"error:{e}"
    return None, "rate_limit_exceeded"
```

A base inter-request delay of **1.5s** has been reliable for full-library runs. Values below 0.5s will reliably trigger rate limiting.

### Resumability (strongly preferred)

Bulk scripts should save progress incrementally (every 25 items) to a JSON file in `mcp/cache/`. On restart, skip already-processed items. Re-attempt transient errors (`api_error`, `rate_limit_exceeded`); skip permanent ones (`api_no_success`, `type=dlc`, `free`).

### Directus API calls

Use the static token directly via `urllib.request` for bulk operations — don't go through MCP tools, which add overhead and have no retry logic. Token: see `.mcp.json`.

**Always write data through the Directus API, never directly to the database.** Direct DB writes bypass Directus Flows, which means hooks like "Tier Row Games – Update Tier Row Date" never fire, `updated_at` timestamps don't update, and changes are invisible to the RSS feed. Use `psycopg2` for read-only queries where the REST API returns 403 or is inconvenient, but all inserts, updates, and deletes must go through the API.

### Import filters

When importing from Steam, always apply:
- `type == "game"` (excludes DLC, demos, mods, software)
- `is_free == False` by default (F2P excluded unless `--include-free`)
- Title does not contain "Playtest" (playtest builds)
- Title does not end with "VR Edition" / contain "(VR)" (VR-only versions)
