#!/usr/bin/env python3
"""
Copy all games of a genre into a tier list, adding missing ones to the U / Too Early row.

Usage:
    python3 populate_tier_list.py <genre-slug> <tier-list-slug>
    python3 populate_tier_list.py crpg crpgs
    python3 populate_tier_list.py --dry-run crpg crpgs
"""

import argparse
import json
import sys
import urllib.request
from pathlib import Path

DIRECTUS_URL = "https://directus.jasmer.tools"
DIRECTUS_TOKEN = json.load(open(Path(__file__).parent.parent.parent / ".mcp.json"))["mcpServers"]["directus"]["env"]["DIRECTUS_TOKEN"]


def directus_get(path: str) -> dict:
    url = f"{DIRECTUS_URL}{path}"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {DIRECTUS_TOKEN}",
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def directus_post(path: str, body: dict) -> dict:
    url = f"{DIRECTUS_URL}{path}"
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="POST", headers={
        "Authorization": f"Bearer {DIRECTUS_TOKEN}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def fetch_all(path_template: str, page_size: int = 500) -> list:
    results = []
    offset = 0
    while True:
        sep = "&" if "?" in path_template else "?"
        data = directus_get(f"{path_template}{sep}limit={page_size}&offset={offset}")
        batch = data.get("data", [])
        results.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("genre_slug", help="Genre slug (e.g. crpg)")
    parser.add_argument("tier_list_slug", help="Tier list slug (e.g. crpgs)")
    parser.add_argument("--dry-run", action="store_true", help="Print what would be added without writing")
    args = parser.parse_args()

    # Resolve genre slug → id
    print(f"Looking up genre '{args.genre_slug}'...", file=sys.stderr)
    genre_data = directus_get(f"/items/genres?fields=id,slug,name&filter%5Bslug%5D%5B_eq%5D={args.genre_slug}&limit=1")
    genres = genre_data.get("data", [])
    if not genres:
        print(f"ERROR: genre slug '{args.genre_slug}' not found", file=sys.stderr)
        sys.exit(1)
    genre = genres[0]
    print(f"  Genre: {genre['name']} (id={genre['id']})", file=sys.stderr)

    # Resolve tier list slug → id
    print(f"Looking up tier list '{args.tier_list_slug}'...", file=sys.stderr)
    tl_data = directus_get(f"/items/tier_lists?fields=id,slug,title&filter%5Bslug%5D%5B_eq%5D={args.tier_list_slug}&limit=1")
    tier_lists = tl_data.get("data", [])
    if not tier_lists:
        print(f"ERROR: tier list slug '{args.tier_list_slug}' not found", file=sys.stderr)
        sys.exit(1)
    tier_list = tier_lists[0]
    print(f"  Tier list: {tier_list['title']} (id={tier_list['id']})", file=sys.stderr)

    # Get tier rows for this list
    print("Fetching tier rows...", file=sys.stderr)
    rows = fetch_all(f"/items/tier_rows?fields=id,label,sort&filter%5Btier_list%5D%5B_eq%5D={tier_list['id']}&sort=sort")
    if not rows:
        print("ERROR: No tier rows found for this tier list", file=sys.stderr)
        sys.exit(1)

    u_row = next((r for r in rows if r["label"] == "U"), None)
    if u_row is None:
        print("ERROR: No 'U' row found in tier list", file=sys.stderr)
        print("Available rows:", [r["label"] for r in rows], file=sys.stderr)
        sys.exit(1)
    print(f"  U row id={u_row['id']}", file=sys.stderr)

    # Get all game_ids already in this tier list
    print("Fetching existing tier list game assignments...", file=sys.stderr)
    row_ids = [r["id"] for r in rows]
    # Query tier_row_games for all rows in this list
    existing_game_ids: set[int] = set()
    for row_id in row_ids:
        entries = fetch_all(f"/items/tier_row_games?fields=game_id&filter%5Btier_row_id%5D%5B_eq%5D={row_id}")
        for e in entries:
            if e.get("game_id"):
                existing_game_ids.add(e["game_id"])
    print(f"  {len(existing_game_ids)} games already in tier list", file=sys.stderr)

    # Get all games with this genre
    print(f"Fetching all games with genre '{args.genre_slug}'...", file=sys.stderr)
    # games_genres junction → get game ids for this genre
    junction_entries = fetch_all(f"/items/games_genres?fields=games_id&filter%5Bgenres_id%5D%5B_eq%5D={genre['id']}")
    genre_game_ids = {e["games_id"] for e in junction_entries if e.get("games_id")}
    print(f"  {len(genre_game_ids)} games have genre '{args.genre_slug}'", file=sys.stderr)

    # Find games missing from tier list
    missing_ids = sorted(genre_game_ids - existing_game_ids)
    print(f"  {len(missing_ids)} games to add to U row", file=sys.stderr)

    if not missing_ids:
        print("Nothing to do — all genre games are already in the tier list.", file=sys.stderr)
        return

    # Fetch titles for reporting
    id_list = ",".join(str(i) for i in missing_ids)
    games_data = directus_get(f"/items/games?fields=id,title&filter%5Bid%5D%5B_in%5D={id_list}&limit=-1")
    id_to_title = {g["id"]: g["title"] for g in games_data.get("data", [])}

    print(f"\n{'[DRY RUN] ' if args.dry_run else ''}Adding {len(missing_ids)} games to U row:", file=sys.stderr)
    added = 0
    errors = 0
    for game_id in missing_ids:
        title = id_to_title.get(game_id, f"(id={game_id})")
        if args.dry_run:
            print(f"  + {title}", file=sys.stderr)
        else:
            try:
                directus_post("/items/tier_row_games", {"tier_row_id": u_row["id"], "game_id": game_id})
                print(f"  + {title}", file=sys.stderr)
                added += 1
            except Exception as e:
                print(f"  ERROR {title}: {e}", file=sys.stderr)
                errors += 1

    if args.dry_run:
        print(f"\n[DRY RUN] Would add {len(missing_ids)} games", file=sys.stderr)
    else:
        print(f"\nDone: {added} added, {errors} errors", file=sys.stderr)


if __name__ == "__main__":
    main()
