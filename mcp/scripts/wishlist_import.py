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
import uuid
from collections import Counter
from pathlib import Path

from scriptlib import server_env
from steamlib import genres_from_tags

DIRECTUS_TOKEN = server_env("directus")["DIRECTUS_TOKEN"]
STEAMGRIDDB_TOKEN = server_env("game-encyclopedia")["STEAMGRIDDB_API_KEY"]
STEAM_API_KEY = server_env("steam")["STEAM_API_KEY"]
STEAM_ID = server_env("steam")["STEAM_ID"]

DIRECTUS_BASE = "https://directus.jasmer.tools"
STEAMGRIDDB_BASE = "https://www.steamgriddb.com/api/v2"
CACHE = Path(__file__).parent.parent / "cache"
PROPOSALS_PATH = CACHE / "wishlist_proposed_import.json"
PROGRESS_PATH = CACHE / "wishlist_import_progress.json"
STEAMSPY_CACHE_PATH = CACHE / "steamspy_tags.json"

COVER_NAMESPACE = uuid.UUID("a1b2c3d4-e5f6-7890-abcd-ef1234567890")
STEAM_PORTRAIT_URL = (
    "https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/library_600x900.jpg"
)
STEAM_FALLBACK_URLS = [
    "https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/capsule_616x353.jpg",
    "https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/header.jpg",
]

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


# ── API helpers ────────────────────────────────────────────────────────────────


def directus_get(path: str) -> dict:
    """Fetch a Directus resource."""
    url = f"{DIRECTUS_BASE}{path}"
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {DIRECTUS_TOKEN}",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def directus_post(path: str, body: dict) -> dict:
    """Create a Directus resource."""
    url = f"{DIRECTUS_BASE}{path}"
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        method="POST",
        headers={
            "Authorization": f"Bearer {DIRECTUS_TOKEN}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def fetch_steam_details(
    appid: int, base_delay: float = 1.5
) -> tuple[dict | None, str | None]:
    """Fetch Steam appdetails with exponential backoff on 403/429."""
    url = f"https://store.steampowered.com/api/appdetails?appids={appid}&cc=us&l=en"
    delay = base_delay
    for _attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=15) as r:
                data = json.loads(r.read())
            entry = data.get(str(appid), {})
            if not entry.get("success"):
                return None, "api_no_success"
            return entry["data"], None
        except urllib.error.HTTPError as e:
            if e.code in (403, 429):
                print(
                    f"  Rate limited ({e.code}), backing off {delay:.0f}s...",
                    file=sys.stderr,
                )
                time.sleep(delay)
                delay *= 2
            else:
                return None, f"http_{e.code}"
        except Exception as e:
            return None, f"error:{e}"
    return None, "rate_limit_exceeded"


def fetch_steamspy_tags(appid: int, cache: dict[str, dict]) -> dict[str, int]:
    """Fetch and cache SteamSpy tag votes for an app."""
    appid_str = str(appid)
    if appid_str in cache:
        return cache[appid_str]
    url = f"https://steamspy.com/api.php?request=appdetails&appid={appid}"
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=15) as r:
                data = json.loads(r.read())
            result = data.get("tags") or {}
            cache[appid_str] = result
            return result
        except Exception as e:
            if attempt < 2:
                time.sleep(2**attempt * 2)
            else:
                print(f"  SteamSpy error for {appid}: {e}", file=sys.stderr)
    cache[appid_str] = {}
    return {}


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


def release_year(date_str: str) -> int | None:
    """Extract a four-digit release year from a date string."""
    m = re.search(r"\b(19|20)\d{2}\b", date_str or "")
    return int(m.group(0)) if m else None


def extract_steam_appid(url: str | None) -> int | None:
    """Extract a Steam app ID from a store URL."""
    if not url:
        return None
    m = re.search(r"store\.steampowered\.com/app/(\d+)", url)
    return int(m.group(1)) if m else None


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


def find_cover_url(appid: int) -> str | None:
    """Find the best available Steam cover URL for an app."""
    portrait = STEAM_PORTRAIT_URL.format(appid=appid)
    if url_exists(portrait):
        return portrait
    try:
        url = f"{STEAMGRIDDB_BASE}/grids/steam/{appid}?dimensions=600x900&limit=1"
        req = urllib.request.Request(
            url, headers={"Authorization": f"Bearer {STEAMGRIDDB_TOKEN}"}
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
        grids = data.get("data", [])
        if grids:
            return grids[0]["url"]
    except Exception:
        pass
    for tmpl in STEAM_FALLBACK_URLS:
        url = tmpl.format(appid=appid)
        if url_exists(url):
            return url
    return None


def import_cover(appid: int, title: str, slug: str, dry_run: bool) -> str | None:
    """Import a cover into Directus or report the dry-run action."""
    file_id = cover_uuid(appid)
    cover_url = find_cover_url(appid)
    if not cover_url:
        print("  [cover] No cover found", file=sys.stderr)
        return None
    if dry_run:
        print(f"  [cover] DRY-RUN {cover_url}", file=sys.stderr)
        return file_id
    try:
        result = directus_post(
            "/files/import",
            {
                "url": cover_url,
                "data": {
                    "id": file_id,
                    "title": f"{title} {appid}",
                    "filename_download": f"{slug}_{appid}.jpg",
                },
            },
        )
        return result["data"]["id"]
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        if '"RECORD_NOT_UNIQUE"' in body or e.code == 409:
            return file_id
        print(f"  [cover] HTTP {e.code}: {body[:120]}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"  [cover] Error: {e}", file=sys.stderr)
        return None


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
        result = directus_post("/items/developers", {"name": name, "slug": slug})
        dev_id = result["data"]["id"]
        dev_cache[name] = dev_id
        print(f"  [dev] Created: {name} → id {dev_id}", file=sys.stderr)
        return dev_id
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        if '"RECORD_NOT_UNIQUE"' in body:
            try:
                r = directus_get(
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
        data = directus_get(
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
    steamspy_cache: dict[str, dict] = {}
    if STEAMSPY_CACHE_PATH.exists():
        steamspy_cache = json.loads(STEAMSPY_CACHE_PATH.read_text())

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
        yr = release_year(details.get("release_date", {}).get("date", ""))

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
                "game_status": "released" if yr else "unreleased",
                "player_status": "not_started",
                "family_sharing": "Family Sharing" in categories,
            }
        )

        if (i + 1) % 25 == 0:
            PROPOSALS_PATH.write_text(json.dumps(proposals, indent=2))
            STEAMSPY_CACHE_PATH.write_text(json.dumps(steamspy_cache, indent=2))
            print(
                f"  [checkpoint] {i + 1} processed, {len(proposals)} proposals",
                file=sys.stderr,
            )

        time.sleep(delay)

    PROPOSALS_PATH.write_text(json.dumps(proposals, indent=2))
    STEAMSPY_CACHE_PATH.write_text(json.dumps(steamspy_cache, indent=2))
    (CACHE / "wishlist_skipped.json").write_text(json.dumps(skipped, indent=2))

    print(f"\nProposals: {len(proposals)} | Skipped: {len(skipped)}", file=sys.stderr)
    print(f"Output: {PROPOSALS_PATH}", file=sys.stderr)

    # Summary by genre
    genre_counts = Counter(slug for p in proposals for slug in p["genres"])
    print("\nGenre breakdown:", file=sys.stderr)
    for slug, count in genre_counts.most_common():
        print(f"  {slug:20s} {count}", file=sys.stderr)


# ── Phase 2: apply proposals ──────────────────────────────────────────────────


def apply_proposals(dry_run: bool, limit: int | None, delay: float):
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
    genre_data = directus_get("/items/genres?fields=id,slug&limit=-1")
    slug_to_id: dict[str, int] = {g["slug"]: g["id"] for g in genre_data["data"]}

    # Build developer name→id cache from Directus
    print("Fetching developer cache...", file=sys.stderr)
    dev_data = directus_get("/items/developers?fields=id,name&limit=-1")
    dev_cache: dict[str, int] = {d["name"]: d["id"] for d in dev_data["data"]}

    for i, game in enumerate(pending):
        appid = game["appid"]
        title = game["title"]
        slug = game["slug"]

        print(f"[{i + 1}/{len(pending)}] {appid}: {title}", file=sys.stderr)

        cover_id = import_cover(appid, title, slug, dry_run)

        game_payload: dict = {
            "title": title,
            "slug": slug,
            "release_year": game.get("release_year"),
            "download_url": game["download_url"],
            "game_status": game.get("game_status", "released"),
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
                result = directus_post("/items/games", game_payload)
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
                    directus_post(
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
                directus_post(
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
                directus_post(
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
            print(f"  [checkpoint] {i + 1} processed", file=sys.stderr)

        time.sleep(delay)

    PROGRESS_PATH.write_text(json.dumps(progress, indent=2))
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

    if args.apply or args.dry_run:
        apply_proposals(dry_run=args.dry_run, limit=args.limit, delay=args.delay)
    else:
        generate_proposals(delay=args.delay)


if __name__ == "__main__":
    main()
