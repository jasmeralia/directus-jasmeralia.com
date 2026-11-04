#!/usr/bin/env python3
"""Backfill IsThereAnyDeal links from each game's Steam app ID.

The script only considers the first Steam download link in Directus sort order.
ITAD's app-ID lookup is exact, so no title matching or guessed URL is involved.
Lookup results are cached by app ID; applying a reviewed dry run does not repeat
ITAD requests.

Usage:
    python3 mcp/scripts/backfill_itad_links.py                 # dry run
    python3 mcp/scripts/backfill_itad_links.py --apply         # write links
    python3 mcp/scripts/backfill_itad_links.py --refresh        # redo lookups
    python3 mcp/scripts/backfill_itad_links.py --only-slug foo  # select game
"""

from __future__ import annotations

import argparse
import email.utils
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from scriptlib import (
    CACHE_DIR,
    DirectusClient,
    RetryingDirectusClient,
    server_env,
    trigger_site_rebuild,
)
from steamlib import (
    extract_steam_appid,
    steam_download_url,
)

ITAD_BASE_URL = "https://api.isthereanydeal.com"
ITAD_SITE_URL = "https://isthereanydeal.com/game"
ITAD_CACHE_PATH = CACHE_DIR / "itad_game_link_cache.json"
ITAD_REQUEST_INTERVAL_SECONDS = 1.0
ITAD_MAX_RETRIES = 6
ITAD_BACKOFF_BASE_SECONDS = 2.0
ITAD_BACKOFF_MAX_SECONDS = 900.0
USER_AGENT = "jasmeralia-itad-link-backfill/1.0"


class ItadLookupError(RuntimeError):
    """Raised when an ITAD lookup fails and should be retried on a later run."""


class ItadRequestPacer:  # pylint: disable=too-few-public-methods
    """Keep uncached ITAD requests at least the configured interval apart."""

    def __init__(self, interval_seconds: float) -> None:
        self.interval_seconds = interval_seconds
        self.last_request_at = 0.0

    def wait(self) -> None:
        """Wait for the next request slot and mark it as reserved."""
        now = time.monotonic()
        delay = self.interval_seconds - (now - self.last_request_at)
        if delay > 0:
            time.sleep(delay)
        self.last_request_at = time.monotonic()


def retry_after_seconds(value: str | None) -> float | None:
    """Parse Retry-After as seconds or an HTTP date."""
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        try:
            retry_at = email.utils.parsedate_to_datetime(value)
        except (TypeError, ValueError, OverflowError):
            return None
        if retry_at.tzinfo is None:
            retry_at = retry_at.replace(tzinfo=UTC)
        return max(0.0, (retry_at - datetime.now(UTC)).total_seconds())


def atomic_json_write(path: Path, value: Any) -> None:
    """Atomically persist cache data so interrupted runs remain resumable."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    temporary.replace(path)


def load_cache() -> dict[str, dict[str, Any]]:
    """Load cached ITAD resolutions keyed by Steam app ID."""
    if not ITAD_CACHE_PATH.exists():
        return {}
    try:
        value = json.loads(ITAD_CACHE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ItadLookupError(f"Could not read {ITAD_CACHE_PATH}: {error}") from error
    if not isinstance(value, dict):
        raise ItadLookupError(f"Invalid cache format in {ITAD_CACHE_PATH}")
    return {str(key): item for key, item in value.items() if isinstance(item, dict)}


def lookup_itad_game(
    app_id: str,
    api_key: str,
    pacer: ItadRequestPacer,
) -> dict[str, Any]:
    """Resolve a Steam app ID to an ITAD game URL or a confirmed no-match."""
    query = urllib.parse.urlencode({"appid": app_id})
    url = f"{ITAD_BASE_URL}/games/lookup/v1?{query}"
    delay = ITAD_BACKOFF_BASE_SECONDS
    for attempt in range(ITAD_MAX_RETRIES):
        pacer.wait()
        request = urllib.request.Request(
            url,
            headers={
                "Accept": "application/json",
                "ITAD-API-Key": api_key,
                "User-Agent": USER_AGENT,
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=25) as response:
                result = json.loads(response.read())
        except urllib.error.HTTPError as error:
            if error.code not in {429, 503}:
                body = error.read().decode("utf-8", "replace")[:300]
                raise ItadLookupError(
                    f"ITAD HTTP {error.code} for Steam app {app_id}: {body}"
                ) from error
            if attempt + 1 >= ITAD_MAX_RETRIES:
                raise ItadLookupError(
                    f"ITAD continued rate limiting app {app_id} after "
                    f"{ITAD_MAX_RETRIES} attempts; stopping."
                ) from error
            server_delay = retry_after_seconds(
                error.headers.get("Retry-After") if error.headers else None
            )
            wait_seconds = max(
                min(delay, ITAD_BACKOFF_MAX_SECONDS), server_delay or 0.0
            )
            print(
                f"  ITAD HTTP {error.code}; retrying in {wait_seconds:.0f}s "
                f"(attempt {attempt + 2}/{ITAD_MAX_RETRIES})...",
                file=sys.stderr,
                flush=True,
            )
            time.sleep(wait_seconds)
            delay = min(delay * 2, ITAD_BACKOFF_MAX_SECONDS)
            continue
        except (OSError, TimeoutError, json.JSONDecodeError) as error:
            if attempt + 1 >= ITAD_MAX_RETRIES:
                raise ItadLookupError(
                    f"ITAD lookup failed for app {app_id} after "
                    f"{ITAD_MAX_RETRIES} attempts: {error}"
                ) from error
            wait_seconds = min(delay, ITAD_BACKOFF_MAX_SECONDS)
            print(
                f"  ITAD request failed ({error}); retrying in "
                f"{wait_seconds:.0f}s (attempt {attempt + 2}/{ITAD_MAX_RETRIES})...",
                file=sys.stderr,
                flush=True,
            )
            time.sleep(wait_seconds)
            delay = min(delay * 2, ITAD_BACKOFF_MAX_SECONDS)
            continue

        if not isinstance(result, dict):
            raise ItadLookupError(f"Unexpected ITAD response for app {app_id}")
        if result.get("found") is not True:
            return {"status": "not_found"}
        game = result.get("game")
        if not isinstance(game, dict):
            raise ItadLookupError(
                f"ITAD marked app {app_id} found but returned no game details"
            )
        slug = game.get("slug")
        if not isinstance(slug, str) or not slug.strip():
            raise ItadLookupError(
                f"ITAD marked app {app_id} found but returned no game slug"
            )
        safe_slug = urllib.parse.quote(slug.strip(), safe="-._~")
        return {
            "status": "found",
            "slug": slug.strip(),
            "itad_id": game.get("id"),
            "title": game.get("title"),
            "url": f"{ITAD_SITE_URL}/{safe_slug}/info/",
        }
    raise ItadLookupError(f"ITAD lookup exhausted retries for app {app_id}")


def current_steam_app_id(game: dict[str, Any]) -> str | None:
    """Return the app ID from the game's primary Steam download URL."""
    url = steam_download_url(game.get("links"))
    app_id = extract_steam_appid(url)
    return str(app_id) if app_id is not None else None


def main() -> int:
    """Plan or apply ITAD link additions for Steam-linked games."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write links to Directus")
    parser.add_argument(
        "--refresh", action="store_true", help="ignore cached ITAD lookups"
    )
    parser.add_argument(
        "--only-slug",
        action="append",
        default=[],
        help="limit work to a game slug (repeatable)",
    )
    parser.add_argument(
        "--exclude-appid",
        action="append",
        default=[],
        help="exclude a Steam app ID and every game record using it (repeatable)",
    )
    parser.add_argument(
        "--limit", type=int, help="maximum number of uncached app lookups"
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=ITAD_REQUEST_INTERVAL_SECONDS,
        help="minimum seconds between uncached ITAD requests (default: 1.0)",
    )
    args = parser.parse_args()
    if args.delay < 0:
        parser.error("--delay must be zero or greater")
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be at least 1")

    directus = RetryingDirectusClient(DirectusClient.from_config())
    api_key = server_env("game-encyclopedia").get("ITAD_API_KEY")
    if not api_key or "<VALUE>" in api_key:
        parser.error("ITAD_API_KEY is missing from .mcp.json game-encyclopedia env")

    print("Fetching Directus games and existing link rows...", flush=True)
    games = directus.fetch_all(
        "/items/games?fields=id,title,slug,links.url,links.kind,links.sort",
        description="fetch games for ITAD link backfill",
    )
    selected_slugs = set(args.only_slug)
    if selected_slugs:
        games = [game for game in games if game.get("slug") in selected_slugs]
        missing = selected_slugs - {str(game.get("slug")) for game in games}
        if missing:
            parser.error(f"Unknown game slug(s): {', '.join(sorted(missing))}")

    candidates: list[tuple[dict[str, Any], str]] = []
    skipped_has_itad = skipped_no_steam = 0
    excluded_app_ids = set(args.exclude_appid)
    skipped_excluded_app_id = 0
    for game in games:
        links = game.get("links") or []
        if any(link.get("kind") == "itad" for link in links):
            skipped_has_itad += 1
            continue
        app_id = current_steam_app_id(game)
        if app_id is None:
            skipped_no_steam += 1
            continue
        if app_id in excluded_app_ids:
            skipped_excluded_app_id += 1
            continue
        candidates.append((game, app_id))

    cache = load_cache()
    pacer = ItadRequestPacer(args.delay)
    pending_unique_ids = list(
        dict.fromkeys(
            app_id for _, app_id in candidates if args.refresh or app_id not in cache
        )
    )
    if args.limit is not None:
        pending_unique_ids = pending_unique_ids[: args.limit]
        permitted = set(pending_unique_ids) | {
            app_id for _, app_id in candidates if not args.refresh and app_id in cache
        }
        candidates = [
            (game, app_id) for game, app_id in candidates if app_id in permitted
        ]

    for index, app_id in enumerate(pending_unique_ids, start=1):
        print(
            f"ITAD lookup {index}/{len(pending_unique_ids)}: Steam app {app_id}",
            flush=True,
        )
        cache[app_id] = lookup_itad_game(app_id, api_key, pacer)
        atomic_json_write(ITAD_CACHE_PATH, cache)

    additions: list[dict[str, Any]] = []
    not_found: list[dict[str, str]] = []
    for game, app_id in candidates:
        result = cache.get(app_id)
        if not isinstance(result, dict):
            # --limit may intentionally leave uncached app IDs for a later run.
            continue
        if result.get("status") != "found" or not result.get("url"):
            not_found.append(
                {
                    "slug": str(game.get("slug", "")),
                    "title": game["title"],
                    "app_id": app_id,
                }
            )
            continue
        additions.append(
            {
                "game_id": game["id"],
                "slug": game.get("slug"),
                "title": game["title"],
                "app_id": app_id,
                "itad_title": result.get("title"),
                "url": result["url"],
            }
        )

    print(
        f"\nCandidates: {len(candidates)}; additions: {len(additions)}; "
        f"ITAD no-match: {len(not_found)}; already linked: {skipped_has_itad}; "
        f"no Steam link: {skipped_no_steam}; excluded app-ID records: "
        f"{skipped_excluded_app_id}",
        flush=True,
    )
    for addition in additions:
        print(
            f"  [{addition['game_id']}] {addition['title']} "
            f"(app {addition['app_id']}) -> {addition['url']}",
            flush=True,
        )
    for item in not_found:
        print(
            f"  NO MATCH [{item['slug']}] {item['title']} (app {item['app_id']})",
            flush=True,
        )

    report = {
        "generated_at": datetime.now(UTC).isoformat(),
        "mode": "apply" if args.apply else "dry-run",
        "excluded_app_ids": sorted(excluded_app_ids),
        "excluded_app_id_records": skipped_excluded_app_id,
        "additions": additions,
        "not_found": not_found,
    }
    atomic_json_write(CACHE_DIR / "itad_game_link_plan.json", report)

    if not args.apply:
        print(
            "\nDry run only. Review mcp/cache/itad_game_link_plan.json; pass --apply to write."
        )
        return 0

    changed_game_ids: list[int] = []
    for index, item in enumerate(additions, start=1):
        game_id = int(item["game_id"])
        current = directus.get(
            f"/items/games/{game_id}",
            {"fields": "id,links.url,links.kind,links.sort"},
            description=f"recheck game {game_id} before ITAD link create",
        ).get("data", {})
        links = current.get("links") or []
        if any(link.get("kind") == "itad" for link in links):
            print(
                f"  Skip [{game_id}] an ITAD link was added since planning.", flush=True
            )
            continue
        current_app_id = current_steam_app_id(current)
        if current_app_id != item["app_id"]:
            print(
                f"  Skip [{game_id}] the primary Steam app changed since planning.",
                flush=True,
            )
            continue
        directus.post(
            "/items/games_links",
            {"games_id": game_id, "url": item["url"], "kind": "itad"},
            description=f"create ITAD link for game {game_id}",
            retry_ambiguous_failures=False,
        )
        changed_game_ids.append(game_id)
        print(
            f"Applied {index}/{len(additions)}: [{game_id}] {item['title']}", flush=True
        )

    if changed_game_ids:
        trigger_site_rebuild(directus.base_client, changed_game_ids)
    print(f"Added {len(changed_game_ids)} ITAD link(s).", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ItadLookupError as error:
        print(f"ERROR: {error}", file=sys.stderr, flush=True)
        raise SystemExit(1) from error
