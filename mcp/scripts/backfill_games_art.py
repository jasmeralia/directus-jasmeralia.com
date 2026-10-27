#!/usr/bin/env python3
"""Backfill the games_art collection for existing games.

games_art holds one row per (game, kind, language) for the artwork kinds the
site and Steam Deck workflow use: capsule (portrait), wide_capsule, hero, logo
and icon. Steps run in this order and are idempotent: an existing
(game, kind, language) row is never replaced, so a manual Directus edit sticks.

  steam   For games with a Steam download link, import wide_capsule, hero,
          logo, icon, and (when a game has none yet) capsule from Steam. The 2x
          asset is preferred over 1x. Wide capsule, hero and logo come from the
          app's PICS record (common.library_assets_full: library_header,
          library_hero, library_logo), whose per-language keys separate localized
          assets from unlocalized (`english`) ones; the Store API's
          IStoreBrowseService fills in the rest (icon, capsule, and a wide
          capsule or hero PICS lacks), and the unhashed logo probe is the last
          resort for a logo. PICS needs the `steam` package, so run this step as
          `uv run --with 'steam[client]' python backfill_games_art.py ...`.
  renpy   Give Ren'Py games with no logo or icon the default Ren'Py logo and
          icon (uploaded once from --renpy-logo / --renpy-icon).

Usage:
    python3 backfill_games_art.py                          # dry run, all steps
    python3 backfill_games_art.py --apply
    python3 backfill_games_art.py --steps steam --slug some-game --apply
    python3 backfill_games_art.py \\
        --manifest ~/git/steam-typhoon/docs/steam_shortcuts_typhoon.md \\
        --manifest ~/git/steam-typhoon/docs/steam_shortcuts_orion.md   # manifest games only
    python3 backfill_games_art.py --language fr            # localized Steam art
    python3 backfill_games_art.py --steps steam --replace-renpy-logos --apply
    python3 backfill_games_art.py --renpy-logo PATH --renpy-icon PATH --apply

--slug and --manifest (a steam_shortcuts_*.md file; every Directus Slug in it) limit
the run to those games; with neither, every game is processed.

--replace-renpy-logos is the one exception to "never replaced": a logo row that
still points at the shared Ren'Py default logo file is repointed at the game's
real Steam logo when Steam has one. Any other existing row is left alone.

Steam lookups are cached in mcp/cache/games_art_steam.json (Store API, logo
probe) and games_art_pics.json (PICS), so --apply reuses what the dry run fetched. No site rebuild is triggered.
"""

import argparse
import sys
import time
import urllib.error
import uuid
from collections import Counter
from pathlib import Path
from typing import Any

from scriptlib import (
    CACHE_DIR,
    DirectusClient,
    ProgressCache,
    RetryingDirectusClient,
)
from steamlib import (
    STEAM_LANGUAGES,
    SteamArtCandidate,
    extract_steam_appid_from_links,
    fetch_steam_library_assets,
    fetch_steam_store_assets,
    library_art_candidates,
    steam_art_candidates,
    steam_logo_candidate,
)

ART_NAMESPACE = uuid.UUID("5b0a1c9e-3f7d-4e8a-9c21-6d4f8a2b7e10")
STEAM_BATCH_SIZE = 25
STEAM_DELAY_S = 1.5
RENPY_ENGINE_SLUG = "ren-py"
RENPY_DEFAULT_TITLES = {
    "logo": "Ren'Py default logo",
    "icon": "Ren'Py default icon",
}
STEPS = ("steam", "renpy")
GAME_FIELDS = (
    "id,title,slug,engines.engines_id.slug,"
    "links.url,links.kind,art.id,art.kind,art.language,art.file,art.source_url"
)

Key = tuple[int, str, str]


class ArtWriter:
    """Creates games_art rows (or plans them in a dry run) and tracks counts."""

    def __init__(
        self, client: RetryingDirectusClient, existing: set[Key], apply: bool
    ) -> None:
        self.client = client
        self.apply = apply
        self.known = set(existing)
        self.counts: Counter[str] = Counter()

    def has(self, game_id: int, kind: str, language: str) -> bool:
        """Return whether a row already exists or was created this run."""
        return (game_id, kind, language) in self.known

    def add(self, row: dict[str, Any], label: str, step: str) -> bool:
        """Create one games_art row; returns False when it already exists."""
        key = (row["games_id"], row["kind"], row["language"])
        if key in self.known:
            self.counts[f"{step}:exists"] += 1
            return False
        verb = "CREATE" if self.apply else "PLAN"
        print(f"  {verb} {row['kind']:<12} {row['scale']} {row['language']}  {label}")
        if self.apply:
            self.client.post(
                "/items/games_art",
                row,
                description=f"create games_art {row['kind']} for game {row['games_id']}",
            )
        self.known.add(key)
        self.counts[f"{step}:{row['kind']}"] += 1
        return True

    def replace(self, row_id: int, row: dict[str, Any], label: str, step: str) -> None:
        """Repoint an existing games_art row at a new file."""
        verb = "REPLACE" if self.apply else "PLAN REPLACE"
        print(f"  {verb} {row['kind']:<12} {row['scale']} {row['language']}  {label}")
        if self.apply:
            self.client.patch(
                f"/items/games_art/{row_id}",
                {k: row[k] for k in ("file", "scale", "source_url")},
                description=f"replace games_art {row['kind']} row {row_id}",
            )
        self.counts[f"{step}:{row['kind']}_replaced"] += 1


def manifest_slugs(paths: list[Path]) -> list[str]:
    """Return the Directus slugs listed in steam_shortcuts_*.md manifests."""
    slugs: set[str] = set()
    for path in paths:
        column: int | None = None
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip().startswith("|"):
                continue
            cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
            if column is None:
                if "Directus Slug" in cells:
                    column = cells.index("Directus Slug")
                continue
            if cells[0].startswith("-") or len(cells) <= column:
                continue
            if cells[column]:
                slugs.add(cells[column])
        if column is None:
            raise SystemExit(f"{path}: no 'Directus Slug' column found")
    return sorted(slugs)


def fetch_games(client: RetryingDirectusClient, slugs: list[str]) -> list[dict]:
    """Fetch games with their links, engines and existing art keys."""
    path = f"/items/games?fields={GAME_FIELDS}&sort=id"
    if slugs:
        path += f"&filter[slug][_in]={','.join(slugs)}"
    return client.fetch_all(path, description="fetch games for art backfill")


def existing_art_keys(games: list[dict]) -> set[Key]:
    """Return the (game, kind, language) keys of rows that already exist."""
    return {
        (game["id"], art["kind"], art["language"])
        for game in games
        for art in game.get("art") or []
    }


def import_remote_image(
    client: RetryingDirectusClient, candidate: SteamArtCandidate, appid: int, title: str
) -> str | None:
    """Import a Steam image into Directus under a deterministic file ID."""
    file_id = str(
        uuid.uuid5(ART_NAMESPACE, f"steam:{appid}:{candidate.kind}:{candidate.url}")
    )
    extension = candidate.url.rsplit(".", 1)[-1].split("?")[0]
    try:
        client.post(
            "/files/import",
            {
                "url": candidate.url,
                "data": {
                    "id": file_id,
                    "title": f"{title} {candidate.kind} {appid}",
                    "filename_download": f"{appid}_{candidate.kind}.{extension}",
                },
            },
            description=f"import Steam {candidate.kind} for app {appid}",
        )
    except urllib.error.HTTPError as error:
        body = error.read().decode(errors="replace")
        if '"RECORD_NOT_UNIQUE"' in body or error.code == 409:
            return file_id
        print(f"    import failed (HTTP {error.code}): {body[:120]}", file=sys.stderr)
        return None
    return file_id


def lookup_steam_assets(
    appids: list[int], steam_language: str, cache: ProgressCache
) -> None:
    """Fill the cache with Store asset names for every uncached app."""
    pending = [a for a in appids if f"{a}|{steam_language}" not in cache]
    for start in range(0, len(pending), STEAM_BATCH_SIZE):
        batch = pending[start : start + STEAM_BATCH_SIZE]
        print(
            f"  Steam asset lookup {start + len(batch)}/{len(pending)}",
            file=sys.stderr,
        )
        found, err = fetch_steam_store_assets(batch, steam_language)
        if err:
            print(
                f"  Steam lookup failed ({err}); batch left uncached", file=sys.stderr
            )
        else:
            for appid, entry in found.items():
                cache.set(f"{appid}|{steam_language}", entry)
        time.sleep(STEAM_DELAY_S)
    cache.flush()


def lookup_library_assets(appids: list[int], cache: ProgressCache) -> None:
    """Fill the cache with PICS library_assets_full for every uncached app."""
    pending = [a for a in appids if f"{a}|pics" not in cache]
    if not pending:
        return
    print(f"  PICS asset lookup for {len(pending)} apps", file=sys.stderr)
    for appid, assets in fetch_steam_library_assets(pending).items():
        cache.set(f"{appid}|pics", assets)
    cache.flush()


def renpy_logo_rows(
    games: list[dict], default_file: str | None
) -> dict[tuple[int, str], int]:
    """Map (game, language) of logo rows still on the Ren'Py default to row ids."""
    if not default_file:
        return {}
    return {
        (game["id"], art["language"]): art["id"]
        for game in games
        for art in game.get("art") or []
        if art["kind"] == "logo"
        and art.get("file") == default_file
        and not art.get("source_url")
    }


def steam_row_language(candidate: SteamArtCandidate, language: str) -> str:
    """Tag a localized variant with the requested language, else English."""
    return language if candidate.localized else "en"


def backfill_steam(  # pylint: disable=too-many-locals
    writer: ArtWriter,
    games: list[dict],
    language: str,
    limit: int | None,
    replaceable_logos: dict[tuple[int, str], int],
) -> None:
    """Import Steam wide capsule, hero, logo, icon, and any missing capsule."""
    print("== steam: wide_capsule, hero, logo, icon (+ missing capsule)")
    steam_language = STEAM_LANGUAGES[language]
    targets = [
        (game, appid)
        for game in games
        if (appid := extract_steam_appid_from_links(game.get("links"))) is not None
    ]
    if limit is not None:
        targets = targets[:limit]
    print(f"  {len(targets)} games with a Steam download link")
    cache = ProgressCache(CACHE_DIR / "games_art_steam.json")
    lookup_steam_assets([appid for _, appid in targets], steam_language, cache)
    pics_cache = ProgressCache(CACHE_DIR / "games_art_pics.json")
    lookup_library_assets([appid for _, appid in targets], pics_cache)

    for game, appid in targets:
        entry = cache.get(f"{appid}|{steam_language}")
        library = pics_cache.get(f"{appid}|pics") or {}
        if not entry and not library:
            writer.counts["steam:no_assets"] += 1
            continue
        # PICS library assets win; the Store API fills the kinds they lack.
        by_kind = {
            c.kind: c for c in library_art_candidates(appid, library, steam_language)
        }
        for candidate in steam_art_candidates(appid, entry) if entry else []:
            by_kind.setdefault(candidate.kind, candidate)
        if "logo" not in by_kind and not writer.has(game["id"], "logo", "en"):
            logo = cached_logo(cache, appid)
            if logo:
                by_kind["logo"] = SteamArtCandidate(**logo)
        for candidate in by_kind.values():
            row_language = steam_row_language(candidate, language)
            replace_id = (
                replaceable_logos.get((game["id"], row_language))
                if candidate.kind == "logo"
                else None
            )
            if replace_id is None and writer.has(
                game["id"], candidate.kind, row_language
            ):
                writer.counts["steam:exists"] += 1
                continue
            file_id = (
                import_remote_image(writer.client, candidate, appid, game["title"])
                if writer.apply
                else f"(would import {candidate.url.rsplit('/', 1)[-1]})"
            )
            if file_id is None:
                writer.counts["steam:import_failed"] += 1
                continue
            row = {
                "games_id": game["id"],
                "kind": candidate.kind,
                "file": file_id,
                "language": row_language,
                "scale": candidate.scale,
                "source_url": candidate.url[:255],
            }
            if replace_id is not None:
                writer.replace(replace_id, row, game["slug"], "steam")
            else:
                writer.add(row, game["slug"], "steam")
    cache.flush()


def cached_logo(cache: ProgressCache, appid: int) -> dict[str, Any] | None:
    """Probe (once) for an app's Steam logo; the cache stores None for no logo."""
    key = f"{appid}|logo"
    if key not in cache:
        candidate = steam_logo_candidate(appid)
        cache.set(key, None if candidate is None else candidate.__dict__)
        time.sleep(STEAM_DELAY_S)  # the probes hit Steam's CDN; keep >=1s between apps
    return cache.get(key)


def renpy_default_file(
    base: DirectusClient,
    client: RetryingDirectusClient,
    kind: str,
    source: Path | None,
    apply: bool,
) -> str | None:
    """Find (or upload, with --apply) the shared default Ren'Py logo/icon file."""
    title = RENPY_DEFAULT_TITLES[kind]
    response = client.get(
        "/files",
        params={"filter[title][_eq]": title, "fields": "id", "limit": 1},
        description=f"look up {title}",
    )
    if response.get("data"):
        return response["data"][0]["id"]
    if source is None:
        print(f"  No {title!r} file in Directus and no --renpy-{kind} given; skipping")
        return None
    if not apply:
        return f"(would upload {source.name})"
    return base.upload_file(
        source.read_bytes(), f"renpy_default_{kind}.png", "image/png", title
    )


def backfill_renpy(
    writer: ArtWriter,
    games: list[dict],
    base: DirectusClient,
    sources: dict[str, Path | None],
) -> None:
    """Give Ren'Py games lacking a logo or icon the shared default images."""
    print("== renpy: default logo and icon")
    files = {
        kind: renpy_default_file(base, writer.client, kind, path, writer.apply)
        for kind, path in sources.items()
    }
    for game in games:
        slugs = {
            (engine.get("engines_id") or {}).get("slug")
            for engine in game.get("engines") or []
        }
        if RENPY_ENGINE_SLUG not in slugs:
            continue
        for kind, file_id in files.items():
            if file_id:
                writer.add(
                    {
                        "games_id": game["id"],
                        "kind": kind,
                        "file": file_id,
                        "language": "en",
                        "scale": "1x",
                        "source_url": None,
                    },
                    game["slug"],
                    "renpy",
                )


def parse_args() -> argparse.Namespace:
    """Parse command-line options."""
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", maxsplit=1)[0])
    parser.add_argument("--apply", action="store_true", help="write (default: dry run)")
    parser.add_argument(
        "--steps",
        default=",".join(STEPS),
        help=f"comma-separated subset of {', '.join(STEPS)} (default: all)",
    )
    parser.add_argument(
        "--language",
        default="en",
        choices=sorted(STEAM_LANGUAGES),
        help="Steam asset language (default: en)",
    )
    parser.add_argument(
        "--slug", action="append", default=[], help="limit to a game slug"
    )
    parser.add_argument(
        "--manifest",
        action="append",
        default=[],
        type=Path,
        help="limit to the Directus slugs in a steam_shortcuts_*.md manifest (repeatable)",
    )
    parser.add_argument("--limit", type=int, help="limit the Steam step to N games")
    parser.add_argument(
        "--replace-renpy-logos",
        action="store_true",
        help="repoint logo rows still on the Ren'Py default at the game's Steam logo",
    )
    parser.add_argument("--renpy-logo", type=Path, help="default Ren'Py logo image")
    parser.add_argument("--renpy-icon", type=Path, help="default Ren'Py icon image")
    args = parser.parse_args()
    args.steps = [step.strip() for step in args.steps.split(",") if step.strip()]
    unknown = sorted(set(args.steps) - set(STEPS))
    if unknown:
        parser.error(f"unknown step(s): {', '.join(unknown)}")
    return args


def main() -> None:
    """Run the selected backfill steps."""
    args = parse_args()
    base = DirectusClient.from_config()
    client = RetryingDirectusClient(base)
    wanted = sorted(
        {*args.slug, *manifest_slugs([p.expanduser() for p in args.manifest])}
    )
    games = fetch_games(client, wanted)
    for slug in sorted(set(wanted) - {game["slug"] for game in games}):
        print(f"NOT FOUND in Directus: {slug}", file=sys.stderr)
    print(("Mode: APPLY" if args.apply else "Mode: DRY RUN") + f" ({len(games)} games)")
    writer = ArtWriter(client, existing_art_keys(games), args.apply)

    if "steam" in args.steps:
        default_logo = (
            renpy_default_file(base, client, "logo", None, False)
            if args.replace_renpy_logos
            else None
        )
        backfill_steam(
            writer,
            games,
            args.language,
            args.limit,
            renpy_logo_rows(games, default_logo),
        )
    if "renpy" in args.steps:
        backfill_renpy(
            writer,
            games,
            base,
            {"logo": args.renpy_logo, "icon": args.renpy_icon},
        )

    print("== summary" + ("" if args.apply else " (dry run: nothing written)"))
    for key, count in sorted(writer.counts.items()):
        print(f"  {key}: {count}")
    missing = {
        kind: sum(1 for game in games if not writer.has(game["id"], kind, "en"))
        for kind in ("capsule", "wide_capsule", "hero", "logo", "icon")
    }
    print(
        "  games still without an en row: "
        + ", ".join(f"{k}={v}" for k, v in missing.items())
    )


if __name__ == "__main__":
    main()
