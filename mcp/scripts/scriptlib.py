"""Shared infrastructure for the standalone MCP maintenance scripts."""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from functools import cache
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
CACHE_DIR = Path(__file__).resolve().parent.parent / "cache"
MCP_CONFIG_PATH = REPO_ROOT / ".mcp.json"


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
        except Exception as error:  # Network errors are reported per cover and skipped.
            print(f"    Upload error: {error}", file=sys.stderr)
            return None
