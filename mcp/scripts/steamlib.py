"""Shared Steam metadata helpers for import and backfill scripts."""

import re
import sys
import urllib.error
import urllib.request
import uuid

from scriptlib import DirectusClient, ProgressCache, RetryPolicy, fetch_with_backoff

STEAM_DETAILS_URL = (
    "https://store.steampowered.com/api/appdetails?appids={appid}&cc=us&l=en"
)
STEAMSPY_URL = "https://steamspy.com/api.php?request=appdetails&appid={appid}"

COVER_NAMESPACE = uuid.UUID("a1b2c3d4-e5f6-7890-abcd-ef1234567890")
STEAM_PORTRAIT_URL = (
    "https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/library_600x900.jpg"
)
STEAM_FALLBACK_URLS = [
    "https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/capsule_616x353.jpg",
    "https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/header.jpg",
]

TAG_TO_GENRE: dict[str, str] = {
    "ARPG": "arpg",
    "Card Game": "card",
    "Card Battler": "card",
    "CRPG": "crpg",
    "Fighting": "fighter",
    "2D Fighter": "fighter",
    "FMV": "fmv",
    "FPS": "fps",
    "Horror": "horror",
    "Isometric": "isometric",
    "JRPG": "jrpg",
    "Metroidvania": "metroidvania",
    "Platformer": "platformer",
    "RPG": "rpg",
    "RTS": "rts",
    "Roguelike": "roguelike",
    "Rogue-like": "roguelike",
    "Rogue-lite": "roguelike",
    "Action Roguelike": "roguelike",
    "Stealth": "stealth",
    "Strategy": "strategy",
    "Visual Novel": "visual-novel",
}
COMPOUND_GENRE_RULES: list[tuple[list[str], str]] = [
    (["Real-Time with Pause", "Party-Based RPG"], "crpg"),
]
ROGUELIKE_TAGS = {"Roguelike", "Rogue-like", "Rogue-lite", "Action Roguelike"}


def fetch_steam_details(
    appid: int, base_delay: float = 2.0
) -> tuple[dict | None, str | None]:
    """Fetch Steam app details with capped exponential backoff."""
    url = STEAM_DETAILS_URL.format(appid=appid)
    payload, err = fetch_with_backoff(
        url,
        retry=RetryPolicy(rate_limit_codes=(403, 429), backoff_base=base_delay),
    )
    if payload is None:
        return None, err
    entry = payload.get(str(appid), {})
    if not entry.get("success"):
        return None, "api_no_success"
    return entry["data"], None


def extract_steam_appid(url: str | None) -> int | None:
    """Extract a Steam app ID from a store URL."""
    if not url:
        return None
    match = re.search(r"store\.steampowered\.com/app/(\d+)", url)
    return int(match.group(1)) if match else None


def extract_release_year(date_str: str | None) -> int | None:
    """Extract a four-digit release year from a Steam-style date string."""
    match = re.search(r"\b(19|20)\d{2}\b", date_str or "")
    return int(match.group(0)) if match else None


def cover_uuid(appid: int) -> str:
    """Return the deterministic Directus file UUID for a Steam app's cover."""
    return str(uuid.uuid5(COVER_NAMESPACE, str(appid)))


def url_responds(url: str, *, timeout: float = 10) -> bool:
    """Return whether a URL responds successfully to a HEAD request."""
    try:
        req = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.status == 200
    except urllib.error.URLError:
        return False


def steamgriddb_cover_url(appid: int, api_key: str) -> tuple[str | None, str | None]:
    """Return (grid_url, err) for the best 600x900 SteamGridDB grid image."""
    url = (
        f"https://www.steamgriddb.com/api/v2/grids/steam/{appid}"
        "?dimensions=600x900&limit=1"
    )
    payload, err = fetch_with_backoff(
        url,
        headers={"Authorization": f"Bearer {api_key}"},
        retry=RetryPolicy(rate_limit_codes=(403, 429)),
    )
    if payload is None:
        return None, err
    grids = payload.get("data") or []
    return (grids[0]["url"] if grids else None), None


def find_cover_url(
    appid: int, steamgriddb_key: str, cache: ProgressCache
) -> str | None:
    """Find and cache the best available cover URL for a Steam app.

    Tries the Steam CDN portrait, then SteamGridDB, then Steam CDN landscape
    fallbacks. Results (including "none found", cached as None) are keyed by
    appid so a dry run and the following --apply run never repeat lookups.
    """

    def _lookup() -> str | None:
        portrait = STEAM_PORTRAIT_URL.format(appid=appid)
        if url_responds(portrait):
            return portrait
        grid_url, _err = steamgriddb_cover_url(appid, steamgriddb_key)
        if grid_url:
            return grid_url
        for template in STEAM_FALLBACK_URLS:
            candidate = template.format(appid=appid)
            if url_responds(candidate):
                return candidate
        return None

    return cache.get_or_set(f"cover:{appid}", _lookup)


def import_steam_cover(
    client: DirectusClient, appid: int, title: str, slug: str, cover_url: str
) -> str | None:
    """Import a Steam-sourced cover into Directus, reusing a deterministic file ID."""
    file_id = cover_uuid(appid)
    try:
        result = client.request(
            "POST",
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
    except urllib.error.HTTPError as error:
        body = error.read().decode(errors="replace")
        if '"RECORD_NOT_UNIQUE"' in body or error.code == 409:
            return file_id
        print(f"  [cover] HTTP {error.code}: {body[:120]}", file=sys.stderr)
        return None


def fetch_steamspy_tags(appid: int, cache: ProgressCache) -> dict[str, int]:
    """Fetch and cache SteamSpy tag votes for an app, returning {} on failure."""

    def _lookup() -> dict[str, int]:
        payload, _err = fetch_with_backoff(STEAMSPY_URL.format(appid=appid))
        return (payload or {}).get("tags") or {} if payload is not None else {}

    return cache.get_or_set(f"steamspy:{appid}", _lookup)


def genres_from_tags(tags: dict[str, int], minimum_votes: int) -> set[str]:
    """Map qualified Steam community tags to Directus genre slugs."""
    qualified = {tag for tag, votes in tags.items() if votes >= minimum_votes}
    is_roguelike = bool(ROGUELIKE_TAGS & qualified)
    genres: set[str] = set()
    for tag, slug in TAG_TO_GENRE.items():
        if tag in qualified and not (slug == "crpg" and is_roguelike):
            genres.add(slug)
    for required_tags, slug in COMPOUND_GENRE_RULES:
        if all(tag in qualified for tag in required_tags) and not (
            slug == "crpg" and is_roguelike
        ):
            genres.add(slug)
    if "Visual Novel" in qualified and "Sexual Content" in qualified:
        genres.update(("avn", "visual-novel"))
    if genres & {"card", "rts", "visual-novel"}:
        genres.discard("crpg")
    return genres
