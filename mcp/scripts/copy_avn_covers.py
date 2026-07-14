#!/usr/bin/env python3
"""Download cover images for all AVN-tagged games and SCP them to the Steam Deck."""

import json
import os
import subprocess
import sys
import tempfile
import urllib.request
import urllib.error

from scriptlib import server_env

DIRECTUS_ENV = server_env("directus")
DIRECTUS_URL = DIRECTUS_ENV["DIRECTUS_URL"].rstrip("/")
TOKEN = DIRECTUS_ENV["DIRECTUS_TOKEN"]
DEST = "deck@192.168.1.65:/home/deck/00 Covers/"

AVN_GAME_IDS = [
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    8,
    9,
    10,
    11,
    12,
    13,
    14,
    15,
    16,
    17,
    18,
    19,
    20,
    21,
    22,
    23,
    24,
    25,
    26,
    27,
    28,
    29,
    30,
    31,
    32,
    33,
    34,
    35,
    36,
    37,
    38,
    39,
    40,
    41,
    42,
    43,
    44,
    45,
    46,
    47,
    48,
    49,
    50,
    51,
    52,
    53,
    54,
    55,
    56,
    58,
    59,
    61,
    62,
    63,
    64,
    65,
    66,
    67,
    68,
    69,
    70,
    71,
    72,
    73,
    74,
    81,
    132,
    160,
    169,
    177,
    182,
    183,
    184,
    185,
    186,
    187,
    188,
    189,
    190,
    191,
    192,
    193,
    194,
    195,
    196,
    197,
    198,
    199,
    200,
    201,
    202,
    203,
    204,
    205,
    206,
    207,
    208,
    209,
    210,
    211,
    212,
    213,
    214,
    215,
    216,
    217,
    251,
    254,
    359,
    387,
    409,
    410,
    411,
    412,
    413,
    416,
    417,
    418,
    419,
    420,
    421,
    422,
    423,
    424,
    425,
    426,
    427,
    428,
    429,
    430,
    431,
    432,
    434,
    435,
    436,
    437,
    438,
    439,
    440,
    441,
    442,
    443,
    444,
    445,
    446,
    447,
    992,
]


def api_get(path):
    """Fetch a Directus resource."""
    url = f"{DIRECTUS_URL}{path}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def fetch_games(ids):
    """Fetch slug + cover_image for a batch of game IDs."""
    ids_param = ",".join(str(i) for i in ids)
    # Use filter[id][_in] via query string
    path = f"/items/games?fields=id,slug,title,cover_image&filter[id][_in]={ids_param}&limit={len(ids)}"
    return api_get(path)["data"]


def get_file_info(uuid):
    """Get filename_download and type for a file UUID."""
    path = f"/files/{uuid}?fields=id,filename_download,type"
    return api_get(path)["data"]


def download_asset(uuid, dest_path):
    """Download a Directus asset to dest_path."""
    url = f"{DIRECTUS_URL}/assets/{uuid}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        with open(dest_path, "wb") as f:
            f.write(r.read())


def ext_from_mime(mime):
    """Map a supported image MIME type to a file extension."""
    mapping = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
    }
    return mapping.get(mime, "")


def main():
    """Copy AVN cover assets into the local cover directory."""
    tmpdir = tempfile.mkdtemp(prefix="avn_covers_")
    print(f"Working directory: {tmpdir}")

    # Fetch game metadata in one batch
    print(f"Fetching metadata for {len(AVN_GAME_IDS)} games...")
    games = fetch_games(AVN_GAME_IDS)
    print(f"  Got {len(games)} game records")

    # Filter to only games that have a cover_image
    with_cover = [g for g in games if g.get("cover_image")]
    no_cover = [g for g in games if not g.get("cover_image")]
    print(f"  {len(with_cover)} have cover images, {len(no_cover)} missing covers")
    if no_cover:
        print("  Missing covers:")
        for g in no_cover:
            print(f"    [{g['id']}] {g['title']}")

    errors = []
    for i, game in enumerate(with_cover, 1):
        slug = game["slug"] or f"game-{game['id']}"
        uuid = game["cover_image"]
        print(f"[{i}/{len(with_cover)}] {slug} ({uuid})", end=" ", flush=True)

        try:
            info = get_file_info(uuid)
            ext = ext_from_mime(info.get("type", ""))
            if not ext:
                # Fall back to extension from filename_download
                fn = info.get("filename_download", "")
                ext = os.path.splitext(fn)[1] if fn else ".jpg"

            dest_path = os.path.join(tmpdir, f"{slug}{ext}")
            download_asset(uuid, dest_path)
            size_kb = os.path.getsize(dest_path) // 1024
            print(f"-> {slug}{ext} ({size_kb} KB)")
        except Exception as e:
            print(f"ERROR: {e}")
            errors.append((game["id"], slug, str(e)))

    print(f"\nDownloaded {len(with_cover) - len(errors)} files to {tmpdir}")

    if errors:
        print(f"Errors ({len(errors)}):")
        for gid, slug, err in errors:
            print(f"  [{gid}] {slug}: {err}")

    # SCP to Steam Deck
    print(f"\nSCPing to {DEST} ...")
    files = os.listdir(tmpdir)
    if not files:
        print("No files to transfer.")
        return

    result = subprocess.run(
        ["scp", "-r", tmpdir + "/.", DEST],
        capture_output=False,
        check=False,
    )
    if result.returncode == 0:
        print("Transfer complete.")
    else:
        print(f"SCP exited with code {result.returncode}")
        sys.exit(1)


if __name__ == "__main__":
    main()
