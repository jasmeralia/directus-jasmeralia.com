#!/usr/bin/env python3
"""
Phase 3: Import enriched PSN/Xbox games into Directus.

Input:    cache/psn_xbox_enriched.json
Progress: cache/psn_xbox_import_progress.json (flushed every 25 items)

All games are imported with player_status = not_started regardless of playtime.
"""

import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

from scriptlib import derive_game_status, server_env

DIRECTUS_ENV = server_env("directus")
DIRECTUS_URL = DIRECTUS_ENV["DIRECTUS_URL"].rstrip("/")
DIRECTUS_TOKEN = DIRECTUS_ENV["DIRECTUS_TOKEN"]
CACHE = Path(__file__).parent.parent / "cache"
FLUSH_EVERY = 25


def api_get(path: str) -> dict:
    """Fetch a Directus resource."""
    req = urllib.request.Request(
        f"{DIRECTUS_URL}{path}",
        headers={"Authorization": f"Bearer {DIRECTUS_TOKEN}"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def api_post(path: str, body: dict) -> dict:
    """Create a Directus resource."""
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{DIRECTUS_URL}{path}",
        data=data,
        headers={
            "Authorization": f"Bearer {DIRECTUS_TOKEN}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def upload_cover(cover_url: str, title: str, slug: str) -> str | None:
    """Import cover image into Directus by URL, return file UUID."""
    ext = cover_url.split("?")[0].rsplit(".", 1)[-1] or "jpg"
    body = {
        "url": cover_url,
        "data": {
            "title": title,
            "filename_download": f"{slug}.{ext}",
        },
    }
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{DIRECTUS_URL}/files/import",
        data=data,
        headers={
            "Authorization": f"Bearer {DIRECTUS_TOKEN}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read())
        return result["data"]["id"]
    except urllib.error.HTTPError as e:
        body_text = e.read().decode()
        print(
            f"  Cover upload failed HTTP {e.code}: {body_text[:200]}", file=sys.stderr
        )
        return None
    except Exception as e:
        print(f"  Cover upload error: {e}", file=sys.stderr)
        return None


def make_slug(title: str) -> str:
    """Convert a game title into a URL-safe slug."""
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")


def ensure_genre(name: str, cache: dict) -> int:
    """Return the ID of an existing or newly created genre."""
    name = name.strip()
    if name in cache:
        return cache[name]
    slug = make_slug(name)
    result = api_post("/items/genres", {"name": name, "slug": slug})
    gid = result["data"]["id"]
    cache[name] = gid
    return gid


def ensure_developer(name: str, cache: dict) -> int:
    """Return the ID of an existing or newly created developer."""
    name = name.strip()
    if name in cache:
        return cache[name]
    slug = make_slug(name)
    result = api_post("/items/developers", {"name": name, "slug": slug})
    did = result["data"]["id"]
    cache[name] = did
    return did


def take_backup():
    """Write a JSON backup of collections changed by the import."""
    backup_dir = CACHE / f"backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    backup_dir.mkdir(parents=True)
    collections = ["games", "genres", "developers", "games_genres", "games_developers"]
    print(f"Taking backup to {backup_dir}/")
    for col in collections:
        data = api_get(f"/items/{col}?limit=-1")
        with open(backup_dir / f"{col}.json", "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        print(f"  {col}: {len(data['data'])} records")
    print("Backup complete.")


def main():
    """Import reviewed PlayStation and Xbox games into Directus."""
    CACHE.mkdir(exist_ok=True)

    enriched_path = CACHE / "psn_xbox_enriched.json"
    if not enriched_path.exists():
        print(
            "ERROR: cache/psn_xbox_enriched.json not found — run enrich_psn_xbox.py first",
            file=sys.stderr,
        )
        sys.exit(1)

    with open(enriched_path, encoding="utf-8") as f:
        games = json.load(f)
    print(f"Loaded {len(games)} enriched games")

    # Load progress
    progress_path = CACHE / "psn_xbox_import_progress.json"
    progress: dict = {}
    if progress_path.exists():
        with open(progress_path, encoding="utf-8") as f:
            progress = json.load(f)
        done = sum(1 for v in progress.values() if v["status"] == "done")
        print(f"Resuming: {done} already imported")

    # Backup before first write
    if not any(v["status"] == "done" for v in progress.values()):
        take_backup()

    # Build lookup caches
    print("Loading genre cache...")
    genre_cache = {
        g["name"]: g["id"]
        for g in api_get("/items/genres?limit=-1&fields[]=id,name")["data"]
    }
    print(f"  {len(genre_cache)} genres")

    print("Loading developer cache...")
    dev_cache = {
        d["name"]: d["id"]
        for d in api_get("/items/developers?limit=-1&fields[]=id,name")["data"]
    }
    print(f"  {len(dev_cache)} developers")

    imported = 0
    errors = 0

    for i, game in enumerate(games):
        title = game["title"]
        key = title

        if progress.get(key, {}).get("status") == "done":
            continue

        print(f"\n[{i + 1}/{len(games)}] {title!r}")

        try:
            # Upload cover
            file_uuid = None
            slug = make_slug(title)
            if game.get("cover_art_url"):
                print(f"  Uploading cover from {game['cover_art_source']}...")
                file_uuid = upload_cover(game["cover_art_url"], title, slug)
                if file_uuid:
                    print(f"  Cover UUID: {file_uuid}")
                else:
                    print("  Cover upload failed — continuing without cover")

            # Build download_url
            download_url = game.get("download_url") or ""
            if not download_url:
                platform = game.get("platform", "psn")
                if platform == "psn":
                    download_url = f"https://store.playstation.com/en-us/search/{urllib.parse.quote(title)}"
                else:
                    download_url = f"https://www.xbox.com/en-US/search?q={urllib.parse.quote(title)}"

            # explicit override wins; else playtime >= 4h → in_progress
            if "player_status" in game:
                player_status = game["player_status"]
            else:
                playtime = game.get("playtime", 0)
                player_status = "in_progress" if playtime >= 14400 else "not_started"

            # Create game record
            game_body = {
                "title": title,
                "slug": make_slug(title),
                "release_year": game.get("release_year"),
                "player_status": player_status,
                "game_status": derive_game_status(game.get("release_year")),
                "download_url": download_url,
                "cover_image": file_uuid,
                "family_sharing": None,
            }
            result = api_post("/items/games", game_body)
            game_id = result["data"]["id"]
            print(f"  Created game ID {game_id}")

            # Download link junction
            if download_url:
                try:
                    api_post(
                        "/items/games_links",
                        {
                            "games_id": game_id,
                            "url": download_url,
                            "kind": "download",
                            "sort": 1,
                        },
                    )
                    print("  Created download link")
                except urllib.error.HTTPError as e:
                    print(f"  Download link HTTP {e.code}: {e.read().decode()[:200]}")
                except Exception as e:
                    print(f"  Download link error: {e}")

            # Link genres
            for genre_name in game.get("genres", []):
                genre_id = ensure_genre(genre_name, genre_cache)
                try:
                    api_post(
                        "/items/games_genres",
                        {"games_id": game_id, "genres_id": genre_id},
                    )
                except urllib.error.HTTPError as e:
                    if e.code == 400:
                        pass  # unique constraint — already linked
                    else:
                        raise

            # Link developers
            for dev_name in game.get("developers", []):
                dev_id = ensure_developer(dev_name, dev_cache)
                try:
                    api_post(
                        "/items/games_developers",
                        {"games_id": game_id, "developers_id": dev_id},
                    )
                except urllib.error.HTTPError as e:
                    if e.code == 400:
                        pass
                    else:
                        raise

            progress[key] = {"status": "done", "directus_id": game_id}
            imported += 1
            print("  Done.")

        except urllib.error.HTTPError as e:
            err_body = e.read().decode()
            msg = f"http_{e.code}: {err_body[:200]}"
            print(f"  ERROR: {msg}", file=sys.stderr)
            progress[key] = {"status": "error", "error": msg}
            errors += 1

        except Exception as e:
            msg = str(e)
            print(f"  ERROR: {msg}", file=sys.stderr)
            progress[key] = {"status": "error", "error": msg}
            errors += 1

        # Flush progress
        if (imported + errors) % FLUSH_EVERY == 0:
            with open(progress_path, "w", encoding="utf-8") as f:
                json.dump(progress, f, indent=2)

        time.sleep(0.2)

    # Final flush
    with open(progress_path, "w", encoding="utf-8") as f:
        json.dump(progress, f, indent=2)

    print(f"\n{'=' * 50}")
    print(f"Imported: {imported}  Errors: {errors}")
    print(f"Progress saved to {progress_path}")

    if errors:
        failed = [t for t, v in progress.items() if v["status"] == "error"]
        print("\nFailed titles:")
        for t in failed:
            print(f"  {t!r}: {progress[t]['error']}")


if __name__ == "__main__":
    main()
