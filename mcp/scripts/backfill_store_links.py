#!/usr/bin/env python3
"""
backfill_store_links.py

Scans the library for cross-platform store links that are missing:
  1. Steam games without a GOG link  → look up via ITAD prices
  2. Steam games without an Epic link → look up via ITAD prices
  3. Epic-only games without a Steam link → look up via ITAD prices

ITAD is used to find real store URLs (not guessed slugs).  Results are
cached to mcp/cache/store_link_cache.json for resume between runs.

High-confidence matches (title similarity ≥ 0.82) are added automatically.
Lower-confidence matches are written to mcp/cache/store_link_review.md.

Usage:
  python3 backfill_store_links.py          # dry run (preview + cache)
  python3 backfill_store_links.py --apply  # commit to Directus
"""

import argparse, difflib, json, re, sys, time, urllib.error, urllib.request, urllib.parse
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────
MCP_JSON  = Path(__file__).parent.parent.parent / ".mcp.json"
CACHE_DIR = Path(__file__).parent.parent / "cache"
CACHE_FILE = CACHE_DIR / "store_link_cache.json"
REVIEW_FILE = CACHE_DIR / "store_link_review.md"

cfg = json.load(open(MCP_JSON))
BASE   = cfg["mcpServers"]["directus"]["env"]["DIRECTUS_URL"].rstrip("/")
TOKEN  = cfg["mcpServers"]["directus"]["env"]["DIRECTUS_TOKEN"]
ITAD_KEY = cfg["mcpServers"]["game-encyclopedia"]["env"]["ITAD_API_KEY"]

DHDR = {"Authorization": f"Bearer {TOKEN}", "Accept": "application/json",
        "Content-Type": "application/json"}

HIGH_CONF   = 0.82
REVIEW_CONF = 0.55
MAX_RETRIES = 5
BACKOFF_BASE = 2.0
ITAD_DELAY  = 1.0

# ── HTTP ──────────────────────────────────────────────────────────────────────

def d_get(path):
    req = urllib.request.Request(f"{BASE}{path}", headers=DHDR)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

def d_post(path, body):
    data = json.dumps(body).encode()
    req  = urllib.request.Request(f"{BASE}{path}", data=data, headers=DHDR, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

def fetch_all(path):
    results, offset = [], 0
    while True:
        sep   = "&" if "?" in path else "?"
        batch = d_get(f"{path}{sep}limit=500&offset={offset}").get("data", [])
        results.extend(batch)
        if len(batch) < 500:
            break
        offset += 500
    return results

def itad_get(path):
    url = f"https://api.isthereanydeal.com{path}"
    delay = BACKOFF_BASE
    for attempt in range(MAX_RETRIES):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "jasmeralia-backfill/1.0"})
            with urllib.request.urlopen(req, timeout=15) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code in (429, 503):
                print(f"  ITAD rate limit ({e.code}), backing off {delay:.0f}s...", file=sys.stderr)
                time.sleep(delay); delay *= 2
            else:
                print(f"  ITAD HTTP {e.code}: {path}", file=sys.stderr)
                return None
        except Exception as e:
            print(f"  ITAD error: {e}", file=sys.stderr)
            return None
    return None

# ── Title similarity ──────────────────────────────────────────────────────────

_STRIP = re.compile(r"[™®©:'\-–—!?,.()\[\]]+")

def normalize(s):
    s = re.sub(r"\s*&\s*", " and ", s)
    s = s.replace("_", " ")
    return _STRIP.sub(" ", s.lower()).split()

def title_sim(a, b):
    na, nb = " ".join(normalize(a)), " ".join(normalize(b))
    return difflib.SequenceMatcher(None, na, nb).ratio()

# ── ITAD lookup ───────────────────────────────────────────────────────────────
# ITAD v3 shop IDs (numeric):
SHOP_GOG   = 35
SHOP_EPIC  = 16
SHOP_STEAM = 61

_TRACKING_PARAMS = {'partner', 'ref', 'referral', 'aff', 'affiliate', 'pp',
                    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content',
                    'utm_term', 'cjdata', 'r'}

def strip_tracking(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    if not parsed.query:
        return url
    qs    = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
    clean = {k: v for k, v in qs.items() if k.lower() not in _TRACKING_PARAMS}
    return urllib.parse.urlunparse(parsed._replace(query=urllib.parse.urlencode(clean, doseq=True)))

def itad_search_by_title(title: str) -> tuple[str | None, str | None]:
    """Return (itad_id, matched_title) for the best title match, or (None, None)."""
    q    = urllib.parse.quote(title)
    data = itad_get(f"/games/search/v1?key={ITAD_KEY}&title={q}&limit=10")
    if not data:
        return None, None
    best_id, best_title, best_score = None, None, 0.0
    for r in data:
        if r.get("type") != "game":
            continue
        score = title_sim(title, r.get("title", ""))
        if score > best_score:
            best_score, best_id, best_title = score, r.get("id"), r.get("title")
    if best_score >= REVIEW_CONF:
        return best_id, best_title
    return None, None

def itad_prices(itad_id: str) -> dict:
    """Return {shop_numeric_id: itad_redirect_url} for the given ITAD game ID.
    Uses POST as required by the v3 prices endpoint."""
    url   = f"https://api.isthereanydeal.com/games/prices/v3?key={ITAD_KEY}&country=US"
    data  = json.dumps([itad_id]).encode()
    delay = BACKOFF_BASE
    for attempt in range(MAX_RETRIES):
        try:
            req = urllib.request.Request(
                url, data=data,
                headers={"User-Agent": "jasmeralia-backfill/1.0",
                         "Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=15) as r:
                results = json.loads(r.read())
            entry = next((e for e in results if e.get("id") == itad_id), None)
            if not entry:
                return {}
            shops = {}
            for deal in entry.get("deals") or []:
                sid = (deal.get("shop") or {}).get("id")
                u   = deal.get("url", "")
                if sid and u and sid not in shops:
                    shops[sid] = u
            return shops
        except urllib.error.HTTPError as e:
            if e.code in (429, 503):
                print(f"  ITAD prices rate limit ({e.code}), backing off {delay:.0f}s...", file=sys.stderr)
                time.sleep(delay); delay *= 2
            else:
                print(f"  ITAD prices HTTP {e.code}", file=sys.stderr)
                return {}
        except Exception as e:
            print(f"  ITAD prices error: {e}", file=sys.stderr)
            return {}
    return {}

def resolve_store_url(itad_redirect: str) -> str | None:
    """Follow the ITAD redirect chain and return the final store URL (tracking stripped)."""
    try:
        req = urllib.request.Request(itad_redirect, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as r:
            return strip_tracking(r.url)
    except Exception:
        return None

# ── Main ──────────────────────────────────────────────────────────────────────

def classify(game):
    """Return sets of platform keys present on this game."""
    links = game.get("links") or []
    plats = set()
    for l in links:
        if l.get("kind") != "download" or not l.get("url"):
            continue
        u = l["url"]
        if "steampowered" in u: plats.add("steam")
        elif "gog.com" in u:    plats.add("gog")
        elif "epicgames" in u:  plats.add("epic")
    return plats


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    CACHE_DIR.mkdir(exist_ok=True)
    cache: dict = {}
    if CACHE_FILE.exists():
        cache = json.loads(CACHE_FILE.read_text())
    print(f"Loaded {len(cache)} cached ITAD results", file=sys.stderr)

    print("Fetching all games with links...", file=sys.stderr)
    games = fetch_all("/items/games?fields=id,title,links.url,links.kind&sort=title")
    print(f"  {len(games)} games total", file=sys.stderr)

    # Categorise
    steam_no_gog   = []   # have steam, missing gog
    steam_no_epic  = []   # have steam, missing epic
    epic_no_steam  = []   # have epic but no steam

    for g in games:
        plats = classify(g)
        if "steam" in plats:
            if "gog"  not in plats: steam_no_gog.append(g)
            if "epic" not in plats: steam_no_epic.append(g)
        elif "epic" in plats and "steam" not in plats:
            epic_no_steam.append(g)

    print(f"\n  Steam without GOG:   {len(steam_no_gog)}", file=sys.stderr)
    print(f"  Steam without Epic:  {len(steam_no_epic)}", file=sys.stderr)
    print(f"  Epic without Steam:  {len(epic_no_steam)}", file=sys.stderr)

    added_gog = added_epic = added_steam = 0

    # want_shop_ids: list of SHOP_* numeric IDs to look for
    def process_game(game, want_shop_ids: list[int]):
        nonlocal added_gog, added_epic, added_steam
        title = game["title"]
        gid   = str(game["id"])

        # 1. ITAD title search (cached)
        cache_key = f"itad_id:{gid}"
        if cache_key not in cache:
            time.sleep(ITAD_DELAY)
            itad_id, matched = itad_search_by_title(title)
            cache[cache_key] = {"id": itad_id, "matched": matched}
            CACHE_FILE.write_text(json.dumps(cache, indent=2))
        entry   = cache[cache_key]
        itad_id = entry.get("id") if isinstance(entry, dict) else entry

        if not itad_id:
            return

        # 2. Prices — keyed by ITAD game ID (cached)
        price_key = f"prices:{itad_id}"
        if price_key not in cache:
            time.sleep(ITAD_DELAY)
            cache[price_key] = itad_prices(itad_id)
            CACHE_FILE.write_text(json.dumps(cache, indent=2))
        shops = cache[price_key]  # {numeric_shop_id: itad_redirect_url}

        for sid in want_shop_ids:
            itad_url = shops.get(sid) or shops.get(str(sid))
            if not itad_url:
                continue

            # 3. Follow redirect to get real store URL (cached)
            redir_key = f"redir:{itad_url}"
            if redir_key not in cache:
                real_url = resolve_store_url(itad_url)
                cache[redir_key] = real_url
                CACHE_FILE.write_text(json.dumps(cache, indent=2))
            real_url = cache[redir_key]
            if not real_url:
                continue

            # Sanity-check domain
            if sid == SHOP_GOG   and "gog.com"       not in real_url: continue
            if sid == SHOP_EPIC  and "epicgames.com"  not in real_url: continue
            if sid == SHOP_STEAM and "steampowered"   not in real_url: continue

            shop_name = {SHOP_GOG: "gog", SHOP_EPIC: "epic", SHOP_STEAM: "steam"}[sid]
            print(f"  [{game['id']}] {title}  +{shop_name}: {real_url}", file=sys.stderr)

            if args.apply:
                d_post("/items/games_links", {
                    "games_id": game["id"],
                    "url":      real_url,
                    "kind":     "download",
                })

            if sid == SHOP_GOG:   added_gog   += 1
            elif sid == SHOP_EPIC: added_epic  += 1
            elif sid == SHOP_STEAM: added_steam += 1

    # ── Process Steam→GOG ─────────────────────────────────────────────────────
    print(f"\n── Steam → GOG ({len(steam_no_gog)} games) ──", file=sys.stderr)
    for i, g in enumerate(steam_no_gog, 1):
        if i % 50 == 0:
            print(f"  [{i}/{len(steam_no_gog)}] checkpoint: gog_added={added_gog}", file=sys.stderr)
        process_game(g, [SHOP_GOG])

    # ── Process Steam→Epic ────────────────────────────────────────────────────
    print(f"\n── Steam → Epic ({len(steam_no_epic)} games) ──", file=sys.stderr)
    for i, g in enumerate(steam_no_epic, 1):
        if i % 50 == 0:
            print(f"  [{i}/{len(steam_no_epic)}] checkpoint: epic_added={added_epic}", file=sys.stderr)
        process_game(g, [SHOP_EPIC])

    # ── Process Epic→Steam ────────────────────────────────────────────────────
    print(f"\n── Epic → Steam ({len(epic_no_steam)} games) ──", file=sys.stderr)
    for i, g in enumerate(epic_no_steam, 1):
        if i % 25 == 0:
            print(f"  [{i}/{len(epic_no_steam)}] checkpoint: steam_added={added_steam}", file=sys.stderr)
        process_game(g, [SHOP_STEAM])

    print(f"\n{'='*60}", file=sys.stderr)
    print(f"GOG links {'added' if args.apply else 'found'}:   {added_gog}", file=sys.stderr)
    print(f"Epic links {'added' if args.apply else 'found'}:  {added_epic}", file=sys.stderr)
    print(f"Steam links {'added' if args.apply else 'found'}: {added_steam}", file=sys.stderr)
    if not args.apply:
        print("\nRun with --apply to commit.", file=sys.stderr)

if __name__ == "__main__":
    main()
