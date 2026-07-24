#!/usr/bin/env python3
"""
Audit and merge duplicate/near-duplicate developer records.

Phase 1 (default): Find slug collisions and fuzzy name matches, write
  cache/developer_merge_proposals.json for review.

Phase 2 (--apply): Read proposals, re-point games_developers to canonical
  records, delete merged records.

Usage:
    python3 merge_developers.py           # generate proposals
    python3 merge_developers.py --apply   # apply approved proposals
"""

import argparse
import json
import re
import sys
import unicodedata

from scriptlib import CACHE_DIR, DirectusClient, take_pg_dump_backup

CACHE = CACHE_DIR
DIRECTUS = DirectusClient.from_config()

FUZZY_THRESHOLD = 0.82  # similarity ratio to flag as candidate duplicate


# ---------------------------------------------------------------------------
# Fuzzy matching
# ---------------------------------------------------------------------------


def normalize(name: str) -> str:
    """Lowercase, strip accents, collapse punctuation/spaces."""
    name = unicodedata.normalize("NFD", name)
    name = "".join(c for c in name if unicodedata.category(c) != "Mn")
    name = name.lower()
    name = re.sub(r"[^a-z0-9 ]", " ", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name


def similarity(a: str, b: str) -> float:
    """Trigram similarity between two strings."""

    def trigrams(s):
        s = f"  {s} "
        return {s[i : i + 3] for i in range(len(s) - 2)}

    ta, tb = trigrams(a), trigrams(b)
    if not ta and not tb:
        return 1.0
    if not ta or not tb:
        return 0.0
    return 2 * len(ta & tb) / (len(ta) + len(tb))


# ---------------------------------------------------------------------------
# Phase 1: generate proposals
# ---------------------------------------------------------------------------


def generate():
    """Generate developer-merge proposals for review."""
    proposals_path = CACHE / "developer_merge_proposals.json"

    print("Fetching all developers...", file=sys.stderr)
    devs = DIRECTUS.fetch_all("/items/developers?fields=id,name,slug&sort=name")
    print(f"  {len(devs)} developers", file=sys.stderr)

    print("Fetching games_developers associations...", file=sys.stderr)
    assocs = DIRECTUS.fetch_all("/items/games_developers?fields=developers_id")
    game_count: dict[int, int] = {}
    for a in assocs:
        did = a["developers_id"]
        game_count[did] = game_count.get(did, 0) + 1

    # --- Slug collision groups (guaranteed duplicates) ---
    slug_groups: dict[str, list] = {}
    for d in devs:
        slug_groups.setdefault(d["slug"], []).append(d)
    slug_collisions = {s: ds for s, ds in slug_groups.items() if len(ds) > 1}

    # --- Fuzzy match groups (candidates) ---
    norms = [(d, normalize(d["name"])) for d in devs]
    fuzzy_groups: list[list] = []
    visited = set()
    for i, (d1, n1) in enumerate(norms):
        if d1["id"] in visited:
            continue
        group = [d1]
        for d2, n2 in norms[i + 1 :]:
            if d2["id"] in visited:
                continue
            if n1 == n2:
                continue  # already caught by slug collision
            if similarity(n1, n2) >= FUZZY_THRESHOLD:
                group.append(d2)
        if len(group) > 1:
            for d in group:
                visited.add(d["id"])
            fuzzy_groups.append(group)

    # Build proposals
    proposals = []

    def make_proposal(group: list, reason: str) -> dict:
        # Canonical = most game associations; tie-break = shorter/cleaner name
        canonical = max(
            group, key=lambda d: (game_count.get(d["id"], 0), -len(d["name"]))
        )
        merges = [d for d in group if d["id"] != canonical["id"]]
        return {
            "reason": reason,
            "canonical": {
                "id": canonical["id"],
                "name": canonical["name"],
                "slug": canonical["slug"],
                "game_count": game_count.get(canonical["id"], 0),
            },
            "merge": [
                {
                    "id": d["id"],
                    "name": d["name"],
                    "slug": d["slug"],
                    "game_count": game_count.get(d["id"], 0),
                }
                for d in merges
            ],
        }

    for slug, group in sorted(slug_collisions.items()):
        proposals.append(make_proposal(group, f"slug_collision:{slug}"))

    for group in fuzzy_groups:
        # Skip if already covered by a slug collision group
        ids = {d["id"] for d in group}
        already = any(ids & {d["id"] for d in cg} for cg in slug_collisions.values())
        if not already:
            proposals.append(make_proposal(group, "fuzzy_match"))

    CACHE.mkdir(exist_ok=True)
    proposals_path.write_text(json.dumps(proposals, indent=2))

    slug_count = sum(1 for p in proposals if p["reason"].startswith("slug_collision"))
    fuzzy_count = len(proposals) - slug_count
    print(
        f"\n{len(proposals)} merge groups: {slug_count} slug collisions, {fuzzy_count} fuzzy matches",
        file=sys.stderr,
    )
    print(f"Proposals: {proposals_path}", file=sys.stderr)
    print("\nSlug collisions (safe to apply):", file=sys.stderr)
    for p in proposals:
        if p["reason"].startswith("slug_collision"):
            merges = ", ".join(f"{m['name']} ({m['game_count']}g)" for m in p["merge"])
            print(
                f'  KEEP "{p["canonical"]["name"]}" ({p["canonical"]["game_count"]}g) ← merge: {merges}',
                file=sys.stderr,
            )
    print("\nFuzzy matches (review before applying):", file=sys.stderr)
    for p in proposals:
        if p["reason"] == "fuzzy_match":
            all_names = [
                f"{p['canonical']['name']} ({p['canonical']['game_count']}g)"
            ] + [f"{m['name']} ({m['game_count']}g)" for m in p["merge"]]
            print(f"  {' | '.join(all_names)}", file=sys.stderr)


# ---------------------------------------------------------------------------
# Phase 2: apply
# ---------------------------------------------------------------------------


def apply():
    """Apply reviewed developer-merge proposals."""
    proposals_path = CACHE / "developer_merge_proposals.json"
    if not proposals_path.exists():
        print("No proposals file. Run without --apply first.", file=sys.stderr)
        sys.exit(1)

    proposals = json.loads(proposals_path.read_text())
    print(f"Applying {len(proposals)} merge groups...", file=sys.stderr)

    # Fetch current games_developers to avoid duplicate inserts
    print("Fetching existing associations...", file=sys.stderr)
    assocs = DIRECTUS.fetch_all(
        "/items/games_developers?fields=id,games_id,developers_id"
    )
    # Map (games_id, developers_id) → row id
    existing: dict[tuple, int] = {
        (a["games_id"], a["developers_id"]): a["id"] for a in assocs
    }

    take_pg_dump_backup("merge_developers")
    merged_devs = errors = 0

    for p in proposals:
        canonical_id = p["canonical"]["id"]
        for m in p["merge"]:
            merge_id = m["id"]
            print(
                f'  Merging "{m["name"]}" → "{p["canonical"]["name"]}"', file=sys.stderr
            )

            # Find all games_developers rows pointing to merge_id
            rows = [a for a in assocs if a["developers_id"] == merge_id]
            for row in rows:
                games_id = row["games_id"]
                if (games_id, canonical_id) in existing:
                    # Canonical link already exists — just delete the duplicate row
                    try:
                        DIRECTUS.delete(f"/items/games_developers/{row['id']}")
                        print(
                            f"    Removed duplicate assoc game {games_id}",
                            file=sys.stderr,
                        )
                    except Exception as e:  # noqa: BLE001 - Log and continue the batch.
                        print(
                            f"    ERROR removing assoc {row['id']}: {e}",
                            file=sys.stderr,
                        )
                        errors += 1
                else:
                    # Re-point to canonical
                    try:
                        DIRECTUS.patch(
                            f"/items/games_developers/{row['id']}",
                            {"developers_id": canonical_id},
                        )
                        existing[(games_id, canonical_id)] = row["id"]
                        existing.pop((games_id, merge_id), None)
                        print(f"    Re-pointed game {games_id}", file=sys.stderr)
                    except Exception as e:  # noqa: BLE001 - Log and continue the batch.
                        print(
                            f"    ERROR re-pointing game {games_id}: {e}",
                            file=sys.stderr,
                        )
                        errors += 1

            # Delete the merged developer record
            try:
                DIRECTUS.delete(f"/items/developers/{merge_id}")
                print(
                    f'    Deleted developer {merge_id} ("{m["name"]}")', file=sys.stderr
                )
                merged_devs += 1
            except Exception as e:  # noqa: BLE001 - Log and continue the batch.
                print(f"    ERROR deleting developer {merge_id}: {e}", file=sys.stderr)
                errors += 1

    print(f"\nDone: {merged_devs} developers merged, {errors} errors", file=sys.stderr)


# ---------------------------------------------------------------------------


def main():
    """Generate or apply developer-merge proposals."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if args.apply:
        apply()
    else:
        generate()


if __name__ == "__main__":
    main()
