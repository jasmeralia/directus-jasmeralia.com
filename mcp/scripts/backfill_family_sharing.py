#!/usr/bin/env python3
"""
Backfill family_sharing field for all Directus games that have a Steam appid.

Fetches Steam appdetails and checks for "Family Sharing" in the categories list.
Skips games without a Steam download_url, and games already processed.

Resumable: progress saved to cache/family_sharing_progress.json.

Usage:
    python3 backfill_family_sharing.py [--delay N] [--limit N]
"""

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

TOKEN = json.load(open(Path(__file__).parent.parent.parent / ".mcp.json"))["mcpServers"]["directus"]["env"]["DIRECTUS_TOKEN"]
BASE = "https://directus.jasmer.tools"
CACHE = Path(__file__).parent.parent / "cache"
STEAM_DETAILS_URL = "https://store.steampowered.com/api/appdetails?appids={appid}&cc=us&l=en"

MAX_RETRIES = 5
BACKOFF_BASE = 2.0  # doubles each retry: 2s, 4s, 8s, 16s, 32s


def fetch_steam_details(appid: int) -> tuple[dict | None, str | None]:
    """Returns (data, error_reason). Retries with exponential backoff on rate limits."""
    url = STEAM_DETAILS_URL.format(appid=appid)
    delay = BACKOFF_BASE
    for attempt in range(MAX_RETRIES):
        try:
            with urllib.request.urlopen(url, timeout=15) as resp:
                data = json.loads(resp.read())
            entry = data.get(str(appid), {})
            if not entry.get("success"):
                return None, "api_no_success"
            return entry["data"], None
        except urllib.error.HTTPError as e:
            if e.code in (403, 429):
                print(f"  Rate limited (HTTP {e.code}), backing off {delay:.0f}s (attempt {attempt+1}/{MAX_RETRIES})...", file=sys.stderr)
                time.sleep(delay)
                delay *= 2
            else:
                return None, f"http_{e.code}"
        except Exception as e:
            return None, f"error:{e}"
    return None, "rate_limit_exceeded"


def directus_patch(game_id: int, family_sharing: bool) -> bool:
    req = urllib.request.Request(
        f"{BASE}/items/games/{game_id}",
        data=json.dumps({"family_sharing": family_sharing}).encode(),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        method="PATCH",
    )
    try:
        with urllib.request.urlopen(req, timeout=15):
            return True
    except Exception as e:
        print(f"  PATCH error for game {game_id}: {e}", file=sys.stderr)
        return False


def extract_appid(url: str | None) -> int | None:
    if not url:
        return None
    m = re.search(r"store\.steampowered\.com/app/(\d+)", url)
    return int(m.group(1)) if m else None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--delay", type=float, default=1.5, help="Base seconds between Steam API calls (default: 1.5)")
    parser.add_argument("--limit", type=int, help="Max games to process this run")
    args = parser.parse_args()

    # Fetch all games from Directus
    print("Fetching all games from Directus...", file=sys.stderr)
    req = urllib.request.Request(
        f"{BASE}/items/games?limit=-1&fields=id,title,download_url,family_sharing",
        headers={"Authorization": f"Bearer {TOKEN}"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        games = json.loads(resp.read())["data"]
    print(f"Total games: {len(games)}", file=sys.stderr)

    progress_path = CACHE / "family_sharing_progress.json"
    progress: dict[str, dict] = json.loads(progress_path.read_text()) if progress_path.exists() else {}
    done_ids = {int(k) for k, v in progress.items() if v.get("status") == "done"}
    retry_ids = {int(k) for k, v in progress.items() if v.get("status") in ("api_error", "rate_limit_exceeded")}

    # Only process Steam games not yet done (or previously errored)
    pending = [
        g for g in games
        if extract_appid(g.get("download_url")) is not None
        and (g["id"] not in done_ids or g["id"] in retry_ids)
    ]

    if args.limit:
        pending = pending[: args.limit]

    no_steam = sum(1 for g in games if extract_appid(g.get("download_url")) is None)
    print(f"Steam games: {len(games) - no_steam} | Already done: {len(done_ids)} | Pending: {len(pending)}", file=sys.stderr)

    for i, game in enumerate(pending):
        appid = extract_appid(game["download_url"])
        print(f"[{i+1}/{len(pending)}] {appid}: {game['title']}", file=sys.stderr)

        details, err = fetch_steam_details(appid)

        if details is None:
            print(f"  Steam error: {err}", file=sys.stderr)
            progress[str(game["id"])] = {"status": err or "api_error", "appid": appid, "title": game["title"]}
        else:
            categories = [c.get("description", "") for c in details.get("categories", [])]
            family_sharing = "Family Sharing" in categories
            ok = directus_patch(game["id"], family_sharing)
            status = "done" if ok else "patch_error"
            progress[str(game["id"])] = {"status": status, "appid": appid, "family_sharing": family_sharing}
            print(f"  family_sharing={family_sharing}  categories_count={len(categories)}", file=sys.stderr)

        if (i + 1) % 25 == 0:
            progress_path.write_text(json.dumps(progress, indent=2))
            done_count = sum(1 for v in progress.values() if v.get("status") == "done")
            print(f"  [checkpoint] {done_count} done so far", file=sys.stderr)

        time.sleep(args.delay)

    progress_path.write_text(json.dumps(progress, indent=2))

    done_count = sum(1 for v in progress.values() if v.get("status") == "done")
    err_count = sum(1 for v in progress.values() if v.get("status") not in ("done",))
    supports = sum(1 for v in progress.values() if v.get("family_sharing") is True)
    print(f"\nDone: {done_count} updated, {err_count} errors", file=sys.stderr)
    print(f"Family sharing supported: {supports} / {done_count}", file=sys.stderr)


if __name__ == "__main__":
    main()
