#!/usr/bin/env python3
"""
import_playnite.py

Imports GOG and Epic Games Store games from a Playnite CSV export into Directus.

For games already in Directus: adds the GOG/Epic download link if not present.
For new games: creates the record and download link.

Store URLs:
  GOG  — constructed from ITAD slug (gog.com/en/game/{slug_with_underscores})
  Epic — constructed from ITAD slug (store.epicgames.com/en-US/p/{slug})

Usage:
  python3 import_playnite.py <path/to/playnite_export.csv>           # dry-run
  python3 import_playnite.py <path/to/playnite_export.csv> --apply   # commit

Output:
  mcp/cache/playnite_import_review.md  — entries that need manual URL review
"""

import csv, difflib, json, re, sys, time, urllib.parse, urllib.request, ssl
from pathlib import Path

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SCRIPT_DIR   = Path(__file__).parent
CACHE_DIR    = SCRIPT_DIR.parent / 'cache'
MCP_JSON     = SCRIPT_DIR.parent.parent / '.mcp.json'
REVIEW_FILE  = CACHE_DIR / 'playnite_import_review.md'
URL_CACHE    = CACHE_DIR / 'playnite_url_cache.json'

CACHE_DIR.mkdir(exist_ok=True)

if len(sys.argv) < 2:
    print("Usage: import_playnite.py <playnite_export.csv> [--apply]")
    sys.exit(1)

CSV_PATH = Path(sys.argv[1])
DRY_RUN  = '--apply' not in sys.argv

with open(MCP_JSON) as f:
    cfg = json.load(f)
_d = cfg['mcpServers']['directus']['env']
_g = cfg['mcpServers']['game-encyclopedia']['env']

BASE           = _d['DIRECTUS_URL'].rstrip('/')
DIRECTUS_TOKEN = _d['DIRECTUS_TOKEN']
ITAD_KEY       = _g['ITAD_API_KEY']

CTX = ssl.create_default_context()
DH  = {'Authorization': f'Bearer {DIRECTUS_TOKEN}', 'Content-Type': 'application/json'}
UA  = 'Mozilla/5.0 (compatible; jasmeralia-importer/1.0)'

PLATFORMS    = {'GOG', 'Epic'}
HIGH_CONF    = 0.82
ITAD_DELAY   = 1.0   # seconds between ITAD requests
MAX_RETRIES  = 5
BACKOFF_BASE = 2.0   # doubles each retry: 2s, 4s, 8s, 16s, 32s

# Manually confirmed URLs for low-confidence ITAD matches (title, source) → url
MANUAL_URLS = {
    # GOG
    ("Broken Sword: Director's Cut",                           "GOG"):  "https://www.gog.com/en/game/broken_sword_shadow_of_the_templars_the_directors_cut",
    ("Consortium 2019 REBALANCE",                              "GOG"):  "https://www.gog.com/en/game/consortium_remastered",
    ("Daggerfall Unity - GOG Cut",                             "GOG"):  "https://www.gog.com/en/game/the_elder_scrolls_ii_daggerfall",
    ("Demon Stone",                                            "GOG"):  "https://www.gog.com/en/game/forgotten_realms_demon_stone",
    ("Fallout 2 Classic",                                      "GOG"):  "https://www.gog.com/en/game/fallout_2_a_post_nuclear_role_playing_game",
    ("Fallout Tactics Classic",                                "GOG"):  "https://www.gog.com/en/game/fallout_tactics_brotherhood_of_steel",
    ("Icewind Dale 2",                                         "GOG"):  "https://www.gog.com/en/game/icewind_dale_2_complete",
    ("Planescape: Torment",                                    "GOG"):  "https://www.gog.com/en/game/planescape_torment_enhanced_edition",
    ("Shadow Warrior Classic Complete",                        "GOG"):  "https://www.gog.com/en/game/shadow_warrior_classic_redux",
    ("Sin Slayers: The First Sin",                             "GOG"):  "https://www.gog.com/en/game/sin_slayers_reign_of_the_8th",
    ("The Whispering Valley",                                  "GOG"):  "https://www.gog.com/en/game/the_whispering_valley_la_vallee_qui_murmure",
    ("The Witcher: Enhanced Edition",                          "GOG"):  "https://www.gog.com/en/game/the_witcher_enhanced_edition_directors_cut",
    # Epic
    ("DARQ",                                                   "Epic"): "https://store.epicgames.com/en-US/p/darq-complete-edition",
    ("Dying Light",                                            "Epic"): "https://store.epicgames.com/en-US/p/dying-light-enhanced-edition",
    ("Guild of Dungeoneering",                                 "Epic"): "https://store.epicgames.com/en-US/p/guild-of-dungeoneering-ultimate-edition",
    ("Halcyon 6",                                              "Epic"): "https://store.epicgames.com/en-US/p/halcyon-6-lightspeed-edition",
    ("Iratus",                                                 "Epic"): "https://store.epicgames.com/en-US/p/iratus-lord-of-the-dead",
    ("Monument Valley 2",                                      "Epic"): "https://store.epicgames.com/en-US/p/monument-valley-2-panoramic-edition",
    ("Q.U.B.E. 2",                                             "Epic"): "https://store.epicgames.com/en-US/p/qube-2",
    ("Rustler - Grand Theft Horse",                            "Epic"): "https://store.epicgames.com/en-US/p/rustler",
    ("Telltale Batman Season 1",                               "Epic"): "https://store.epicgames.com/en-US/p/batman-the-telltale-series",
    ("The Textorcist",                                         "Epic"): "https://store.epicgames.com/en-US/p/the-textorcist-the-story-of-ray-bibbia",
    ("Tomb Raider I-III Remastered Starring Lara Croft",       "Epic"): "https://store.epicgames.com/en-US/p/tomb-raider-i-iii-remastered",
}

# Titles whose ITAD match was confirmed wrong — skip entirely rather than queue for review
BLOCKED_TITLES = {
    ("Telltale Batman Season 2",        "Epic"),  # matched Season 1 URL
    ("Second Extinction",               "Epic"),  # matched Trials 2: Second Edition
    ("Stranger Things 3: The Game",     "Epic"),  # matched Stranger Things VR
    ("WARHAMMER 40K: Rites of War",     "GOG"),   # matched Speed Freeks
    ("Riven - The Sequel to Myst",      "GOG"),   # matched Vagrus: The Riven Realms
    ("The Cycle",                       "Epic"),  # matched The OGI Cycles
    ("Divine Knockout",                 "Epic"),  # matched Divine Ascent
    ("The Feast",                       "GOG"),   # matched The King's Feast
    ("Nightingale - Legacy Mode",       "Epic"),  # matched Nightingale Downs
    ("Symphonia (Student Project, 2020)", "GOG"), # matched commercial Symphonia
}

# ---------------------------------------------------------------------------
# Edition-suffix deduplication
# ---------------------------------------------------------------------------
# When a Playnite CSV contains an edition/variant title (e.g. "BioShock Remastered")
# whose canonical base game (e.g. "BioShock") is already in Directus, we want to
# add the store link to the existing entry rather than create a duplicate.
#
# Two-stage fallback used in the main lookup (see _find_existing()):
#   1. Strip known edition suffixes from the incoming title and retry the lookup.
#   2. If the resolved store URL is already linked to any game, use that game.

_EDITION_STRIP_RE = re.compile(
    r'(?:'
    # Parenthetical edition markers: " (Classic)", " (2003)", etc.
    r'\s*\(\s*(?:classic|\d{4})\s*\)'
    r'|'
    # Separator + edition phrase at end of string
    r'(?:[\s:–—-]+)'
    r'(?:the\s+)?'   # optional leading "The" (e.g. "The Complete Edition")
    r'(?:'
    r'remastered'
    r'|enhanced\s+plus\s+edition'
    r'|enhanced\s+edition'
    r'|enhanced'                              # standalone (e.g. "GTA V Enhanced")
    r'|definitive\s+edition'
    r'|definitive'
    r"|director'?s\s+cut"
    r'|ultimate\s+edition'
    r'|ultimate'
    r'|g\.?o\.?t\.?y\.?\s+edition'
    r'|game\s+of\s+the\s+year\s+edition'
    r'|complete\s+edition'
    r'|complete'                              # e.g. "Neverwinter Nights 2 Complete"
    r'|\d+(?:st|nd|rd|th)?\s+anniversary(?:\s+edition)?'  # "10th Anniversary"
    r'|anniversary\s+edition'
    r'|deluxe\s+edition'
    r'|gold\s+edition'
    r'|extended\s+edition'
    r'|special\s+edition'
    r'|standard\s+edition'
    r'|classic\s+and\s+uncut'
    r'|20\s+year\s+celebration'              # Rise of the Tomb Raider
    r"|spacer'?s\s+choice\s+edition"        # The Outer Worlds
    r'|valhalla\s+edition'                   # Jotun
    r'|jotunn\s+edition'
    r'|up-armored\s+edition'                 # Brigador
    r'|trials\s+of\s+fear\s+edition'         # Dandara
    r'|sovereign\s+edition'                  # Sunless Skies
    r'|legendary\s+edition'
    r'|2019\s+rebalance'                     # Consortium 2019 REBALANCE
    r'|rebalance'
    r'|unrated'                              # Agony UNRATED
    r'|the\s+final\s+cut'                   # Disco Elysium - The Final Cut
    r'|final\s+cut'
    r'|classic'                              # standalone (e.g. "Mafia II (Classic)" → handled above)
    r')'
    r')\s*$',
    re.IGNORECASE,
)


def strip_edition_key(title: str) -> str | None:
    """Return normalized key with known edition suffix stripped, or None if no suffix found."""
    stripped = _EDITION_STRIP_RE.sub('', title).strip()
    if stripped.lower() == title.lower():
        return None
    return ' '.join(normalize(stripped)) or None


def _find_existing(title: str, key: str, db: dict, url_index: dict,
                   store_url: str | None) -> tuple[dict | None, str]:
    """Look up an incoming title in the Directus index.

    Returns (game_entry, match_reason) where game_entry is None if not found.
    Three-stage search:
      1. Exact normalized title match.
      2. Edition-suffix-stripped title match (e.g. 'BioShock Remastered' → 'BioShock').
      3. Store URL match — catches aliases like 'Telltale Batman Season 1' whose
         store URL already belongs to the canonical 'Batman - The Telltale Series'.
    """
    hit = db.get(key)
    if hit:
        return hit, 'exact'

    ck = strip_edition_key(title)
    if ck:
        hit = db.get(ck)
        if hit:
            return hit, f'edition-strip → "{hit["title"]}"'

    if store_url:
        hit = url_index.get(store_url)
        if hit:
            return hit, f'url-match → "{hit["title"]}"'

    return None, ''

# Titles matching any of these patterns are non-game entries and should be skipped.
_SKIP_RE = re.compile(
    r'\bsoundtrack\b|\boriginal score\b|\bost\b'           # music releases
    r'|\beditor\b|\bresource archiver\b'                    # FM tools / dev tools
    r'|\bgoodie pack\b|\bgoodies\b'                        # GOG goodies bundles
    r'|\bmap pack\b'                                       # DLC map packs
    r'|^packs\s*-'                                         # GOG "Packs - ..." bundles
    r'|\bpremium keg\b|\bkegs?\b'                          # GWENT in-game currency
    r'|beta\b|\bexperimental\b|\bpublic testing\b|\btest branch\b'  # beta/test builds
    r'|\bprologue\b',                                      # free prologue demos
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def http_get(url, headers=None, timeout=10):
    h = {'User-Agent': UA}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, context=CTX, timeout=timeout) as r:
        return json.loads(r.read())

_TRACKING_PARAMS = {'partner', 'ref', 'referral', 'aff', 'affiliate', 'pp',
                    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'}

def strip_tracking(url: str) -> str:
    """Remove known affiliate/tracking query parameters from a store URL."""
    parsed = urllib.parse.urlparse(url)
    if not parsed.query:
        return url
    qs = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
    clean = {k: v for k, v in qs.items() if k.lower() not in _TRACKING_PARAMS}
    new_query = urllib.parse.urlencode(clean, doseq=True)
    return urllib.parse.urlunparse(parsed._replace(query=new_query))

def http_post(url, data, headers=None, timeout=10):
    body = json.dumps(data).encode()
    h = {'Content-Type': 'application/json'}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=body, headers=h, method='POST')
    with urllib.request.urlopen(req, context=CTX, timeout=timeout) as r:
        return json.loads(r.read())

# ---------------------------------------------------------------------------
# Directus helpers
# ---------------------------------------------------------------------------

def d_get(path, params=None):
    url = f'{BASE}{path}'
    if params:
        url += '?' + urllib.parse.urlencode(params, doseq=True)
    req = urllib.request.Request(url, headers=DH)
    with urllib.request.urlopen(req, context=CTX) as r:
        return json.loads(r.read())

def d_post(path, data):
    body = json.dumps(data).encode()
    req = urllib.request.Request(f'{BASE}{path}', data=body, headers=DH, method='POST')
    with urllib.request.urlopen(req, context=CTX) as r:
        return json.loads(r.read())

# ---------------------------------------------------------------------------
# Title normalisation / matching
# ---------------------------------------------------------------------------

_STRIP_RE = re.compile(r"[™®©:'\-–—!?,.()\[\]]+")

# Maps spelled-out numbers to digits so "Week One" and "Week 1" normalize identically.
_NUMBER_WORDS = {
    'one': '1', 'two': '2', 'three': '3', 'four': '4', 'five': '5',
    'six': '6', 'seven': '7', 'eight': '8', 'nine': '9', 'ten': '10',
}

def normalize(s: str) -> list[str]:
    tokens = _STRIP_RE.sub(' ', s.lower()).split()
    return [_NUMBER_WORDS.get(t, t) for t in tokens]

def title_sim(a: str, b: str) -> float:
    na, nb = ' '.join(normalize(a)), ' '.join(normalize(b))
    return difflib.SequenceMatcher(None, na, nb).ratio()

# ---------------------------------------------------------------------------
# ITAD lookup — shared by both GOG and Epic
# ---------------------------------------------------------------------------

def itad_search(title: str) -> tuple[str | None, float]:
    """Returns (itad_slug, confidence) or (None, 0.0). Retries on rate limits."""
    query = urllib.parse.quote(title)
    url   = f'https://api.isthereanydeal.com/games/search/v1?key={ITAD_KEY}&title={query}&limit=5'
    delay = BACKOFF_BASE
    for attempt in range(MAX_RETRIES):
        try:
            results = http_get(url)
            best_slug, best_score = None, 0.0
            for r in results:
                if r.get('type') != 'game':
                    continue
                score = title_sim(title, r.get('title', ''))
                if score > best_score:
                    best_score = score
                    best_slug  = r.get('slug')
            return best_slug, best_score
        except urllib.error.HTTPError as e:
            if e.code in (429, 403):
                print(f'  [ITAD] rate limited (HTTP {e.code}), backing off {delay:.0f}s...', flush=True)
                time.sleep(delay)
                delay *= 2
            else:
                print(f'  [ITAD] HTTP {e.code} for "{title}"', flush=True)
                return None, 0.0
        except Exception as e:
            print(f'  [ITAD] error for "{title}": {e}', flush=True)
            return None, 0.0
    print(f'  [ITAD] rate limit exceeded after {MAX_RETRIES} retries for "{title}"', flush=True)
    return None, 0.0

def gog_url_from_slug(slug: str) -> str:
    return strip_tracking(f'https://www.gog.com/en/game/{slug.replace("-", "_")}')

def epic_url_from_slug(slug: str) -> str:
    return strip_tracking(f'https://store.epicgames.com/en-US/p/{slug}')

# ---------------------------------------------------------------------------
# Directus: load all games
# ---------------------------------------------------------------------------

def load_directus_games():
    """Returns (title_index, url_index).

    title_index: normalised_title → {id, title, link_urls, link_kinds}
    url_index:   store_url → same entry (for URL-based dedup fallback)
    """
    games = d_get('/items/games', {
        'fields[]': ['id', 'title', 'links.kind', 'links.url'],
        'limit': -1,
    })['data']
    title_index: dict = {}
    url_index:   dict = {}
    for g in games:
        key   = ' '.join(normalize(g['title']))
        links = g.get('links') or []
        entry = {
            'id':         g['id'],
            'title':      g['title'],
            'link_urls':  {l['url'] for l in links if l.get('url')},
            'link_kinds': {l['kind'] for l in links if l.get('kind')},
        }
        title_index[key] = entry
        for url in entry['link_urls']:
            url_index[url] = entry
    return title_index, url_index

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def slug_from_title(title: str) -> str:
    s = title.lower()
    s = re.sub(r"[^a-z0-9]+", '-', s).strip('-')
    return s

def main():
    # Read CSV
    entries = []
    with open(CSV_PATH, newline='', encoding='utf-8-sig') as f:
        # First line is a Playnite type comment (#TYPE ...), skip it
        first = f.readline()
        if not first.startswith('#TYPE'):
            f.seek(0)
        reader = csv.DictReader(f)
        for row in reader:
            source = (row.get('Source') or '').strip()
            if source not in PLATFORMS:
                continue
            title = row['Name'].strip()
            if _SKIP_RE.search(title):
                print(f'  [SKIP] non-game entry excluded: {title}')
                continue
            entries.append({'title': title, 'source': source})

    print(f'Found {len(entries)} entries ({sum(1 for e in entries if e["source"]=="GOG")} GOG, '
          f'{sum(1 for e in entries if e["source"]=="Epic")} Epic)')

    # Load URL cache written by a previous dry-run (keyed by "title|source")
    url_cache: dict[str, tuple[str | None, float]] = {}
    if URL_CACHE.exists():
        raw = json.loads(URL_CACHE.read_text())
        url_cache = {k: (v[0], v[1]) for k, v in raw.items()}
        print(f'  Loaded {len(url_cache)} cached URLs from {URL_CACHE.name}')

    print('Loading Directus games index...')
    db, url_index = load_directus_games()
    print(f'  {len(db)} games in Directus')

    review = []
    stats = {'skipped': 0, 'link_added': 0, 'game_created': 0, 'no_url': 0, 'low_conf': 0}
    seen_keys  = {}   # normalized_key → first title seen (duplicate detection)
    batch_anom = []   # anomalies collected since last checkpoint
    TOTAL      = len(entries)

    def emit_checkpoint(i):
        anom_str = f'{len(batch_anom)} anomaly(s)' if batch_anom else 'none'
        print(
            f'[CHECKPOINT] {i}/{TOTAL} | '
            f'skipped={stats["skipped"]} link_added={stats["link_added"]} '
            f'game_created={stats["game_created"]} no_url={stats["no_url"]} '
            f'low_conf={stats["low_conf"]} | {anom_str}',
            flush=True,
        )
        for note in batch_anom[:8]:
            print(f'  [ANOMALY] {note}', flush=True)
        batch_anom.clear()

    for i, entry in enumerate(entries, 1):
        title  = entry['title']
        source = entry['source']
        key    = ' '.join(normalize(title))

        print(f'[{i}/{TOTAL}] {source}: {title}', flush=True)

        # --- Blocked titles (confirmed wrong ITAD match) ---
        if (title, source) in BLOCKED_TITLES:
            print(f'  → blocked (confirmed wrong match), skipped', flush=True)
            continue

        # --- Duplicate title detection ---
        if key in seen_keys:
            batch_anom.append(f'DUP-TITLE: "{title}" (same as "{seen_keys[key]}")')
        else:
            seen_keys[key] = title

        # --- Look up store URL (manual override → cache → ITAD) ---
        store_url  = None
        url_conf   = 0.0
        cache_key  = f'{title}|{source}'
        itad_called = False
        if (title, source) in MANUAL_URLS:
            store_url = MANUAL_URLS[(title, source)]
            url_conf  = 1.0
            print(f'  → manual override: {store_url}', flush=True)
        elif cache_key in url_cache:
            store_url, url_conf = url_cache[cache_key]
            print(f'  → cached ({url_conf:.2f}): {store_url}', flush=True)
        else:
            slug, url_conf = itad_search(title)
            if slug:
                if source == 'GOG':
                    store_url = gog_url_from_slug(slug)
                else:  # Epic
                    store_url = epic_url_from_slug(slug)
            url_cache[cache_key] = (store_url, url_conf)
            itad_called = True

        if store_url and url_conf < HIGH_CONF:
            stats['low_conf'] += 1
            review.append({'title': title, 'source': source, 'url': store_url, 'conf': url_conf})
            print(f'  → low confidence ({url_conf:.2f}), queued for review: {store_url}')
            if url_conf < 0.5:
                batch_anom.append(f'VERY-LOW-CONF({url_conf:.2f}) [{source}] "{title}" → {store_url}')

        if not store_url:
            stats['no_url'] += 1
            review.append({'title': title, 'source': source, 'url': None, 'conf': 0.0})
            print(f'  → no URL found, queued for review')
            batch_anom.append(f'NO-URL [{source}] "{title}"')

        # --- Check Directus (three-stage: exact → edition-strip → URL match) ---
        existing, match_reason = _find_existing(title, key, db, url_index, store_url)

        if existing:
            platform_host = 'gog.com' if source == 'GOG' else 'epicgames.com'
            already_has = any(platform_host in u for u in existing['link_urls'])
            if match_reason != 'exact':
                print(f'  → dedup match ({match_reason}): game {existing["id"]}')
            if already_has:
                stats['skipped'] += 1
                print(f'  → already has {source} link, skipped')
            elif store_url and url_conf >= HIGH_CONF:
                if not DRY_RUN:
                    d_post('/items/games_links', {
                        'games_id': existing['id'],
                        'url': store_url,
                        'kind': 'download',
                        'sort': 99,
                    })
                    existing['link_urls'].add(store_url)
                    url_index[store_url] = existing
                stats['link_added'] += 1
                print(f'  → {"ADDED" if not DRY_RUN else "DRY"} link to game {existing["id"]}: {store_url}')
            # low-conf for existing game: already tracked in low_conf + review, no further action
        else:
            game_slug = slug_from_title(title)
            if store_url and url_conf >= HIGH_CONF:
                if not DRY_RUN:
                    result = d_post('/items/games', {
                        'title': title,
                        'slug': game_slug,
                        'game_status': 'released',
                    })
                    game_id = result['data']['id']
                    d_post('/items/games_links', {
                        'games_id': game_id,
                        'url': store_url,
                        'kind': 'download',
                        'sort': 1,
                    })
                    new_entry = {'id': game_id, 'title': title, 'link_urls': {store_url}, 'link_kinds': {'download'}}
                    db[key] = new_entry
                    url_index[store_url] = new_entry
                stats['game_created'] += 1
                print(f'  → {"CREATED" if not DRY_RUN else "DRY"} new game + link: {store_url}')
            else:
                stats['no_url'] += 1
                print(f'  → skipped (no high-confidence URL)')

        if itad_called:
            time.sleep(ITAD_DELAY)

        if i % 50 == 0:
            emit_checkpoint(i)

    # Persist URL cache so --apply can skip ITAD lookups
    URL_CACHE.write_text(json.dumps(url_cache, indent=2))
    print(f'URL cache written: {URL_CACHE} ({len(url_cache)} entries)')

    # Final checkpoint for any remainder
    if TOTAL % 50 != 0:
        emit_checkpoint(TOTAL)

    print(
        f'[DONE] skipped={stats["skipped"]} link_added={stats["link_added"]} '
        f'game_created={stats["game_created"]} no_url={stats["no_url"]} '
        f'low_conf={stats["low_conf"]} review={len(review)}',
        flush=True,
    )

    # Write review file
    with open(REVIEW_FILE, 'w') as f:
        f.write(f'# Playnite Import Review\n\n')
        f.write(f'Generated: {len(review)} entries needing manual attention.\n\n')
        for r in sorted(review, key=lambda x: x['source'] + x['title'].lower()):
            conf_str = f'{r["conf"]:.2f}' if r['conf'] else 'none'
            url_str  = r['url'] or '_(no URL found)_'
            f.write(f'- **[{r["source"]}]** {r["title"]} — {url_str} (conf: {conf_str})\n')

    print(f'\nDone. skipped={stats["skipped"]} link_added={stats["link_added"]} '
          f'game_created={stats["game_created"]} no_url={stats["no_url"]}')
    print(f'Review file: {REVIEW_FILE}')
    if DRY_RUN:
        print('\n*** DRY RUN — pass --apply to commit changes ***')

if __name__ == '__main__':
    main()
