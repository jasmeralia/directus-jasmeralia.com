"""Shared Directus resolve and write logic for per-game sections."""

from __future__ import annotations

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
                "id,slug,title,player_status,section_noun,current_section,sections.id"
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


# pylint: disable-next=too-many-arguments
def upsert_game_sections(
    client: DirectusClient,
    game_id: int,
    *,
    noun: str,
    sections: list[dict[str, Any]],
    current: int | None = None,
    replace: bool = False,
    dry_run: bool = False,
) -> dict[str, int]:
    """Set game section metadata and idempotently create or update its rows."""
    normalized_noun = normalize_noun(noun)
    normalized_sections = _normalized_sections(normalized_noun, sections)
    game_update: dict[str, Any] = {"section_noun": normalized_noun}
    if current is not None:
        if current < 1:
            raise ValueError("Current section must be a positive integer")
        game_update["current_section"] = current

    if dry_run:
        print(
            f"[DRY RUN] PATCH /items/games/{game_id}: {game_update}",
            file=sys.stderr,
        )
    else:
        client.patch(f"/items/games/{game_id}", game_update)

    existing = client.fetch_all(
        _query_path(
            "game_sections",
            fields="id,games_id,sort,number,title",
            filter_obj={"games_id": {"_eq": game_id}},
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

    return {
        "game_id": game_id,
        "created": created,
        "updated": updated,
        "deleted": deleted,
    }
