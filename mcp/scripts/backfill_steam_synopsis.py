#!/usr/bin/env python3
"""Plan and apply Steam Store synopsis backfills for Directus games."""

from __future__ import annotations

import argparse
import json
import re
import sys
import tempfile
import time
import urllib.parse
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from unittest.mock import Mock, patch

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from scriptlib import (  # pylint: disable=wrong-import-position
    CACHE_DIR,
    DirectusClient,
    RetryingDirectusClient,
)
from steamlib import (  # pylint: disable=wrong-import-position
    extract_steam_appid,
    fetch_steam_details,
)

CACHE_PATH = CACHE_DIR / "steam_synopsis_cache.json"
PLAN_PATH = CACHE_DIR / "steam_synopsis_plan.json"
REVIEW_PATH = CACHE_DIR / "steam_synopsis_review.md"
PROGRESS_PATH = CACHE_DIR / "steam_synopsis_progress.json"
STEAM_DELAY_S = 1.5
SPACE_RE = re.compile(r"[ \t\f\v]+")
HTML_TEXT_SPACE_RE = re.compile(r"[ \t\r\n\f\v]+")
BLANK_LINE_RE = re.compile(r"\n{2,}")
BOUNDARY_TAGS = {
    "address",
    "article",
    "blockquote",
    "div",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "li",
    "ol",
    "p",
    "section",
    "ul",
}
DROP_TAGS = {
    "audio",
    "canvas",
    "embed",
    "iframe",
    "object",
    "picture",
    "script",
    "source",
    "style",
    "svg",
    "track",
    "video",
}
DROP_VOID_TAGS = {"embed", "source", "track"}
LEGACY_STEAM_IMAGE_HOSTS = {
    "steamcdn-a.akamaihd.net",
    "steamcommunity-a.akamaihd.net",
    "steamstore-a.akamaihd.net",
}
STEAM_IMAGE_MARKER_RE = re.compile(
    r"^!\[([^\]\n]*)\]\((https://[^)\s]+)\)$", re.MULTILINE
)
SMART_MAP = str.maketrans(
    {
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u2013": "-",
        "\u2014": " - ",
        "\u2026": "...",
        "\u2011": "-",
        "\u00a0": " ",
    }
)


class SynopsisHTMLParser(HTMLParser):
    """Extract readable text and safe Steam CDN images from description HTML."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.drop_stack: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if self.drop_stack:
            if tag in DROP_TAGS and tag not in DROP_VOID_TAGS:
                self.drop_stack.append(tag)
            return
        if tag in DROP_TAGS:
            if tag not in DROP_VOID_TAGS:
                self.drop_stack.append(tag)
        elif tag == "img":
            attributes = dict(attrs)
            source = steam_image_url(attributes.get("src"))
            if source:
                alt = re.sub(r"[\[\]\r\n]+", " ", attributes.get("alt") or "")
                alt = SPACE_RE.sub(" ", alt).strip()
                self.parts.extend(("\n", f"![{alt}]({source})", "\n"))
        elif tag == "br" or tag in BOUNDARY_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if self.drop_stack:
            if tag == self.drop_stack[-1]:
                self.drop_stack.pop()
            elif tag in self.drop_stack:
                while self.drop_stack:
                    popped = self.drop_stack.pop()
                    if popped == tag:
                        break
            return
        if tag in BOUNDARY_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.drop_stack:
            self.parts.append(HTML_TEXT_SPACE_RE.sub(" ", data))


def steam_image_url(value: str | None) -> str | None:
    """Return an HTTPS Steam CDN URL safe for a rendered image, if allowed."""
    if not value:
        return None
    try:
        parsed = urllib.parse.urlsplit(value.strip())
        port = parsed.port
    except ValueError:
        return None
    host = (parsed.hostname or "").casefold()
    if (
        parsed.scheme.casefold() != "https"
        or parsed.username is not None
        or parsed.password is not None
        or port not in (None, 443)
        or not (host.endswith(".steamstatic.com") or host in LEGACY_STEAM_IMAGE_HOSTS)
    ):
        return None
    path = urllib.parse.quote(parsed.path, safe="/%:@!$&'*,;=+~.-_")
    query = urllib.parse.quote(parsed.query, safe="/?%:@!$&'*,;=+~.-_")
    return urllib.parse.urlunsplit(("https", parsed.netloc, path, query, ""))


def html_to_text(value: str) -> str:
    """Convert Steam description HTML to text and safe image markers."""
    parser = SynopsisHTMLParser()
    parser.feed(value)
    parser.close()
    return "".join(parser.parts)


def normalize_synopsis(text: str) -> tuple[str, list[str]]:
    """Normalize extracted synopsis text and return review flags."""
    value = text.replace("\r\n", "\n").replace("\r", "\n").translate(SMART_MAP)
    for character in "\u200b\u200c\u200d\ufeff":
        value = value.replace(character, "")
    value = "\n".join(SPACE_RE.sub(" ", line).strip() for line in value.split("\n"))
    value = BLANK_LINE_RE.sub("\n", value).strip()
    flags: list[str] = []
    visible_length = len(STEAM_IMAGE_MARKER_RE.sub("", value).strip())
    if visible_length < 150:
        flags.append(f"short_length:{visible_length}")
    if visible_length > 3000:
        flags.append(f"long_length:{visible_length}")
    if any(not character.isascii() and not character.isalpha() for character in value):
        flags.append("non_ascii_symbol")
    without_images = STEAM_IMAGE_MARKER_RE.sub("", value)
    if re.search(r"<[^>]+>|\[[^\]]+\]\(https?://", without_images):
        flags.append("markup_like_syntax")
    return value, flags


def excluded_game(game: dict[str, Any]) -> bool:
    """Identify Twice Burned from normalized title or slug."""
    return any(
        "twiceburned" in re.sub(r"[^a-z0-9]", "", str(game.get(field) or "").casefold())
        for field in ("title", "slug")
    )


def canonical_steam_link(links: Any) -> tuple[int | None, str | None, str | None]:
    """Return a unique canonical Steam game app link, or an exclusion reason."""
    app_links: list[tuple[int, str]] = []
    malformed_steam = False
    for link in links if isinstance(links, list) else []:
        if not isinstance(link, dict) or link.get("kind") != "download":
            continue
        url = link.get("url")
        if not isinstance(url, str):
            continue
        try:
            parsed = urllib.parse.urlsplit(url)
            port = parsed.port
        except ValueError:
            if "steampowered.com" in url.casefold():
                malformed_steam = True
            continue
        if (parsed.hostname or "").casefold() not in {
            "store.steampowered.com",
            "www.store.steampowered.com",
        }:
            continue
        scheme = parsed.scheme.casefold()
        invalid_port = (
            port is not None and port != (80 if scheme == "http" else 443)
        ) or (":" in parsed.netloc and port is None)
        if (
            scheme not in {"http", "https"}
            or parsed.username
            or parsed.password
            or invalid_port
        ):
            malformed_steam = True
            continue
        match = re.fullmatch(r"/app/([1-9]\d*)(?:/[^/]*)?/?", parsed.path)
        normalized_url = urllib.parse.urlunsplit(
            (
                scheme,
                (parsed.hostname or "").casefold(),
                parsed.path,
                parsed.query,
                parsed.fragment,
            )
        )
        helper_id = extract_steam_appid(normalized_url)
        if (
            not match
            or helper_id is None
            or int(match.group(1)) == 0
            or int(match.group(1)) != helper_id
        ):
            malformed_steam = True
            continue
        app_links.append((helper_id, url))
    appids = {appid for appid, _url in app_links}
    if len(appids) > 1:
        return None, None, "ambiguous_steam_appids"
    if not app_links:
        return None, None, "invalid_steam_link" if malformed_steam else "no_steam_link"
    appid = next(iter(appids))
    urls = sorted({url for candidate, url in app_links if candidate == appid})
    return appid, urls[0], None


def ownership_action(game: dict[str, Any], *, refresh: bool) -> str:
    """Classify ownership before looking up Steam data."""
    synopsis = game.get("synopsis")
    source = game.get("synopsis_source")
    if source == "manual":
        return "protected"
    if source not in (None, "", "steam"):
        return "protected"
    if synopsis and source != "steam":
        return "protected"
    if synopsis and source == "steam" and not refresh:
        return "cached_compare"
    return "eligible"


def atomic_json_write(path: Path, value: Any) -> None:
    """Atomically write JSON to a cache or plan file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    temporary.replace(path)


def load_cache() -> dict[str, Any]:
    """Load complete Steam app detail data from the persistent cache."""
    if not CACHE_PATH.exists():
        return {}
    data = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    return data if isinstance(data, dict) else {}


def fetch_directus_games(client: Any) -> list[dict[str, Any]]:
    """Fetch games, their synopsis ownership fields, and link rows."""
    fields = "id,slug,title,synopsis,synopsis_source,links.url,links.kind"
    path = (
        f"/items/games?filter[slug][_neq]=twice-burned"
        f"&filter[title][_neq]=Twice%20Burned&fields={fields}"
    )
    return [game for game in client.fetch_all(path) if not excluded_game(game)]


def choose_steam_text(details: dict[str, Any]) -> tuple[str, bool] | None:
    """Choose prose and images, retaining image-only descriptions with fallback prose."""
    image_only: tuple[str, bool] | None = None
    for key in ("about_the_game", "detailed_description", "short_description"):
        raw = details.get(key)
        if isinstance(raw, str) and raw.strip():
            visible = html_to_text(raw)
            normalized = normalize_synopsis(visible)[0]
            if STEAM_IMAGE_MARKER_RE.sub("", normalized).strip():
                if image_only:
                    earlier_markers = [
                        match.group(0)
                        for match in STEAM_IMAGE_MARKER_RE.finditer(image_only[0])
                        if match.group(0) not in normalized
                    ]
                    if earlier_markers:
                        normalized = normalize_synopsis(
                            "\n".join((*earlier_markers, normalized))
                        )[0]
                return normalized, key != "about_the_game"
            if (
                normalized
                and STEAM_IMAGE_MARKER_RE.search(normalized)
                and not image_only
            ):
                image_only = (normalized, key != "about_the_game")
    return image_only


def plan_games(
    games: list[dict[str, Any]], *, refresh: bool, only_slugs: set[str]
) -> tuple[list[dict[str, Any]], list[str]]:
    """Build a plan, calling Steam only for selected eligible games."""
    cache = load_cache()
    rows: list[dict[str, Any]] = []
    failures: list[str] = []
    last_request = 0.0
    refreshed_app_data: dict[int, tuple[dict[str, Any] | None, str | None]] = {}
    selected = [
        g
        for g in games
        if not excluded_game(g) and (not only_slugs or g.get("slug") in only_slugs)
    ]
    for index, game in enumerate(selected, start=1):
        appid, steam_url, link_error = canonical_steam_link(game.get("links"))
        action = ownership_action(game, refresh=refresh)
        flags: list[str] = []
        target = ""
        error: str | None = None
        if action in {"eligible", "cached_compare"} and link_error:
            action = link_error
        elif action in {"eligible", "cached_compare"} and appid is not None:
            app_data = cache.get(str(appid))
            if action == "cached_compare" and not isinstance(app_data, dict):
                action = "stale"
            elif action == "eligible" and refresh and appid in refreshed_app_data:
                app_data, error = refreshed_app_data[appid]
            elif action == "eligible" and (refresh or not isinstance(app_data, dict)):
                elapsed = time.monotonic() - last_request
                if last_request and elapsed < STEAM_DELAY_S:
                    time.sleep(STEAM_DELAY_S - elapsed)
                app_data, error = fetch_steam_details(appid, base_delay=2.0)
                last_request = time.monotonic()
                if refresh:
                    refreshed_app_data[appid] = (app_data, error)
                if app_data:
                    cache[str(appid)] = app_data
                    atomic_json_write(CACHE_PATH, cache)
            if action != "stale" and error:
                action = "failed"
                failures.append(f"{game.get('slug')}: {error}")
            elif action != "stale" and not isinstance(app_data, dict):
                action = "no_data"
            elif (
                action != "stale"
                and isinstance(app_data, dict)
                and app_data.get("type") != "game"
            ):
                action = "non_game_store_entry"
            elif (
                action != "stale"
                and isinstance(app_data, dict)
                and app_data.get("steam_appid") is not None
                and str(app_data["steam_appid"]) != str(appid)
            ):
                action = "steam_appid_mismatch"
            elif action != "stale" and isinstance(app_data, dict):
                selected_text = choose_steam_text(app_data)
                if selected_text is None:
                    action = "no_description"
                else:
                    raw, fallback = selected_text
                    target, flags = normalize_synopsis(raw)
                    if fallback:
                        flags.append("description_fallback")
                    if not target.strip():
                        action = "no_description"
                    elif target == game.get("synopsis"):
                        action = "unchanged"
                    elif (
                        game.get("synopsis") and game.get("synopsis_source") == "steam"
                    ):
                        action = "update" if refresh else "stale"
                    else:
                        action = "create"
        row = {
            "id": game.get("id"),
            "slug": game.get("slug"),
            "title": game.get("title"),
            "action": action,
            "appid": appid,
            "steam_url": steam_url,
            "old_synopsis": game.get("synopsis"),
            "old_synopsis_source": game.get("synopsis_source"),
            "new_synopsis": target,
            "flags": flags,
        }
        if error:
            row["error"] = error
        rows.append(row)
        print(
            f"({index}/{len(selected)} processed: {index * 100 / max(1, len(selected)):.1f}%) {game.get('slug')}: {action}",
            flush=True,
        )
    return rows, failures


def write_review(plan: list[dict[str, Any]]) -> None:
    """Write a readable review report with counts and synopsis samples."""
    counts = Counter(row["action"] for row in plan)
    lines = ["# Steam synopsis backfill review", "", "## Summary", ""]
    lines.extend(f"- {action}: {count}" for action, count in sorted(counts.items()))
    lines.extend(["", "## Flagged anomalies", ""])
    for row in plan:
        if row["flags"]:
            lines.append(
                f"- `{row['slug']}` (Steam app {row.get('appid')}): {', '.join(row['flags'])}"
            )
    lines.extend(["", "## Planned changes", ""])
    candidates = [row for row in plan if row["action"] in {"create", "update"}]
    for row in candidates:
        lines.extend(
            [
                f"### {row.get('title')} (`{row.get('slug')}`)",
                "",
                f"Steam: {row.get('steam_url')}",
                "",
                "Before:",
                "",
                "```text",
                str(row.get("old_synopsis") or "")[:600],
                "```",
                "",
                "After:",
                "",
                "```text",
                str(row.get("new_synopsis") or "")[:600],
                "```",
                "",
            ]
        )
    REVIEW_PATH.parent.mkdir(parents=True, exist_ok=True)
    REVIEW_PATH.write_text("\n".join(lines), encoding="utf-8")


def current_canonical_link(
    game: dict[str, Any],
) -> tuple[int | None, str | None, str | None]:
    """Resolve Steam link from a single-game Directus response."""
    return canonical_steam_link(game.get("links"))


def apply_plan(only_slugs: set[str]) -> int:
    """Apply a saved plan with stale ownership and Steam-link checks."""
    if not PLAN_PATH.exists():
        raise RuntimeError(f"Plan not found: {PLAN_PATH}; run a dry run first")
    plan = json.loads(PLAN_PATH.read_text(encoding="utf-8"))
    progress = (
        json.loads(PROGRESS_PATH.read_text(encoding="utf-8"))
        if PROGRESS_PATH.exists()
        else {}
    )
    if not isinstance(progress, dict):
        progress = {}
    client = RetryingDirectusClient(DirectusClient.from_config())
    candidates = [
        row
        for row in plan
        if row.get("action") in {"create", "update"}
        and (not only_slugs or row.get("slug") in only_slugs)
    ]
    updated = skipped = errors = 0
    for index, row in enumerate(candidates, start=1):
        if excluded_game(row):
            skipped += 1
            continue
        if (
            not isinstance(row.get("new_synopsis"), str)
            or not row["new_synopsis"].strip()
        ):
            print(f"Skipped {row.get('slug')}: empty planned synopsis", file=sys.stderr)
            skipped += 1
            continue
        game_id = int(row["id"])
        try:
            current = (
                client.get(
                    f"/items/games/{game_id}",
                    params={
                        "fields": "id,slug,title,synopsis,synopsis_source,links.url,links.kind"
                    },
                ).get("data")
                or {}
            )
            if (
                not current
                or excluded_game(current)
                or current.get("slug") != row.get("slug")
            ):
                skipped += 1
                continue
            appid, steam_url, link_error = current_canonical_link(current)
            if (
                link_error
                or appid != row.get("appid")
                or steam_url != row.get("steam_url")
            ):
                print(
                    f"Skipped {row.get('slug')}: Steam link changed or is ambiguous",
                    file=sys.stderr,
                )
                skipped += 1
                continue
            source = current.get("synopsis_source")
            synopsis = current.get("synopsis")
            if (
                source == "manual"
                or (source not in (None, "", "steam"))
                or (synopsis and source != "steam")
            ):
                skipped += 1
                continue
            if synopsis == row.get("new_synopsis") and source == "steam":
                skipped += 1
                progress[str(game_id)] = "done"
                continue
            if synopsis != row.get("old_synopsis") or source != row.get(
                "old_synopsis_source"
            ):
                print(
                    f"Skipped {row.get('slug')}: stale synopsis/source", file=sys.stderr
                )
                skipped += 1
                continue
            client.patch(
                f"/items/games/{game_id}",
                {"synopsis": row["new_synopsis"], "synopsis_source": "steam"},
            )
            updated += 1
            progress[str(game_id)] = "done"
        except Exception as exc:  # noqa: BLE001 - Report each write failure and continue.
            print(f"Failed {row.get('slug')} (id={game_id}): {exc}", file=sys.stderr)
            errors += 1
        if index % 25 == 0:
            atomic_json_write(PROGRESS_PATH, progress)
        print(f"({index}/{len(candidates)} processed) {row.get('slug')}", flush=True)
    atomic_json_write(PROGRESS_PATH, progress)
    print(f"Apply summary: updated={updated}, skipped={skipped}, errors={errors}")
    return 1 if errors else 0


def self_test() -> int:
    """Run offline parser, link, ownership, and apply guard checks."""
    checks = 0

    def check(condition: bool, label: str) -> None:
        nonlocal checks
        if not condition:
            raise AssertionError(label)
        checks += 1
        print(f"PASS {label}")

    extracted = html_to_text(
        "<h2>Title &amp; More</h2><p>A&nbsp;line<br>next</p><ul><li>one</li><li>two</li></ul><script>alert(1)</script><img src='x' alt='hidden'>"
    )
    check(
        "Title & More" in extracted
        and "A\u00a0line\nnext" in extracted
        and "one" in extracted
        and "two" in extracted,
        "HTML headings, paragraphs, breaks, lists, and entities",
    )
    check(
        "alert" not in extracted
        and "hidden" not in extracted
        and "<p>" not in extracted,
        "HTML active and media content removal",
    )
    image_html = html_to_text(
        '<p>Before</p><img src="https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/123/extras/banner_(1).avif?t=42" alt="Banner [one]">'
    )
    check(
        "![Banner one](https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/123/extras/banner_%281%29.avif?t=42)"
        in image_html,
        "Steam CDN image markers encode closing parentheses and sanitize alt text",
    )
    image_only_about = '<img src="https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/123/extras/banner.avif" alt="Banner">'
    image_fallback = choose_steam_text(
        {
            "about_the_game": image_only_about,
            "detailed_description": "<p>Fallback prose.</p>",
        }
    )
    check(
        image_fallback is not None
        and "![Banner](https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/123/extras/banner.avif)"
        in image_fallback[0]
        and "Fallback prose." in image_fallback[0]
        and image_fallback[1],
        "image-only About content retains its image and falls back to available prose",
    )
    check(
        choose_steam_text({"about_the_game": image_only_about})
        == (
            "![Banner](https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/123/extras/banner.avif)",
            False,
        ),
        "image-only descriptions remain usable when no prose fallback exists",
    )
    check(
        steam_image_url("https://evil.example/image.png") is None
        and steam_image_url("http://shared.akamai.steamstatic.com/image.png") is None,
        "image URLs outside HTTPS Steam CDN hosts are rejected",
    )
    wrapped_html = html_to_text(
        "<p>Wrapped\n source <em>with\tinline</em>\r\nmarkup</p>"
        "<p>Next<br>line</p><ul><li>one</li><li>two</li></ul>"
    )
    wrapped_text = normalize_synopsis(wrapped_html)[0]
    check(
        wrapped_text == "Wrapped source with inline markup\nNext\nline\none\ntwo",
        "HTML source whitespace collapses while explicit block and br boundaries remain",
    )
    void_media = html_to_text(
        "before<source src='a'>middle<track src='b'><embed src='c'>after"
        "<video><source src='d'>fallback</video><p>Keep</p>"
    )
    check(
        "beforemiddleafter" in void_media
        and "Keep" in void_media
        and "fallback" not in void_media,
        "standalone and nested void media tags do not swallow following text",
    )
    normalized, flags = normalize_synopsis(
        "\ufeffOne\r\n\r\n  Deux\u200b \u2014 café\u2026"
    )
    check(
        normalized == "One\nDeux - café..." and "\u200b" not in normalized,
        "text whitespace, zero-width, punctuation, and accents",
    )
    check(
        any(flag.startswith("short_length:") for flag in flags), "length anomaly flag"
    )
    appid, url, error = canonical_steam_link(
        [{"kind": "download", "url": "https://store.steampowered.com/app/123/game/"}]
    )
    check(
        (appid, url, error)
        == (123, "https://store.steampowered.com/app/123/game/", None),
        "canonical Steam game URL",
    )
    check(
        canonical_steam_link(
            [{"kind": "download", "url": "https://STORE.STEAMPOWERED.COM/app/789/"}]
        )[0]
        == 789,
        "uppercase Steam host still resolves its app ID",
    )
    check(
        canonical_steam_link(
            [
                {
                    "kind": "download",
                    "url": "https://store.steampowered.com/app/123/a/",
                },
                {
                    "kind": "download",
                    "url": "https://store.steampowered.com/app/456/b/",
                },
            ]
        )[2]
        == "ambiguous_steam_appids",
        "ambiguous app IDs rejected",
    )
    check(
        canonical_steam_link(
            [
                {"kind": "download", "url": "https://store.steampowered.com/app/123/"},
                {"kind": "download", "url": "https://STORE.STEAMPOWERED.COM/app/456/"},
            ]
        )[2]
        == "ambiguous_steam_appids",
        "mixed-case hosts with different app IDs remain ambiguous",
    )
    check(
        canonical_steam_link(
            [{"kind": "other", "url": "https://store.steampowered.com/app/123/"}]
        )[2]
        == "no_steam_link",
        "non-download and unrelated link kinds rejected",
    )
    check(
        canonical_steam_link(
            [{"kind": "download", "url": "https://store.steampowered.com/app/0/"}]
        )[2]
        == "invalid_steam_link",
        "zero Steam app ID rejected",
    )
    check(
        canonical_steam_link(
            [{"kind": "download", "url": "https://store.steampowered.com/app/0123/"}]
        )[2]
        == "invalid_steam_link",
        "leading-zero Steam app ID rejected",
    )
    check(
        canonical_steam_link(
            [{"kind": "download", "url": "https://store.steampowered.com:443/app/123/"}]
        )[0]
        == 123
        and canonical_steam_link(
            [
                {
                    "kind": "download",
                    "url": "https://store.steampowered.com:8443/app/123/",
                }
            ]
        )[2]
        == "invalid_steam_link",
        "default Steam port accepted and nonstandard port rejected",
    )
    check(
        canonical_steam_link(
            [
                {
                    "kind": "download",
                    "url": "https://[broken/store.steampowered.com/app/123/",
                }
            ]
        )[2]
        == "invalid_steam_link",
        "malformed Steam URL reported instead of raising",
    )
    check(
        excluded_game({"title": "Twice-Burned"})
        and excluded_game({"slug": "twice_burned"}),
        "Twice Burned normalized exclusion",
    )
    check(
        ownership_action({"synopsis": None, "synopsis_source": "manual"}, refresh=True)
        == "protected",
        "blank manual synopsis protected",
    )
    check(
        ownership_action({"synopsis": "GSL", "synopsis_source": "gsl"}, refresh=True)
        == "protected",
        "GSL synopsis protected",
    )
    check(
        ownership_action({"synopsis": "old", "synopsis_source": "steam"}, refresh=False)
        == "cached_compare"
        and ownership_action(
            {"synopsis": "old", "synopsis_source": "steam"}, refresh=True
        )
        == "eligible",
        "refresh only enables Steam-owned replacement",
    )

    module = sys.modules[__name__]
    fallback_details = {
        "about_the_game": "<img src='cover.jpg'> \u200b",
        "detailed_description": "<p>Visible fallback text</p>",
    }
    check(
        choose_steam_text(fallback_details) == ("Visible fallback text", True),
        "image-only full description falls back to visible detailed text",
    )
    check(
        choose_steam_text({"about_the_game": "<img src='cover.jpg'>"}) is None,
        "image-only descriptions never produce an empty target",
    )

    existing_text = "An existing Steam synopsis."
    refreshed_text = "A refreshed Steam synopsis with enough visible content."
    existing_game = {
        "id": 10,
        "slug": "existing",
        "title": "Existing",
        "synopsis": existing_text,
        "synopsis_source": "steam",
        "links": [
            {"kind": "download", "url": "https://store.steampowered.com/app/123/"}
        ],
    }
    cached_details = {
        "type": "game",
        "steam_appid": 123,
        "about_the_game": existing_text,
    }
    refreshed_details = {
        "type": "game",
        "steam_appid": 123,
        "about_the_game": refreshed_text,
    }
    with tempfile.TemporaryDirectory() as cache_dir:
        temp_cache = Path(cache_dir) / "steam-cache.json"
        with (
            patch.object(module, "CACHE_PATH", temp_cache),
            patch.object(module, "load_cache", return_value={"123": cached_details}),
            patch.object(
                module,
                "fetch_steam_details",
                side_effect=AssertionError("normal comparison should use cache"),
            ),
        ):
            normal_rows, _ = plan_games(
                [existing_game], refresh=False, only_slugs=set()
            )
        check(
            normal_rows[0]["action"] == "unchanged",
            "normal dry run compares Steam-owned text from cache",
        )
        changed_cached_details = {
            **cached_details,
            "about_the_game": refreshed_text,
        }
        with (
            patch.object(module, "CACHE_PATH", temp_cache),
            patch.object(
                module, "load_cache", return_value={"123": changed_cached_details}
            ),
            patch.object(
                module,
                "fetch_steam_details",
                side_effect=AssertionError("normal comparison should not fetch Steam"),
            ),
        ):
            stale_rows, _ = plan_games([existing_game], refresh=False, only_slugs=set())
        check(
            stale_rows[0]["action"] == "stale",
            "changed cached target stays stale until refresh is requested",
        )
        with (
            patch.object(module, "CACHE_PATH", temp_cache),
            patch.object(module, "load_cache", return_value={}),
            patch.object(
                module,
                "fetch_steam_details",
                side_effect=AssertionError("missing cache must not fetch normally"),
            ),
        ):
            no_cache_rows, _ = plan_games(
                [existing_game], refresh=False, only_slugs=set()
            )
        check(
            no_cache_rows[0]["action"] == "stale",
            "missing cached comparison is reported as stale",
        )
        shared_app_games = [
            existing_game,
            {**existing_game, "id": 11, "slug": "existing-copy"},
        ]
        with (
            patch.object(module, "CACHE_PATH", temp_cache),
            patch.object(module, "load_cache", return_value={"123": cached_details}),
            patch.object(
                module,
                "fetch_steam_details",
                return_value=(refreshed_details, None),
            ) as fetch_details,
        ):
            refreshed_rows, _ = plan_games(
                shared_app_games, refresh=True, only_slugs=set()
            )
        check(
            [row["action"] for row in refreshed_rows] == ["update", "update"],
            "refresh fetches current text for Steam-owned synopses",
        )
        check(fetch_details.call_count == 1, "refresh deduplicates Steam app IDs")

    with tempfile.TemporaryDirectory() as tmp:
        directory = Path(tmp)
        plan_path = directory / "plan.json"
        progress_path = directory / "progress.json"
        plan_path.write_text(
            json.dumps(
                [
                    {
                        "id": 9,
                        "slug": "game",
                        "title": "Game",
                        "action": "create",
                        "appid": 123,
                        "steam_url": "https://store.steampowered.com/app/123/",
                        "old_synopsis": None,
                        "old_synopsis_source": None,
                        "new_synopsis": "New text",
                    }
                ]
            ),
            encoding="utf-8",
        )
        current = {
            "data": {
                "id": 9,
                "slug": "game",
                "title": "Game",
                "synopsis": None,
                "synopsis_source": None,
                "links": [
                    {
                        "kind": "download",
                        "url": "https://store.steampowered.com/app/123/",
                    }
                ],
            }
        }
        fake_client = Mock()
        fake_client.get.return_value = current
        with (
            patch.object(module, "PLAN_PATH", plan_path),
            patch.object(module, "PROGRESS_PATH", progress_path),
            patch.object(DirectusClient, "from_config", return_value=fake_client),
            patch.object(
                module, "RetryingDirectusClient", side_effect=lambda client: client
            ),
            patch.object(
                module,
                "fetch_steam_details",
                side_effect=AssertionError("apply made Steam request"),
            ),
        ):
            check(apply_plan(set()) == 0, "apply uses saved plan without Steam request")
        fake_client.patch.assert_called_once()
        fake_client.get.return_value["data"]["synopsis"] = "New text"
        fake_client.get.return_value["data"]["synopsis_source"] = "steam"
        with (
            patch.object(module, "PLAN_PATH", plan_path),
            patch.object(module, "PROGRESS_PATH", progress_path),
            patch.object(DirectusClient, "from_config", return_value=fake_client),
            patch.object(
                module, "RetryingDirectusClient", side_effect=lambda client: client
            ),
        ):
            check(apply_plan(set()) == 0, "idempotent apply skips current target")
        check(
            fake_client.patch.call_count == 1, "idempotent apply does not write twice"
        )
        fake_client.get.return_value["data"]["synopsis"] = None
        fake_client.get.return_value["data"]["synopsis_source"] = "steam"
        with (
            patch.object(module, "PLAN_PATH", plan_path),
            patch.object(module, "PROGRESS_PATH", progress_path),
            patch.object(DirectusClient, "from_config", return_value=fake_client),
            patch.object(
                module, "RetryingDirectusClient", side_effect=lambda client: client
            ),
        ):
            check(apply_plan(set()) == 0, "source-only change is skipped as stale")
        check(fake_client.patch.call_count == 1, "stale source does not write")
        fake_client.get.return_value["data"]["synopsis_source"] = "manual"
        with (
            patch.object(module, "PLAN_PATH", plan_path),
            patch.object(module, "PROGRESS_PATH", progress_path),
            patch.object(DirectusClient, "from_config", return_value=fake_client),
            patch.object(
                module, "RetryingDirectusClient", side_effect=lambda client: client
            ),
        ):
            check(apply_plan(set()) == 0, "apply protects blank manual synopsis")
        check(fake_client.patch.call_count == 1, "blank manual synopsis does not write")
        fake_client.get.return_value["data"]["synopsis"] = None
        fake_client.get.return_value["data"]["synopsis_source"] = None
        fake_client.get.return_value["data"]["links"][0]["url"] = (
            "https://store.steampowered.com/app/456/"
        )
        with (
            patch.object(module, "PLAN_PATH", plan_path),
            patch.object(module, "PROGRESS_PATH", progress_path),
            patch.object(DirectusClient, "from_config", return_value=fake_client),
            patch.object(
                module, "RetryingDirectusClient", side_effect=lambda client: client
            ),
        ):
            check(apply_plan(set()) == 0, "changed Steam link is skipped")
        check(fake_client.patch.call_count == 1, "stale link does not write")
        fake_client.get.return_value["data"]["links"] = [
            {"kind": "download", "url": "https://store.steampowered.com/app/123/"},
            {
                "kind": "download",
                "url": "https://STORE.STEAMPOWERED.COM/app/456/",
            },
        ]
        with (
            patch.object(module, "PLAN_PATH", plan_path),
            patch.object(module, "PROGRESS_PATH", progress_path),
            patch.object(DirectusClient, "from_config", return_value=fake_client),
            patch.object(
                module, "RetryingDirectusClient", side_effect=lambda client: client
            ),
        ):
            check(apply_plan(set()) == 0, "apply skips newly ambiguous Steam links")
        check(fake_client.patch.call_count == 1, "ambiguous links do not write")
    print(f"Self-test passed: {checks} checks")
    return 0


def main() -> int:
    """Run dry-run planning or apply a previously saved plan."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="apply the saved JSON plan; never calls Steam",
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="update existing Steam-sourced synopsis values",
    )
    parser.add_argument(
        "--only-slug",
        action="append",
        default=[],
        help="limit planning/apply to this Directus slug (repeatable)",
    )
    parser.add_argument("--self-test", action="store_true", help="run offline tests")
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    only_slugs = set(args.only_slug)
    if args.apply:
        return apply_plan(only_slugs)
    client = RetryingDirectusClient(DirectusClient.from_config())
    games = fetch_directus_games(client)
    plan, failures = plan_games(games, refresh=args.refresh, only_slugs=only_slugs)
    atomic_json_write(PLAN_PATH, plan)
    write_review(plan)
    counts = Counter(row["action"] for row in plan)
    print(
        "Dry-run summary: "
        + ", ".join(f"{key}={value}" for key, value in sorted(counts.items()))
    )
    print(f"Plan: {PLAN_PATH}\nReview: {REVIEW_PATH}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
