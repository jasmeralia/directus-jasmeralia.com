#!/usr/bin/env python3
"""Backfill official Steam developer homepages for developers on Steam games.

The Steam app id is deduplicated before any storefront requests are made. The
script keeps processing a Directus developer after finding a Steam homepage,
because one consolidated Directus record can represent multiple divisions
that Steam lists under separate developer pages on different games.

Usage:
    python3 mcp/scripts/ignored/backfill_steam_developer_links.py          # dry run
    python3 mcp/scripts/ignored/backfill_steam_developer_links.py --apply  # write rows
    python3 mcp/scripts/ignored/backfill_steam_developer_links.py --refresh # ignore cache

Only official store.steampowered.com/developer/ pages are considered. Search,
curator, publisher and community URLs are not added. Applying writes only
developers_links rows and does not trigger a site rebuild.
"""

import argparse
import email.utils
import html
import json
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import UTC, datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scriptlib import CACHE_DIR, DirectusClient  # pylint: disable=wrong-import-position

STEAM_API_BASE = "https://store.steampowered.com/api/appdetails"
STEAM_APP_BASE = "https://store.steampowered.com/app"
STEAM_HOST = "store.steampowered.com"
STEAM_KIND = "steam"
STEAM_REQUEST_INTERVAL_SECONDS = 2.0
MAX_RETRIES = 5
BACKOFF_BASE_SECONDS = 2.0
RATE_LIMIT_MAX_RETRIES = 5
RATE_LIMIT_BACKOFF_BASE_SECONDS = 60.0
RATE_LIMIT_BACKOFF_MAX_SECONDS = 900.0
STEAM_CACHE = CACHE_DIR / "steam_developer_link_backfill.json"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
)


def fetch_all(client: DirectusClient, collection: str, fields: str) -> list[dict]:
    """Fetch every row from a Directus collection."""
    return client.fetch_all(f"/items/{collection}?fields={fields}")


def normalize_steam_app_url(url: str) -> tuple[str, str] | None:
    """Return a canonical Steam app URL and app id, discarding query strings."""
    try:
        parsed = urllib.parse.urlsplit((url or "").strip())
    except ValueError:
        return None
    host = (parsed.hostname or "").lower().removeprefix("www.")
    segments = [segment for segment in parsed.path.split("/") if segment]
    if (
        parsed.scheme.lower() not in {"http", "https"}
        or host != STEAM_HOST
        or len(segments) < 2
        or segments[0].lower() != "app"
        or not segments[1].isdigit()
    ):
        return None
    app_id = segments[1]
    return f"https://{STEAM_HOST}/app/{app_id}", app_id


def normalize_steam_developer_url(url: str) -> str | None:
    """Return a canonical Steam developer-homepage URL, or None for other URLs."""
    try:
        parsed = urllib.parse.urlsplit((url or "").strip())
    except ValueError:
        return None
    host = (parsed.hostname or "").lower().removeprefix("www.")
    segments = [segment for segment in parsed.path.split("/") if segment]
    if (
        host != STEAM_HOST
        or len(segments) != 2
        or segments[0].lower() != "developer"
        or not segments[1]
    ):
        return None
    slug = urllib.parse.unquote(segments[1])
    return f"https://{STEAM_HOST}/developer/{urllib.parse.quote(slug, safe='-_.')}"


def normalize_name(value: str) -> str:
    """Normalize names for exact matching, ignoring case, accents and punctuation."""
    decomposed = unicodedata.normalize("NFKD", value or "")
    return "".join(char for char in decomposed.casefold() if char.isalnum())


def progress_label(processed: int, total: int) -> str:
    """Format the requested numeric progress marker."""
    percentage = 100.0 if total == 0 else processed * 100 / total
    return f"({processed}/{total} processed: {percentage:.1f}%)"


class SteamRateLimitError(RuntimeError):
    """Raised when Steam continues rate limiting after the retry budget."""


class SteamRequestPacer:  # pylint: disable=too-few-public-methods
    """Enforce a minimum interval between every request to Steam."""

    def __init__(self, interval_seconds: float) -> None:
        self.interval_seconds = interval_seconds
        self.last_request_at = 0.0

    def wait(self) -> None:
        """Wait until the next request slot is available and reserve it."""
        now = time.monotonic()
        delay = self.interval_seconds - (now - self.last_request_at)
        if delay > 0:
            time.sleep(delay)
        self.last_request_at = time.monotonic()


STEAM_REQUEST_PACER = SteamRequestPacer(STEAM_REQUEST_INTERVAL_SECONDS)


def retry_after_seconds(value: str | None) -> float | None:
    """Parse a Retry-After header as seconds or an HTTP date."""
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


def wait_for_steam_request_slot() -> None:
    """Space all Steam HTTP requests apart, including appdetails and page fetches."""
    STEAM_REQUEST_PACER.wait()


class DeveloperAnchorParser(HTMLParser):
    """Collect Steam developer-homepage anchors and their visible names."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.anchors: list[dict[str, str]] = []
        self._open_anchors: list[dict[str, Any]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        attributes = dict(attrs)
        self._open_anchors.append({"href": attributes.get("href") or "", "text": []})

    def handle_data(self, data: str) -> None:
        for anchor in self._open_anchors:
            anchor["text"].append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() != "a" or not self._open_anchors:
            return
        anchor = self._open_anchors.pop()
        self.anchors.append(
            {"href": anchor["href"], "name": " ".join(" ".join(anchor["text"]).split())}
        )


def steam_request(url: str, *, parse_json: bool) -> Any | None:
    """Fetch a Steam endpoint with retry/backoff, returning decoded content."""
    delay = BACKOFF_BASE_SECONDS
    for attempt in range(max(MAX_RETRIES, RATE_LIMIT_MAX_RETRIES + 1)):
        wait_for_steam_request_slot()
        request = urllib.request.Request(
            url,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json, text/html"},
        )
        try:
            with urllib.request.urlopen(request, timeout=25) as response:
                body = response.read()
            return json.loads(body) if parse_json else body.decode("utf-8", "replace")
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None
            if error.code == 429:
                if attempt >= RATE_LIMIT_MAX_RETRIES:
                    message = (
                        f"Steam rate-limited this lookup after "
                        f"{RATE_LIMIT_MAX_RETRIES + 1} attempts; stopping to avoid "
                        f"further requests: {url}"
                    )
                    print(f"  {message}", file=sys.stderr, flush=True)
                    raise SteamRateLimitError(message) from error
                backoff = min(
                    RATE_LIMIT_BACKOFF_BASE_SECONDS * (2**attempt),
                    RATE_LIMIT_BACKOFF_MAX_SECONDS,
                )
                retry_header = (
                    error.headers.get("Retry-After") if error.headers else None
                )
                server_delay = retry_after_seconds(retry_header)
                retry_delay = max(backoff, server_delay or 0.0)
                print(
                    f"  Steam HTTP 429; retrying in {retry_delay:.0f}s "
                    f"(attempt {attempt + 2}/{RATE_LIMIT_MAX_RETRIES + 1}): {url}",
                    file=sys.stderr,
                    flush=True,
                )
                time.sleep(retry_delay)
                continue
            if attempt + 1 == MAX_RETRIES:
                print(
                    f"  Steam HTTP {error.code} after {MAX_RETRIES} attempts: {url}",
                    file=sys.stderr,
                )
                return None
            print(
                f"  Steam HTTP {error.code}; retrying in {delay:.0f}s: {url}",
                file=sys.stderr,
            )
        except (OSError, json.JSONDecodeError) as error:
            if attempt + 1 == MAX_RETRIES:
                print(f"  Steam lookup failed for {url}: {error}", file=sys.stderr)
                return None
            print(
                f"  Steam lookup error ({error}); retrying in {delay:.0f}s: {url}",
                file=sys.stderr,
            )
        time.sleep(delay)
        delay *= 2
    return None


def load_cache() -> dict[str, Any]:
    """Load cached Steam app metadata and developer-page links."""
    if not STEAM_CACHE.exists():
        return {}
    try:
        value = json.loads(STEAM_CACHE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"WARNING: could not read {STEAM_CACHE}: {error}", file=sys.stderr)
        return {}
    return value if isinstance(value, dict) else {}


def save_cache(cache: dict[str, Any]) -> None:
    """Persist the Steam lookup cache after each app."""
    STEAM_CACHE.parent.mkdir(parents=True, exist_ok=True)
    STEAM_CACHE.write_text(
        json.dumps(cache, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def lookup_steam_app(app_id: str) -> dict[str, Any]:
    """Fetch app developer names and direct developer-page links from Steam."""
    api_url = f"{STEAM_API_BASE}?appids={urllib.parse.quote(app_id)}&l=english&cc=us"
    response = steam_request(api_url, parse_json=True)
    if not isinstance(response, dict):
        return {"error": "appdetails request failed"}
    app_entry = response.get(app_id)
    if not isinstance(app_entry, dict):
        return {"error": "Steam returned no app details"}
    data = app_entry.get("data")
    if not isinstance(data, dict) or not app_entry.get("success"):
        return {"error": "Steam returned no app details"}
    developers = sorted(
        {
            name.strip()
            for name in data.get("developers", [])
            if isinstance(name, str) and name.strip()
        },
        key=str.casefold,
    )

    page_url = f"{STEAM_APP_BASE}/{app_id}/"
    page_html = steam_request(page_url, parse_json=False)
    if not isinstance(page_html, str):
        return {
            "developers": developers,
            "profiles": [],
            "error": "store page request failed",
        }

    parser = DeveloperAnchorParser()
    try:
        parser.feed(page_html)
    except (AssertionError, ValueError):
        pass
    profiles: dict[str, dict[str, str]] = {}
    listed_names = {normalize_name(name) for name in developers}
    for anchor in parser.anchors:
        absolute_url = urllib.parse.urljoin(
            f"https://{STEAM_HOST}/", html.unescape(anchor["href"])
        )
        canonical = normalize_steam_developer_url(absolute_url)
        name = anchor["name"].strip()
        if not canonical or not name or normalize_name(name) not in listed_names:
            continue
        profiles.setdefault(canonical.casefold(), {"url": canonical, "name": name})
    return {"developers": developers, "profiles": list(profiles.values())}


def lookup_app(app_id: str, cache: dict[str, Any], *, refresh: bool) -> dict[str, Any]:
    """Use cached app metadata or fetch and cache one Steam app."""
    if not refresh and app_id in cache:
        value = cache[app_id]
        return value if isinstance(value, dict) else {"error": "invalid cache entry"}
    result = lookup_steam_app(app_id)
    cache[app_id] = result
    save_cache(cache)
    return result


def map_profiles_to_developers(
    app_id: str,
    steam_data: dict[str, Any],
    developer_ids: set[int],
    developers: dict[int, dict[str, Any]],
) -> tuple[dict[int, set[str]], dict[str, Any] | None]:
    """Map this app's listed Steam developers to associated Directus records.

    A sole Directus association and a sole Steam developer can be linked even
    when their names differ, which supports consolidated Directus records.
    For multiple names or associations, only exact normalized name matches are
    used. This keeps one Steam division from being assigned to another record.
    """
    steam_names = steam_data.get("developers") or []
    profiles = steam_data.get("profiles") or []
    profiles_by_name: dict[str, set[str]] = defaultdict(set)
    for profile in profiles:
        name = normalize_name(profile.get("name") or "")
        url = profile.get("url") or ""
        if name and url:
            profiles_by_name[name].add(url)

    result: dict[int, set[str]] = defaultdict(set)
    unmatched_directus: set[int] = set()

    if len(developer_ids) == 1 and len(steam_names) == 1:
        developer_id = next(iter(developer_ids))
        name_key = normalize_name(steam_names[0])
        result[developer_id].update(profiles_by_name.get(name_key, set()))
        if not result[developer_id] and len(profiles) == 1:
            # Steam's anchor may use a branded spelling that differs from its
            # appdetails field; a single listed developer and one associated
            # Directus record still provide a unique game-level association.
            result[developer_id].add(profiles[0]["url"])
        if not result[developer_id] and profiles:
            return result, {
                "app_id": app_id,
                "steam_developers": steam_names,
                "developers": [
                    {
                        "id": developer_id,
                        "name": developers.get(developer_id, {}).get("name", ""),
                    }
                ],
                "unmatched_steam_names": [
                    profile.get("name", "") for profile in profiles
                ],
            }
        return result, None

    name_to_ids: dict[str, set[int]] = defaultdict(set)
    for developer_id in developer_ids:
        developer = developers.get(developer_id)
        if developer:
            key = normalize_name(developer.get("name") or "")
            if key:
                name_to_ids[key].add(developer_id)

    ambiguous_names: list[str] = []
    for steam_name in steam_names:
        key = normalize_name(steam_name)
        matched_ids = name_to_ids.get(key, set())
        urls = profiles_by_name.get(key, set())
        if len(matched_ids) == 1 and urls:
            developer_id = next(iter(matched_ids))
            result[developer_id].update(urls)
        elif urls:
            ambiguous_names.append(steam_name)

    for developer_id in developer_ids:
        if not result.get(developer_id):
            unmatched_directus.add(developer_id)

    if ambiguous_names or unmatched_directus:
        return result, {
            "app_id": app_id,
            "steam_developers": steam_names,
            "developers": [
                {"id": developer_id, "name": developers[developer_id]["name"]}
                for developer_id in sorted(unmatched_directus)
                if developer_id in developers
            ],
            "unmatched_steam_names": ambiguous_names,
        }
    return result, None


def plan_backfill(client: DirectusClient, *, refresh: bool) -> dict[str, Any]:
    """Plan missing Steam developer links after deduplicating app ids."""
    developers = {
        row["id"]: row for row in fetch_all(client, "developers", "id,name,slug")
    }
    games = {row["id"]: row for row in fetch_all(client, "games", "id,title,slug")}
    game_developers: dict[int, set[int]] = defaultdict(set)
    for row in fetch_all(client, "games_developers", "games_id,developers_id"):
        game_developers[row["games_id"]].add(row["developers_id"])

    # Deduplicate all Steam app links before requests. Keep every Directus
    # association for a shared Steam page, since one app may map to multiple
    # developers and one consolidated developer may map to multiple Steam pages.
    app_games: dict[str, dict[str, Any]] = {}
    for row in fetch_all(client, "games_links", "games_id,url,kind"):
        if row.get("kind") != "download":
            continue
        normalized = normalize_steam_app_url(row.get("url") or "")
        if normalized is None:
            continue
        canonical_url, app_id = normalized
        developer_ids = game_developers.get(row["games_id"], set()) & developers.keys()
        if not developer_ids:
            continue
        group = app_games.setdefault(
            app_id,
            {"url": canonical_url, "game_ids": set(), "developer_ids": set()},
        )
        group["game_ids"].add(row["games_id"])
        group["developer_ids"].update(developer_ids)

    existing_links = fetch_all(client, "developers_links", "id,developers_id,url,kind")
    existing_by_url: dict[str, set[int]] = defaultdict(set)
    for row in existing_links:
        canonical = normalize_steam_developer_url(row.get("url") or "")
        if canonical:
            existing_by_url[canonical.casefold()].add(row["developers_id"])

    cache = load_cache()
    plan: dict[tuple[int, str], dict[str, Any]] = {}
    ambiguous: list[dict[str, Any]] = []
    missing_profiles: list[dict[str, Any]] = []
    lookup_errors: list[dict[str, str]] = []
    conflicts: list[dict[str, Any]] = []
    ordered_app_ids = sorted(app_games, key=int)
    cached_app_ids = sum(
        1 for app_id in ordered_app_ids if not refresh and app_id in cache
    )
    print(
        f"Grouped {len(ordered_app_ids)} unique Steam app ids before lookups.",
        flush=True,
    )

    for index, app_id in enumerate(ordered_app_ids, start=1):
        group = app_games[app_id]
        cached = not refresh and app_id in cache
        source = "cache" if cached else "Steam Store"
        print(f"Looking up {group['url']} from {source}.", flush=True)
        steam_data = lookup_app(app_id, cache, refresh=refresh)
        if steam_data.get("error"):
            lookup_errors.append({"app_id": app_id, "error": steam_data["error"]})
            print(
                f"{progress_label(index, len(ordered_app_ids))} Lookup failed for "
                f"{group['url']}: {steam_data['error']}",
                flush=True,
            )
            continue

        mapped, ambiguity = map_profiles_to_developers(
            app_id,
            steam_data,
            group["developer_ids"],
            developers,
        )
        if ambiguity:
            ambiguous.append(ambiguity)
        if not any(mapped.values()):
            missing_profiles.append(
                {
                    "app_id": app_id,
                    "url": group["url"],
                    "steam_developers": steam_data.get("developers", []),
                }
            )

        for developer_id, urls in mapped.items():
            for url in urls:
                canonical = normalize_steam_developer_url(url)
                if not canonical:
                    continue
                linked_ids = existing_by_url.get(canonical.casefold(), set())
                if linked_ids and developer_id not in linked_ids:
                    conflicts.append(
                        {
                            "app_id": app_id,
                            "url": canonical,
                            "target": {
                                "id": developer_id,
                                "name": developers[developer_id]["name"],
                            },
                            "existing_developer_ids": sorted(linked_ids),
                        }
                    )
                    continue
                if developer_id in linked_ids:
                    continue
                key = (developer_id, canonical.casefold())
                plan.setdefault(
                    key,
                    {
                        "developers_id": developer_id,
                        "developer": developers[developer_id]["name"],
                        "url": canonical,
                        "source_app_id": app_id,
                        "source_games": [
                            games[game_id]["title"]
                            for game_id in sorted(group["game_ids"])
                            if game_id in games
                        ],
                    },
                )

        mapped_count = sum(len(urls) for urls in mapped.values())
        print(
            f"{progress_label(index, len(ordered_app_ids))} Found {mapped_count} "
            f"developer homepage(s) for {group['url']}.",
            flush=True,
        )

    return {
        "plan": list(plan.values()),
        "unique_app_ids": len(app_games),
        "cached_app_ids": cached_app_ids,
        "ambiguous": ambiguous,
        "missing_profiles": missing_profiles,
        "lookup_errors": lookup_errors,
        "conflicts": conflicts,
    }


def main() -> int:
    """Preview or apply missing Steam developer links."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--apply", action="store_true", help="write planned links")
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="ignore cached Steam responses and fetch each app page again",
    )
    args = parser.parse_args()

    client = DirectusClient.from_config()
    try:
        result = plan_backfill(client, refresh=args.refresh)
    except SteamRateLimitError as error:
        print(f"Aborted: {error}", file=sys.stderr)
        return 2
    plan = result["plan"]

    print(
        f"Unique Steam app ids: {result['unique_app_ids']}\n"
        f"Cached app results: {result['cached_app_ids']}\n"
        f"Developer links to add: {len(plan)}"
    )
    for row in plan:
        games_text = ", ".join(row["source_games"])
        print(
            f"  developer/{row['developers_id']} {row['developer']}: {row['url']} "
            f"(Steam app {row['source_app_id']}: {games_text})"
        )

    if result["ambiguous"]:
        print(f"Ambiguous developer associations: {len(result['ambiguous'])}")
        for row in result["ambiguous"]:
            steam_names = ", ".join(row["steam_developers"]) or "(none listed)"
            dev_names = (
                ", ".join(
                    f"{dev['name']} (id={dev['id']})" for dev in row["developers"]
                )
                or "(none)"
            )
            unmatched = ", ".join(row["unmatched_steam_names"]) or "(none)"
            print(
                f"  Steam app {row['app_id']}: Steam developers [{steam_names}], "
                f"unmatched Directus developers [{dev_names}], "
                f"unmatched profile names [{unmatched}]"
            )
    if result["missing_profiles"]:
        print(
            f"Apps without a matching official developer homepage: {len(result['missing_profiles'])}"
        )
        for row in result["missing_profiles"]:
            names = ", ".join(row["steam_developers"]) or "(none listed)"
            print(f"  Steam app {row['app_id']} ({names}): {row['url']}")
    if result["conflicts"]:
        print(f"Developer homepage ownership conflicts: {len(result['conflicts'])}")
        for row in result["conflicts"]:
            print(
                f"  {row['url']} maps to developer/{row['target']['id']} "
                f"{row['target']['name']} but is already linked to developer ids "
                f"{row['existing_developer_ids']}"
            )
    if result["lookup_errors"]:
        print(f"Steam lookup errors: {len(result['lookup_errors'])}")
        for row in result["lookup_errors"]:
            print(f"  Steam app {row['app_id']}: {row['error']}")

    if not args.apply or not plan:
        print(
            "Dry run; no Directus rows were written."
            if not args.apply
            else "Nothing to add."
        )
        return 0

    errors = 0
    for index, row in enumerate(plan, start=1):
        print(
            f"Adding Steam homepage for {row['developer']} ({index}/{len(plan)}).",
            flush=True,
        )
        response = client.request_or_none(
            "POST",
            "/items/developers_links",
            {
                "developers_id": row["developers_id"],
                "url": row["url"],
                "kind": STEAM_KIND,
            },
        )
        if response and response.get("data"):
            print(
                f"{progress_label(index, len(plan))} Added developer/"
                f"{row['developers_id']}: {row['url']}",
                flush=True,
            )
        else:
            errors += 1
            print(
                f"{progress_label(index, len(plan))} Failed developer/"
                f"{row['developers_id']}: {row['url']}",
                flush=True,
            )
    print(f"Applied {len(plan) - errors}/{len(plan)} link(s); errors: {errors}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
