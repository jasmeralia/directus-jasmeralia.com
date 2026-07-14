#!/usr/bin/env python3
"""Analyze duplicate developer entries - fetch game/link counts for each pair."""

import requests

from developer_merge_data import (
    APPROVED_DEVELOPER_MERGES,
    CANDIDATE_DEVELOPER_MERGES,
)
from scriptlib import server_env

DIRECTUS_ENV = server_env("directus")
BASE = DIRECTUS_ENV["DIRECTUS_URL"].rstrip("/")
TOKEN = DIRECTUS_ENV["DIRECTUS_TOKEN"]
HEADERS = {"Authorization": f"Bearer {TOKEN}"}


def get_games(dev_id):
    """Fetch games associated with a developer."""
    r = requests.get(
        f"{BASE}/items/games_developers",
        headers=HEADERS,
        params={
            "filter[developers_id][_eq]": dev_id,
            "fields": "id,games_id",
            "limit": -1,
        },
        timeout=30,
    )
    return r.json().get("data", [])


def get_links(dev_id):
    """Fetch links associated with a developer."""
    r = requests.get(
        f"{BASE}/items/developers_links",
        headers=HEADERS,
        params={
            "filter[developers_id][_eq]": dev_id,
            "fields": "id,url,kind",
            "limit": -1,
        },
        timeout=30,
    )
    return r.json().get("data", [])


# (id_a, name_a, id_b, name_b) - canonical ← spare intent, but check first
PAIRS = APPROVED_DEVELOPER_MERGES + CANDIDATE_DEVELOPER_MERGES

print(
    f"{'ID-A':>6}  {'Name-A':<40} {'games':>5} {'links':>5}    {'ID-B':>6}  {'Name-B':<40} {'games':>5} {'links':>5}"
)
print("-" * 130)

for id_a, name_a, id_b, name_b in PAIRS:
    games_a = get_games(id_a)
    links_a = get_links(id_a)
    games_b = get_games(id_b)
    links_b = get_links(id_b)
    flag = " <-- spare has more!" if len(games_b) > len(games_a) else ""
    print(
        f"{id_a:>6}  {name_a:<40} {len(games_a):>5} {len(links_a):>5}    {id_b:>6}  {name_b:<40} {len(games_b):>5} {len(links_b):>5}{flag}"
    )

print()
print("Done.")
