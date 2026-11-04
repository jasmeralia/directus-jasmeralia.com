#!/usr/bin/env python3
"""Backfill blank AVN synopses from public itch.io page descriptions."""

from __future__ import annotations

import argparse
import importlib
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

steam_synopsis = importlib.import_module("backfill_steam_synopsis")
excluded_game = steam_synopsis.excluded_game
normalize_synopsis = steam_synopsis.normalize_synopsis
scriptlib = importlib.import_module("scriptlib")
CACHE_DIR = scriptlib.CACHE_DIR
DirectusClient = scriptlib.DirectusClient
RetryingDirectusClient = scriptlib.RetryingDirectusClient
trigger_site_rebuild = scriptlib.trigger_site_rebuild

CACHE_PATH = CACHE_DIR / "itch_synopsis_cache.json"
PLAN_PATH = CACHE_DIR / "itch_synopsis_plan.json"
REVIEW_PATH = CACHE_DIR / "itch_synopsis_review.md"
DEFAULT_DELAY_S = 1.5
MAX_RETRIES = 5
RATE_LIMIT_CODES = {403, 429, 503}
UNINFORMATIVE_DESCRIPTION = re.compile(
    r"^(?:available\s+(?:for|on)\s+.+|(?:windows|macos|linux|android)(?:\s*[,/&].*)?)$",
    re.IGNORECASE,
)


class ItchMetadataParser(HTMLParser):
    """Read the public summary and title metadata from an itch.io page."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.descriptions: dict[str, str] = {}
        self.title_parts: list[str] = []
        self.in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() == "title":
            self.in_title = True
            return
        if tag.lower() != "meta":
            return
        values = {key.lower(): value or "" for key, value in attrs}
        content = values.get("content", "").strip()
        if not content:
            return
        key = values.get("property", "").lower() or values.get("name", "").lower()
        if key in {"og:description", "description", "twitter:description"}:
            self.descriptions.setdefault(key, content)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "title":
            self.in_title = False

    def handle_data(self, data: str) -> None:
        if self.in_title:
            self.title_parts.append(data)

    def description(self) -> str:
        """Return the preferred summary text."""
        return (
            self.descriptions.get("og:description")
            or self.descriptions.get("description")
            or self.descriptions.get("twitter:description")
            or ""
        )


def canonical_itch_url(value: str) -> str | None:
    """Return a public HTTPS itch.io game URL, excluding profile-only links."""
    try:
        parsed = urllib.parse.urlsplit(value.strip())
        port = parsed.port
    except ValueError:
        return None
    host = (parsed.hostname or "").lower().rstrip(".")
    if parsed.scheme.lower() != "https" or parsed.username or parsed.password:
        return None
    if port not in (None, 443) or host == "itch.io":
        return None
    if not host.endswith(".itch.io") or not parsed.path.strip("/"):
        return None
    return urllib.parse.urlunsplit(("https", host, parsed.path.rstrip("/"), "", ""))


def fetch_page(url: str) -> tuple[dict[str, str] | None, str | None]:
    """Fetch one page, honoring rate-limit retry headers and bounded backoff."""
    delay = 2.0
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; GameSynopsisBackfill/1.0)",
        "Accept": "text/html,application/xhtml+xml",
    }
    for attempt in range(MAX_RETRIES):
        request = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                parser = ItchMetadataParser()
                parser.feed(response.read().decode("utf-8", errors="replace"))
                parser.close()
                return {
                    "page_title": " ".join(parser.title_parts).strip(),
                    "description": parser.description(),
                }, None
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None, "not_found"
            if error.code not in RATE_LIMIT_CODES:
                return None, f"http_{error.code}"
            retry_after = error.headers.get("Retry-After", "")
            try:
                wait = max(1.0, float(retry_after))
            except ValueError:
                try:
                    retry_time = parsedate_to_datetime(retry_after)
                    if retry_time.tzinfo is None:
                        retry_time = retry_time.replace(tzinfo=UTC)
                    wait = max(1.0, (retry_time - datetime.now(UTC)).total_seconds())
                except (TypeError, ValueError, OverflowError):
                    wait = delay
            if attempt == MAX_RETRIES - 1:
                return None, "rate_limit_exceeded"
            print(
                f"  itch.io returned HTTP {error.code}; retrying in {wait:.0f}s "
                f"({attempt + 1}/{MAX_RETRIES})",
                file=sys.stderr,
                flush=True,
            )
            time.sleep(wait)
            delay = min(delay * 2, 900.0)
        except (TimeoutError, urllib.error.URLError) as error:
            if attempt == MAX_RETRIES - 1:
                return None, f"network_error:{error}"
            time.sleep(delay)
            delay = min(delay * 2, 900.0)
    return None, "rate_limit_exceeded"


def atomic_write(path: Path, value: Any) -> None:
    """Write JSON atomically so a stopped run remains resumable."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    temporary.replace(path)


def load_json(path: Path, fallback: Any) -> Any:
    """Load a cache file or return its default value."""
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback


def write_review(rows: list[dict[str, Any]]) -> None:
    """Write short, unavailable, and otherwise nonautomatic rows for review."""
    review = [
        row
        for row in rows
        if row.get("action") == "review"
        or row.get("flags")
        or row.get("reason") in {"no itch link", "multiple itch links"}
    ]
    lines = ["# Itch.io synopsis review", "", f"- Rows for review: {len(review)}", ""]
    for row in review:
        lines.extend(
            [
                f"## {row.get('title')} (`{row.get('slug')}`, game {row.get('id')})",
                "",
                f"- Itch URL: {row.get('itch_url') or '_none_'}",
                f"- Page title: {row.get('page_title') or '_none_'}",
                f"- Synopsis: {row.get('synopsis') or '_none_'}",
                f"- Flags: {', '.join(row.get('flags') or []) or '_none_'}",
                f"- Action: {row.get('action')}",
                f"- Reason: {row.get('reason') or '_manual review_'}",
                "",
            ]
        )
    REVIEW_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def itch_links(game: dict[str, Any]) -> list[str]:
    """Return unique canonical itch.io game links on download junctions."""
    return sorted(
        {
            canonical
            for link in game.get("links") or []
            if isinstance(link, dict) and link.get("kind") == "download"
            for canonical in [canonical_itch_url(str(link.get("url") or ""))]
            if canonical
        }
    )


def plan_rows(
    games: list[dict[str, Any]],
    *,
    selected_slugs: set[str],
    cache: dict[str, Any],
    refresh: bool,
    delay: float,
) -> list[dict[str, Any]]:
    """Fetch and plan synopses for currently blank AVN records."""
    rows: list[dict[str, Any]] = []
    pending = [
        game
        for game in games
        if not selected_slugs or str(game.get("slug") or "") in selected_slugs
    ]
    last_request = 0.0
    for index, game in enumerate(pending, start=1):
        row: dict[str, Any] = {
            "id": game["id"],
            "slug": game.get("slug"),
            "title": game.get("title"),
            "old_synopsis": game.get("synopsis"),
            "old_synopsis_source": game.get("synopsis_source"),
            "itch_url": None,
            "synopsis": None,
            "page_title": None,
            "flags": [],
            "action": "skip",
        }
        if excluded_game(game):
            row["reason"] = "excluded game"
        elif not any(
            str((genre.get("genres_id") or {}).get("name") or "").casefold() == "avn"
            for genre in game.get("genres") or []
            if isinstance(genre, dict)
        ):
            row["reason"] = "not AVN"
        elif str(game.get("synopsis_source") or "").casefold() not in {"", "itch"}:
            row["reason"] = "another source owns the synopsis"
        elif str(game.get("synopsis") or "").strip():
            row["reason"] = "synopsis is not blank"
        else:
            urls = itch_links(game)
            if len(urls) != 1:
                row["reason"] = "no itch link" if not urls else "multiple itch links"
            else:
                url = urls[0]
                row["itch_url"] = url
                result = cache.get(url) if not refresh else None
                if not isinstance(result, dict):
                    remaining = delay - (time.monotonic() - last_request)
                    if last_request and remaining > 0:
                        time.sleep(remaining)
                    print(
                        f"itch synopsis {index}/{len(pending)}: {game.get('slug')}",
                        flush=True,
                    )
                    fetched, error = fetch_page(url)
                    last_request = time.monotonic()
                    result = (
                        {"status": "error", "error": error}
                        if error
                        else {"status": "found", **(fetched or {})}
                    )
                    cache[url] = result
                    atomic_write(CACHE_PATH, cache)
                description = str(result.get("description") or "")
                if result.get("status") == "found" and description:
                    synopsis, flags = normalize_synopsis(description)
                    row.update(
                        {
                            "synopsis": synopsis,
                            "page_title": result.get("page_title"),
                            "flags": flags,
                            "action": "create",
                            "reason": "",
                        }
                    )
                    if UNINFORMATIVE_DESCRIPTION.fullmatch(synopsis.strip()):
                        row["action"] = "review"
                        row["reason"] = (
                            "itch description contains only platform availability"
                        )
                else:
                    row["action"] = "review"
                    row["reason"] = result.get("error") or "no page description"
        rows.append(row)
    return rows


def apply_plan(selected_slugs: set[str]) -> int:
    """Apply saved rows only if the game and itch link are unchanged."""
    plan = load_json(PLAN_PATH, None)
    if not isinstance(plan, dict) or not isinstance(plan.get("rows"), list):
        raise TypeError(f"Plan not found: {PLAN_PATH}; run a dry run first")
    client = RetryingDirectusClient(DirectusClient.from_config())
    candidates = [
        row
        for row in plan["rows"]
        if row.get("action") == "create"
        and (not selected_slugs or row.get("slug") in selected_slugs)
    ]
    changed_ids: list[int] = []
    skipped = errors = 0
    for index, row in enumerate(candidates, start=1):
        game_id = int(row["id"])
        try:
            current = (
                client.get(
                    f"/items/games/{game_id}",
                    params={
                        "fields": "id,slug,title,synopsis,synopsis_source,links.url,links.kind,genres.genres_id.name"
                    },
                ).get("data")
                or {}
            )
            row_matches = all(
                [
                    bool(current),
                    not excluded_game(current),
                    current.get("slug") == row.get("slug"),
                    not str(current.get("synopsis") or "").strip(),
                    current.get("synopsis_source") == row.get("old_synopsis_source"),
                    current.get("synopsis") == row.get("old_synopsis"),
                    itch_links(current) == [row.get("itch_url")],
                    any(
                        str((genre.get("genres_id") or {}).get("name") or "").casefold()
                        == "avn"
                        for genre in current.get("genres") or []
                        if isinstance(genre, dict)
                    ),
                ]
            )
            if not row_matches:
                skipped += 1
                print(
                    f"Skipped {row.get('slug')}: record changed since planning",
                    flush=True,
                )
                continue
            client.patch(
                f"/items/games/{game_id}",
                {"synopsis": row["synopsis"], "synopsis_source": "itch"},
                description=f"write itch synopsis for {game_id}",
            )
            changed_ids.append(game_id)
        except Exception as error:  # noqa: BLE001 - report individual failures
            errors += 1
            print(f"Failed {row.get('slug')}: {error}", file=sys.stderr, flush=True)
        if index % 25 == 0:
            print(f"Apply progress: {index}/{len(candidates)}", flush=True)
    if changed_ids:
        trigger_site_rebuild(client.base_client, changed_ids)
    print(
        f"Apply summary: updated={len(changed_ids)}, skipped={skipped}, errors={errors}",
        flush=True,
    )
    return 1 if errors else 0


def main() -> int:
    """Build or apply a resumable itch synopsis plan."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write planned synopses")
    parser.add_argument(
        "--refresh", action="store_true", help="refresh cached itch pages"
    )
    parser.add_argument(
        "--only-slug",
        action="append",
        default=[],
        help="limit to a game slug; repeatable",
    )
    parser.add_argument(
        "--limit", type=int, help="maximum number of eligible pages to fetch"
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=DEFAULT_DELAY_S,
        help="minimum seconds between itch.io requests",
    )
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be at least 1")
    if args.delay < 0:
        parser.error("--delay must be zero or greater")
    selected_slugs = set(args.only_slug)
    if args.apply:
        return apply_plan(selected_slugs)

    client = RetryingDirectusClient(DirectusClient.from_config())
    games = client.fetch_all(
        "/items/games?fields=id,slug,title,synopsis,synopsis_source,links.url,links.kind,genres.genres_id.name",
        description="fetch games for itch synopsis backfill",
    )
    eligible = [
        game
        for game in games
        if (not selected_slugs or str(game.get("slug") or "") in selected_slugs)
        and not excluded_game(game)
        and any(
            str((genre.get("genres_id") or {}).get("name") or "").casefold() == "avn"
            for genre in game.get("genres") or []
            if isinstance(genre, dict)
        )
        and not str(game.get("synopsis") or "").strip()
        and str(game.get("synopsis_source") or "").casefold() in {"", "itch"}
        and len(itch_links(game)) == 1
    ]
    if args.limit is not None:
        eligible_ids = {game["id"] for game in eligible[: args.limit]}
        games = [game for game in games if game["id"] in eligible_ids]
    cache = load_json(CACHE_PATH, {})
    if not isinstance(cache, dict):
        cache = {}
    rows = plan_rows(
        games,
        selected_slugs=selected_slugs,
        cache=cache,
        refresh=args.refresh,
        delay=args.delay,
    )
    plan = {
        "generated_at": datetime.now(UTC).isoformat(),
        "mode": "dry-run",
        "rows": rows,
    }
    atomic_write(PLAN_PATH, plan)
    write_review(rows)
    counts: dict[str, int] = {}
    for row in rows:
        counts[row["action"]] = counts.get(row["action"], 0) + 1
    print(
        "Plan summary: "
        + ", ".join(f"{key}={value}" for key, value in sorted(counts.items())),
        flush=True,
    )
    print(f"Plan: {PLAN_PATH}", flush=True)
    print(f"Review: {REVIEW_PATH}", flush=True)
    print(f"Cache: {CACHE_PATH}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
