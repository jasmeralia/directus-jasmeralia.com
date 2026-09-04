"""Shared Directus resolve and write logic for per-game sections."""

from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
from typing import Any

from scriptlib import DirectusClient

DEFAULT_NOUN = "Chapter"


def default_title(noun: str, number: int) -> str:
    """Return the default title for a numbered game section."""
    return f"{noun} {number}"


def normalize_noun(noun: str | None) -> str:
    """Strip a section noun, default it to Chapter, and require ASCII text."""
    normalized = noun.strip() if noun else DEFAULT_NOUN
    if not normalized:
        normalized = DEFAULT_NOUN
    if not normalized.isascii():
        raise ValueError("Section noun must contain ASCII characters only")
    return normalized


def _query_path(
    collection: str,
    *,
    fields: str,
    filter_obj: dict[str, Any] | None = None,
    limit: int | None = None,
) -> str:
    params: list[tuple[str, str]] = [("fields", fields)]
    if filter_obj:
        params.extend(_flatten_filter(filter_obj))
    if limit is not None:
        params.append(("limit", str(limit)))
    return f"/items/{collection}?{urllib.parse.urlencode(params)}"


def _flatten_filter(
    value: Any,
    prefix: str = "filter",
) -> list[tuple[str, str]]:
    if isinstance(value, dict):
        flattened: list[tuple[str, str]] = []
        for key, child in value.items():
            flattened.extend(_flatten_filter(child, f"{prefix}[{key}]"))
        return flattened
    if isinstance(value, list):
        if all(not isinstance(child, (dict, list)) for child in value):
            return [(prefix, ",".join(str(child) for child in value))]
        flattened = []
        for index, child in enumerate(value):
            flattened.extend(_flatten_filter(child, f"{prefix}[{index}]"))
        return flattened
    if value is None:
        return [(prefix, "null")]
    if isinstance(value, bool):
        return [(prefix, str(value).lower())]
    return [(prefix, str(value))]


def resolve_game(client: DirectusClient, slug: str) -> dict[str, Any]:
    """Resolve a game slug to its id and title, exiting clearly if absent."""
    print(f"Looking up game '{slug}'...", file=sys.stderr)
    response = client.get(
        _query_path(
            "games",
            fields="id,slug,title",
            filter_obj={"slug": {"_eq": slug}},
            limit=1,
        )
    )
    games = response.get("data", [])
    if not games:
        print(f"ERROR: game slug '{slug}' not found", file=sys.stderr)
        raise SystemExit(1)
    game = games[0]
    print(f"  Game: {game['title']} (id={game['id']})", file=sys.stderr)
    return game


def resolve_bundle_member(
    client: DirectusClient,
    game_id: int,
    member_slug: str,
) -> dict[str, Any]:
    """Resolve one bundle member belonging to a parent game."""
    response = client.get(
        _query_path(
            "game_bundle_members",
            fields="id,games_id,slug,title",
            filter_obj={
                "games_id": {"_eq": game_id},
                "slug": {"_eq": member_slug},
            },
            limit=1,
        )
    )
    members = response.get("data", [])
    if not members:
        print(
            f"ERROR: bundle member slug '{member_slug}' not found for game id={game_id}",
            file=sys.stderr,
        )
        raise SystemExit(1)
    member = members[0]
    print(
        f"  Included game: {member['title']} (id={member['id']})",
        file=sys.stderr,
    )
    return member


def _tier_list_game_ids(client: DirectusClient, tier_list_slug: str) -> list[int]:
    response = client.get(
        _query_path(
            "tier_lists",
            fields="id,slug,title",
            filter_obj={"slug": {"_eq": tier_list_slug}},
            limit=1,
        )
    )
    tier_lists = response.get("data", [])
    if not tier_lists:
        print(f"ERROR: tier list slug '{tier_list_slug}' not found", file=sys.stderr)
        raise SystemExit(1)

    rows = client.fetch_all(
        _query_path(
            "tier_list_games",
            fields="game_id",
            filter_obj={"tier_list_id": {"_eq": tier_lists[0]["id"]}},
        )
    )
    return sorted(
        {game_id for row in rows if isinstance((game_id := row.get("game_id")), int)}
    )


def resolve_targets(
    client: DirectusClient,
    *,
    filter_obj: dict[str, Any] | None = None,
    slug: str | None = None,
    status: str | None = None,
    genre: str | None = None,
    tier_list: str | None = None,
) -> list[dict[str, Any]]:
    """Resolve a flexible Directus game filter to skill-ready target records."""
    conditions: list[dict[str, Any]] = []
    if filter_obj:
        conditions.append(filter_obj)
    if slug:
        conditions.append({"slug": {"_eq": slug}})
    if status:
        conditions.append({"player_status": {"_eq": status}})
    if genre:
        conditions.append({"genres": {"genres_id": {"slug": {"_eq": genre}}}})
    if tier_list:
        game_ids = _tier_list_game_ids(client, tier_list)
        if not game_ids:
            return []
        conditions.append({"id": {"_in": game_ids}})

    game_filter: dict[str, Any] | None
    if len(conditions) > 1:
        game_filter = {"_and": conditions}
    elif conditions:
        game_filter = conditions[0]
    else:
        game_filter = None

    games = client.fetch_all(
        _query_path(
            "games",
            fields=(
                "id,slug,title,player_status,section_style,section_noun,"
                "current_section,sections.id"
            ),
            filter_obj=game_filter,
        )
    )
    targets = [
        {
            "id": game["id"],
            "slug": game["slug"],
            "title": game["title"],
            "player_status": game.get("player_status"),
            "existing_section_count": len(game.get("sections") or []),
            "section_style": game.get("section_style"),
            "section_noun": game.get("section_noun"),
            "current_section": game.get("current_section"),
        }
        for game in games
        if game.get("slug") and game.get("title")
    ]
    return sorted(
        targets,
        key=lambda game: (str(game["title"]).casefold(), str(game["slug"]).casefold()),
    )


def _normalized_sections(
    noun: str,
    sections: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    seen_numbers: set[int] = set()
    for section in sections:
        number = section.get("number")
        if not isinstance(number, int) or isinstance(number, bool) or number < 1:
            raise ValueError("Each section number must be a positive integer")
        if number in seen_numbers:
            raise ValueError(f"Duplicate section number: {number}")
        seen_numbers.add(number)
        raw_title = section.get("title")
        title = raw_title.strip() if isinstance(raw_title, str) else ""
        normalized.append(
            {
                "number": number,
                "title": title or default_title(noun, number),
            }
        )
    return normalized


# pylint: disable-next=too-many-arguments,too-many-locals
def upsert_game_sections(
    client: DirectusClient,
    game_id: int,
    *,
    noun: str,
    sections: list[dict[str, Any]],
    current: int | None = None,
    bundle_member_id: int | None = None,
    replace: bool = False,
    dry_run: bool = False,
) -> dict[str, int | None]:
    """Set game section metadata and idempotently create or update its rows."""
    normalized_noun = normalize_noun(noun)
    normalized_sections = _normalized_sections(normalized_noun, sections)
    if bundle_member_id is not None and not normalized_sections:
        raise ValueError("A tracked bundle member must have at least one section")
    section_numbers = {section["number"] for section in normalized_sections}
    if current is not None:
        if current < 1:
            raise ValueError("Current section must be a positive integer")
        if current not in section_numbers:
            raise ValueError("Current section must match a supplied section number")

    if bundle_member_id is None:
        bundle_members = client.fetch_all(
            _query_path(
                "game_bundle_members",
                fields="id",
                filter_obj={"games_id": {"_eq": game_id}},
            )
        )
        if bundle_members:
            raise ValueError(
                "Direct parent sections are not allowed when bundle members exist"
            )
        metadata_path = f"/items/games/{game_id}"
        metadata_update: dict[str, Any] = {
            "section_noun": normalized_noun,
            "section_style": "linear",
        }
        section_filter = {
            "games_id": {"_eq": game_id},
            "bundle_member_id": {"_null": True},
        }
    else:
        member = client.get(f"/items/game_bundle_members/{bundle_member_id}").get(
            "data", {}
        )
        member_game_id = member.get("games_id")
        if isinstance(member_game_id, dict):
            member_game_id = member_game_id.get("id")
        if member_game_id != game_id:
            raise ValueError(
                f"Bundle member id={bundle_member_id} does not belong to game id={game_id}"
            )
        metadata_path = f"/items/game_bundle_members/{bundle_member_id}"
        metadata_update = {
            "section_noun": normalized_noun,
            "section_data_status": "tracked",
        }
        section_filter = {
            "games_id": {"_eq": game_id},
            "bundle_member_id": {"_eq": bundle_member_id},
        }
    if current is not None:
        metadata_update["current_section"] = current

    existing = client.fetch_all(
        _query_path(
            "game_sections",
            fields="id,games_id,bundle_member_id,sort,number,title",
            filter_obj=section_filter,
        )
    )

    created = 0
    updated = 0
    deleted = 0
    if replace:
        for row in existing:
            if dry_run:
                print(
                    f"[DRY RUN] DELETE /items/game_sections/{row['id']}",
                    file=sys.stderr,
                )
            else:
                client.delete(f"/items/game_sections/{row['id']}")
                print(
                    f"  Deleted section {row.get('number')} (id={row['id']})",
                    file=sys.stderr,
                )
            deleted += 1
        existing = []

    existing_by_number = {
        row["number"]: row for row in existing if isinstance(row.get("number"), int)
    }
    for section in normalized_sections:
        payload = {
            "games_id": game_id,
            "bundle_member_id": bundle_member_id,
            "number": section["number"],
            "title": section["title"],
            "sort": section["number"],
        }
        existing_row = existing_by_number.get(section["number"])
        if existing_row:
            path = f"/items/game_sections/{existing_row['id']}"
            if dry_run:
                print(f"[DRY RUN] PATCH {path}: {payload}", file=sys.stderr)
            else:
                client.patch(path, payload)
                print(
                    f"  Updated {normalized_noun} {section['number']}: "
                    f"{section['title']}",
                    file=sys.stderr,
                )
            updated += 1
        else:
            if dry_run:
                print(
                    f"[DRY RUN] POST /items/game_sections: {payload}",
                    file=sys.stderr,
                )
            else:
                client.post("/items/game_sections", payload)
                print(
                    f"  Created {normalized_noun} {section['number']}: "
                    f"{section['title']}",
                    file=sys.stderr,
                )
            created += 1

    if dry_run:
        print(
            f"[DRY RUN] PATCH {metadata_path}: {metadata_update}",
            file=sys.stderr,
        )
    else:
        client.patch(metadata_path, metadata_update)

    return {
        "game_id": game_id,
        "bundle_member_id": bundle_member_id,
        "created": created,
        "updated": updated,
        "deleted": deleted,
    }


_LOWERCASE_CATEGORY_WORDS = {
    "a",
    "an",
    "and",
    "as",
    "at",
    "but",
    "by",
    "for",
    "in",
    "nor",
    "of",
    "on",
    "or",
    "the",
    "to",
    "with",
}


def _is_category_header(line: str) -> bool:
    return bool(line) and line == line.upper() and any(char.isalpha() for char in line)


def _title_case_category(line: str) -> str:
    words = line.split(" ")
    result = []
    for index, word in enumerate(words):
        comma = "," if word.endswith(",") else ""
        core = word[:-1] if comma else word
        if not core:
            result.append(word)
            continue
        lowered = core.lower()
        if index != 0 and lowered in _LOWERCASE_CATEGORY_WORDS:
            result.append(lowered + comma)
        else:
            result.append(lowered[:1].upper() + lowered[1:] + comma)
    return " ".join(result)


def parse_quest_journal_txt(text: str) -> list[dict[str, Any]]:
    """Parse a quest-journal text export into category/title entries.

    Convention (matches an in-game "things to do" journal export): the file
    is a series of blank-line-separated blocks, each starting with an
    ALL-CAPS category header line followed by one quest title per line. Any
    freeform text before the first header (e.g. a game title/version line)
    is skipped automatically rather than requiring a fixed line count to
    strip. Returns `[{category, title}]` in source order - `number` (the
    per-category ordinal) is assigned later by `upsert_quest_sections`, not
    here, so there is exactly one place ordinal assignment happens
    regardless of whether entries came from a text export or a
    `--from-json` payload.
    """
    entries: list[dict[str, Any]] = []
    current_category: str | None = None
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if _is_category_header(line):
            current_category = _title_case_category(line)
            continue
        if current_category is None:
            continue
        entries.append({"category": current_category, "title": line})

    if current_category is None:
        raise ValueError(
            "No category header (an ALL-CAPS line, e.g. 'MAIN STORY') found in the input"
        )
    if not entries:
        raise ValueError("No quest titles found under any category")
    return entries


def _normalized_quest_entries(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for entry in entries:
        title = entry.get("title")
        if not isinstance(title, str) or not title.strip():
            raise ValueError("Every quest entry requires a non-empty title")
        title = title.strip()
        if not title.isascii():
            raise ValueError(f"Quest title must be ASCII only: {title!r}")
        category = entry.get("category")
        if category is not None:
            if not isinstance(category, str) or not category.strip():
                raise ValueError("category must be a non-empty string or null")
            category = category.strip()
            if not category.isascii():
                raise ValueError(f"Category must be ASCII only: {category!r}")
        normalized.append({"category": category, "title": title})
    return normalized


def upsert_quest_sections(
    client: DirectusClient,
    game_id: int,
    *,
    noun: str,
    entries: list[dict[str, Any]],
    replace: bool = False,
    dry_run: bool = False,
) -> dict[str, int]:
    """Set a game to the nonlinear quest model and write its section rows.

    Unlike `upsert_game_sections`, this never merges in place: a quest list
    has no stable per-row identity to upsert against (categories/titles can
    be freely reordered between runs), so any pre-existing rows require
    `--replace` rather than being patched by position. `number` is assigned
    here as a 1-based ordinal within each entry's category, in entry order;
    `sort` is assigned as the 1-based position across the whole list, which
    is what drives category-grouped display order on the site.
    """
    normalized_noun = normalize_noun(noun)
    if not entries:
        raise ValueError("At least one quest entry is required")
    normalized_entries = _normalized_quest_entries(entries)

    bundle_members = client.fetch_all(
        _query_path(
            "game_bundle_members",
            fields="id",
            filter_obj={"games_id": {"_eq": game_id}},
        )
    )
    if bundle_members:
        raise ValueError(
            "Nonlinear sections are not supported for games with bundle members"
        )

    existing = client.fetch_all(
        _query_path(
            "game_sections",
            fields="id",
            filter_obj={
                "games_id": {"_eq": game_id},
                "bundle_member_id": {"_null": True},
            },
        )
    )
    if existing and not replace:
        raise ValueError(
            f"Game id={game_id} already has {len(existing)} section row(s); "
            "pass --replace to overwrite"
        )

    deleted = 0
    for row in existing:
        if dry_run:
            print(f"[DRY RUN] DELETE /items/game_sections/{row['id']}", file=sys.stderr)
        else:
            client.delete(f"/items/game_sections/{row['id']}")
            print(f"  Deleted section id={row['id']}", file=sys.stderr)
        deleted += 1

    category_counters: dict[str | None, int] = {}
    created = 0
    total = len(normalized_entries)
    for position, entry in enumerate(normalized_entries, start=1):
        category = entry["category"]
        category_counters[category] = category_counters.get(category, 0) + 1
        payload = {
            "games_id": game_id,
            "bundle_member_id": None,
            "category": category,
            "title": entry["title"],
            "number": category_counters[category],
            "sort": position,
            "completed": False,
            "is_ending": False,
        }
        label = f"{category}: {entry['title']}" if category else entry["title"]
        if dry_run:
            print(
                f"[DRY RUN] POST /items/game_sections ({position}/{total}): {label}",
                file=sys.stderr,
            )
        else:
            client.post("/items/game_sections", payload)
            print(f"  Created quest {position}/{total}: {label}", file=sys.stderr)
        created += 1

    metadata_update = {"section_style": "nonlinear", "section_noun": normalized_noun}
    metadata_path = f"/items/games/{game_id}"
    if dry_run:
        print(f"[DRY RUN] PATCH {metadata_path}: {metadata_update}", file=sys.stderr)
    else:
        client.patch(metadata_path, metadata_update)

    categories = sorted(
        {entry["category"] for entry in normalized_entries if entry["category"]}
    )
    return {
        "game_id": game_id,
        "created": created,
        "deleted": deleted,
        "category_count": len(categories),
    }


def add_target_resolver_arguments(parser: argparse.ArgumentParser) -> None:
    """Add the --list-targets resolver flags shared by both population CLIs."""
    parser.add_argument(
        "--filter", dest="raw_filter", help="Raw Directus filter object as JSON"
    )
    parser.add_argument(
        "--slug", dest="target_slug", help="Filter target games by slug"
    )
    parser.add_argument("--status", help="Filter target games by player_status")
    parser.add_argument("--genre", help="Filter target games by genre slug")
    parser.add_argument("--tier-list", help="Filter target games by tier list slug")


def parse_target_filter(
    parser: argparse.ArgumentParser, raw: str | None
) -> dict[str, Any] | None:
    """Parse a --filter JSON string into a Directus filter object."""
    if raw is None:
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as error:
        parser.error(f"--filter is not valid JSON: {error}")
    if not isinstance(parsed, dict):
        parser.error("--filter must decode to a JSON object")
    return parsed


def has_target_resolver_flags(args: argparse.Namespace) -> bool:
    """True if any of the shared target-resolver flags were passed."""
    return bool(
        args.raw_filter
        or args.target_slug
        or args.status
        or args.genre
        or args.tier_list
    )


def print_list_targets(
    parser: argparse.ArgumentParser,
    client: DirectusClient,
    args: argparse.Namespace,
) -> None:
    """Resolve the shared --list-targets flags and print matches as JSON."""
    if not has_target_resolver_flags(args):
        parser.error(
            "--list-targets requires --filter, --slug, --status, --genre, "
            "or --tier-list"
        )
    targets = resolve_targets(
        client,
        filter_obj=parse_target_filter(parser, args.raw_filter),
        slug=args.target_slug,
        status=args.status,
        genre=args.genre,
        tier_list=args.tier_list,
    )
    print(json.dumps(targets, indent=2))
