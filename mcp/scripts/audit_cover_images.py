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
import io
import json
import mimetypes
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

CACHE = Path(__file__).parent.parent / "cache"
DIRECTUS_URL = "https://directus.jasmer.tools"
DIRECTUS_TOKEN = json.load(open(Path(__file__).parent.parent.parent / ".mcp.json"))["mcpServers"]["directus"]["env"]["DIRECTUS_TOKEN"]
STEAMGRID_KEY = json.load(open(Path(__file__).parent.parent.parent / ".mcp.json"))["mcpServers"]["game-encyclopedia"]["env"]["STEAMGRIDDB_API_KEY"]

MAX_RETRIES = 5
BACKOFF_BASE = 2.0


def directus_get(path: str) -> dict:
    req = urllib.request.Request(f"{DIRECTUS_URL}{path}", headers={
        "Authorization": f"Bearer {DIRECTUS_TOKEN}", "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def directus_patch(path: str, body: dict) -> dict:
    data = json.dumps(body).encode()
    req = urllib.request.Request(f"{DIRECTUS_URL}{path}", data=data, method="PATCH", headers={
        "Authorization": f"Bearer {DIRECTUS_TOKEN}",
        "Content-Type": "application/json", "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def fetch_all(path: str, page_size: int = 500) -> list:
    results, offset = [], 0
    while True:
        sep = "&" if "?" in path else "?"
        batch = directus_get(f"{path}{sep}limit={page_size}&offset={offset}").get("data", [])
        results.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return results


def extract_appid(url: str | None) -> int | None:
    if not url:
        return None
    m = re.search(r"store\.steampowered\.com/app/(\d+)", url)
    return int(m.group(1)) if m else None


def fetch_url_bytes(url: str) -> bytes | None:
    delay = BACKOFF_BASE
    for attempt in range(MAX_RETRIES):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=15) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (403, 429):
                print(f"    Rate limited ({e.code}), backing off {delay:.0f}s...", file=sys.stderr)
                time.sleep(delay)
                delay *= 2
            else:
                print(f"    HTTP {e.code}: {url}", file=sys.stderr)
                return None
        except Exception as e:
            print(f"    Error: {e}", file=sys.stderr)
            return None
    return None


SGDB_HEADERS = {"Authorization": f"Bearer {STEAMGRID_KEY}", "User-Agent": "Mozilla/5.0"}


def steamgrid_best_portrait(appid: int) -> str | None:
    """Return URL of the best portrait grid image from SteamGridDB, or None."""
    if not STEAMGRID_KEY:
        return None
    grids_url = f"https://www.steamgriddb.com/api/v2/grids/steam/{appid}?dimensions=600x900&limit=1"
    req = urllib.request.Request(grids_url, headers=SGDB_HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            grids = json.loads(r.read())
        items = grids.get("data") or []
        if items:
            return items[0]["url"]
    except Exception:
        pass
    return None


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
        except Exception:
            pass
    return None


def upload_cover(game_id: int, img_bytes: bytes, ext: str = "jpg") -> str | None:
    """Upload image bytes to Directus files, return new file UUID."""
    boundary = "----FormBoundary7MA4YWxkTrZu0gW"
    filename = f"cover_{game_id}.{ext}"
    mime = "image/jpeg" if ext in ("jpg", "jpeg") else f"image/{ext}"

    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: {mime}\r\n\r\n"
    ).encode() + img_bytes + f"\r\n--{boundary}--\r\n".encode()

    req = urllib.request.Request(
        f"{DIRECTUS_URL}/files",
        data=body, method="POST",
        headers={
            "Authorization": f"Bearer {DIRECTUS_TOKEN}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            resp = json.loads(r.read())
        return resp["data"]["id"]
    except Exception as e:
        print(f"    Upload error: {e}", file=sys.stderr)
        return None


def audit():
    audit_path = CACHE / "cover_audit.json"

    print("Fetching games with cover images...", file=sys.stderr)
    games = fetch_all("/items/games?fields=id,title,slug,cover_image,download_url&filter%5Bcover_image%5D%5B_nnull%5D=true")
    print(f"  {len(games)} games with cover_image", file=sys.stderr)

    # Collect all file UUIDs
    uuid_to_game: dict[str, dict] = {g["cover_image"]: g for g in games}
    all_uuids = list(uuid_to_game.keys())

    print("Fetching file dimensions from Directus...", file=sys.stderr)
    file_meta: dict[str, dict] = {}
    for i in range(0, len(all_uuids), 100):
        chunk = all_uuids[i:i+100]
        ids_param = ",".join(chunk)
        data = directus_get(f"/files?fields=id,width,height,filename_download&filter%5Bid%5D%5B_in%5D={ids_param}&limit=100")
        for f in data.get("data", []):
            file_meta[f["id"]] = f
        if (i // 100 + 1) % 5 == 0:
            print(f"  [{i+len(chunk)}/{len(all_uuids)}] fetched", file=sys.stderr)

    print(f"  {len(file_meta)} file records fetched", file=sys.stderr)

    flagged = []
    ok = 0
    for uuid, game in uuid_to_game.items():
        meta = file_meta.get(uuid)
        if not meta:
            print(f"  WARN: no file record for {uuid} ({game['title']})", file=sys.stderr)
            continue
        w, h = meta.get("width") or 0, meta.get("height") or 0
        if w == 0 or h == 0:
            flagged.append({**game, "file_id": uuid, "width": w, "height": h, "reason": "unknown_dimensions"})
        elif w >= h:
            flagged.append({**game, "file_id": uuid, "width": w, "height": h, "reason": "landscape"})
        else:
            ok += 1

    print(f"\n{ok} portraits OK, {len(flagged)} flagged", file=sys.stderr)

    from collections import Counter
    reasons = Counter(f["reason"] for f in flagged)
    for r, n in reasons.most_common():
        print(f"  {r}: {n}", file=sys.stderr)

    CACHE.mkdir(exist_ok=True)
    audit_path.write_text(json.dumps(flagged, indent=2))
    print(f"\nAudit written to {audit_path}", file=sys.stderr)
    return flagged


def fix(dry_run: bool):
    audit_path = CACHE / "cover_audit.json"
    if not audit_path.exists():
        print("No audit file. Run without --fix first.", file=sys.stderr)
        sys.exit(1)

    flagged = json.loads(audit_path.read_text())
    print(f"{len(flagged)} games to fix", file=sys.stderr)

    fixed = skipped = errors = 0
    for game in flagged:
        appid = extract_appid(game.get("download_url"))
        if not appid:
            print(f"  SKIP (no Steam appid): {game['title']}", file=sys.stderr)
            skipped += 1
            continue

        print(f"  [{game['width']}x{game['height']}] {game['title']} (appid {appid})", file=sys.stderr)

        # Try SteamGridDB first, then Steam portrait CDN
        img_url = steamgrid_best_portrait(appid) or steam_portrait_url(appid)
        if not img_url:
            print(f"    No portrait source found, skipping", file=sys.stderr)
            skipped += 1
            continue

        print(f"    Source: {img_url}", file=sys.stderr)
        if dry_run:
            print(f"    [DRY RUN] would upload and patch game {game['id']}", file=sys.stderr)
            fixed += 1
            continue

        img_bytes = fetch_url_bytes(img_url)
        if not img_bytes:
            errors += 1
            continue

        ext = "jpg" if img_url.lower().endswith(".jpg") else "png"
        new_uuid = upload_cover(game["id"], img_bytes, ext)
        if not new_uuid:
            errors += 1
            continue

        directus_patch(f"/items/games/{game['id']}", {"cover_image": new_uuid})
        print(f"    Updated cover → {new_uuid}", file=sys.stderr)
        fixed += 1
        time.sleep(0.5)

    print(f"\nDone: {fixed} fixed, {skipped} skipped, {errors} errors", file=sys.stderr)


def main():
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
