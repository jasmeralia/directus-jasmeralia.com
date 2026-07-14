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
| `games` | Primary library. Fields: `id`, `title`, `slug`, `cover_image` (file UUID), `release_year`, `player_status`, `game_status`, `download_url`, `family_sharing` (bool). **Always set `download_url` to `https://store.steampowered.com/app/{appid}/` when creating a Steam-sourced game.** Valid `player_status` values: `not_started`, `in_progress`, `on_hold`, `waiting_for_update`, `did_not_finish`, `completed`. Valid `game_status` values: `unreleased`, `in_development`, `abandoned`, `released`. |
| `genres` | id + name + slug. Cannot be written by the MCP user via the `genres` endpoint directly — use the REST API with the static token instead. |
| `developers` | id + name + slug |
| `games_genres` | Junction: `games_id`, `genres_id`. Unique constraint on `(games_id, genres_id)` applied. |
| `games_developers` | Junction: `games_id`, `developers_id` |
| `engines` | id + title + slug. Common AVN engines: **Ren'py** (slug `ren-py`, id 1), **Daz 3D** (slug `daz-3d`, id 4), **Honey Select** (slug `honey-select`, id 3). These are engines, not genres — never tag them as genres. Set via nested update on the game record: `{"engines": [{"engines_id": N}]}`. |

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

Before creating any PR, fetch the latest `master` and rebase the feature branch against `origin/master`. Resolve any changelog/version conflicts before opening the PR so the PR starts mergeable.

### publish.sh — full deploy in one command

`mcp/scripts/publish.sh` automates the full post-commit deploy sequence: push branch → create PR → squash merge → update local master → TrueNAS pull → rebuild trigger.

```bash
mcp/scripts/publish.sh --title "fix: something" [--body "PR body"] [--no-build]
```

- `--title` is required; `--body` defaults to empty.
- `--no-build` skips the TrueNAS pull and rebuild trigger — use this for changes that don't affect the built site (e.g. script-only changes in `mcp/scripts/`).
- Reads `DIRECTUS_TOKEN` from `.mcp.json` for the rebuild trigger.
- Automatically retries the TrueNAS pull after cleaning `.serena/` if the first pull fails due to untracked files.
- Must be run from a feature branch; exits with an error if already on `master`.

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

**After triggering a rebuild, always monitor it to completion via OpenSearch.** Record the exact trigger time before firing, then poll until a `Build/publish completed successfully.` or `Build/publish FAILED` line appears with a timestamp **strictly after** the trigger time. Never match the most-recent completed line without verifying its timestamp is newer than the trigger — the previous build's completion line will otherwise cause a false early exit. Notify the user of the result. Use the query from the "Checking build logs" section above, filtered to the last few `Build/publish` and `Starting build` lines.

## Typography rules

**Never use smart quotes, em-dashes, or en-dashes in source code, labels, or content strings.** Use only ASCII equivalents: straight quotes (`'` and `"`), hyphens (`-`). Smart punctuation (`"`, `"`, `'`, `'`, `—`, `–`) causes rendering inconsistencies and sorting anomalies.

## Dependency security

**When npm audit reports vulnerabilities, always fix them by upgrading the affected package — never by lowering the audit severity threshold.** Lowering `--audit-level` masks real issues and leaves the project in a permanently degraded security posture. If a vulnerability cannot be fixed without a breaking change, add a version override in `site/package.json` under `"overrides"` to force the patched version. Only relax the audit level as a last resort if no patched version exists yet, and create a tracking issue immediately.

## Linting

The whole repo lints through one root `Makefile`, patterned after `~/git/wishlist_monitor`'s:

| Command | Covers |
|---|---|
| `make lint` | Everything below, read-only |
| `make lintfix` | Auto-fixable subset (eslint --fix, ruff check --fix, ruff format) |
| `make lint-site` | `site/` — eslint (flat config, `eslint-plugin-astro` + `typescript-eslint`) |
| `make lint-python` | `mcp/scripts/` — ruff, ruff format, pylint, mypy |
| `make lint-docker` | `builder/Dockerfile` — hadolint |
| `make lint-shell` | `builder/run-build.sh`, `mcp/scripts/publish.sh` — shellcheck |

**If a change is made on typhoon, run `make lintfix && make lint` before committing to verify it passes.** This isn't something that can be done on the TrueNAS host — it only runs the production build/deploy pipeline (`builder/run-build.sh` in a container with just Node + the AWS CLI) and has no dev tooling installed — so this rule doesn't apply there.

Python lint config lives in the root `pyproject.toml`:
- `broad-exception-caught` is disabled repo-wide for pylint — this repo's documented retry/backoff pattern (see "Rate limiting, retries, and exponential backoff" below) requires bare `except Exception:` with logging, which that rule would otherwise flag on every script.
- `[tool.pylint.format]`/`[tool.pylint.design]` calibrate line-length and complexity thresholds (max-branches/locals/statements/etc.) to fit this codebase's linear fetch-transform-write script style, rather than forcing artificial function splits to satisfy pylint's defaults.
- `mcp/scripts/ignored/` (gitignored, excluded from ruff/mypy/pylint via config) holds scripts that talk to the GameStoryLog API and must never enter git history — see the credentials note under "Setup: credentials" in spirit; if you add a new script that embeds GSL (or any similarly sensitive third-party) credentials, put it here rather than directly in `mcp/scripts/`.

CI (`astro-builder-ghcr.yml`) runs `lint-site`, `lint-python`, `lint-docker`, and `lint-shell` as separate jobs on every push and PR, and the builder Docker image build (`build-publish`) is gated on all four passing. CI never runs `npm run build` for the Astro site itself — the real build needs live Directus DB access that GHA runners don't have (see "Rules for Astro site changes" below).

## Rules for Astro site changes

**Do not use local Astro builds as the acceptance test for site changes.** Local builds can fail for unrelated Directus/query/environment issues and are not a reliable validation method for this project. After merging and deploying site changes, validate by watching the real TrueNAS builder through OpenSearch until it reports success or failure.

**Sorting must always be case-insensitive and done in JavaScript — never rely on PostgreSQL's sort order.** PostgreSQL's default collation is case-sensitive (lowercase sorts after uppercase), so `sort: ["title"]` or `sort: ["name"]` in Directus queries will place titles like "dev_hell" after all uppercase titles. Always omit `sort` from Directus queries for display lists and sort in JS instead:
- Use `sortByTitle(arr)` for arrays with a `.title` field.
- Use `sortByName(arr)` for arrays with a `.name` field.
- Use `compareLabels(a, b)` as a comparator in `.sort()` for other string fields.
All three are in `site/src/lib/list-format.ts`. All raw `localeCompare` calls must include `{ sensitivity: "base" }` as the third argument. Never use bare `.localeCompare(x)` or `.sort()` on title/name/label strings.

**Steam imports: set `game_status` to `"unreleased"` when `release_year` is null.** A missing release year means the game has not yet shipped. Do not default to `"released"`. This applies to `wishlist_import.py`, `generate_import_proposals.py`, `bulk_import.py`, and any future import scripts.

**After every change to the Astro site, update the changelog and bump the version before committing.**

- **Changelog**: `CHANGELOG.md` — prepend a new `## [x.y.z] - YYYY-MM-DD` section with bullet points describing what changed.
- **Version**: `site/package.json` — increment the patch version to match the new changelog entry.

Both files must be updated in the same commit as the site changes. Never batch multiple unrelated features under one version; each logical change gets its own version bump.

## Rules for schema changes

**Never make schema changes (field creation/deletion, relation changes, collection modifications) without explicit user confirmation — even if the user has discussed or approved the plan.** Discussion is not authorization. Wait for a clear "go ahead" directed at the specific schema change before touching `/fields`, `/relations`, or `/collections` endpoints.

**Always take a full `pg_dump` before any delete or schema change — no exceptions, no minimum size threshold.** This includes single-record deletes, game merges, link cleanup, junction sweeps, field creation/deletion, and collection modifications. Use `pg_dump` via the `cms-db` container on TrueNAS; it produces a complete, binary-compatible dump that restores in seconds.

```bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
ssh morgan@truenas.windsofstorm.net \
  "docker exec cms-db pg_dump -U directus directus | gzip > /mnt/myzmirror/directus-jasmeralia/backups/directus_${TIMESTAMP}.sql.gz"
echo "Backup: directus_${TIMESTAMP}.sql.gz"
```

To restore from a backup:
```bash
ssh morgan@truenas.windsofstorm.net \
  "gunzip -c /mnt/myzmirror/directus-jasmeralia/backups/directus_TIMESTAMP.sql.gz | docker exec -i cms-db psql -U directus directus"
```

The old pattern (fetching JSON via `GET /items/{collection}?limit=-1`) is **not** a substitute — it misses system tables, file metadata, relation data, and requires painful record-by-record re-insertion. Always use `pg_dump`.

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

### Rate limiting, retries, and exponential backoff (REQUIRED)

**Any script that communicates with an external API must implement:**
1. **A per-request inter-request delay** — at least 1s between calls to the same host. Values below 0.5s will reliably trigger rate limiting on most public APIs.
2. **Retry with exponential backoff** on rate-limit responses (HTTP 429, and 403 on Steam which uses 403 instead of 429). Silent exception swallowing (`except Exception: return None`) is not acceptable — rate-limit hits must be surfaced so they are distinguishable from genuine no-results.
3. **A maximum retry cap** (5 attempts) with a clearly logged failure after exhaustion.

Use `fetch_with_backoff` / `RetryPolicy` from `scriptlib.py` rather than reimplementing this loop — every script listed as non-compliant in the mcp/scripts audit (2026-07) had a bespoke, slightly-wrong copy of this pattern.

Standard pattern used across this project:

```python
MAX_RETRIES = 5
BACKOFF_BASE = 2.0  # doubles each retry: 2s, 4s, 8s, 16s, 32s

def fetch_with_backoff(url, headers=None) -> tuple[dict | None, str | None]:
    delay = BACKOFF_BASE
    for attempt in range(MAX_RETRIES):
        try:
            req = urllib.request.Request(url, headers=headers or {})
            with urllib.request.urlopen(req, timeout=15) as resp:
                return json.loads(resp.read()), None
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

For the Steam Store API specifically, a base inter-request delay of **1.5s** has been reliable for full-library runs.

### Dry-run / apply pattern: cache external API results (REQUIRED)

Scripts that support a dry-run phase followed by an `--apply` phase **must** cache all external API responses to disk during the dry run. The apply phase must load from that cache and skip re-querying the API entirely. Re-querying wastes rate-limit budget, doubles wall-clock time, and can produce different results between review and commit.

Standard pattern: write a JSON file to `mcp/cache/` keyed by a stable identifier (e.g. `"title|source"`), load it at startup if present, and only call the external API for keys not yet in the cache. Skip the inter-request sleep when serving from cache.

### Resumability (strongly preferred)

Bulk scripts should save progress incrementally (every 25 items) to a JSON file in `mcp/cache/`. On restart, skip already-processed items. Re-attempt transient errors (`api_error`, `rate_limit_exceeded`); skip permanent ones (`api_no_success`, `type=dlc`, `free`).

### Directus API calls

Use the static token directly via `urllib.request` for bulk operations — don't go through MCP tools, which add overhead and have no retry logic. Token: see `.mcp.json`.

**Always write data through the Directus API, never directly to the database.** Direct DB writes bypass Directus Flows, which means hooks like "Tier Row Games – Update Tier Row Date" never fire, `updated_at` timestamps don't update, and changes are invisible to the RSS feed. Use `psycopg2` for read-only queries where the REST API returns 403 or is inconvenient, but all inserts, updates, and deletes must go through the API.

**Before deleting any game record, explicitly delete its junction rows first.** Directus does not reliably cascade-delete junction table rows when a parent record is removed. Surviving orphan rows (with a null or dangling foreign key) cause build-time crashes in any Astro page that expands the relation. At minimum, clean up these collections before calling `DELETE /items/games/{id}`:

```python
GAME_JUNCTIONS = [
    ("tier_list_games", "game_id"),
    ("games_genres",    "games_id"),
    ("games_developers","games_id"),
    ("games_links",     "games_id"),
]

for collection, fk in GAME_JUNCTIONS:
    rows = d_get(f"/items/{collection}?fields=id&filter[{fk}][_eq]={game_id}&limit=-1").get("data", [])
    for row in rows:
        d_delete(f"/items/{collection}/{row['id']}")
```

This list and loop are also available as `scriptlib.GAME_JUNCTIONS` / `scriptlib.delete_game_junctions(client, game_id)` — call that instead of reimplementing the loop.

This has caused build failures more than once (orphaned `tier_list_games` rows leave `game_id: null` entries that crash the tiers page template).

### Import filters

When importing from Steam, always apply:
- `type == "game"` (excludes DLC, demos, mods, software)
- `is_free == False` by default (F2P excluded unless `--include-free`)
- Title does not contain "Playtest" (playtest builds)
- Title does not end with "VR Edition" / contain "(VR)" (VR-only versions)
