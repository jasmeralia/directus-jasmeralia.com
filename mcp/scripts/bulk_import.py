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
from pathlib import Path

from scriptlib import DirectusClient, ProgressCache, derive_game_status, server_env
from steamlib import cover_uuid, find_cover_url, import_steam_cover

STEAMGRIDDB_TOKEN = server_env("game-encyclopedia")["STEAMGRIDDB_API_KEY"]
DIRECTUS = DirectusClient.from_config()
CACHE = Path(__file__).parent.parent / "cache"

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


def slugify(title: str) -> str:
    """Convert a game title into a URL-safe slug."""
    t = title.lower()
    t = re.sub(r"[™®]", "", t)
    t = re.sub(r"[^a-z0-9]+", "-", t)
    return t.strip("-")


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
        result = DIRECTUS.post("/items/developers", {"name": name, "slug": slug})
        dev_id = result["data"]["id"]
        dev_cache[name] = dev_id
        print(f"  [dev] Created: {name} → id {dev_id}", file=sys.stderr)
        return dev_id
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        # Might already exist with same slug — try to fetch by slug
        if '"RECORD_NOT_UNIQUE"' in body:
            try:
                r = DIRECTUS.get(
                    f"/items/developers?filter[slug][_eq]={slug}&limit=1&fields=id,name",
                )
                if r["data"]:
                    dev_id = r["data"][0]["id"]
                    dev_cache[name] = dev_id
                    return dev_id
            # Any fallback lookup failure is logged before reporting the create error.
            except Exception as lookup_error:  # noqa: BLE001
                print(
                    f"  [dev] Error fetching existing {name!r}: {lookup_error}",
                    file=sys.stderr,
                )
        print(f"  [dev] HTTP {e.code} creating {name!r}: {body[:120]}", file=sys.stderr)
        return None
    # Any per-developer failure is logged and skipped so the batch continues.
    except Exception as e:  # noqa: BLE001
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
    cover_cache = ProgressCache(CACHE / "steam_cover_url_cache.json")

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
        cover_url = find_cover_url(appid, STEAMGRIDDB_TOKEN, cover_cache)
        if not cover_url:
            print(f"  [cover] No cover found for appid {appid}", file=sys.stderr)
            cover_id = None
        elif args.dry_run:
            print(
                f"  [cover] DRY-RUN import {cover_url} → {cover_uuid(appid)}",
                file=sys.stderr,
            )
            cover_id = cover_uuid(appid)
        else:
            cover_id = import_steam_cover(DIRECTUS, appid, title, slug, cover_url)

        # 2. Create game record
        game_payload = {
            "title": title,
            "slug": slug,
            "release_year": game.get("release_year"),
            "download_url": game["download_url"],
            "game_status": derive_game_status(game.get("release_year")),
            "player_status": game.get("player_status", "not_started"),
        }
        if cover_id:
            game_payload["cover_image"] = cover_id

        if args.dry_run:
            print(f"  [game] DRY-RUN create: {title}", file=sys.stderr)
            game_id = -(i + 1)
        else:
            try:
                result = DIRECTUS.post("/items/games", game_payload)
                game_id = result["data"]["id"]
                print(f"  [game] Created id {game_id}", file=sys.stderr)
            except urllib.error.HTTPError as e:
                body = e.read().decode(errors="replace")
                print(f"  [game] HTTP {e.code}: {body[:200]}", file=sys.stderr)
                progress[str(appid)] = {"status": "error_game", "title": title}
                progress_path.write_text(json.dumps(progress, indent=2))
                time.sleep(args.delay)
                continue
            # Any per-game failure is logged and skipped so the batch continues.
            except Exception as e:  # noqa: BLE001
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
                    DIRECTUS.post(
                        "/items/games_links",
                        {
                            "games_id": game_id,
                            "url": dl_url,
                            "kind": "download",
                            "sort": 1,
                        },
                    )
                    print("  [link] Created download link", file=sys.stderr)
                # Link failures are logged without stopping the remaining import.
                except Exception as e:  # noqa: BLE001
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
                DIRECTUS.post(
                    "/items/games_genres",
                    {"games_id": game_id, "genres_id": genre_id},
                )
            # Genre failures are logged without stopping the remaining import.
            except Exception as e:  # noqa: BLE001
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
                DIRECTUS.post(
                    "/items/games_developers",
                    {"games_id": game_id, "developers_id": dev_id},
                )
            # Developer-link failures are logged so the batch can continue.
            except Exception as e:  # noqa: BLE001
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
            cover_cache.flush()
            print(f"  [checkpoint] {i + 1} processed", file=sys.stderr)

        time.sleep(args.delay)

    progress_path.write_text(json.dumps(progress, indent=2))
    cover_cache.flush()
    done_count = sum(1 for v in progress.values() if v.get("status") == "done")
    err_count = sum(
        1 for v in progress.values() if v.get("status", "").startswith("error")
    )
    print(f"\nDone: {done_count} imported, {err_count} errors", file=sys.stderr)


if __name__ == "__main__":
    main()
