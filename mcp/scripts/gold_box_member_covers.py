#!/usr/bin/env python3
"""Source and assign portrait covers to the Gold Box compilation bundle members.

Phases (all external lookups are cached in mcp/cache/gold_box_covers_*.json):

    python3 gold_box_member_covers.py candidates   # query SteamGridDB, cache portrait grids
    python3 gold_box_member_covers.py report       # write reviewable report from chosen images
    python3 gold_box_member_covers.py apply        # import chosen images, patch members

The chosen image per member lives in mcp/cache/gold_box_covers_choices.json
(member id -> {"url", "source", "note"}). Reviewing and editing that file is the
manual curation step between `candidates` and `apply`.
"""

# pylint: disable=duplicate-code  # Keep each bundle-specific tool self-contained.

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
USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) jasmeralia-gold-box-covers"
REQUEST_DELAY_S = 1.1
RETRY = RetryPolicy(rate_limit_codes=(429, 403))
PORTRAIT_DIMENSIONS = "600x900,342x482,660x930"

CANDIDATES_CACHE = CACHE_DIR / "gold_box_covers_sgdb.json"
CHOICES_CACHE = CACHE_DIR / "gold_box_covers_choices.json"
REPORT_PATH = CACHE_DIR / "gold_box_covers_report.json"
IMPORT_CACHE = CACHE_DIR / "gold_box_covers_imported.json"

# Directus game_bundle_members id -> SteamGridDB game id (verified by name/year).
SGDB_GAME_IDS: dict[int, int] = {
    22: 21140,  # Champions of Krynn
    23: 34173,  # Death Knights of Krynn
    24: 35130,  # The Dark Queen of Krynn
    26: 35328,  # Eye of the Beholder II
    27: 37989,  # Eye of the Beholder III
    28: 35215,  # Pool of Radiance
    29: 37264,  # Curse of the Azure Bonds
    30: 37575,  # Hillsfar
    31: 36911,  # Secret of the Silver Blades
    32: 34499,  # Pools of Darkness
    33: 34909,  # Gateway to the Savage Frontier
    34: 38432,  # Treasures of the Savage Frontier
    35: 37473,  # Forgotten Realms: Unlimited Adventures
    36: 10185,  # Dungeon Hack
    37: 38,  # Menzoberranzan
    38: 38562,  # Dark Sun: Shattered Lands
    39: 35842,  # Dark Sun: Wake of the Ravager
    40: 1991,  # Ravenloft: Strahd's Possession
    41: 25638,  # Ravenloft: Stone Prophet
    42: 33743,  # Heroes of the Lance
    43: 36451,  # Dragons of Flame
    44: 5458784,  # War of the Lance
    45: 5266907,  # Shadow Sorcerer
}


# Directus game_bundle_members id -> chosen SteamGridDB grid id. Original SSI/TSR box art,
# one consistent author set where it exists; Heroes of the Lance uses the Silver Box
# Classic-style plate (616660) to match its three Silver Box siblings.
CHOSEN_GRIDS: dict[int, int] = {
    22: 57877, 23: 57876, 24: 57878, 26: 57888, 27: 57887, 28: 57882, 29: 57891,
    30: 57884, 31: 57880, 32: 57881, 33: 57885, 34: 57879, 35: 57886, 36: 57890,
    37: 57883, 38: 79309, 39: 79310, 40: 79301, 41: 79302, 42: 616660, 43: 616659,
    44: 616664, 45: 616663,
}  # fmt: skip


def load_json(path: Any) -> Any:
    """Load a JSON cache file, returning an empty dict when absent."""
    return json.loads(path.read_text()) if path.exists() else {}


def save_json(path: Any, data: Any) -> None:
    """Write a JSON cache file."""
    path.write_text(json.dumps(data, indent=1, ensure_ascii=True) + "\n")


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


def cmd_candidates() -> None:
    """Fetch and cache portrait grids from SteamGridDB for every member."""
    headers = {
        "Authorization": f"Bearer {server_env('game-encyclopedia')['STEAMGRIDDB_API_KEY']}",
        "User-Agent": USER_AGENT,
    }
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
                        "title": f"Cover Gold Box Member {entry['slug']}".replace(
                            "-", " "
                        ).title(),
                        "filename_download": f"cover_gold_box_member_{entry['slug']}.{ext}",
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
    parser.add_argument("phase", choices=["candidates", "report", "apply"])
    args = parser.parse_args()
    if args.phase == "candidates":
        cmd_candidates()
    elif args.phase == "report":
        cmd_report()
    else:
        cmd_apply()


if __name__ == "__main__":
    main()
