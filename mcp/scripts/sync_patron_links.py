#!/usr/bin/env python3
"""
Keep developer and game Patreon/SubscribeStar links in sync, in both directions.

1. Developer -> games: every Patreon/SubscribeStar link on a developer
   (developers_links) is added to each of that developer's games as a
   games_links row with kind="download" (the site's convention for Patreon and
   SubscribeStar release pages).

2. Game -> developers: every creator-level Patreon/SubscribeStar download link
   on a game is added to that game's developers as developers_links. Per-post
   URLs (patreon.com/posts/..., subscribestar.com/posts/...) are not creator
   pages and are never propagated up. A developer that already has a link of
   the same kind pointing at a different creator is reported as a conflict and
   left untouched.

Links are compared by (kind, creator name), not exact URL, so
https://www.patreon.com/cw/jdor/posts and https://patreon.com/jdor match.

Usage:
    python3 sync_patron_links.py            # dry run (read-only)
    python3 sync_patron_links.py --apply    # write, then rebuild site
"""

import argparse
import re
import sys
from collections import defaultdict
from urllib.parse import parse_qs, urlparse

from scriptlib import DirectusClient, trigger_site_rebuild

PATRON_KINDS = ("patreon", "subscribestar")
# Leading path segments that are routing prefixes, not the creator name.
PATREON_PREFIXES = {"c", "cw", "join"}
NON_CREATOR_SEGMENTS = {"posts", "file", "collection", "home", "login", "m"}
CREATOR_KEY = re.compile(r"^[\w.-]+$")


def patron_identity(url: str) -> tuple[str, str] | None:
    """Return (kind, creator key) for a creator-level Patreon/SubscribeStar URL.

    Returns None for other hosts and for per-post/non-creator URLs.
    """
    try:
        parsed = urlparse((url or "").strip())
    except ValueError:
        return None
    host = (parsed.hostname or "").lower().removeprefix("www.")
    segments = [s for s in parsed.path.split("/") if s]
    if host == "patreon.com" or host.endswith(".patreon.com"):
        kind = "patreon"
        if segments and segments[0].lower() in PATREON_PREFIXES:
            segments = segments[1:]
        if segments and segments[0].lower() == "user":
            user_id = parse_qs(parsed.query).get("u", [""])[0]
            return (kind, f"user:{user_id}") if user_id else None
    elif host.startswith("subscribestar."):
        kind = "subscribestar"
    else:
        return None
    if not segments or segments[0].lower() in NON_CREATOR_SEGMENTS:
        return None
    if not CREATOR_KEY.match(segments[0]):
        return None
    return kind, segments[0].lower()


def clean_url(url: str) -> str:
    """Strip tracking query strings, fragments, and trailing slashes.

    Patreon's ?u=<id> user URLs keep their query since it is the creator ID.
    """
    parsed = urlparse(url.strip())
    query = ""
    if parsed.path.rstrip("/").endswith("/user"):
        user_id = parse_qs(parsed.query).get("u", [""])[0]
        query = f"?u={user_id}" if user_id else ""
    return f"https://{parsed.netloc}{parsed.path.rstrip('/')}{query}"


def fetch_all(client: DirectusClient, collection: str, fields: str) -> list[dict]:
    """Fetch every row of a collection through the REST API."""
    response = client.get(f"/items/{collection}", {"fields": fields, "limit": -1})
    return response.get("data", [])


def load_state(client: DirectusClient) -> dict:
    """Load everything the sync needs, with one request per collection."""
    games = {
        g["id"]: g
        for g in fetch_all(client, "games", "id,title,player_status,game_status")
    }
    developers = {d["id"]: d for d in fetch_all(client, "developers", "id,name")}
    game_to_devs: dict[int, list[int]] = defaultdict(list)
    dev_to_games: dict[int, list[int]] = defaultdict(list)
    for row in fetch_all(client, "games_developers", "games_id,developers_id"):
        if row["games_id"] in games and row["developers_id"] in developers:
            game_to_devs[row["games_id"]].append(row["developers_id"])
            dev_to_games[row["developers_id"]].append(row["games_id"])
    game_links: dict[int, list[dict]] = defaultdict(list)
    for row in fetch_all(client, "games_links", "games_id,url,kind,sort"):
        game_links[row["games_id"]].append(row)
    dev_links: dict[int, list[dict]] = defaultdict(list)
    for row in fetch_all(client, "developers_links", "developers_id,url,kind"):
        dev_links[row["developers_id"]].append(row)
    return {
        "games": games,
        "developers": developers,
        "game_to_devs": game_to_devs,
        "dev_to_games": dev_to_games,
        "game_links": game_links,
        "dev_links": dev_links,
    }


def plan_dev_to_games(state: dict) -> list[dict]:
    """Plan games_links rows for developer patron links missing on their games."""
    plan = []
    planned: set[tuple[int, tuple[str, str]]] = set()
    for dev_id, links in state["dev_links"].items():
        dev_name = (
            state["developers"][dev_id]["name"]
            if dev_id in state["developers"]
            else None
        )
        if dev_name is None:
            continue
        for link in links:
            identity = patron_identity(link["url"])
            if identity is None or identity[0] not in PATRON_KINDS:
                continue
            for game_id in state["dev_to_games"].get(dev_id, []):
                existing = state["game_links"].get(game_id, [])
                if (game_id, identity) in planned or any(
                    patron_identity(row["url"]) == identity for row in existing
                ):
                    continue
                planned.add((game_id, identity))
                plan.append(
                    {
                        "games_id": game_id,
                        "title": state["games"][game_id]["title"],
                        "developer": dev_name,
                        "url": clean_url(link["url"]),
                        "sort": max((r.get("sort") or 0 for r in existing), default=0)
                        + 1,
                    }
                )
    return plan


def plan_games_to_devs(state: dict) -> tuple[list[dict], list[dict]]:
    """Plan developers_links rows from game patron links; also return conflicts."""
    plan: dict[tuple[int, str], dict] = {}
    conflicts = []
    for game_id, links in state["game_links"].items():
        if game_id not in state["games"]:
            continue
        for link in links:
            identity = patron_identity(link["url"])
            if identity is None or link["kind"] != "download":
                continue
            kind = identity[0]
            for dev_id in state["game_to_devs"].get(game_id, []):
                existing = state["dev_links"].get(dev_id, [])
                same_kind = [r for r in existing if r["kind"] == kind]
                if any(patron_identity(r["url"]) == identity for r in same_kind):
                    continue
                entry = {
                    "developers_id": dev_id,
                    "developer": state["developers"][dev_id]["name"],
                    "title": state["games"][game_id]["title"],
                    "games_id": game_id,
                    "url": clean_url(link["url"]),
                    "kind": kind,
                }
                if same_kind:
                    conflicts.append({**entry, "existing": same_kind[0]["url"]})
                else:
                    plan.setdefault((dev_id, identity[1]), entry)
    return list(plan.values()), conflicts


def find_malformed(state: dict) -> list[str]:
    """List patron-host links that parse as no creator page and no post URL."""
    bad = []
    for game_id, links in state["game_links"].items():
        for link in links:
            host = (urlparse(link["url"]).hostname or "").lower()
            is_patron_host = "patreon.com" in host or "subscribestar." in host
            is_post = "/posts/" in link["url"] or "/file" in link["url"]
            if is_patron_host and not is_post and patron_identity(link["url"]) is None:
                bad.append(f"game/{game_id} {link['kind']}: {link['url']}")
    return bad


def report(to_games: list[dict], to_devs: list[dict], conflicts: list[dict]) -> None:
    """Print the planned changes to stderr."""
    print(f"\nDeveloper -> games: {len(to_games)} games_links to add", file=sys.stderr)
    for row in to_games:
        print(
            f"  game/{row['games_id']} {row['title']!r} <- {row['developer']}: "
            f"{row['url']}",
            file=sys.stderr,
        )
    print(
        f"\nGame -> developers: {len(to_devs)} developers_links to add", file=sys.stderr
    )
    for row in to_devs:
        print(
            f"  dev/{row['developers_id']} {row['developer']} <- {row['kind']} "
            f"from game/{row['games_id']} {row['title']!r}: {row['url']}",
            file=sys.stderr,
        )
    print(f"\nConflicts (skipped): {len(conflicts)}", file=sys.stderr)
    for row in conflicts:
        print(
            f"  dev/{row['developers_id']} {row['developer']} already has "
            f"{row['existing']} but game/{row['games_id']} {row['title']!r} "
            f"links {row['url']}",
            file=sys.stderr,
        )


def apply_changes(
    client: DirectusClient, to_games: list[dict], to_devs: list[dict]
) -> int:
    """Write the planned rows through the Directus API. Returns the error count."""
    errors = 0
    for row in to_games:
        body = {
            "games_id": row["games_id"],
            "url": row["url"],
            "kind": "download",
            "sort": row["sort"],
        }
        if not client.request_or_none("POST", "/items/games_links", body):
            errors += 1
    for row in to_devs:
        body = {
            "developers_id": row["developers_id"],
            "url": row["url"],
            "kind": row["kind"],
        }
        if not client.request_or_none("POST", "/items/developers_links", body):
            errors += 1
    return errors


def main() -> int:
    """Plan the sync and, with --apply, write and rebuild."""
    parser = argparse.ArgumentParser(description=__doc__.split("\n", maxsplit=1)[0])
    parser.add_argument("--apply", action="store_true", help="write to Directus")
    args = parser.parse_args()

    client = DirectusClient.from_config()
    print("Loading Directus data...", file=sys.stderr)
    state = load_state(client)
    to_devs, conflicts = plan_games_to_devs(state)
    # Plan developer -> games against the post-sync developer links, so one run
    # reaches the fixed point instead of needing a second pass.
    for row in to_devs:
        state["dev_links"][row["developers_id"]].append(
            {
                "developers_id": row["developers_id"],
                "url": row["url"],
                "kind": row["kind"],
            }
        )
    to_games = plan_dev_to_games(state)
    report(to_games, to_devs, conflicts)
    print("\nUnrecognised patron-host game links (ignored):", file=sys.stderr)
    for line in find_malformed(state):
        print(f"  {line}", file=sys.stderr)

    if not args.apply:
        print("\nDry run. Pass --apply to write.", file=sys.stderr)
        return 0
    if not to_games and not to_devs:
        print("\nNothing to do.", file=sys.stderr)
        return 0

    errors = apply_changes(client, to_games, to_devs)
    touched = {row["games_id"] for row in to_games}
    for row in to_devs:
        touched.update(state["dev_to_games"].get(row["developers_id"], []))
    if touched:
        trigger_site_rebuild(client, sorted(touched))
    print(f"\nApplied with {errors} error(s).", file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
