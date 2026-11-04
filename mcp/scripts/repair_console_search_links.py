#!/usr/bin/env python3
"""Resolve legacy PlayStation/Xbox search links to store product pages."""

from __future__ import annotations

import argparse
import importlib
import json
import re
import sys
import time
import unicodedata
import urllib.parse
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

console = importlib.import_module("backfill_console_links")
scriptlib = importlib.import_module("scriptlib")
CACHE_DIR = scriptlib.CACHE_DIR
DirectusClient = scriptlib.DirectusClient
RetryingDirectusClient = scriptlib.RetryingDirectusClient
trigger_site_rebuild = scriptlib.trigger_site_rebuild

CACHE_PATH = CACHE_DIR / "console_store_search_cache.json"
PLAN_PATH = CACHE_DIR / "console_store_search_plan.json"
REVIEW_PATH = CACHE_DIR / "console_store_search_review.md"
PSN_DELAY_S = 2.0
XBOX_DELAY_S = 0.75
ROMAN_INSTALLMENTS = {
    "ii": "2",
    "iii": "3",
    "iv": "4",
    "v": "5",
    "vi": "6",
    "vii": "7",
    "viii": "8",
    "ix": "9",
    "x": "10",
    "xi": "11",
    "xii": "12",
    "xiii": "13",
    "xiv": "14",
    "xv": "15",
    "xvi": "16",
    "xvii": "17",
    "xviii": "18",
    "xix": "19",
    "xx": "20",
}


def installment_numbers(title: str) -> set[str]:
    """Extract Arabic/Roman sequel numbers, including Unicode Roman numerals."""
    normalized = unicodedata.normalize("NFKD", title)
    normalized = re.sub(
        r"\b(?:xbox\s*)?series\s*x(?:\s*\|\s*s)?\b", "", normalized, flags=re.IGNORECASE
    )
    values = {str(int(value)) for value in re.findall(r"\b\d+\b", normalized)}
    values.update(
        value
        for roman, value in ROMAN_INSTALLMENTS.items()
        if re.search(rf"\b{roman}\b", normalized, re.IGNORECASE)
    )
    return values


def normalized_title_tokens(value: str) -> set[str]:
    """Return alphanumeric title words with accents removed."""
    value = value.replace("™", " ").replace("®", " ")
    normalized = (
        unicodedata.normalize("NFKD", value)
        .encode("ascii", "ignore")
        .decode("ascii")
        .casefold()
    )
    return set(re.findall(r"[a-z0-9]+", normalized))


def normalized_similarity(title: str, candidate: str) -> float:
    """Compare title-word overlap, ignoring store symbols and edition suffixes."""
    suffix = {
        "standard",
        "deluxe",
        "ultimate",
        "gold",
        "complete",
        "definitive",
        "special",
        "directors",
        "cut",
        "remastered",
        "enhanced",
        "edition",
        "xbox",
        "series",
        "one",
        "x",
        "s",
        "ps4",
        "ps5",
        "year",
        "goty",
        "collection",
        "bundle",
    }
    left = normalized_title_tokens(title)
    right = normalized_title_tokens(candidate) - suffix
    if not left or not right:
        return 0.0
    overlap = len(left & right)
    return 2 * overlap / (len(left) + len(right))


def protect_sequel_match(title: str, store_name: str, score: float) -> float:
    """Lower a likely sequel match when the Directus and store installments differ."""
    ours = installment_numbers(title)
    result = installment_numbers(store_name)
    if ours and result and not ours.intersection(result):
        return score * 0.55
    if ours and not result:
        return score * 0.55
    if not ours and result:
        return score * 0.70
    title_tokens = normalized_title_tokens(title)
    result_tokens = normalized_title_tokens(store_name)
    if (
        result_tokens
        - title_tokens
        - {
            "tm",
            "xbox",
            "series",
            "one",
            "x",
            "s",
            "ps4",
            "ps5",
            "standard",
            "deluxe",
            "ultimate",
            "gold",
            "complete",
            "definitive",
            "special",
            "directors",
            "cut",
            "remastered",
            "enhanced",
            "edition",
            "game",
            "of",
            "the",
            "year",
            "goty",
            "collection",
            "bundle",
        }
    ):
        return score * 0.55
    return score


def search_platform(url: str) -> tuple[str, str] | None:
    """Return (platform, search term) for a supported console search URL."""
    try:
        parsed = urllib.parse.urlsplit(url)
    except ValueError:
        return None
    host = (parsed.hostname or "").lower()
    path = parsed.path
    if host == "store.playstation.com" and "/search/" in path:
        term = urllib.parse.unquote(path.split("/search/", 1)[1]).strip("/")
        return ("psn", term) if term else None
    if host in {"xbox.com", "www.xbox.com"} and re.search(
        r"/search/?$", path, re.IGNORECASE
    ):
        term = urllib.parse.parse_qs(parsed.query).get("q", [""])[0].strip()
        return ("xbox", term) if term else None
    return None


def product_platform(url: str) -> str | None:
    """Return the console platform for a direct store product URL."""
    try:
        parsed = urllib.parse.urlsplit(url)
    except ValueError:
        return None
    host = (parsed.hostname or "").lower()
    if host == "store.playstation.com" and "/product/" in parsed.path:
        return "psn"
    if host in {"xbox.com", "www.xbox.com"} and "/games/store/" in parsed.path:
        return "xbox"
    return None


def canonical_psn_url(value: str) -> str | None:
    """Normalize a PlayStation product URL and expose its product code."""
    match = re.search(r"/product/([^/?#]+)", value, re.IGNORECASE)
    if not match:
        return None
    return f"https://store.playstation.com/en-us/product/{match.group(1)}"


def psn_generation(url: str) -> int:
    """Rank PS5 above PS4 using the store's product code."""
    product = url.split("/product/", 1)[-1].upper()
    if "PPSA" in product:
        return 2
    if "CUSA" in product:
        return 1
    return 0


def psn_best_latest(
    title: str, results: list[dict[str, Any]]
) -> tuple[str | None, float, str | None]:
    """Choose the best PSN result, preferring a comparable PS5 product."""
    candidates: list[tuple[str, float, str, int]] = []
    for result in results or []:
        name = str(result.get("name") or "").strip()
        url = canonical_psn_url(str(result.get("url") or ""))
        localized_type = str(result.get("localizedType") or "").casefold().strip()
        if not name or not url or console.psn_result_is_non_game(name, localized_type):
            continue
        score = normalized_similarity(title, name)
        score = protect_sequel_match(title, name, score)
        candidates.append((name, score, url, psn_generation(url)))
    if not candidates:
        return None, 0.0, None
    best = max(candidates, key=lambda row: row[1])
    comparable_ps5 = [
        row
        for row in candidates
        if row[3] == 2 and row[1] >= console.HIGH_CONF and row[1] >= best[1] - 0.18
    ]
    chosen = max(comparable_ps5, key=lambda row: row[1]) if comparable_ps5 else best
    return chosen[0], chosen[1], chosen[2]


def xbox_generation(title: str) -> int:
    """Rank explicitly labeled Xbox Series products above Xbox One."""
    if re.search(
        r"\b(xbox\s*)?series\s*x(?:\s*\|\s*s)?\b|\bxbox\s*series\s*s\b",
        title,
        re.IGNORECASE,
    ):
        return 2
    if re.search(r"\bxbox\s*one\b", title, re.IGNORECASE):
        return 1
    return 0


def xbox_product_url(title: str, product_id: str) -> str:
    """Build the visible Xbox Store product URL from its title and product ID."""
    decomposed = unicodedata.normalize("NFKD", title)
    ascii_title = decomposed.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_title.casefold()).strip("-") or "x"
    return f"https://www.xbox.com/en-US/games/store/{slug}/{product_id.lower()}"


def xbox_best_latest(
    title: str, results: list[dict[str, Any]]
) -> tuple[str | None, float, str | None]:
    """Choose the best Xbox result, preferring a comparable Series X|S edition."""
    candidates: list[tuple[str, float, str, int]] = []
    for result in results or []:
        name = str(result.get("Title") or "").strip()
        product_id = str(result.get("ProductId") or "").strip()
        if (
            not name
            or not product_id
            or console.xbox_result_is_pc_only(name)
            or console.xbox_result_is_non_game(name)
            or re.search(r"\bupgrade\b", name, re.IGNORECASE)
        ):
            continue
        score = normalized_similarity(title, name)
        score = protect_sequel_match(title, name, score)
        candidates.append(
            (name, score, xbox_product_url(name, product_id), xbox_generation(name))
        )
    if not candidates:
        return None, 0.0, None
    best = max(candidates, key=lambda row: row[1])
    comparable_series = [
        row
        for row in candidates
        if row[3] == 2 and row[1] >= console.HIGH_CONF and row[1] >= best[1] - 0.18
    ]
    chosen = (
        max(comparable_series, key=lambda row: row[1]) if comparable_series else best
    )
    return chosen[0], chosen[1], chosen[2]


def atomic_write(path: Path, value: Any) -> None:
    """Write JSON atomically."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    temporary.replace(path)


def load_json(path: Path, fallback: Any) -> Any:
    """Load JSON or use the supplied default."""
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback


def get_store_result(
    platform: str, query: str, match_title: str
) -> tuple[str | None, float, str | None, str | None]:
    """Query a console store and return the top confident product candidate."""
    if platform == "psn":
        results, error = console.psn_search(query)
        if error:
            return None, 0.0, None, error
        name, score, url = psn_best_latest(match_title, results or [])
    else:
        results, error = console.xbox_search(query)
        if error:
            return None, 0.0, None, error
        name, score, url = xbox_best_latest(match_title, results or [])
    return name, score, url, None


def build_plan(
    games: list[dict[str, Any]],
    cache: dict[str, Any],
    *,
    refresh: bool,
    delay_scale: float,
) -> list[dict[str, Any]]:
    """Resolve each search URL to a high-confidence product URL."""
    rows: list[dict[str, Any]] = []
    last_request: dict[str, float] = {}
    for game in games:
        links = game.get("links") or []
        direct_platforms = {
            platform
            for link in links
            if isinstance(link, dict) and link.get("kind") == "download"
            for detected in [search_platform(str(link.get("url") or ""))]
            if detected is None
            for platform in [
                "psn"
                if "store.playstation.com" in str(link.get("url") or "").lower()
                else "xbox"
                if re.search(
                    r"(?:www\.)?xbox\.com/",
                    str(link.get("url") or ""),
                    re.IGNORECASE,
                )
                else ""
            ]
            if platform
        }
        for link in links:
            if not isinstance(link, dict) or link.get("kind") != "download":
                continue
            found = search_platform(str(link.get("url") or ""))
            if not found:
                continue
            platform, query = found
            row = {
                "game_id": game["id"],
                "slug": game.get("slug"),
                "title": game.get("title"),
                "link_id": link.get("id"),
                "old_url": link.get("url"),
                "platform": platform,
                "query": query,
                "store_name": None,
                "score": 0.0,
                "new_url": None,
                "action": "review",
                "reason": "",
            }
            if not row["link_id"]:
                row["reason"] = "search link has no Directus row ID"
                rows.append(row)
                continue
            if platform in direct_platforms:
                row["reason"] = (
                    "another product/download link already exists for this platform"
                )
                rows.append(row)
                continue
            key = f"{platform}:{query.casefold()}:{str(game.get('title') or '').casefold()}"
            result = cache.get(key) if not refresh else None
            if not isinstance(result, dict):
                delay = (
                    PSN_DELAY_S if platform == "psn" else XBOX_DELAY_S
                ) * delay_scale
                previous = last_request.get(platform)
                if previous is not None:
                    remaining = delay - (time.monotonic() - previous)
                    if remaining > 0:
                        time.sleep(remaining)
                print(f"{platform.upper()} lookup: {game.get('slug')}", flush=True)
                name, score, url, error = get_store_result(
                    platform, query, str(game.get("title") or query)
                )
                last_request[platform] = time.monotonic()
                result = {
                    "store_name": name,
                    "score": score,
                    "url": url,
                    "error": error,
                }
                cache[key] = result
                atomic_write(CACHE_PATH, cache)
            store_name = str(result.get("store_name") or "")
            score = (
                protect_sequel_match(
                    str(game.get("title") or ""),
                    store_name,
                    normalized_similarity(str(game.get("title") or ""), store_name),
                )
                if store_name
                else 0.0
            )
            row.update(
                {
                    "store_name": result.get("store_name"),
                    "score": score,
                    "new_url": result.get("url"),
                }
            )
            if result.get("error"):
                row["reason"] = result["error"]
            elif result.get("url") and row["score"] >= console.HIGH_CONF:
                row["action"] = "update"
            elif result.get("url"):
                row["reason"] = "match confidence below auto-update threshold"
            else:
                row["reason"] = "no matching product result"
            rows.append(row)
    return rows


def write_review(rows: list[dict[str, Any]]) -> None:
    """Write uncertain or ambiguous rows for curation."""
    review = [row for row in rows if row.get("action") != "update"]
    lines = [
        "# Console search-link repair review",
        "",
        f"- Product URLs to update: {sum(row.get('action') == 'update' for row in rows)}",
        f"- Needs review/skipped: {len(review)}",
        "",
    ]
    for row in review:
        lines.extend(
            [
                f"## {row.get('title')} (`{row.get('slug')}`, game {row.get('game_id')})",
                "",
                f"- Platform: {row.get('platform')}",
                f"- Current URL: {row.get('old_url')}",
                f"- Candidate: {row.get('store_name')!r} ({row.get('score', 0):.2f})",
                f"- Proposed URL: {row.get('new_url') or '_none_'}",
                f"- Reason: {row.get('reason') or '_manual review_'}",
                "",
            ]
        )
    REVIEW_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def apply_plan(selected_slugs: set[str]) -> int:
    """Replace stored search URLs only when their source rows are unchanged."""
    plan = load_json(PLAN_PATH, None)
    if not isinstance(plan, dict) or not isinstance(plan.get("rows"), list):
        raise TypeError(f"Plan not found: {PLAN_PATH}; run a dry run first")
    client = RetryingDirectusClient(DirectusClient.from_config())
    candidates = [
        row
        for row in plan["rows"]
        if row.get("action") == "update"
        and (not selected_slugs or row.get("slug") in selected_slugs)
    ]
    changed_games: set[int] = set()
    skipped = errors = 0
    for index, row in enumerate(candidates, start=1):
        game_id = int(row["game_id"])
        link_id = int(row["link_id"])
        try:
            current = (
                client.get(
                    f"/items/games/{game_id}",
                    params={"fields": "id,slug,title,links.id,links.url,links.kind"},
                ).get("data")
                or {}
            )
            link = next(
                (
                    item
                    for item in current.get("links") or []
                    if int(item.get("id") or 0) == link_id
                ),
                None,
            )
            link_is_unchanged = all(
                [
                    current.get("slug") == row.get("slug"),
                    current.get("title") == row.get("title"),
                    bool(link),
                    bool(link and link.get("kind") == "download"),
                    bool(link and link.get("url") == row.get("old_url")),
                    bool(link and search_platform(str(link.get("url") or ""))),
                ]
            )
            if not link_is_unchanged:
                skipped += 1
                print(
                    f"Skipped {row.get('slug')}: link changed since planning",
                    flush=True,
                )
                continue
            if any(
                int(item.get("id") or 0) != link_id
                and item.get("kind") == "download"
                and product_platform(str(item.get("url") or "")) == row.get("platform")
                for item in current.get("links") or []
            ):
                skipped += 1
                print(
                    f"Skipped {row.get('slug')}: product link was added since planning",
                    flush=True,
                )
                continue
            client.patch(
                f"/items/games_links/{link_id}",
                {"url": row["new_url"]},
                description=f"replace console search URL for game {game_id}",
            )
            changed_games.add(game_id)
        except Exception as error:  # noqa: BLE001 - report each update failure
            errors += 1
            print(f"Failed {row.get('slug')}: {error}", file=sys.stderr, flush=True)
        if index % 25 == 0:
            print(f"Apply progress: {index}/{len(candidates)}", flush=True)
    if changed_games:
        trigger_site_rebuild(client.base_client, sorted(changed_games))
    print(
        f"Apply summary: updated={len(candidates) - skipped - errors}, "
        f"skipped={skipped}, errors={errors}",
        flush=True,
    )
    return 1 if errors else 0


def main() -> int:
    """Plan or apply repairs for existing console search links."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="apply the saved plan")
    parser.add_argument(
        "--refresh", action="store_true", help="ignore cached store results"
    )
    parser.add_argument(
        "--only-slug",
        action="append",
        default=[],
        help="limit to a game slug; repeatable",
    )
    parser.add_argument("--limit", type=int, help="limit the number of games inspected")
    parser.add_argument(
        "--delay-scale", type=float, default=1.0, help="multiply store request delays"
    )
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be at least 1")
    if args.delay_scale < 0:
        parser.error("--delay-scale must be zero or greater")
    selected_slugs = set(args.only_slug)
    if args.apply:
        return apply_plan(selected_slugs)

    client = RetryingDirectusClient(DirectusClient.from_config())
    games = client.fetch_all(
        "/items/games?fields=id,title,slug,links.id,links.url,links.kind,links.sort",
        description="fetch games for console search-link repair",
    )
    if selected_slugs:
        games = [game for game in games if game.get("slug") in selected_slugs]
    if args.limit is not None:
        games = games[: args.limit]
    cache = load_json(CACHE_PATH, {})
    if not isinstance(cache, dict):
        cache = {}
    rows = build_plan(games, cache, refresh=args.refresh, delay_scale=args.delay_scale)
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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
