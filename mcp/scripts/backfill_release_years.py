#!/usr/bin/env python3
"""
backfill_release_years.py

Fills in missing release_year for games in Directus.

Strategy:
  - Steam games: Steam Store appdetails API (exact release date)
  - GOG/Epic/other: IGDB search by title (first_release_date field)

Results are cached to mcp/cache/release_year_cache.json for resume.

Usage:
  python3 backfill_release_years.py          # dry run
  python3 backfill_release_years.py --apply  # commit to Directus
"""

import argparse
import json
import sys
import time
import urllib.request
from datetime import datetime, timezone

from scriptlib import (
    CACHE_DIR,
    DirectusClient,
    RetryPolicy,
    fetch_with_backoff,
    server_env,
)
from steamlib import extract_release_year, extract_steam_appid

# ── Config ────────────────────────────────────────────────────────────────────
CACHE_FILE = CACHE_DIR / "release_year_cache.json"

DIRECTUS = DirectusClient.from_config()
GAME_API_ENV = server_env("game-encyclopedia")
TWITCH_CLIENT_ID = GAME_API_ENV["TWITCH_CLIENT_ID"]
TWITCH_CLIENT_SECRET = GAME_API_ENV["TWITCH_CLIENT_SECRET"]

# ── Steam Store API ───────────────────────────────────────────────────────────


def steam_release_year(appid: int) -> int | None:
    """Fetch a game's release year from Steam."""
    url = (
        f"https://store.steampowered.com/api/appdetails"
        f"?appids={appid}&filters=release_date&cc=us&l=en"
    )
    data, err = fetch_with_backoff(
        url,
        headers={"User-Agent": "Mozilla/5.0"},
        retry=RetryPolicy(rate_limit_codes=(403, 429)),
    )
    if data is None:
        print(f"  Steam error for appid {appid}: {err}", file=sys.stderr)
        return None
    entry = data.get(str(appid), {})
    if not entry.get("success"):
        return None
    release_date = entry.get("data", {}).get("release_date", {})
    date_str = release_date.get("date", "")
    if not date_str or release_date.get("coming_soon"):
        return None
    return extract_release_year(date_str)


# ── IGDB ──────────────────────────────────────────────────────────────────────


def get_igdb_token() -> str:
    """Request an application access token for IGDB."""
    url = (
        f"https://id.twitch.tv/oauth2/token"
        f"?client_id={TWITCH_CLIENT_ID}"
        f"&client_secret={TWITCH_CLIENT_SECRET}"
        f"&grant_type=client_credentials"
    )
    req = urllib.request.Request(url, method="POST")
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())["access_token"]


def igdb_post(token: str, body: str) -> list:
    """Submit an IGDB query with retry handling."""
    results, err = fetch_with_backoff(
        "https://api.igdb.com/v4/games",
        data=body.encode(),
        headers={
            "Client-ID": TWITCH_CLIENT_ID,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        },
        method="POST",
        retry=RetryPolicy(rate_limit_codes=(429,)),
    )
    if results is None:
        print(f"  IGDB error: {err}", file=sys.stderr)
        return []
    return results


def igdb_release_year(token: str, title: str) -> tuple[int | None, str | None]:
    """Return (year, matched_title) or (None, None)."""
    safe = title.replace('"', '\\"')
    results = igdb_post(
        token,
        f'fields name,first_release_date; search "{safe}"; where first_release_date != null; limit 10;',
    )
    if not results:
        return None, None
    title_lower = title.lower()
    exact = next((r for r in results if r.get("name", "").lower() == title_lower), None)
    best = exact or results[0]
    ts = best.get("first_release_date")
    if not ts:
        return None, None
    year = datetime.fromtimestamp(ts, tz=timezone.utc).year
    return year, best.get("name")


# ── Main ──────────────────────────────────────────────────────────────────────


def classify(game):
    """Classify a game as Steam-backed or another source."""
    links = game.get("links") or []
    urls = [
        link["url"]
        for link in links
        if link.get("kind") == "download" and link.get("url")
    ]
    for url in urls:
        appid = extract_steam_appid(url)
        if appid:
            return "steam", appid
    return "other", None


def main():
    """Backfill missing release years from Steam and IGDB."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    # Load cache
    CACHE_DIR.mkdir(exist_ok=True)
    cache: dict = {}
    if CACHE_FILE.exists():
        cache = json.loads(CACHE_FILE.read_text())
    print(f"Loaded {len(cache)} cached results", file=sys.stderr)

    # Fetch games missing release_year
    print("Fetching games with no release_year...", file=sys.stderr)
    games = DIRECTUS.fetch_all(
        "/items/games?fields=id,title,release_year,links.*"
        "&filter%5Brelease_year%5D%5B_null%5D=true&sort=title"
    )
    print(f"  {len(games)} games missing release_year", file=sys.stderr)

    # Split steam vs other
    steam_games = []
    other_games = []
    for g in games:
        src, appid = classify(g)
        if src == "steam":
            steam_games.append((g, appid))
        else:
            other_games.append(g)

    # IGDB token (only if needed)
    igdb_token = None
    needs_igdb = any(str(g["id"]) not in cache for g in other_games)
    if needs_igdb:
        print("Getting IGDB token...", file=sys.stderr)
        igdb_token = get_igdb_token()

    found = skipped = errors = applied = 0

    # ── Steam games ───────────────────────────────────────────────────────────
    print(f"\n── Steam ({len(steam_games)} games) ──", file=sys.stderr)
    for game, appid in steam_games:
        gid = str(game["id"])
        print(f"  [{game['id']}] {game['title']}", file=sys.stderr)

        if gid in cache:
            year = cache[gid]["year"]
        else:
            time.sleep(1.5)
            year = steam_release_year(appid)
            cache[gid] = {"year": year, "source": "steam", "appid": appid}
            CACHE_FILE.write_text(json.dumps(cache, indent=2))

        if year:
            print(f"    year={year}", file=sys.stderr)
            found += 1
            if args.apply:
                DIRECTUS.patch(f"/items/games/{game['id']}", {"release_year": year})
                applied += 1
        else:
            print("    no year found", file=sys.stderr)
            skipped += 1

    # ── IGDB games ────────────────────────────────────────────────────────────
    print(f"\n── IGDB ({len(other_games)} games) ──", file=sys.stderr)
    for game in other_games:
        gid = str(game["id"])
        print(f"  [{game['id']}] {game['title']}", file=sys.stderr)

        if gid in cache:
            year = cache[gid]["year"]
            matched = cache[gid].get("matched")
        else:
            time.sleep(1.0)
            if igdb_token is None:
                raise RuntimeError("IGDB token was not initialized")
            year, matched = igdb_release_year(igdb_token, game["title"])
            cache[gid] = {"year": year, "matched": matched, "source": "igdb"}
            CACHE_FILE.write_text(json.dumps(cache, indent=2))

        if year:
            note = (
                f' (matched "{matched}")'
                if matched and matched.lower() != game["title"].lower()
                else ""
            )
            print(f"    year={year}{note}", file=sys.stderr)
            found += 1
            if args.apply:
                DIRECTUS.patch(f"/items/games/{game['id']}", {"release_year": year})
                applied += 1
        else:
            print("    no year found", file=sys.stderr)
            skipped += 1

    print(
        f"\nDone: {found} years found, {skipped} not found, {errors} errors",
        file=sys.stderr,
    )
    if args.apply:
        print(f"Applied {applied} updates to Directus", file=sys.stderr)
    else:
        print("Run with --apply to commit.", file=sys.stderr)


if __name__ == "__main__":
    main()
