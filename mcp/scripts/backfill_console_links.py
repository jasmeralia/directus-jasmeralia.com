#!/usr/bin/env python3
"""
backfill_console_links.py

For each game with a Steam download link but no PlayStation/Xbox link:
  1. Queries IGDB to confirm the game has PS4/PS5/Xbox One/Series X releases.
  2. Searches the PSN Store and/or Xbox Store for the actual store page.
  3. Auto-adds high-confidence matches; flags uncertain cases for review.

Usage:
  python3 backfill_console_links.py           # dry-run (report only)
  python3 backfill_console_links.py --apply   # commit links to Directus

Output:
  mcp/cache/console_links_progress.json  — resumable per-game state
  mcp/cache/console_links_review.md      — manual review queue
"""

import difflib
import json
import re
import sys
import time
import urllib.parse
import urllib.request
import ssl
from collections import defaultdict
from pathlib import Path

from scriptlib import RetryPolicy, fetch_with_backoff

# ---------------------------------------------------------------------------
# Paths and config
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).parent
CACHE_DIR = SCRIPT_DIR.parent / "cache"
MCP_JSON = SCRIPT_DIR.parent.parent / ".mcp.json"
PROGRESS_FILE = CACHE_DIR / "console_links_progress.json"
REVIEW_FILE = CACHE_DIR / "console_links_review.md"
APPLIED_FILE = CACHE_DIR / "console_links_applied.json"

CACHE_DIR.mkdir(exist_ok=True)

with open(MCP_JSON, encoding="utf-8") as f:
    cfg = json.load(f)
_d = cfg["mcpServers"]["directus"]["env"]
_g = cfg["mcpServers"]["game-encyclopedia"]["env"]

BASE = _d["DIRECTUS_URL"].rstrip("/")
DIRECTUS_TOKEN = _d["DIRECTUS_TOKEN"]
TWITCH_CLIENT_ID = _g["TWITCH_CLIENT_ID"]
TWITCH_CLIENT_SECRET = _g["TWITCH_CLIENT_SECRET"]

CTX = ssl.create_default_context()
DH = {"Authorization": f"Bearer {DIRECTUS_TOKEN}", "Content-Type": "application/json"}
DRY_RUN = "--apply" not in sys.argv

_limit_arg = next(
    (
        sys.argv[i + 1]
        for i, a in enumerate(sys.argv)
        if a == "--limit" and i + 1 < len(sys.argv)
    ),
    None,
)
LIMIT = int(_limit_arg) if _limit_arg else None

# IGDB platform IDs
IGDB_PS_IDS = {48, 167}  # PS4, PS5
IGDB_XBOX_IDS = {49, 169}  # Xbox One, Xbox Series X|S

HIGH_CONF = 0.82
REVIEW_CONF = 0.55

# ---------------------------------------------------------------------------
# Directus helpers
# ---------------------------------------------------------------------------


def d_get(path, params=None):
    """Fetch a Directus resource with optional query parameters."""
    url = f"{BASE}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params, doseq=True)
    req = urllib.request.Request(url, headers=DH)
    with urllib.request.urlopen(req, context=CTX) as r:
        return json.loads(r.read())


def d_post(path, data):
    """Create a Directus resource."""
    body = json.dumps(data).encode()
    req = urllib.request.Request(f"{BASE}{path}", data=body, headers=DH, method="POST")
    with urllib.request.urlopen(req, context=CTX) as r:
        return json.loads(r.read())


# ---------------------------------------------------------------------------
# IGDB
# ---------------------------------------------------------------------------


def get_igdb_token():
    """Request an application token for IGDB."""
    params = urllib.parse.urlencode(
        {
            "client_id": TWITCH_CLIENT_ID,
            "client_secret": TWITCH_CLIENT_SECRET,
            "grant_type": "client_credentials",
        }
    )
    req = urllib.request.Request(
        "https://id.twitch.tv/oauth2/token", data=params.encode(), method="POST"
    )
    with urllib.request.urlopen(req, context=CTX, timeout=10) as r:
        return json.loads(r.read())["access_token"]


def _normalized_fetch_error(err: str | None) -> str | None:
    """Normalize network failures to a resumable cache status."""
    return "api_error" if err and err.startswith("error:") else err


def igdb_search(title, igdb_headers):
    """Search IGDB for a title with retry handling."""
    # Escape double quotes in title
    safe_title = title.replace('"', '\\"')
    body = f'fields name,platforms.id,platforms.abbreviation; search "{safe_title}"; limit 10;'.encode()
    results, err = fetch_with_backoff(
        "https://api.igdb.com/v4/games",
        data=body,
        headers=igdb_headers,
        method="POST",
        timeout=12,
        retry=RetryPolicy(rate_limit_codes=(429,)),
    )
    return results, _normalized_fetch_error(err)


def igdb_platform_check(our_title, results):
    """Return (best_match_name, has_ps, has_xbox, score).

    Unions platforms across all HIGH_CONF matches so that duplicate IGDB entries
    (e.g. separate PC-only and multiplatform records for the same title) don't
    cause a console-available game to be classified as PC-only.
    """
    best, best_score = None, 0.0
    for r in results:
        s = title_similarity(our_title, r.get("name", ""))
        if s > best_score:
            best, best_score = r, s
    if best is None or best_score < REVIEW_CONF:
        return None, False, False, best_score
    # Union platforms across all results that score within 0.05 of the best
    all_plat_ids: set[int] = set()
    for r in results:
        if title_similarity(our_title, r.get("name", "")) >= best_score - 0.05:
            for p in r.get("platforms", []):
                all_plat_ids.add(p["id"])
    return (
        best["name"],
        bool(all_plat_ids & IGDB_PS_IDS),
        bool(all_plat_ids & IGDB_XBOX_IDS),
        best_score,
    )


# ---------------------------------------------------------------------------
# Title similarity
# ---------------------------------------------------------------------------


def title_similarity(a, b):
    """Calculate normalized similarity between two titles."""
    a2 = " ".join(sorted(a.lower().split()))
    b2 = " ".join(sorted(b.lower().split()))
    return difflib.SequenceMatcher(None, a2, b2).ratio()


def store_title_similarity(our_title, store_title):
    """Similarity that also checks a platform-suffix-stripped version of the store title.

    PSN often appends '(PS4® & PS5®)', Xbox appends ' - Xbox One Edition', etc.
    Strip those before comparing so the base game still scores as a confident match.
    """
    base = re.sub(
        r"[\s\-–]+("
        r"ps[45]?[®™]?|xbox\s*(one|series\s*x)?|series\s*x\|?s?"
        r"|x\|s|x\\|s"
        r"|standard|ultimate|digital|deluxe|gold|complete"
        r"|edition|bundle|collection|pack|remaster(?:ed)?"
        r").*$",
        "",
        store_title,
        flags=re.IGNORECASE,
    )
    # Also strip parenthetical suffixes: '(PS4® & PS5®)', '(Game Preview)', etc.
    base = re.sub(r"\s*\([^)]*\)\s*$", "", base).strip()
    return max(
        title_similarity(our_title, store_title), title_similarity(our_title, base)
    )


# ---------------------------------------------------------------------------
# Xbox Store (storeedgefd CDN — JSON API, no auth)
# ---------------------------------------------------------------------------

XBOX_H = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json",
}


def xbox_search(title):
    """Search the Xbox store for a title with retry handling."""
    q = urllib.parse.quote(title)
    url = (
        f"https://storeedgefd.dsx.mp.microsoft.com/v9.0/search"
        f"?market=US&locale=en-US&query={q}&apptype=Game"
    )
    data, err = fetch_with_backoff(
        url,
        headers=XBOX_H,
        timeout=12,
        retry=RetryPolicy(rate_limit_codes=(429,)),
    )
    if data is None:
        return None, _normalized_fetch_error(err)
    return data.get("Payload", {}).get("SearchResults", []), None


_XBOX_PC_ONLY = re.compile(
    r"\s*\(PC\)\s*$"
    r"|\s*\(Windows(?:\s*\d+)?\)\s*$"
    r"|\s+PC\s*$"
    r"|\s*-\s*PC\s*$",
    re.IGNORECASE,
)

_XBOX_NON_GAME = re.compile(
    r"\b(season pass|language pack|upgrade pack|complete upgrade|"
    r"demo|trial|add-?on|dlc|soundtrack|artbook|episode\s+\d"
    r"|content pack|game pack|bonus content)\b",
    re.IGNORECASE,
)

# PSN result titles that indicate DLC / non-game content
# localizedType values that indicate non-game content on PSN
_PSN_NON_GAME_TYPES = {
    "add-on",
    "season pass",
    "language pack",
    "upgrade",
    "complete upgrade",
    "demo",
    "trial",
    "expansion",
    "dlc",
    "extra content",
    "virtual currency",
    "sound track",
    "soundtrack",
    "art book",
    "theme",
}

_PSN_NON_GAME = re.compile(
    r"\b(season pass|language pack|upgrade pack|complete upgrade|"
    r"demo|trial|add-?on|dlc|soundtrack|artbook|episode\s+\d)\b",
    re.IGNORECASE,
)


def _trailing_number(title: str) -> str | None:
    """Extract trailing Arabic or Roman numeral from a title, or None."""
    m = re.search(r"\b([ivxIVX]+|\d+)\s*$", title.strip())
    if not m:
        return None
    tok = m.group(1)
    # Normalize Roman numerals to int strings so II == 2, etc.
    roman = {
        "i": 1,
        "ii": 2,
        "iii": 3,
        "iv": 4,
        "v": 5,
        "vi": 6,
        "vii": 7,
        "viii": 8,
        "ix": 9,
        "x": 10,
    }
    low = tok.lower()
    return str(roman[low]) if low in roman else tok


def sequel_penalized_score(
    our_title: str, store_title: str, base_score: float
) -> float:
    """Reduce score sharply when the two titles have different trailing numbers.

    Prevents 'Darkest Dungeon' matching 'Darkest Dungeon II', or
    'Mortal Kombat X' matching 'Mortal Kombat 11'.
    """
    ours = _trailing_number(our_title)
    store = _trailing_number(store_title)
    if ours is not None and store is not None and ours != store:
        return base_score * 0.55  # push below REVIEW_CONF in most cases
    if ours is None and store is not None:
        # Our title has no number but store result does — likely a sequel
        return base_score * 0.70
    return base_score


def scan_cache_anomalies(progress: dict, last_n: int = 100) -> list[str]:
    """Return a list of warning strings for suspicious entries in recent cache."""
    warnings = []
    recent = list(progress.values())[-last_n:]
    for entry in recent:
        if entry.get("status") != "done":
            continue
        title = entry.get("title", "")
        for added in entry.get("added", []):
            store_name = added.get("name", "")
            plat = added.get("platform", "").upper()
            is_non_game = _PSN_NON_GAME.search(store_name) or (
                plat == "XBOX" and _XBOX_NON_GAME.search(store_name)
            )
            if is_non_game:
                warnings.append(f"  NON-GAME slip [{plat}] {title!r} → {store_name!r}")
            ours = _trailing_number(title)
            store = _trailing_number(store_name)
            if ours is not None and store is not None and ours != store:
                warnings.append(
                    f"  SEQUEL MISMATCH [{plat}] {title!r} → {store_name!r}"
                )
            elif ours is None and store is not None:
                warnings.append(f"  SEQUEL SUSPECT [{plat}] {title!r} → {store_name!r}")
    return warnings


def xbox_best(our_title, results):
    """Return (store_title, score, url) for best Xbox match.

    Skips entries explicitly labelled as PC-only (e.g. 'Game Title (PC)',
    'Game Title PC', 'Game Title (Windows 10)').
    Applies sequel penalty when trailing numbers differ.
    """
    best, best_score = None, 0.0
    for r in results:
        title = r.get("Title", "")
        if _XBOX_PC_ONLY.search(title):
            continue
        if _XBOX_NON_GAME.search(title):
            continue
        s = store_title_similarity(our_title, title)
        s = sequel_penalized_score(our_title, title, s)
        if s > best_score:
            best, best_score = r, s
    if best is None:
        return None, 0.0, None
    pid = best.get("ProductId", "")
    url = f"https://www.xbox.com/en-US/games/store/x/{pid}" if pid else None
    return best["Title"], best_score, url


# ---------------------------------------------------------------------------
# PSN Store (parse __NEXT_DATA__ Apollo cache from search page)
# ---------------------------------------------------------------------------

PSN_H = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}


def _parse_psn_search(raw: bytes) -> list[dict]:
    """Extract product results from a PlayStation search response."""
    body = raw.decode("utf-8", errors="replace")
    match = re.search(
        r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', body, re.DOTALL
    )
    if not match:
        return []
    apollo = json.loads(match.group(1)).get("props", {}).get("apolloState", {})
    results = []
    for key, value in apollo.items():
        if key.startswith("Product:") and isinstance(value, dict) and value.get("name"):
            product_id = key.replace("Product:", "").replace(":en-us", "")
            results.append(
                {
                    "name": value["name"],
                    "localizedType": value.get("localizedType", ""),
                    "url": f"https://store.playstation.com/en-us/product/{product_id}",
                }
            )
    return results


def psn_search(title):
    """Search the PlayStation store for a title with retries."""
    q = urllib.parse.quote(title)
    url = f"https://store.playstation.com/en-us/search/{q}"
    results, err = fetch_with_backoff(
        url,
        headers=PSN_H,
        timeout=15,
        parse=_parse_psn_search,
        retry=RetryPolicy(rate_limit_codes=(429,)),
    )
    if results is None:
        return None, _normalized_fetch_error(err)
    return results, None


def psn_best(our_title, results):
    """Return (store_title, score, url) for best PSN match.

    Skips DLC / season passes / language packs.
    Applies sequel penalty when trailing numbers differ.
    """
    best, best_score = None, 0.0
    for r in results:
        name = r.get("name", "")
        # Filter by structured type field when present
        ltype = r.get("localizedType", "").lower().strip()
        if ltype and ltype in _PSN_NON_GAME_TYPES:
            continue
        # Fallback: name-based DLC/non-game filter
        if _PSN_NON_GAME.search(name):
            continue
        s = store_title_similarity(our_title, name)
        s = sequel_penalized_score(our_title, name, s)
        if s > best_score:
            best, best_score = r, s
    if best is None:
        return None, 0.0, None
    return best["name"], best_score, best["url"]


def write_review_file(
    review: list[dict], psn_count: int, xbox_count: int, pc_only_count: int
) -> None:
    """Write the manual console-link review queue."""
    lines = [
        "# Console Links — Manual Review Queue\n\n",
        "Auto-generated. Games here either had ambiguous store matches or no IGDB match.\n",
        f"Run date: {time.strftime('%Y-%m-%d')}\n\n",
        "| Stat | Count |\n|---|---|\n",
        f"| PSN links auto-added | {psn_count} |\n",
        f"| Xbox links auto-added | {xbox_count} |\n",
        f"| Needs review | {len(review)} |\n",
        f"| Confirmed PC-only | {pc_only_count} |\n\n",
        "---\n\n",
    ]
    for record in review:
        lines.append(f"## {record['title']} (game_id={record['game_id']})\n\n")
        if "igdb" in record:
            lines.append(f"**IGDB match:** {record['igdb']}\n\n")
        if "reason" in record:
            lines.append(f"**Note:** {record['reason']}\n\n")
        for candidate in record.get("candidates", []):
            url = candidate.get("url")
            url_md = f"[{url}]({url})" if url else "_no URL found_"
            lines.append(
                f"- **{candidate['platform']}** — {candidate['store_name']!r} "
                f"(score={candidate['score']:.2f}) → {url_md}\n"
            )
        lines.append("\n")
    REVIEW_FILE.write_text("".join(lines))
    print(f"\nReview file written: {REVIEW_FILE}")


def apply_cached_links(progress: dict) -> None:
    """Apply every cached add decision that has not already been posted."""
    applied_keys = (
        set(json.loads(APPLIED_FILE.read_text())) if APPLIED_FILE.exists() else set()
    )
    to_add = []
    for game_id, record in progress.items():
        if record.get("status") != "done":
            continue
        for added in record.get("added", []):
            url = added.get("url")
            applied_key = f"{game_id}:{url}"
            if url and applied_key not in applied_keys:
                to_add.append(
                    {"game_id": int(game_id), "url": url, "applied_key": applied_key}
                )
    if not to_add:
        print("Nothing to add.")
        return

    print(f"\nAdding {len(to_add)} links...")
    ok = 0
    for entry in to_add:
        try:
            d_post(
                "/items/games_links",
                {
                    "games_id": entry["game_id"],
                    "url": entry["url"],
                    "kind": "download",
                },
            )
            ok += 1
            applied_keys.add(entry["applied_key"])
        except Exception as error:
            print(f"  ERROR game={entry['game_id']}: {error}")
        time.sleep(0.1)

    APPLIED_FILE.write_text(json.dumps(sorted(applied_keys), indent=2))
    print(f"Done. Added {ok}/{len(to_add)} links.")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    """Find and optionally create missing console-store links."""
    mode = "DRY RUN" if DRY_RUN else "APPLY"
    print(f"[{mode}] Fetching link data from Directus...\n")

    # Load progress cache (resumability)
    progress: dict = {}
    if PROGRESS_FILE.exists():
        progress = json.loads(PROGRESS_FILE.read_text())
        print(f"Resuming: {len(progress)} games already processed.\n")

    # Games tagged AVN — PC-only by nature, skip entirely
    avn_rows = d_get(
        "/items/games_genres",
        {"limit": -1, "fields": "games_id", "filter[genres_id][_eq]": 1},
    )["data"]
    avn_game_ids = {r["games_id"] for r in avn_rows}
    print(f"AVN games excluded: {len(avn_game_ids)}\n")

    # Identify Steam-only games
    all_links = d_get(
        "/items/games_links", {"limit": -1, "fields": "games_id,url,kind"}
    )["data"]
    by_game: dict[int, set] = defaultdict(set)
    for link in all_links:
        gid = link["games_id"]
        u = (link["url"] or "").lower()
        if "steampowered.com" in u:
            by_game[gid].add("steam")
        if "playstation.com" in u:
            by_game[gid].add("psn")
        if "xbox.com" in u or "microsoft.com/store" in u:
            by_game[gid].add("xbox")

    todo_ids = sorted(
        gid
        for gid, plats in by_game.items()
        if "steam" in plats and "psn" not in plats and "xbox" not in plats
        if gid not in avn_game_ids
        if str(gid) not in progress
        or progress[str(gid)].get("status") in {"rate_limit_exceeded", "api_error"}
        or progress[str(gid)].get("status", "").startswith("http_")
    )

    # Fetch titles for all todo games
    games_data = d_get(
        "/items/games",
        {
            "limit": -1,
            "fields": "id,title",
            "filter[id][_in]": ",".join(map(str, todo_ids)),
        },
    )["data"]
    game_title = {g["id"]: g["title"] for g in games_data}

    if LIMIT:
        todo_ids = todo_ids[:LIMIT]

    total = len(todo_ids)
    skipped_cached = len(progress)
    print(
        f"Steam-only games to process: {total}  (skipping {skipped_cached} already cached)\n"
    )

    # Authenticate with IGDB
    igdb_token = get_igdb_token()
    igdb_headers = {
        "Authorization": f"Bearer {igdb_token}",
        "Client-ID": TWITCH_CLIENT_ID,
        "Content-Type": "text/plain",
    }

    added_psn: list[dict] = []
    added_xbox: list[dict] = []
    review: list[dict] = []
    pc_only: list[dict] = []
    no_igdb: list[dict] = []

    for i, gid in enumerate(todo_ids, 1):
        title = game_title.get(gid, f"(unknown {gid})")
        tag = f"[{i}/{total}]"

        # --- IGDB platform check ---
        igdb_results, err = igdb_search(title, igdb_headers)
        time.sleep(1.0)
        if err is not None:
            print(f"{tag} ERROR {title!r}  (IGDB: {err})")
            progress[str(gid)] = {"status": err, "title": title}
            PROGRESS_FILE.write_text(json.dumps(progress, indent=2))
            continue
        igdb_name, has_ps, has_xbox, igdb_score = igdb_platform_check(
            title, igdb_results
        )

        if igdb_name is None:
            print(f"{tag} SKIP  {title!r}  (IGDB: no match, score={igdb_score:.2f})")
            progress[str(gid)] = {
                "status": "no_igdb",
                "title": title,
                "igdb_score": igdb_score,
            }
            no_igdb.append({"game_id": gid, "title": title})
            review.append(
                {
                    "game_id": gid,
                    "title": title,
                    "reason": f"No confident IGDB match (best score: {igdb_score:.2f}) — may need manual lookup",
                    "candidates": [],
                }
            )
            PROGRESS_FILE.write_text(json.dumps(progress, indent=2))
            continue

        if not has_ps and not has_xbox:
            print(f"{tag} PC-ONLY  {title!r}  (IGDB: {igdb_name!r})")
            progress[str(gid)] = {
                "status": "pc_only",
                "title": title,
                "igdb": igdb_name,
            }
            pc_only.append({"game_id": gid, "title": title, "igdb": igdb_name})
            PROGRESS_FILE.write_text(json.dumps(progress, indent=2))
            continue

        platforms_str = " + ".join(
            (["PS4/PS5"] if has_ps else []) + (["Xbox"] if has_xbox else [])
        )
        print(f"{tag} CHECK  {title!r}  [{platforms_str}]")

        game_added: list[dict] = []
        game_review: list[dict] = []

        # --- PSN ---
        if has_ps:
            psn_results, err = psn_search(title)
            time.sleep(2.0)
            if err is not None:
                print(f"  PSN  ERROR   {err}")
                progress[str(gid)] = {"status": err, "title": title}
                PROGRESS_FILE.write_text(json.dumps(progress, indent=2))
                continue
            psn_name, psn_score, psn_url = psn_best(title, psn_results)

            if psn_name and psn_score >= HIGH_CONF:
                print(f"  PSN  ADD     {psn_name!r}  [{psn_score:.2f}]  {psn_url}")
                game_added.append(
                    {
                        "platform": "psn",
                        "url": psn_url,
                        "name": psn_name,
                        "score": psn_score,
                    }
                )
                added_psn.append(
                    {
                        "game_id": gid,
                        "title": title,
                        "store_name": psn_name,
                        "score": psn_score,
                        "url": psn_url,
                    }
                )
            elif psn_name and psn_score >= REVIEW_CONF:
                print(f"  PSN  REVIEW  {psn_name!r}  [{psn_score:.2f}]")
                game_review.append(
                    {
                        "platform": "PSN",
                        "store_name": psn_name,
                        "score": psn_score,
                        "url": psn_url,
                    }
                )
            else:
                label = psn_name or "no results"
                print(f"  PSN  MISS    (best: {label!r} [{psn_score:.2f}])")
                game_review.append(
                    {
                        "platform": "PSN",
                        "store_name": label,
                        "score": psn_score,
                        "url": None,
                    }
                )

        # --- Xbox ---
        if has_xbox:
            xbox_results, err = xbox_search(title)
            time.sleep(1.0)
            if err is not None:
                print(f"  Xbox ERROR   {err}")
                progress[str(gid)] = {"status": err, "title": title}
                PROGRESS_FILE.write_text(json.dumps(progress, indent=2))
                continue
            xbox_name, xbox_score, xbox_url = xbox_best(title, xbox_results)

            if xbox_name and xbox_score >= HIGH_CONF:
                print(f"  Xbox ADD     {xbox_name!r}  [{xbox_score:.2f}]  {xbox_url}")
                game_added.append(
                    {
                        "platform": "xbox",
                        "url": xbox_url,
                        "name": xbox_name,
                        "score": xbox_score,
                    }
                )
                added_xbox.append(
                    {
                        "game_id": gid,
                        "title": title,
                        "store_name": xbox_name,
                        "score": xbox_score,
                        "url": xbox_url,
                    }
                )
            elif xbox_name and xbox_score >= REVIEW_CONF:
                print(f"  Xbox REVIEW  {xbox_name!r}  [{xbox_score:.2f}]")
                game_review.append(
                    {
                        "platform": "Xbox",
                        "store_name": xbox_name,
                        "score": xbox_score,
                        "url": xbox_url,
                    }
                )
            else:
                label = xbox_name or "no results"
                print(f"  Xbox MISS    (best: {label!r} [{xbox_score:.2f}])")
                game_review.append(
                    {
                        "platform": "Xbox",
                        "store_name": label,
                        "score": xbox_score,
                        "url": None,
                    }
                )

        if game_review:
            review.append(
                {
                    "game_id": gid,
                    "title": title,
                    "igdb": igdb_name,
                    "candidates": game_review,
                }
            )

        progress[str(gid)] = {
            "status": "done",
            "title": title,
            "igdb": igdb_name,
            "added": game_added,
            "review": game_review,
        }
        PROGRESS_FILE.write_text(json.dumps(progress, indent=2))

        if i % 100 == 0:
            anomalies = scan_cache_anomalies(progress)
            anom_str = f" ANOMALIES={len(anomalies)}" if anomalies else ""
            print(
                f"CHECKPOINT [{i}/{total}] psn_add={len(added_psn)} xbox_add={len(added_xbox)} review={len(review)} pc_only={len(pc_only)} no_igdb={len(no_igdb)}{anom_str}",
                flush=True,
            )
            for w in anomalies:
                print(w, flush=True)

    # --- Summary ---
    print(f"\n{'=' * 70}")
    print(f"PSN links to add:  {len(added_psn)}")
    print(f"Xbox links to add: {len(added_xbox)}")
    print(f"For review:        {len(review)}")
    print(f"PC-only (skipped): {len(pc_only)}")

    write_review_file(review, len(added_psn), len(added_xbox), len(pc_only))

    if DRY_RUN:
        print("\nRun with --apply to commit links to Directus.")
        return

    apply_cached_links(progress)


if __name__ == "__main__":
    main()
