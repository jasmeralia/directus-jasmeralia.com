#!/usr/bin/env python3
"""
Sort franchise_games entries by original release year, with curated overrides
for games where the DB year reflects a later PC/remaster/GOG release rather
than the original worldwide release.  Canonical ordering (narrative order
instead of chronological) is applied for Devil May Cry.

Usage:
  python3 sort_franchise_games.py           # dry-run — shows what would change
  python3 sort_franchise_games.py --apply   # commits changes to Directus
"""

import json, sys, time, requests
from collections import defaultdict

with open('.mcp.json') as f:
    cfg = json.load(f)
env = cfg['mcpServers']['directus']['env']
BASE = env['DIRECTUS_URL'].rstrip('/')
TOKEN = env['DIRECTUS_TOKEN']
HEADERS = {'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'}

DRY_RUN = '--apply' not in sys.argv

# ---------------------------------------------------------------------------
# Year overrides: game_id -> correct original release year
# ---------------------------------------------------------------------------
YEAR_OVERRIDES = {
    # Assassin's Creed — PC/Uplay ports years in DB
    1447: 2007,  # AC1           (DB=2014)
    836:  2009,  # AC2           (DB=2010)
    924:  2012,  # AC3 Remastered(DB=2019)
    974:  2023,  # Mirage        (DB=2024)
    720:  2020,  # Valhalla      (DB=2022)

    # Borderlands
    231:  2009,  # Borderlands   (DB=2023)
    172:  2014,  # Tales from the Borderlands (DB=2021; original Telltale episodic 2014-15)

    # Darksiders
    453:  2012,  # Darksiders II (DB=2015; Deathinitive Edition)

    # Deus Ex — GOG release years in DB
    759:  2000,  # Deus Ex             (DB=2007)
    794:  2003,  # Invisible War       (DB=2007)
    573:  2011,  # Human Revolution    (DB=2013)
    633:  2013,  # The Fall            (DB=2014)

    # Devil May Cry
    1133: 2001,  # HD Collection (DB=2012; covers DMC1-3, DMC1 original 2001)
    1085: 2008,  # DMC4          (DB=2015; Special Edition)

    # Divinity — GOG release years in DB
    865:  2002,  # Divine Divinity  (DB=2012)
    867:  2004,  # Beyond Divinity  (DB=2012)

    # Doom — GOG / BFG Edition dates in DB
    92:   1994,  # DOOM II                    (DB=2007)
    140:  1997,  # DOOM 64                    (DB=2020; Nintendo Switch/PC re-release)
    91:   2004,  # DOOM 3                     (DB=2007)

    # Dragon Age
    511:  2009,  # Origins     (DB=2010)
    93:   2011,  # Dragon Age II edition (DB=2020)
    94:   2014,  # Inquisition (DB=2020)

    # Fallout — GOG release years in DB
    840:  1997,  # Fallout: A Post Nuclear RPG (DB=2015)
    821:  2008,  # Fallout 3                   (DB=2009)

    # Final Fantasy
    145:  2001,  # FFX/X-2 HD Remaster (DB=2016; original FFX 2001)

    # Forgotten Realms — Enhanced Edition / GOG / PC port dates in DB
    268:  1988,  # FR Archives - Collection One   (DB=2022; Gold Box ~1988)
    270:  1991,  # FR Archives - Collection Two   (DB=2022; ~1991)
    269:  1993,  # FR Archives - Collection Three (DB=2022; ~1993)
    119:  1998,  # Baldur's Gate      (DB=2013; Enhanced Ed)
    120:  2000,  # Baldur's Gate II   (DB=2013; Enhanced Ed)
    165:  1999,  # Planescape Torment (DB=2017; Enhanced Ed)
    155:  2000,  # Icewind Dale       (DB=2014; Enhanced Ed)
    1531: 2001,  # BG: Dark Alliance  (DB=2021; PC port)
    159:  2002,  # Neverwinter Nights 1 (DB=2018; Enhanced Ed)
    1536: 2004,  # BG: Dark Alliance II (DB=2022; PC port)
    1615: 2004,  # FR: Demon Stone      (DB=2025; PC port)
    158:  2006,  # Neverwinter Nights 2 (DB=2025; PC re-release)

    # Halo
    1394: 2001,  # Halo: CE Anniversary (DB=2011; original CE 2001)

    # Hitman — GOG / reissue dates in DB
    766:  2000,  # Codename 47   (DB=2007)
    791:  2002,  # Silent Assassin (DB=2007)
    877:  2004,  # Contracts       (DB=2014)
    792:  2006,  # Blood Money     (DB=2007)

    # Legacy of Kain — GOG release dates in DB
    870:  2001,  # Soul Reaver 2 (DB=2012)
    868:  2003,  # Defiance      (DB=2012)

    # LEGO Star Wars
    1402: 2006,  # LEGO Star Wars II (DB=2024)

    # Mass Effect
    100:  2012,  # Mass Effect 3      (DB=2020)
    101:  2017,  # Mass Effect: Andromeda (DB=2020)

    # Metal Gear
    1541: 1998,  # Master Collection (DB=2023; earliest game MGS1 was 1998)
    770:  2013,  # MGR: Revengeance   (DB=2014; PC port)

    # Oddworld — GOG / remaster dates in DB
    603:  1997,  # Abe's Oddysee    (DB=2008)
    815:  1998,  # Abe's Exoddus    (DB=2008)
    579:  2001,  # Munch's Oddysee  (DB=2010)
    816:  2005,  # Stranger's Wrath (DB=2010)
    530:  2014,  # New 'n' Tasty    (DB=2015)
    517:  2021,  # Soulstorm        (DB=2022)

    # Prince of Persia — GOG release dates in DB
    166:  2003,  # Sands of Time  (DB=2008)
    813:  2004,  # Warrior Within (DB=2008)
    814:  2005,  # The Two Thrones(DB=2008)

    # Resident Evil — HD Remaster / PC port dates in DB
    659:  1996,  # RE1 HD Remaster (DB=2015; original RE1 1996)
    555:  2002,  # RE0 HD Remaster (DB=2016; original RE0 2002)
    636:  2005,  # RE4 (2005) PC   (DB=2014)
    475:  2012,  # Revelations     (DB=2013; PC port)

    # Thief — GOG release dates in DB
    864:  2000,  # Thief II          (DB=2012)
    795:  2004,  # Deadly Shadows    (DB=2007)

    # Tomb Raider
    1036: 1996,  # TR I-III Remastered (DB=2024; covers TR1-3, originals 1996-1998)

    # Vampire: The Masquerade
    698:  2004,  # Bloodlines (DB=2007)

    # Wolfenstein
    103:  2001,  # Return to Castle Wolfenstein (DB=2007)

    # X-COM — GOG release dates in DB
    800:  1994,  # UFO Defense       (DB=2008)
    796:  1995,  # Terror From the Deep (DB=2007)
    797:  1997,  # Apocalypse        (DB=2008)
    799:  1998,  # Interceptor       (DB=2008)
    801:  2001,  # Enforcer          (DB=2008)
}

# ---------------------------------------------------------------------------
# Canonical orders: franchise_id -> [game_id, ...] in desired play order
# For series where narrative/canonical order is preferred over release date.
# ---------------------------------------------------------------------------
CANONICAL_ORDERS = {
    # Devil May Cry: main series in canonical order, DmC (alt-universe reboot) last
    # HD Collection covers DMC1/2/3 → DMC4 → DMC5 → DmC
    8: [1133, 1085, 986, 89],
}


def get_all_franchise_games():
    r = requests.get(f'{BASE}/items/franchise_games', headers=HEADERS, params={
        'limit': -1,
        'fields': 'id,sort,franchise_id,game_id.id,game_id.title,game_id.release_year',
        'sort': 'franchise_id,sort',
    })
    r.raise_for_status()
    return r.json()['data']


def get_franchise_names():
    r = requests.get(f'{BASE}/items/franchises', headers=HEADERS,
                     params={'limit': -1, 'fields': 'id,title'})
    r.raise_for_status()
    return {f['id']: f['title'] for f in r.json()['data']}


def effective_year(game_id, db_year):
    if game_id in YEAR_OVERRIDES:
        return YEAR_OVERRIDES[game_id]
    return db_year if db_year is not None else 9999


def compute_new_order(rows, franchise_id):
    if franchise_id in CANONICAL_ORDERS:
        canon = CANONICAL_ORDERS[franchise_id]
        pos = {gid: i for i, gid in enumerate(canon)}
        in_canon = sorted(
            [r for r in rows if r['game_id']['id'] in pos],
            key=lambda r: pos[r['game_id']['id']]
        )
        not_in_canon = sorted(
            [r for r in rows if r['game_id']['id'] not in pos],
            key=lambda r: (
                effective_year(r['game_id']['id'], r['game_id']['release_year']),
                r['game_id']['title'] or '',
            )
        )
        return in_canon + not_in_canon
    return sorted(rows, key=lambda r: (
        effective_year(r['game_id']['id'], r['game_id']['release_year']),
        r['game_id']['title'] or '',
    ))


def main():
    mode = 'DRY RUN' if DRY_RUN else 'APPLY'
    print(f'[{mode}] Fetching franchise data...\n')

    all_rows = get_all_franchise_games()
    franchise_names = get_franchise_names()

    # Drop junction rows with null game_id (orphaned)
    all_rows = [r for r in all_rows if r['game_id'] is not None]

    by_franchise = defaultdict(list)
    for row in all_rows:
        by_franchise[row['franchise_id']].append(row)

    updates = []  # list of (fg_id, new_sort)
    changed_franchises = 0

    for fid in sorted(by_franchise.keys()):
        rows = by_franchise[fid]
        new_order = compute_new_order(rows, fid)
        fname = franchise_names.get(fid, f'Franchise {fid}')

        franchise_updates = []
        for new_sort, row in enumerate(new_order, start=1):
            if row['sort'] != new_sort:
                yr = effective_year(row['game_id']['id'], row['game_id']['release_year'])
                franchise_updates.append({
                    'fg_id': row['id'],
                    'title': row['game_id']['title'],
                    'old_sort': row['sort'],
                    'new_sort': new_sort,
                    'year': yr,
                })
                updates.append((row['id'], new_sort))

        if franchise_updates:
            changed_franchises += 1
            print(f'{fname}:')
            for u in franchise_updates:
                print(f"  [{u['year']}] {u['title']}  ({u['old_sort']} → {u['new_sort']})")
            print()

    print(f'{"="*60}')
    print(f'Franchises with changes: {changed_franchises}')
    print(f'Records to update:       {len(updates)}')

    if DRY_RUN:
        print('\nRun with --apply to commit changes.')
        return

    print('\nApplying updates...')
    for fg_id, new_sort in updates:
        r = requests.patch(
            f'{BASE}/items/franchise_games/{fg_id}',
            headers=HEADERS,
            json={'sort': new_sort},
        )
        r.raise_for_status()
        time.sleep(0.04)

    print(f'Done. Updated {len(updates)} franchise_games records.')


if __name__ == '__main__':
    main()
