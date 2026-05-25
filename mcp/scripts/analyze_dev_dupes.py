#!/usr/bin/env python3
"""Analyze duplicate developer entries - fetch game/link counts for each pair."""
import json, requests, sys

BASE = "https://directus.jasmer.tools"
TOKEN = "YL2PQd8E6gRa465xNhodteJqCiireffTMyMEN0o_nHU"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}

def get_games(dev_id):
    r = requests.get(f"{BASE}/items/games_developers", headers=HEADERS,
        params={"filter[developers_id][_eq]": dev_id, "fields": "id,games_id", "limit": -1})
    return r.json().get("data", [])

def get_links(dev_id):
    r = requests.get(f"{BASE}/items/developers_links", headers=HEADERS,
        params={"filter[developers_id][_eq]": dev_id, "fields": "id,url,kind", "limit": -1})
    return r.json().get("data", [])

# (id_a, name_a, id_b, name_b) - canonical ← spare intent, but check first
PAIRS = [
    (600, "Eko Software", 802, "EKO Software"),
    (25, "CD PROJEKT RED", 980, "CD Projekt RED"),
    (490, "KAIKO", 1002, "Kaiko"),
    (449, "KONAMI", 835, "Konami"),
    (26, "Eidos-Montréal", 757, "Eidos Montréal"),
    (147, "DON'T NOD", 706, "DONTNOD Entertainment"),
    (24, "Harebrained Schemes", 1121, "Harebrained"),
    (904, "Ubisoft Québec", 1122, "Ubisoft Quebec"),
    (385, "Capcom", 1156, "CAPCOM Co., Ltd."),
    (972, "Starbreeze Studios", 510, "Starbreeze Studios AB"),
    (763, "Bandai Namco Studios", 100, "Bandai Namco Studios Inc."),
    (772, "Naughty Dog", 373, "Naughty Dog LLC"),
    (982, "Armature Studio", 499, "Armature Studio, LLC"),
    (856, "Unknown Worlds Entertainment", 711, "Unknown Worlds"),
    (984, "Virtuos", 335, "Virtuos Games"),
    (781, "One Up Plus Entertainment", 253, "One Up Plus"),
    (924, "Rebellion Developments", 478, "Rebellion"),
    (738, "Blind Squirrel Entertainment", 110, "Blind Squirrel Games"),
    (748, "Aspyr Media", 626, "Aspyr Studios"),
    (922, "Deck13 Interactive", 469, "Deck 13"),
    (787, "SIE Santa Monica Studio", 790, "SCE Santa Monica Studio"),
    (746, "Dimps", 615, "Dimps Corporation"),
    (434, "BioWare", 998, "BioWare Edmonton"),
    (544, "Codemasters", 978, "Codemasters Cheshire"),
    (801, "Sega", 943, "SEGA AM1"),
    (31, "Square Enix", 988, "Square Enix Business Division 2"),
    (31, "Square Enix", 859, "Square Enix Creative Business Unit I"),
    (31, "Square Enix", 863, "Square Enix Creative Business Unit II"),
    (385, "Capcom", 911, "Capcom Development Division 2"),
    (385, "Capcom", 785, "Capcom Production Studio 1"),
    (385, "Capcom", 820, "Capcom Production Studio 4"),
    (950, "Sony XDev", 822, "SIE Japan Studio"),
    (950, "Sony XDev", 716, "SIE San Diego Studio"),
    (836, "Ratloop Asia", 671, "Ratloop Games Canada"),
]

print(f"{'ID-A':>6}  {'Name-A':<40} {'games':>5} {'links':>5}    {'ID-B':>6}  {'Name-B':<40} {'games':>5} {'links':>5}")
print("-" * 130)

for id_a, name_a, id_b, name_b in PAIRS:
    games_a = get_games(id_a)
    links_a = get_links(id_a)
    games_b = get_games(id_b)
    links_b = get_links(id_b)
    flag = " <-- spare has more!" if len(games_b) > len(games_a) else ""
    print(f"{id_a:>6}  {name_a:<40} {len(games_a):>5} {len(links_a):>5}    {id_b:>6}  {name_b:<40} {len(games_b):>5} {len(links_b):>5}{flag}")

print()
print("Done.")
