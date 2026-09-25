#!/usr/bin/env python3
"""Create the Directus schema for source-specific game version history.

Run after reviewing mcp/plans/game_version_tracking.md and taking a full
Directus database backup. Writes schema only; data is populated separately.
"""

from __future__ import annotations

import argparse
import sys

from scriptlib import DirectusClient, take_pg_dump_backup

COLLECTION = "game_versions"
SITE_POLICY = "84f316ac-2d5e-4b5a-8f56-99e27a8f1cdf"

FIELDS = [
    (
        "games_id",
        "integer",
        {"is_nullable": False},
        {
            "interface": "select-dropdown-m2o",
            "special": ["m2o"],
            "options": {"template": "{{title}}", "enableCreate": False},
        },
    ),
    (
        "source",
        "string",
        {"is_nullable": False, "max_length": 16},
        {
            "interface": "select-dropdown",
            "options": {
                "choices": [
                    {"text": "GameStoryLog", "value": "gsl"},
                    {"text": "Typhoon", "value": "typhoon"},
                    {"text": "Orion", "value": "orion"},
                ]
            },
        },
    ),
    (
        "source_key",
        "string",
        {"is_nullable": False, "is_unique": True, "max_length": 255},
        {"interface": "input", "readonly": True},
    ),
    (
        "reported_version",
        "string",
        {"is_nullable": True, "max_length": 512},
        {"interface": "input", "display": "raw"},
    ),
    (
        "source_reference",
        "string",
        {"is_nullable": True, "max_length": 512},
        {"interface": "input", "display": "raw"},
    ),
    (
        "installation_key",
        "string",
        {"is_nullable": True, "max_length": 512},
        {"interface": "input", "readonly": True},
    ),
    (
        "release_date",
        "date",
        {"is_nullable": True},
        {
            "interface": "datetime",
            "display": "datetime",
            "display_options": {"relative": False},
        },
    ),
    (
        "recorded_at",
        "timestamp",
        {"is_nullable": False},
        {
            "interface": "datetime",
            "display": "datetime",
            "display_options": {"relative": True},
        },
    ),
    (
        "is_current",
        "boolean",
        {"is_nullable": False, "default_value": True},
        {"interface": "boolean"},
    ),
    (
        "parse_error",
        "string",
        {"is_nullable": True, "max_length": 512},
        {"interface": "input"},
    ),
    (
        "comparison_override",
        "string",
        {"is_nullable": True, "max_length": 512},
        {
            "interface": "input",
            "note": "Comparison only. The raw source label remains reported_version.",
        },
    ),
    (
        "override_reason",
        "text",
        {"is_nullable": True},
        {"interface": "input-multiline"},
    ),
]


def exists(client: DirectusClient, path: str) -> bool:
    try:
        client.request("GET", path)
        return True
    except Exception as error:  # Directus returns 403/404 when absent or hidden.
        if getattr(error, "code", None) in (403, 404):
            return False
        raise


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--skip-backup",
        action="store_true",
        help="Use only after a fresh full backup has already been taken",
    )
    args = parser.parse_args()
    client = DirectusClient.from_config()
    if not args.skip_backup:
        take_pg_dump_backup("before_game_versions_schema")

    if not exists(client, f"/collections/{COLLECTION}"):
        client.request(
            "POST",
            "/collections",
            {
                "collection": COLLECTION,
                "meta": {
                    "icon": "history",
                    "hidden": False,
                    "display_template": "{{source}} · {{reported_version}}",
                },
                "schema": {},
            },
        )
        print(f"Created {COLLECTION}")
    for field, field_type, schema, meta in FIELDS:
        if exists(client, f"/fields/{COLLECTION}/{field}"):
            continue
        client.request(
            "POST",
            f"/fields/{COLLECTION}",
            {"field": field, "type": field_type, "schema": schema, "meta": meta},
        )
        print(f"Created {COLLECTION}.{field}")

    try:
        client.request(
            "POST",
            "/relations",
            {
                "collection": COLLECTION,
                "field": "games_id",
                "related_collection": "games",
                "schema": {"on_delete": "CASCADE"},
                "meta": {
                    "many_collection": COLLECTION,
                    "many_field": "games_id",
                    "one_collection": "games",
                    "one_field": "versions",
                    "junction_field": None,
                    "sort_field": None,
                    "one_deselect_action": "delete",
                },
            },
        )
        print("Created relation game_versions.games_id → games.versions")
    except Exception as error:
        if not exists(client, "/relations/game_versions/games_id"):
            raise
        print(f"Relation already exists: {error}", file=sys.stderr)

    perms = client.request(
        "GET",
        f"/permissions?filter[policy][_eq]={SITE_POLICY}&filter[collection][_eq]={COLLECTION}&filter[action][_eq]=read&fields=id,fields",
    )
    if not perms.get("data"):
        client.request(
            "POST",
            "/permissions",
            {
                "policy": SITE_POLICY,
                "collection": COLLECTION,
                "action": "read",
                "fields": ["*"],
            },
        )
        print("Granted Astro Readonly read access")
    elif perms["data"][0].get("fields") != ["*"]:
        client.request(
            "PATCH", f"/permissions/{perms['data'][0]['id']}", {"fields": ["*"]}
        )
        print("Expanded Astro Readonly read fields")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
