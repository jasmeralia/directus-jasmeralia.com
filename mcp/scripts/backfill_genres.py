#!/usr/bin/env python3
"""
Backfill Steam community tags → Directus genres via SteamSpy.

Phase 1 (default): Fetch tags from SteamSpy, apply mapping rules, write
  cache/genre_backfill_proposals.json for review.

Phase 2 (--apply): Read proposals and apply to Directus (additive only).

Usage:
    python3 backfill_genres.py           # generate proposals
    python3 backfill_genres.py --apply   # apply approved proposals
"""

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

CACHE = Path(__file__).parent.parent / "cache"
DIRECTUS_URL = "https://directus.jasmer.tools"
DIRECTUS_TOKEN = json.load(open(Path(__file__).parent.parent.parent / ".mcp.json"))["mcpServers"]["directus"]["env"]["DIRECTUS_TOKEN"]
STEAMSPY_URL = "https://steamspy.com/api.php?request=appdetails&appid={appid}"

MIN_VOTES = 20

# Direct Steam tag → Directus genre slug
TAG_TO_GENRE: dict[str, str] = {
    "ARPG":             "arpg",
    "Card Game":        "card",
    "Card Battler":     "card",
    "CRPG":             "crpg",
    "Fighting":         "fighter",
    "2D Fighter":       "fighter",
    "FMV":              "fmv",
    "FPS":              "fps",
    "Horror":           "horror",
    "Isometric":        "isometric",
    "JRPG":             "jrpg",
    "Metroidvania":     "metroidvania",
    "Platformer":       "platformer",
    "RPG":              "rpg",
    "RTS":              "rts",
    "Roguelike":        "roguelike",
    "Rogue-like":       "roguelike",
    "Rogue-lite":       "roguelike",
    "Action Roguelike": "roguelike",
    "Stealth":          "stealth",
    "Strategy":         "strategy",
    "Visual Novel":     "visual-novel",
}

# Compound rules: all listed tags must meet MIN_VOTES → add genre slug
COMPOUND_RULES: list[tuple[list[str], str]] = [
    (["Real-Time with Pause", "Party-Based RPG"], "crpg"),
]

# Per-title overrides: genres to never assign to a specific game title.
TITLE_EXCLUSIONS: dict[str, set[str]] = {
    "Disco Elysium":    {"avn", "visual-novel"},  # VN tags present but it's a CRPG; keep crpg
    "Gamedec":          {"visual-novel"},          # VN tags present but it's a CRPG; keep crpg
    "Shadows: Awakening": {"crpg"},
    "Eon Altar":        {"crpg"},
    # Metroidvania tag manually removed — these are not MV games
    "Asterigos: Curse of the Stars":               {"metroidvania"},
    "Batman: Arkham Asylum":                        {"metroidvania"},
    "Batman: Arkham City":                          {"metroidvania"},
    "Castlevania: Lords of Shadow 2":               {"metroidvania"},
    "Castlevania: Lords of Shadow – Ultimate Edition": {"metroidvania"},
    "Fe":                                           {"metroidvania"},
    "Super Panda Adventures":                       {"metroidvania"},
    "The Rogue Prince of Persia":                   {"metroidvania"},
}


def directus_get(path: str) -> dict:
    url = f"{DIRECTUS_URL}{path}"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {DIRECTUS_TOKEN}",
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def directus_post(path: str, body: dict) -> dict:
    url = f"{DIRECTUS_URL}{path}"
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="POST", headers={
        "Authorization": f"Bearer {DIRECTUS_TOKEN}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def extract_steam_appid(url: str | None) -> int | None:
    if not url:
        return None
    m = re.search(r"store\.steampowered\.com/app/(\d+)", url)
    return int(m.group(1)) if m else None


def fetch_steamspy_tags(appid: int) -> dict[str, int] | None:
    """Returns {tag: vote_count} or None on error."""
    url = STEAMSPY_URL.format(appid=appid)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=15) as resp:
                data = json.loads(resp.read())
            return data.get("tags") or {}
        except Exception as e:
            if attempt < 2:
                time.sleep(2 ** attempt * 2)
            else:
                print(f"  SteamSpy error for {appid}: {e}", file=sys.stderr)
                return None


ROGUELIKE_TAGS = {"Roguelike", "Rogue-like", "Rogue-lite", "Action Roguelike"}


def apply_mapping(tags: dict[str, int]) -> set[str]:
    """Return set of genre slugs to add based on tags."""
    qualified = {tag for tag, votes in tags.items() if votes >= MIN_VOTES}
    is_roguelike = bool(ROGUELIKE_TAGS & qualified)
    genres: set[str] = set()

    # Direct mappings
    for tag, slug in TAG_TO_GENRE.items():
        if tag in qualified:
            if slug == "crpg" and is_roguelike:
                continue
            genres.add(slug)

    # Compound rules
    for required_tags, slug in COMPOUND_RULES:
        if all(t in qualified for t in required_tags):
            if slug == "crpg" and is_roguelike:
                continue
            genres.add(slug)

    # AVN special rule: Visual Novel + Sexual Content → both avn and visual-novel
    if "Visual Novel" in qualified and "Sexual Content" in qualified:
        genres.add("avn")
        genres.add("visual-novel")

    # Card games, RTSes, and visual novels are not CRPGs
    if genres & {"card", "rts", "visual-novel"}:
        genres.discard("crpg")

    return genres


def generate_proposals():
    tags_cache_path = CACHE / "steamspy_tags.json"
    proposals_path = CACHE / "genre_backfill_proposals.json"

    # Load cached SteamSpy results
    tags_cache: dict[str, dict[str, int]] = {}
    if tags_cache_path.exists():
        tags_cache = json.loads(tags_cache_path.read_text())
    print(f"Loaded {len(tags_cache)} cached SteamSpy entries", file=sys.stderr)

    # Fetch all Steam games from Directus
    print("Fetching games from Directus...", file=sys.stderr)
    all_games = []
    page = 1
    while True:
        data = directus_get(
            f"/items/games?fields=id,title,download_url,genres.genres_id.id,genres.genres_id.slug"
            f"&limit=500&offset={500*(page-1)}&sort=id"
        )
        batch = data.get("data", [])
        all_games.extend(batch)
        if len(batch) < 500:
            break
        page += 1
    print(f"Fetched {len(all_games)} games", file=sys.stderr)

    # Fetch genre slug→id map
    genre_data = directus_get("/items/genres?fields=id,slug&limit=-1")
    slug_to_id = {g["slug"]: g["id"] for g in genre_data["data"]}
    print(f"Loaded {len(slug_to_id)} genres", file=sys.stderr)

    steam_games = []
    for game in all_games:
        appid = extract_steam_appid(game.get("download_url"))
        if appid:
            steam_games.append((game, appid))
    print(f"{len(steam_games)} Steam games to process", file=sys.stderr)

    proposals = []
    for i, (game, appid) in enumerate(steam_games):
        appid_str = str(appid)
        if appid_str not in tags_cache:
            print(f"[{i+1}/{len(steam_games)}] Fetching {appid}: {game['title']}...", file=sys.stderr)
            fetched = fetch_steamspy_tags(appid)
            tags_cache[appid_str] = fetched if fetched is not None else {}
            time.sleep(1.0)

        tags = tags_cache[appid_str]

        if (i + 1) % 25 == 0:
            tags_cache_path.write_text(json.dumps(tags_cache, indent=2))
            print(f"  [checkpoint] {i+1}/{len(steam_games)} processed", file=sys.stderr)

        mapped_slugs = apply_mapping(tags)
        existing_slugs = {
            g["genres_id"]["slug"]
            for g in (game.get("genres") or [])
            if g.get("genres_id") and g["genres_id"].get("slug")
        }
        new_slugs = mapped_slugs - existing_slugs
        # Filter to slugs that exist in Directus and aren't title-excluded
        title_excluded = TITLE_EXCLUSIONS.get(game["title"], set())
        valid_new_slugs = {s for s in new_slugs if s in slug_to_id and s not in title_excluded}

        if valid_new_slugs:
            proposals.append({
                "game_id": game["id"],
                "title": game["title"],
                "appid": appid,
                "existing_genres": sorted(existing_slugs),
                "new_genres": sorted(valid_new_slugs),
                "steam_tags": dict(sorted(tags.items(), key=lambda x: x[1], reverse=True)[:20]),
            })

    tags_cache_path.write_text(json.dumps(tags_cache, indent=2))
    proposals_path.write_text(json.dumps(proposals, indent=2))
    print(f"\nDone: {len(proposals)} games have new genre proposals", file=sys.stderr)
    print(f"Proposals: {proposals_path}", file=sys.stderr)
    print(f"SteamSpy cache: {tags_cache_path}", file=sys.stderr)

    # Print summary
    from collections import Counter
    genre_counts = Counter(slug for p in proposals for slug in p["new_genres"])
    print("\nProposed additions by genre:", file=sys.stderr)
    for slug, count in genre_counts.most_common():
        print(f"  {slug:20s} {count}", file=sys.stderr)


def apply_proposals():
    proposals_path = CACHE / "genre_backfill_proposals.json"
    if not proposals_path.exists():
        print("No proposals file found. Run without --apply first.", file=sys.stderr)
        sys.exit(1)

    proposals = json.loads(proposals_path.read_text())

    # Fetch genre slug→id map
    genre_data = directus_get("/items/genres?fields=id,slug&limit=-1")
    slug_to_id = {g["slug"]: g["id"] for g in genre_data["data"]}

    # Fetch existing games_genres to avoid duplicate inserts
    print("Fetching existing genre assignments...", file=sys.stderr)
    existing_data = directus_get("/items/games_genres?fields=games_id,genres_id&limit=-1")
    existing_pairs: set[tuple[int, int]] = {
        (row["games_id"], row["genres_id"])
        for row in existing_data.get("data", [])
    }
    print(f"Loaded {len(existing_pairs)} existing genre assignments", file=sys.stderr)

    added = 0
    skipped = 0
    errors = 0
    total_to_add = sum(len(p["new_genres"]) for p in proposals)
    print(f"Applying {total_to_add} genre assignments across {len(proposals)} games...", file=sys.stderr)

    for p in proposals:
        game_id = p["game_id"]
        for slug in p["new_genres"]:
            genre_id = slug_to_id.get(slug)
            if not genre_id:
                print(f"  WARN: genre slug '{slug}' not found, skipping", file=sys.stderr)
                skipped += 1
                continue
            if (game_id, genre_id) in existing_pairs:
                skipped += 1
                continue
            try:
                directus_post("/items/games_genres", {"games_id": game_id, "genres_id": genre_id})
                existing_pairs.add((game_id, genre_id))
                added += 1
                print(f"  + {p['title']} → {slug}", file=sys.stderr)
            except Exception as e:
                print(f"  ERROR {p['title']} → {slug}: {e}", file=sys.stderr)
                errors += 1

    print(f"\nDone: {added} added, {skipped} skipped, {errors} errors", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Apply proposals to Directus")
    args = parser.parse_args()

    if args.apply:
        apply_proposals()
    else:
        generate_proposals()


if __name__ == "__main__":
    main()
