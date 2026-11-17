#!/usr/bin/env python3
"""
Fetch GSL game data and import or refresh AVNs in Directus.

Phase 1 (default): Fetch metadata from gsl-cache-api for each slug,
  write cache/gsl_game_data.json.

Phase 2 (--import): Read GSL data and create missing games, or update existing
  games with the GSL link, download links, rendering agent, and (when the GSL
  page maps to exactly one Directus game) GSL game status.

Usage:
    python3 gsl_import.py [slug ...]                   # fetch GSL metadata
    python3 gsl_import.py --import [slug ...]           # import built-in/listed slugs
    python3 gsl_import.py --import --ids 123 456       # update selected Directus IDs
    python3 gsl_import.py --import --ids 123,456       # comma-separated IDs also work
    python3 gsl_import.py --import --refresh [slug ...] # refetch and refresh existing matches
    python3 gsl_import.py --import --ids 123 --refresh # refetch and refresh selected ID

With no slugs or IDs, the built-in GSL_SLUGS list is used. --ids selects existing
Directus games by ID; each must already have a GameStoryLog link. --refresh bypasses
cached GSL data and updates matched existing games, including download links.
Download links are added from GSL game and creator metadata. Shared GSL pages are
not used to infer a game-specific download link or status for multiple Directus
games. GSL statuses map Unreleased -> unreleased, Active -> in_development, and
Completed -> released. GSL Media tags HS, DAZ3D, and Virt-A-Mate map to their
Directus rendering engines. GSL Genre tags map by normalized slug to matching
Directus genres; the GSL Relationship tag Harem maps to the Directus Harem genre.
Genre tags without a matching Directus genre slug are printed and included in
the review report for consideration. Import mode is a dry run unless --apply is supplied.

GSL average playtime is stored as ``games.gsl_average_playtime_minutes``. GSL
Genre, Gameplay, Protagonist, Relationship, Orientation, and Media tags are
stored in ``games.gsl_tags``; the TitleDeck synopsis formatter currently omits
Media tags from its display.

A new game's GSL cover is imported as a games_art row of kind "capsule" (not into
the deprecated games.cover_image field). Logo and icon rows for Ren'Py games, and
Steam art, come from backfill_games_art.py.
"""

import argparse
import json
import re
import sys
import time
import traceback
import urllib.parse
import urllib.error
import urllib.request
from pathlib import Path

CACHE = Path(__file__).parent.parent.parent / "cache"
MANUAL_REVIEW_JSON = CACHE / "gsl_download_links_manual_review.json"
MANUAL_REVIEW_MD = CACHE / "gsl_download_links_manual_review.md"
with open(
    Path(__file__).parent.parent.parent.parent / ".mcp.json", encoding="utf-8"
) as _f:
    _mcp = json.load(_f)
DIRECTUS_URL = "https://directus.jasmer.tools"
DIRECTUS_TOKEN = _mcp["mcpServers"]["directus"]["env"]["DIRECTUS_TOKEN"]

# GSL's publicly-exposed frontend key (read-only, safe to use for public game data)
GSL_CACHE_URL = "https://gsl-cache-api.gamestorylog.workers.dev/"
GSL_AUTH = "Bearer sb_publishable_qQv-EBnc_aXnjvQUN3YDpQ_X7IzzLno"
GSL_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
)

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
    "HS1": "honey-select",
    "HS2": "honey-select",
    "Honey Select": "honey-select",
    "Honey Select 2": "honey-select",
    "HoneySelect": "honey-select",
    "Unity": "unity",
    "Unreal": "unreal-engine",
    "HTML": "html",
    "RPGM": "rpgm",
    "Twine": "twine",
    "DAZ": "daz-3d",
    "Daz 3D": "daz-3d",
    "DAZ 3D": "daz-3d",
    "Daz3D": "daz-3d",
    "VAM": "virt-a-mate",
    "VaM": "virt-a-mate",
    "Virtamate": "virt-a-mate",
    "Virt-A-Mate": "virt-a-mate",
    "Virt-A-Mate (VaM)": "virt-a-mate",
    "VaM (Virt-A-Mate)": "virt-a-mate",
    "Koikatsu": "koikatsu",
    "Flash": "flash",
    "RAGS": "rags",
    "WebGL": "webgl",
    "TyranoBuilder": "tyranobuilder",
}

GSL_STATUS_MAP = {
    "unreleased": "unreleased",
    "active": "in_development",
    "completed": "released",
}

# GSL Media tags that identify rendering agents rather than game engines.
RENDERING_TAG_MAP = {
    "hs": "honey-select",
    "daz3d": "daz-3d",
    "virt-a-mate": "virt-a-mate",
    "koikatsu": "koikatsu",
}

# GSL uses Harem as a Relationship tag; Directus tracks it as a genre.
GSL_TAG_GENRE_MAP = {("relationship", "harem"): "harem"}
GSL_TAG_CATEGORIES = {
    "genre",
    "gameplay",
    "protagonist",
    "relationship",
    "orientation",
    "media",
}


# ── GSL API ──────────────────────────────────────────────────────────────────


def gsl_fetch(slug: str) -> dict | None:
    """Fetch a single game's public metadata from the GSL cache API."""
    body = json.dumps({"endpoint": "game_page_public", "params": {"id": slug}}).encode()
    req = urllib.request.Request(
        GSL_CACHE_URL,
        data=body,
        method="POST",
        headers={
            "Authorization": GSL_AUTH,
            "Content-Type": "application/json",
            "Accept": "*/*",
            "Origin": "https://gamestorylog.com",
            "Referer": "https://gamestorylog.com/",
            "User-Agent": GSL_USER_AGENT,
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
                time.sleep(2**attempt * 2)
            else:
                print(f"  HTTP {e.code} for {slug}", file=sys.stderr)
                return None
        except Exception as e:
            if attempt < 2:
                time.sleep(2**attempt * 2)
            else:
                print(f"  Error fetching {slug}: {e}", file=sys.stderr)
                return None
    return None


# ── Directus helpers ─────────────────────────────────────────────────────────


def directus_get(path: str) -> dict:
    """GET a Directus API path and return the parsed JSON response."""
    req = urllib.request.Request(
        f"{DIRECTUS_URL}{path}",
        headers={
            "Authorization": f"Bearer {DIRECTUS_TOKEN}",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def directus_post(path: str, body: dict) -> dict:
    """POST a JSON body to a Directus API path and return the parsed JSON response."""
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{DIRECTUS_URL}{path}",
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {DIRECTUS_TOKEN}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def directus_patch(path: str, body: dict) -> dict:
    """PATCH a JSON body to a Directus API path and return the parsed JSON response."""
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{DIRECTUS_URL}{path}",
        data=data,
        method="PATCH",
        headers={
            "Authorization": f"Bearer {DIRECTUS_TOKEN}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


# ── Utilities ────────────────────────────────────────────────────────────────


ALLOWED_STORE_HOSTS = (
    "steampowered.com",
    "steamcommunity.com",
    "itch.io",
    "gog.com",
    "patreon.com",
    "subscribestar.adult",
    "subscribestar.com",
)
BLOCKED_HOSTS = ("twitter.com", "x.com", "f95zone.to", "f95zone.com")
SKIPPED_URLS = {
    "https://kervn.itch.io/with-eyes-closed-s2",
    "https://store.steampowered.com/app/3417490/With_Eyes_Closed__Season_2/",
}
URL_CORRECTIONS = {
    "https://subscribestar.adult/sensi-games6":
        "https://subscribestar.adult/sensi-games",
}
STEAM_APP_RE = re.compile(r"/app/(\d+)")
GOG_GAME_RE = re.compile(r"/game/([^/]+)")


def host_of(url: str) -> str:
    """Return a URL's lowercased hostname, or an empty string if invalid."""
    try:
        return (urllib.parse.urlparse(url).hostname or "").lower()
    except ValueError:
        return ""


def host_matches(host: str, suffixes: tuple[str, ...]) -> bool:
    """Match a host exactly or as a subdomain of one of the suffixes."""
    return bool(host) and any(
        host == suffix or host.endswith("." + suffix) for suffix in suffixes
    )


def is_valid_http_url(url: str) -> bool:
    """Reject malformed URL tokens and concatenated URLs."""
    parsed = urllib.parse.urlsplit(url)
    return (
        parsed.scheme.lower() in {"http", "https"}
        and bool(parsed.hostname)
        and not re.search(r"https?://", url[len(parsed.scheme) + 3 :], re.IGNORECASE)
    )


def split_url_tokens(raw: str) -> list[str]:
    """Split GSL's delimited URL lists, including adjacent URL schemes."""
    return [
        token.strip().rstrip(":")
        for token in re.split(r"[;\n,\s]+|(?=https?://)", raw, flags=re.IGNORECASE)
        if token.strip().rstrip(":")
    ]


def is_real_store_page(host: str, url: str) -> bool:
    """Reject Steam curator/search pages that are not game store pages."""
    if host_matches(host, ("steampowered.com", "steamcommunity.com")):
        path = urllib.parse.urlparse(url).path
        return "/app/" in path or "/agecheck/app/" in path
    return True


def is_bare_itch_page(url: str) -> bool:
    """Return whether an itch URL points only to a creator profile."""
    parsed = urllib.parse.urlparse(url)
    host = (parsed.hostname or "").lower()
    return host_matches(host, ("itch.io",)) and host != "itch.io" and not parsed.path.strip("/")


def patreon_username_key(url: str) -> str | None:
    """Return a stable Patreon creator identity across common profile URL forms."""
    parsed = urllib.parse.urlsplit(url)
    if not host_matches((parsed.hostname or "").lower(), ("patreon.com",)):
        return None
    segments = [segment for segment in parsed.path.split("/") if segment]
    vanity = urllib.parse.parse_qs(parsed.query).get("vanity") or []
    if vanity and vanity[0]:
        return f"patreon:username:{urllib.parse.unquote(vanity[0]).casefold()}"
    if segments and segments[0].casefold() == "cw" and len(segments) > 1:
        return f"patreon:username:{urllib.parse.unquote(segments[1]).casefold()}"
    if segments and segments[0].casefold() == "c" and len(segments) > 1:
        user_ids = urllib.parse.parse_qs(parsed.query).get("u") or []
        if segments[1].casefold() == "user" and user_ids and user_ids[0]:
            return f"patreon:user-id:{user_ids[0]}"
        legacy_user = re.fullmatch(r"u(\d+)", segments[1], re.IGNORECASE)
        if legacy_user:
            return f"patreon:user-id:{legacy_user.group(1)}"
        username = segments[2] if segments[1].casefold() == "w" and len(segments) > 2 else segments[1]
    elif segments and segments[0].casefold() == "user":
        user_ids = urllib.parse.parse_qs(parsed.query).get("u") or []
        return f"patreon:user-id:{user_ids[0]}" if user_ids and user_ids[0] else None
    elif segments and segments[0].casefold() not in {
        "posts", "collections", "about", "membership", "join", "login", "explore"
    }:
        username = segments[0]
    else:
        return None
    return f"patreon:username:{urllib.parse.unquote(username).casefold()}" if username else None


def store_key(url: str) -> str | None:
    """Canonical identity for Steam, itch.io, and GOG game pages."""
    parsed = urllib.parse.urlparse(url)
    host = (parsed.hostname or "").lower()
    if host_matches(host, ("steampowered.com", "steamcommunity.com")):
        match = STEAM_APP_RE.search(parsed.path)
        return f"steam:{match.group(1)}" if match else None
    if host_matches(host, ("itch.io",)):
        return f"itch:{host}/{parsed.path.strip('/').lower()}"
    if host_matches(host, ("gog.com",)):
        match = GOG_GAME_RE.search(parsed.path)
        return f"gog:{match.group(1).lower()}" if match else None
    return None


def strip_tracking(url: str) -> str:
    """Normalize known corrections and remove tracking/query fragments."""
    url = URL_CORRECTIONS.get(url, url)
    if store_key(url) is None:
        parsed = urllib.parse.urlsplit(url)
        kept = [
            (key, value)
            for key, value in urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
            if key.lower() not in {"lang", "l", "snr"}
            and not key.lower().startswith("utm_")
        ]
        return urllib.parse.urlunsplit(
            parsed._replace(query=urllib.parse.urlencode(kept, doseq=True), fragment="")
        )
    parsed = urllib.parse.urlparse(url)
    return urllib.parse.urlunparse(parsed._replace(query="", fragment=""))


def collect_download_urls(game: dict) -> list[str]:
    """Collect qualifying game and creator download destinations from GSL."""
    creator = game.get("creator") or {}
    candidates: list[str] = []
    primary = (game.get("download_url") or "").strip()
    if is_valid_http_url(primary) and not host_matches(host_of(primary), BLOCKED_HOSTS):
        candidates.append(primary)

    # Retain the original importer's direct fields and version download links.
    for value in (game.get("website_url"), game.get("patreon_url")):
        token = (value or "").strip()
        if (
            is_valid_http_url(token)
            and not host_matches(host_of(token), BLOCKED_HOSTS)
            and token not in candidates
        ):
            candidates.append(token)
    for version in game.get("versions") or []:
        token = (version.get("download_url") or "").strip()
        if (
            is_valid_http_url(token)
            and not host_matches(host_of(token), BLOCKED_HOSTS)
            and token not in candidates
        ):
            candidates.append(token)

    for token in split_url_tokens(game.get("other_urls") or ""):
        if not is_valid_http_url(token):
            continue
        host = host_of(token)
        if (
            host_matches(host, ALLOWED_STORE_HOSTS)
            and not host_matches(host, BLOCKED_HOSTS)
            and is_real_store_page(host, token)
            and token not in candidates
        ):
            candidates.append(token)

    creator = game.get("creator") or {}
    creator_urls = [creator.get("patreon_url"), creator.get("website")]
    creator_urls.extend(split_url_tokens(creator.get("other_urls") or ""))
    for token in creator_urls:
        token = (token or "").strip()
        if (
            is_valid_http_url(token)
            and host_matches(
                host_of(token), ("patreon.com", "subscribestar.adult", "subscribestar.com")
            )
            and token not in candidates
        ):
            candidates.append(token)
    return candidates


def pick_download_url(game: dict) -> str | None:
    """Return the preferred single link used when creating a new game."""
    candidates = collect_download_urls(game)
    for host in ("steampowered.com", "itch.io", "gog.com", "patreon.com", "subscribestar"):
        for url in candidates:
            if host in url:
                return url
    return candidates[0] if candidates else None


def make_slug(title: str) -> str:
    """Slugify a title: lowercase, non-alnum runs collapsed to single hyphens."""
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")


def extract_year(date_str: str | None) -> int | None:
    """Pull a leading 4-digit year out of a date string, if present."""
    if not date_str:
        return None
    m = re.match(r"(\d{4})", date_str)
    return int(m.group(1)) if m else None


# ── Phase 1: Fetch ───────────────────────────────────────────────────────────


def fetch_phase(slugs: list[str], refresh: bool = False):
    """Fetch GSL metadata for each slug, caching results to disk."""
    out_path = CACHE / "gsl_game_data.json"
    data: dict = {}
    if out_path.exists():
        data = json.loads(out_path.read_text())
    print(f"Loaded {len(data)} cached entries", file=sys.stderr)

    for i, slug in enumerate(slugs):
        if slug in data and not refresh:
            game = (data[slug].get("data") or {}).get("game") or {}
            label = game.get("title") or "cached"
            print(
                f"[{i + 1}/{len(slugs)}] {slug} — skip ({label})", file=sys.stderr
            )
            continue

        print(f"[{i + 1}/{len(slugs)}] Fetching {slug}...", file=sys.stderr)
        result = gsl_fetch(slug)
        if result is None:
            data[slug] = {"error": "not_found"}
            print("  NOT FOUND", file=sys.stderr)
        else:
            data[slug] = result
            game = (result.get("data") or {}).get("game") or {}
            creator = (game.get("creator") or {}).get("name", "?")
            print(
                f"  {game.get('title')} | engine={game.get('engine')} | dev={creator}",
                file=sys.stderr,
            )
        out_path.write_text(json.dumps(data, indent=2))
        time.sleep(0.5)

    print(f"\nAll done. {out_path}", file=sys.stderr)
    errors = [s for s, v in data.items() if isinstance(v, dict) and "error" in v]
    if errors:
        print(f"Not found on GSL: {errors}", file=sys.stderr)


# ── Phase 2: Import ──────────────────────────────────────────────────────────


def load_reference_data() -> dict:
    """Load reference tables plus games and links needed to match safely."""
    print("Loading Directus reference data...", file=sys.stderr)
    genre_rows = directus_get("/items/genres?fields=id,slug&limit=-1")["data"]
    slug_to_genre = {g["slug"]: g["id"] for g in genre_rows}

    engine_rows = directus_get("/items/engines?fields=id,slug&limit=-1")["data"]
    slug_to_engine = {e["slug"]: e["id"] for e in engine_rows}
    print(f"  Engines: {sorted(slug_to_engine.keys())}", file=sys.stderr)

    dev_rows = directus_get("/items/developers?fields=id,name,slug&limit=-1")["data"]
    name_to_dev = {d["name"].lower(): d["id"] for d in dev_rows}
    slug_to_dev = {d["slug"]: d["id"] for d in dev_rows}

    all_title_rows = directus_get(
        "/items/games?fields=id,title,slug,game_status,gsl_average_playtime_minutes,gsl_tags,links.id,links.url,links.kind,links.sort,engines.engines_id.id&limit=-1"
    )["data"]
    games_by_id = {row["id"]: row for row in all_title_rows}
    gsl_url_to_games: dict[str, list[dict]] = {}
    gsl_slug_to_games: dict[str, list[dict]] = {}
    store_owners: dict[str, dict[int, str]] = {}
    for game in all_title_rows:
        for link in game.get("links") or []:
            url = link.get("url") or ""
            if link.get("kind") == "gamestorylog" and url:
                gsl_url_to_games.setdefault(url, []).append(game)
                gsl_slug_to_games.setdefault(gsl_slug_for_url(url), []).append(game)
            key = store_key(url)
            if key:
                store_owners.setdefault(key, {})[game["id"]] = game["title"]

    title_to_id = {g["title"].lower(): g["id"] for g in all_title_rows}
    genre_links = directus_get(
        "/items/games_genres?fields=games_id,genres_id&limit=-1"
    )["data"]
    genres_by_game: dict[int, set[int]] = {}
    for row in genre_links:
        game_id = row.get("games_id")
        genre_id = row.get("genres_id")
        if isinstance(game_id, dict):
            game_id = game_id.get("id")
        if isinstance(genre_id, dict):
            genre_id = genre_id.get("id")
        if game_id and genre_id:
            genres_by_game.setdefault(int(game_id), set()).add(int(genre_id))

    return {
        "slug_to_genre": slug_to_genre,
        "slug_to_engine": slug_to_engine,
        "name_to_dev": name_to_dev,
        "slug_to_dev": slug_to_dev,
        "games_by_id": games_by_id,
        "gsl_url_to_games": gsl_url_to_games,
        "gsl_slug_to_games": gsl_slug_to_games,
        "store_owners": store_owners,
        "review_flags": [],
        "genres_by_game": genres_by_game,
        "unmatched_genre_tags": {},
        "title_to_id": title_to_id,
    }


def add_game_link(game_id: int, url: str, kind: str) -> None:
    """Create a games_links row (download_url/gamestorylog_url no longer exist on games)."""
    directus_post("/items/games_links", {"games_id": game_id, "url": url, "kind": kind})


def add_game_art(game_id: int, kind: str, file_id: str, source_url: str | None) -> None:
    """Create a games_art row; covers live there now, not on games.cover_image."""
    directus_post(
        "/items/games_art",
        {
            "games_id": game_id,
            "kind": kind,
            "file": file_id,
            "language": "en",
            "scale": "1x",
            "source_url": source_url,
        },
    )


def import_cover(game: dict, title: str) -> str | None:
    """Import the game's cover image into Directus; returns the new file id, if any."""
    cover_url = game.get("cover_image_url")
    if not cover_url:
        return None
    try:
        r = directus_post(
            "/files/import",
            {"url": cover_url, "data": {"title": f"{title} - Cover"}},
        )
        return r["data"]["id"]
    except Exception as e:
        print(f"  Cover import failed: {e}", file=sys.stderr)
        return None


def resolve_engines(
    game: dict, slug_to_engine: dict, gsl_tags: list[dict] | None = None
) -> tuple[list[int], str]:
    """Resolve the GSL engine field and Media tags to Directus engine IDs."""
    engine_value = game.get("engine") or ""
    labels = list(engine_value) if isinstance(engine_value, list) else re.split(r"[,;/|]+", str(engine_value))
    rendering_tags = [
        tag.get("name", "")
        for tag in gsl_tags or []
        if (tag.get("category") or "").casefold() == "media"
    ]
    engine_ids = []
    for label in labels:
        label = str(label).strip()
        engine_slug = ENGINE_NAME_MAP.get(label) or next(
            (value for key, value in ENGINE_NAME_MAP.items() if key.casefold() == label.casefold()),
            None,
        )
        engine_id = slug_to_engine.get(engine_slug) if engine_slug else None
        if engine_id and engine_id not in engine_ids:
            engine_ids.append(engine_id)
        elif label and not engine_id:
            print(f"  WARN: unknown GSL engine '{label}' — skipping", file=sys.stderr)
    for tag_name in rendering_tags:
        engine_slug = RENDERING_TAG_MAP.get(tag_name.strip().casefold())
        engine_id = slug_to_engine.get(engine_slug) if engine_slug else None
        if engine_id and engine_id not in engine_ids:
            engine_ids.append(engine_id)
    return engine_ids, str(engine_value) + (f"; Media tags={rendering_tags}" if rendering_tags else "")


def resolve_gsl_tag_genres(gsl_tags: list[dict], slug_to_genre: dict) -> list[int]:
    """Map GSL Genre tags and the Harem Relationship tag to Directus genres."""
    genre_ids = []
    for tag in gsl_tags:
        category = (tag.get("category") or "").casefold()
        name = (tag.get("name") or "").strip()
        if category == "genre":
            genre_slug = make_slug(name)
        else:
            genre_slug = GSL_TAG_GENRE_MAP.get((category, name.casefold()))
        genre_id = slug_to_genre.get(genre_slug) if genre_slug else None
        if genre_id and genre_id not in genre_ids:
            genre_ids.append(genre_id)
    return genre_ids


def capture_gsl_tags(gsl_tags: list[dict]) -> dict[str, list[str]]:
    """Keep the requested GSL tag categories, including Media for later use."""
    captured: dict[str, list[str]] = {}
    for tag in gsl_tags:
        category = (tag.get("category") or "").strip()
        name = (tag.get("name") or "").strip()
        category_key = category.casefold()
        if not name or category_key not in GSL_TAG_CATEGORIES:
            continue
        label = category_key.title()
        values = captured.setdefault(label, [])
        if name not in values:
            values.append(name)
    return captured


def average_playtime_minutes(playtime_stats: dict | None) -> int | None:
    """Return GSL's reported average in whole minutes when it is available."""
    value = (playtime_stats or {}).get("avg_minutes")
    return int(value) if isinstance(value, (int, float)) and value >= 0 else None


def record_unmatched_gsl_genres(
    gsl_tags: list[dict], game_title: str, ref: dict
) -> None:
    """Collect GSL Genre tags without an existing Directus genre match."""
    for tag in gsl_tags:
        if (tag.get("category") or "").casefold() != "genre":
            continue
        name = (tag.get("name") or "").strip()
        slug = make_slug(name)
        if not name or slug in ref["slug_to_genre"]:
            continue
        record = ref["unmatched_genre_tags"].setdefault(
            slug, {"name": name, "slug": slug, "games": []}
        )
        if game_title not in record["games"]:
            record["games"].append(game_title)


def resolve_developer(
    game: dict, name_to_dev: dict, slug_to_dev: dict, apply: bool = True
) -> tuple[int | None, str]:
    """Find or create the developer for a game; returns (dev_id, dev_name)."""
    creator = game.get("creator") or {}
    dev_name = (creator.get("name") or "").strip()
    dev_id = name_to_dev.get(dev_name.lower()) or slug_to_dev.get(
        creator.get("slug", "")
    )
    if not dev_id and dev_name:
        dev_slug = make_slug(dev_name)
        if not apply:
            return None, dev_name
        r = directus_post("/items/developers", {"name": dev_name, "slug": dev_slug})
        dev_id = r["data"]["id"]
        name_to_dev[dev_name.lower()] = dev_id
        print(f"  Created developer: {dev_name}", file=sys.stderr)
    return dev_id, dev_name


def link_game_relations(
    game_id: int,
    dev_id: int | None,
    engine_ids: list[int],
    slug_to_genre: dict,
    extra_genre_ids: list[int],
) -> None:
    """Attach genre, developer, and engine relations to a newly created game."""
    genre_ids = [slug_to_genre.get(gs) for gs in ["avn", "visual-novel"]]
    genre_ids.extend(extra_genre_ids)
    for gid in dict.fromkeys(gid for gid in genre_ids if gid):
        directus_post(
            "/items/games_genres", {"games_id": game_id, "genres_id": gid}
        )

    if dev_id:
        directus_post(
            "/items/games_developers",
            {"games_id": game_id, "developers_id": dev_id},
        )

    if engine_ids:
        directus_patch(
            f"/items/games/{game_id}",
            {"engines": [{"engines_id": engine_id} for engine_id in engine_ids]},
        )


def create_game(
    game: dict,
    gsl_tags: list[dict],
    playtime_stats: dict | None,
    title: str,
    gsl_url: str,
    ref: dict,
    apply: bool,
) -> int | None:
    """Create a new game in Directus, or preview its planned import."""
    engine_ids, engine_str = resolve_engines(game, ref["slug_to_engine"], gsl_tags)
    extra_genre_ids = resolve_gsl_tag_genres(gsl_tags, ref["slug_to_genre"])
    release_year = extract_year(game.get("release_date"))
    status = map_gsl_status(game.get("status")) or "in_development"

    payload: dict = {
        "title": title,
        "slug": make_slug(title),
        "game_status": status,
        "player_status": "not_started",
        "gsl_tags": capture_gsl_tags(gsl_tags),
    }
    average_minutes = average_playtime_minutes(playtime_stats)
    if average_minutes is not None:
        payload["gsl_average_playtime_minutes"] = average_minutes
    if release_year:
        payload["release_year"] = release_year

    if not apply:
        _, dev_name = resolve_developer(
            game, ref["name_to_dev"], ref["slug_to_dev"], apply=False
        )
        print(
            f"  [DRY RUN] create {title!r}, engine IDs={engine_ids}, "
            f"extra genre IDs={extra_genre_ids}, "
            f"average playtime={average_minutes}, tags={payload['gsl_tags']}, "
            f"developer={dev_name or '(none)'}, status={status}",
            file=sys.stderr,
        )
        apply_download_links(None, [], game, ref, apply=False)
        return None

    cover_id = import_cover(game, title)
    if not cover_id:
        raise RuntimeError("no GSL cover could be imported; refusing coverless game")
    dev_id, dev_name = resolve_developer(
        game, ref["name_to_dev"], ref["slug_to_dev"], apply=apply
    )
    r = directus_post("/items/games", payload)
    game_id = r["data"]["id"]
    add_game_art(game_id, "capsule", cover_id, game.get("cover_image_url"))

    link_game_relations(
        game_id, dev_id, engine_ids, ref["slug_to_genre"], extra_genre_ids
    )
    add_game_link(game_id, gsl_url, "gamestorylog")
    new_downloads = apply_download_links(game_id, [], game, ref, apply=True)

    print(
        f"  Created id={game_id}: {title} (engine={engine_str}, "
        f"dev={dev_name}, download links={new_downloads})",
        file=sys.stderr,
    )
    return game_id


def map_gsl_status(value: str | None) -> str | None:
    """Map GSL's lifecycle label to the Directus game_status enum."""
    return GSL_STATUS_MAP.get((value or "").strip().lower())


def apply_download_links(
    game_id: int | None, existing_links: list[dict], gsl_game: dict, ref: dict, apply: bool
) -> int:
    """Add missing GSL download links, avoiding duplicate store pages globally."""
    existing_keys = {
        strip_tracking(link.get("url") or "")
        for link in existing_links
        if link.get("url")
    }
    existing_patreon_keys = {
        key
        for link in existing_links
        if link.get("url")
        if (key := patreon_username_key(link["url"]))
    }
    candidate_patreon_keys: set[str] = set()
    download_sorts = [
        link.get("sort") or 0
        for link in existing_links
        if link.get("kind") == "download"
    ]
    next_sort = max(download_sorts, default=0) + 1
    added = 0
    for raw_url in collect_download_urls(gsl_game):
        url = strip_tracking(raw_url)
        if is_bare_itch_page(url):
            ref["review_flags"].append(
                {
                    "game_id": game_id,
                    "url": url,
                    "reason": "rejected bare itch.io creator page; developer links only",
                }
            )
            continue
        patreon_key = patreon_username_key(url)
        if url in SKIPPED_URLS or url in existing_keys:
            continue
        if patreon_key and (
            patreon_key in existing_patreon_keys
            or patreon_key in candidate_patreon_keys
        ):
            ref["review_flags"].append(
                {
                    "game_id": game_id,
                    "url": url,
                    "patreon_identity": patreon_key,
                    "reason": "duplicate Patreon creator identity; alternate URL format",
                }
            )
            continue
        key = store_key(url)
        owners = ref["store_owners"].get(key, {}) if key else {}
        if game_id is not None and game_id in owners:
            # A differently formatted link can still identify a store page
            # already attached to this game (for example, Steam title slugs).
            continue
        other_owners = {owner_id: title for owner_id, title in owners.items() if owner_id != game_id}
        if other_owners:
            other_id, other_title = next(iter(other_owners.items()))
            print(
                f"  SKIP duplicate store page {url}: already linked to "
                f"{other_title!r} (id={other_id})",
                file=sys.stderr,
            )
            continue
        label = "APPLY" if apply else "DRY RUN"
        print(f"  [{label}] download link for {game_id or '(new game)'}: {url}", file=sys.stderr)
        if apply:
            directus_post(
                "/items/games_links",
                {
                    "games_id": game_id,
                    "url": url,
                    "kind": "download",
                    "sort": next_sort,
                },
            )
            next_sort += 1
            if key and game_id is not None:
                ref["store_owners"].setdefault(key, {})[game_id] = (
                    gsl_game.get("title") or str(game_id)
                )
        existing_keys.add(url)
        if patreon_key:
            candidate_patreon_keys.add(patreon_key)
        added += 1
    return added


def patch_existing_game(
    game: dict,
    gsl_game: dict,
    gsl_tags: list[dict],
    playtime_stats: dict | None,
    slug: str,
    ref: dict,
    apply: bool,
) -> int:
    """Preview or update GSL-derived metadata and missing download links."""
    game_id = game["id"]
    engine_ids, engine_label = resolve_engines(
        gsl_game, ref["slug_to_engine"], gsl_tags
    )
    current_engine_ids = [
        entry.get("engines_id", {}).get("id")
        for entry in game.get("engines") or []
        if isinstance(entry.get("engines_id"), dict) and entry["engines_id"].get("id")
    ]
    merged_engine_ids = list(current_engine_ids)
    merged_engine_ids.extend(engine_id for engine_id in engine_ids if engine_id not in current_engine_ids)

    # Only sync lifecycle state when the GSL page represents one Directus game.
    gsl_url = f"https://gamestorylog.com/games/{slug}"
    siblings = ref["gsl_slug_to_games"].get(slug, [])
    status = map_gsl_status(gsl_game.get("status")) if len(siblings) == 1 else None
    patch = {}
    captured_tags = capture_gsl_tags(gsl_tags)
    if captured_tags != game.get("gsl_tags"):
        patch["gsl_tags"] = captured_tags
    average_minutes = average_playtime_minutes(playtime_stats)
    if average_minutes != game.get("gsl_average_playtime_minutes"):
        patch["gsl_average_playtime_minutes"] = average_minutes
    if merged_engine_ids != list(current_engine_ids):
        patch["engines"] = [{"engines_id": engine_id} for engine_id in merged_engine_ids]
    if status and status != game.get("game_status"):
        patch["game_status"] = status
    new_genre_ids = [
        genre_id
        for genre_id in resolve_gsl_tag_genres(gsl_tags, ref["slug_to_genre"])
        if genre_id not in ref["genres_by_game"].get(game_id, set())
    ]
    print(
        f"Refresh {game['title']!r} (id={game_id}): engine={engine_label!r}, "
        f"extra genre IDs={new_genre_ids}, "
        f"average playtime={average_minutes}, "
        f"status={status or 'unchanged (shared/unknown)'}, patch={patch or 'none'}",
        file=sys.stderr,
    )
    if apply and patch:
        directus_patch(f"/items/games/{game_id}", patch)
    for genre_id in new_genre_ids:
        print(
            f"  [{'APPLY' if apply else 'DRY RUN'}] add GSL tag genre {genre_id} to {game_id}",
            file=sys.stderr,
        )
        if apply:
            directus_post(
                "/items/games_genres",
                {"games_id": game_id, "genres_id": genre_id},
            )
            ref["genres_by_game"].setdefault(game_id, set()).add(genre_id)
    if len(siblings) > 1:
        print(
            f"  SKIP GSL-derived download links: {len(siblings)} Directus games share {gsl_url}",
            file=sys.stderr,
        )
        return 0
    return apply_download_links(game_id, game.get("links") or [], gsl_game, ref, apply)


def gsl_slug_for_url(url: str) -> str:
    """Extract the final path segment from a GameStoryLog game URL."""
    return urllib.parse.urlparse(url).path.rstrip("/").rsplit("/", maxsplit=1)[-1]


def import_phase(slugs: list[str], *, apply: bool, refresh: bool, ids: list[int] | None):
    """Create missing games or refresh selected existing games from GSL."""
    data_path = CACHE / "gsl_game_data.json"
    data: dict = json.loads(data_path.read_text()) if data_path.exists() else {}
    ref = load_reference_data()

    if ids:
        targets = []
        for game_id in ids:
            game = ref["games_by_id"].get(game_id)
            if not game:
                print(f"SKIP id={game_id}: not found in Directus", file=sys.stderr)
                continue
            links = [link for link in game.get("links") or [] if link.get("kind") == "gamestorylog"]
            if len(links) != 1:
                print(f"SKIP id={game_id}: expected one GSL link, found {len(links)}", file=sys.stderr)
                continue
            targets.append((gsl_slug_for_url(links[0]["url"]), game))
    else:
        targets = [(slug, None) for slug in slugs]

    created = refreshed = skipped = errors = links_added = 0
    for index, (slug, selected_game) in enumerate(targets, start=1):
        if refresh or slug not in data:
            print(f"[{index}/{len(targets)}] Fetching GSL {slug}...", file=sys.stderr)
            result = gsl_fetch(slug)
            data[slug] = result if result is not None else {"error": "not_found"}
            data_path.parent.mkdir(parents=True, exist_ok=True)
            data_path.write_text(json.dumps(data, indent=2))
        entry = data.get(slug, {})
        if isinstance(entry, dict) and "error" in entry:
            print(f"SKIP {slug}: not found on GSL", file=sys.stderr)
            skipped += 1
            continue
        gsl_game = (entry.get("data") or {}).get("game") or {}
        gsl_data = entry.get("data") or {}
        gsl_tags = gsl_data.get("tags") or []
        playtime_stats = gsl_data.get("playtime_stats") or {}
        if not gsl_game:
            print(f"SKIP {slug}: no game data", file=sys.stderr)
            skipped += 1
            continue

        title = gsl_game.get("title") or slug
        record_unmatched_gsl_genres(gsl_tags, title, ref)
        gsl_url = f"https://gamestorylog.com/games/{slug}"
        matches = [selected_game] if selected_game else ref["gsl_slug_to_games"].get(slug, [])
        title_match = False
        if not matches and not selected_game:
            existing_id = ref["title_to_id"].get(title.lower())
            if existing_id:
                matches = [ref["games_by_id"][existing_id]]
                title_match = True

        if matches:
            already_linked = any(
                link.get("kind") == "gamestorylog" and link.get("url") == gsl_url
                for matched in matches
                for link in matched.get("links") or []
            )
            if already_linked and not refresh and not ids:
                print(f"SKIP {title}: already linked in Directus; use --refresh", file=sys.stderr)
                skipped += 1
                continue
            for game in matches:
                try:
                    if title_match and not already_linked:
                        print(f"  {'APPLY' if apply else 'DRY RUN'} add GSL link to id={game['id']}", file=sys.stderr)
                        if apply:
                            add_game_link(game["id"], gsl_url, "gamestorylog")
                        game.setdefault("links", []).append(
                            {"url": gsl_url, "kind": "gamestorylog"}
                        )
                        ref["gsl_url_to_games"].setdefault(gsl_url, []).append(game)
                        ref["gsl_slug_to_games"].setdefault(slug, []).append(game)
                    links_added += patch_existing_game(
                        game, gsl_game, gsl_tags, playtime_stats, slug, ref, apply
                    )
                    refreshed += 1
                except Exception as error:  # noqa: BLE001 - report and continue
                    print(f"ERROR refreshing {title!r} (id={game['id']}): {error}", file=sys.stderr)
                    errors += 1
            continue

        print(f"Importing {title!r}...", file=sys.stderr)
        try:
            new_id = create_game(
                gsl_game, gsl_tags, playtime_stats, title, gsl_url, ref, apply
            )
            if apply and new_id is not None:
                created += 1
                ref["gsl_url_to_games"].setdefault(gsl_url, []).append(
                    {"id": new_id, "title": title, "links": [], "engines": []}
                )
                ref["gsl_slug_to_games"].setdefault(slug, []).append(
                    {"id": new_id, "title": title, "links": [], "engines": []}
                )
            else:
                created += 1
        except Exception as error:  # noqa: BLE001 - report and continue
            print(f"ERROR importing {title!r}: {error}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            errors += 1

    shared_review = []
    for shared_slug, shared_games in ref["gsl_slug_to_games"].items():
        if len(shared_games) < 2:
            continue
        entry = data.get(shared_slug) or {}
        gsl_game = (entry.get("data") or {}).get("game") or {}
        shared_review.append(
            {
                "gsl_url": f"https://gamestorylog.com/games/{shared_slug}",
                "gsl_download_url": gsl_game.get("download_url"),
                "gsl_other_urls": gsl_game.get("other_urls"),
                "games": [
                    {"id": game["id"], "title": game["title"], "slug": game.get("slug")}
                    for game in shared_games
                ],
            }
        )
    review_data = {
        "generated_by": "gsl_import.py",
        "entries": shared_review,
        "skipped_candidates": ref["review_flags"],
        "unmatched_genre_tags": sorted(
            ref["unmatched_genre_tags"].values(), key=lambda item: item["slug"]
        ),
    }
    MANUAL_REVIEW_JSON.parent.mkdir(parents=True, exist_ok=True)
    MANUAL_REVIEW_JSON.write_text(json.dumps(review_data, indent=2))
    md_lines = [
        "# GSL download links needing manual review",
        "",
        "Shared GSL pages are not used to guess game-specific links for multiple Directus records.",
        "",
    ]
    for item in shared_review:
        md_lines.extend([f"## {item['gsl_url']}", ""])
        md_lines.extend(
            f"- {game['title']} (id={game['id']}, slug={game.get('slug') or ''})"
            for game in item["games"]
        )
        if item["gsl_download_url"]:
            md_lines.extend(["", f"GSL download_url: {item['gsl_download_url']}"])
        if item["gsl_other_urls"]:
            md_lines.extend(["", f"GSL other_urls: {item['gsl_other_urls']}"])
        md_lines.append("")
    if ref["review_flags"]:
        md_lines.extend(["## Skipped candidates", ""])
        md_lines.extend(
            f"- {flag.get('url')} (id={flag.get('game_id')}): {flag['reason']}"
            for flag in ref["review_flags"]
        )
        md_lines.append("")
    if ref["unmatched_genre_tags"]:
        md_lines.extend(
            ["## GSL Genre tags without matching Directus genres", ""]
        )
        for item in sorted(ref["unmatched_genre_tags"].values(), key=lambda row: row["slug"]):
            md_lines.append(
                f"- **{item['name']}** (`{item['slug']}`): "
                f"{', '.join(item['games'])}"
            )
        md_lines.append("")
    MANUAL_REVIEW_MD.write_text("\n".join(md_lines), encoding="utf-8")

    print(
        f"\n{'APPLIED' if apply else 'DRY RUN'}: {created} games to create, "
        f"{refreshed} games refreshed, {links_added} download links added, "
        f"{skipped} skipped, {errors} errors\n"
        f"Manual-review report: {MANUAL_REVIEW_MD}",
        file=sys.stderr,
    )
    if ref["unmatched_genre_tags"]:
        print("Unmatched GSL Genre tags to consider adding as Directus genres:", file=sys.stderr)
        for item in sorted(ref["unmatched_genre_tags"].values(), key=lambda row: row["slug"]):
            print(
                f"  {item['name']} ({item['slug']}) - {', '.join(item['games'])}",
                file=sys.stderr,
            )
    else:
        print("Unmatched GSL Genre tags: none", file=sys.stderr)


def main():
    """Parse CLI args and dispatch to the fetch or import phase."""
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument(
        "--import",
        dest="do_import",
        action="store_true",
        help="Plan Directus imports/refreshes (dry run unless --apply)",
    )
    p.add_argument("--apply", action="store_true", help="Write planned changes to Directus")
    p.add_argument(
        "--refresh",
        action="store_true",
        help="Fetch fresh GSL data and refresh existing linked games",
    )
    p.add_argument(
        "--ids",
        nargs="+",
        metavar="ID",
        help="Select existing Directus game IDs (space- or comma-separated); requires --import",
    )
    p.add_argument(
        "slugs",
        nargs="*",
        help="GSL slugs to process (default: the built-in GSL_SLUGS list)",
    )
    args = p.parse_args()
    if args.ids and not args.do_import:
        p.error("--ids requires --import")
    if args.apply and not args.do_import:
        p.error("--apply requires --import")
    ids = None
    if args.ids:
        try:
            ids = sorted({int(value) for group in args.ids for value in group.split(",") if value})
        except ValueError:
            p.error("Directus IDs must be integers")
    slugs = args.slugs or GSL_SLUGS
    if args.do_import:
        import_phase(slugs, apply=args.apply, refresh=args.refresh, ids=ids)
    else:
        fetch_phase(slugs, refresh=args.refresh)


if __name__ == "__main__":
    main()
