#!/usr/bin/env python3
"""
Audit cover images for non-portrait dimensions and re-import correct ones.

Phase 1 (default): Fetch all cover_image file dimensions from Directus, flag
  non-portrait (width >= height) images, write cache/cover_audit.json.

Phase 2 (--fix): For each flagged game, fetch a portrait cover from SteamGridDB
  (or Steam portrait fallback), upload to Directus, update the game record.
  Skips non-Steam games (no appid).

Usage:
    python3 audit_cover_images.py          # audit only
    python3 audit_cover_images.py --fix    # re-import bad covers
    python3 audit_cover_images.py --fix --dry-run
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from functools import partial

from scriptlib import (
    CACHE_DIR,
    DirectusClient,
    ProgressCache,
    RetryPolicy,
    fetch_with_backoff,
    server_env,
)
from steamlib import extract_steam_appid

CACHE = CACHE_DIR
DIRECTUS = DirectusClient.from_config()
STEAMGRID_KEY = server_env("game-encyclopedia")["STEAMGRIDDB_API_KEY"]


def fetch_url_bytes(url: str) -> bytes | None:
    """Download bytes with rate-limit retry handling."""
    payload, err = fetch_with_backoff(
        url,
        headers={"User-Agent": "Mozilla/5.0"},
        parse=lambda raw: raw,
        retry=RetryPolicy(rate_limit_codes=(403, 429)),
    )
    if payload is None:
        print(f"    Fetch error: {err}", file=sys.stderr)
    return payload


SGDB_HEADERS = {"Authorization": f"Bearer {STEAMGRID_KEY}", "User-Agent": "Mozilla/5.0"}


def steamgrid_best_portrait(appid: int) -> str | None:
    """Return URL of the best portrait grid image from SteamGridDB, or None."""
    if not STEAMGRID_KEY:
        return None
    grids_url = f"https://www.steamgriddb.com/api/v2/grids/steam/{appid}?dimensions=600x900&limit=1"
    grids, err = fetch_with_backoff(
        grids_url,
        headers=SGDB_HEADERS,
        retry=RetryPolicy(rate_limit_codes=(403, 429)),
    )
    if grids is None:
        print(f"    SteamGridDB error: {err}", file=sys.stderr)
        return None
    items = grids.get("data") or []
    return items[0]["url"] if items else None


def steam_portrait_url(appid: int) -> str | None:
    """Try Steam portrait cover CDN URLs (library_600x900 format)."""
    urls = [
        f"https://cdn.akamai.steamstatic.com/steam/apps/{appid}/library_600x900.jpg",
        f"https://cdn.akamai.steamstatic.com/steam/apps/{appid}/library_600x900_2x.jpg",
    ]
    for url in urls:
        try:
            req = urllib.request.Request(url, method="HEAD")
            with urllib.request.urlopen(req, timeout=10):
                return url
        except urllib.error.URLError as error:
            print(
                f"    Steam portrait probe failed for {url}: {error}", file=sys.stderr
            )
    return None


def find_portrait_source(appid: int) -> str | None:
    """Return the preferred portrait source URL for a Steam app."""
    return steamgrid_best_portrait(appid) or steam_portrait_url(appid)


def audit():
    """Audit Directus cover dimensions and cache problem records."""
    audit_path = CACHE / "cover_audit.json"

    print("Fetching games with cover images...", file=sys.stderr)
    games = DIRECTUS.fetch_all(
        "/items/games?fields=id,title,slug,cover_image,download_url&filter%5Bcover_image%5D%5B_nnull%5D=true"
    )
    print(f"  {len(games)} games with cover_image", file=sys.stderr)

    # Collect all file UUIDs
    uuid_to_game: dict[str, dict] = {g["cover_image"]: g for g in games}
    all_uuids = list(uuid_to_game.keys())

    print("Fetching file dimensions from Directus...", file=sys.stderr)
    file_meta: dict[str, dict] = {}
    for i in range(0, len(all_uuids), 100):
        chunk = all_uuids[i : i + 100]
        ids_param = ",".join(chunk)
        data = DIRECTUS.get(
            f"/files?fields=id,width,height,filename_download&filter%5Bid%5D%5B_in%5D={ids_param}&limit=100"
        )
        for f in data.get("data", []):
            file_meta[f["id"]] = f
        if (i // 100 + 1) % 5 == 0:
            print(f"  [{i + len(chunk)}/{len(all_uuids)}] fetched", file=sys.stderr)

    print(f"  {len(file_meta)} file records fetched", file=sys.stderr)

    flagged = []
    ok = 0
    for uuid, game in uuid_to_game.items():
        meta = file_meta.get(uuid)
        if not meta:
            print(
                f"  WARN: no file record for {uuid} ({game['title']})", file=sys.stderr
            )
            continue
        w, h = meta.get("width") or 0, meta.get("height") or 0
        if w == 0 or h == 0:
            flagged.append(
                {
                    **game,
                    "file_id": uuid,
                    "width": w,
                    "height": h,
                    "reason": "unknown_dimensions",
                }
            )
        elif w >= h:
            flagged.append(
                {
                    **game,
                    "file_id": uuid,
                    "width": w,
                    "height": h,
                    "reason": "landscape",
                }
            )
        else:
            ok += 1

    print(f"\n{ok} portraits OK, {len(flagged)} flagged", file=sys.stderr)

    reasons = Counter(f["reason"] for f in flagged)
    for r, n in reasons.most_common():
        print(f"  {r}: {n}", file=sys.stderr)

    CACHE.mkdir(exist_ok=True)
    audit_path.write_text(json.dumps(flagged, indent=2))
    print(f"\nAudit written to {audit_path}", file=sys.stderr)
    return flagged


def fix(dry_run: bool):
    """Replace cached problem covers with portrait artwork."""
    audit_path = CACHE / "cover_audit.json"
    if not audit_path.exists():
        print("No audit file. Run without --fix first.", file=sys.stderr)
        sys.exit(1)

    flagged = json.loads(audit_path.read_text())
    print(f"{len(flagged)} games to fix", file=sys.stderr)
    cache = ProgressCache(CACHE / "cover_fix_progress.json")

    fixed = skipped = errors = 0
    for game in flagged:
        game_key = str(game["id"])
        if cache.get(game_key, {}).get("status") == "done":
            skipped += 1
            continue
        appid = extract_steam_appid(game.get("download_url"))
        if not appid:
            print(f"  SKIP (no Steam appid): {game['title']}", file=sys.stderr)
            skipped += 1
            continue

        print(
            f"  [{game['width']}x{game['height']}] {game['title']} (appid {appid})",
            file=sys.stderr,
        )

        # Try SteamGridDB first, then Steam portrait CDN
        img_url = cache.get_or_set(
            f"source:{game['id']}",
            partial(find_portrait_source, appid),
        )
        if not img_url:
            print("    No portrait source found, skipping", file=sys.stderr)
            skipped += 1
            continue

        print(f"    Source: {img_url}", file=sys.stderr)
        if dry_run:
            print(
                f"    [DRY RUN] would upload and patch game {game['id']}",
                file=sys.stderr,
            )
            fixed += 1
            continue

        img_bytes = fetch_url_bytes(img_url)
        if not img_bytes:
            errors += 1
            continue

        ext = "jpg" if img_url.lower().endswith(".jpg") else "png"
        new_uuid = DIRECTUS.upload_cover(game["id"], img_bytes, ext)
        if not new_uuid:
            errors += 1
            continue

        DIRECTUS.patch(f"/items/games/{game['id']}", {"cover_image": new_uuid})
        print(f"    Updated cover → {new_uuid}", file=sys.stderr)
        cache.set(game_key, {"status": "done", "new_uuid": new_uuid})
        fixed += 1
        time.sleep(0.5)

    cache.flush()
    print(f"\nDone: {fixed} fixed, {skipped} skipped, {errors} errors", file=sys.stderr)


def main():
    """Audit covers or apply replacements for failed covers."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--fix", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.fix:
        fix(args.dry_run)
    else:
        audit()


if __name__ == "__main__":
    main()
