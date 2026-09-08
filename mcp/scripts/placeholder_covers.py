"""Known generated placeholder cover files and their SHA-256 hashes."""

import hashlib
import sys
from pathlib import Path

KNOWN_PLACEHOLDER_FILENAMES = (
    "a-night-with-the-demon.png",
    "anthem-of-the-nightside.png",
    "beast-control.png",
    "go-go-pizza-boy.png",
    "husbands-of-evelyn.png",
    "lassitude-of-the-undying.png",
    "mafia-blacklist.png",
    "momo.png",
)

_SCRIPT_DIR = Path(__file__).resolve().parent
_STANDALONE_COVERS_DIR = _SCRIPT_DIR / "docs" / "Steam_Covers"
STEAM_TYPHOON_COVERS_DIR = (
    _STANDALONE_COVERS_DIR
    if _STANDALONE_COVERS_DIR.is_dir()
    else _SCRIPT_DIR.parent.parent.parent / "steam-typhoon" / "docs" / "Steam_Covers"
)


def compute_known_placeholder_hashes() -> dict[str, str]:
    """Return SHA-256 hashes for every available known placeholder cover."""
    hashes: dict[str, str] = {}
    for filename in KNOWN_PLACEHOLDER_FILENAMES:
        cover_path = STEAM_TYPHOON_COVERS_DIR / filename
        if not cover_path.is_file():
            print(
                f"WARNING: Placeholder cover is missing: {cover_path}", file=sys.stderr
            )
            continue
        hashes[filename] = hashlib.sha256(cover_path.read_bytes()).hexdigest()
    return hashes
