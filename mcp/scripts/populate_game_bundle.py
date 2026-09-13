#!/usr/bin/env python3
"""Create or update explicitly curated omnibus bundle members in Directus."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from game_sections_lib import resolve_game
from scriptlib import (
    DirectusClient,
    take_pg_dump_backup,
    trigger_site_rebuild,
)

PLAYER_STATUSES = {
    "not_started",
    "in_progress",
    "on_hold",
    "waiting_for_update",
    "did_not_finish",
    "completed",
}
SECTION_DATA_STATUSES = {"unknown", "not_applicable", "tracked"}


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("game_slug", nargs="?", help="Parent game slug for --list")
    parser.add_argument(
        "--from-json",
        metavar="PATH",
        help="Read a reviewed bundle payload from a JSON file, or - for stdin",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="Print the parent game's current bundle members as JSON",
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Remove existing members omitted from the reviewed payload",
    )
    parser.add_argument(
        "--migrate-direct-sections",
        action="store_true",
        help=(
            "Move the parent's category-mapped direct sections to the reviewed "
            "members, renumbering each member's rows from 1"
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print planned Directus writes without changing data",
    )
    return parser


def _load_payload(parser: argparse.ArgumentParser, source: str) -> list[dict[str, Any]]:
    try:
        raw = (
            sys.stdin.read()
            if source == "-"
            else Path(source).read_text(encoding="utf-8")
        )
        payload = json.loads(raw)
    except (OSError, json.JSONDecodeError) as error:
        parser.error(f"Unable to read bundle payload: {error}")
    if not isinstance(payload, list) or not all(
        isinstance(entry, dict) for entry in payload
    ):
        parser.error("Bundle payload must be a JSON array of objects")
    return payload


def _ascii_string(value: Any, field: str, context: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{context}: {field} must be a non-empty string")
    normalized = value.strip()
    if not normalized.isascii():
        raise ValueError(f"{context}: {field} must contain ASCII characters only")
    return normalized


def _optional_ascii_string(value: Any, field: str, context: str) -> str | None:
    if value is None:
        return None
    return _ascii_string(value, field, context)


def _positive_int(value: Any, field: str, context: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise ValueError(f"{context}: {field} must be a positive integer")
    return value


def _normalize_member(raw: dict[str, Any], parent_slug: str) -> dict[str, Any]:
    context = f"{parent_slug} member"
    slug = _ascii_string(raw.get("slug"), "slug", context)
    title = _ascii_string(raw.get("title"), "title", f"{context} '{slug}'")
    sort = _positive_int(raw.get("sort"), "sort", f"{context} '{slug}'")
    player_status = raw.get("player_status", "not_started")
    if player_status not in PLAYER_STATUSES:
        raise ValueError(f"{context} '{slug}': invalid player_status '{player_status}'")
    section_status = raw.get("section_data_status", "unknown")
    if section_status not in SECTION_DATA_STATUSES:
        raise ValueError(
            f"{context} '{slug}': invalid section_data_status '{section_status}'"
        )

    current = raw.get("current")
    if current is not None:
        current = _positive_int(current, "current", f"{context} '{slug}'")
    if section_status == "not_applicable" and current is not None:
        raise ValueError(
            f"{context} '{slug}': not_applicable members cannot set current"
        )

    normalized: dict[str, Any] = {
        "slug": slug,
        "title": title,
        "sort": sort,
        "player_status": player_status,
        "section_data_status": section_status,
    }
    if "release_year" in raw:
        release_year = raw["release_year"]
        if release_year is not None:
            release_year = _positive_int(
                release_year,
                "release_year",
                f"{context} '{slug}'",
            )
        normalized["release_year"] = release_year
    if "cover_image" in raw:
        normalized["cover_image"] = raw["cover_image"]
    if "source_game_slug" in raw:
        normalized["source_game_slug"] = _optional_ascii_string(
            raw["source_game_slug"],
            "source_game_slug",
            f"{context} '{slug}'",
        )
    if "section_noun" in raw:
        normalized["section_noun"] = _optional_ascii_string(
            raw["section_noun"],
            "section_noun",
            f"{context} '{slug}'",
        )
    if "section_categories" in raw:
        categories = raw["section_categories"]
        if not isinstance(categories, list) or not categories:
            raise ValueError(
                f"{context} '{slug}': section_categories must be a non-empty array"
            )
        normalized_categories = [
            _ascii_string(category, "section_categories", f"{context} '{slug}'")
            for category in categories
        ]
        if len(normalized_categories) != len(set(normalized_categories)):
            raise ValueError(
                f"{context} '{slug}': section_categories contains a duplicate"
            )
        normalized["section_categories"] = normalized_categories
    if section_status == "not_applicable":
        normalized["current_section"] = None
    elif "current" in raw:
        normalized["current_section"] = current
    return normalized


def _normalize_parent(raw: dict[str, Any]) -> dict[str, Any]:
    slug = _ascii_string(raw.get("slug"), "slug", "parent")
    members_raw = raw.get("members")
    if not isinstance(members_raw, list) or not all(
        isinstance(member, dict) for member in members_raw
    ):
        raise ValueError(f"Parent '{slug}': members must be an array of objects")
    members = [_normalize_member(member, slug) for member in members_raw]
    member_slugs = [member["slug"] for member in members]
    member_sorts = [member["sort"] for member in members]
    if len(member_slugs) != len(set(member_slugs)):
        raise ValueError(f"Parent '{slug}': duplicate member slug")
    if len(member_sorts) != len(set(member_sorts)):
        raise ValueError(f"Parent '{slug}': duplicate member sort")
    return {"slug": slug, "members": members}


def _relation_id(value: Any) -> int | None:
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    if isinstance(value, dict):
        nested_id = value.get("id")
        return nested_id if isinstance(nested_id, int) else None
    return None


def _existing_members(
    client: DirectusClient,
    game_id: int,
) -> list[dict[str, Any]]:
    return client.fetch_all(
        "/items/game_bundle_members?"
        "fields=id,games_id,sort,slug,title,source_game_id,release_year,"
        "cover_image,player_status,section_data_status,section_noun,current_section"
        f"&filter[games_id][_eq]={game_id}"
    )


def _assert_no_direct_sections(client: DirectusClient, game_id: int) -> None:
    if _direct_sections(client, game_id):
        raise ValueError(
            f"Game id={game_id} has direct sections; remove or migrate them "
            "before adding bundle members"
        )


def _direct_sections(client: DirectusClient, game_id: int) -> list[dict[str, Any]]:
    """Return direct parent rows in their established display order."""
    return client.fetch_all(
        "/items/game_sections?fields=id,number,title,category,sort"
        f"&filter[games_id][_eq]={game_id}"
        "&filter[bundle_member_id][_null]=true"
        "&sort=sort"
    )


def _assert_member_section_state(
    client: DirectusClient,
    existing: dict[str, Any] | None,
    desired: dict[str, Any],
    *,
    allow_pending_sections: bool = False,
) -> None:
    """Reject member metadata that would violate section-state invariants."""
    member_id = existing.get("id") if existing else None
    sections = (
        client.fetch_all(
            "/items/game_sections?fields=id,number"
            f"&filter[bundle_member_id][_eq]={member_id}"
        )
        if member_id is not None
        else []
    )
    section_numbers = {
        row["number"] for row in sections if isinstance(row.get("number"), int)
    }
    status = desired["section_data_status"]
    current = (
        desired["current_section"]
        if "current_section" in desired
        else existing.get("current_section")
        if existing
        else None
    )
    if status == "tracked" and not sections and not allow_pending_sections:
        raise ValueError(
            f"Member '{desired['slug']}': tracked requires existing section rows; "
            "create the member as unknown, then populate its sections"
        )
    if status == "not_applicable" and sections:
        raise ValueError(
            f"Member '{desired['slug']}': not_applicable requires no section rows"
        )
    if (
        current is not None
        and current not in section_numbers
        and not allow_pending_sections
    ):
        raise ValueError(
            f"Member '{desired['slug']}': current_section {current} does not "
            "match an existing section row"
        )


def _assert_final_member_uniqueness(
    existing: list[dict[str, Any]],
    desired: list[dict[str, Any]],
    removals: list[dict[str, Any]],
) -> None:
    """Validate final parent-local slug and sort uniqueness before writes."""
    for field in ("slug", "sort"):
        existing_values = [member[field] for member in existing]
        if len(existing_values) != len(set(existing_values)):
            raise ValueError(
                f"Existing bundle data contains a duplicate member {field}; "
                "repair it before applying a payload"
            )
    removed_ids = {member["id"] for member in removals}
    desired_slugs = {member["slug"] for member in desired}
    retained = [
        member
        for member in existing
        if member["id"] not in removed_ids and member["slug"] not in desired_slugs
    ]
    final_members = [*retained, *desired]
    for field in ("slug", "sort"):
        values = [member[field] for member in final_members]
        if len(values) != len(set(values)):
            raise ValueError(
                f"Final bundle payload contains a duplicate member {field}"
            )


def _resolve_source_game_id(
    client: DirectusClient,
    member: dict[str, Any],
    parent_game_id: int,
) -> int | None:
    if "source_game_slug" not in member:
        return None
    source_slug = member["source_game_slug"]
    if source_slug is None:
        return None
    source = resolve_game(
        client,
        _ascii_string(source_slug, "source_game_slug", member["slug"]),
    )
    if source["id"] == parent_game_id:
        raise ValueError(
            f"Member '{member['slug']}': source game cannot equal the parent"
        )
    return source["id"]


def _directus_payload(
    client: DirectusClient,
    game_id: int,
    member: dict[str, Any],
) -> dict[str, Any]:
    payload = {
        "games_id": game_id,
        "sort": member["sort"],
        "slug": member["slug"],
        "title": member["title"],
        "player_status": member["player_status"],
        "section_data_status": member["section_data_status"],
    }
    for field in ("release_year", "cover_image", "section_noun", "current_section"):
        if field in member:
            payload[field] = member[field]
    if "source_game_slug" in member:
        payload["source_game_id"] = _resolve_source_game_id(
            client,
            member,
            game_id,
        )
    return payload


def _section_category_members(
    members: list[dict[str, Any]],
    direct_sections: list[dict[str, Any]],
    parent_slug: str,
) -> dict[str, str]:
    """Validate a complete category-to-member migration map."""
    category_members: dict[str, str] = {}
    for member in members:
        for category in member.get("section_categories", []):
            if category in category_members:
                raise ValueError(
                    f"Parent '{parent_slug}': category '{category}' maps to multiple members"
                )
            category_members[category] = member["slug"]

    if not category_members:
        raise ValueError(
            f"Parent '{parent_slug}': --migrate-direct-sections requires "
            "one or more section_categories"
        )

    raw_direct_categories = [row.get("category") for row in direct_sections]
    if not all(isinstance(category, str) for category in raw_direct_categories):
        raise ValueError(
            f"Parent '{parent_slug}': every direct section needs a category to migrate"
        )
    direct_categories: set[str] = {
        category for category in raw_direct_categories if isinstance(category, str)
    }
    unknown_categories = direct_categories - set(category_members)
    missing_categories = set(category_members) - direct_categories
    if unknown_categories:
        raise ValueError(
            f"Parent '{parent_slug}': unmapped direct categories: "
            f"{', '.join(sorted(unknown_categories))}"
        )
    if missing_categories:
        raise ValueError(
            f"Parent '{parent_slug}': no direct sections for categories: "
            f"{', '.join(sorted(missing_categories))}"
        )
    return category_members


def _assert_migration_members_are_empty(
    client: DirectusClient,
    existing_by_slug: dict[str, dict[str, Any]],
    category_members: dict[str, str],
) -> None:
    """Avoid mixing a parent-section migration with existing member sections."""
    member_slugs = set(category_members.values())
    for slug in member_slugs:
        existing = existing_by_slug.get(slug)
        if not existing:
            continue
        member_id = existing["id"]
        sections = client.fetch_all(
            f"/items/game_sections?fields=id&filter[bundle_member_id][_eq]={member_id}"
        )
        if sections:
            raise ValueError(
                f"Member '{slug}': cannot migrate direct sections into a member "
                "that already has section rows"
            )


def _migrate_direct_sections(
    client: DirectusClient,
    *,
    direct_sections: list[dict[str, Any]],
    category_members: dict[str, str],
    member_ids: dict[str, int],
    dry_run: bool,
) -> None:
    """Move direct sections to members and make their order member-local."""
    next_numbers: dict[str, int] = {}
    for section in direct_sections:
        category = section.get("category")
        if not isinstance(category, str):
            raise TypeError(f"Section id={section['id']} has no migration category")
        member_slug = category_members[category]
        next_numbers[member_slug] = next_numbers.get(member_slug, 0) + 1
        number = next_numbers[member_slug]
        payload = {
            "bundle_member_id": member_ids[member_slug],
            "number": number,
            "sort": number,
            "category": None,
        }
        path = f"/items/game_sections/{section['id']}"
        if dry_run:
            print(
                f"[DRY RUN] PATCH {path} -> member '{member_slug}': "
                f"{json.dumps(payload, sort_keys=True)}",
                file=sys.stderr,
            )
        else:
            client.patch(path, payload)


def _changed_fields(
    existing: dict[str, Any],
    desired: dict[str, Any],
) -> dict[str, Any]:
    changed: dict[str, Any] = {}
    for field, desired_value in desired.items():
        existing_value = existing.get(field)
        if field in {"games_id", "source_game_id"}:
            existing_value = _relation_id(existing_value)
        if existing_value != desired_value:
            changed[field] = desired_value
    return changed


def _delete_member(
    client: DirectusClient,
    member: dict[str, Any],
    *,
    dry_run: bool,
) -> None:
    member_id = member["id"]
    sections = client.fetch_all(
        "/items/game_sections?fields=id,number"
        f"&filter[bundle_member_id][_eq]={member_id}"
    )
    for section in sections:
        path = f"/items/game_sections/{section['id']}"
        if dry_run:
            print(f"[DRY RUN] DELETE {path}", file=sys.stderr)
        else:
            client.delete(path)
    if not dry_run:
        remaining = client.fetch_all(
            f"/items/game_sections?fields=id&filter[bundle_member_id][_eq]={member_id}"
        )
        if remaining:
            raise RuntimeError(
                f"Refusing to delete member id={member_id}: section rows remain"
            )
    member_path = f"/items/game_bundle_members/{member_id}"
    if dry_run:
        print(f"[DRY RUN] DELETE {member_path}", file=sys.stderr)
    else:
        client.delete(member_path)


def main() -> None:
    """Validate a reviewed payload and apply only the requested bundle changes."""
    parser = _parser()
    args = parser.parse_args()
    client = DirectusClient.from_config()
    if args.list:
        if (
            not args.game_slug
            or args.from_json
            or args.replace
            or args.migrate_direct_sections
        ):
            parser.error(
                "--list requires one game_slug and no payload, --replace, or migration"
            )
        game = resolve_game(client, args.game_slug)
        print(json.dumps(_existing_members(client, game["id"]), indent=2))
        return
    if not args.from_json or args.game_slug:
        parser.error("--from-json is required unless using game_slug --list")
    if args.migrate_direct_sections and args.replace:
        parser.error("--migrate-direct-sections cannot be combined with --replace")
    try:
        parents = [
            _normalize_parent(entry) for entry in _load_payload(parser, args.from_json)
        ]
        parent_slugs = [parent["slug"] for parent in parents]
        if len(parent_slugs) != len(set(parent_slugs)):
            raise ValueError("Bundle payload contains a duplicate parent slug")
        planned: list[dict[str, Any]] = []
        for parent in parents:
            game = resolve_game(client, parent["slug"])
            direct_sections = _direct_sections(client, game["id"])
            if args.migrate_direct_sections:
                if not direct_sections:
                    raise ValueError(
                        f"Parent '{parent['slug']}': no direct sections to migrate"
                    )
                category_members = _section_category_members(
                    parent["members"], direct_sections, parent["slug"]
                )
            else:
                _assert_no_direct_sections(client, game["id"])
                category_members = {}
            existing = _existing_members(client, game["id"])
            existing_by_slug = {member["slug"]: member for member in existing}
            if args.migrate_direct_sections:
                _assert_migration_members_are_empty(
                    client, existing_by_slug, category_members
                )
            desired = [
                _directus_payload(client, game["id"], member)
                for member in parent["members"]
            ]
            desired_slugs = {member["slug"] for member in desired}
            removals = (
                [member for member in existing if member["slug"] not in desired_slugs]
                if args.replace
                else []
            )
            _assert_final_member_uniqueness(existing, desired, removals)
            for desired_member in desired:
                _assert_member_section_state(
                    client,
                    existing_by_slug.get(desired_member["slug"]),
                    desired_member,
                    allow_pending_sections=args.migrate_direct_sections,
                )
            planned.append(
                {
                    "game": game,
                    "desired": desired,
                    "existing_by_slug": existing_by_slug,
                    "removals": removals,
                    "direct_sections": direct_sections,
                    "category_members": category_members,
                }
            )
    except ValueError as error:
        parser.error(str(error))

    removals_exist = any(plan["removals"] for plan in planned)
    if removals_exist and not args.dry_run:
        backup = take_pg_dump_backup("bundle_member_replace")
        print(f"Deletion backup: {backup}", file=sys.stderr)

    changed_game_ids: list[int] = []
    for plan in planned:
        game = plan["game"]
        changed = False
        member_ids = {
            slug: member["id"] for slug, member in plan["existing_by_slug"].items()
        }
        for member in plan["removals"]:
            _delete_member(client, member, dry_run=args.dry_run)
            changed = True

        for desired in plan["desired"]:
            existing = plan["existing_by_slug"].get(desired["slug"])
            if existing:
                updates = _changed_fields(existing, desired)
                if not updates:
                    continue
                path = f"/items/game_bundle_members/{existing['id']}"
                if args.dry_run:
                    print(
                        f"[DRY RUN] PATCH {path}: {json.dumps(updates, sort_keys=True)}",
                        file=sys.stderr,
                    )
                else:
                    client.patch(path, updates)
            else:
                if args.dry_run:
                    print(
                        "[DRY RUN] POST /items/game_bundle_members: "
                        f"{json.dumps(desired, sort_keys=True)}",
                        file=sys.stderr,
                    )
                else:
                    created = client.post("/items/game_bundle_members", desired)
                    member_id = created.get("data", {}).get("id")
                    if not isinstance(member_id, int):
                        raise RuntimeError(
                            f"Created member '{desired['slug']}' has no integer id"
                        )
                    member_ids[desired["slug"]] = member_id
            changed = True

        if args.migrate_direct_sections:
            if args.dry_run:
                member_ids = {member["slug"]: -1 for member in plan["desired"]}
            _migrate_direct_sections(
                client,
                direct_sections=plan["direct_sections"],
                category_members=plan["category_members"],
                member_ids=member_ids,
                dry_run=args.dry_run,
            )
            if not args.dry_run and _direct_sections(client, game["id"]):
                raise RuntimeError(
                    f"Direct sections remain after migrating game id={game['id']}"
                )
            parent_payload = {"section_noun": None, "current_section": None}
            if args.dry_run:
                print(
                    f"[DRY RUN] PATCH /items/games/{game['id']}: "
                    f"{json.dumps(parent_payload, sort_keys=True)}",
                    file=sys.stderr,
                )
            else:
                client.patch(f"/items/games/{game['id']}", parent_payload)
            changed = True

        if changed:
            changed_game_ids.append(game["id"])
            action = "Would update" if args.dry_run else "Updated"
            print(f"{action} bundle for {game['title']}", file=sys.stderr)

    if changed_game_ids and not args.dry_run:
        trigger_site_rebuild(client, changed_game_ids)


if __name__ == "__main__":
    main()
