#!/usr/bin/env python3
"""Populate nonlinear (quest/mission) per-game section rows in Directus.

Usage:
    populate_game_quests.py <game slug> --from-txt <path|-> [<section noun, defaults to Quest>]
    populate_game_quests.py --list-targets --status in_progress
    populate_game_quests.py --from-json <path|->

See mcp/plans/game_sections_nonlinear.md for the full design. Unlike
populate_game_sections.py, there is no positional count/number-upsert mode:
a quest list has no stable per-row identity to merge against, so any
pre-existing game_sections rows for the target game require --replace.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from game_sections_lib import (
    add_target_resolver_arguments,
    has_target_resolver_flags,
    parse_quest_journal_txt,
    print_list_targets,
    resolve_game,
    upsert_quest_sections,
)
from scriptlib import DirectusClient, take_pg_dump_backup, trigger_site_rebuild

DEFAULT_QUEST_NOUN = "Quest"


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("game_slug", nargs="?", help="Game slug")
    parser.add_argument(
        "noun",
        nargs="?",
        default=DEFAULT_QUEST_NOUN,
        help=f"Section noun (default: {DEFAULT_QUEST_NOUN})",
    )
    parser.add_argument(
        "--from-txt",
        metavar="PATH",
        help="Read a quest-journal text export from PATH, or - for stdin",
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Delete existing rows before creating quest sections",
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
    add_target_resolver_arguments(parser)
    parser.add_argument(
        "--from-json",
        metavar="PATH",
        help="Read a quest payload from a JSON file, or - for stdin",
    )
    return parser


def _read_text(parser: argparse.ArgumentParser, source: str) -> str:
    try:
        return (
            sys.stdin.read()
            if source == "-"
            else Path(source).read_text(encoding="utf-8")
        )
    except OSError as error:
        parser.error(f"Unable to read --from-txt input: {error}")
    return ""  # unreachable; parser.error raises SystemExit


def _print_summary(result: dict[str, int], *, dry_run: bool) -> None:
    prefix = "[DRY RUN] Would write" if dry_run else "Wrote"
    print(
        f"{prefix} game id={result['game_id']}: "
        f"{result['created']} created, {result['deleted']} deleted, "
        f"{result['category_count']} categories",
        file=sys.stderr,
    )


def _load_json_payload(
    parser: argparse.ArgumentParser, source: str
) -> list[dict[str, Any]]:
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
    payload = _load_json_payload(parser, args.from_json)
    if args.replace and not args.dry_run:
        backup = take_pg_dump_backup("game_sections_replace")
        print(f"Deletion backup: {backup}", file=sys.stderr)
    affected_game_ids: list[int] = []
    for entry in payload:
        slug = entry.get("slug")
        noun = entry.get("noun")
        entries = entry.get("entries")
        if not isinstance(slug, str) or not slug:
            parser.error("Every --from-json entry requires a non-empty slug")
        if noun is not None and not isinstance(noun, str):
            parser.error(f"Entry '{slug}' noun must be a string or null")
        if not isinstance(entries, list) or not all(
            isinstance(e, dict) for e in entries
        ):
            parser.error(f"Entry '{slug}' entries must be an array of objects")

        game = resolve_game(client, slug)
        result = upsert_quest_sections(
            client,
            game["id"],
            noun=noun or DEFAULT_QUEST_NOUN,
            entries=entries,
            replace=args.replace,
            dry_run=args.dry_run,
        )
        _print_summary(result, dry_run=args.dry_run)
        affected_game_ids.append(game["id"])
    if affected_game_ids and not args.dry_run:
        trigger_site_rebuild(client, affected_game_ids)


def main() -> None:
    """Parse a population mode and perform only the requested Directus work."""
    parser = _parser()
    args = parser.parse_args()
    client = DirectusClient.from_config()

    if args.list_targets:
        if args.from_json or args.from_txt or args.game_slug is not None:
            parser.error(
                "--list-targets cannot be combined with positional or "
                "--from-txt/--from-json input"
            )
        print_list_targets(parser, client, args)
        return

    if args.from_json:
        if args.game_slug is not None or args.from_txt:
            parser.error(
                "--from-json cannot be combined with positional/--from-txt input"
            )
        if has_target_resolver_flags(args):
            parser.error("--from-json cannot be combined with target resolver flags")
        _run_from_json(parser, client, args)
        return

    if has_target_resolver_flags(args):
        parser.error("Target resolver flags require --list-targets")
    if args.game_slug is None or not args.from_txt:
        parser.error("game_slug and --from-txt are required in positional mode")

    game = resolve_game(client, args.game_slug)
    text = _read_text(parser, args.from_txt)
    try:
        entries = parse_quest_journal_txt(text)
    except ValueError as error:
        parser.error(str(error))
        return  # unreachable; parser.error raises SystemExit

    print(
        f"  Parsed {len(entries)} quests across "
        f"{len({e['category'] for e in entries})} categories",
        file=sys.stderr,
    )

    if args.replace and not args.dry_run:
        backup = take_pg_dump_backup("game_sections_replace")
        print(f"Deletion backup: {backup}", file=sys.stderr)

    try:
        result = upsert_quest_sections(
            client,
            game["id"],
            noun=args.noun,
            entries=entries,
            replace=args.replace,
            dry_run=args.dry_run,
        )
    except ValueError as error:
        parser.error(str(error))
        return  # unreachable; parser.error raises SystemExit

    _print_summary(result, dry_run=args.dry_run)
    if not args.dry_run:
        trigger_site_rebuild(client, [game["id"]])


if __name__ == "__main__":
    main()
