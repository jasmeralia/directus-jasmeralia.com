#!/usr/bin/env python3
"""
Audit and normalize game titles with edition/remaster/HD suffixes.

Phase 1 (default): Fetch all games, apply suffix-stripping rules, write
  cache/title_normalization_proposals.json for review.

Phase 2 (--apply): Read proposals, PATCH each game's title in Directus.

Usage:
    python3 normalize_titles.py           # generate proposals
    python3 normalize_titles.py --apply   # apply approved proposals
"""

import argparse
import json
import re
import sys
from pathlib import Path

CACHE = Path(__file__).parent.parent / "cache"
DIRECTUS_URL = "https://directus.jasmer.tools"
DIRECTUS_TOKEN = json.load(open(Path(__file__).parent.parent.parent / ".mcp.json"))["mcpServers"]["directus"]["env"]["DIRECTUS_TOKEN"]

# Titles that match stripping rules but must not be touched
EXCLUSIONS = {
    "Legacy of Kain Soul Reaver 1&2 Remastered",
    "Final Fantasy X/X-2 HD Remaster",
    "Final Fantasy X/X-2 HD",
    "Final Fantasy X/X2 HD Remaster",  # alt spelling, same bundle
}

_RSTRIP_CHARS = " :-—–"  # includes en dash U+2013

# Specific known suffixes — more specific first (Director’s Cut Edition before Director’s Cut).
_SPECIFIC_SUFFIXES = [
    r"Director[\x27s]*\s+Cut\s+Edition",
    r"GOTY\s+Edition",
    r"Game\s+of\s+the\s+Year\s+Edition",
    r"Deluxe\s+Edition",
    r"Enhanced\s+Edition",
    r"Ultimate\s+Edition",
    r"Gold\s+Edition",
    r"Definitive\s+Edition",
    r"Complete\s+Edition",
    r"Special\s+Edition",
    r"Anniversary\s+Edition",
    r"Collector[\x27s]*\s+Edition",
    r"Director[\x27s]*\s+Cut",
    r"Remastered",
    r"Remaster",
    r"\bHD\b",
]

# Optional separator (colon, hyphen, em dash, en dash, or plain space) before specific suffix.
_SEP = r"(?:\s*[:\-—–]\s*|\s+)"
_SPECIFIC_RE = re.compile(
    r"(?:" + _SEP + r")?(?:" + "|".join(_SPECIFIC_SUFFIXES) + r")\s*$",
    re.IGNORECASE,
)

# Catch-all 1: hard separator + 1–3 words + Edition
# Handles: ": Full Clip Edition", "- Nightmare Edition", ": Spacer’s Choice Edition"
_SEP_EDITION_RE = re.compile(
    r"\s*[:\-—–]\s+(?:[\w\x27.-]+\s+){0,2}[\w\x27.-]+\s+Edition\s*$",
    re.IGNORECASE,
)

# Catch-all 2: space + single (optionally hyphenated) word + Edition, no hard separator
# Handles: " Deathinitive Edition", " Epic Edition", " Non-VR Edition"
_PLAIN_EDITION_RE = re.compile(
    r"\s+[\w-]+\s+Edition\s*$",
    re.IGNORECASE,
)


def strip_suffix(title: str) -> str | None:
    """Return cleaned title if a suffix was stripped, else None."""
    # Normalize curly quotes to ASCII apostrophe for matching; positions map 1:1
    normalized = title.replace("’", "'").replace("‘", "'")
    for pattern in (_SPECIFIC_RE, _SEP_EDITION_RE, _PLAIN_EDITION_RE):
        m = pattern.search(normalized)
        if m:
            cleaned = title[: m.start()].rstrip(_RSTRIP_CHARS)
            if cleaned and cleaned != title:
                return cleaned
    return None


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def directus_get(path: str) -> dict:
    import urllib.request
    req = urllib.request.Request(f"{DIRECTUS_URL}{path}", headers={
        "Authorization": f"Bearer {DIRECTUS_TOKEN}", "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def directus_patch(path: str, body: dict) -> dict:
    import urllib.request
    data = json.dumps(body).encode()
    req = urllib.request.Request(f"{DIRECTUS_URL}{path}", data=data, method="PATCH", headers={
        "Authorization": f"Bearer {DIRECTUS_TOKEN}",
        "Content-Type": "application/json", "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def fetch_all(path: str, page_size: int = 500) -> list:
    results, offset = [], 0
    while True:
        sep = "&" if "?" in path else "?"
        batch = directus_get(f"{path}{sep}limit={page_size}&offset={offset}").get("data", [])
        results.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return results


# ---------------------------------------------------------------------------
# Phase 1: generate proposals
# ---------------------------------------------------------------------------

def generate():
    proposals_path = CACHE / "title_normalization_proposals.json"

    print("Fetching all games...", file=sys.stderr)
    games = fetch_all("/items/games?fields=id,title,slug&sort=title")
    print(f"  {len(games)} games", file=sys.stderr)

    all_titles_lower = {g["title"].lower(): g["id"] for g in games}

    proposals = []
    excluded = []
    collisions = []

    for game in games:
        title = game["title"]

        if title in EXCLUSIONS:
            excluded.append(title)
            continue

        proposed = strip_suffix(title)
        if proposed is None:
            continue

        # Collision check: would the proposed title duplicate an existing entry?
        existing_id = all_titles_lower.get(proposed.lower())
        if existing_id and existing_id != game["id"]:
            collisions.append({
                "id": game["id"],
                "original_title": title,
                "proposed_title": proposed,
                "collision_with_id": existing_id,
            })
            continue

        # Determine which rule matched (best-effort label for review)
        m = _SPECIFIC_RE.search(title) or _SEP_EDITION_RE.search(title) or _PLAIN_EDITION_RE.search(title)
        reason = m.group(0).strip() if m else "unknown"

        proposals.append({
            "id": game["id"],
            "original_title": title,
            "proposed_title": proposed,
            "reason": reason,
        })

    CACHE.mkdir(exist_ok=True)
    proposals_path.write_text(json.dumps(proposals, indent=2))

    print(f"\n{len(proposals)} proposals written to {proposals_path}", file=sys.stderr)

    if excluded:
        print(f"\nExcluded (hardcoded):", file=sys.stderr)
        for t in excluded:
            print(f"  {t!r}", file=sys.stderr)

    if collisions:
        print(f"\nCollisions (duplicate would result — handle manually):", file=sys.stderr)
        for c in collisions:
            print(f"  [{c['id']}] {c['original_title']!r} → {c['proposed_title']!r}  (conflicts with id={c['collision_with_id']})", file=sys.stderr)

    print(f"\nProposals preview:", file=sys.stderr)
    for p in proposals:
        print(f"  [{p['id']}] {p['original_title']!r}  →  {p['proposed_title']!r}  ({p['reason']})", file=sys.stderr)


# ---------------------------------------------------------------------------
# Phase 2: apply
# ---------------------------------------------------------------------------

def apply():
    proposals_path = CACHE / "title_normalization_proposals.json"
    if not proposals_path.exists():
        print("No proposals file. Run without --apply first.", file=sys.stderr)
        sys.exit(1)

    proposals = json.loads(proposals_path.read_text())
    print(f"Applying {len(proposals)} title changes...", file=sys.stderr)

    updated = errors = 0
    for p in proposals:
        try:
            directus_patch(f"/items/games/{p['id']}", {"title": p["proposed_title"]})
            print(f"  [{p['id']}] {p['original_title']!r}  →  {p['proposed_title']!r}", file=sys.stderr)
            updated += 1
        except Exception as e:
            print(f"  ERROR [{p['id']}] {p['original_title']!r}: {e}", file=sys.stderr)
            errors += 1

    print(f"\nDone: {updated} updated, {errors} errors", file=sys.stderr)


# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if args.apply:
        apply()
    else:
        generate()


if __name__ == "__main__":
    main()
