#!/usr/bin/env python3
"""Merge duplicate developer entries into canonical ones.
For each pair: reparent games_developers, reparent developers_links, delete spare.
"""

import sys

import requests

from developer_merge_data import APPROVED_DEVELOPER_MERGES
from scriptlib import server_env, take_pg_dump_backup

DIRECTUS_ENV = server_env("directus")
BASE = DIRECTUS_ENV["DIRECTUS_URL"].rstrip("/")
TOKEN = DIRECTUS_ENV["DIRECTUS_TOKEN"]
HEADERS = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}


def fetch(path, params=None):
    """Fetch a Directus resource."""
    r = requests.get(f"{BASE}{path}", headers=HEADERS, params=params, timeout=30)
    r.raise_for_status()
    return r.json().get("data", [])


def patch(path, payload):
    """Update a Directus resource."""
    r = requests.patch(f"{BASE}{path}", headers=HEADERS, json=payload, timeout=30)
    r.raise_for_status()
    return r.json()


def delete(path):
    """Delete a Directus resource."""
    r = requests.delete(f"{BASE}{path}", headers=HEADERS, timeout=30)
    if r.status_code not in (200, 204):
        raise RuntimeError(f"DELETE {path} => {r.status_code}: {r.text}")


def get_gd_rows(dev_id):
    """Fetch game junction rows for a developer."""
    return fetch(
        "/items/games_developers",
        params={
            "filter[developers_id][_eq]": dev_id,
            "fields": "id,games_id",
            "limit": -1,
        },
    )


def get_link_rows(dev_id):
    """Fetch link rows for a developer."""
    return fetch(
        "/items/developers_links",
        params={
            "filter[developers_id][_eq]": dev_id,
            "fields": "id,url,kind",
            "limit": -1,
        },
    )


def merge(canonical_id, canonical_name, spare_id, spare_name, is_dry_run=False):
    """Merge one duplicate developer into its canonical record."""
    print(
        f"\n  Merging '{spare_name}' ({spare_id}) → '{canonical_name}' ({canonical_id})"
    )

    # --- games_developers ---
    spare_gd = get_gd_rows(spare_id)
    canon_gd = get_gd_rows(canonical_id)
    canon_game_ids = {row["games_id"] for row in canon_gd}

    moved_games = 0
    deleted_gd = 0
    for row in spare_gd:
        gid = row["games_id"]
        if gid is None:
            print(f"    [gd] null game_id → delete orphaned gd row {row['id']}")
            if not is_dry_run:
                delete(f"/items/games_developers/{row['id']}")
            deleted_gd += 1
        elif gid in canon_game_ids:
            print(
                f"    [gd] game {gid} already on canonical → delete spare gd row {row['id']}"
            )
            if not is_dry_run:
                delete(f"/items/games_developers/{row['id']}")
            deleted_gd += 1
        else:
            print(f"    [gd] game {gid} → move gd row {row['id']} to canonical")
            if not is_dry_run:
                patch(
                    f"/items/games_developers/{row['id']}",
                    {"developers_id": canonical_id},
                )
            moved_games += 1

    # --- developers_links ---
    spare_links = get_link_rows(spare_id)
    canon_links = get_link_rows(canonical_id)
    canon_urls = {link["url"] for link in canon_links}

    moved_links = 0
    deleted_links = 0
    for row in spare_links:
        if row["url"] in canon_urls:
            print(
                f"    [link] url {row['url']} already on canonical → delete spare link {row['id']}"
            )
            if not is_dry_run:
                delete(f"/items/developers_links/{row['id']}")
            deleted_links += 1
        else:
            print(
                f"    [link] move link {row['id']} ({row['kind']}: {row['url']}) to canonical"
            )
            if not is_dry_run:
                patch(
                    f"/items/developers_links/{row['id']}",
                    {"developers_id": canonical_id},
                )
            moved_links += 1

    # --- delete spare developer ---
    print(f"    [dev] delete developer {spare_id} ('{spare_name}')")
    if not is_dry_run:
        delete(f"/items/developers/{spare_id}")

    print(
        f"    => moved {moved_games} games, deleted {deleted_gd} dupe gd rows, moved {moved_links} links, deleted {deleted_links} dupe links"
    )


# (canonical_id, canonical_name, spare_id, spare_name)
# Canonical = the one we KEEP; spare = the one we DELETE after reparenting
MERGES = APPROVED_DEVELOPER_MERGES

dry_run = "--apply" not in sys.argv

if dry_run:
    print("=== DRY RUN MODE ===")
else:
    print("=== LIVE MODE - executing merges ===")
    take_pg_dump_backup("merge_dev_dupes")

print(f"Total pairs to merge: {len(MERGES)}")
print()

errors = []
for args in MERGES:
    try:
        merge(*args, is_dry_run=dry_run)
    except Exception as e:
        errors.append((args, str(e)))
        print(f"    ERROR: {e}")

print()
if errors:
    print(f"ERRORS ({len(errors)}):")
    for args, msg in errors:
        print(f"  {args[2]} ({args[3]}) → {args[0]}: {msg}")
else:
    print("All merges completed successfully.")
