#!/usr/bin/env python3
"""
Show all PSN/Xbox candidates sorted by playtime descending.
Playtime is in seconds; displayed as hours:minutes.
"""

import json
from pathlib import Path

CACHE = Path(__file__).parent.parent / "cache"


def fmt_playtime(seconds: int) -> str:
    if seconds == 0:
        return "0:00"
    h = seconds // 3600
    m = (seconds % 3600) // 60
    return f"{h}:{m:02d}"


with open(CACHE / 'psn_xbox_candidates.json') as f:
    candidates = json.load(f)

played = sorted(candidates, key=lambda c: c['playtime'], reverse=True)

print(f"{'Playtime':>8}  {'Platform':10}  Title")
print("-" * 80)
for c in played:
    if c['playtime'] > 0:
        print(f"{fmt_playtime(c['playtime']):>8}  {c['platform']:10}  {c['title']}")

print()
print(f"--- No playtime ({sum(1 for c in played if c['playtime'] == 0)} games) ---")
for c in played:
    if c['playtime'] == 0:
        print(f"{'0:00':>8}  {c['platform']:10}  {c['title']}")
