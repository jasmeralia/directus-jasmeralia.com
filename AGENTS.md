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
| `games` | Primary library. Fields: `id`, `title`, `slug`, `cover_image` (file UUID), `release_year`, `player_status`, `game_status`, `download_url`, `family_sharing` (bool), `section_noun` (string, e.g. "Chapter"/"Act"/"Episode"/"Mission", null defaults to "Chapter"), `current_section` (integer, ordinal of the section currently being played, null = not tracked). **Always set `download_url` to `https://store.steampowered.com/app/{appid}/` when creating a Steam-sourced game.** Valid `player_status` values: `not_started`, `in_progress`, `on_hold`, `waiting_for_update`, `did_not_finish`, `completed`. Valid `game_status` values: `unreleased`, `in_development`, `abandoned`, `released`. |
| `genres` | id + name + slug. Cannot be written by the MCP user via the `genres` endpoint directly — use the REST API with the static token instead. |
| `developers` | id + name + slug |
| `games_genres` | Junction: `games_id`, `genres_id`. Unique constraint on `(games_id, genres_id)` applied. |
| `games_developers` | Junction: `games_id`, `developers_id` |
| `game_sections` | Child of `games` (o2m `sections`, FK `games_id`). One row per chapter/act/episode/mission: `number` (int, required), `title` (string, required - defaults to `"{section_noun} {number}"` when no real name is known), and optional `bundle_member_id` for an included game. Populate via `mcp/scripts/populate_game_sections.py <slug> <count> [noun]` for ordinary games or add `--member <member-slug>` for omnibus members (never write this collection directly). The `game-sections-lookup` Claude Code skill (`.claude/skills/game-sections-lookup/`) handles research. See `mcp/plans/game_sections.md` and `mcp/plans/omnibus_bundles.md`. **Section progress percentages** (game cards, franchise lists): completed games always show 100% even without section rows; in-progress and on-hold games credit the current section at 50% (e.g. section 2 of 10 = 15%, halfway between the prior section's 10% and the upper bound of 20%); other statuses use the upper-bound formula (`current / total`). Optional DLC content is excluded from section data; future DLC tracking would follow the bundle-member pattern (see Odoo task #494). |
| `game_bundle_members` | Curated child records for independently tracked games or campaigns contained in an omnibus library entry. FK `games_id` identifies the parent; optional `source_game_id` links a standalone `games` record without sharing progress. Member-local fields include `sort`, `slug`, `title`, `player_status`, `section_data_status`, `section_noun`, and `current_section`. Populate through `mcp/scripts/populate_game_bundle.py`; never flatten members into franchises or direct parent sections. |
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
| `mcp/cache/game_bundle_lookup.json` | Resumable research findings for omnibus members |
| `mcp/cache/game_bundle_members_needs_manual.json` | Included games whose section structures need manual review |
| `mcp/cache/backup_YYYYMMDD_HHMMSS/` | Full Directus backup taken before bulk import |

## Git workflow

The `master` branch is protected — direct pushes are rejected. **All changes must go through a pull request.** Always push to a feature branch and open a PR via `gh pr create`.

Before creating any PR, fetch the latest `master` and rebase the feature branch against `origin/master`. Resolve any changelog/version conflicts before opening the PR so the PR starts mergeable.

### publish.sh — full deploy in one command

`mcp/scripts/publish.sh` automates the full post-commit deploy sequence: push branch -> create PR -> squash merge -> update local master -> rebuild trigger. It still performs a legacy TrueNAS pre-pull, but the builder now pulls the latest `master` itself, so that step is harmless and redundant.

```bash
mcp/scripts/publish.sh --title "fix: something" [--body "PR body"] [--no-build]
```

- `--title` is required; `--body` defaults to empty.
- `--no-build` skips the legacy TrueNAS pre-pull and rebuild trigger - use this for changes that don't affect the built site (e.g. script-only changes in `mcp/scripts/`).
- Reads `DIRECTUS_TOKEN` from `.mcp.json` for the rebuild trigger.
- Retains a legacy retry that cleans `.serena/` if its redundant TrueNAS pre-pull encounters untracked files.
- Must be run from a feature branch; exits with an error if already on `master`.

## Updating site source on TrueNAS

Manual TrueNAS pulls are no longer required. At the beginning of every build,
the builder script pulls the latest `master` into
`/mnt/myzmirror/directus-jasmeralia` before staging and building the Astro
site. After merging a site change, trigger the build normally and monitor it
through OpenSearch. Only investigate or repair the TrueNAS checkout if the
automatic pull reports a failure in that build's logs.

## Checking build logs

OpenSearch is running on TrueNAS and indexes all container logs. Query it directly — no auth required from LAN:

```bash
curl -s "http://truenas.windsofstorm.net:9200/container-logs-write/_search" \
  -H "Content-Type: application/json" \
  -d '{"size":30,"query":{"term":{"container_name.keyword":"directus-site-builder"}},"sort":[{"@timestamp":{"order":"desc"}}],"_source":["@timestamp","log"]}' \
  | python3 -c "import json,sys; [print(h['_source']['@timestamp'][:19], h['_source']['log'].rstrip()) for h in reversed(json.load(sys.stdin)['hits']['hits'])]"
```

`container-logs-write` is an ISM rollover alias (backing indices `container-logs-000001`, `container-logs-000002`, ...) and holds logs for all TrueNAS containers — this is what Fluent Bit's output config (`/mnt/myzmirror/opensearch/docker-fluent-bit.conf`) actually writes to. **Do not query the plain `container-logs` index** — it's an orphaned, non-rollover index with a handful of stale docs unrelated to the live pipeline; querying it silently returns near-empty results instead of erroring, which looks like broken log shipping but isn't. Look for the final `Build/publish completed successfully.` or `Build/publish FAILED` line. The OpenSearch Dashboards UI is at https://opensearch.jasmer.tools/ (LAN only).

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
| `make test-site` | `site/` - Vitest unit tests for `site/src/lib/` pure logic; runs without live Directus credentials or network access, with fixtures in `site/src/test/fixtures/` |
| `make lint-python` | `mcp/scripts/` — ruff, ruff format, pylint, mypy |
| `make lint-docker` | `builder/Dockerfile` — hadolint |
| `make lint-shell` | `builder/run-build.sh`, `mcp/scripts/publish.sh` — shellcheck |

**If a change is made on typhoon, run `make lintfix && make lint` before committing to verify it passes.** This isn't something that can be done on the TrueNAS host — it only runs the production build/deploy pipeline (`builder/run-build.sh` in a container with just Node + the AWS CLI) and has no dev tooling installed — so this rule doesn't apply there.

Python lint config lives in the root `pyproject.toml`:
- `broad-exception-caught` is disabled repo-wide for pylint — this repo's documented retry/backoff pattern (see "Rate limiting, retries, and exponential backoff" below) requires bare `except Exception:` with logging, which that rule would otherwise flag on every script.
- `[tool.pylint.format]`/`[tool.pylint.design]` calibrate line-length and complexity thresholds (max-branches/locals/statements/etc.) to fit this codebase's linear fetch-transform-write script style, rather than forcing artificial function splits to satisfy pylint's defaults.
- `mcp/scripts/ignored/` (gitignored, excluded from ruff/mypy/pylint via config) holds scripts that talk to the GameStoryLog API, and/or that only make sense on this specific machine (e.g. scanning local RenPy save-file locations for AVN progress), and must never enter git history — see the credentials note under "Setup: credentials" in spirit; if you add a new script that embeds GSL (or any similarly sensitive third-party) credentials, or that is otherwise local-machine-specific, put it here rather than directly in `mcp/scripts/`. The `game-sections-lookup` skill (`.claude/skills/game-sections-lookup/`) auto-discovers any script here tagged with a `# game-sections-lookup:` header comment — see that skill file for the discovery/usage convention rather than assuming a specific script name, since these files are not committed and may not exist in every checkout.

CI (`astro-builder-ghcr.yml`) runs `lint-site`, `test-site`, `lint-python`, `lint-docker`, and `lint-shell` as separate jobs on every push and PR, and the builder Docker image build (`build-publish-docker-image`) is gated on all five passing. CI never runs `npm run build` for the Astro site itself — the real build needs live Directus DB access that GHA runners don't have (see "Rules for Astro site changes" below).

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

**Any new page under `site/src/pages/filters/` must be linked from `filters/index.astro`, or it's orphaned.** `filters/index.astro` is the only place these pages are discoverable from — there's no directory scan, no nav entry, nothing else pointing at them. The `developer/[developer]/...`, `engine/[engine]/...`, `genre/[genre]/...`, and `section-data/[state]/played_status/[status]` combinatorial routes are the exception: they're linked automatically because `filters/index.astro` derives `developerStatusEntries`, `developerPlayedEntries`, `engineStatusEntries`, `engineGenreEntries`, `enginePlayedEntries`, `genreStatusEntries`, `genrePlayedEntries`, and `sectionDataPlayedEntries` straight from the games data, so a new developer/engine/genre/section-data combination gets a link for free. Everything else — every one-off page under `filters/misc/*.astro` — is only linked because it has a matching hand-maintained entry (`{ label, href, count }`) in the `miscFilterEntries` array; adding the page without adding the entry leaves it deployed but unreachable except by typing its exact URL. `games-missing-sections.astro` shipped this way and went unlinked for a release before being caught (it was later replaced by the general `section-data`/`played_status` combinatorial section rather than re-added to `miscFilterEntries`). When adding any new filter page that doesn't fall under one of the auto-generated combinatorial sections, add its `miscFilterEntries` entry (and any supporting count computation, reusing the shared `games` fetch already in `filters/index.astro` where possible) in the same commit.

## Rules for schema changes

**Never make schema changes (field creation/deletion, relation changes, collection modifications) without explicit user confirmation — even if the user has discussed or approved the plan.** Discussion is not authorization. Wait for a clear "go ahead" directed at the specific schema change before touching `/fields`, `/relations`, or `/collections` endpoints.

**Always take a full-database `pg_dump` before any delete or schema change — no exceptions, no minimum size threshold, and never scoped to just the table(s) you think are affected.** This includes single-record deletes, game merges, link cleanup, junction sweeps, field creation/deletion, and collection modifications. Schema changes routinely touch Directus system tables you wouldn't think to check (`directus_fields`, `directus_relations`, `directus_permissions`, `directus_presets`, `directus_flows`/`directus_operations`, `directus_revisions`, `directus_activity`, etc.) — a `pg_dump -t <table>` scoped to only the "obviously affected" tables is not an acceptable substitute and can leave a restore inconsistent. Always dump the whole `directus` database. Use `pg_dump` via the `cms-db` container on TrueNAS; it produces a complete, binary-compatible dump that restores in seconds.

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
