#!/usr/bin/env python3
"""
Bulk import proposed Steam games into Directus.

For each game in proposed_import.json:
  1. Import cover image from Steam CDN
  2. Create game record
  3. Link genres (via games_genres junction)
  4. Upsert developers + link (via games_developers junction)

Resumable: tracks progress in cache/import_progress.json.
Cover UUIDs are deterministic (UUID5) so retries are idempotent.

Usage:
    python3 bulk_import.py [--dry-run] [--limit N] [--delay N]
"""

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from scriptlib import server_env

DIRECTUS_ENV = server_env("directus")
TOKEN = DIRECTUS_ENV["DIRECTUS_TOKEN"]
STEAMGRIDDB_TOKEN = server_env("game-encyclopedia")["STEAMGRIDDB_API_KEY"]
BASE = DIRECTUS_ENV["DIRECTUS_URL"].rstrip("/")
CACHE = Path(__file__).parent.parent / "cache"
STEAMGRIDDB_BASE = "https://www.steamgriddb.com/api/v2"

COVER_NAMESPACE = uuid.UUID("a1b2c3d4-e5f6-7890-abcd-ef1234567890")
STEAM_PORTRAIT_URL = (
    "https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/library_600x900.jpg"
)
STEAM_FALLBACK_URLS = [
    "https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/capsule_616x353.jpg",
    "https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/header.jpg",
]

# Steam genre name → Directus genre id (approved genres only)
GENRE_MAP = {
    "Action": 15,
    "Adventure": 16,
    "RPG": 6,
    "Strategy": 26,
    "Simulation": 23,
    "Massively Multiplayer": 29,
    "Racing": 30,
    "Sports": 24,
}


def api(method: str, path: str, body: dict | None = None) -> dict:
    """Send an authenticated Directus API request."""
    url = f"{BASE}{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
        },
        method=method,
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def slugify(title: str) -> str:
    """Convert a game title into a URL-safe slug."""
    t = title.lower()
    t = re.sub(r"[™®]", "", t)
    t = re.sub(r"[^a-z0-9]+", "-", t)
    return t.strip("-")


def cover_uuid(appid: int) -> str:
    """Return the deterministic Directus file UUID for an app."""
    return str(uuid.uuid5(COVER_NAMESPACE, str(appid)))


def url_exists(url: str) -> bool:
    """Return whether a URL responds successfully to a HEAD request."""
    try:
        req = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status == 200
    except Exception:
        return False


def steamgriddb_cover_url(appid: int) -> str | None:
    """Return the top-rated 600x900 grid image URL from SteamGridDB, or None."""
    url = f"{STEAMGRIDDB_BASE}/grids/steam/{appid}?dimensions=600x900&limit=1"
    try:
        req = urllib.request.Request(
            url,
            headers={"Authorization": f"Bearer {STEAMGRIDDB_TOKEN}"},
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
        grids = data.get("data", [])
        if grids:
            return grids[0]["url"]
    except Exception:
        pass
    return None


def find_cover_url(appid: int) -> str | None:
    """Find the best available cover URL for a Steam app."""
    # 1. Steam CDN portrait (preferred)
    portrait = STEAM_PORTRAIT_URL.format(appid=appid)
    if url_exists(portrait):
        return portrait

    # 2. SteamGridDB 600x900 (curated, still portrait)
    sgdb = steamgriddb_cover_url(appid)
    if sgdb:
        return sgdb

    # 3. Steam CDN landscape fallbacks
    for tmpl in STEAM_FALLBACK_URLS:
        url = tmpl.format(appid=appid)
        if url_exists(url):
            return url

    return None


def import_cover(appid: int, title: str, slug: str, dry_run: bool) -> str | None:
    """Import a cover into Directus or report the dry-run action."""
    file_id = cover_uuid(appid)
    filename = f"{slug}_{appid}.jpg"
    cover_url = find_cover_url(appid)
    if not cover_url:
        print(f"  [cover] No cover found for appid {appid}", file=sys.stderr)
        return None

    if dry_run:
        print(f"  [cover] DRY-RUN import {cover_url} → {file_id}", file=sys.stderr)
        return file_id

    try:
        result = api(
            "POST",
            "/files/import",
            {
                "url": cover_url,
                "data": {
                    "id": file_id,
                    "title": f"{title} {appid}",
                    "filename_download": filename,
                },
            },
        )
        return result["data"]["id"]
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        if '"RECORD_NOT_UNIQUE"' in body or e.code == 409:
            # Already imported in a previous run — UUID is deterministic so reuse it
            return file_id
        print(f"  [cover] HTTP {e.code}: {body[:120]}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"  [cover] Error: {e}", file=sys.stderr)
        return None


def upsert_developer(name: str, dev_cache: dict[str, int], dry_run: bool) -> int | None:
    """Return developer id, creating in Directus if needed."""
    if name in dev_cache:
        return dev_cache[name]

    slug = slugify(name)
    if dry_run:
        print(f"  [dev] DRY-RUN create developer: {name}", file=sys.stderr)
        fake_id = -(len(dev_cache) + 1)
        dev_cache[name] = fake_id
        return fake_id

    try:
        result = api("POST", "/items/developers", {"name": name, "slug": slug})
        dev_id = result["data"]["id"]
        dev_cache[name] = dev_id
        print(f"  [dev] Created: {name} → id {dev_id}", file=sys.stderr)
        return dev_id
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        # Might already exist with same slug — try to fetch by slug
        if '"RECORD_NOT_UNIQUE"' in body:
            try:
                r = api(
                    "GET",
                    f"/items/developers?filter[slug][_eq]={slug}&limit=1&fields=id,name",
                )
                if r["data"]:
                    dev_id = r["data"][0]["id"]
                    dev_cache[name] = dev_id
                    return dev_id
            except Exception:
                pass
        print(f"  [dev] HTTP {e.code} creating {name!r}: {body[:120]}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"  [dev] Error creating {name!r}: {e}", file=sys.stderr)
        return None


def main():
    """Import reviewed Steam proposals into Directus."""
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be done without writing",
    )
    parser.add_argument("--limit", type=int, help="Max games to process this run")
    parser.add_argument(
        "--delay", type=float, default=0.3, help="Seconds between games (default: 0.3)"
    )
    args = parser.parse_args()

    proposed: list[dict] = json.loads((CACHE / "proposed_import.json").read_text())
    progress_path = CACHE / "import_progress.json"
    progress: dict[str, dict] = (
        json.loads(progress_path.read_text()) if progress_path.exists() else {}
    )

    # Load existing developers into cache: name → id
    devs: list[dict] = json.loads(
        (CACHE / "backup_20260501_161932" / "developers.json").read_text()
    )
    dev_cache: dict[str, int] = {d["name"]: d["id"] for d in devs}

    done_appids = {int(k) for k, v in progress.items() if v.get("status") == "done"}
    pending = [g for g in proposed if g["appid"] not in done_appids]

    if args.limit:
        pending = pending[: args.limit]

    print(
        f"Total proposed: {len(proposed)} | Done: {len(done_appids)} | Pending: {len(pending)}",
        file=sys.stderr,
    )
    if args.dry_run:
        print("DRY RUN — no writes will occur", file=sys.stderr)

    for i, game in enumerate(pending):
        appid = game["appid"]
        title = game["title"]
        slug = game["slug"]

        print(f"[{i + 1}/{len(pending)}] {appid}: {title}", file=sys.stderr)

        # 1. Cover image
        cover_id = import_cover(appid, title, slug, args.dry_run)

        # 2. Create game record
        game_payload = {
            "title": title,
            "slug": slug,
            "release_year": game.get("release_year"),
            "download_url": game["download_url"],
            "game_status": game.get("game_status", "released"),
            "player_status": game.get("player_status", "not_started"),
        }
        if cover_id:
            game_payload["cover_image"] = cover_id

        if args.dry_run:
            print(f"  [game] DRY-RUN create: {title}", file=sys.stderr)
            game_id = -(i + 1)
        else:
            try:
                result = api("POST", "/items/games", game_payload)
                game_id = result["data"]["id"]
                print(f"  [game] Created id {game_id}", file=sys.stderr)
            except urllib.error.HTTPError as e:
                body = e.read().decode(errors="replace")
                print(f"  [game] HTTP {e.code}: {body[:200]}", file=sys.stderr)
                progress[str(appid)] = {"status": "error_game", "title": title}
                progress_path.write_text(json.dumps(progress, indent=2))
                time.sleep(args.delay)
                continue
            except Exception as e:
                print(f"  [game] Error: {e}", file=sys.stderr)
                progress[str(appid)] = {"status": "error_game", "title": title}
                progress_path.write_text(json.dumps(progress, indent=2))
                time.sleep(args.delay)
                continue

        # 3. Download link junction
        dl_url = (game.get("download_url") or "").strip()
        if dl_url:
            if args.dry_run:
                print(
                    f"  [link] DRY-RUN create download link: {dl_url[:60]}",
                    file=sys.stderr,
                )
            else:
                try:
                    api(
                        "POST",
                        "/items/games_links",
                        {
                            "games_id": game_id,
                            "url": dl_url,
                            "kind": "download",
                            "sort": 1,
                        },
                    )
                    print("  [link] Created download link", file=sys.stderr)
                except Exception as e:
                    print(
                        f"  [link] Error creating download link: {e}", file=sys.stderr
                    )

        # 4. Genre junctions
        genre_ids = [GENRE_MAP[g] for g in game.get("genres", []) if g in GENRE_MAP]
        for genre_id in genre_ids:
            if args.dry_run:
                print(f"  [genre] DRY-RUN link genre {genre_id}", file=sys.stderr)
                continue
            try:
                api(
                    "POST",
                    "/items/games_genres",
                    {"games_id": game_id, "genres_id": genre_id},
                )
            except Exception as e:
                print(f"  [genre] Error linking genre {genre_id}: {e}", file=sys.stderr)

        # 5. Developer junctions
        for dev_name in game.get("developers", []):
            dev_id = upsert_developer(dev_name, dev_cache, args.dry_run)
            if dev_id is None:
                continue
            if args.dry_run:
                print(f"  [dev] DRY-RUN link {dev_name} (id {dev_id})", file=sys.stderr)
                continue
            try:
                api(
                    "POST",
                    "/items/games_developers",
                    {"games_id": game_id, "developers_id": dev_id},
                )
            except Exception as e:
                print(f"  [dev] Error linking {dev_name!r}: {e}", file=sys.stderr)

        progress[str(appid)] = {
            "status": "done",
            "title": title,
            "game_id": game_id,
            "cover_id": cover_id,
        }

        # Checkpoint every 25 games
        if (i + 1) % 25 == 0:
            progress_path.write_text(json.dumps(progress, indent=2))
            print(f"  [checkpoint] {i + 1} processed", file=sys.stderr)

        time.sleep(args.delay)

    progress_path.write_text(json.dumps(progress, indent=2))
    done_count = sum(1 for v in progress.values() if v.get("status") == "done")
    err_count = sum(
        1 for v in progress.values() if v.get("status", "").startswith("error")
    )
    print(f"\nDone: {done_count} imported, {err_count} errors", file=sys.stderr)


if __name__ == "__main__":
    main()
