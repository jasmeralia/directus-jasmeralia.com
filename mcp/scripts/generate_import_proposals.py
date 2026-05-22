#!/usr/bin/env python3
"""
Generate a list of Steam games not in Directus, enriched with developer/genre
data from the Steam API. Filters to type=="game" only, excludes F2P by default.

Resumes from existing proposed_import.json and proposed_import_skipped.json,
skipping appids already processed. Re-attempts previous api_error entries.

Usage:
    python3 generate_import_proposals.py [--count N] [--seed S] [--all] [--delay N]
    python3 generate_import_proposals.py --all          # full run / resume
    python3 generate_import_proposals.py --include-free # include F2P
"""

import argparse
import json
import random
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

CACHE = Path(__file__).parent.parent / "cache"
STEAM_DETAILS_URL = "https://store.steampowered.com/api/appdetails?appids={appid}&cc=us&l=en"

MAX_RETRIES = 5
BACKOFF_BASE = 2.0  # seconds; doubles each retry

# Steam appids that pass the type=="game" filter but are not games (utilities, software, tools).
BLOCKED_APPIDS: set[int] = {
    223850,   # 3DMark (benchmarking software)
    440520,   # VirtualHere For Steam Link
    993090,   # Lossless Scaling
    2693120,  # XBPlay
}


def fetch_steam_details(appid: int, base_delay: float) -> tuple[dict | None, str | None]:
    """Returns (data, error_reason). Retries with backoff on rate-limit responses."""
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


def slugify(title: str) -> str:
    t = title.lower()
    t = re.sub(r"[™®]", "", t)
    t = re.sub(r"[^a-z0-9]+", "-", t)
    return t.strip("-")


def release_year(date_str: str) -> int | None:
    m = re.search(r"\b(19|20)\d{2}\b", date_str or "")
    return int(m.group(0)) if m else None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=25, help="Number of games to sample")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    parser.add_argument("--no-free", action="store_true", default=True, help="Exclude F2P games (default: on)")
    parser.add_argument("--include-free", dest="no_free", action="store_false", help="Include F2P games")
    parser.add_argument("--all", action="store_true", help="Process full list (no sampling)")
    parser.add_argument("--delay", type=float, default=1.5, help="Base seconds between API calls (default: 1.5)")
    args = parser.parse_args()

    candidates: list[dict] = json.loads((CACHE / "steam_not_in_directus.json").read_text())

    if not args.all:
        random.seed(args.seed)
        candidates = random.sample(candidates, min(args.count, len(candidates)))

    # Load existing results and build sets of already-processed appids
    results_path = CACHE / "proposed_import.json"
    skipped_path = CACHE / "proposed_import_skipped.json"

    results: list[dict] = json.loads(results_path.read_text()) if results_path.exists() else []
    prev_skipped: list[dict] = json.loads(skipped_path.read_text()) if skipped_path.exists() else []

    done_appids = {r["appid"] for r in results}
    # Re-attempt api_errors; skip everything else that was already decided
    retry_appids = {s["appid"] for s in prev_skipped if s["reason"] in ("api_error", "rate_limit_exceeded")}
    skip_appids = {s["appid"] for s in prev_skipped if s["reason"] not in ("api_error", "rate_limit_exceeded")}

    skipped: list[dict] = [s for s in prev_skipped if s["reason"] not in ("api_error", "rate_limit_exceeded")]

    pending = [g for g in candidates if g["appid"] not in done_appids and g["appid"] not in skip_appids and g["appid"] not in BLOCKED_APPIDS]

    already_done = len(done_appids) + len(skip_appids)
    print(f"Candidates: {len(candidates)} | Already done: {already_done} | Pending: {len(pending)}", file=sys.stderr)

    for i, game in enumerate(pending):
        appid = game["appid"]
        retry = appid in retry_appids
        print(f"[{i+1}/{len(pending)}] {'RETRY ' if retry else ''}Fetching {appid}: {game['name']} ...", file=sys.stderr)

        details, err = fetch_steam_details(appid, args.delay)

        if details is None:
            skipped.append({"appid": appid, "name": game["name"], "reason": err or "api_error"})
            print(f"  Skipped: {err}", file=sys.stderr)
        elif details.get("type") != "game":
            reason = f"type={details.get('type')}"
            skipped.append({"appid": appid, "name": game["name"], "reason": reason})
            print(f"  Skipped: {reason}", file=sys.stderr)
        elif args.no_free and details.get("is_free"):
            skipped.append({"appid": appid, "name": game["name"], "reason": "free"})
            print(f"  Skipped: free-to-play", file=sys.stderr)
        elif re.search(r"\bVR Edition$|\(VR\)", details["name"]):
            skipped.append({"appid": appid, "name": game["name"], "reason": "vr_edition"})
            print(f"  Skipped: VR edition", file=sys.stderr)
        elif "Playtest" in details["name"]:
            skipped.append({"appid": appid, "name": game["name"], "reason": "playtest"})
            print(f"  Skipped: playtest", file=sys.stderr)
        else:
            categories = [c["description"] for c in details.get("categories", [])]
            yr = release_year(details.get("release_date", {}).get("date", ""))
            results.append({
                "appid": appid,
                "title": details["name"],
                "slug": slugify(details["name"]),
                "release_year": yr,
                "genres": [g["description"] for g in details.get("genres", [])],
                "developers": details.get("developers", []),
                "download_url": f"https://store.steampowered.com/app/{appid}/",
                "game_status": "released" if yr else "unreleased",
                "player_status": "not_started",
                "family_sharing": "Family Sharing" in categories,
            })

        # Save incrementally every 25 games
        if (i + 1) % 25 == 0:
            results_path.write_text(json.dumps(results, indent=2))
            skipped_path.write_text(json.dumps(skipped, indent=2))
            print(f"  [checkpoint] {len(results)} proposed, {len(skipped)} skipped so far", file=sys.stderr)

        time.sleep(args.delay)

    results_path.write_text(json.dumps(results, indent=2))
    skipped_path.write_text(json.dumps(skipped, indent=2))

    print(f"\nDone: {len(results)} games proposed, {len(skipped)} skipped", file=sys.stderr)
    print(f"Output: {results_path}", file=sys.stderr)
    print(f"Skipped: {skipped_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
