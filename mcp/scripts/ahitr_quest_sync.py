#!/usr/bin/env python3
"""Sync A House In The Rift quest catalog and completion state to Directus.

Reads quest definitions from the installed game's unrpa_scripts tree and
completion flags from the newest Ren'Py save, then creates or updates
game_sections rows for slug a-house-in-the-rift. Quests marked hidden in
source are excluded unless the class later sets self.hidden = False (unlock-
gated journal quests). LEWDNESS/INTIMACY and Placeholder quests are always
excluded.

Apply aborts when stale game_sections rows remain unless --allow-orphans is
passed (still aborts when an orphan occupies a sort slot the catalog needs).
"""

from __future__ import annotations

import argparse
import ast
import glob
import io
import os
import pickle
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from game_sections_lib import normalize_noun, resolve_game
from scriptlib import (
    DEFAULT_BACKOFF_BASE,
    DEFAULT_MAX_RETRIES,
    DIRECTUS_REQUEST_DELAY_S,
    DirectusClient,
    RetryingDirectusClient,
    take_pg_dump_backup,
    trigger_site_rebuild,
)

DEFAULT_SLUG = "a-house-in-the-rift"
DEFAULT_AVNS_DIR = Path.home() / "AVNs"
DEFAULT_SAVE_GLOB = Path.home() / "Dropbox/Gaming/Saves/A House In The Rift/*.save"
GAME_DIR_PATTERN = re.compile(r"AHouseInTheRift-([\d.]+\w*)-pc$")
QUEST_NOUN = "Quest"

EXCLUDED_QUEST_TYPES = frozenset({"LEWDNESS", "INTIMACY"})
MISC_CATEGORY = "Group, Seasonal, and Miscellaneous"
GIRL_DIR_CATEGORIES = {
    "azraesha": "Rae",
    "naomi": "Naomi",
    "cait": "Cait",
    "lyriel": "Lyriel",
    "yona": "Yona",
    "blair": "Blair",
}
JOURNAL_CATEGORY_ORDER = [
    "Main Story",
    "Rae",
    "Cait",
    "Naomi",
    "Lyriel",
    "Blair",
    "Yona",
    MISC_CATEGORY,
]
CATEGORY_ORDER = JOURNAL_CATEGORY_ORDER
ROUTE_TIERS = {
    "main_route": 0,
    "side_quests": 2,
    "repeatables": 3,
}
# Observed journal order for miscellaneous side content (prefix match).
MISC_PATH_PREFIXES = (
    "side_quests/group_events/anniversary",
    "side_quests/misc/2_exercise_clothes",
    "side_quests/misc/1_food_and_drink",
    "side_quests/group_events/halloween/halloween_24",
    "side_quests/group_events/halloween_repeat",
    "side_quests/group_events/xmas/xmas_21",
    "side_quests/group_events/xmas/xmas_22",
    "side_quests/group_events/xmas/xmas_23",
    "side_quests/group_events/xmas/xmas_24",
    "side_quests/lost_and_found",
    "side_quests/group_events/scary_stories",
    "side_quests/group_events/blair_yona_swimsuits",
)

CLASS_RE = re.compile(r"class\s+(\w+)\(Quest\)\s*:", re.MULTILINE)
QUEST_ID_RE = re.compile(r"quest_id\s*=\s*QuestID\.(\w+)")
NAME_RE = re.compile(r'name\s*=\s*_\(\s*("(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\')\s*\)')
QUEST_TYPE_RE = re.compile(r"quest_type\s*=\s*QuestType\.(\w+)")
HIDDEN_RE = re.compile(r"hidden\s*=\s*(True|False)")
HIDDEN_UNHIDE_RE = re.compile(r"self\.hidden\s*=\s*False")
QUEST_ID_NUMBER_RE = re.compile(r"(\d+)")


@dataclass(frozen=True)
class CatalogQuest:
    """One trackable quest parsed from game source."""

    quest_id: str
    title: str
    category: str
    source_path: str


@dataclass(frozen=True)
class SyncQuest(CatalogQuest):
    """Catalog quest with Directus ordering and save completion state."""

    number: int
    sort: int
    completed: bool


def _version_key(version: str) -> tuple[tuple[int, ...], tuple[str, int | str]]:
    """Return a sortable key for AHITR install directory versions."""
    match = re.match(r"(\d+(?:\.\d+)*)(.*)$", version)
    if not match:
        return ((0,), ("x", version))
    parts = tuple(int(part) for part in match.group(1).split("."))
    suffix = match.group(2)
    revision_match = re.fullmatch(r"[rR](\d+)", suffix)
    if revision_match:
        return (parts, ("r", int(revision_match.group(1))))
    if suffix:
        return (parts, ("x", suffix.lower()))
    return (parts, ("", 0))


def _require_ascii_text(value: str, field: str) -> str:
    text = value.strip()
    if not text:
        raise ValueError(f"{field} must be non-empty")
    if not text.isascii():
        raise ValueError(f"{field} must be ASCII only: {text!r}")
    return text


def find_latest_game_dir(avns_dir: Path) -> Path:
    """Return the highest-version AHouseInTheRift-*-pc install under avns_dir."""
    candidates: list[tuple[tuple[tuple[int, ...], tuple[str, int | str]], Path]] = []
    for path in avns_dir.glob("AHouseInTheRift-*-pc"):
        if not path.is_dir():
            continue
        match = GAME_DIR_PATTERN.match(path.name)
        if not match:
            continue
        candidates.append((_version_key(match.group(1)), path))
    if not candidates:
        print(
            f"ERROR: no AHouseInTheRift-*-pc installs found under {avns_dir}",
            file=sys.stderr,
        )
        raise SystemExit(1)
    _, chosen = max(candidates, key=lambda item: item[0])
    print(f"Using game install: {chosen}", file=sys.stderr)
    return chosen


def ensure_unrpa_scripts(game_dir: Path) -> Path:
    """Return unrpa_scripts/, extracting scripts.rpa with unrpa when missing."""
    scripts_dir = game_dir / "unrpa_scripts"
    if scripts_dir.is_dir():
        print(f"Using existing scripts tree: {scripts_dir}", file=sys.stderr)
        return scripts_dir

    scripts_rpa = game_dir / "game" / "scripts.rpa"
    if not scripts_rpa.is_file():
        print(f"ERROR: missing scripts archive: {scripts_rpa}", file=sys.stderr)
        raise SystemExit(1)

    print(f"Extracting {scripts_rpa} with unrpa...", file=sys.stderr)
    result = subprocess.run(
        [
            "unrpa",
            "-p",
            str(scripts_dir),
            "-m",
            str(scripts_rpa),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(result.stdout, file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        print("ERROR: unrpa extraction failed", file=sys.stderr)
        raise SystemExit(1)
    if not scripts_dir.is_dir():
        print(f"ERROR: unrpa did not create {scripts_dir}", file=sys.stderr)
        raise SystemExit(1)
    return scripts_dir


def _extract_init_block(text: str, start: int = 0) -> str | None:
    marker = text.find("Quest.__init__(self,", start)
    if marker < 0:
        return None
    open_paren = text.find("(", marker)
    depth = 0
    quote: str | None = None
    index = open_paren
    while index < len(text):
        char = text[index]
        if quote:
            if char == "\\":
                index += 2
                continue
            if char == quote:
                quote = None
        elif char == "#":
            newline = text.find("\n", index)
            index = len(text) if newline < 0 else newline
            continue
        elif char in ("'", '"'):
            quote = char
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                return text[marker : index + 1]
        index += 1
    return None


def _category_for(path: Path) -> str:
    parts = path.parts
    try:
        quests_index = parts.index("quests")
    except ValueError:
        return MISC_CATEGORY
    relative = parts[quests_index + 1 :]
    if relative and relative[0] == "story":
        return "Main Story"
    if (
        len(relative) >= 3
        and relative[0] == "girl_quests"
        and relative[1] in GIRL_DIR_CATEGORIES
    ):
        return GIRL_DIR_CATEGORIES[relative[1]]
    return MISC_CATEGORY


def _quest_id_sort_key(quest_id: str) -> tuple[int, str]:
    match = QUEST_ID_NUMBER_RE.search(quest_id)
    if match:
        return (int(match.group(1)), quest_id)
    return (10**9, quest_id)


def _leading_folder_number(segment: str) -> int:
    match = re.match(r"(\d+)", segment)
    if match:
        return int(match.group(1))
    return 10**9


def _route_tier(route: str) -> tuple[int, str]:
    if route in ROUTE_TIERS:
        return (ROUTE_TIERS[route], route)
    if route.endswith("_route"):
        return (1, route)
    return (4, route)


def _misc_path_sort_key(source_path: str) -> tuple:
    for index, prefix in enumerate(MISC_PATH_PREFIXES):
        if source_path.startswith(prefix):
            return (index, source_path)
    return (len(MISC_PATH_PREFIXES), source_path)


def _journal_sort_key(quest: CatalogQuest) -> tuple:
    """Order quests the way the in-game journal groups them."""
    parts = Path(quest.source_path).parts
    if parts[0] == "story":
        return (_quest_id_sort_key(quest.quest_id), quest.source_path)
    if len(parts) >= 4 and parts[0] == "girl_quests":
        route_key = _route_tier(parts[2])
        return (
            route_key[0],
            route_key[1],
            _leading_folder_number(parts[3]),
            parts[3],
            quest.source_path,
        )
    return _misc_path_sort_key(quest.source_path)


def _order_catalog_quests(grouped: dict[str, list[CatalogQuest]]) -> list[CatalogQuest]:
    ordered: list[CatalogQuest] = []
    seen_categories = set(grouped)
    for category in JOURNAL_CATEGORY_ORDER:
        if category not in grouped:
            continue
        ordered.extend(sorted(grouped[category], key=_journal_sort_key))
        seen_categories.remove(category)
    for category in sorted(seen_categories):
        ordered.extend(sorted(grouped[category], key=_journal_sort_key))
    return ordered


def _is_permanently_hidden(body: str, init_block: str) -> bool:
    """True when a quest starts hidden and never unhides for the journal."""
    hidden_match = HIDDEN_RE.search(init_block)
    if not hidden_match or hidden_match.group(1) != "True":
        return False
    return HIDDEN_UNHIDE_RE.search(body) is None


def parse_quest_catalog(scripts_dir: Path) -> list[CatalogQuest]:
    """Parse quest classes from unrpa_scripts/scripts/quests/**/*.rpy."""
    quests_root = scripts_dir / "scripts" / "quests"
    if not quests_root.is_dir():
        print(f"ERROR: quest source tree not found: {quests_root}", file=sys.stderr)
        raise SystemExit(1)

    by_id: dict[str, CatalogQuest] = {}
    class_count = 0
    for rpy_path in sorted(quests_root.rglob("*.rpy")):
        text = rpy_path.read_text(encoding="utf-8", errors="replace")
        matches = list(CLASS_RE.finditer(text))
        for index, match in enumerate(matches):
            class_count += 1
            class_name = match.group(1)
            body_end = (
                matches[index + 1].start() if index + 1 < len(matches) else len(text)
            )
            body = text[match.start() : body_end]
            init_block = _extract_init_block(body)
            if not init_block:
                print(
                    f"WARNING: no Quest.__init__ block for {class_name} in {rpy_path}",
                    file=sys.stderr,
                )
                continue

            quest_id_match = QUEST_ID_RE.search(init_block)
            name_match = NAME_RE.search(init_block)
            if not quest_id_match or not name_match:
                print(
                    f"WARNING: missing quest_id/name for {class_name} in {rpy_path}",
                    file=sys.stderr,
                )
                continue

            quest_id = quest_id_match.group(1)
            raw_title = ast.literal_eval(name_match.group(1)).strip()

            quest_type_match = QUEST_TYPE_RE.search(init_block)
            quest_type = quest_type_match.group(1) if quest_type_match else "MAIN"
            if quest_type in EXCLUDED_QUEST_TYPES:
                continue
            if _is_permanently_hidden(body, init_block):
                continue
            if "Placeholder" in class_name or "Placeholder" in quest_id:
                continue
            if not raw_title:
                continue
            if quest_id in by_id:
                print(
                    f"WARNING: duplicate quest_id {quest_id}; keeping first occurrence",
                    file=sys.stderr,
                )
                continue

            title = _require_ascii_text(raw_title, "Quest title")

            by_id[quest_id] = CatalogQuest(
                quest_id=quest_id,
                title=title,
                category=_require_ascii_text(_category_for(rpy_path), "Category"),
                source_path=str(rpy_path.relative_to(quests_root)),
            )

    grouped: dict[str, list[CatalogQuest]] = {}
    for quest in by_id.values():
        grouped.setdefault(quest.category, []).append(quest)

    ordered = _order_catalog_quests(grouped)

    print(
        f"Parsed {class_count} quest classes -> {len(ordered)} trackable quests",
        file=sys.stderr,
    )
    return ordered


class _PermissiveDict(dict):
    def __new__(cls, *args: Any, **_kwargs: Any) -> _PermissiveDict:
        return super().__new__(cls)

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        if args and isinstance(args[0], dict):
            self.update(args[0])
        if kwargs:
            self.update(kwargs)

    def __setstate__(self, state: Any) -> None:
        if isinstance(state, dict):
            self.update(state)
        elif (
            isinstance(state, tuple) and len(state) == 2 and isinstance(state[1], dict)
        ):
            self.update(state[1])


class _PermissiveList(list):
    def __new__(cls, *args: Any, **_kwargs: Any) -> _PermissiveList:
        return super().__new__(cls)

    def __init__(self, *args: Any, **_kwargs: Any) -> None:
        if args:
            try:
                self.extend(args[0])
            except Exception:  # noqa: BLE001 - best-effort list hydration
                pass

    def __setstate__(self, state: Any) -> None:
        if isinstance(state, dict):
            self.__dict__.update(state)
        elif (
            isinstance(state, tuple) and len(state) == 2 and isinstance(state[1], dict)
        ):
            self.__dict__.update(state[1])
        else:
            try:
                self.extend(state)
            except Exception:  # noqa: BLE001 - best-effort list hydration
                pass


def _make_stub(name: str) -> type:
    class Stub:
        """Permissive pickle stub for unknown Ren'Py classes."""

        def __new__(cls, *args: Any, **kwargs: Any):
            return object.__new__(cls)

        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

        def __setstate__(self, state: Any) -> None:
            if isinstance(state, dict):
                self.__dict__.update(state)
            elif isinstance(state, tuple):
                if len(state) == 2 and isinstance(state[1], dict):
                    self.__dict__.update(state[1])
                else:
                    self.__dict__["_state"] = state

    Stub.__name__ = name
    return Stub


class _PermissiveUnpickler(pickle.Unpickler):
    def find_class(self, module: str, name: str) -> type:
        if "Dict" in name or name == "dict":
            return _PermissiveDict
        if "List" in name or name == "list":
            return _PermissiveList
        if name in ("set", "Set"):
            return set
        return _make_stub(name)


def _normalize_quest_id(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "name"):
        return str(value.name)
    if isinstance(value, str):
        return value.split(".")[-1]
    return str(value)


def find_latest_save(save_glob: str) -> Path:
    """Return the newest .save file by mtime from a glob pattern."""
    candidates = [
        Path(path)
        for path in glob.glob(os.path.expanduser(save_glob))
        if Path(path).is_file()
    ]
    if not candidates:
        print(f"ERROR: no save files matched {save_glob}", file=sys.stderr)
        raise SystemExit(1)
    chosen = max(candidates, key=lambda path: path.stat().st_mtime)
    print(f"Using save file: {chosen}", file=sys.stderr)
    return chosen


def read_save_completion(save_path: Path) -> dict[str, bool]:
    """Return quest_id -> completed from a Ren'Py .save zip."""
    with zipfile.ZipFile(save_path) as archive:
        if "log" not in archive.namelist():
            print(
                f"ERROR: save archive missing log member: {save_path}", file=sys.stderr
            )
            raise SystemExit(1)
        data = _PermissiveUnpickler(io.BytesIO(archive.read("log"))).load()

    roots = data[0]
    quest_manager = roots["store.state"].quest_manager
    completion: dict[str, bool] = {}
    for quest in quest_manager.quests:
        quest_id = _normalize_quest_id(getattr(quest, "quest_id", None))
        if not quest_id:
            continue
        completion[quest_id] = bool(getattr(quest, "completed", False))
    completed_count = sum(1 for value in completion.values() if value)
    print(
        f"Read completion for {len(completion)} quests ({completed_count} completed)",
        file=sys.stderr,
    )
    return completion


def build_sync_quests(
    catalog: list[CatalogQuest],
    completion_by_id: dict[str, bool],
) -> list[SyncQuest]:
    """Attach per-category number, global sort, and save completion flags."""
    sync_quests: list[SyncQuest] = []
    category_counters: dict[str, int] = {}
    for position, quest in enumerate(catalog, start=1):
        category_counters[quest.category] = category_counters.get(quest.category, 0) + 1
        sync_quests.append(
            SyncQuest(
                quest_id=quest.quest_id,
                title=quest.title,
                category=quest.category,
                source_path=quest.source_path,
                number=category_counters[quest.category],
                sort=position,
                completed=completion_by_id.get(quest.quest_id, False),
            )
        )
    return sync_quests


def _row_key(category: str | None, title: str) -> tuple[str | None, str]:
    return (category, title)


def _assert_unique_keys(
    keys: list[tuple[str | None, str]],
    label: str,
) -> None:
    seen: set[tuple[str | None, str]] = set()
    duplicates: list[tuple[str | None, str]] = []
    for key in keys:
        if key in seen and key not in duplicates:
            duplicates.append(key)
        seen.add(key)
    if duplicates:
        formatted = ", ".join(f"{category}: {title}" for category, title in duplicates)
        print(
            f"ERROR: duplicate {label} (category, title) keys: {formatted}",
            file=sys.stderr,
        )
        raise SystemExit(1)


def _index_existing_rows(
    existing_rows: list[dict[str, Any]],
) -> dict[tuple[str | None, str], dict[str, Any]]:
    indexed: dict[tuple[str | None, str], dict[str, Any]] = {}
    for row in existing_rows:
        title = row.get("title")
        if not isinstance(title, str):
            continue
        key = _row_key(row.get("category"), title)
        if key in indexed:
            print(
                f"ERROR: duplicate existing game_sections rows for {key[0]}: {key[1]} "
                f"(ids {indexed[key]['id']} and {row['id']})",
                file=sys.stderr,
            )
            raise SystemExit(1)
        indexed[key] = row
    return indexed


def _validate_sync_plan(
    quests: list[SyncQuest],
    existing_rows: list[dict[str, Any]],
    *,
    dry_run: bool,
    allow_orphans: bool,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Validate catalog/row keys and orphan sort collisions before writing."""
    _assert_unique_keys(
        [_row_key(quest.category, quest.title) for quest in quests],
        "catalog",
    )
    existing_by_key = _index_existing_rows(existing_rows)
    desired_keys = {_row_key(quest.category, quest.title) for quest in quests}
    orphans = [row for key, row in existing_by_key.items() if key not in desired_keys]
    desired_sorts = {quest.sort for quest in quests}
    sort_collisions = [
        row
        for row in orphans
        if isinstance(row.get("sort"), int) and row["sort"] in desired_sorts
    ]

    if sort_collisions:
        label = "WARNING" if dry_run else "ERROR"
        print(
            f"{label}: orphan rows occupy sort positions required by the catalog:",
            file=sys.stderr,
        )
        for row in sort_collisions:
            print(
                f"  id={row['id']}: {row.get('category')}: {row.get('title')} (sort={row.get('sort')})",
                file=sys.stderr,
            )
        if not dry_run:
            print(
                "Resolve stale rows before applying (delete colliding orphans first).",
                file=sys.stderr,
            )
            raise SystemExit(1)

    if orphans and not allow_orphans and not dry_run:
        print(
            "ERROR: catalog sync would leave stale game_sections rows behind:",
            file=sys.stderr,
        )
        for row in orphans:
            print(
                f"  id={row['id']}: {row.get('category')}: {row.get('title')}",
                file=sys.stderr,
            )
        print(
            "Delete stale rows or pass --allow-orphans to apply when no sort "
            "positions collide.",
            file=sys.stderr,
        )
        raise SystemExit(1)

    return orphans, sort_collisions


def _create_section(
    client: RetryingDirectusClient,
    payload: dict[str, Any],
    *,
    description: str,
) -> dict[str, Any]:
    return client.post("/items/game_sections", payload, description=description)


def _update_section(
    client: RetryingDirectusClient,
    row_id: int,
    changes: dict[str, Any],
    *,
    description: str,
) -> dict[str, Any]:
    return client.patch(
        f"/items/game_sections/{row_id}",
        changes,
        description=description,
    )


def _update_game_metadata(
    client: RetryingDirectusClient,
    game_id: int,
    metadata_update: dict[str, Any],
) -> dict[str, Any]:
    return client.patch(
        f"/items/games/{game_id}",
        metadata_update,
        description="update game metadata",
    )


def _fetch_game_metadata(
    client: RetryingDirectusClient, game_id: int
) -> dict[str, Any]:
    """Return the current section_style/section_noun for a game record."""
    response = client.get(
        f"/items/games/{game_id}?fields=id,section_style,section_noun",
        description=f"fetch game metadata for game {game_id}",
    )
    return response.get("data", response)


def _fetch_existing_sections(
    client: RetryingDirectusClient,
    game_id: int,
) -> list[dict[str, Any]]:
    return client.fetch_all(
        "/items/game_sections"
        "?fields=id,games_id,category,title,completed,number,sort"
        f"&filter[games_id][_eq]={game_id}"
        "&filter[bundle_member_id][_null]=true",
        description=f"fetch game_sections for game {game_id}",
    )


def _fetch_section_by_key(
    client: RetryingDirectusClient,
    game_id: int,
    category: str | None,
    title: str,
) -> dict[str, Any] | None:
    """Return one parent game_sections row matched by category and title."""
    params: list[tuple[str, str]] = [
        ("fields", "id,games_id,category,title,completed,number,sort"),
        ("filter[games_id][_eq]", str(game_id)),
        ("filter[bundle_member_id][_null]", "true"),
        ("filter[title][_eq]", title),
        ("limit", "1"),
    ]
    if category is None:
        params.append(("filter[category][_null]", "true"))
    else:
        params.append(("filter[category][_eq]", category))
    path = f"/items/game_sections?{urllib.parse.urlencode(params)}"
    rows = client.fetch_all(
        path,
        description=f"lookup section {category}: {title}",
        page_size=1,
    )
    return rows[0] if rows else None


def _create_section_idempotent(
    client: RetryingDirectusClient,
    game_id: int,
    key: tuple[str | None, str],
    payload: dict[str, Any],
    existing_by_key: dict[tuple[str | None, str], dict[str, Any]],
    label: str,
) -> None:
    """Create a section row with bounded retry and idempotent recovery."""
    existing = _fetch_section_by_key(client, game_id, key[0], key[1])
    if existing is not None:
        existing_by_key[key] = existing
        print(
            f"  Row already exists for {label} (id={existing['id']})",
            file=sys.stderr,
        )
        return

    description = f"create {label}"
    delay = DEFAULT_BACKOFF_BASE
    for attempt in range(DEFAULT_MAX_RETRIES):
        time.sleep(DIRECTUS_REQUEST_DELAY_S)
        try:
            created = _create_section(
                client,
                payload,
                description=description,
            )
        except urllib.error.HTTPError:
            raise
        except Exception as error:
            existing = _fetch_section_by_key(client, game_id, key[0], key[1])
            if existing is not None:
                existing_by_key[key] = existing
                print(
                    f"  Row already exists for {label} (id={existing['id']})",
                    file=sys.stderr,
                )
                return
            if attempt + 1 >= DEFAULT_MAX_RETRIES:
                print(
                    f"ERROR: {description} failed after {DEFAULT_MAX_RETRIES} "
                    f"attempts: {error}",
                    file=sys.stderr,
                )
                raise
            print(
                f"  {description} failed ({error}); backing off {delay:.0f}s "
                f"(attempt {attempt + 1}/{DEFAULT_MAX_RETRIES})...",
                file=sys.stderr,
            )
            time.sleep(delay)
            delay *= 2
            continue

        data = created.get("data", created)
        if isinstance(data, dict):
            existing_by_key[key] = data
        print(f"  Created {label}", file=sys.stderr)
        return

    print(
        f"ERROR: {description} failed after {DEFAULT_MAX_RETRIES} attempts",
        file=sys.stderr,
    )
    raise SystemExit(1)


# pylint: disable-next=too-many-locals
def sync_to_directus(
    client: RetryingDirectusClient,
    game_id: int,
    quests: list[SyncQuest],
    *,
    dry_run: bool,
    allow_orphans: bool = False,
) -> dict[str, int]:
    """Create or patch game_sections rows to match the parsed quest catalog."""
    existing_rows = _fetch_existing_sections(client, game_id)
    orphans, _ = _validate_sync_plan(
        quests,
        existing_rows,
        dry_run=dry_run,
        allow_orphans=allow_orphans,
    )
    existing_by_key = _index_existing_rows(existing_rows)

    created = 0
    patched = 0

    for quest in quests:
        key = _row_key(quest.category, quest.title)
        payload = {
            "games_id": game_id,
            "bundle_member_id": None,
            "category": quest.category,
            "title": quest.title,
            "number": quest.number,
            "sort": quest.sort,
            "completed": quest.completed,
            "is_ending": False,
        }
        existing = existing_by_key.get(key)
        if existing is None:
            created += 1
            label = f"{quest.category}: {quest.title}"
            if dry_run:
                print(
                    f"[DRY RUN] Would create {label} "
                    f"(#{quest.number}, sort={quest.sort}, completed={quest.completed})",
                    file=sys.stderr,
                )
            else:
                _create_section_idempotent(
                    client,
                    game_id,
                    key,
                    payload,
                    existing_by_key,
                    label,
                )
            continue

        changes = {
            field: value
            for field, value in payload.items()
            if field in {"number", "sort", "completed"} and existing.get(field) != value
        }
        if not changes:
            continue

        patched += 1
        label = f"{quest.category}: {quest.title}"
        if dry_run:
            print(f"[DRY RUN] Would update {label} ({changes})", file=sys.stderr)
        else:
            row_id = existing["id"]
            _update_section(
                client,
                row_id,
                changes,
                description=f"update {label}",
            )
            print(f"  Updated {label} ({changes})", file=sys.stderr)

    for row in orphans:
        category = row.get("category")
        title = row.get("title")
        print(
            f"ORPHAN id={row['id']}: {category}: {title}",
            file=sys.stderr,
        )

    desired_metadata = {
        "section_style": "nonlinear",
        "section_noun": normalize_noun(QUEST_NOUN),
    }
    current_metadata = _fetch_game_metadata(client, game_id)
    metadata_changes = {
        field: value
        for field, value in desired_metadata.items()
        if current_metadata.get(field) != value
    }
    metadata_path = f"/items/games/{game_id}"
    if metadata_changes:
        if dry_run:
            print(
                f"[DRY RUN] PATCH {metadata_path}: {metadata_changes}",
                file=sys.stderr,
            )
        else:
            _update_game_metadata(client, game_id, metadata_changes)
            print(f"  Updated game metadata: {metadata_changes}", file=sys.stderr)

    changed = created > 0 or patched > 0 or bool(metadata_changes)

    return {
        "created": created,
        "patched": patched,
        "orphans": len(orphans),
        "changed": int(changed),
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Sync AHITR quest catalog and completion state to Directus."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print planned writes without touching Directus",
    )
    parser.add_argument(
        "--allow-orphans",
        action="store_true",
        help=(
            "Apply even when stale game_sections rows remain. Apply still aborts "
            "when an orphan occupies a sort slot required by the catalog."
        ),
    )
    parser.add_argument(
        "--force-rebuild",
        action="store_true",
        help=(
            "Trigger a site rebuild even if this run made no data changes. Use "
            "to recover from a prior run whose rebuild trigger request failed, "
            "since a clean rerun otherwise sees no changes to rebuild for."
        ),
    )
    parser.add_argument("--slug", default=DEFAULT_SLUG, help="Directus game slug")
    parser.add_argument(
        "--avns-dir",
        type=Path,
        default=DEFAULT_AVNS_DIR,
        help="Directory containing AHouseInTheRift-*-pc installs",
    )
    parser.add_argument(
        "--game-dir",
        type=Path,
        help="Override the installed game directory",
    )
    parser.add_argument(
        "--save-file",
        type=Path,
        help="Override the Ren'Py .save file used for completion state",
    )
    parser.add_argument(
        "--save-glob",
        default=str(DEFAULT_SAVE_GLOB),
        help="Glob used to find the newest .save when --save-file is omitted",
    )
    return parser


def main() -> None:
    """Locate game data, parse quests, and sync Directus game_sections rows."""
    parser = _parser()
    args = parser.parse_args()

    game_dir = args.game_dir or find_latest_game_dir(args.avns_dir.expanduser())
    scripts_dir = ensure_unrpa_scripts(game_dir.expanduser())
    catalog = parse_quest_catalog(scripts_dir)

    save_path = args.save_file or find_latest_save(args.save_glob)
    completion_by_id = read_save_completion(save_path.expanduser())
    sync_quests = build_sync_quests(catalog, completion_by_id)

    client = RetryingDirectusClient(DirectusClient.from_config())
    game = resolve_game(client, args.slug)

    if not args.dry_run:
        existing_rows = _fetch_existing_sections(client, game["id"])
        _validate_sync_plan(
            sync_quests,
            existing_rows,
            dry_run=False,
            allow_orphans=args.allow_orphans,
        )
        backup = take_pg_dump_backup("ahitr_quest_sync")
        print(f"Backup: {backup}", file=sys.stderr)

    result = sync_to_directus(
        client,
        game["id"],
        sync_quests,
        dry_run=args.dry_run,
        allow_orphans=args.allow_orphans,
    )

    prefix = "[DRY RUN] Would apply" if args.dry_run else "Applied"
    print(
        f"{prefix}: {result['created']} created, {result['patched']} patched, "
        f"{result['orphans']} orphan(s) reported",
        file=sys.stderr,
    )

    if (result["changed"] or args.force_rebuild) and not args.dry_run:
        trigger_site_rebuild(client.base_client, [game["id"]])


if __name__ == "__main__":
    main()
