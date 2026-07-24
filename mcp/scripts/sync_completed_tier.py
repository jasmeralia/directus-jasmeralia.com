#!/usr/bin/env python3
"""
Sync the ~Completed Games tier list.

Finds all games with player_status=completed that are missing from the
~Completed Games tier list, inherits their rank label from other tier lists
if present, and places them in U otherwise.

Usage:
    python3 sync_completed_tier.py           # dry run (show what would be added)
    python3 sync_completed_tier.py --apply   # apply changes and trigger rebuild
"""

import argparse
import json
import sys
import urllib.request

import psycopg2
from scriptlib import server_env

DIRECTUS_ENV = server_env("directus")
DIRECTUS_URL = DIRECTUS_ENV["DIRECTUS_URL"].rstrip("/")
DIRECTUS_TOKEN = DIRECTUS_ENV["DIRECTUS_TOKEN"]
DATABASE_URL = DIRECTUS_ENV["DATABASE_URL"]
REBUILD_FLOW_URL = f"{DIRECTUS_URL}/flows/trigger/e3aa03ad-3352-4ade-8156-22d53f107907"

COMPLETED_TIER_LIST_ID = 10  # ~Completed Games


def directus_post(path: str, body: dict) -> dict:
    """Create a Directus resource."""
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{DIRECTUS_URL}{path}",
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {DIRECTUS_TOKEN}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def trigger_rebuild():
    """Trigger the Directus site-rebuild flow."""
    data = json.dumps(
        {"collection": "tier_lists", "keys": [str(COMPLETED_TIER_LIST_ID)]}
    ).encode()
    req = urllib.request.Request(
        REBUILD_FLOW_URL,
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {DIRECTUS_TOKEN}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status


def main():
    """Synchronize completed games into the completed tier list."""
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--apply", action="store_true", help="Apply changes and trigger rebuild"
    )
    args = parser.parse_args()

    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    # All completed games
    cur.execute(
        "SELECT id, title FROM games WHERE player_status = 'completed' ORDER BY title"
    )
    completed_games = cur.fetchall()
    print(f"Total completed games: {len(completed_games)}", file=sys.stderr)

    # Games already in ~Completed
    cur.execute(
        "SELECT game_id FROM tier_list_games WHERE tier_list_id = %s",
        (COMPLETED_TIER_LIST_ID,),
    )
    already_in = {row[0] for row in cur.fetchall()}
    print(f"Already in ~Completed: {len(already_in)}", file=sys.stderr)

    # Missing games
    missing = [(gid, title) for gid, title in completed_games if gid not in already_in]
    print(f"Missing: {len(missing)}", file=sys.stderr)

    if not missing:
        print("Nothing to add.", file=sys.stderr)
        conn.close()
        return

    # Rating sort order for inheritance
    rating_order = ["S", "A", "B", "C", "D", "F", "U"]

    # For each missing game, inherit best rating from other tier lists (prefer non-U)
    additions = []
    for game_id, title in missing:
        cur.execute(
            """
            SELECT rating FROM tier_list_games
            WHERE game_id = %s AND tier_list_id != %s
        """,
            (game_id, COMPLETED_TIER_LIST_ID),
        )
        other_ranks = [r[0] for r in cur.fetchall()]
        other_ranks.sort(
            key=lambda rating: (
                rating_order.index(rating) if rating in rating_order else 99
            )
        )
        inherited = next((r for r in other_ranks if r != "U"), None)
        target_label = inherited if inherited else "U"
        additions.append((game_id, title, target_label))

    print("\nProposed additions:", file=sys.stderr)
    for game_id, title, label in additions:
        print(f"  [{label}] {title} (id={game_id})", file=sys.stderr)

    if not args.apply:
        print("\nDry run — pass --apply to write changes.", file=sys.stderr)
        conn.close()
        return

    conn.close()

    # Use the REST API so Directus flows fire (updates tier_lists.updated_at → feed entry)
    for game_id, title, label in additions:
        directus_post(
            "/items/tier_list_games",
            {
                "tier_list_id": COMPLETED_TIER_LIST_ID,
                "game_id": game_id,
                "rating": label,
            },
        )
        print(f"  Added [{label}] {title}", file=sys.stderr)

    print(f"\nInserted {len(additions)} games.", file=sys.stderr)

    status = trigger_rebuild()
    print(f"Rebuild triggered: HTTP {status}", file=sys.stderr)


if __name__ == "__main__":
    main()
