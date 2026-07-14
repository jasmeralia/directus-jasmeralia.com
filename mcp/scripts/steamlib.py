"""Shared Steam metadata helpers for import and backfill scripts."""

import json
import sys
import time
import urllib.error
import urllib.request

MAX_RETRIES = 5
STEAM_DETAILS_URL = (
    "https://store.steampowered.com/api/appdetails?appids={appid}&cc=us&l=en"
)

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
    delay = base_delay
    for attempt in range(MAX_RETRIES):
        try:
            with urllib.request.urlopen(url, timeout=15) as response:
                payload = json.loads(response.read())
            entry = payload.get(str(appid), {})
            if not entry.get("success"):
                return None, "api_no_success"
            return entry["data"], None
        except urllib.error.HTTPError as error:
            if error.code not in (403, 429):
                return None, f"http_{error.code}"
            print(
                f"  Rate limited (HTTP {error.code}), backing off {delay:.0f}s "
                f"(attempt {attempt + 1}/{MAX_RETRIES})...",
                file=sys.stderr,
            )
            time.sleep(delay)
            delay *= 2
        except Exception as error:  # Surface network failures to the caller.
            return None, f"error:{error}"
    return None, "rate_limit_exceeded"


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
