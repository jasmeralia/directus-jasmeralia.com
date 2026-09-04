#!/usr/bin/env python3
"""
Set or clear the `nsfw` flag on games, genres, and tier lists.

Directus-only (no external API), so the AGENTS.md external-API backoff/cache
rule does not apply here, same as populate_tier_list.py. This is a small,
targeted admin tool, not a bulk-library backfill: it patches exactly the
slugs passed on the command line, dry-run by default.

Effective NSFW status for a game cascades: game.nsfw OR any linked
genre.nsfw OR (for tier board rendering only) the containing tier_list.nsfw.
See mcp/plans/sfw_nsfw_toggle.md for the full design.

Usage:
    # Dry run - show current vs proposed values
    python3 backfill_nsfw.py --genre avn --tier-list avns \\
        --game tamer-king-of-dinosaurs --game witch-potions-craft-of-lust

    # Apply
    python3 backfill_nsfw.py --genre avn --tier-list avns \\
        --game tamer-king-of-dinosaurs --game witch-potions-craft-of-lust --apply

    # Clear a flag
    python3 backfill_nsfw.py --game some-mistagged-game --unset --apply
"""

import argparse
import sys

from scriptlib import DirectusClient

COLLECTION_BY_KIND = {
    "game": "games",
    "genre": "genres",
    "tier-list": "tier_lists",
}


def find_by_slug(client: DirectusClient, collection: str, slug: str) -> dict | None:
    """Look up a single row by slug, returning its id/title/nsfw fields."""
    title_field = "name" if collection == "genres" else "title"
    res = client.get(
        f"/items/{collection}",
        params={
            "filter[slug][_eq]": slug,
            "fields": f"id,{title_field},nsfw",
            "limit": 1,
        },
    )
    rows = res.get("data", [])
    return rows[0] if rows else None


def label_of(collection: str, row: dict) -> str:
    """Return the display label field for a row, regardless of collection."""
    value = row.get("name") if collection == "genres" else row.get("title")
    return str(value or "")


def main():
    """Set or clear nsfw on the given games/genres/tier-lists by slug."""
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--game",
        action="append",
        default=[],
        metavar="SLUG",
        help="Game slug to flag (repeatable)",
    )
    parser.add_argument(
        "--genre",
        action="append",
        default=[],
        metavar="SLUG",
        help="Genre slug to flag (repeatable)",
    )
    parser.add_argument(
        "--tier-list",
        action="append",
        default=[],
        metavar="SLUG",
        help="Tier list slug to flag (repeatable)",
    )
    parser.add_argument(
        "--unset",
        action="store_true",
        help="Clear nsfw (default: set nsfw=true)",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply changes (default: dry run)",
    )
    args = parser.parse_args()

    targets = (
        [("game", slug) for slug in args.game]
        + [("genre", slug) for slug in args.genre]
        + [("tier-list", slug) for slug in args.tier_list]
    )
    if not targets:
        print(
            "Nothing to do - pass at least one --game/--genre/--tier-list.",
            file=sys.stderr,
        )
        sys.exit(1)

    new_value = not args.unset
    client = DirectusClient.from_config()

    resolved = []
    for kind, slug in targets:
        collection = COLLECTION_BY_KIND[kind]
        row = find_by_slug(client, collection, slug)
        if row is None:
            print(f"  NOT FOUND: {kind} '{slug}' in {collection}", file=sys.stderr)
            continue
        resolved.append((collection, row, label_of(collection, row)))

    if not resolved:
        print("No targets resolved. Nothing to do.", file=sys.stderr)
        sys.exit(1)

    print(f"Proposed nsfw={new_value} for {len(resolved)} row(s):", file=sys.stderr)
    for collection, row, label in resolved:
        current = row.get("nsfw")
        print(
            f"  [{collection}] {label!r} (id={row['id']}): {current} -> {new_value}",
            file=sys.stderr,
        )

    if not args.apply:
        print("\nDry run - pass --apply to write changes.", file=sys.stderr)
        return

    for collection, row, label in resolved:
        client.patch(f"/items/{collection}/{row['id']}", {"nsfw": new_value})
        print(
            f"  Applied [{collection}] {label!r} (id={row['id']}) -> nsfw={new_value}",
            file=sys.stderr,
        )

    print(f"\nUpdated {len(resolved)} row(s).", file=sys.stderr)


if __name__ == "__main__":
    main()
