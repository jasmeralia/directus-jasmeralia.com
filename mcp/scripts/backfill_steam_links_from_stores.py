#!/usr/bin/env python3
"""
backfill_steam_links_from_stores.py

For each game whose only PC storefront links are Epic Games Store and/or GOG
(no Steam link at all):
  1. Searches the Steam store for candidate apps (title, edition-stripped title,
     and pre-subtitle title, stopping at the first variant that yields a
     plausible candidate).
  2. Verifies the top candidates through Steam's appdetails (type must be
     `game`; release year and developers are read from it).
  3. Scores each candidate on title similarity plus release-year consistency and
     sorts the game into `high` (auto-appliable), `review`, or `none`.
  4. Writes a markdown/JSON report; with --apply, adds a `games_links` row
     (`kind: download`) for every `high` match.

Many of these games genuinely are not on Steam (very old GOG-only releases,
Epic exclusives), so `none` is an expected, common result.

Steam is an external API: every uncached request is spaced by REQUEST_DELAY_S
and retried with backoff on 403/429. All responses are cached in
mcp/cache/steam_for_store_games_cache.json, so --apply (and any re-run) never
re-queries Steam for something already resolved. Transient failures are not
cached and are retried on the next run.

Usage:
  python3 backfill_steam_links_from_stores.py                  # dry run + report
  python3 backfill_steam_links_from_stores.py --apply          # add `high` links
  python3 backfill_steam_links_from_stores.py --apply --accept 1779,2045
                                                               # also add these reviewed ids
  python3 backfill_steam_links_from_stores.py --missing-developers-only
  python3 backfill_steam_links_from_stores.py --game-id 1779 --limit 5
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
import time
import unicodedata
import urllib.parse
from dataclasses import dataclass, field
from typing import Any

from scriptlib import (
    CACHE_DIR,
    DirectusClient,
    ProgressCache,
    RetryPolicy,
    fetch_with_backoff,
    trigger_site_rebuild,
)
from steamlib import extract_release_year, extract_steam_appid, fetch_steam_details

CACHE_PATH = CACHE_DIR / "steam_for_store_games_cache.json"
REPORT_MD_PATH = CACHE_DIR / "steam_for_store_games_report.md"
REPORT_JSON_PATH = CACHE_DIR / "steam_for_store_games_report.json"

REQUEST_DELAY_S = 1.5
SEARCH_URL = "https://store.steampowered.com/api/storesearch/?"
STEAM_APP_URL = "https://store.steampowered.com/app/{appid}/"

REVIEW_SIM = 0.60  # minimum title similarity to consider a candidate at all
HIGH_SIM = 0.92  # minimum title similarity for an auto-appliable match
EXACT_SIM = 0.98  # near-identical titles tolerate a later Steam re-release year
RUNNER_UP_MARGIN = 0.03  # a second candidate this close forces manual review
MAX_DETAIL_CANDIDATES = 3
TIERS = ("high", "review", "none", "error")

ROMAN = {
    "ii": "2",
    "iii": "3",
    "iv": "4",
    "v": "5",
    "vi": "6",
    "vii": "7",
    "viii": "8",
    "ix": "9",
    "x": "10",
}
# Words that distinguish re-releases of the same game rather than different games.
EDITION_WORDS = {
    "edition",
    "remastered",
    "remaster",
    "definitive",
    "complete",
    "enhanced",
    "goty",
    "deluxe",
    "anniversary",
    "masterpiece",
    "special",
    "ultimate",
    "directors",
    "cut",
    "hd",
    "gold",
    "standard",
    "premium",
    "legacy",
    "game",
    "of",
    "the",
    "year",
}
_PUNCT = re.compile(r"[^a-z0-9]+")
_APOSTROPHES = str.maketrans("", "", "'" + chr(0x2019))


def tokens(title: str) -> list[str]:
    """Normalize a title into comparison tokens (accents, symbols, numerals)."""
    text = unicodedata.normalize("NFKD", title)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower().replace("&", " and ").translate(_APOSTROPHES)
    return [ROMAN.get(w, w) for w in _PUNCT.sub(" ", text).split()]


def core_tokens(title: str) -> list[str]:
    """Tokens with edition/re-release wording removed."""
    return [w for w in tokens(title) if w not in EDITION_WORDS]


def number_tokens(words: list[str]) -> set[str]:
    """Return the digit-bearing tokens, used to separate sequels and entries."""
    return {w for w in words if any(ch.isdigit() for ch in w)}


@dataclass
class Score:
    """Title-similarity result for one candidate."""

    similarity: float
    edition_differs: bool = False
    number_mismatch: bool = False


def title_score(ours: str, theirs: str) -> Score:
    """Score two titles, penalizing sequel-number mismatches."""
    full_a, full_b = tokens(ours), tokens(theirs)
    full = difflib.SequenceMatcher(None, " ".join(full_a), " ".join(full_b)).ratio()
    core_a, core_b = core_tokens(ours), core_tokens(theirs)
    core = (
        difflib.SequenceMatcher(None, " ".join(core_a), " ".join(core_b)).ratio()
        if core_a and core_b
        else 0.0
    )
    edition_differs = full < core
    similarity = max(full, core * 0.97 if edition_differs else core)
    number_mismatch = number_tokens(full_a) != number_tokens(full_b)
    if number_mismatch:
        similarity *= 0.7
    return Score(similarity, edition_differs, number_mismatch)


def search_variants(title: str) -> list[str]:
    """Return distinct search terms to try in order, most specific first."""
    variants = [title]
    stripped = " ".join(core_tokens(title))
    if stripped and stripped != " ".join(tokens(title)):
        variants.append(stripped)
    head = re.split(r"\s*(?::|\s-\s)\s*", title, maxsplit=1)[0].strip()
    if len(head) >= 4 and head != title:
        variants.append(head)
    unique: list[str] = []
    for variant in variants:
        if variant.lower() not in {u.lower() for u in unique}:
            unique.append(variant)
    return unique


# --- Steam access (cached, rate-limited) -------------------------------------


class SteamLookup:
    """Cache-first Steam search/details with request pacing."""

    def __init__(self, cache: ProgressCache) -> None:
        """Wrap a resumable cache; only uncached calls hit the network."""
        self.cache = cache
        self.requests = 0

    def _pace(self) -> None:
        if self.requests:
            time.sleep(REQUEST_DELAY_S)
        self.requests += 1

    def search(self, term: str) -> tuple[list[dict[str, Any]] | None, str | None]:
        """Return (apps, error). Only successful responses are cached."""
        key = f"search:{term.lower()}"
        if key in self.cache:
            return self.cache.get(key), None
        self._pace()
        query = urllib.parse.urlencode({"term": term, "l": "english", "cc": "US"})
        data, err = fetch_with_backoff(
            SEARCH_URL + query,
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=15,
            retry=RetryPolicy(rate_limit_codes=(403, 429)),
        )
        if data is None:
            return None, err
        apps = [
            {"id": item["id"], "name": item["name"]}
            for item in data.get("items", [])
            if item.get("type") == "app"
        ]
        self.cache.set(key, apps)
        return apps, None

    def details(self, appid: int) -> tuple[dict[str, Any] | None, str | None]:
        """Return trimmed appdetails (type, name, year, developers) or an error."""
        key = f"details:{appid}"
        if key in self.cache:
            return self.cache.get(key), None
        self._pace()
        data, err = fetch_steam_details(appid)
        if data is None:
            if err == "api_no_success":  # delisted/region-locked: a stable answer
                self.cache.set(key, {"type": "unavailable"})
                return self.cache.get(key), None
            return None, err
        release = data.get("release_date") or {}
        year = (
            None
            if release.get("coming_soon")
            else extract_release_year(release.get("date"))
        )
        trimmed = {
            "type": data.get("type"),
            "name": data.get("name"),
            "year": year,
            "developers": data.get("developers") or [],
        }
        self.cache.set(key, trimmed)
        return trimmed, None


# --- Matching -----------------------------------------------------------------


@dataclass
class Candidate:
    """A verified Steam candidate for one game."""

    appid: int
    name: str
    similarity: float
    year: int | None
    developers: list[str]
    edition_differs: bool = False
    notes: list[str] = field(default_factory=list)


def classify(ours_year: int | None, cand: Candidate) -> str:
    """Return `high` or `review` for a scored candidate, appending reasons."""
    if cand.similarity < HIGH_SIM:
        cand.notes.append(f"title similarity {cand.similarity:.2f} < {HIGH_SIM}")
        return "review"
    if cand.edition_differs:
        return "review"  # a different edition/product, not just a rename
    if ours_year is None or cand.year is None:
        return "high"
    delta = cand.year - ours_year
    if delta < -1:
        cand.notes.append(f"Steam release {cand.year} predates ours ({ours_year})")
        return "review"
    if delta > 1 and cand.similarity < EXACT_SIM:
        cand.notes.append(
            f"Steam release {cand.year} is {delta}y after ours ({ours_year})"
        )
        return "review"
    if delta > 1:
        cand.notes.append(f"later Steam re-release ({cand.year} vs ours {ours_year})")
    return "high"


def find_match(steam: SteamLookup, title: str, ours_year: int | None) -> dict[str, Any]:
    """Search Steam for one game and return a decision record."""
    ranked: list[tuple[Score, dict[str, Any]]] = []
    for term in search_variants(title):
        apps, err = steam.search(term)
        if apps is None:
            return {"tier": "error", "error": err}
        scored = [(title_score(title, app["name"]), app) for app in apps]
        ranked = sorted(
            (pair for pair in scored if pair[0].similarity >= REVIEW_SIM),
            key=lambda pair: -pair[0].similarity,
        )
        if ranked:
            break
    if not ranked:
        return {"tier": "none"}

    candidates: list[Candidate] = []
    for score, app in ranked[:MAX_DETAIL_CANDIDATES]:
        details, err = steam.details(app["id"])
        if details is None:
            return {"tier": "error", "error": err}
        if details.get("type") != "game":
            continue
        cand = Candidate(
            appid=app["id"],
            name=details.get("name") or app["name"],
            similarity=score.similarity,
            year=details.get("year"),
            developers=details.get("developers", []),
            edition_differs=score.edition_differs,
        )
        if score.edition_differs:
            cand.notes.append("edition wording differs")
        if score.number_mismatch:
            cand.notes.append("sequel/number tokens differ")
        candidates.append(cand)
    if not candidates:
        return {"tier": "none", "note": "only non-game results (DLC/demo/etc.)"}

    top = candidates[0]
    tier = classify(ours_year, top)
    if tier == "high" and len(candidates) > 1:
        runner = candidates[1]
        if runner.similarity >= top.similarity - RUNNER_UP_MARGIN:
            top.notes.append(f"close runner-up: {runner.name!r} ({runner.appid})")
            tier = "review"
    return {
        "tier": tier,
        "appid": top.appid,
        "steam_name": top.name,
        "similarity": round(top.similarity, 3),
        "steam_year": top.year,
        "developers": top.developers,
        "notes": top.notes,
        "url": STEAM_APP_URL.format(appid=top.appid),
        "alternatives": [
            {"appid": c.appid, "name": c.name, "similarity": round(c.similarity, 3)}
            for c in candidates[1:]
        ],
    }


# --- Targets ------------------------------------------------------------------


def store_flags(links: list[dict[str, Any]]) -> tuple[bool, bool, bool]:
    """Return (has_epic, has_gog, has_steam) across all link kinds."""
    urls = [link.get("url") or "" for link in links]
    return (
        any("epicgames.com" in u for u in urls),
        any("gog.com" in u for u in urls),
        any(extract_steam_appid(u) is not None for u in urls),
    )


def load_targets(
    client: DirectusClient, args: argparse.Namespace
) -> list[dict[str, Any]]:
    """Return Epic/GOG-linked games that have no Steam link."""
    games = client.fetch_all(
        "/items/games?fields=id,title,release_year,developers.developers_id,"
        "links.url,links.kind&sort=id"
    )
    targets = []
    for game in games:
        epic, gog, steam = store_flags(game.get("links") or [])
        if steam or not (epic or gog):
            continue
        if args.missing_developers_only and game.get("developers"):
            continue
        if args.game_id and game["id"] not in args.game_id:
            continue
        game["stores"] = [name for name, on in (("epic", epic), ("gog", gog)) if on]
        targets.append(game)
    return targets[: args.limit] if args.limit else targets


# --- Reporting ----------------------------------------------------------------


def render_report(rows: list[dict[str, Any]]) -> str:
    """Render the markdown review report."""
    by_tier = {t: [r for r in rows if r["decision"]["tier"] == t] for t in TIERS}
    lines = [
        "# Steam links for Epic/GOG-only games",
        "",
        "Counts: " + ", ".join(f"{t}={len(v)}" for t, v in by_tier.items()),
        "",
    ]
    headings = {
        "high": "High confidence (applied with --apply)",
        "review": "Needs review (apply with --accept <id,...>)",
    }
    for tier, heading in headings.items():
        lines += [f"## {heading}", ""]
        for row in by_tier[tier]:
            dec = row["decision"]
            devs = ", ".join(dec["developers"]) or "unknown"
            notes = f" - {'; '.join(dec['notes'])}" if dec["notes"] else ""
            lines.append(
                f"- **{row['id']}** {row['title']!r} ({row['year']}, "
                f"{'/'.join(row['stores'])}) -> [{dec['steam_name']}]({dec['url']}) "
                f"({dec['steam_year']}, sim {dec['similarity']}), dev: {devs}{notes}"
            )
        lines.append("")
    lines += ["## No Steam match (likely not on Steam)", ""]
    lines += [
        f"- **{r['id']}** {r['title']!r} ({r['year']}, {'/'.join(r['stores'])})"
        for r in by_tier["none"]
    ]
    if by_tier["error"]:
        lines += ["", "## Errors (retry on next run)", ""]
        lines += [
            f"- **{r['id']}** {r['title']!r}: {r['decision']['error']}"
            for r in by_tier["error"]
        ]
    return "\n".join(lines) + "\n"


# --- Apply --------------------------------------------------------------------


def apply_links(
    client: DirectusClient, rows: list[dict[str, Any]], accept: set[int]
) -> list[int]:
    """Create Steam download links for high matches and accepted review ids."""
    added: list[int] = []
    for row in rows:
        dec = row["decision"]
        accepted = dec["tier"] == "review" and row["id"] in accept
        if dec["tier"] != "high" and not accepted:
            continue
        # Another session may have linked this game since the dry run: re-check.
        current = client.get(f"/items/games/{row['id']}", {"fields": "links.url"})[
            "data"
        ]
        if store_flags(current.get("links") or [])[2]:
            print(
                f"  skip {row['id']} {row['title']!r}: already has a Steam link",
                file=sys.stderr,
            )
            continue
        result = client.request_or_none(
            "POST",
            "/items/games_links",
            {"games_id": row["id"], "url": dec["url"], "kind": "download"},
        )
        if result is not None:
            print(f"  + {row['id']} {row['title']!r} -> {dec['url']}", file=sys.stderr)
            added.append(row["id"])
    return added


def parse_args() -> argparse.Namespace:
    """Parse command-line options."""
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", maxsplit=1)[0])
    parser.add_argument(
        "--apply", action="store_true", help="create the Directus links"
    )
    parser.add_argument(
        "--accept",
        default="",
        help="comma-separated game ids whose review-tier match should also be applied",
    )
    parser.add_argument("--missing-developers-only", action="store_true")
    parser.add_argument(
        "--game-id",
        type=int,
        action="append",
        help="restrict to this game id (repeatable)",
    )
    parser.add_argument("--limit", type=int, help="process at most N games")
    return parser.parse_args()


def main() -> None:
    """Find Steam equivalents for Epic/GOG-only games and optionally link them."""
    args = parse_args()
    accept = {int(x) for x in args.accept.split(",") if x.strip()}

    client = DirectusClient.from_config()
    targets = load_targets(client, args)
    print(f"{len(targets)} Epic/GOG-only games to check", file=sys.stderr)

    cache = ProgressCache(CACHE_PATH)
    steam = SteamLookup(cache)
    rows: list[dict[str, Any]] = []
    try:
        for index, game in enumerate(targets, 1):
            rows.append(
                {
                    "id": game["id"],
                    "title": game["title"],
                    "year": game.get("release_year"),
                    "stores": game["stores"],
                    "has_developer": bool(game.get("developers")),
                    "decision": find_match(
                        steam, game["title"], game.get("release_year")
                    ),
                }
            )
            if index % 25 == 0:
                print(f"  [{index}/{len(targets)}]", file=sys.stderr)
    finally:
        cache.flush()

    REPORT_JSON_PATH.write_text(json.dumps(rows, indent=2))
    REPORT_MD_PATH.write_text(render_report(rows))
    counts = {t: sum(1 for r in rows if r["decision"]["tier"] == t) for t in TIERS}
    print(f"Results: {counts}\nReport: {REPORT_MD_PATH}", file=sys.stderr)

    if not args.apply:
        print(
            "Dry run. Re-run with --apply to add the high-confidence links.",
            file=sys.stderr,
        )
        return
    added = apply_links(client, rows, accept)
    print(f"Added {len(added)} Steam links.", file=sys.stderr)
    if added:
        trigger_site_rebuild(client, added)


if __name__ == "__main__":
    main()
