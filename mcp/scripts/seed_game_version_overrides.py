#!/usr/bin/env python3
"""Move the existing code-defined version equivalences into current GSL rows."""

from __future__ import annotations

from scriptlib import DirectusClient

OVERRIDES = {
    "perfect-son-in-law-hidden-s-rank": (
        "Act 3 & 4 Beta",
        "0.2.0",
        "GSL's Act 3 & 4 Beta label corresponds to installed version 0.2.0.",
    ),
    "irys": (
        "Ch. 1 P2",
        "1.0.2",
        "GSL's Ch. 1 P2 label corresponds to installed version 1.0.2.",
    ),
    "fleeting-memories": (
        "Update 4 Final",
        "0.4.6",
        "GSL's Update 4 Final label corresponds to installed version 0.4.6.",
    ),
    "cross-realms": (
        "Ch. IV",
        "0.4.1",
        "GSL's Ch. IV label corresponds to installed version 0.4.1.",
    ),
    "beyond-time": (
        "Ep. 6",
        "0.6",
        "The installed 0.6 release is the same release GSL labels Ep. 6.",
    ),
    "house-of-hearts": (
        "Ep. 2 Pt. 1 Beta",
        "Ep. 2 Pt. 1 Public v1",
        "The installed public v1 release supersedes the beta label still shown on GSL.",
    ),
    "a-house-in-the-rift": (
        "0.8.14 Alpha",
        "0.8.14r1",
        "The installed r1 release supersedes the alpha label still shown on GSL.",
    ),
    "out-of-touch": (
        "Amber & Gold Part 3 (Ch6269)",
        "Ch6269",
        "GSL labels the same Out of Touch release as Ch6269.",
    ),
}


def main() -> None:
    """Attach existing equivalence decisions to matching current GSL updates."""
    client = DirectusClient.from_config()
    for slug, (raw, comparison, reason) in OVERRIDES.items():
        game = client.request(
            "GET", f"/items/games?filter[slug][_eq]={slug}&fields=id&limit=1"
        ).get("data", [])
        if not game:
            print(f"SKIP {slug}: game not found")
            continue
        rows = client.request(
            "GET",
            "/items/game_versions",
            params={
                "filter[games_id][_eq]": game[0]["id"],
                "filter[source][_eq]": "gsl",
                "filter[is_current][_eq]": "true",
                "fields": "id,reported_version,comparison_override",
                "limit": -1,
            },
        ).get("data", [])
        matches = [
            row
            for row in rows
            if str(row.get("reported_version") or "").casefold() == raw.casefold()
        ]
        if not matches:
            print(f"SKIP {slug}: current raw label does not match {raw!r}")
            continue
        for row in matches:
            if row.get("comparison_override") == comparison:
                print(f"OK {slug}: override already set")
                continue
            client.request(
                "PATCH",
                f"/items/game_versions/{row['id']}",
                {"comparison_override": comparison, "override_reason": reason},
            )
            print(f"SET {slug}: {raw!r} compares as {comparison!r}")


if __name__ == "__main__":
    main()
