#!/usr/bin/env python3
"""
Populate developers_links from two sources:

1. GSL cache (gsl_game_data.json) — creator.patreon_url, creator.website,
   creator.discord_url, and SubscribeStar/itch entries in creator.other_urls.
   These cover all AVN developers imported via gsl_import.py.

2. Directus developers.website_url scalar field — migrated as kind=website.

3. Inferred from games.download_url — if a game's download URL is a Patreon page,
   infer the developer's Patreon link from it.

Usage:
    python3 migrate_developers_links.py          # dry run
    python3 migrate_developers_links.py --apply  # write to Directus
"""
import json, re, sys, time, urllib.request, urllib.error
from pathlib import Path
from urllib.parse import urlparse

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


def insert_link(developers_id, url, kind, label=None, existing_set=None):
    key = (developers_id, url)
    if existing_set is not None and key in existing_set:
        return "skip"
    if not APPLY:
        return "dry"
    body = {"developers_id": developers_id, "url": url, "kind": kind}
    if label:
        body["label"] = label
    r = api("POST", "/items/developers_links", body)
    if r and r.get("data"):
        existing_set and existing_set.add(key)
        time.sleep(0.05)
        return "ok"
    return "error"


def parse_other_urls(raw: str) -> list[str]:
    if not raw:
        return []
    return [u.strip() for u in re.split(r"[;\n]+", raw) if u.strip().startswith("http")]


def classify_url(url: str) -> str | None:
    try:
        host = urlparse(url).hostname or ""
    except Exception:
        return None
    host = host.lower()
    if "patreon.com" in host:
        return "patreon"
    if "subscribestar" in host:
        return "subscribestar"
    if host.endswith("itch.io") and host != "itch.io":
        return "itch"
    if host.endswith("itch.io"):
        return "itch"
    return None


# ── Load reference data ──────────────────────────────────────────────────────
print("Loading Directus developers...", file=sys.stderr)
devs = fetch_all("/items/developers?fields=id,name,slug,website_url&limit=-1")
name_lower_to_dev = {d["name"].lower(): d for d in devs}
slug_to_dev = {d["slug"]: d for d in devs}
print(f"  {len(devs)} developers", file=sys.stderr)

print("Loading existing developers_links...", file=sys.stderr)
existing_rows = fetch_all("/items/developers_links?fields=developers_id,url&limit=-1")
existing_set = {(r["developers_id"], r["url"]) for r in existing_rows}
print(f"  {len(existing_set)} existing rows", file=sys.stderr)

print("Loading games (for Patreon inference)...", file=sys.stderr)
games = fetch_all("/items/games?fields=id,title,download_url,gamestorylog_url&limit=-1")
print(f"  {len(games)} games", file=sys.stderr)

gsl_data: dict = {}
gsl_path = CACHE / "gsl_game_data.json"
if gsl_path.exists():
    gsl_data = json.loads(gsl_path.read_text())

stats = {"gsl": 0, "website_url": 0, "inferred": 0, "skip": 0, "error": 0}

# ── Source 1: GSL cache ──────────────────────────────────────────────────────
print(f"\n{'DRY RUN — ' if not APPLY else ''}Source 1: GSL cache", file=sys.stderr)

# Collect all links per creator slug first (deduplicate across multiple games)
creator_links: dict[str, dict] = {}  # creator_slug → {patreon, website, discord, subscribestar, itch...}

for gsl_slug, entry in gsl_data.items():
    if "error" in entry:
        continue
    game = (entry.get("data") or {}).get("game") or {}
    creator = game.get("creator") or {}
    cslug = creator.get("slug", "")
    cname = (creator.get("name") or "").strip()
    if not cslug and not cname:
        continue

    if cslug not in creator_links:
        creator_links[cslug] = {"name": cname, "links": []}

    links = creator_links[cslug]["links"]
    seen_urls = {l["url"] for l in links}

    def maybe_add(url, kind):
        url = (url or "").strip()
        if url and url not in seen_urls:
            links.append({"url": url, "kind": kind})
            seen_urls.add(url)

    maybe_add(creator.get("patreon_url"), "patreon")
    maybe_add(creator.get("website"), "website")
    maybe_add(creator.get("discord_url"), "discord")

    for u in parse_other_urls(creator.get("other_urls") or ""):
        kind = classify_url(u)
        if kind:
            maybe_add(u, kind)

for cslug, data in creator_links.items():
    cname = data["name"]
    dev = slug_to_dev.get(cslug) or name_lower_to_dev.get(cname.lower())
    if not dev:
        print(f"  WARN: no Directus match for creator '{cname}' (slug={cslug})", file=sys.stderr)
        continue

    dev_id = dev["id"]
    for link in data["links"]:
        result = insert_link(dev_id, link["url"], link["kind"], existing_set=existing_set)
        if result in ("ok", "dry"):
            stats["gsl"] += 1
            if not APPLY:
                print(f"  [DRY] dev/{dev_id} ({cname}) {link['kind']}: {link['url'][:80]}", file=sys.stderr)
        elif result == "skip":
            stats["skip"] += 1
        else:
            stats["error"] += 1

# ── Source 2: developers.website_url scalar ──────────────────────────────────
print(f"\n{'DRY RUN — ' if not APPLY else ''}Source 2: developers.website_url", file=sys.stderr)

for dev in devs:
    wu = (dev.get("website_url") or "").strip()
    if not wu:
        continue
    result = insert_link(dev["id"], wu, "website", existing_set=existing_set)
    if result in ("ok", "dry"):
        stats["website_url"] += 1
        if not APPLY:
            print(f"  [DRY] dev/{dev['id']} ({dev['name']}) website: {wu[:80]}", file=sys.stderr)
    elif result == "skip":
        stats["skip"] += 1
    else:
        stats["error"] += 1

# ── Source 3: Infer Patreon from games.download_url ──────────────────────────
print(f"\n{'DRY RUN — ' if not APPLY else ''}Source 3: Patreon inference from games.download_url", file=sys.stderr)

# Build game→developer map via games_developers junction
gd_rows = fetch_all("/items/games_developers?fields=games_id,developers_id&limit=-1")
game_to_devs: dict[int, list[int]] = {}
for row in gd_rows:
    game_to_devs.setdefault(row["games_id"], []).append(row["developers_id"])

for game in games:
    dl = (game.get("download_url") or "").strip()
    if not dl:
        continue
    kind = classify_url(dl)
    if kind not in ("patreon", "subscribestar"):
        continue
    dev_ids = game_to_devs.get(game["id"], [])
    for dev_id in dev_ids:
        result = insert_link(dev_id, dl, kind, existing_set=existing_set)
        if result in ("ok", "dry"):
            stats["inferred"] += 1
            if not APPLY:
                print(f"  [DRY] dev/{dev_id} inferred {kind} from game/{game['id']}: {dl[:80]}", file=sys.stderr)
        elif result == "skip":
            stats["skip"] += 1
        else:
            stats["error"] += 1

print(f"""
Results ({'APPLIED' if APPLY else 'DRY RUN'}):
  from GSL cache:        {stats['gsl']}
  from website_url:      {stats['website_url']}
  inferred from games:   {stats['inferred']}
  skipped (duplicates):  {stats['skip']}
  errors:                {stats['error']}
  total new:             {stats['gsl'] + stats['website_url'] + stats['inferred']}
""", file=sys.stderr)

if not APPLY:
    print("Pass --apply to write.", file=sys.stderr)
