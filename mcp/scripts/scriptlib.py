"""Shared infrastructure for the standalone MCP maintenance scripts."""

from __future__ import annotations

import json
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import cache
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
CACHE_DIR = Path(__file__).resolve().parent.parent / "cache"
MCP_CONFIG_PATH = REPO_ROOT / ".mcp.json"

DEFAULT_MAX_RETRIES = 5
DEFAULT_BACKOFF_BASE = 2.0


@dataclass(frozen=True)
class RetryPolicy:
    """Retry/backoff behavior for fetch_with_backoff."""

    max_retries: int = DEFAULT_MAX_RETRIES
    backoff_base: float = DEFAULT_BACKOFF_BASE
    rate_limit_codes: tuple[int, ...] = (429,)


def fetch_with_backoff(
    url: str,
    *,
    headers: dict[str, str] | None = None,
    data: bytes | None = None,
    timeout: float = 15,
    parse: Callable[[bytes], Any] = json.loads,
    retry: RetryPolicy | None = None,
    **request_options: str,
) -> tuple[Any | None, str | None]:
    """Fetch a URL with exponential backoff on rate-limit responses.

    `parse` converts the raw response body (default: JSON decode). Pass
    `parse=lambda raw: raw` to get raw bytes back (e.g. image downloads).
    Returns (parsed_body, None) on success, or (None, error_code) on
    failure, where error_code is "http_<code>", "error:<...>", or
    "rate_limit_exceeded". A rate-limit hit (HTTP code in
    retry.rate_limit_codes) is retried with exponential backoff and is
    NEVER silently swallowed as an empty/no-result response - callers must
    branch on the returned error_code rather than treating None the same
    as "no data found".
    """
    method = request_options.pop("method", "GET")
    if request_options:
        names = ", ".join(sorted(request_options))
        raise TypeError(f"Unexpected request option(s): {names}")
    policy = retry or RetryPolicy()
    delay = policy.backoff_base
    for attempt in range(policy.max_retries):
        try:
            req = urllib.request.Request(
                url, data=data, method=method, headers=headers or {}
            )
            with urllib.request.urlopen(req, timeout=timeout) as response:
                return parse(response.read()), None
        except urllib.error.HTTPError as error:
            if error.code in policy.rate_limit_codes:
                print(
                    f"  Rate limited (HTTP {error.code}), backing off {delay:.0f}s "
                    f"(attempt {attempt + 1}/{policy.max_retries})...",
                    file=sys.stderr,
                )
                time.sleep(delay)
                delay *= 2
            else:
                return None, f"http_{error.code}"
        except Exception as error:  # noqa: BLE001 - Surface network failures to caller.
            return None, f"error:{error}"
    return None, "rate_limit_exceeded"


class ProgressCache:
    """JSON-backed key-value cache for resumable, dry-run-then-apply scripts.

    Load once at startup; call get_or_set(key, compute) per item so compute()
    only runs for keys not already cached. The same cache file backs both the
    dry-run and the apply phase, so a real run never repeats an external API
    call that a prior dry run already resolved. Flushes to disk periodically
    (every `flush_every` new entries) so a crash never loses more than that
    many unsaved results; call flush() once more at the end of the run.
    """

    def __init__(self, path: Path, flush_every: int = 25) -> None:
        self.path = path
        self.flush_every = flush_every
        self._dirty_count = 0
        self.data: dict[str, Any] = (
            json.loads(path.read_text()) if path.exists() else {}
        )

    def __contains__(self, key: str) -> bool:
        """Return whether key has a cached value."""
        return key in self.data

    def get(self, key: str, default: Any = None) -> Any:
        """Return a cached value or default when key is absent."""
        return self.data.get(key, default)

    def set(self, key: str, value: Any) -> None:
        """Cache a value and flush when the checkpoint threshold is reached."""
        self.data[key] = value
        self._dirty_count += 1
        if self._dirty_count >= self.flush_every:
            self.flush()

    def get_or_set(self, key: str, compute: Callable[[], Any]) -> Any:
        """Return the cached value for key, computing and storing it if absent."""
        if key in self.data:
            return self.data[key]
        value = compute()
        self.set(key, value)
        return value

    def flush(self) -> None:
        """Persist all cached values to disk."""
        self.path.parent.mkdir(exist_ok=True)
        self.path.write_text(json.dumps(self.data, indent=2))
        self._dirty_count = 0


def derive_game_status(release_year: int | None) -> str:
    """Return the game_status implied by a release year: unreleased when null."""
    return "released" if release_year else "unreleased"


def parse_playnite_release_year(date_str: str | None) -> int | None:
    """Parse a Playnite CSV M/D/YYYY release date into a year, or None."""
    if not date_str:
        return None
    try:
        return int(date_str.split("/")[-1])
    except (ValueError, IndexError):
        return None


GAME_JUNCTIONS: tuple[tuple[str, str], ...] = (
    ("tier_list_games", "game_id"),
    ("games_genres", "games_id"),
    ("games_developers", "games_id"),
    ("games_links", "games_id"),
)


def delete_game_junctions(client: DirectusClient, game_id: int) -> None:
    """Delete every junction row referencing a game before deleting the game itself.

    Directus does not reliably cascade-delete these rows; a surviving orphan
    (game_id pointing at a deleted record) crashes any Astro page that
    expands the relation. Call this immediately before
    DELETE /items/games/{game_id}.
    """
    for collection, fk in GAME_JUNCTIONS:
        rows = client.fetch_all(
            f"/items/{collection}?fields=id&filter[{fk}][_eq]={game_id}"
        )
        for row in rows:
            client.delete(f"/items/{collection}/{row['id']}")


def take_pg_dump_backup(label: str) -> str:
    """Take a pg_dump backup on TrueNAS before a delete or schema change.

    Runs the exact command documented in AGENTS.md's "Rules for schema
    changes" section over SSH. Returns the backup filename on success;
    raises RuntimeError if the remote pipeline exits non-zero.
    """
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"directus_{timestamp}_{label}.sql.gz"
    remote_path = f"/mnt/myzmirror/directus-jasmeralia/backups/{filename}"
    remote_cmd = (
        f"docker exec cms-db pg_dump -U directus directus | gzip > {remote_path}"
    )
    result = subprocess.run(
        ["ssh", "morgan@truenas.windsofstorm.net", remote_cmd],
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"pg_dump backup failed (ssh exit {result.returncode})")
    print(f"Backup written: {remote_path}", file=sys.stderr)
    return filename


@cache
def load_mcp_config() -> dict[str, Any]:
    """Load and cache the repository's MCP configuration."""
    with MCP_CONFIG_PATH.open(encoding="utf-8") as config_file:
        return json.load(config_file)


def server_env(server_name: str) -> dict[str, str]:
    """Return the configured environment variables for an MCP server."""
    return load_mcp_config()["mcpServers"][server_name]["env"]


class DirectusClient:
    """Small authenticated JSON client for the project's Directus instance."""

    def __init__(self, base_url: str, token: str) -> None:
        """Initialize a client with a base URL and static API token."""
        self.base_url = base_url.rstrip("/")
        self.token = token

    @classmethod
    def from_config(cls) -> DirectusClient:
        """Build a client from the Directus entry in .mcp.json."""
        env = server_env("directus")
        return cls(env["DIRECTUS_URL"], env["DIRECTUS_TOKEN"])

    def request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
        *,
        params: dict[str, Any] | None = None,
        timeout: float = 30,
    ) -> dict[str, Any]:
        """Send an authenticated request and decode its JSON response."""
        url = f"{self.base_url}{path}"
        if params:
            url = f"{url}?{urllib.parse.urlencode(params, doseq=True)}"
        data = json.dumps(body).encode() if body is not None else None
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/json",
        }
        if data is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            url,
            data=data,
            method=method,
            headers=headers,
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response_body = response.read()
        return json.loads(response_body) if response_body else {}

    def request_or_none(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        """Send a request, logging HTTP errors instead of raising them."""
        try:
            return self.request(method, path, body)
        except urllib.error.HTTPError as error:
            error_body = error.read().decode(errors="replace")
            print(
                f"  ERROR {error.code} {method} {path}: {error_body[:300]}",
                file=sys.stderr,
            )
            return None

    def get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        """Fetch a Directus resource."""
        return self.request("GET", path, params=params)

    def post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        """Create a Directus resource."""
        return self.request("POST", path, body)

    def patch(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        """Update a Directus resource."""
        return self.request("PATCH", path, body)

    def delete(self, path: str) -> int:
        """Delete a Directus resource and return its HTTP status."""
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            method="DELETE",
            headers={"Authorization": f"Bearer {self.token}"},
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status

    def fetch_all(self, path: str, page_size: int = 500) -> list[dict[str, Any]]:
        """Fetch every page from a Directus items endpoint."""
        results: list[dict[str, Any]] = []
        offset = 0
        while True:
            separator = "&" if "?" in path else "?"
            response = self.get(f"{path}{separator}limit={page_size}&offset={offset}")
            batch = response.get("data", [])
            results.extend(batch)
            if len(batch) < page_size:
                return results
            offset += page_size

    def upload_cover(
        self, game_id: int, image_bytes: bytes, extension: str = "jpg"
    ) -> str | None:
        """Upload cover bytes and return the new Directus file ID."""
        boundary = "----FormBoundary7MA4YWxkTrZu0gW"
        filename = f"cover_{game_id}.{extension}"
        mime = "image/jpeg" if extension in ("jpg", "jpeg") else f"image/{extension}"
        body = (
            (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
                f"Content-Type: {mime}\r\n\r\n"
            ).encode()
            + image_bytes
            + f"\r\n--{boundary}--\r\n".encode()
        )
        request = urllib.request.Request(
            f"{self.base_url}/files",
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": f"multipart/form-data; boundary={boundary}",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                result = json.loads(response.read())
            return result["data"]["id"]
        except Exception as error:  # noqa: BLE001 - Report and skip per-cover failures.
            print(f"    Upload error: {error}", file=sys.stderr)
            return None
