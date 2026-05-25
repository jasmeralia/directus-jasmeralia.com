#!/usr/bin/env python3
"""Merge duplicate developer entries into canonical ones.
For each pair: reparent games_developers, reparent developers_links, delete spare.
"""
import json, requests, sys

BASE = "https://directus.jasmer.tools"
TOKEN = "YL2PQd8E6gRa465xNhodteJqCiireffTMyMEN0o_nHU"
HEADERS = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}

def fetch(path, params=None):
    r = requests.get(f"{BASE}{path}", headers=HEADERS, params=params)
    r.raise_for_status()
    return r.json().get("data", [])

def patch(path, payload):
    r = requests.patch(f"{BASE}{path}", headers=HEADERS, json=payload)
    r.raise_for_status()
    return r.json()

def delete(path):
    r = requests.delete(f"{BASE}{path}", headers=HEADERS)
    if r.status_code not in (200, 204):
        raise Exception(f"DELETE {path} => {r.status_code}: {r.text}")

def get_gd_rows(dev_id):
    return fetch("/items/games_developers",
        params={"filter[developers_id][_eq]": dev_id, "fields": "id,games_id", "limit": -1})

def get_link_rows(dev_id):
    return fetch("/items/developers_links",
        params={"filter[developers_id][_eq]": dev_id, "fields": "id,url,kind", "limit": -1})

def merge(canonical_id, canonical_name, spare_id, spare_name, dry_run=False):
    print(f"\n  Merging '{spare_name}' ({spare_id}) → '{canonical_name}' ({canonical_id})")

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
            if not dry_run:
                delete(f"/items/games_developers/{row['id']}")
            deleted_gd += 1
        elif gid in canon_game_ids:
            print(f"    [gd] game {gid} already on canonical → delete spare gd row {row['id']}")
            if not dry_run:
                delete(f"/items/games_developers/{row['id']}")
            deleted_gd += 1
        else:
            print(f"    [gd] game {gid} → move gd row {row['id']} to canonical")
            if not dry_run:
                patch(f"/items/games_developers/{row['id']}", {"developers_id": canonical_id})
            moved_games += 1

    # --- developers_links ---
    spare_links = get_link_rows(spare_id)
    canon_links = get_link_rows(canonical_id)
    canon_urls = {l["url"] for l in canon_links}

    moved_links = 0
    deleted_links = 0
    for row in spare_links:
        if row["url"] in canon_urls:
            print(f"    [link] url {row['url']} already on canonical → delete spare link {row['id']}")
            if not dry_run:
                delete(f"/items/developers_links/{row['id']}")
            deleted_links += 1
        else:
            print(f"    [link] move link {row['id']} ({row['kind']}: {row['url']}) to canonical")
            if not dry_run:
                patch(f"/items/developers_links/{row['id']}", {"developers_id": canonical_id})
            moved_links += 1

    # --- delete spare developer ---
    print(f"    [dev] delete developer {spare_id} ('{spare_name}')")
    if not dry_run:
        delete(f"/items/developers/{spare_id}")

    print(f"    => moved {moved_games} games, deleted {deleted_gd} dupe gd rows, moved {moved_links} links, deleted {deleted_links} dupe links")

# (canonical_id, canonical_name, spare_id, spare_name)
# Canonical = the one we KEEP; spare = the one we DELETE after reparenting
MERGES = [
    # Clear name-format duplicates
    (600,  "Eko Software",                 802,  "EKO Software"),
    (25,   "CD PROJEKT RED",               980,  "CD Projekt RED"),
    (490,  "KAIKO",                        1002, "Kaiko"),
    (449,  "KONAMI",                       835,  "Konami"),
    (26,   "Eidos-Montréal",               757,  "Eidos Montréal"),
    (147,  "DON'T NOD",                    706,  "DONTNOD Entertainment"),
    (24,   "Harebrained Schemes",          1121, "Harebrained"),
    (904,  "Ubisoft Québec",               1122, "Ubisoft Quebec"),
    # Capcom family
    (385,  "Capcom",                       1156, "CAPCOM Co., Ltd."),
    (385,  "Capcom",                       911,  "Capcom Development Division 2"),
    (385,  "Capcom",                       785,  "Capcom Production Studio 1"),
    (385,  "Capcom",                       820,  "Capcom Production Studio 4"),
    # Suffix variants
    (100,  "Bandai Namco Studios Inc.",    763,  "Bandai Namco Studios"),   # 100 has more games
    (772,  "Naughty Dog",                  373,  "Naughty Dog LLC"),
    (982,  "Armature Studio",              499,  "Armature Studio, LLC"),
    (856,  "Unknown Worlds Entertainment", 711,  "Unknown Worlds"),
    (984,  "Virtuos",                      335,  "Virtuos Games"),
    (781,  "One Up Plus Entertainment",    253,  "One Up Plus"),
    (924,  "Rebellion Developments",       478,  "Rebellion"),
    (738,  "Blind Squirrel Entertainment", 110,  "Blind Squirrel Games"),
    (748,  "Aspyr Media",                  626,  "Aspyr Studios"),           # Aspyr Media is correct name
    (922,  "Deck13 Interactive",           469,  "Deck 13"),
    # SCE → SIE rebrand (2016)
    (787,  "SIE Santa Monica Studio",     790,  "SCE Santa Monica Studio"),
    # Corporation suffix
    (746,  "Dimps",                        615,  "Dimps Corporation"),
    # Parent absorbs labelled subdivision
    (434,  "BioWare",                      998,  "BioWare Edmonton"),
    (544,  "Codemasters",                  978,  "Codemasters Cheshire"),
    (801,  "Sega",                         943,  "SEGA AM1"),
    # Starbreeze
    (972,  "Starbreeze Studios",           510,  "Starbreeze Studios AB"),
    # Square Enix divisions
    (31,   "Square Enix",                  988,  "Square Enix Business Division 2"),
    (31,   "Square Enix",                  859,  "Square Enix Creative Business Unit I"),
    (31,   "Square Enix",                  863,  "Square Enix Creative Business Unit II"),
    # Ratloop
    (671,  "Ratloop Games Canada",         836,  "Ratloop Asia"),
]

dry_run = "--dry-run" in sys.argv

if dry_run:
    print("=== DRY RUN MODE ===")
else:
    print("=== LIVE MODE — executing merges ===")

print(f"Total pairs to merge: {len(MERGES)}")
print()

errors = []
for args in MERGES:
    try:
        merge(*args, dry_run=dry_run)
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
