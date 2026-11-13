#!/usr/bin/env python3
"""Idempotently discover and import paid Steam library games into Directus.

Run without flags to refresh the owned-games snapshot and write a review plan.
Run with ``--apply`` to create only unambiguous, unlinked games in that plan.
Potential title duplicates and GameStoryLog candidates stay in the report for
review. After importing, use ``--enrich`` to run the existing art and synopsis
backfills for newly created games.
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from scriptlib import (
    CACHE_DIR,
    DirectusClient,
    ProgressCache,
    derive_game_status,
    server_env,
    set_game_capsule,
)
from steamlib import (
    extract_release_year,
    extract_steam_appid,
    fetch_steam_details,
    fetch_steamspy_tags,
    find_cover_url,
    genres_from_tags,
    import_steam_cover,
)

ROOT = Path(__file__).resolve().parents[2]
PLAN = CACHE_DIR / "steam_library_import_plan.json"
REPORT = CACHE_DIR / "steam_library_import_review.md"
LIBRARY = CACHE_DIR / "steam_library.json"
TAG_CACHE = ProgressCache(CACHE_DIR / "steamspy_tags.json")
COVER_CACHE = ProgressCache(CACHE_DIR / "steam_cover_url_cache.json")
BLOCKED_APPIDS = {223850, 440520, 993090, 2693120, 205930}
# Store episodes/season apps that belong to one tracked Directus game. These
# should become additional acquisition links on that record, never new games.
TARGET_SLUGS = {
    3590: "plants-vs-zombies",
    4550: "titan-quest-anniversary-edition",
    43160: "metro-last-light-redux",
    410700: "system-shock-enhanced-edition",
    747350: "hellblade-senua-s-sacrifice",
    1272160: "the-life-and-suffering-of-sir-brante-chapter-1-2",
    1880890: "lost-ember",
    2427410: "s-t-a-l-k-e-r-shadow-of-chernobyl",
    2427420: "s-t-a-l-k-e-r-clear-sky",
    2427430: "s-t-a-l-k-e-r-call-of-pripyat",
    **{appid: "sam-and-max-the-devils-playhouse" for appid in (31230, 31240, 31250, 31260)},
    **{appid: "back-to-the-future-the-game" for appid in (94500, 94510, 94520, 94530)},
}
FORCE_CREATE_APPIDS = {223220, 213120, 216390, 224060, 231990, 2456960, 281690, 3928550}
GSL_LINKS_BY_APPID = {3928550: "fog-of-war"}
STEAM_API_GENRES = {
    "Action": "action", "Adventure": "adventure", "RPG": "rpg",
    "Strategy": "strategy", "Simulation": "simulation", "Racing": "racing",
    "Sports": "sports",
}
TITLE_GENRE_EXCLUSIONS = {"quakechampions": {"horror"}}


def slugify(value: str) -> str:
    value = re.sub(r"[™®]", "", value.casefold())
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", value)).strip("-")


def normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.casefold())


def fetch_library() -> list[dict[str, Any]]:
    env = server_env("steam")
    url = "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?" + urllib.parse.urlencode({
        "key": env["STEAM_API_KEY"], "steamid": env["STEAM_ID"],
        "include_appinfo": 1, "include_played_free_games": 1,
    })
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)
    games = payload.get("response", {}).get("games")
    if not isinstance(games, list):
        raise RuntimeError("Steam returned no owned-games list")
    result = [{
        "appid": int(game["appid"]), "name": game.get("name", ""),
        "playtime_forever_hours": round(game.get("playtime_forever", 0) / 60, 2),
        "last_played_date": game.get("rtime_last_played"),
    } for game in games if game.get("name")]
    LIBRARY.write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


def fetch_games(client: DirectusClient) -> list[dict[str, Any]]:
    games: list[dict[str, Any]] = []
    offset = 0
    while True:
        batch = client.get("/items/games", params={
            "fields": "id,title,slug,links.url,links.kind",
            "limit": 500, "offset": offset, "sort": "id",
        }).get("data", [])
        games.extend(batch)
        if len(batch) < 500:
            return [game for game in games if normalize(game.get("title", "")) != "twiceburned"]
        offset += 500


def directus_index(games: list[dict[str, Any]]) -> tuple[set[int], list[dict[str, Any]]]:
    owned_ids: set[int] = set()
    for game in games:
        for link in game.get("links") or []:
            if link.get("kind") == "download":
                appid = extract_steam_appid(link.get("url"))
                if appid:
                    owned_ids.add(appid)
    return owned_ids, games


def candidate_matches(title: str, games: list[dict[str, Any]]) -> list[dict[str, Any]]:
    source = normalize(title)
    scored = []
    for game in games:
        target = normalize(game.get("title", ""))
        if not target:
            continue
        ratio = difflib.SequenceMatcher(None, source, target).ratio()
        if source == target:
            ratio = 1.0
        elif min(len(source), len(target)) >= 5 and (source in target or target in source):
            ratio = max(ratio, min(len(source), len(target)) / max(len(source), len(target)))
        if ratio >= 0.72:
            scored.append({"id": game["id"], "title": game["title"], "slug": game["slug"], "score": round(ratio, 3)})
    return sorted(scored, key=lambda item: item["score"], reverse=True)[:5]


def gsl_candidates(title: str) -> list[dict[str, Any]]:
    path = CACHE_DIR / "gsl_game_data.json"
    if not path.exists():
        return []
    try:
        cache = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    source = normalize(title)
    matches = []
    for slug, wrapped in cache.items():
        game = ((wrapped or {}).get("data") or {}).get("game") or {}
        target = normalize(game.get("title") or "")
        if not target:
            continue
        score = 1.0 if source == target else difflib.SequenceMatcher(None, source, target).ratio()
        if score >= 0.65:
            matches.append({"slug": slug, "title": game.get("title"), "score": round(score, 3), "url": f"https://gamestorylog.com/games/{slug}"})
    return sorted(matches, key=lambda item: item["score"], reverse=True)[:5]


def fetch_steamspy_app(appid: int) -> dict[str, Any] | None:
    """Fallback metadata for delisted apps absent from Steam appdetails."""
    path = CACHE_DIR / "steam_library_steamspy_details.json"
    cache = ProgressCache(path)
    key = str(appid)
    if key not in cache:
        url = f"https://steamspy.com/api.php?request=appdetails&appid={appid}"
        request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                value = json.load(response)
            cache.set(key, value if isinstance(value, dict) and value.get("name") else None)
        except Exception as error:  # noqa: BLE001 - report missing fallback explicitly
            print(f"  SteamSpy fallback failed for {appid}: {error}", file=sys.stderr)
            cache.set(key, None)
        cache.flush()
        time.sleep(1.0)
    return cache.get(key)


def steamspy_genres(data: dict[str, Any]) -> set[str]:
    tags = data.get("tags") or {}
    genres = genres_from_tags(tags, 20)
    for name in (data.get("genre") or "").split(","):
        slug = STEAM_API_GENRES.get(name.strip())
        if slug:
            genres.add(slug)
    return genres


def cover_candidate(appid: int, gsl_slug: str | None) -> str | None:
    """Resolve an approved portrait or Steam fallback image before offering creation."""
    url = find_cover_url(
        appid,
        server_env("game-encyclopedia")["STEAMGRIDDB_API_KEY"],
        COVER_CACHE,
    )
    if url or not gsl_slug:
        return url
    path = CACHE_DIR / "gsl_game_data.json"
    if not path.exists():
        return None
    cache = json.loads(path.read_text(encoding="utf-8"))
    return (((cache.get(gsl_slug) or {}).get("data") or {}).get("game") or {}).get("cover_image_url")


def fetch_plan(delay: float) -> list[dict[str, Any]]:
    library = fetch_library()
    client = DirectusClient.from_config()
    games = fetch_games(client)
    owned_ids, games = directus_index(games)
    # Twice Burned is intentionally excluded even if its app remains in Steam.
    pending = [game for game in library if game["appid"] not in owned_ids and normalize(game["name"]) != "twiceburned" and game["appid"] not in BLOCKED_APPIDS]
    print(f"Steam owned: {len(library)} | Directus Steam links: {len(owned_ids)} | Unlinked: {len(pending)}", file=sys.stderr)
    rows = []
    for index, steam_game in enumerate(pending, 1):
        appid = steam_game["appid"]
        print(f"[{index}/{len(pending)}] {steam_game['name']} ({appid})", file=sys.stderr)
        details, error = fetch_steam_details(appid, base_delay=delay)
        if details is None:
            fallback = fetch_steamspy_app(appid)
            if re.search(r"\b(demo|playtest|beta|public testing|sniper challenge)\b", steam_game["name"], re.I):
                rows.append({**steam_game, "action": "skip", "reason": "test_or_companion_app"})
                continue
            if fallback and "free to play" in (fallback.get("genre") or "").casefold():
                rows.append({**steam_game, "action": "skip", "reason": "free_to_play"})
                continue
            if fallback and appid not in BLOCKED_APPIDS:
                title = fallback.get("name") or steam_game["name"]
                matches = candidate_matches(title, games)
                direct = next((game for game in games if normalize(game.get("title", "")) == normalize(title)), None)
                target_slug = TARGET_SLUGS.get(appid) or (direct["slug"] if direct else None)
                action = "link_existing" if target_slug else ("create" if appid in FORCE_CREATE_APPIDS or not matches else "review_match")
                creators = [part.strip() for part in (fallback.get("developer") or "").split(",") if part.strip()]
                genres = steamspy_genres(fallback)
                genres -= TITLE_GENRE_EXCLUSIONS.get(normalize(title), set())
                rows.append({
                    **steam_game, "title": title, "slug": slugify(title), "action": action,
                    "target_slug": target_slug, "existing_matches": matches,
                    "metadata_source": "steamspy", "release_year": None,
                    "game_status": "released", "player_status": "not_started",
                    "family_sharing": False, "genres": sorted(genres), "developers": creators,
                    "download_url": f"https://store.steampowered.com/app/{appid}/",
                    "gsl_candidates": gsl_candidates(title) if ("avn" in genres or "visual-novel" in genres) else [],
                })
                continue
            exact = next((game for game in games if normalize(game.get("title", "")) == normalize(steam_game["name"])), None)
            if appid in TARGET_SLUGS:
                rows.append({**steam_game, "title": steam_game["name"], "action": "link_existing", "target_slug": TARGET_SLUGS[appid], "reason": error or "steam_error"})
            elif exact:
                rows.append({**steam_game, "title": steam_game["name"], "action": "link_existing", "target_slug": exact["slug"], "reason": error or "steam_error"})
            else:
                rows.append({**steam_game, "action": "skip", "reason": error or "steam_error", "existing_matches": candidate_matches(steam_game["name"], games)})
            continue
        title = details.get("name") or steam_game["name"]
        name_norm = normalize(title)
        if details.get("type") != "game" or details.get("is_free") or re.search(r"\b(demo|playtest|beta|public testing)\b", title, re.I):
            rows.append({**steam_game, "title": title, "action": "skip", "reason": "non_paid_or_non_game_or_test_app", "steam_type": details.get("type"), "is_free": details.get("is_free")})
            continue
        if name_norm == "twiceburned":
            rows.append({**steam_game, "title": title, "action": "excluded", "reason": "project_policy"})
            continue
        matches = candidate_matches(title, games)
        tags = fetch_steamspy_tags(appid, TAG_CACHE)
        genres = genres_from_tags(tags, 20)
        steam_genres = [item.get("description") for item in details.get("genres", [])]
        for genre in steam_genres:
            mapped = STEAM_API_GENRES.get(genre)
            if mapped and not (mapped == "rpg" and genres & {"arpg", "crpg", "jrpg"}):
                genres.add(mapped)
        nsfw = 3 in set(details.get("content_descriptors", {}).get("ids", [])) or "avn" in genres
        if nsfw:
            genres.add("avn")
            genres.add("visual-novel") if "Visual Novel" in tags else None
        genres -= TITLE_GENRE_EXCLUSIONS.get(normalize(title), set())
        release_year = extract_release_year((details.get("release_date") or {}).get("date", ""))
        # Existing title matches are review-only. Season/edition pages can be
        # combined on GSL, so title similarity never creates a GSL link by itself.
        direct_match = next((game for game in games if normalize(game.get("title", "")) == name_norm), None)
        if appid in TARGET_SLUGS:
            action, target_slug = "link_existing", TARGET_SLUGS[appid]
        elif direct_match:
            action, target_slug = "link_existing", direct_match["slug"]
        elif appid in FORCE_CREATE_APPIDS:
            action, target_slug = "create", None
        else:
            action, target_slug = ("review_match" if matches else "create"), None
        gsl = gsl_candidates(title) if nsfw or "visual-novel" in genres else []
        rows.append({
            **steam_game, "appid": appid, "title": title, "slug": slugify(title),
            "action": action, "target_slug": target_slug, "existing_matches": matches,
            "gsl_slug": GSL_LINKS_BY_APPID.get(appid),
            "gsl_candidates": gsl,
            "release_year": release_year, "game_status": derive_game_status(release_year),
            "player_status": "not_started", "family_sharing": any(x.get("description") == "Family Sharing" for x in details.get("categories", [])),
            "genres": sorted(genres), "developers": details.get("developers", []),
            "download_url": f"https://store.steampowered.com/app/{appid}/",
        })
        time.sleep(delay)
    for row in rows:
        if row.get("action") != "create":
            continue
        row["cover_url"] = cover_candidate(
            int(row["appid"]), row.get("gsl_slug")
        )
        if not row["cover_url"]:
            row["action"] = "review_cover_missing"
            row["reason"] = "no suitable Steam, SteamGridDB, or linked GameStoryLog cover found"
    PLAN.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
    TAG_CACHE.flush()
    COVER_CACHE.flush()
    write_report(rows)
    return rows


def write_report(rows: list[dict[str, Any]]) -> None:
    counts: dict[str, int] = {}
    lines = ["# Steam library import review", "", "Generated from the live Steam owned-games API and Directus. `create` rows have no plausible title match and are eligible for idempotent import. `link_existing` rows add an owned Steam app to an existing Directus game, including grouped episodic titles. Review title and GameStoryLog candidates before linking them.", ""]
    for row in rows:
        counts[row["action"]] = counts.get(row["action"], 0) + 1
    lines.extend([f"- {key}: {value}" for key, value in sorted(counts.items())])
    lines.extend(["", "## Rows", ""])
    for row in rows:
        lines.append(f"### {row.get('title', row['name'])} (`{row['appid']}`) — {row['action']}")
        if row.get("reason"):
            lines.append(f"- Reason: {row['reason']}")
        if row.get("target_slug"):
            lines.append(f"- Link to Directus: `{row['target_slug']}`")
        if row.get("gsl_slug"):
            lines.append(f"- GameStoryLog: [shared page](https://gamestorylog.com/games/{row['gsl_slug']})")
        for match in row.get("existing_matches", []):
            lines.append(f"- Directus: {match['title']} (`{match['slug']}`, score {match['score']})")
        for match in row.get("gsl_candidates", []):
            lines.append(f"- GSL candidate: [{match['title']}](https://gamestorylog.com/games/{match['slug']}) (score {match['score']})")
        lines.append("")
    REPORT.write_text("\n".join(lines), encoding="utf-8")


def upsert_developer(client: DirectusClient, name: str, cache: dict[str, int]) -> int | None:
    if name in cache:
        return cache[name]
    slug = slugify(name)
    found = client.get("/items/developers", params={"filter[slug][_eq]": slug, "fields": "id,name", "limit": 1}).get("data", [])
    if found:
        cache[name] = found[0]["id"]
        return cache[name]
    try:
        record = client.post("/items/developers", {"name": name, "slug": slug})["data"]
    except urllib.error.HTTPError as error:
        body = error.read().decode(errors="replace")
        found = client.get("/items/developers", params={"filter[slug][_eq]": slug, "fields": "id,name", "limit": 1}).get("data", [])
        if not found:
            print(f"  developer {name}: HTTP {error.code} {body[:120]}", file=sys.stderr)
            return None
        record = found[0]
    cache[name] = record["id"]
    return record["id"]


def apply_plan(limit: int | None, enrich: bool) -> int:
    if not PLAN.exists():
        raise SystemExit("No plan found; run without --apply first")
    plan = json.loads(PLAN.read_text(encoding="utf-8"))
    client = DirectusClient.from_config()
    genres = client.get("/items/genres", params={"fields": "id,slug", "limit": -1}).get("data", [])
    genre_ids = {item["slug"]: item["id"] for item in genres}
    dev_cache: dict[str, int] = {}
    created: list[str] = []
    candidates = [row for row in plan if row.get("action") in {"create", "link_existing"}]
    if limit is not None:
        candidates = candidates[:limit]
    for row in candidates:
        appid = int(row["appid"])
        # Re-read links immediately before writes, so a stale plan cannot duplicate.
        current = client.get("/items/games", params={"fields": "id,title,slug,links.url,links.kind", "filter[links][kind][_eq]": "download", "limit": -1}).get("data", [])
        existing = next((game for game in current if any(link.get("kind") == "download" and extract_steam_appid(link.get("url")) == appid for link in game.get("links", []))), None)
        if existing:
            print(f"SKIP already linked {row['title']} -> {existing['slug']}")
            continue
        if row.get("action") == "link_existing":
            target = client.get("/items/games", params={"filter[slug][_eq]": row["target_slug"], "fields": "id,title,slug", "limit": 1}).get("data", [])
            if not target:
                print(f"REVIEW missing configured target {row['target_slug']}")
                continue
            client.post("/items/games_links", {"games_id": target[0]["id"], "url": row["download_url"], "kind": "download"})
            created.append(target[0]["slug"])
            print(f"LINKED {row['title']} ({appid}) -> {target[0]['slug']}")
            continue
        title, slug = row["title"], row["slug"]
        # A title collision added after planning must be reviewed, not duplicated.
        collision = client.get("/items/games", params={"filter[slug][_eq]": slug, "fields": "id,title,slug", "limit": 1}).get("data", [])
        if collision:
            print(f"REVIEW slug collision: {title} -> {collision[0]['title']}")
            continue
        cover_url = row.get("cover_url") or find_cover_url(appid, server_env("game-encyclopedia")["STEAMGRIDDB_API_KEY"], COVER_CACHE)
        if not cover_url and row.get("gsl_slug"):
            gsl_path = CACHE_DIR / "gsl_game_data.json"
            gsl_data = json.loads(gsl_path.read_text(encoding="utf-8")) if gsl_path.exists() else {}
            cover_url = (((gsl_data.get(row["gsl_slug"]) or {}).get("data") or {}).get("game") or {}).get("cover_image_url")
            if cover_url:
                print(f"  Using shared GameStoryLog cover: {row['gsl_slug']}")
        if not cover_url:
            print(f"REVIEW no capsule source found: {title}")
            continue
        cover_id = import_steam_cover(client, appid, title, slug, cover_url) if cover_url else None
        if not cover_id:
            print(f"REVIEW capsule import failed; game not created: {title}")
            continue
        data = {
            "title": title, "slug": slug, "release_year": row.get("release_year"),
            "game_status": row.get("game_status", "unreleased"),
            "player_status": "not_started", "family_sharing": row.get("family_sharing", False),
            "nsfw": "avn" in row.get("genres", []),
        }
        if row.get("gsl_slug"):
            gsl_cache_path = CACHE_DIR / "gsl_game_data.json"
            gsl_cache = json.loads(gsl_cache_path.read_text(encoding="utf-8")) if gsl_cache_path.exists() else {}
            gsl_status = (((gsl_cache.get(row["gsl_slug"]) or {}).get("data") or {}).get("game") or {}).get("status")
            if gsl_status and gsl_status.casefold() == "active":
                data["game_status"] = "in_development"
        created_game = client.post("/items/games", data)["data"]
        game_id = created_game["id"]
        actual_slug = created_game.get("slug") or slug
        if cover_id:
            set_game_capsule(client, game_id, cover_id, cover_url)
        client.post("/items/games_links", {"games_id": game_id, "url": row["download_url"], "kind": "download", "sort": 1})
        if row.get("gsl_slug"):
            client.post("/items/games_links", {"games_id": game_id, "url": f"https://gamestorylog.com/games/{row['gsl_slug']}", "kind": "gamestorylog"})
        for genre in row.get("genres", []):
            if genre in genre_ids:
                client.post("/items/games_genres", {"games_id": game_id, "genres_id": genre_ids[genre]})
        for name in row.get("developers", []):
            developer_id = upsert_developer(client, name, dev_cache)
            if developer_id:
                client.post("/items/games_developers", {"games_id": game_id, "developers_id": developer_id})
        created.append(actual_slug)
        print(f"IMPORTED {title} ({appid}) -> {actual_slug} id={game_id}")
        time.sleep(0.2)
    COVER_CACHE.flush()
    (CACHE_DIR / "steam_library_imported_slugs.json").write_text(json.dumps(sorted(set(created)), indent=2), encoding="utf-8")
    if enrich:
        enrichment_slugs = []
        appid_to_slug: dict[int, str] = {}
        for game in fetch_games(client):
            for link in game.get("links") or []:
                if link.get("kind") == "download":
                    linked_appid = extract_steam_appid(link.get("url"))
                    if linked_appid:
                        appid_to_slug[linked_appid] = game["slug"]
        for row in candidates:
            if row.get("action") == "create":
                actual_slug = appid_to_slug.get(int(row["appid"]))
                if actual_slug:
                    enrichment_slugs.append(actual_slug)
            elif row.get("action") == "link_existing":
                enrichment_slugs.append(row["target_slug"])
        run_enrichment([slug for slug in enrichment_slugs if slug])
    print(f"Created or linked {len(created)} Steam library entries")
    return 0


def run_enrichment(slugs: list[str]) -> None:
    import subprocess
    wanted = list(dict.fromkeys(slugs))
    directus = DirectusClient.from_config()
    games = directus.get("/items/games", params={"fields": "slug", "limit": -1}).get("data", [])
    present = {game["slug"] for game in games}
    selected = [slug for slug in wanted if slug in present]
    if not selected:
        print("No existing Directus games in the applied plan need enrichment.")
        return
    commands = [
        ["uv", "run", "--with", "steam[client]", "python", str(ROOT / "mcp/scripts/backfill_games_art.py"), "--apply", "--steps", "steam", *sum((["--slug", slug] for slug in selected), [])],
    ]
    current = DirectusClient.from_config()
    games = fetch_games(current)
    appid_to_slug = {
        extract_steam_appid(link.get("url")): game["slug"]
        for game in games
        for link in game.get("links") or []
        if link.get("kind") == "download" and extract_steam_appid(link.get("url"))
    }
    gsl_slugs = [
        appid_to_slug[int(row["appid"])]
        for row in json.loads(PLAN.read_text(encoding="utf-8"))
        if row.get("gsl_slug") and int(row["appid"]) in appid_to_slug
        and appid_to_slug[int(row["appid"])] in selected
    ]
    if gsl_slugs:
        gsl_args = ["--only-slug", gsl_slugs[0]]
        for slug in gsl_slugs[1:]:
            gsl_args.extend(("--only-slug", slug))
        commands.extend([
            [sys.executable, str(ROOT / "mcp/scripts/ignored/backfill_gsl_synopsis.py"), *gsl_args],
            [sys.executable, str(ROOT / "mcp/scripts/ignored/backfill_gsl_synopsis.py"), "--apply", "--include-shared", *gsl_args],
        ])
    commands.append([
        sys.executable, str(ROOT / "mcp/scripts/backfill_steam_synopsis.py"), "--empty-only",
        *sum((["--only-slug", slug] for slug in selected), []),
    ])
    commands.append([
        sys.executable, str(ROOT / "mcp/scripts/backfill_steam_synopsis.py"), "--apply", "--empty-only",
        *sum((["--only-slug", slug] for slug in selected), []),
    ])
    steam_plan_index = len(commands) - 2
    for index, command in enumerate(commands):
        completed = subprocess.run(command, cwd=ROOT, check=False)
        if completed.returncode and index == steam_plan_index:
            # The synopsis planner saves partial plans when some old/delisted
            # Steam apps have no appdetails. Apply the successful rows anyway.
            print("Steam synopsis planning had unavailable app metadata; applying the saved partial plan.", file=sys.stderr)
            continue
        if completed.returncode:
            raise subprocess.CalledProcessError(completed.returncode, command)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="apply the saved create rows")
    parser.add_argument("--limit", type=int, help="limit imported rows")
    parser.add_argument("--delay", type=float, default=1.2, help="delay between Steam app lookups")
    parser.add_argument("--enrich", action="store_true", help="after import, run complete Steam art and synopsis backfills")
    args = parser.parse_args()
    if args.apply:
        return apply_plan(args.limit, args.enrich)
    rows = fetch_plan(args.delay)
    print(f"Plan: {PLAN}\nReview: {REPORT}")
    counts: dict[str, int] = {}
    for row in rows:
        counts[row["action"]] = counts.get(row["action"], 0) + 1
    print(f"Rows: {len(rows)}; " + "; ".join(f"{action}: {count}" for action, count in sorted(counts.items())))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
