#!/usr/bin/env python3
"""Populate deterministic per-game section rows in Directus.

Usage:
    populate_game_sections.py <game slug> <number of sections> [section noun]
    populate_game_sections.py --list-targets --status in_progress
    populate_game_sections.py --from-json <path|->
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from game_sections_lib import (
    resolve_bundle_member,
    resolve_game,
    resolve_targets,
    upsert_game_sections,
)
from scriptlib import DirectusClient, take_pg_dump_backup, trigger_site_rebuild


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("game_slug", nargs="?", help="Game slug")
    parser.add_argument("count", nargs="?", type=int, help="Number of sections")
    parser.add_argument(
        "noun",
        nargs="?",
        default="Chapter",
        help="Section noun (default: Chapter)",
    )
    parser.add_argument(
        "--current",
        type=int,
        help="Set games.current_section",
    )
    parser.add_argument(
        "--member",
        help="Scope sections to an included-game slug under the parent game",
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Delete existing rows before creating sections",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print planned writes without changing Directus",
    )
    parser.add_argument(
        "--list-targets",
        action="store_true",
        help="Print matching game targets as JSON",
    )
    parser.add_argument(
        "--filter",
        dest="raw_filter",
        help="Raw Directus filter object as JSON",
    )
    parser.add_argument(
        "--slug",
        dest="target_slug",
        help="Filter target games by slug",
    )
    parser.add_argument(
        "--status",
        help="Filter target games by player_status",
    )
    parser.add_argument(
        "--genre",
        help="Filter target games by genre slug",
    )
    parser.add_argument(
        "--tier-list",
        help="Filter target games by tier list slug",
    )
    parser.add_argument(
        "--from-json",
        metavar="PATH",
        help="Read section payload from a JSON file, or - for stdin",
    )
    return parser


def _parse_filter(
    parser: argparse.ArgumentParser, raw: str | None
) -> dict[str, Any] | None:
    if raw is None:
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as error:
        parser.error(f"--filter is not valid JSON: {error}")
    if not isinstance(parsed, dict):
        parser.error("--filter must decode to a JSON object")
    return parsed


def _print_summary(result: dict[str, int | None], *, dry_run: bool) -> None:
    prefix = "[DRY RUN] Would write" if dry_run else "Wrote"
    member_id = result["bundle_member_id"]
    member_text = f" member id={member_id}" if member_id else ""
    print(
        f"{prefix} game id={result['game_id']}{member_text}: "
        f"{result['created']} created, {result['updated']} updated, "
        f"{result['deleted']} deleted",
        file=sys.stderr,
    )


def _load_payload(parser: argparse.ArgumentParser, source: str) -> list[dict[str, Any]]:
    try:
        raw = (
            sys.stdin.read()
            if source == "-"
            else Path(source).read_text(encoding="utf-8")
        )
        payload = json.loads(raw)
    except (OSError, json.JSONDecodeError) as error:
        parser.error(f"Unable to read --from-json payload: {error}")
    if not isinstance(payload, list) or not all(
        isinstance(entry, dict) for entry in payload
    ):
        parser.error("--from-json payload must be a JSON array of objects")
    return payload


def _run_from_json(
    parser: argparse.ArgumentParser,
    client: DirectusClient,
    args: argparse.Namespace,
) -> None:
    payload = _load_payload(parser, args.from_json)
    if args.replace and not args.dry_run:
        backup = take_pg_dump_backup("game_sections_replace")
        print(f"Deletion backup: {backup}", file=sys.stderr)
    affected_game_ids: list[int] = []
    for entry in payload:
        slug = entry.get("slug")
        noun = entry.get("noun")
        sections = entry.get("sections")
        current = entry.get("current")
        member_slug = entry.get("member")
        if not isinstance(slug, str) or not slug:
            parser.error("Every --from-json entry requires a non-empty slug")
        if noun is not None and not isinstance(noun, str):
            parser.error(f"Entry '{slug}' noun must be a string or null")
        if not isinstance(sections, list) or not all(
            isinstance(section, dict) for section in sections
        ):
            parser.error(f"Entry '{slug}' sections must be an array of objects")
        if current is not None and (
            not isinstance(current, int) or isinstance(current, bool)
        ):
            parser.error(f"Entry '{slug}' current must be an integer or null")
        if member_slug is not None and (
            not isinstance(member_slug, str) or not member_slug
        ):
            parser.error(f"Entry '{slug}' member must be a non-empty string or null")

        game = resolve_game(client, slug)
        member = (
            resolve_bundle_member(client, game["id"], member_slug)
            if member_slug
            else None
        )
        result = upsert_game_sections(
            client,
            game["id"],
            noun=noun or "Chapter",
            sections=sections,
            current=current,
            bundle_member_id=member["id"] if member else None,
            replace=args.replace,
            dry_run=args.dry_run,
        )
        _print_summary(result, dry_run=args.dry_run)
        affected_game_ids.append(game["id"])
    if affected_game_ids and not args.dry_run:
        trigger_site_rebuild(client, affected_game_ids)


def _run_list_targets(
    parser: argparse.ArgumentParser,
    client: DirectusClient,
    args: argparse.Namespace,
) -> None:
    if not any(
        (args.raw_filter, args.target_slug, args.status, args.genre, args.tier_list)
    ):
        parser.error(
            "--list-targets requires --filter, --slug, --status, --genre, "
            "or --tier-list"
        )
    targets = resolve_targets(
        client,
        filter_obj=_parse_filter(parser, args.raw_filter),
        slug=args.target_slug,
        status=args.status,
        genre=args.genre,
        tier_list=args.tier_list,
    )
    print(json.dumps(targets, indent=2))


def main() -> None:
    """Parse a population mode and perform only the requested Directus work."""
    parser = _parser()
    args = parser.parse_args()
    client = DirectusClient.from_config()

    if args.list_targets:
        if (
            args.from_json
            or args.game_slug is not None
            or args.count is not None
            or args.member
        ):
            parser.error(
                "--list-targets cannot be combined with positional or --from-json input"
            )
        _run_list_targets(parser, client, args)
        return

    if args.from_json:
        if args.game_slug is not None or args.count is not None or args.member:
            parser.error("--from-json cannot be combined with positional input")
        if any(
            (args.raw_filter, args.target_slug, args.status, args.genre, args.tier_list)
        ):
            parser.error("--from-json cannot be combined with target resolver flags")
        _run_from_json(parser, client, args)
        return

    if any(
        (args.raw_filter, args.target_slug, args.status, args.genre, args.tier_list)
    ):
        parser.error("Target resolver flags require --list-targets")
    if args.game_slug is None or args.count is None:
        parser.error("game_slug and count are required in positional mode")
    if args.count < 1:
        parser.error("count must be a positive integer")

    game = resolve_game(client, args.game_slug)
    member = (
        resolve_bundle_member(client, game["id"], args.member) if args.member else None
    )
    sections = [
        {"number": number, "title": None} for number in range(1, args.count + 1)
    ]
    if args.replace and not args.dry_run:
        backup = take_pg_dump_backup("game_sections_replace")
        print(f"Deletion backup: {backup}", file=sys.stderr)
    result = upsert_game_sections(
        client,
        game["id"],
        noun=args.noun,
        sections=sections,
        current=args.current,
        bundle_member_id=member["id"] if member else None,
        replace=args.replace,
        dry_run=args.dry_run,
    )
    _print_summary(result, dry_run=args.dry_run)
    if not args.dry_run:
        trigger_site_rebuild(client, [game["id"]])


if __name__ == "__main__":
    main()
