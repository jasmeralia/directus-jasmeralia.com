#!/usr/bin/env python3
"""
merge_edition_duplicates.py

Merges edition/variant game entries into their canonical base game:
  - Transfers unique download links from the edition to the base
  - Copies cover art to base if base has none
  - Deletes the edition record (junction rows cascade via FK)

Usage:
  python3 merge_edition_duplicates.py          # dry run
  python3 merge_edition_duplicates.py --apply  # commit
"""
import json, sys, time, urllib.request
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────
MCP_JSON = Path(__file__).parent.parent.parent / ".mcp.json"
cfg      = json.load(open(MCP_JSON))
BASE     = cfg["mcpServers"]["directus"]["env"]["DIRECTUS_URL"].rstrip("/")
TOKEN    = cfg["mcpServers"]["directus"]["env"]["DIRECTUS_TOKEN"]
DRY_RUN  = "--apply" not in sys.argv

HDR = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type":  "application/json",
    "Accept":        "application/json",
}

# ── (base_id, edition_id): edition deleted, its download links go to base ────
MERGE_PAIRS = [
    # ── Category 1: GOG/EGS edition vs. Steam/console base ───────────────────
    (119,  1917),  # Baldur's Gate                  / Baldur's Gate: Enhanced Edition
    (120,  1682),  # Baldur's Gate II               / Baldur's Gate II: Enhanced Edition
    (510,  1753),  # CONTROL                        / Control Ultimate Edition
    (87,   1829),  # Dishonored                     / Dishonored - Definitive Edition
    (146,  1693),  # Gamedec                        / Gamedec - Definitive Edition
    (288,  1659),  # Jotun                          / Jotun: Valhalla Edition
    (468,  1913),  # Middle-earth: Shadow of Mordor / …Game of the Year Edition
    (158,  1824),  # Neverwinter Nights 2           / Neverwinter Nights 2 Complete
    (1122, 1703),  # Nioh                           / Nioh: The Complete Edition
    (163,  1986),  # Pathfinder: Kingmaker          / Pathfinder Kingmaker - Enhanced Plus Edition
    (712,  1730),  # Saints Row: The Third          / Saints Row The Third Remastered
    (105,  1892),  # Shadow of the Tomb Raider      / …Definitive Edition
    (104,  1794),  # Rise of the Tomb Raider        / …20 Year Celebration
    (580,  1993),  # Styx: Shards of Darkness       / …Deluxe Edition
    (368,  2023),  # The Outer Worlds               / …Spacer's Choice Edition
    (1386, 2047),  # The Witcher 2: Assassins of Kings / …Enhanced Edition
    (179,  1800),  # Warhammer 40,000: Mechanicus   / …Standard Edition
    (129,  1680),  # BioShock                       / BioShock Remastered
    (127,  1749),  # BioShock 2                     / BioShock 2 Remastered
    (128,  1832),  # BioShock Infinite              / BioShock Infinite: Complete Edition
    (532,  590),   # Space Hulk: Deathwing          / …Enhanced Edition
    (108,  1894),  # Shadowrun: Hong Kong           / Shadowrun Hong Kong - Extended Edition
    (107,  2006),  # Shadowrun: Dragonfall          / Shadowrun: Dragonfall - Director's Cut
    # ── Category 2: mixed-platform edition pairs ──────────────────────────────
    (610,  1093),  # Alan Wake                      / Alan Wake Remastered
    (748,  569),   # Crysis                         / Crysis Remastered
    (1743, 1370),  # Death Stranding                / Death Stranding Director's Cut
    (1833, 1653),  # Grand Theft Auto V             / Grand Theft Auto V Enhanced
    # ── Category 3: same-platform duplicates ─────────────────────────────────
    (1839, 1821),  # Agony                          / Agony UNRATED
    (82,   1937),  # Batman - The Telltale Series   / Telltale Batman Season 1
    (607,  1948),  # Consortium                     / Consortium 2019 REBALANCE
    (78,   692),   # Divinity: Original Sin         / Divinity: Original Sin (Classic)
    (604,  907),   # Faerie Solitaire               / Faerie Solitaire Remastered
    (678,  844),   # Mafia II                       / Mafia II (Classic)
    (602,  1596),  # Dawn of War: Anniversary Edition (Classic) / Dawn of War: Definitive Edition
    # ── Q.U.B.E. ─────────────────────────────────────────────────────────────
    (1071, 1813),  # Q U B E: Director's Cut        / Q.U.B.E. 10th Anniversary
]


# ── HTTP helpers ──────────────────────────────────────────────────────────────

def d_get(path):
    req = urllib.request.Request(f"{BASE}{path}", headers=HDR)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def d_post(path, body):
    data = json.dumps(body).encode()
    req  = urllib.request.Request(f"{BASE}{path}", data=data, headers=HDR, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def d_patch(path, body):
    data = json.dumps(body).encode()
    req  = urllib.request.Request(f"{BASE}{path}", data=data, headers=HDR, method="PATCH")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def d_delete(path):
    req = urllib.request.Request(f"{BASE}{path}", headers=HDR, method="DELETE")
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status


def get_game(game_id):
    return d_get(
        f"/items/games/{game_id}"
        f"?fields=id,title,cover_image,links.id,links.url,links.kind,links.sort"
    )["data"]


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    mode = "DRY RUN" if DRY_RUN else "APPLY"
    print(f"[{mode}] Merging {len(MERGE_PAIRS)} edition pairs\n")

    links_added   = 0
    covers_copied = 0
    deleted       = 0
    errors        = 0

    for base_id, edition_id in MERGE_PAIRS:
        try:
            base    = get_game(base_id)
            edition = get_game(edition_id)
        except Exception as e:
            print(f"ERROR fetching {base_id}/{edition_id}: {e}")
            errors += 1
            continue

        print(f"BASE:    [{base_id}] {base['title']}")
        print(f"EDITION: [{edition_id}] {edition['title']}")

        # Transfer unique download links
        base_urls    = {l["url"] for l in (base.get("links") or []) if l.get("url")}
        edition_dl   = [l for l in (edition.get("links") or [])
                        if l.get("kind") == "download" and l.get("url")]
        new_links    = [l for l in edition_dl if l["url"] not in base_urls]

        for link in new_links:
            print(f"  + link: {link['url']}")
            if not DRY_RUN:
                d_post("/items/games_links", {
                    "games_id": base_id,
                    "url":      link["url"],
                    "kind":     "download",
                })
            links_added += 1

        if not new_links and not edition_dl:
            print("  (no download links to transfer)")
        elif not new_links:
            print("  (all edition links already present on base)")

        # Copy cover art if base has none
        if not base.get("cover_image") and edition.get("cover_image"):
            print(f"  + cover: {edition['cover_image']}")
            if not DRY_RUN:
                d_patch(f"/items/games/{base_id}", {"cover_image": edition["cover_image"]})
            covers_copied += 1

        # Delete edition (junction rows cascade via FK constraints)
        print(f"  - delete game {edition_id}")
        if not DRY_RUN:
            d_delete(f"/items/games/{edition_id}")
        deleted += 1

        print()
        time.sleep(0.15)

    print(
        f"Summary: {links_added} links transferred, "
        f"{covers_copied} covers copied, "
        f"{deleted} games deleted, "
        f"{errors} errors"
    )
    if DRY_RUN:
        print("\nRun with --apply to commit.")


if __name__ == "__main__":
    main()
