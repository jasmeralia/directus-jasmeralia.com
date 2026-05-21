#!/usr/bin/env python3
"""
Fetch GSL game data and import missing AVNs into Directus.

Phase 1 (default): Fetch metadata from gsl-cache-api for each slug,
  write cache/gsl_game_data.json.

Phase 2 (--import): Read cached data and create games in Directus
  (skips any already present by gamestorylog_url or title match).

Usage:
    python3 gsl_import.py            # fetch GSL metadata
    python3 gsl_import.py --import   # import to Directus
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
_mcp = json.load(open(Path(__file__).parent.parent.parent / ".mcp.json"))
DIRECTUS_URL = "https://directus.jasmer.tools"
DIRECTUS_TOKEN = _mcp["mcpServers"]["directus"]["env"]["DIRECTUS_TOKEN"]

# GSL's publicly-exposed frontend key (read-only, safe to use for public game data)
GSL_CACHE_URL = "https://gsl-cache-api.gamestorylog.workers.dev/"
GSL_AUTH = "Bearer sb_publishable_qQv-EBnc_aXnjvQUN3YDpQ_X7IzzLno"

# 46 games from user's GSL library not yet in Directus
GSL_SLUGS = [
    "60-days-of-us",
    "anna-exciting-affection",
    "aurelia",
    "crimson-high",
    "cybernetic-seduction",
    "defending-lydia-collier",
    "dilemma-of-devotion",
    "echoes-of-the-cataclysm",
    "eden",
    "empire-of-heroes",
    "growing-things-up",
    "guilty-pleasure",
    "harem-of-ankhute",
    "heliorise",
    "high-desire",
    "karlssons-gambit",
    "kicked-out-king",
    "leaving-dna",
    "life-in-santa-county",
    "lisa-total-investigation",
    "long-story-short",
    "love-sex-second-base",
    "love-of-magic",
    "midnight-paradise",
    "mist",
    "my-bimbo-dream",
    "new-horizon",
    "out-of-touch",
    "paper-hearts",
    "realm-invader",
    "realmwalker",
    "scions-of-the-divine",
    "sexbot-ii-recalibrated",
    "sorcerer",
    "stwa-the-author",
    "survivor-strain",
    "the-darkness-within",
    "the-inn",
    "the-interim-domain",
    "the-last-embrace",
    "tropicali",
    "true-love-the-game",
    "virtues",
    "westview-academy",
    "where-it-all-began",
    "young-again",
]

# GSL engine string → Directus engine slug
ENGINE_NAME_MAP = {
    "Ren'Py": "ren-py",
    "Ren'py": "ren-py",
    "renpy": "ren-py",
    "HS": "honey-select",
    "HS2": "honey-select",
    "Unity": "unity",
    "Unreal": "unreal-engine",
    "HTML": "html",
    "RPGM": "rpgm",
    "Twine": "twine",
    "DAZ": "daz-3d",
    "Flash": "flash",
    "RAGS": "rags",
    "WebGL": "webgl",
    "TyranoBuilder": "tyranobuilder",
}


# ── GSL API ──────────────────────────────────────────────────────────────────

def gsl_fetch(slug: str) -> dict | None:
    body = json.dumps({"endpoint": "game_page_public", "params": {"id": slug}}).encode()
    req = urllib.request.Request(
        GSL_CACHE_URL, data=body, method="POST",
        headers={
            "Authorization": GSL_AUTH,
            "Content-Type": "application/json",
            "Accept": "*/*",
            "Origin": "https://gamestorylog.com",
            "Referer": "https://gamestorylog.com/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
        },
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if attempt < 2:
                time.sleep(2 ** attempt * 2)
            else:
                print(f"  HTTP {e.code} for {slug}", file=sys.stderr)
                return None
        except Exception as e:
            if attempt < 2:
                time.sleep(2 ** attempt * 2)
            else:
                print(f"  Error fetching {slug}: {e}", file=sys.stderr)
                return None
    return None


# ── Directus helpers ─────────────────────────────────────────────────────────

def directus_get(path: str) -> dict:
    req = urllib.request.Request(f"{DIRECTUS_URL}{path}", headers={
        "Authorization": f"Bearer {DIRECTUS_TOKEN}", "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def directus_post(path: str, body: dict) -> dict:
    data = json.dumps(body).encode()
    req = urllib.request.Request(f"{DIRECTUS_URL}{path}", data=data, method="POST", headers={
        "Authorization": f"Bearer {DIRECTUS_TOKEN}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def directus_patch(path: str, body: dict) -> dict:
    data = json.dumps(body).encode()
    req = urllib.request.Request(f"{DIRECTUS_URL}{path}", data=data, method="PATCH", headers={
        "Authorization": f"Bearer {DIRECTUS_TOKEN}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


# ── Utilities ────────────────────────────────────────────────────────────────

def pick_download_url(game: dict) -> str | None:
    """Return best URL: steam > itch > patreon/subscribestar > website > other."""
    creator = game.get("creator") or {}
    candidates: list[str] = []

    for field in [
        game.get("download_url"),
        game.get("website_url"),
        game.get("patreon_url"),
        creator.get("website"),
        creator.get("patreon_url"),
    ]:
        if field and isinstance(field, str) and field.strip():
            candidates.append(field.strip())

    for raw in [game.get("other_urls", ""), creator.get("other_urls", "")]:
        if raw:
            for u in re.split(r"[\n,;\s]+", str(raw)):
                u = u.strip()
                if u.startswith("http"):
                    candidates.append(u)

    # Version download links
    for v in game.get("versions") or []:
        u = v.get("download_url")
        if u and isinstance(u, str) and u.strip():
            candidates.append(u.strip())

    for priority in ["store.steampowered.com", "itch.io", "patreon.com", "subscribestar.adult", "subscribestar.com"]:
        for u in candidates:
            if priority in u:
                return u

    return candidates[0] if candidates else None


def make_slug(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")


def extract_year(date_str: str | None) -> int | None:
    if not date_str:
        return None
    m = re.match(r"(\d{4})", date_str)
    return int(m.group(1)) if m else None


# ── Phase 1: Fetch ───────────────────────────────────────────────────────────

def fetch_phase():
    out_path = CACHE / "gsl_game_data.json"
    data: dict = {}
    if out_path.exists():
        data = json.loads(out_path.read_text())
    print(f"Loaded {len(data)} cached entries", file=sys.stderr)

    for i, slug in enumerate(GSL_SLUGS):
        if slug in data:
            game = (data[slug].get("data") or {}).get("game") or {}
            label = game.get("title") or "cached"
            print(f"[{i+1}/{len(GSL_SLUGS)}] {slug} — skip ({label})", file=sys.stderr)
            continue

        print(f"[{i+1}/{len(GSL_SLUGS)}] Fetching {slug}...", file=sys.stderr)
        result = gsl_fetch(slug)
        if result is None:
            data[slug] = {"error": "not_found"}
            print(f"  NOT FOUND", file=sys.stderr)
        else:
            data[slug] = result
            game = (result.get("data") or {}).get("game") or {}
            creator = (game.get("creator") or {}).get("name", "?")
            print(f"  {game.get('title')} | engine={game.get('engine')} | dev={creator}", file=sys.stderr)
        out_path.write_text(json.dumps(data, indent=2))
        time.sleep(0.5)

    print(f"\nAll done. {out_path}", file=sys.stderr)
    errors = [s for s, v in data.items() if isinstance(v, dict) and "error" in v]
    if errors:
        print(f"Not found on GSL: {errors}", file=sys.stderr)


# ── Phase 2: Import ──────────────────────────────────────────────────────────

def import_phase():
    data_path = CACHE / "gsl_game_data.json"
    progress_path = CACHE / "gsl_import_progress.json"

    if not data_path.exists():
        print("No data file — run without --import first.", file=sys.stderr)
        sys.exit(1)

    all_data: dict = json.loads(data_path.read_text())
    progress: dict = {}
    if progress_path.exists():
        progress = json.loads(progress_path.read_text())

    # Reference tables
    print("Loading Directus reference data...", file=sys.stderr)
    genre_rows = directus_get("/items/genres?fields=id,slug&limit=-1")["data"]
    slug_to_genre = {g["slug"]: g["id"] for g in genre_rows}

    engine_rows = directus_get("/items/engines?fields=id,slug&limit=-1")["data"]
    slug_to_engine = {e["slug"]: e["id"] for e in engine_rows}
    print(f"  Engines: {sorted(slug_to_engine.keys())}", file=sys.stderr)

    dev_rows = directus_get("/items/developers?fields=id,name,slug&limit=-1")["data"]
    name_to_dev = {d["name"].lower(): d["id"] for d in dev_rows}
    slug_to_dev = {d["slug"]: d["id"] for d in dev_rows}

    existing_rows = directus_get(
        "/items/games?fields=id,title,gamestorylog_url&filter[gamestorylog_url][_nnull]=true&limit=-1"
    )["data"]
    gsl_url_to_id = {g["gamestorylog_url"]: g["id"] for g in existing_rows if g.get("gamestorylog_url")}

    all_title_rows = directus_get("/items/games?fields=id,title&limit=-1")["data"]
    title_to_id = {g["title"].lower(): g["id"] for g in all_title_rows}

    created = skipped = errors = 0

    for slug, entry in all_data.items():
        if isinstance(entry, dict) and "error" in entry:
            print(f"SKIP {slug}: not on GSL", file=sys.stderr)
            skipped += 1
            continue

        if progress.get(slug) == "done":
            skipped += 1
            continue

        game = (entry.get("data") or {}).get("game") or {}
        if not game:
            print(f"SKIP {slug}: no game data", file=sys.stderr)
            skipped += 1
            continue

        title = game["title"]
        gsl_url = f"https://gamestorylog.com/games/{slug}"

        if gsl_url in gsl_url_to_id:
            print(f"SKIP {title}: already in Directus (gsl_url match)", file=sys.stderr)
            progress[slug] = "done"
            progress_path.write_text(json.dumps(progress, indent=2))
            skipped += 1
            continue

        if title.lower() in title_to_id:
            existing_id = title_to_id[title.lower()]
            print(f"FOUND {title} (id={existing_id}) — setting gamestorylog_url", file=sys.stderr)
            try:
                directus_patch(f"/items/games/{existing_id}", {"gamestorylog_url": gsl_url})
                progress[slug] = "done"
                progress_path.write_text(json.dumps(progress, indent=2))
                skipped += 1
            except Exception as e:
                print(f"  ERROR patching gamestorylog_url: {e}", file=sys.stderr)
                errors += 1
            continue

        print(f"Importing: {title}...", file=sys.stderr)
        try:
            # Cover art
            cover_url = game.get("cover_image_url")
            cover_id = None
            if cover_url:
                try:
                    r = directus_post("/files/import", {
                        "url": cover_url,
                        "data": {"title": f"{title} - Cover"},
                    })
                    cover_id = r["data"]["id"]
                except Exception as e:
                    print(f"  Cover import failed: {e}", file=sys.stderr)

            # Engine
            engine_str = game.get("engine") or ""
            engine_slug = ENGINE_NAME_MAP.get(engine_str)
            engine_id = slug_to_engine.get(engine_slug) if engine_slug else None
            if engine_str and not engine_id:
                print(f"  WARN: unknown engine '{engine_str}' — skipping engine link", file=sys.stderr)

            # Developer
            creator = game.get("creator") or {}
            dev_name = (creator.get("name") or "").strip()
            dev_id = name_to_dev.get(dev_name.lower()) or slug_to_dev.get(creator.get("slug", ""))
            if not dev_id and dev_name:
                dev_slug = make_slug(dev_name)
                r = directus_post("/items/developers", {"name": dev_name, "slug": dev_slug})
                dev_id = r["data"]["id"]
                name_to_dev[dev_name.lower()] = dev_id
                print(f"  Created developer: {dev_name}", file=sys.stderr)

            # Download URL
            download_url = pick_download_url(game)

            # Release year
            release_year = extract_year(game.get("release_date") or game.get("created_at"))

            # Create game
            payload: dict = {
                "title": title,
                "slug": make_slug(title),
                "game_status": "released",
                "player_status": "not_started",
                "gamestorylog_url": gsl_url,
            }
            if cover_id:
                payload["cover_image"] = cover_id
            if download_url:
                payload["download_url"] = download_url
            if release_year:
                payload["release_year"] = release_year

            r = directus_post("/items/games", payload)
            game_id = r["data"]["id"]

            # Genres: always avn + visual-novel
            for gs in ["avn", "visual-novel"]:
                gid = slug_to_genre.get(gs)
                if gid:
                    directus_post("/items/games_genres", {"games_id": game_id, "genres_id": gid})

            # Developer
            if dev_id:
                directus_post("/items/games_developers", {"games_id": game_id, "developers_id": dev_id})

            # Engine (via PATCH — replaces engines list)
            if engine_id:
                directus_patch(f"/items/games/{game_id}", {"engines": [{"engines_id": engine_id}]})

            progress[slug] = "done"
            progress_path.write_text(json.dumps(progress, indent=2))
            created += 1
            print(f"  Created id={game_id}: {title} (engine={engine_str}, dev={dev_name})", file=sys.stderr)

        except Exception as e:
            import traceback
            print(f"  ERROR {title}: {e}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            progress[slug] = f"error: {e}"
            progress_path.write_text(json.dumps(progress, indent=2))
            errors += 1

    print(f"\nDone: {created} created, {skipped} skipped, {errors} errors", file=sys.stderr)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--import", dest="do_import", action="store_true",
                   help="Import to Directus (default: fetch only)")
    args = p.parse_args()
    if args.do_import:
        import_phase()
    else:
        fetch_phase()


if __name__ == "__main__":
    main()
