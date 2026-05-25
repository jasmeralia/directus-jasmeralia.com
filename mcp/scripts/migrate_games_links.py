#!/usr/bin/env python3
"""
Migrate games.download_url and games.walkthrough_url into the games_links junction table.
Also enriches GSL-sourced games with additional URLs from the GSL cache
(itch.io, SubscribeStar, etc. stored in game.other_urls).

Usage:
    python3 migrate_games_links.py          # dry run
    python3 migrate_games_links.py --apply  # write to Directus
"""
import json, re, sys, time, urllib.request, urllib.error
from pathlib import Path

CACHE = Path(__file__).parent.parent / "cache"
_mcp = json.load(open(Path(__file__).parent.parent.parent / ".mcp.json"))
TOKEN = _mcp["mcpServers"]["directus"]["env"]["DIRECTUS_TOKEN"]
BASE = "https://directus.jasmer.tools"
APPLY = "--apply" in sys.argv


def api(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{BASE}{path}", data=data, method=method, headers={
        "Authorization": f"Bearer {TOKEN}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read()) if r.length else {}
    except urllib.error.HTTPError as e:
        print(f"  ERROR {e.code} {method} {path}: {e.read().decode()[:300]}", file=sys.stderr)
        return None


def fetch_all(path):
    r = api("GET", path)
    return r.get("data", []) if r else []


def insert_link(games_id, url, kind, label=None, sort=None, existing_set=None):
    key = (games_id, url)
    if existing_set is not None and key in existing_set:
        return "skip"
    if not APPLY:
        return "dry"
    body = {"games_id": games_id, "url": url, "kind": kind}
    if label:
        body["label"] = label
    if sort is not None:
        body["sort"] = sort
    r = api("POST", "/items/games_links", body)
    if r and r.get("data"):
        existing_set and existing_set.add(key)
        return "ok"
    return "error"


# ── Load existing games_links to avoid duplicates ───────────────────────────
print("Loading existing games_links...", file=sys.stderr)
existing_rows = fetch_all("/items/games_links?fields=games_id,url&limit=-1")
existing_set = {(r["games_id"], r["url"]) for r in existing_rows}
print(f"  {len(existing_set)} existing rows", file=sys.stderr)

# ── Load all games with download/walkthrough URLs ────────────────────────────
print("Loading games...", file=sys.stderr)
games = fetch_all(
    "/items/games?fields=id,title,slug,download_url,walkthrough_url,gamestorylog_url&limit=-1"
)
print(f"  {len(games)} games total", file=sys.stderr)

# ── Load GSL cache for supplemental URLs ────────────────────────────────────
gsl_data: dict = {}
gsl_path = CACHE / "gsl_game_data.json"
if gsl_path.exists():
    gsl_data = json.loads(gsl_path.read_text())

gsl_url_to_entry: dict[str, dict] = {}
for slug, entry in gsl_data.items():
    if "error" in entry:
        continue
    game = (entry.get("data") or {}).get("game") or {}
    gsl_url = f"https://gamestorylog.com/games/{slug}"
    gsl_url_to_entry[gsl_url] = game


def parse_other_urls(raw: str) -> list[str]:
    if not raw:
        return []
    urls = []
    for u in re.split(r"[;\n,\s]+", raw):
        u = u.strip()
        if u.startswith("http"):
            urls.append(u)
    return urls


def classify_url(url: str) -> str | None:
    """Return kind hint or None if unrecognised."""
    try:
        host = __import__("urllib.parse", fromlist=["urlparse"]).urlparse(url).hostname or ""
    except Exception:
        return None
    host = host.lower()
    if "steampowered.com" in host or "steamcommunity.com" in host:
        return "steam"
    if host.endswith("itch.io"):
        return "itch"
    if "patreon.com" in host:
        return "patreon"
    if "subscribestar" in host:
        return "subscribestar"
    if "gog.com" in host:
        return "gog"
    return None


SKIP_AS_DOWNLOAD = {"patreon.com", "subscribestar"}  # these belong in developers_links; skip as game download supplemental


stats = {"download": 0, "walkthrough": 0, "extra": 0, "skip": 0, "error": 0}

print(f"\n{'DRY RUN — ' if not APPLY else ''}Migrating...", file=sys.stderr)

for game in games:
    gid = game["id"]

    # download_url → kind=download
    dl = (game.get("download_url") or "").strip()
    if dl:
        result = insert_link(gid, dl, "download", sort=1, existing_set=existing_set)
        if result in ("ok", "dry"):
            stats["download"] += 1
            if not APPLY:
                print(f"  [DRY] games/{gid} download: {dl[:80]}", file=sys.stderr)
        elif result == "skip":
            stats["skip"] += 1
        else:
            stats["error"] += 1

    # walkthrough_url → kind=walkthrough
    wt = (game.get("walkthrough_url") or "").strip()
    if wt:
        result = insert_link(gid, wt, "walkthrough", sort=1, existing_set=existing_set)
        if result in ("ok", "dry"):
            stats["walkthrough"] += 1
            if not APPLY:
                print(f"  [DRY] games/{gid} walkthrough: {wt[:80]}", file=sys.stderr)
        elif result == "skip":
            stats["skip"] += 1
        else:
            stats["error"] += 1

    # GSL supplemental URLs from game.other_urls
    gsl_url = (game.get("gamestorylog_url") or "").strip()
    if gsl_url and gsl_url in gsl_url_to_entry:
        gsl_game = gsl_url_to_entry[gsl_url]
        extra_urls = parse_other_urls(gsl_game.get("other_urls") or "")
        sort_idx = 2
        for url in extra_urls:
            kind_hint = classify_url(url)
            # Skip Patreon/SubscribeStar from games_links — those go in developers_links
            if kind_hint in ("patreon", "subscribestar"):
                continue
            # Skip if it's the same as the primary download URL
            if url == dl:
                continue
            result = insert_link(gid, url, "download", sort=sort_idx, existing_set=existing_set)
            if result in ("ok", "dry"):
                stats["extra"] += 1
                sort_idx += 1
                if not APPLY:
                    print(f"  [DRY] games/{gid} extra ({kind_hint or '?'}): {url[:80]}", file=sys.stderr)
            elif result == "skip":
                stats["skip"] += 1
            else:
                stats["error"] += 1
        if APPLY:
            time.sleep(0.05)

print(f"""
Results ({'APPLIED' if APPLY else 'DRY RUN'}):
  download links: {stats['download']}
  walkthrough links: {stats['walkthrough']}
  extra (GSL other_urls): {stats['extra']}
  skipped (already exist): {stats['skip']}
  errors: {stats['error']}
""", file=sys.stderr)

if not APPLY:
    print("Pass --apply to write.", file=sys.stderr)
