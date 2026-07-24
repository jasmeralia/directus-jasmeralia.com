#!/usr/bin/env python3
"""
Phase 2: Enrich PSN/Xbox candidates with metadata from IGDB and SteamGridDB.

Input:  cache/psn_xbox_candidates.json
Output: cache/psn_xbox_enriched.json
        cache/psn_xbox_no_metadata.json

Credentials from .mcp.json:
  TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET → IGDB via Twitch OAuth
  STEAMGRIDDB_API_KEY
"""

import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path

from scriptlib import RetryPolicy, fetch_with_backoff


# Load credentials from .mcp.json
def load_credentials() -> dict:
    """Load API credentials from the repository MCP configuration."""
    with open(Path(__file__).parent.parent.parent / ".mcp.json", encoding="utf-8") as f:
        mcp = json.load(f)
    env = mcp["mcpServers"]["game-encyclopedia"]["env"]
    return {
        "twitch_client_id": env["TWITCH_CLIENT_ID"],
        "twitch_client_secret": env["TWITCH_CLIENT_SECRET"],
        "steamgriddb_key": env["STEAMGRIDDB_API_KEY"],
    }


def get_twitch_token(client_id: str, client_secret: str) -> str:
    """Request a Twitch application token for IGDB access."""
    url = (
        f"https://id.twitch.tv/oauth2/token"
        f"?client_id={client_id}&client_secret={client_secret}&grant_type=client_credentials"
    )
    req = urllib.request.Request(url, method="POST")
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())
    return data["access_token"]


def igdb_search(title: str, client_id: str, token: str) -> dict | None:
    """Search IGDB for a game, return best-match metadata dict or None."""
    # Platform IDs: PS4=48, PS5=167, Xbox One=49, Xbox Series=169, PC=6
    query = (
        f'search "{title}"; '
        f"fields name,first_release_date,genres.name,"
        f"involved_companies.company.name,involved_companies.developer,cover.url; "
        f"where platforms = (48,167,49,169,6); limit 5;"
    )
    results, err = fetch_with_backoff(
        "https://api.igdb.com/v4/games",
        data=query.encode(),
        headers={
            "Client-ID": client_id,
            "Authorization": f"Bearer {token}",
            "Content-Type": "text/plain",
        },
        method="POST",
        retry=RetryPolicy(rate_limit_codes=(429,)),
    )
    if results is None:
        print(f"  IGDB error for {title!r}: {err}", file=sys.stderr)
        return None

    if not results:
        return None

    # Pick best match by title similarity
    t_norm = title.lower()
    best = max(
        results, key=lambda r: SequenceMatcher(None, t_norm, r["name"].lower()).ratio()
    )
    score = SequenceMatcher(None, t_norm, best["name"].lower()).ratio()
    if score < 0.60:
        return None

    # Extract release year from Unix timestamp
    release_year = None
    if best.get("first_release_date"):
        release_year = datetime.fromtimestamp(
            best["first_release_date"], tz=timezone.utc
        ).year

    genres = [g["name"] for g in best.get("genres", [])]

    developers = [
        ic["company"]["name"]
        for ic in best.get("involved_companies", [])
        if ic.get("developer") and ic.get("company")
    ]

    # Upgrade cover URL from thumbnail to cover_big
    cover_url = None
    if best.get("cover", {}).get("url"):
        cover_url = best["cover"]["url"].replace("t_thumb", "t_cover_big")
        if cover_url.startswith("//"):
            cover_url = "https:" + cover_url

    return {
        "igdb_id": best.get("id"),
        "igdb_name": best["name"],
        "release_year": release_year,
        "genres": genres,
        "developers": developers,
        "cover_art_url": cover_url,
        "cover_art_source": "igdb" if cover_url else None,
    }


SGDB_STATE = {"disabled": False, "consecutive_403s": 0}
_SGDB_403_LIMIT = 20


def _sgdb_request(url: str, api_key: str, title: str) -> dict | None:
    """Make a single SteamGridDB request with exponential backoff on 429/503."""
    payload, err = fetch_with_backoff(
        url,
        headers={"Authorization": f"Bearer {api_key}"},
        retry=RetryPolicy(rate_limit_codes=(429, 503)),
    )
    if payload is not None:
        SGDB_STATE["consecutive_403s"] = 0
        return payload
    if err == "http_403":
        SGDB_STATE["consecutive_403s"] += 1
        if SGDB_STATE["consecutive_403s"] >= _SGDB_403_LIMIT:
            print(
                "  SteamGridDB: 3 consecutive 403s - disabling for this run (check API key)",
                file=sys.stderr,
            )
            SGDB_STATE["disabled"] = True
        return None
    print(f"  SteamGridDB error for {title!r}: {err}", file=sys.stderr)
    return None


def steamgriddb_search(title: str, api_key: str) -> str | None:
    """Search SteamGridDB for a portrait grid image, return URL or None.
    Disables itself after 3 consecutive 403s to avoid spamming errors."""
    if SGDB_STATE["disabled"]:
        return None

    encoded = urllib.parse.quote(title)
    results = _sgdb_request(
        f"https://www.steamgriddb.com/api/v2/search/autocomplete/{encoded}",
        api_key,
        title,
    )
    if not results or not results.get("data"):
        return None

    game_id = results["data"][0]["id"]
    grids = _sgdb_request(
        f"https://www.steamgriddb.com/api/v2/grids/game/{game_id}?dimensions=600x900",
        api_key,
        title,
    )
    if not grids:
        return None

    images = grids.get("data", [])
    if not images:
        return None

    # Prefer style=alternate, else take first
    alt = [img for img in images if img.get("style") == "alternate"]
    chosen = (alt or images)[0]
    return chosen.get("url")


def main():
    """Enrich cached PlayStation and Xbox games with metadata."""
    cache = Path(__file__).parent.parent / "cache"
    cache.mkdir(exist_ok=True)

    candidates_path = cache / "psn_xbox_candidates.json"
    if not candidates_path.exists():
        print(
            "ERROR: cache/psn_xbox_candidates.json not found — run prepare_psn_xbox.py first",
            file=sys.stderr,
        )
        sys.exit(1)

    print("Loading credentials...")
    creds = load_credentials()

    print("Authenticating with Twitch/IGDB...")
    token = get_twitch_token(creds["twitch_client_id"], creds["twitch_client_secret"])
    print("  Token obtained.")

    print("Loading candidates...")
    with open(candidates_path, encoding="utf-8") as f:
        candidates = json.load(f)
    candidates = [c for c in candidates if c["status"] == "candidate"]
    print(f"  {len(candidates)} candidates to enrich")

    # Load existing enriched output for resumability
    enriched_path = cache / "psn_xbox_enriched.json"
    enriched: list[dict] = []
    already_done: set[str] = set()
    if enriched_path.exists():
        with open(enriched_path, encoding="utf-8") as f:
            enriched = json.load(f)
        already_done = {e["title"] for e in enriched}
        print(f"  Resuming: {len(already_done)} already enriched")

    no_metadata: list[dict] = []

    for i, c in enumerate(candidates):
        title = c["title"]
        if title in already_done:
            continue

        print(f"[{i + 1}/{len(candidates)}] {title!r}")

        # IGDB
        time.sleep(1.0)
        igdb = igdb_search(title, creds["twitch_client_id"], token)

        if igdb:
            print(
                f"  IGDB: {igdb['igdb_name']!r} ({igdb['release_year']}) genres={igdb['genres']}"
            )
        else:
            print("  IGDB: no match")

        # SteamGridDB (overrides IGDB cover if found)
        time.sleep(0.5)
        sgdb_url = steamgriddb_search(title, creds["steamgriddb_key"])
        if sgdb_url:
            print("  SteamGridDB: cover found")
        else:
            print("  SteamGridDB: no cover")

        entry = {
            "title": title,
            "platform": c["platform"],
            "playtime": c.get("playtime", 0),
            "steam_appid": c.get("steam_appid"),
            "download_url": c.get("download_url"),
            "release_year": igdb["release_year"] if igdb else None,
            "genres": igdb["genres"] if igdb else [],
            "developers": igdb["developers"] if igdb else [],
            "cover_art_url": sgdb_url or (igdb["cover_art_url"] if igdb else None),
            "cover_art_source": "steamgriddb"
            if sgdb_url
            else (igdb["cover_art_source"] if igdb else None),
            "igdb_id": igdb["igdb_id"] if igdb else None,
        }

        enriched.append(entry)
        already_done.add(title)

        if not igdb and not sgdb_url:
            no_metadata.append({"title": title, "platform": c["platform"]})

        # Flush every 10 items
        if len(enriched) % 10 == 0:
            with open(enriched_path, "w", encoding="utf-8") as f:
                json.dump(enriched, f, indent=2)

    # Final write
    with open(enriched_path, "w", encoding="utf-8") as f:
        json.dump(enriched, f, indent=2)
    print(f"\nWrote {len(enriched)} enriched entries → {enriched_path}")

    with open(cache / "psn_xbox_no_metadata.json", "w", encoding="utf-8") as f:
        json.dump(no_metadata, f, indent=2)
    print(
        f"Wrote {len(no_metadata)} no-metadata entries → cache/psn_xbox_no_metadata.json"
    )


if __name__ == "__main__":
    main()
