#!/usr/bin/env python3
"""
Import Steam wishlist games into Directus.

Phase 1 (default): Fetch wishlist, filter DLC/non-games, cross-reference with
  Directus, fetch Steam details + SteamSpy tags, apply genre detection, write
  cache/wishlist_proposed_import.json.

Phase 2 (--apply): Read proposals, import cover art, create game records, link
  genres and developers.

Usage:
    python3 wishlist_import.py              # generate proposals
    python3 wishlist_import.py --apply      # apply proposals
    python3 wishlist_import.py --dry-run    # apply without writing
    python3 wishlist_import.py --limit N    # apply only N games
"""

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

from scriptlib import DirectusClient, ProgressCache, derive_game_status, server_env
from steamlib import (
    cover_uuid,
    extract_release_year,
    extract_steam_appid,
    fetch_steam_details,
    fetch_steamspy_tags,
    find_cover_url,
    genres_from_tags,
    import_steam_cover,
)

STEAMGRIDDB_TOKEN = server_env("game-encyclopedia")["STEAMGRIDDB_API_KEY"]
STEAM_API_KEY = server_env("steam")["STEAM_API_KEY"]
STEAM_ID = server_env("steam")["STEAM_ID"]

DIRECTUS = DirectusClient.from_config()
CACHE = Path(__file__).parent.parent / "cache"
PROPOSALS_PATH = CACHE / "wishlist_proposed_import.json"
PROGRESS_PATH = CACHE / "wishlist_import_progress.json"
STEAMSPY_CACHE_PATH = CACHE / "steamspy_tags.json"

BLOCKED_APPIDS: set[int] = {
    223850,  # 3DMark
    440520,  # VirtualHere For Steam Link
    993090,  # Lossless Scaling
    2693120,  # XBPlay
}

STEAMSPY_MIN_VOTES = 20

# Steam API genre name → Directus genre slug
STEAM_GENRE_MAP: dict[str, str] = {
    "Action": "action",
    "Adventure": "adventure",
    "RPG": "rpg",
    "Strategy": "strategy",
    "Simulation": "simulation",
    "Racing": "racing",
    "Sports": "sports",
}

TITLE_EXCLUSIONS: dict[str, set[str]] = {
    "Disco Elysium": {"avn", "visual-novel"},
    "Gamedec": {"visual-novel"},
    "Shadows: Awakening": {"crpg"},
    "Eon Altar": {"crpg"},
    "Asterigos: Curse of the Stars": {"metroidvania"},
    "Batman: Arkham Asylum": {"metroidvania"},
    "Batman: Arkham City": {"metroidvania"},
    "Doki Doki Literature Club Plus!": {"avn", "visual-novel"},
    "The Ballad Singer": {"avn"},
}


def apply_genre_mapping(
    tags: dict[str, int], steam_genres: list[str], title: str
) -> set[str]:
    """Map Steam metadata to Directus genre slugs."""
    genres = genres_from_tags(tags, STEAMSPY_MIN_VOTES)

    # Add broad Steam API genres (only if no conflicting narrow tag)
    for steam_genre in steam_genres:
        mapped_slug = STEAM_GENRE_MAP.get(steam_genre)
        if mapped_slug and mapped_slug not in genres:
            if mapped_slug == "rpg" and genres & {"arpg", "crpg", "jrpg"}:
                continue
            if mapped_slug == "strategy" and genres & {"rts"}:
                continue
            genres.add(mapped_slug)

    excluded = TITLE_EXCLUSIONS.get(title, set())
    return genres - excluded


# ── Utilities ─────────────────────────────────────────────────────────────────


def slugify(title: str) -> str:
    """Convert a game title into a URL-safe slug."""
    t = title.lower()
    t = re.sub(r"[™®]", "", t)
    t = re.sub(r"[^a-z0-9]+", "-", t)
    return t.strip("-")


def upsert_developer(name: str, dev_cache: dict[str, int], dry_run: bool) -> int | None:
    """Return an existing developer ID or create the developer."""
    if name in dev_cache:
        return dev_cache[name]
    slug = slugify(name)
    if dry_run:
        fake_id = -(len(dev_cache) + 1)
        dev_cache[name] = fake_id
        print(f"  [dev] DRY-RUN create: {name}", file=sys.stderr)
        return fake_id
    try:
        result = DIRECTUS.post("/items/developers", {"name": name, "slug": slug})
        dev_id = result["data"]["id"]
        dev_cache[name] = dev_id
        print(f"  [dev] Created: {name} → id {dev_id}", file=sys.stderr)
        return dev_id
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        if '"RECORD_NOT_UNIQUE"' in body:
            try:
                r = DIRECTUS.get(
                    f"/items/developers?filter[slug][_eq]={slug}&limit=1&fields=id,name"
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
        print(f"  [dev] Error: {e}", file=sys.stderr)
        return None


# ── Phase 1: generate proposals ───────────────────────────────────────────────


def generate_proposals(delay: float):
    """Generate import proposals for uncatalogued wishlist games."""
    print("Fetching Steam wishlist...", file=sys.stderr)
    wishlist_url = (
        f"https://api.steampowered.com/IWishlistService/GetWishlist/v1/"
        f"?key={STEAM_API_KEY}&steamid={STEAM_ID}"
    )
    req = urllib.request.Request(wishlist_url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        wishlist_data = json.loads(r.read())

    wishlist_appids: list[int] = [
        item["appid"] for item in wishlist_data.get("response", {}).get("items", [])
    ]
    print(f"Wishlist: {len(wishlist_appids)} items", file=sys.stderr)

    # Load all Directus game Steam appids
    print("Fetching Directus games...", file=sys.stderr)
    all_games: list[dict] = []
    page = 1
    while True:
        data = DIRECTUS.get(
            f"/items/games?fields=id,title,download_url"
            f"&limit=500&offset={500 * (page - 1)}&sort=id"
        )
        batch = data.get("data", [])
        all_games.extend(batch)
        if len(batch) < 500:
            break
        page += 1
    directus_appids = {
        extract_steam_appid(g.get("download_url"))
        for g in all_games
        if extract_steam_appid(g.get("download_url"))
    }
    print(f"Directus has {len(directus_appids)} Steam games", file=sys.stderr)

    # Cross-reference
    to_import = [
        a
        for a in wishlist_appids
        if a not in directus_appids and a not in BLOCKED_APPIDS
    ]
    print(f"Wishlist games not in Directus: {len(to_import)}", file=sys.stderr)

    # Load SteamSpy cache
    steamspy_cache = ProgressCache(STEAMSPY_CACHE_PATH)

    # Fetch details for each
    proposals: list[dict] = []
    skipped: list[dict] = []

    for i, appid in enumerate(to_import):
        print(f"[{i + 1}/{len(to_import)}] Fetching appid {appid}...", file=sys.stderr)
        details, err = fetch_steam_details(appid, base_delay=delay)

        if details is None:
            skipped.append({"appid": appid, "reason": err or "api_error"})
            print(f"  Skipped: {err}", file=sys.stderr)
            time.sleep(delay)
            continue

        if details.get("type") != "game":
            reason = f"type={details.get('type')}"
            skipped.append(
                {"appid": appid, "name": details.get("name"), "reason": reason}
            )
            print(f"  Skipped: {reason}", file=sys.stderr)
            time.sleep(delay)
            continue

        if details.get("is_free"):
            skipped.append(
                {"appid": appid, "name": details.get("name"), "reason": "free"}
            )
            print("  Skipped: free-to-play", file=sys.stderr)
            time.sleep(delay)
            continue

        name = details["name"]

        if re.search(r"\bVR Edition$|\(VR\)", name):
            skipped.append({"appid": appid, "name": name, "reason": "vr_edition"})
            print("  Skipped: VR edition", file=sys.stderr)
            time.sleep(delay)
            continue

        if "Playtest" in name:
            skipped.append({"appid": appid, "name": name, "reason": "playtest"})
            print("  Skipped: playtest", file=sys.stderr)
            time.sleep(delay)
            continue

        print(f"  → {name}", file=sys.stderr)

        # Fetch SteamSpy tags for genre detection
        tags = fetch_steamspy_tags(appid, steamspy_cache)
        time.sleep(1.0)  # SteamSpy rate limit

        categories = [c["description"] for c in details.get("categories", [])]
        steam_genres = [g["description"] for g in details.get("genres", [])]
        genre_slugs = set(apply_genre_mapping(tags, steam_genres, name))

        # AVN detection: content descriptor id=3 = "Adult Only Sexual Content"
        cd_ids = set(details.get("content_descriptors", {}).get("ids", []))
        if 3 in cd_ids:
            genre_slugs.add("avn")

        sorted_genre_slugs = sorted(genre_slugs)
        yr = extract_release_year(details.get("release_date", {}).get("date", ""))

        proposals.append(
            {
                "appid": appid,
                "title": name,
                "slug": slugify(name),
                "release_year": yr,
                "genres": sorted_genre_slugs,
                "steam_genres": steam_genres,
                "developers": details.get("developers", []),
                "download_url": f"https://store.steampowered.com/app/{appid}/",
                "game_status": derive_game_status(yr),
                "player_status": "not_started",
                "family_sharing": "Family Sharing" in categories,
            }
        )

        if (i + 1) % 25 == 0:
            PROPOSALS_PATH.write_text(json.dumps(proposals, indent=2))
            steamspy_cache.flush()
            print(
                f"  [checkpoint] {i + 1} processed, {len(proposals)} proposals",
                file=sys.stderr,
            )

        time.sleep(delay)

    PROPOSALS_PATH.write_text(json.dumps(proposals, indent=2))
    steamspy_cache.flush()
    (CACHE / "wishlist_skipped.json").write_text(json.dumps(skipped, indent=2))

    print(f"\nProposals: {len(proposals)} | Skipped: {len(skipped)}", file=sys.stderr)
    print(f"Output: {PROPOSALS_PATH}", file=sys.stderr)

    # Summary by genre
    genre_counts = Counter(slug for p in proposals for slug in p["genres"])
    print("\nGenre breakdown:", file=sys.stderr)
    for slug, count in genre_counts.most_common():
        print(f"  {slug:20s} {count}", file=sys.stderr)


# ── Phase 2: apply proposals ──────────────────────────────────────────────────


def apply_proposals(
    dry_run: bool, limit: int | None, delay: float, cover_cache: ProgressCache
):
    """Apply reviewed wishlist import proposals."""
    if not PROPOSALS_PATH.exists():
        print("No proposals found. Run without --apply first.", file=sys.stderr)
        sys.exit(1)

    proposals: list[dict] = json.loads(PROPOSALS_PATH.read_text())
    progress: dict[str, dict] = (
        json.loads(PROGRESS_PATH.read_text()) if PROGRESS_PATH.exists() else {}
    )

    done_appids = {int(k) for k, v in progress.items() if v.get("status") == "done"}
    pending = [p for p in proposals if p["appid"] not in done_appids]
    if limit:
        pending = pending[:limit]

    print(
        f"Total: {len(proposals)} | Done: {len(done_appids)} | Pending: {len(pending)}",
        file=sys.stderr,
    )
    if dry_run:
        print("DRY RUN — no writes", file=sys.stderr)

    # Fetch genre slug→id map
    genre_data = DIRECTUS.get("/items/genres?fields=id,slug&limit=-1")
    slug_to_id: dict[str, int] = {g["slug"]: g["id"] for g in genre_data["data"]}

    # Build developer name→id cache from Directus
    print("Fetching developer cache...", file=sys.stderr)
    dev_data = DIRECTUS.get("/items/developers?fields=id,name&limit=-1")
    dev_cache: dict[str, int] = {d["name"]: d["id"] for d in dev_data["data"]}

    for i, game in enumerate(pending):
        appid = game["appid"]
        title = game["title"]
        slug = game["slug"]

        print(f"[{i + 1}/{len(pending)}] {appid}: {title}", file=sys.stderr)

        cover_url = find_cover_url(appid, STEAMGRIDDB_TOKEN, cover_cache)
        if not cover_url:
            print(f"  [cover] No cover found for appid {appid}", file=sys.stderr)
            cover_id = None
        elif dry_run:
            print(
                f"  [cover] DRY-RUN import {cover_url} → {cover_uuid(appid)}",
                file=sys.stderr,
            )
            cover_id = cover_uuid(appid)
        else:
            cover_id = import_steam_cover(DIRECTUS, appid, title, slug, cover_url)

        game_payload: dict = {
            "title": title,
            "slug": slug,
            "release_year": game.get("release_year"),
            "download_url": game["download_url"],
            "game_status": derive_game_status(game.get("release_year")),
            "player_status": game.get("player_status", "not_started"),
            "family_sharing": game.get("family_sharing", False),
        }
        if cover_id:
            game_payload["cover_image"] = cover_id

        if dry_run:
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
                PROGRESS_PATH.write_text(json.dumps(progress, indent=2))
                time.sleep(delay)
                continue
            except Exception as e:
                print(f"  [game] Error: {e}", file=sys.stderr)
                progress[str(appid)] = {"status": "error_game", "title": title}
                PROGRESS_PATH.write_text(json.dumps(progress, indent=2))
                time.sleep(delay)
                continue

        # Download link junction
        dl_url = (game.get("download_url") or "").strip()
        if dl_url:
            if dry_run:
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
                except Exception as e:
                    print(
                        f"  [link] Error creating download link: {e}", file=sys.stderr
                    )

        # Genre junctions
        for genre_slug in game.get("genres", []):
            genre_id = slug_to_id.get(genre_slug)
            if not genre_id:
                print(
                    f"  [genre] Unknown slug '{genre_slug}', skipping", file=sys.stderr
                )
                continue
            if dry_run:
                print(
                    f"  [genre] DRY-RUN link {genre_slug} (id {genre_id})",
                    file=sys.stderr,
                )
                continue
            try:
                DIRECTUS.post(
                    "/items/games_genres", {"games_id": game_id, "genres_id": genre_id}
                )
            except Exception as e:
                print(f"  [genre] Error linking {genre_slug}: {e}", file=sys.stderr)

        # Developer junctions
        for dev_name in game.get("developers", []):
            dev_id = upsert_developer(dev_name, dev_cache, dry_run)
            if dev_id is None:
                continue
            if dry_run:
                print(f"  [dev] DRY-RUN link {dev_name} (id {dev_id})", file=sys.stderr)
                continue
            try:
                DIRECTUS.post(
                    "/items/games_developers",
                    {"games_id": game_id, "developers_id": dev_id},
                )
            except Exception as e:
                print(f"  [dev] Error linking {dev_name!r}: {e}", file=sys.stderr)

        progress[str(appid)] = {
            "status": "done",
            "title": title,
            "game_id": game_id if not dry_run else None,
            "cover_id": cover_id,
        }

        if (i + 1) % 25 == 0:
            PROGRESS_PATH.write_text(json.dumps(progress, indent=2))
            cover_cache.flush()
            print(f"  [checkpoint] {i + 1} processed", file=sys.stderr)

        time.sleep(delay)

    PROGRESS_PATH.write_text(json.dumps(progress, indent=2))
    cover_cache.flush()
    done_count = sum(1 for v in progress.values() if v.get("status") == "done")
    err_count = sum(
        1 for v in progress.values() if v.get("status", "").startswith("error")
    )
    print(f"\nDone: {done_count} imported, {err_count} errors", file=sys.stderr)


# ── Entry point ───────────────────────────────────────────────────────────────


def main():
    """Generate or apply wishlist import proposals."""
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--apply", action="store_true", help="Apply proposals (phase 2)"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Dry run apply without writing"
    )
    parser.add_argument("--limit", type=int, help="Max games to import this run")
    parser.add_argument(
        "--delay",
        type=float,
        default=0.4,
        help="Seconds between API calls (default: 0.4)",
    )
    args = parser.parse_args()
    cover_cache = ProgressCache(CACHE / "steam_cover_url_cache.json")

    if args.apply or args.dry_run:
        apply_proposals(
            dry_run=args.dry_run,
            limit=args.limit,
            delay=args.delay,
            cover_cache=cover_cache,
        )
    else:
        generate_proposals(delay=args.delay)
        cover_cache.flush()


if __name__ == "__main__":
    main()
