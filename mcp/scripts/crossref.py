#!/usr/bin/env python3
"""
Cross-reference Directus games library against Steam library.

Match priority:
  1. appid extracted from Directus download_url (steam store URLs)
  2. Fuzzy title match against Steam library titles
"""

import json
import re
from pathlib import Path

CACHE = Path(__file__).parent.parent / "cache"


def normalize(title: str) -> str:
    """Lowercase, strip punctuation/articles for fuzzy comparison."""
    t = title.lower()
    t = re.sub(r"[™®:]", "", t)
    t = re.sub(r"[^a-z0-9 ]", " ", t)
    t = re.sub(r"\b(the|a|an)\b", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def extract_steam_appid(url: str | None) -> int | None:
    if not url:
        return None
    m = re.search(r"store\.steampowered\.com/app/(\d+)", url)
    return int(m.group(1)) if m else None


def fuzzy_match(needle: str, steam_by_norm: dict[str, dict]) -> dict | None:
    norm = normalize(needle)
    if norm in steam_by_norm:
        return steam_by_norm[norm]
    # Try substring containment both ways
    for steam_norm, game in steam_by_norm.items():
        if norm and steam_norm and (norm in steam_norm or steam_norm in norm):
            # Only accept if the shorter is at least 80% the length of the longer
            short, long = sorted([norm, steam_norm], key=len)
            if len(short) / len(long) >= 0.8:
                return game
    return None


def main():
    directus: list[dict] = json.loads((CACHE / "directus_games.json").read_text())
    steam: list[dict] = json.loads((CACHE / "steam_library.json").read_text())

    steam_by_appid: dict[int, dict] = {g["appid"]: g for g in steam}
    steam_by_norm: dict[str, dict] = {normalize(g["name"]): g for g in steam}

    results = []

    for dgame in directus:
        appid = extract_steam_appid(dgame.get("download_url"))
        match_method = None
        smatch = None

        if appid and appid in steam_by_appid:
            smatch = steam_by_appid[appid]
            match_method = "appid"
        elif appid:
            # URL was Steam but appid not in library
            match_method = "appid_not_owned"
        else:
            smatch = fuzzy_match(dgame["title"], steam_by_norm)
            if smatch:
                match_method = "fuzzy_title"
            else:
                match_method = "no_match"

        results.append({
            "directus_id": dgame["id"],
            "directus_title": dgame["title"],
            "directus_slug": dgame["slug"],
            "directus_player_status": dgame.get("player_status"),
            "directus_game_status": dgame.get("game_status"),
            "directus_url": dgame.get("download_url"),
            "match_method": match_method,
            "steam_appid": smatch["appid"] if smatch else appid,
            "steam_title": smatch["name"] if smatch else None,
            "steam_playtime_hours": smatch.get("playtime_forever_hours") if smatch else None,
            "steam_last_played": smatch.get("last_played_date") if smatch else None,
        })

    (CACHE / "crossref.json").write_text(json.dumps(results, indent=2))

    # Summary
    by_method: dict[str, int] = {}
    for r in results:
        by_method[r["match_method"]] = by_method.get(r["match_method"], 0) + 1

    print(f"Total Directus games: {len(results)}")
    for method, count in sorted(by_method.items()):
        print(f"  {method}: {count}")


if __name__ == "__main__":
    main()
