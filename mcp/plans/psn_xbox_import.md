# PSN/Xbox Playnite Import Plan

**Source file**: `~/Downloads/playnite_export.csv`
**Platforms**: PlayStation, Xbox (all other sources ignored)
**Total entries in scope**: 884 (785 PlayStation + 99 Xbox)

## Decisions / constraints

- Cross-platform duplicates (same title on PS + Xbox): **PlayStation wins**
- Games already in Directus (matched from Steam import): **skip**
- PS Plus / Game Pass titles: **import all** — no distinction from purchased titles in the CSV
- Cover art: **SteamGridDB primary, IGDB fallback**
- Tier list: **do not add** — games will be reviewed and tiered manually; genre tier sync handled separately
- Completed status: **do not set** — review manually after import; `player_status` is inferred from playtime only

## Prerequisites

### IGDB credentials (required for Phase 2)

1. Create a free app at https://dev.twitch.tv/console/apps
2. Get **Client ID** and **Client Secret**
3. Add both to the `game-encyclopedia` server block in `.mcp.json`:

```json
"game-encyclopedia": {
  "command": "npx",
  "args": ["videogame-encyclopedia-mcp-server"],
  "env": {
    "STEAMGRIDDB_API_KEY": "<your api key>",
    "TWITCH_CLIENT_ID": "<your client id>",
    "TWITCH_CLIENT_SECRET": "<your client secret>"
  }
}
```

4. The import script will exchange these for a short-lived Bearer token at runtime via:
   ```
   POST https://id.twitch.tv/oauth2/token
     ?client_id=...&client_secret=...&grant_type=client_credentials
   ```
   The token expires after ~60 days; the script should fetch a fresh one on each run.

SteamGridDB key is already in `.mcp.json` and requires no additional setup.

### ScreenScraper (optional upgrade)

ScreenScraper can replace or supplement IGDB for console-specific metadata and box art. Requires:
- Free account at https://www.screenscraper.fr
- `ssid` (username) and `sspassword` (password) for user credentials
- Optionally a separate devid/devpassword for higher rate limits (developer registration)

Add to `.mcp.json` if/when available. The enrichment script can be extended to try ScreenScraper first with IGDB as fallback.

---

## Phase 0: Pre-flight

1. Take a full Directus backup before any bulk write session:
   - `GET /items/{collection}?limit=-1` for: `games`, `genres`, `developers`, `games_genres`, `games_developers`
   - Write to `cache/backup_YYYYMMDD_HHMMSS/`
2. Query Directus API for all current game titles (fresh, not cached):
   - `GET /items/games?limit=-1&fields[]=id,title`
   - Save to `cache/directus_titles_current.json`

---

## Phase 1: Prepare candidates — `prepare_psn_xbox.py`

**Output**: `cache/psn_xbox_candidates.json`

### 1.1 Parse CSV

- Skip line 1 (`#TYPE Selected.Playnite.SDK.Models.Game`)
- Parse from line 2 using `csv.DictReader`
- Filter to rows where `Source` ∈ `{PlayStation, Xbox}`

### 1.2 Filter out non-games

Drop any entry matching any of these rules (case-insensitive):

| Rule | Examples |
|---|---|
| Title contains ` OST` or `Soundtrack` or `- Music` | "Warhammer 40k: Inquisitor - Martyr - OST" |
| Title ends with ` Digital Deluxe Content` | "Horizon Forbidden West Digital Deluxe Content" |
| Title contains ` DEMO` or ends with ` Demo` | "OUTRIDERS - DEMO", "NieR: Automata DEMO 120161128" |
| Title ends with ` Prologue` | "Vagrus - The Riven Realms: Prologue" |
| Title contains `: Prologue` | (variant form) |

Note: "Digital Deluxe Edition" (the full game bundle) should **not** be dropped — only "Digital Deluxe Content" (add-on only). Test each filter against the actual title list before finalizing.

### 1.3 Deduplicate

Group rows by **normalized title** (lowercase, strip leading/trailing whitespace). Within each group:

1. If entries span both PlayStation and Xbox → **keep the PlayStation entry**
2. If multiple entries on the same platform → **keep the one with the highest `Playtime`**; break ties by first occurrence in the file
3. Titles with meaningfully different subtitles (e.g. "Ghost of Tsushima" vs "Ghost of Tsushima: Director's Cut") are **distinct games** — do not collapse them

### 1.4 Cross-reference with Directus

For each remaining candidate, compare against `cache/directus_titles_current.json`:

- **Exact match** (case-insensitive) → `status: skip_already_in_directus`
- **Fuzzy match ≥ 90%** (use `difflib.SequenceMatcher`) → `status: possible_duplicate` — log to `cache/psn_xbox_possible_duplicates.json` for manual review, skip from import
- **No match** → `status: candidate`

### 1.5 Cross-reference with Steam library

For each `status: candidate`, fuzzy-match title against `cache/steam_library.json` (appid + name):

- Match found → record `steam_appid` in the candidate entry; Phase 3 will use `https://store.steampowered.com/app/{appid}/` as `download_url`
- No match → Phase 3 will use platform search URL

### 1.6 Output format

```json
[
  {
    "title": "Horizon Forbidden West",
    "source": "PlayStation",
    "release_date": "2/18/2022",
    "playtime": 181801,
    "status": "candidate",
    "steam_appid": null
  }
]
```

---

## Phase 2: Enrich metadata — `enrich_psn_xbox.py`

**Input**: `cache/psn_xbox_candidates.json` (only `status: candidate`)
**Output**: `cache/psn_xbox_enriched.json`
**Miss log**: `cache/psn_xbox_no_metadata.json`
**Resumable**: skip titles already present in enriched file

### 2.1 IGDB search

Endpoint: `https://api.igdb.com/v4/games`

- Authenticate once at script start: POST to Twitch token endpoint, cache token for the run
- Search by title with platform filter (IGDB platform IDs: PS4=48, PS5=167, Xbox One=49, Xbox Series=169)
- Select fields: `name`, `first_release_date`, `genres.name`, `involved_companies.company.name`, `involved_companies.developer`, `cover.url`
- Take the best match by title similarity (SequenceMatcher)
- Extract:
  - `release_year`: from `first_release_date` (Unix timestamp → year); use CSV year as primary, IGDB fills gaps
  - `genres`: list of genre name strings
  - `developers`: list of company names where `developer == true`
  - `cover_art_url`: IGDB cover URL (replace `t_thumb` with `t_cover_big` for higher res)
- Rate limit: IGDB allows 4 requests/second; use 0.3s inter-request delay

### 2.2 SteamGridDB search

Endpoint: `https://www.steamgriddb.com/api/v2/search/autocomplete/{title}`
Then: `https://www.steamgriddb.com/api/v2/grids/game/{id}?dimensions=600x900`

- Search by title → get game ID
- Fetch portrait grid images (600×900), filter `style=alternate` or `style=material` acceptable, prefer `style=alternate`
- Take highest-score result
- Store as `cover_art_url` (overrides IGDB cover if found)
- Rate limit: no published limit; use 0.5s delay

### 2.3 Output format

```json
[
  {
    "title": "Horizon Forbidden West",
    "source": "PlayStation",
    "release_year": 2022,
    "playtime": 181801,
    "steam_appid": null,
    "genres": ["Action", "RPG", "Adventure"],
    "developers": ["Guerrilla Games"],
    "cover_art_url": "https://cdn2.steamgriddb.com/grid/...",
    "cover_art_source": "steamgriddb",
    "igdb_id": 119388
  }
]
```

`cover_art_source` records whether art came from `steamgriddb` or `igdb` (or `null` if neither found).

---

## Phase 3: Import — `import_psn_xbox.py`

**Input**: `cache/psn_xbox_enriched.json`
**Progress**: `cache/psn_xbox_import_progress.json` (flush every 25 items)
**API base**: `https://directus.jasmer.tools`
**Auth**: static token from `.mcp.json`

### 3.1 Build lookup caches (at script start)

- `GET /items/genres?limit=-1&fields[]=id,name` → `genre_cache: {name: id}`
- `GET /items/developers?limit=-1&fields[]=id,name` → `developer_cache: {name: id}`

### 3.2 Per-game: upload cover image

```
POST /files
Content-Type: multipart/form-data
  url: {cover_art_url}
  title: {game_title}
```

Store returned file `id` (UUID). If `cover_art_url` is null, skip — `cover_image` will be null.

### 3.3 Per-game: create game record

`POST /items/games` with:

| Field | Value |
|---|---|
| `title` | Title string from CSV (cleaned — no platform suffixes) |
| `slug` | `re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-')` |
| `release_year` | From CSV `ReleaseDate` year (primary), or IGDB (fallback) |
| `player_status` | `playtime > 0` → `in_progress`; `= 0` → `not_started` |
| `game_status` | `released` |
| `download_url` | Steam URL if `steam_appid` found; else see below |
| `cover_image` | File UUID from 3.2, or `null` |
| `family_sharing` | `null` (not applicable to PS/Xbox) |

**`download_url` for non-Steam games:**
- PlayStation: `https://store.playstation.com/en-us/search/{urllib.parse.quote(title)}`
- Xbox: `https://www.xbox.com/en-US/search?q={urllib.parse.quote(title)}`

These are search URLs, not product pages — acceptable until a dedicated PS/Xbox product ID lookup is implemented.

### 3.4 Per-game: resolve and link genres

For each genre name from IGDB:
1. Normalize: strip whitespace, title-case
2. Check `genre_cache` → if found, use existing ID
3. If not found: `POST /items/genres` with `{name, slug}` → add to cache
4. `POST /items/games_genres` with `{games_id: new_game_id, genres_id: genre_id}`

### 3.5 Per-game: resolve and link developers

Same pattern as genres against `developers` collection and `games_developers` junction.

### 3.6 Progress tracking

```json
{
  "Horizon Forbidden West": {"status": "done", "directus_id": 1234},
  "Some Failed Game": {"status": "error", "error": "http_500"}
}
```

On restart: skip `status: done`. Re-attempt `status: error`.

---

## Output files summary

| File | Purpose |
|---|---|
| `cache/directus_titles_current.json` | Fresh title list used for dedup |
| `cache/psn_xbox_candidates.json` | Cleaned, deduped candidates with skip reasons |
| `cache/psn_xbox_possible_duplicates.json` | Fuzzy-matched titles needing manual review |
| `cache/psn_xbox_enriched.json` | Full metadata per candidate |
| `cache/psn_xbox_no_metadata.json` | Titles with no IGDB/SteamGridDB match — manual review |
| `cache/psn_xbox_import_progress.json` | Per-title import status |

---

## Post-import

- Review `cache/psn_xbox_no_metadata.json` and fill missing cover art / metadata manually in Directus
- Review `cache/psn_xbox_possible_duplicates.json` for any false positives that should have been imported
- Manually set `player_status: completed` for games you've finished (cannot be inferred from Playnite playtime alone)
- Trigger a site rebuild after review is complete
