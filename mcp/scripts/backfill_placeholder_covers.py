#!/usr/bin/env python3
"""Backfill games.cover_is_placeholder for known generated cover images.

Usage:
    python3 backfill_placeholder_covers.py [--apply]
"""

import argparse
import hashlib
import urllib.request
from typing import Any

from placeholder_covers import (
    KNOWN_PLACEHOLDER_FILENAMES,
    compute_known_placeholder_hashes,
)
from scriptlib import (
    DirectusClient,
    RetryingDirectusClient,
    directus_operation_with_retry,
)


def download_asset(client: DirectusClient, asset_id: str) -> bytes:
    """Download one Directus asset with shared pacing and retry/backoff."""

    def fetch() -> bytes:
        request = urllib.request.Request(
            f"{client.base_url}/assets/{asset_id}",
            headers={"Authorization": f"Bearer {client.token}"},
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.read()

    return directus_operation_with_retry(
        fetch,
        description=f"download Directus asset {asset_id}",
    )


def cover_asset_id(cover_image: Any) -> str | None:
    """Return an asset UUID from either Directus file relation shape."""
    if isinstance(cover_image, str):
        return cover_image
    if isinstance(cover_image, dict) and cover_image.get("id"):
        return str(cover_image["id"])
    return None


def main() -> None:
    """Find exact known cover matches and optionally flag their games."""
    parser = argparse.ArgumentParser(
        description="Flag known generated placeholder covers in Directus.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply PATCH writes (default: dry run)",
    )
    args = parser.parse_args()

    known_hashes = compute_known_placeholder_hashes()
    candidate_filenames = {
        filename.removesuffix(".png"): filename
        for filename in KNOWN_PLACEHOLDER_FILENAMES
        if filename in known_hashes
    }
    base_client = DirectusClient.from_config()
    client = RetryingDirectusClient(base_client)
    response = client.get(
        "/items/games",
        params={
            "filter[slug][_in]": ",".join(candidate_filenames),
            "fields": "id,slug,title,cover_image,cover_is_placeholder",
            "limit": -1,
        },
        description="fetch known placeholder-cover candidate games",
    )
    games = response.get("data", [])
    games_by_slug = {game["slug"]: game for game in games}

    matched_by_hash = 0
    already_flagged = 0
    changed = 0

    print("Mode: APPLY" if args.apply else "Mode: DRY RUN")
    for slug, filename in candidate_filenames.items():
        game = games_by_slug.get(slug)
        if game is None:
            print(f"NOT FOUND: slug={slug}")
            continue

        asset_id = cover_asset_id(game.get("cover_image"))
        if asset_id is None:
            print(f"NO COVER: id={game['id']} slug={slug}")
            continue

        asset_bytes = download_asset(base_client, asset_id)
        asset_hash = hashlib.sha256(asset_bytes).hexdigest()
        if asset_hash != known_hashes[filename]:
            print(f"HASH MISMATCH: id={game['id']} slug={slug}")
            continue

        matched_by_hash += 1
        if game.get("cover_is_placeholder") is True:
            already_flagged += 1
            print(f"ALREADY FLAGGED: id={game['id']} slug={slug}")
            continue

        print(
            f"{'PATCH' if args.apply else 'PLAN PATCH'}: "
            f"id={game['id']} slug={slug} cover_is_placeholder=true"
        )
        if args.apply:
            client.patch(
                f"/items/games/{game['id']}",
                {"cover_is_placeholder": True},
                description=f"flag placeholder cover for game {game['id']} ({slug})",
            )
        changed += 1

    change_label = "newly_patched" if args.apply else "would_patch"
    print(
        "Summary: "
        f"matched_by_hash={matched_by_hash} "
        f"already_flagged={already_flagged} "
        f"{change_label}={changed}"
    )


if __name__ == "__main__":
    main()
