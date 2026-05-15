#!/usr/bin/env python3
"""
Populate the ~Completed Games tier list with all games where player_status = completed.

Rules:
  - If the game is already in the completed tier list: skip (preserve manual ratings).
  - If new and has a non-U rating in any other published tier list: copy the highest such rating.
  - If new and no other tier rating: add to U row.

Usage:
    python3 populate_completed_tier_list.py [--dry-run]
"""

import argparse
import json
import sys
import urllib.request
from pathlib import Path

DIRECTUS_URL = "https://directus.jasmer.tools"
DIRECTUS_TOKEN = json.load(open(Path(__file__).parent.parent.parent / ".mcp.json"))["mcpServers"]["directus"]["env"]["DIRECTUS_TOKEN"]

COMPLETED_TIER_LIST_ID = 10
COMPLETED_ROW_IDS = {"S": 57, "A": 58, "B": 59, "C": 60, "D": 61, "F": 62, "U": 63}

TIER_RANK = {"S": 0, "A": 1, "B": 2, "C": 3, "D": 4, "F": 5, "U": 6}


def directus_get(path: str) -> dict:
    req = urllib.request.Request(f"{DIRECTUS_URL}{path}", headers={
        "Authorization": f"Bearer {DIRECTUS_TOKEN}", "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def directus_post(path: str, body: dict) -> dict:
    data = json.dumps(body).encode()
    req = urllib.request.Request(f"{DIRECTUS_URL}{path}", data=data, method="POST", headers={
        "Authorization": f"Bearer {DIRECTUS_TOKEN}",
        "Content-Type": "application/json", "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def fetch_all(path: str, page_size: int = 500) -> list:
    results = []
    offset = 0
    while True:
        sep = "&" if "?" in path else "?"
        data = directus_get(f"{path}{sep}limit={page_size}&offset={offset}")
        batch = data.get("data", [])
        results.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    # Fetch all completed games
    print("Fetching completed games...", file=sys.stderr)
    completed_games = fetch_all(
        "/items/games?fields=id,title&filter%5Bplayer_status%5D%5B_eq%5D=completed&sort=title"
    )
    print(f"  {len(completed_games)} completed games", file=sys.stderr)

    # Fetch games already in the completed tier list
    print("Fetching existing completed tier list entries...", file=sys.stderr)
    already_in: set[int] = set()
    for row_id in COMPLETED_ROW_IDS.values():
        entries = fetch_all(f"/items/tier_row_games?fields=game_id&filter%5Btier_row_id%5D%5B_eq%5D={row_id}")
        for e in entries:
            if e.get("game_id"):
                already_in.add(e["game_id"])
    print(f"  {len(already_in)} games already in completed tier list", file=sys.stderr)

    new_games = [g for g in completed_games if g["id"] not in already_in]
    print(f"  {len(new_games)} games to add", file=sys.stderr)
    if not new_games:
        print("Nothing to do.", file=sys.stderr)
        return

    # Fetch all tier rows across all OTHER published tier lists (excluding completed list)
    print("Fetching all tier rows from other lists...", file=sys.stderr)
    published_tl_ids = {
        tl["id"] for tl in fetch_all("/items/tier_lists?fields=id&filter%5Bstatus%5D%5B_eq%5D=published")
    } - {COMPLETED_TIER_LIST_ID}
    all_rows = fetch_all("/items/tier_rows?fields=id,label,tier_list")
    non_u_row_ids = {
        r["id"]: r["label"]
        for r in all_rows
        if r["label"] != "U" and r["tier_list"] in published_tl_ids
    }

    # Build game_id → best label from other lists
    print("Fetching tier_row_games for other lists...", file=sys.stderr)
    new_game_ids = {g["id"] for g in new_games}
    game_best_label: dict[int, str] = {}

    for row_id, label in non_u_row_ids.items():
        entries = fetch_all(f"/items/tier_row_games?fields=game_id&filter%5Btier_row_id%5D%5B_eq%5D={row_id}")
        for e in entries:
            gid = e.get("game_id")
            if gid in new_game_ids:
                current = game_best_label.get(gid)
                if current is None or TIER_RANK[label] < TIER_RANK[current]:
                    game_best_label[gid] = label

    # Summarise
    rated = {gid: lbl for gid, lbl in game_best_label.items()}
    unrated = [g for g in new_games if g["id"] not in rated]
    print(f"  {len(rated)} games have an existing rating to copy", file=sys.stderr)
    print(f"  {len(unrated)} games have no rating → U row", file=sys.stderr)

    added = 0
    errors = 0
    id_to_title = {g["id"]: g["title"] for g in new_games}

    for game in new_games:
        gid = game["id"]
        label = rated.get(gid, "U")
        row_id = COMPLETED_ROW_IDS[label]
        if args.dry_run:
            print(f"  [{label}] {game['title']}", file=sys.stderr)
        else:
            try:
                directus_post("/items/tier_row_games", {"tier_row_id": row_id, "game_id": gid})
                print(f"  [{label}] {game['title']}", file=sys.stderr)
                added += 1
            except Exception as e:
                print(f"  ERROR {game['title']}: {e}", file=sys.stderr)
                errors += 1

    if args.dry_run:
        print(f"\n[DRY RUN] Would add {len(new_games)} games", file=sys.stderr)
    else:
        print(f"\nDone: {added} added, {errors} errors", file=sys.stderr)


if __name__ == "__main__":
    main()
