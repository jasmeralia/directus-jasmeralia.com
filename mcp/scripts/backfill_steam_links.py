#!/usr/bin/env python3
"""
backfill_steam_links.py

For each game that has a PlayStation/Xbox download link but no Steam link:
  1. Searches the Steam store for a matching app.
  2. Adds a Steam link (https://store.steampowered.com/app/{appid}/) for
     confident matches.
  3. Prints a report of additions, review-needed matches, and likely exclusives.

Usage:
  python3 backfill_steam_links.py           # dry-run (report only)
  python3 backfill_steam_links.py --apply   # commit links to Directus
"""

import difflib
import json
import ssl
import sys
import time
import urllib.parse
import urllib.request
from functools import partial

from scriptlib import (
    CACHE_DIR,
    ProgressCache,
    RetryPolicy,
    fetch_with_backoff,
    server_env,
)

env = server_env("directus")
BASE = env["DIRECTUS_URL"].rstrip("/")
TOKEN = env["DIRECTUS_TOKEN"]
H = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
CTX = ssl.create_default_context()

DRY_RUN = "--apply" not in sys.argv

# Titles that are DLC / expansion packs, not standalone games — never add Steam links.
TITLE_BLACKLIST = {
    "DOOM 3: Resurrection of Evil",
    "DOOM 3 Resurrection of Evil",
}

# Confidence thresholds
HIGH_CONF = 0.82  # auto-add
REVIEW_CONF = 0.55  # flag for review; below this → no-match

# ---------------------------------------------------------------------------
# Directus helpers
# ---------------------------------------------------------------------------


def d_get(path, params=None):
    """Fetch a Directus resource with optional query parameters."""
    url = f"{BASE}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params, doseq=True)
    req = urllib.request.Request(url, headers=H)
    with urllib.request.urlopen(req, context=CTX) as r:
        return json.loads(r.read())


def d_post(path, data):
    """Create a Directus resource."""
    body = json.dumps(data).encode()
    req = urllib.request.Request(f"{BASE}{path}", data=body, headers=H, method="POST")
    with urllib.request.urlopen(req, context=CTX) as r:
        return json.loads(r.read())


# ---------------------------------------------------------------------------
# Steam search
# ---------------------------------------------------------------------------


def steam_search(title):
    """Return list of {id, name, windows} for top Steam results."""
    url = "https://store.steampowered.com/api/storesearch/?" + urllib.parse.urlencode(
        {"term": title, "l": "english", "cc": "US"}
    )
    data, err = fetch_with_backoff(
        url,
        headers={"User-Agent": "Mozilla/5.0"},
        timeout=12,
        retry=RetryPolicy(rate_limit_codes=(403, 429)),
    )
    if data is None:
        return None, err
    return (
        [
            {
                "id": item["id"],
                "name": item["name"],
                "windows": item.get("platforms", {}).get("windows", False),
            }
            for item in data.get("items", [])
            if item.get("type") == "app"
        ],
        None,
    )


def title_similarity(a, b):
    """Case-insensitive token-sort ratio."""
    a2 = " ".join(sorted(a.lower().split()))
    b2 = " ".join(sorted(b.lower().split()))
    return difflib.SequenceMatcher(None, a2, b2).ratio()


def best_match(our_title, results):
    """Return (steam_item, score) for the best Windows-compatible result."""
    best, best_score = None, 0.0
    for item in results:
        if not item["windows"]:
            continue
        score = title_similarity(our_title, item["name"])
        if score > best_score:
            best, best_score = item, score
    return best, best_score


def _search_and_classify(gid: int, title: str) -> dict:
    """Return a cacheable Steam-link decision for one game."""
    if title in TITLE_BLACKLIST:
        return {
            "status": "no_match",
            "game_id": gid,
            "title": title,
            "best_steam": None,
            "score": 0.0,
        }
    results, err = steam_search(title)
    if results is None:
        status = "rate_limit_exceeded" if err == "rate_limit_exceeded" else "api_error"
        return {"status": status, "game_id": gid, "title": title, "error": err}
    item, score = best_match(title, results) if results else (None, 0.0)
    if item and score >= HIGH_CONF:
        status = "add"
    elif item and score >= REVIEW_CONF:
        status = "review"
    else:
        return {
            "status": "no_match",
            "game_id": gid,
            "title": title,
            "best_steam": item["name"] if item else None,
            "score": score,
        }
    return {
        "status": status,
        "game_id": gid,
        "title": title,
        "appid": item["id"],
        "steam_name": item["name"],
        "score": score,
        "url": f"https://store.steampowered.com/app/{item['id']}/",
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    """Find and optionally create missing Steam store links."""
    print(
        f"[{'DRY RUN' if DRY_RUN else 'APPLY'}] Fetching link data from Directus...\n"
    )

    all_links = d_get(
        "/items/games_links", {"limit": -1, "fields": "id,url,kind,games_id"}
    )["data"]

    # Games with PS/Xbox links
    ps_xbox_game_ids = {
        r["games_id"]
        for r in all_links
        if r.get("url")
        and any(
            p in r["url"].lower()
            for p in ["playstation.com", "xbox.com", "microsoft.com/store"]
        )
    }

    # Games that already have a Steam app link
    has_steam = {
        r["games_id"]
        for r in all_links
        if r.get("url") and "store.steampowered.com/app/" in r["url"]
    }

    todo_ids = sorted(ps_xbox_game_ids - has_steam)
    print(f"PS/Xbox-linked games:  {len(ps_xbox_game_ids)}")
    print(f"Already have Steam:    {len(has_steam & ps_xbox_game_ids)}")
    print(f"Need lookup:           {len(todo_ids)}\n")

    # Fetch game titles
    games_data = d_get(
        "/items/games",
        {
            "limit": -1,
            "fields": "id,title",
            "filter[id][_in]": ",".join(map(str, todo_ids)),
        },
    )["data"]
    game_title = {g["id"]: g["title"] for g in games_data}

    # --- search and classify ---
    cache = ProgressCache(CACHE_DIR / "steam_link_search_progress.json")
    transient_statuses = {"rate_limit_exceeded", "api_error"}
    pending_ids = [
        gid
        for gid in todo_ids
        if str(gid) not in cache
        or cache.get(str(gid), {}).get("status") in transient_statuses
    ]
    total = len(pending_ids)

    for i, gid in enumerate(pending_ids, 1):
        title = game_title.get(gid, f"(unknown game {gid})")
        key = str(gid)
        if cache.get(key, {}).get("status") in transient_statuses:
            cache.data.pop(key)
        decision = cache.get_or_set(key, partial(_search_and_classify, gid, title))
        tag = f"[{i}/{total}]"
        if decision["status"] == "add":
            print(
                f'{tag} ADD   {title!r}  →  "{decision["steam_name"]}" '
                f"({decision['appid']})  [{decision['score']:.2f}]"
            )
        elif decision["status"] == "review":
            print(
                f'{tag} REVIEW {title!r}  ≈  "{decision["steam_name"]}" '
                f"({decision['appid']})  [{decision['score']:.2f}]"
            )
        elif decision["status"] == "no_match":
            best_steam = decision.get("best_steam")
            print(
                f"{tag} SKIP  {title!r}  "
                + (
                    f'(best: "{best_steam}" [{decision["score"]:.2f}])'
                    if best_steam
                    else "(no results)"
                )
            )
        else:
            print(f"{tag} ERROR {title!r}  ({decision.get('error')})")

        if i % 25 == 0:
            cache.flush()
        time.sleep(1.0)

    cache.flush()
    relevant_decisions = [
        value
        for key, value in cache.data.items()
        if key.isdigit() and int(key) in set(todo_ids)
    ]
    added = [d for d in relevant_decisions if d.get("status") == "add"]
    review = [d for d in relevant_decisions if d.get("status") == "review"]
    no_match = [d for d in relevant_decisions if d.get("status") == "no_match"]

    # --- summary ---
    print(f"\n{'=' * 70}")
    print(
        f"Results: {len(added)} add, {len(review)} review, {len(no_match)} no-match\n"
    )

    if review:
        print("── REVIEW (ambiguous matches, verify manually) ──")
        for r in review:
            print(f"  game={r['game_id']}  {r['title']!r}")
            print(
                f"    Steam: {r['steam_name']!r} ({r['appid']})  score={r['score']:.2f}"
            )
            print(f"    URL:   {r['url']}")
        print()

    if no_match:
        print("── NO MATCH (likely console exclusive or not on Steam) ──")
        for r in no_match:
            suffix = (
                f"  (best: {r['best_steam']!r} [{r['score']:.2f}])"
                if r["best_steam"]
                else ""
            )
            print(f"  game={r['game_id']}  {r['title']!r}{suffix}")
        print()

    if DRY_RUN:
        print("Run with --apply to commit Steam links.")
        return

    # --- apply ---
    if not added:
        print("Nothing to add.")
        return

    print(f"Adding {len(added)} Steam links...")
    ok = 0
    for entry in added:
        try:
            d_post(
                "/items/games_links",
                {
                    "games_id": entry["game_id"],
                    "url": entry["url"],
                    "kind": "download",
                },
            )
            ok += 1
        except Exception as e:
            print(f"  ERROR game={entry['game_id']} {entry['title']}: {e}")
        time.sleep(0.1)

    print(f"Done. Added {ok}/{len(added)} Steam links.")


if __name__ == "__main__":
    main()
