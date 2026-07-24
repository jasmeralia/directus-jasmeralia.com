#!/usr/bin/env python3
"""
Phase 1: Parse ~/Downloads/playnite_export.csv, clean titles, deduplicate,
cross-reference with Directus and Steam, and write cache/psn_xbox_candidates.json.

CSV format (Playnite export):
  Line 1: #TYPE Selected.Playnite.SDK.Models.Game  (skip)
  Line 2+: Name, Source, ReleaseDate, Playtime, IsInstalled

Only rows where Source in {PlayStation, Xbox} are processed.
"""

import csv
import json
import re
import sys
import urllib.parse
import urllib.request
from difflib import SequenceMatcher
from pathlib import Path

from scriptlib import server_env

CSV_PATH = Path.home() / "Downloads" / "playnite_export.csv"
DIRECTUS_URL = server_env("directus")["DIRECTUS_URL"]
DIRECTUS_TOKEN = json.loads(
    (Path(__file__).parent.parent.parent / ".mcp.json").read_text(encoding="utf-8")
)["mcpServers"]["directus"]["env"]["DIRECTUS_TOKEN"]
CACHE = Path(__file__).parent.parent / "cache"

CONTENT_FILTERS = [
    lambda t: bool(re.search(r"\bOST\b|Soundtrack|\- Music", t, re.IGNORECASE)),
    lambda t: t.rstrip().endswith("Digital Deluxe Content"),
    lambda t: bool(re.search(r"\bDEMO\b| Demo$", t, re.IGNORECASE)),
    lambda t: bool(re.search(r" Prologue$|: Prologue", t, re.IGNORECASE)),
]


def is_filtered(title: str) -> bool:
    """Return whether a title matches an import exclusion rule."""
    return any(f(title) for f in CONTENT_FILTERS)


def fetch_directus_titles() -> list[dict]:
    """Fetch titles for every game currently in Directus."""
    url = f"{DIRECTUS_URL}/items/games?limit=-1&fields[]=id,title"
    req = urllib.request.Request(
        url, headers={"Authorization": f"Bearer {DIRECTUS_TOKEN}"}
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())["data"]


def fuzzy_ratio(a: str, b: str) -> float:
    """Calculate case-insensitive similarity between two titles."""
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def fuzzy_match(
    title: str, candidates: list[str], threshold: float = 0.90
) -> str | None:
    """Find the strongest candidate title above a threshold."""
    best_score = 0.0
    best = None
    for c in candidates:
        score = fuzzy_ratio(title, c)
        if score >= threshold and score > best_score:
            best_score = score
            best = c
    return best


def steam_fuzzy_match(
    title: str, steam_games: list[dict], threshold: float = 0.85
) -> int | None:
    """Find the app ID of the strongest Steam title match."""
    best_score = 0.0
    best_appid = None
    for g in steam_games:
        score = fuzzy_ratio(title, g["name"])
        if score >= threshold and score > best_score:
            best_score = score
            best_appid = g["appid"]
    return best_appid


def main():
    """Prepare console-library records for review and import."""
    if not CSV_PATH.exists():
        print(f"ERROR: {CSV_PATH} not found", file=sys.stderr)
        sys.exit(1)

    CACHE.mkdir(exist_ok=True)

    # --- Parse CSV ---
    print(f"Parsing {CSV_PATH}...")
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        next(f)  # skip #TYPE line
        reader = csv.DictReader(f)
        rows = list(reader)

    psn_rows = [r for r in rows if r["Source"] == "PlayStation"]
    xbox_rows = [r for r in rows if r["Source"] == "Xbox"]
    print(f"  PlayStation rows: {len(psn_rows)}")
    print(f"  Xbox rows: {len(xbox_rows)}")

    # --- Content filter ---
    def filter_rows(
        source_rows: list[dict], platform: str
    ) -> tuple[list[dict], list[dict]]:
        kept, dropped = [], []
        for r in source_rows:
            title = r["Name"].strip()
            if is_filtered(title):
                print(f"  FILTERED [{platform}]: {title!r}")
                dropped.append(r)
            else:
                kept.append(r)
        return kept, dropped

    print("\nApplying content filters...")
    psn_rows, _ = filter_rows(psn_rows, "PSN")
    xbox_rows, _ = filter_rows(xbox_rows, "Xbox")
    print(f"  After filter — PSN: {len(psn_rows)}, Xbox: {len(xbox_rows)}")

    # --- Deduplicate ---
    # Group by normalized title; PlayStation wins over Xbox; highest playtime within same platform.
    def dedup(psn: list[dict], xbox: list[dict]) -> list[dict]:
        by_title: dict[str, dict] = {}

        def upsert(row: dict, platform: str):
            key = row["Name"].strip().lower()
            playtime = int(row["Playtime"] or 0)
            entry = {
                "title": row["Name"].strip(),
                "platform": platform,
                "release_date": row.get("ReleaseDate", ""),
                "playtime": playtime,
            }
            if key not in by_title:
                by_title[key] = entry
            else:
                existing = by_title[key]
                # PSN beats Xbox
                if platform == "psn" and existing["platform"] == "xbox":
                    by_title[key] = entry
                elif platform == "xbox" and existing["platform"] == "psn":
                    pass  # keep PSN
                else:
                    # Same platform: keep highest playtime
                    if playtime > existing["playtime"]:
                        by_title[key] = entry

        for r in psn:
            upsert(r, "psn")
        for r in xbox:
            upsert(r, "xbox")

        return list(by_title.values())

    print("\nDeduplicating...")
    all_games = dedup(psn_rows, xbox_rows)
    print(f"  After dedup: {len(all_games)} unique titles")

    # --- Cross-reference with Directus ---
    print("\nFetching Directus titles...")
    directus_records = fetch_directus_titles()
    directus_titles = [r["title"] for r in directus_records]
    print(f"  {len(directus_titles)} games in Directus")

    with open(CACHE / "directus_titles_current.json", "w", encoding="utf-8") as f:
        json.dump(directus_records, f, indent=2)

    possible_duplicates = []
    candidates = []
    skipped = 0

    for g in all_games:
        exact = next(
            (t for t in directus_titles if t.lower() == g["title"].lower()), None
        )
        if exact:
            g["status"] = "skip_already_in_directus"
            skipped += 1
            continue

        fuzzy = fuzzy_match(g["title"], directus_titles, threshold=0.90)
        if fuzzy:
            g["status"] = "possible_duplicate"
            g["directus_fuzzy_match"] = fuzzy
            possible_duplicates.append(g)
            continue

        g["status"] = "candidate"
        candidates.append(g)

    print(f"  Skipped (exact match in Directus): {skipped}")
    print(f"  Possible duplicates (fuzzy ≥90%): {len(possible_duplicates)}")
    print(f"  Candidates to import: {len(candidates)}")

    # --- Cross-reference with Steam library ---
    print("\nCross-referencing with Steam library...")
    with open(CACHE / "steam_library.json", encoding="utf-8") as f:
        steam_games = json.load(f)

    steam_matched = 0
    for g in candidates:
        appid = steam_fuzzy_match(g["title"], steam_games)
        g["steam_appid"] = appid
        if appid:
            steam_matched += 1
    print(f"  Steam matches: {steam_matched}")

    # --- Build download URLs ---
    for g in candidates:
        if g.get("steam_appid"):
            g["download_url"] = (
                f"https://store.steampowered.com/app/{g['steam_appid']}/"
            )
        elif g["platform"] == "psn":
            g["download_url"] = (
                f"https://store.playstation.com/en-us/search/{urllib.parse.quote(g['title'])}"
            )
        else:
            g["download_url"] = (
                f"https://www.xbox.com/en-US/search?q={urllib.parse.quote(g['title'])}"
            )

    # --- Write output ---
    output = []
    for g in candidates:
        output.append(
            {
                "title": g["title"],
                "platform": g["platform"],
                "release_date": g["release_date"],
                "playtime": g["playtime"],
                "status": g["status"],
                "steam_appid": g.get("steam_appid"),
                "download_url": g["download_url"],
            }
        )

    with open(CACHE / "psn_xbox_candidates.json", "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2)
    print(f"\nWrote {len(output)} candidates → cache/psn_xbox_candidates.json")

    with open(CACHE / "psn_xbox_possible_duplicates.json", "w", encoding="utf-8") as f:
        json.dump(possible_duplicates, f, indent=2)
    print(
        f"Wrote {len(possible_duplicates)} possible duplicates → cache/psn_xbox_possible_duplicates.json"
    )


if __name__ == "__main__":
    main()
