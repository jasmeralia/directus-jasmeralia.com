#!/usr/bin/env python3
"""
One-time setup for tier list move tracking.

Creates:
  1. Collection tier_row_game_moves (log table)
  2. Fields: id, tier_row_game_id, game_id, from_tier_row_id, to_tier_row_id, moved_at
  3. Flow: filter hook on tier_row_games.items.update → exec operation logs each move

Usage:
    python3 setup_tier_move_tracking.py
"""

import json
import sys
import datetime
import urllib.request
import urllib.error
from pathlib import Path

from scriptlib import server_env

CACHE = Path(__file__).parent.parent / "cache"
DIRECTUS_ENV = server_env("directus")
DIRECTUS_URL = DIRECTUS_ENV["DIRECTUS_URL"].rstrip("/")
DIRECTUS_TOKEN = DIRECTUS_ENV["DIRECTUS_TOKEN"]

COLLECTION = "tier_row_game_moves"


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------


def api(method: str, path: str, body: dict | None = None) -> dict:
    """Send an authenticated Directus API request."""
    data = json.dumps(body).encode() if body is not None else None
    headers = {
        "Authorization": f"Bearer {DIRECTUS_TOKEN}",
        "Accept": "application/json",
    }
    if data:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(
        f"{DIRECTUS_URL}{path}",
        data=data,
        method=method,
        headers=headers,
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body_text = e.read().decode(errors="replace")
        raise RuntimeError(f"HTTP {e.code} {method} {path}: {body_text}") from e


def fetch_all(path: str, page_size: int = 500) -> list:
    """Fetch all pages from a Directus items endpoint."""
    results, offset = [], 0
    while True:
        sep = "&" if "?" in path else "?"
        batch = api("GET", f"{path}{sep}limit={page_size}&offset={offset}").get(
            "data", []
        )
        results.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return results


# ---------------------------------------------------------------------------
# Backup
# ---------------------------------------------------------------------------


def take_backup():
    """Back up collections affected by tier-move tracking."""
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_dir = CACHE / f"backup_{ts}"
    backup_dir.mkdir(parents=True, exist_ok=True)

    collections = [
        "games",
        "genres",
        "developers",
        "games_genres",
        "games_developers",
        "tier_lists",
        "tier_rows",
        "tier_row_games",
    ]
    for col in collections:
        items = fetch_all(f"/items/{col}")
        (backup_dir / f"{col}.json").write_text(json.dumps(items, indent=2))
        print(f"  Backed up {len(items):>5} {col}", file=sys.stderr)

    print(f"Backup written to {backup_dir}", file=sys.stderr)


# ---------------------------------------------------------------------------
# Collection + fields
# ---------------------------------------------------------------------------


def collection_exists() -> bool:
    """Return whether the tier-move collection already exists."""
    try:
        api("GET", f"/collections/{COLLECTION}")
        return True
    except RuntimeError as e:
        if "403" in str(e) or "404" in str(e):
            return False
        raise


def create_collection():
    """Create the tier-move tracking collection."""
    api(
        "POST",
        "/collections",
        {
            "collection": COLLECTION,
            "meta": {
                "hidden": False,
                "icon": "swap_horiz",
                "display_template": "{{game_id}} {{from_tier_row_id}} → {{to_tier_row_id}}",
                "sort_field": "moved_at",
            },
            "schema": {},
        },
    )
    print(f"Created collection {COLLECTION}", file=sys.stderr)


def create_field(field: str, ftype: str, schema: dict, meta: dict):
    """Create one field on the tier-move tracking collection."""
    api(
        "POST",
        f"/fields/{COLLECTION}",
        {
            "field": field,
            "type": ftype,
            "schema": schema,
            "meta": meta,
        },
    )
    print(f"  Created field {field}", file=sys.stderr)


def create_fields():
    """Create every field required for tier-move tracking."""
    # id is auto-created as primary key by Directus when collection is created
    # We only add the data fields.
    fields: list[tuple[str, str, dict, dict]] = [
        (
            "tier_row_game_id",
            "integer",
            {"is_nullable": True},
            {
                "interface": "input",
                "display": "raw",
                "note": "tier_row_games.id at time of move",
            },
        ),
        (
            "game_id",
            "integer",
            {"is_nullable": False},
            {
                "interface": "select-dropdown-m2o",
                "display": "related-values",
                "options": {"template": "{{title}}", "enableCreate": False},
                "special": ["m2o"],
                "display_options": {"template": "{{title}}"},
            },
        ),
        (
            "from_tier_row_id",
            "integer",
            {"is_nullable": False},
            {
                "interface": "select-dropdown-m2o",
                "display": "related-values",
                "options": {"template": "{{label}}", "enableCreate": False},
                "special": ["m2o"],
                "display_options": {"template": "{{label}}"},
            },
        ),
        (
            "to_tier_row_id",
            "integer",
            {"is_nullable": False},
            {
                "interface": "select-dropdown-m2o",
                "display": "related-values",
                "options": {"template": "{{label}}", "enableCreate": False},
                "special": ["m2o"],
                "display_options": {"template": "{{label}}"},
            },
        ),
        (
            "moved_at",
            "timestamp",
            {"is_nullable": False},
            {
                "interface": "datetime",
                "display": "datetime",
                "display_options": {"relative": True},
            },
        ),
    ]
    for field, ftype, schema, meta in fields:
        create_field(field, ftype, schema, meta)


# ---------------------------------------------------------------------------
# Relations (so Directus admin can navigate to related items)
# ---------------------------------------------------------------------------


def create_relation(many_collection: str, many_field: str, one_collection: str):
    """Create a many-to-one relation used by the tracking collection."""
    try:
        api(
            "POST",
            "/relations",
            {
                "collection": many_collection,
                "field": many_field,
                "related_collection": one_collection,
                "schema": {
                    "on_delete": "SET NULL",
                },
                "meta": {
                    "many_collection": many_collection,
                    "many_field": many_field,
                    "one_collection": one_collection,
                    "one_field": None,
                    "junction_field": None,
                    "sort_field": None,
                },
            },
        )
        print(
            f"  Created relation {many_collection}.{many_field} → {one_collection}",
            file=sys.stderr,
        )
    except RuntimeError as e:
        print(
            f"  Relation {many_field} skipped (may already exist): {e}", file=sys.stderr
        )


# ---------------------------------------------------------------------------
# Flow
# ---------------------------------------------------------------------------

FLOW_NAME = "Track Tier Row Game Moves"

EXEC_CODE = r"""
module.exports = async function (data) {
  const payload = data.$trigger?.payload;
  const keys    = data.$trigger?.keys;

  if (!payload || payload.tier_row_id === undefined || !keys?.length) return;

  const newTierRowId = Number(payload.tier_row_id);
  const BASE  = 'https://directus.jasmer.tools';
  const TOKEN = '__DIRECTUS_TOKEN__';

  const logged = [];
  for (const key of keys) {
    try {
      const r1 = await fetch(`${BASE}/items/tier_row_games/${key}?fields=id,game_id,tier_row_id`, {
        headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' }
      });
      const { data: item } = await r1.json();
      if (!item || item.tier_row_id === newTierRowId) continue;

      await fetch(`${BASE}/items/tier_row_game_moves`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tier_row_game_id: item.id,
          game_id:          item.game_id,
          from_tier_row_id: item.tier_row_id,
          to_tier_row_id:   newTierRowId,
          moved_at:         new Date().toISOString(),
        }),
      });
      logged.push({ key, from: item.tier_row_id, to: newTierRowId });
    } catch (e) {
      console.error('tier-move-log error key=' + key + ':', e.message);
    }
  }
  return logged;
};
""".strip().replace("__DIRECTUS_TOKEN__", DIRECTUS_TOKEN)


def flow_exists() -> bool:
    """Return whether the tier-move logging flow already exists."""
    flows = api("GET", "/flows?fields=name&limit=100").get("data", [])
    return any(f["name"] == FLOW_NAME for f in flows)


def create_flow():
    """Create the Directus flow that logs tier-row moves."""
    # 1. Create the flow without an operation yet
    flow_resp = api(
        "POST",
        "/flows",
        {
            "name": FLOW_NAME,
            "status": "active",
            "accountability": "null",
            "trigger": "event",
            "options": {
                "type": "filter",
                "scope": ["items.update"],
                "collections": ["tier_row_games"],
            },
            "operation": None,
        },
    )
    flow_id = flow_resp["data"]["id"]
    print(f"  Created flow {flow_id}", file=sys.stderr)

    # 2. Create the exec operation linked to the flow
    op_resp = api(
        "POST",
        "/operations",
        {
            "name": "Log Tier Move",
            "key": "log_tier_move",
            "type": "exec",
            "position_x": 18,
            "position_y": 1,
            "options": {"code": EXEC_CODE},
            "resolve": None,
            "reject": None,
            "flow": flow_id,
        },
    )
    op_id = op_resp["data"]["id"]
    print(f"  Created operation {op_id}", file=sys.stderr)

    # 3. Point the flow's entry operation at the new operation
    api("PATCH", f"/flows/{flow_id}", {"operation": op_id})
    print("  Linked flow → operation", file=sys.stderr)

    return flow_id


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    """Create the tier-move schema and logging flow."""
    print("=== Step 1: Backup ===", file=sys.stderr)
    take_backup()

    print("\n=== Step 2: Collection ===", file=sys.stderr)
    if collection_exists():
        print(
            f"Collection {COLLECTION} already exists — skipping creation",
            file=sys.stderr,
        )
    else:
        create_collection()
        create_fields()
        print("\n=== Step 2b: Relations ===", file=sys.stderr)
        create_relation(COLLECTION, "game_id", "games")
        create_relation(COLLECTION, "from_tier_row_id", "tier_rows")
        create_relation(COLLECTION, "to_tier_row_id", "tier_rows")

    print("\n=== Step 3: Flow ===", file=sys.stderr)
    if flow_exists():
        print(f"Flow '{FLOW_NAME}' already exists — skipping creation", file=sys.stderr)
    else:
        flow_id = create_flow()
        print(f"Flow created: {flow_id}", file=sys.stderr)

    print("\nDone.", file=sys.stderr)


if __name__ == "__main__":
    main()
