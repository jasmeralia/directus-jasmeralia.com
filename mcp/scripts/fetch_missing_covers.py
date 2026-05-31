#!/usr/bin/env python3
"""
Fetch cover art for games with no cover_image using IGDB.

For each game in Directus with cover_image = null:
  1. Search IGDB by title (prefers exact match, then first result)
  2. Download the cover at t_cover_big_2x (528x748)
  3. Upload to Directus files
  4. Patch the game record

Usage:
    python3 fetch_missing_covers.py             # dry run (preview matches)
    python3 fetch_missing_covers.py --fix       # actually upload and patch
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

MAX_RETRIES = 5
BACKOFF_BASE = 2.0

MCP = Path(__file__).parent.parent.parent / ".mcp.json"
_cfg = json.loads(MCP.read_text())
DIRECTUS_URL = "https://directus.jasmer.tools"
DIRECTUS_TOKEN = _cfg["mcpServers"]["directus"]["env"]["DIRECTUS_TOKEN"]
TWITCH_CLIENT_ID = _cfg["mcpServers"]["game-encyclopedia"]["env"]["TWITCH_CLIENT_ID"]
TWITCH_CLIENT_SECRET = _cfg["mcpServers"]["game-encyclopedia"]["env"]["TWITCH_CLIENT_SECRET"]

IGDB_COVER_URL = "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/{image_id}.jpg"

# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

def get_igdb_token() -> str:
    url = (
        f"https://id.twitch.tv/oauth2/token"
        f"?client_id={TWITCH_CLIENT_ID}"
        f"&client_secret={TWITCH_CLIENT_SECRET}"
        f"&grant_type=client_credentials"
    )
    req = urllib.request.Request(url, method="POST")
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())["access_token"]


# ---------------------------------------------------------------------------
# IGDB helpers
# ---------------------------------------------------------------------------

def igdb_post(token: str, endpoint: str, body: str) -> list:
    req = urllib.request.Request(
        f"https://api.igdb.com/v4/{endpoint}",
        data=body.encode(),
        headers={
            "Client-ID": TWITCH_CLIENT_ID,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        },
    )
    delay = BACKOFF_BASE
    for attempt in range(MAX_RETRIES):
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                print(f"  Rate limited (429), backing off {delay:.0f}s...", file=sys.stderr)
                time.sleep(delay)
                delay *= 2
            else:
                print(f"  IGDB HTTP {e.code}", file=sys.stderr)
                return []
        except Exception as e:
            print(f"  IGDB error: {e}", file=sys.stderr)
            return []
    return []


def igdb_cover(token: str, title: str) -> tuple[str | None, str | None]:
    """Return (image_id, matched_title) or (None, None)."""
    safe = title.replace('"', '\\"')
    results = igdb_post(
        token, "games",
        f'fields name,cover.image_id; search "{safe}"; where cover != null; limit 10;',
    )
    if not results:
        return None, None

    # Prefer exact title match (case-insensitive), then first result
    title_lower = title.lower()
    exact = next(
        (r for r in results if r.get("name", "").lower() == title_lower),
        None,
    )
    best = exact or results[0]
    image_id = best.get("cover", {}).get("image_id")
    return image_id, best.get("name")


# ---------------------------------------------------------------------------
# Directus helpers
# ---------------------------------------------------------------------------

def directus_get(path: str) -> dict:
    req = urllib.request.Request(
        f"{DIRECTUS_URL}{path}",
        headers={"Authorization": f"Bearer {DIRECTUS_TOKEN}", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def directus_patch(path: str, body: dict) -> dict:
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{DIRECTUS_URL}{path}", data=data, method="PATCH",
        headers={
            "Authorization": f"Bearer {DIRECTUS_TOKEN}",
            "Content-Type": "application/json", "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def upload_cover(game_id: int, img_bytes: bytes, ext: str = "jpg") -> str | None:
    boundary = "----FormBoundary7MA4YWxkTrZu0gW"
    filename = f"cover_{game_id}.{ext}"
    mime = "image/jpeg" if ext in ("jpg", "jpeg") else f"image/{ext}"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: {mime}\r\n\r\n"
    ).encode() + img_bytes + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        f"{DIRECTUS_URL}/files", data=body, method="POST",
        headers={
            "Authorization": f"Bearer {DIRECTUS_TOKEN}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())["data"]["id"]
    except Exception as e:
        print(f"    Upload error: {e}", file=sys.stderr)
        return None


def fetch_bytes(url: str) -> bytes | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.read()
    except Exception as e:
        print(f"    Fetch error: {e}", file=sys.stderr)
        return None


CACHE_DIR = Path(__file__).parent.parent / "cache"
IGDB_CACHE_FILE = CACHE_DIR / "igdb_cover_cache.json"


def load_igdb_cache() -> dict:
    if IGDB_CACHE_FILE.exists():
        return json.loads(IGDB_CACHE_FILE.read_text())
    return {}


def save_igdb_cache(cache: dict) -> None:
    CACHE_DIR.mkdir(exist_ok=True)
    IGDB_CACHE_FILE.write_text(json.dumps(cache, indent=2))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def get_missing_games() -> list[dict]:
    qs = "fields=id,title,slug&filter%5Bcover_image%5D%5B_null%5D=true&limit=-1&sort=title"
    return directus_get(f"/items/games?{qs}").get("data", [])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fix", action="store_true", help="Upload and patch (default: dry run)")
    args = parser.parse_args()

    print("Fetching games with no cover image...", file=sys.stderr)
    games = get_missing_games()
    print(f"  {len(games)} games missing covers", file=sys.stderr)

    igdb_cache = load_igdb_cache()
    cache_hits = sum(1 for g in games if str(g["id"]) in igdb_cache)
    print(f"  {cache_hits} already cached from prior IGDB lookups", file=sys.stderr)

    needs_token = any(str(g["id"]) not in igdb_cache for g in games)
    token = None
    if needs_token:
        print("Getting IGDB token...", file=sys.stderr)
        token = get_igdb_token()

    fixed = skipped = errors = 0
    for game in games:
        print(f"\n{game['title']} (id {game['id']})", file=sys.stderr)
        cache_key = str(game["id"])

        if cache_key in igdb_cache:
            image_id, matched = igdb_cache[cache_key]["image_id"], igdb_cache[cache_key]["matched"]
        else:
            time.sleep(0.26)
            image_id, matched = igdb_cover(token, game["title"])
            igdb_cache[cache_key] = {"image_id": image_id, "matched": matched}
            save_igdb_cache(igdb_cache)

        if not image_id:
            print(f"  SKIP: no IGDB cover found", file=sys.stderr)
            skipped += 1
            continue

        match_note = f'matched "{matched}"' if matched and matched.lower() != game["title"].lower() else "exact match"
        print(f"  IGDB cover: {image_id} ({match_note})", file=sys.stderr)
        cover_url = IGDB_COVER_URL.format(image_id=image_id)

        if not args.fix:
            print(f"  [DRY RUN] would fetch {cover_url}", file=sys.stderr)
            fixed += 1
            continue

        img = fetch_bytes(cover_url)
        if not img:
            errors += 1
            continue

        new_uuid = upload_cover(game["id"], img, "jpg")
        if not new_uuid:
            errors += 1
            continue

        directus_patch(f"/items/games/{game['id']}", {"cover_image": new_uuid})
        print(f"  Updated cover → {new_uuid}", file=sys.stderr)
        fixed += 1
        time.sleep(0.3)

    label = "would fix" if not args.fix else "fixed"
    print(f"\nDone: {label} {fixed}, skipped {skipped}, errors {errors}", file=sys.stderr)
    if not args.fix and fixed:
        print("Run with --fix to apply.", file=sys.stderr)


if __name__ == "__main__":
    main()
