#!/usr/bin/env python3
"""Backfill game_versions from shortcut manifests and complete GSL histories.

Usage: python3 mcp/scripts/backfill_game_versions.py [--dry-run]
The source_key makes reruns safe. All writes use the Directus REST API.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from functools import cache
from pathlib import Path
from typing import Any

from scriptlib import DirectusClient

REPO = Path(__file__).resolve().parents[2]
STEAM_REPO = REPO.parent / "steam-typhoon"
GSL_CACHE_URL = "https://gsl-cache-api.gamestorylog.workers.dev/"
GSL_AUTH = "Bearer sb_publishable_qQv-EBnc_aXnjvQUN3YDpQ_X7IzzLno"
VERSION_RE = re.compile(r"\d+(?:\.\d+){1,3}[a-zA-Z]?\d*")
PLATFORM_RE = re.compile(r"(?i)(?:[-_\s]+)(?:pc|win|windows|linux|public)(?=$|[-_\s/])")
LEGACY_COMPARISON_OVERRIDES = {
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
        "GSL labels the same Out of Touch release as Amber & Gold Part 3 (Ch6269).",
    ),
}


def version_for(directory: str) -> str | None:
    if directory in {"NoTraceOfLuck-v10-win"}:
        return "v10-win"
    if directory == "Out of Touch-Ch6269":
        return "Ch6269"
    cleaned = PLATFORM_RE.sub(" ", directory)
    hits = VERSION_RE.findall(cleaned)
    return hits[-1] if hits else None


@cache
def _version_parser() -> Any:
    module_path = STEAM_REPO / "scripts/avn_version_sync/sync_installed_versions.py"
    spec = importlib.util.spec_from_file_location(
        "avn_installed_version_sync", module_path
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load shared version parser at {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def host_version(host: str, directory: str) -> tuple[str | None, str | None]:
    module = _version_parser()
    curated = module.CURATED_HOST_DIRECTORY_VERSIONS.get((host, directory))
    if curated is None:
        curated = module.CURATED_DIRECTORY_VERSIONS.get(directory)
    return (curated, None) if curated is not None else module.extract_version(directory)


def rows_from_manifest(path: Path) -> list[dict[str, str]]:
    lines = path.read_text(encoding="utf-8").splitlines()
    table = [line for line in lines if line.startswith("|")]
    if not table:
        return []
    header = [part.strip() for part in table[0].strip("|").split("|")]
    result = []
    for line in table[2:]:
        parts = [part.strip() for part in line.strip("|").split("|")]
        if len(parts) != len(header):
            continue
        row = dict(zip(header, parts, strict=True))
        if row.get("Directus Slug") and row.get("Game Directory"):
            result.append(row)
    return result


def stable_key(*parts: str) -> str:
    return hashlib.sha256("\0".join(parts).encode()).hexdigest()


def get_all(
    client: DirectusClient, collection: str, fields: str
) -> list[dict[str, Any]]:
    response = client.request(
        "GET", f"/items/{collection}?fields={urllib.parse.quote(fields)}&limit=-1"
    )
    return response.get("data", [])


def gsl_details(slug: str) -> dict[str, Any]:
    body = json.dumps({"endpoint": "game_details", "params": {"id": slug}}).encode()
    request = urllib.request.Request(
        GSL_CACHE_URL,
        data=body,
        method="POST",
        headers={
            "Authorization": GSL_AUTH,
            "Content-Type": "application/json",
            "Accept": "*/*",
            "Origin": "https://gamestorylog.com",
            "Referer": "https://gamestorylog.com/",
            "User-Agent": "Mozilla/5.0 (compatible; DirectusGameVersionBackfill/1.0)",
        },
    )
    delay = 2
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.loads(response.read()).get("data") or {}
        except urllib.error.HTTPError as error:
            if error.code == 429 and attempt < 4:
                time.sleep(delay)
                delay *= 2
                continue
            raise
    return {}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    client = DirectusClient.from_config()
    games = get_all(
        client, "games", "id,slug,version_orion,version_typhoon,version_gsl"
    )
    games_by_slug = {game["slug"]: game for game in games if game.get("slug")}
    existing = get_all(
        client, "game_versions", "id,source_key,is_current,comparison_override"
    )
    by_key = {row["source_key"]: row for row in existing}
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    planned: dict[str, dict[str, Any]] = {}

    for host in ("orion", "typhoon"):
        manifest = STEAM_REPO / "docs" / f"steam_shortcuts_{host}.md"
        for row in rows_from_manifest(manifest):
            game = games_by_slug.get(row["Directus Slug"])
            if not game:
                continue
            directory = row["Game Directory"]
            version, parse_error = host_version(host, directory)
            installation = f"{host}:{game['id']}:{directory}"
            key = stable_key(host, str(game["id"]), directory, version or "")
            planned[key] = {
                "games_id": game["id"],
                "source": host,
                "source_key": key,
                "reported_version": version,
                "source_reference": directory,
                "installation_key": installation,
                "recorded_at": now,
                "is_current": True,
                "parse_error": parse_error,
            }

    # Retain legacy scalar values that are not represented by an active manifest row.
    for host in ("orion", "typhoon"):
        for game in games:
            value = game.get(f"version_{host}")
            if not value:
                continue
            key = stable_key(host, str(game["id"]), "legacy-scalar", str(value))
            represented = any(
                item["games_id"] == game["id"]
                and item["source"] == host
                and item.get("reported_version") == str(value)
                for item in planned.values()
            )
            if key not in planned and not represented:
                planned[key] = {
                    "games_id": game["id"],
                    "source": host,
                    "source_key": key,
                    "reported_version": str(value),
                    "source_reference": "legacy games.version_" + host,
                    "installation_key": None,
                    "recorded_at": now,
                    "is_current": True,
                    "parse_error": None,
                }

    gsl_games: list[tuple[dict[str, Any], str]] = []
    links = get_all(client, "games_links", "games_id,url,kind")
    game_by_id = {game["id"]: game for game in games}
    for link in links:
        if link.get("kind") != "gamestorylog" or not link.get("url"):
            continue
        game = game_by_id.get(link.get("games_id"))
        path = urllib.parse.urlparse(link["url"]).path.rstrip("/")
        slug = path.rsplit("/", 1)[-1]
        if game and slug:
            gsl_games.append((game, slug))

    for index, (game, slug) in enumerate(gsl_games, start=1):
        details = gsl_details(slug)
        history = details.get("game_versions") or []
        history = [
            item
            for item in history
            if isinstance(item, dict) and str(item.get("version_number") or "").strip()
        ]
        if not history and details.get("current_version"):
            history = [
                {"version_number": details["current_version"], "id": "current_version"}
            ]
        if history:
            history.sort(
                key=lambda item: str(
                    item.get("release_date") or item.get("created_at") or ""
                )
            )
            newest_key = str(history[-1].get("id") or history[-1].get("uuid") or "")
            if not newest_key:
                newest_key = stable_key(
                    str(history[-1].get("release_date") or ""),
                    str(history[-1]["version_number"]),
                )
            for entry in history:
                version_id = str(entry.get("id") or entry.get("uuid") or "")
                if not version_id:
                    version_id = stable_key(
                        str(entry.get("release_date") or ""),
                        str(entry["version_number"]),
                    )
                key = stable_key("gsl", str(game["id"]), version_id)
                payload = {
                    "games_id": game["id"],
                    "source": "gsl",
                    "source_key": key,
                    "reported_version": str(entry["version_number"]),
                    "source_reference": version_id,
                    "installation_key": None,
                    "release_date": entry.get("release_date") or None,
                    "recorded_at": now,
                    "is_current": version_id == newest_key,
                    "parse_error": None,
                }
                if (
                    version_id == newest_key
                    and game.get("slug") in LEGACY_COMPARISON_OVERRIDES
                ):
                    raw, comparison, reason = LEGACY_COMPARISON_OVERRIDES[game["slug"]]
                    if str(entry["version_number"]).casefold() == raw.casefold():
                        payload["comparison_override"] = comparison
                        payload["override_reason"] = reason
                planned[key] = payload
        if index % 20 == 0:
            print(f"Read GSL histories: {index}/{len(gsl_games)}", file=sys.stderr)
        time.sleep(1.5)

    creates = [row for key, row in planned.items() if key not in by_key]
    patches: list[tuple[int, dict[str, Any]]] = []
    for key, payload in planned.items():
        previous = by_key.get(key)
        if previous:
            patch = {}
            for field in ("is_current", "comparison_override", "override_reason"):
                if field in payload and previous.get(field) != payload[field]:
                    patch[field] = payload[field]
            if patch:
                patches.append((previous["id"], patch))
    # Deactivate disappeared host installs and older GSL rows only after complete data is loaded.
    for row in existing:
        if row.get("source_key") not in planned and row.get("is_current"):
            # Historical rows are intentionally retained; host removals will be handled by daily sync.
            continue
    print(
        f"Plan: {len(creates)} creates; {len(patches)} current-state updates; {len(gsl_games)} GSL games; dry_run={args.dry_run}"
    )
    if args.dry_run:
        return 0
    for row in creates:
        client.request("POST", "/items/game_versions", row)
    for row_id, patch in patches:
        client.request("PATCH", f"/items/game_versions/{row_id}", patch)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
