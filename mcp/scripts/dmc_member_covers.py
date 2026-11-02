#!/usr/bin/env python3
"""Source and assign portrait covers to the Devil May Cry HD Collection members.

Phases (all external lookups are cached in mcp/cache/dmc_covers_*.json):

    python3 dmc_member_covers.py search       # SteamGridDB game search per member
    python3 dmc_member_covers.py candidates   # SteamGridDB portrait grids per game
    python3 dmc_member_covers.py report       # resolve CHOSEN_GRIDS, write report
    python3 dmc_member_covers.py apply        # import chosen images, patch members

Same approach as gold_box_member_covers.py: the manual curation step is filling
in SGDB_GAME_IDS / CHOSEN_GRIDS between `candidates` and `report`.
"""

import argparse
import json
import sys
import time
import urllib.parse
from typing import Any

from scriptlib import (
    CACHE_DIR,
    DirectusClient,
    RetryPolicy,
    fetch_with_backoff,
    server_env,
)

SGDB_API = "https://www.steamgriddb.com/api/v2"
# SteamGridDB sits behind Cloudflare, which rejects the default Python UA (1010).
USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) jasmeralia-dmc-covers"
REQUEST_DELAY_S = 1.1
RETRY = RetryPolicy(rate_limit_codes=(429, 403))
PORTRAIT_DIMENSIONS = "600x900,342x482,660x930"

SEARCH_CACHE = CACHE_DIR / "dmc_covers_search.json"
CANDIDATES_CACHE = CACHE_DIR / "dmc_covers_sgdb.json"
CHOICES_CACHE = CACHE_DIR / "dmc_covers_choices.json"
REPORT_PATH = CACHE_DIR / "dmc_covers_report.json"
IMPORT_CACHE = CACHE_DIR / "dmc_covers_imported.json"

# Directus game_bundle_members id -> search term.
MEMBER_SEARCH: dict[int, str] = {
    10: "Devil May Cry",
    11: "Devil May Cry 2",
    12: "Devil May Cry 3: Special Edition",
}

# Directus game_bundle_members id -> SteamGridDB game id (verified by name/year).
SGDB_GAME_IDS: dict[int, int] = {
    10: 36324,  # Devil May Cry
    11: 35153,  # Devil May Cry 2
    12: 18981,  # Devil May Cry 3: Dante's Awakening - Special Edition
}

# Directus game_bundle_members id -> chosen SteamGridDB grid id.
CHOSEN_GRIDS: dict[int, int] = {
    10: 82954,  # GridMaster, original NA box art
    11: 71085,  # TUFKAC, original NA box art
    12: 82955,  # GridMaster, original NA Special Edition box art
}


def load_json(path: Any) -> Any:
    """Load a JSON cache file, returning an empty dict when absent."""
    return json.loads(path.read_text()) if path.exists() else {}


def save_json(path: Any, data: Any) -> None:
    """Write a JSON cache file."""
    path.write_text(json.dumps(data, indent=1, ensure_ascii=True) + "\n")


def sgdb_headers() -> dict[str, str]:
    """Build SteamGridDB request headers from the configured key."""
    return {
        "Authorization": f"Bearer {server_env('game-encyclopedia')['STEAMGRIDDB_API_KEY']}",
        "User-Agent": USER_AGENT,
    }


def sgdb_get(path: str, headers: dict[str, str]) -> Any:
    """GET from SteamGridDB with the project's delay/backoff policy."""
    time.sleep(REQUEST_DELAY_S)
    data, error = fetch_with_backoff(
        f"{SGDB_API}{path}",
        headers=headers,
        retry=RETRY,
    )
    if error:
        print(f"  SGDB error for {path}: {error}", file=sys.stderr)
        return None
    return data


def cmd_search() -> None:
    """Search SteamGridDB for each member's game id (cached)."""
    headers = sgdb_headers()
    cache = load_json(SEARCH_CACHE)
    for member_id, term in MEMBER_SEARCH.items():
        if str(member_id) in cache:
            continue
        data = sgdb_get(f"/search/autocomplete/{urllib.parse.quote(term)}", headers)
        if data is None:
            continue
        cache[str(member_id)] = data.get("data", [])
        save_json(SEARCH_CACHE, cache)
    for member_id, results in cache.items():
        print(f"member {member_id} ({MEMBER_SEARCH[int(member_id)]}):")
        for game in results[:8]:
            released = game.get("release_date")
            print(
                f"   sgdb {game['id']:>7} {game['name']} ({released}) verified={game.get('verified')}"
            )


def cmd_candidates() -> None:
    """Fetch and cache portrait grids for every member's SteamGridDB game."""
    headers = sgdb_headers()
    cache = load_json(CANDIDATES_CACHE)
    for member_id, game_id in SGDB_GAME_IDS.items():
        key = str(game_id)
        if key in cache and cache[key] is not None:
            continue
        query = urllib.parse.urlencode(
            {"dimensions": PORTRAIT_DIMENSIONS, "nsfw": "false", "humor": "false"}
        )
        data = sgdb_get(f"/grids/game/{game_id}?{query}", headers)
        if data is None:
            continue
        cache[key] = [
            {
                "id": grid["id"],
                "url": grid["url"],
                "thumb": grid["thumb"],
                "style": grid["style"],
                "width": grid["width"],
                "height": grid["height"],
                "mime": grid.get("mime"),
                "score": grid.get("score"),
                "author": grid.get("author", {}).get("name"),
                "notes": grid.get("notes"),
            }
            for grid in data.get("data", [])
        ]
        print(f"member {member_id} / sgdb {game_id}: {len(cache[key])} grids")
        for grid in cache[key]:
            print(
                f"   grid {grid['id']:>7} {grid['width']}x{grid['height']} "
                f"{grid['style']:<10} score={grid['score']} by {grid['author']} "
                f"notes={grid['notes']!r}"
            )
        save_json(CANDIDATES_CACHE, cache)


def chosen_entries() -> dict[str, dict[str, Any]]:
    """Resolve CHOSEN_GRIDS against the cached SteamGridDB candidates."""
    cache = load_json(CANDIDATES_CACHE)
    directus = DirectusClient.from_config()
    members = {
        row["id"]: row
        for row in directus.get(
            "/items/game_bundle_members",
            {"limit": -1, "fields": "id,slug,title,cover_image,games_id.slug"},
        )["data"]
    }
    entries: dict[str, dict[str, Any]] = {}
    for member_id, grid_id in CHOSEN_GRIDS.items():
        game_id = str(SGDB_GAME_IDS[member_id])
        grid = next(g for g in cache[game_id] if g["id"] == grid_id)
        member = members[member_id]
        entries[str(member_id)] = {
            "member_id": member_id,
            "bundle": member["games_id"]["slug"],
            "slug": member["slug"],
            "title": member["title"],
            "existing_cover_image": member["cover_image"],
            "source": f"SteamGridDB game {game_id}, grid {grid_id}",
            "url": grid["url"],
            "dimensions": f"{grid['width']}x{grid['height']}",
            "mime": grid["mime"],
            "style": grid["style"],
            "author": grid["author"],
        }
    return entries


def cmd_report() -> None:
    """Write the reviewable member -> image report (no imports)."""
    entries = chosen_entries()
    save_json(CHOICES_CACHE, entries)
    save_json(REPORT_PATH, entries)
    for entry in entries.values():
        print(
            f"{entry['member_id']:>3} {entry['title'][:46]:<46} "
            f"{entry['dimensions']:<8} {entry['source']} {entry['url']}"
        )


EXT = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}


def cmd_apply() -> None:
    """Import each chosen image into Directus and patch the member's cover."""
    entries = load_json(CHOICES_CACHE)
    if not entries:
        raise SystemExit("run `report` first")
    directus = DirectusClient.from_config()
    imported: dict[str, str] = load_json(IMPORT_CACHE)
    for key, entry in entries.items():
        if entry["existing_cover_image"]:
            print(f"skip {entry['title']}: already has a cover")
            continue
        file_id = imported.get(key)
        if not file_id:
            ext = EXT[entry["mime"]]
            time.sleep(REQUEST_DELAY_S)  # Directus fetches from SteamGridDB's CDN
            response = directus.post(
                "/files/import",
                {
                    "url": entry["url"],
                    "data": {
                        "title": f"Cover Devil May Cry Hd Collection Member {entry['slug']}".replace(
                            "-", " "
                        ).title(),
                        "filename_download": f"cover_devil_may_cry_hd_collection_member_{entry['slug']}.{ext}",
                    },
                },
            )
            file_id = response["data"]["id"]
            imported[key] = file_id
            save_json(IMPORT_CACHE, imported)
        directus.patch(
            f"/items/game_bundle_members/{entry['member_id']}", {"cover_image": file_id}
        )
        print(f"{entry['title']}: cover_image={file_id}")


def main() -> None:
    """Dispatch the requested phase."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("phase", choices=["search", "candidates", "report", "apply"])
    args = parser.parse_args()
    {
        "search": cmd_search,
        "candidates": cmd_candidates,
        "report": cmd_report,
        "apply": cmd_apply,
    }[args.phase]()


if __name__ == "__main__":
    main()
