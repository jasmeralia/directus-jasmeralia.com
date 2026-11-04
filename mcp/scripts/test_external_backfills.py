"""Offline tests for itch synopsis and console store-link backfills."""

# pylint: disable=missing-function-docstring,missing-class-docstring,wrong-import-position,protected-access

from __future__ import annotations

import json
import sys
import tempfile
import unittest
import urllib.error
from email.message import Message
from pathlib import Path
from unittest.mock import Mock, mock_open, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

fake_config = {
    "mcpServers": {
        "directus": {
            "env": {"DIRECTUS_URL": "https://example.invalid", "DIRECTUS_TOKEN": "test"}
        },
        "game-encyclopedia": {
            "env": {"TWITCH_CLIENT_ID": "test", "TWITCH_CLIENT_SECRET": "test"}
        },
    }
}
with patch("builtins.open", mock_open(read_data=json.dumps(fake_config))):
    import backfill_console_links as console
import backfill_itch_synopsis as itch
import repair_console_search_links as repair


def avn_game(**changes):
    game = {
        "id": 1,
        "slug": "sample-avn",
        "title": "Sample AVN",
        "synopsis": None,
        "synopsis_source": None,
        "genres": [{"genres_id": {"name": "AVN"}}],
        "links": [
            {
                "id": 10,
                "kind": "download",
                "url": "https://sample.itch.io/sample-game",
            }
        ],
    }
    game.update(changes)
    return game


def console_game(url="https://store.playstation.com/en-us/search/SAMPLE"):
    return {
        "id": 7,
        "slug": "sample-game",
        "title": "Sample Game",
        "links": [{"id": 70, "kind": "download", "url": url}],
    }


class FakeClient:
    def __init__(self, current_by_id):
        self.current_by_id = current_by_id
        self.base_client = object()
        self.patches = []
        self.games = []

    def get(self, path, **_kwargs):
        game_id = int(path.rsplit("/", 1)[-1])
        value = self.current_by_id[game_id]
        if isinstance(value, Exception):
            raise value
        return {"data": value}

    def patch(self, path, payload, **_kwargs):
        self.patches.append((path, payload))

    def fetch_all(self, *_args, **_kwargs):
        return self.games


class ItchSynopsisTests(unittest.TestCase):
    def test_metadata_parser_prefers_open_graph_and_reads_title(self):
        parser = itch.ItchMetadataParser()
        parser.feed(
            "<title>Game Page</title>"
            '<meta name="description" content="Plain summary">'
            '<meta property="og:description" content="Preferred summary">'
        )
        self.assertEqual(parser.description(), "Preferred summary")
        self.assertEqual("".join(parser.title_parts), "Game Page")

    def test_metadata_parser_falls_back_to_description_then_twitter(self):
        parser = itch.ItchMetadataParser()
        parser.feed('<meta name="twitter:description" content="Tweet">')
        self.assertEqual(parser.description(), "Tweet")
        parser = itch.ItchMetadataParser()
        parser.feed('<meta name="description" content="Description">')
        self.assertEqual(parser.description(), "Description")

    def test_canonical_itch_url_accepts_game_pages_and_rejects_unsafe_urls(self):
        self.assertEqual(
            itch.canonical_itch_url("https://www.sample.itch.io/game/?utm=1#top"),
            "https://www.sample.itch.io/game",
        )
        for invalid in (
            "http://sample.itch.io/game",
            "https://itch.io/profile/sample",
            "https://sample.itch.io/",
            "https://user@sample.itch.io/game",
            "https://sample.itch.io:444/game",
            "not a URL",
        ):
            with self.subTest(invalid=invalid):
                self.assertIsNone(itch.canonical_itch_url(invalid))

    def test_itch_links_deduplicates_and_ignores_other_kinds(self):
        game = avn_game(
            links=[
                {"kind": "download", "url": "https://sample.itch.io/game/"},
                {"kind": "download", "url": "https://sample.itch.io/game"},
                {"kind": "other", "url": "https://elsewhere.itch.io/other"},
            ]
        )
        self.assertEqual(itch.itch_links(game), ["https://sample.itch.io/game"])

    def test_plan_rows_creates_cached_synopsis_and_protects_other_games(self):
        game = avn_game()
        cache = {
            "https://sample.itch.io/sample-game": {
                "status": "found",
                "page_title": "Sample Page",
                "description": "A quiet story about a lost traveler.",
            }
        }
        rows = itch.plan_rows(
            [
                game,
                avn_game(id=2, slug="not-avn", genres=[]),
                avn_game(id=3, title="Twice Burned"),
                avn_game(id=4, synopsis_source="steam"),
                avn_game(id=5, synopsis="Already filled."),
                avn_game(id=6, links=[]),
                avn_game(
                    id=7,
                    links=avn_game()["links"]
                    + [{"kind": "download", "url": "https://two.itch.io/game"}],
                ),
            ],
            selected_slugs=set(),
            cache=cache,
            refresh=False,
            delay=1.5,
        )
        self.assertEqual(rows[0]["action"], "create")
        self.assertEqual(rows[0]["synopsis"], "A quiet story about a lost traveler.")
        self.assertEqual(rows[0]["page_title"], "Sample Page")
        self.assertEqual(rows[1]["reason"], "not AVN")
        self.assertEqual(rows[2]["reason"], "excluded game")
        self.assertEqual(rows[3]["reason"], "another source owns the synopsis")
        self.assertEqual(rows[4]["reason"], "synopsis is not blank")
        self.assertEqual(rows[5]["reason"], "no itch link")
        self.assertEqual(rows[6]["reason"], "multiple itch links")

    def test_plan_rows_reviews_platform_only_missing_and_error_descriptions(self):
        url = "https://sample.itch.io/sample-game"
        rows = itch.plan_rows(
            [
                avn_game(),
                avn_game(
                    id=2,
                    links=[
                        {
                            "kind": "download",
                            "url": "https://error.itch.io/sample-game",
                        }
                    ],
                ),
                avn_game(
                    id=3,
                    links=[
                        {
                            "kind": "download",
                            "url": "https://empty.itch.io/sample-game",
                        }
                    ],
                ),
            ],
            selected_slugs=set(),
            cache={
                url: {"status": "found", "description": "Available for Windows"},
                "https://error.itch.io/sample-game": {
                    "status": "error",
                    "error": "not_found",
                },
                "https://empty.itch.io/sample-game": {"status": "found"},
            },
            refresh=False,
            delay=0,
        )
        self.assertEqual(rows[0]["action"], "review")
        self.assertEqual(
            rows[0]["reason"], "itch description contains only platform availability"
        )
        self.assertEqual(rows[1]["reason"], "not_found")
        self.assertEqual(rows[2]["reason"], "no page description")

        failed = itch.plan_rows(
            [avn_game()],
            selected_slugs=set(),
            cache={url: {"status": "error", "error": "http_403"}},
            refresh=False,
            delay=0,
        )
        self.assertEqual(failed[0]["reason"], "http_403")

    def test_plan_rows_fetches_uncached_page_and_applies_slug_filter(self):
        game = avn_game()
        with (
            patch.object(
                itch, "fetch_page", return_value=({"description": "Fresh"}, None)
            ) as fetch,
            patch.object(itch, "atomic_write") as save,
        ):
            rows = itch.plan_rows(
                [game, avn_game(id=2, slug="ignored")],
                selected_slugs={"sample-avn"},
                cache={},
                refresh=True,
                delay=0,
            )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["action"], "create")
        fetch.assert_called_once_with("https://sample.itch.io/sample-game")
        save.assert_called_once()

    def test_fetch_page_retries_rate_limit_and_parses_retry_after(self):
        headers = Message()
        headers["Retry-After"] = "2"
        limited = urllib.error.HTTPError("url", 429, "limited", headers, None)
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = b'<meta property="og:description" content="Ok">'
        with (
            patch.object(
                itch.urllib.request, "urlopen", side_effect=[limited, response]
            ),
            patch.object(itch.time, "sleep") as sleep,
        ):
            result, error = itch.fetch_page("https://sample.itch.io/game")
        self.assertIsNone(error)
        assert result is not None
        self.assertEqual(result["description"], "Ok")
        sleep.assert_called_once_with(2.0)

    def test_fetch_page_stops_on_not_found_and_other_http_errors(self):
        for code, expected in ((404, "not_found"), (500, "http_500")):
            with patch.object(
                itch.urllib.request,
                "urlopen",
                side_effect=urllib.error.HTTPError(
                    "url", code, "error", Message(), None
                ),
            ):
                result, error = itch.fetch_page("https://sample.itch.io/game")
            self.assertIsNone(result)
            self.assertEqual(error, expected)

    def test_json_helpers_and_review_writer(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cache.json"
            itch.atomic_write(path, {"ok": True})
            self.assertEqual(itch.load_json(path, {}), {"ok": True})
            path.write_text("broken", encoding="utf-8")
            self.assertEqual(itch.load_json(path, "fallback"), "fallback")
            with patch.object(itch, "REVIEW_PATH", path):
                itch.write_review(
                    [{"title": "Needs review", "slug": "review", "action": "review"}]
                )
            self.assertIn("Needs review", path.read_text(encoding="utf-8"))

    def test_apply_plan_updates_matching_rows_and_skips_changed_rows(self):
        matching = avn_game()
        changed = avn_game(id=2, slug="changed")
        changed["synopsis"] = "Now filled"
        client = FakeClient({1: matching, 2: changed})
        rows = [
            {
                "id": 1,
                "slug": "sample-avn",
                "action": "create",
                "old_synopsis": None,
                "old_synopsis_source": None,
                "itch_url": "https://sample.itch.io/sample-game",
                "synopsis": "New synopsis",
            },
            {
                "id": 2,
                "slug": "changed",
                "action": "create",
                "old_synopsis": None,
                "old_synopsis_source": None,
                "itch_url": "https://sample.itch.io/sample-game",
                "synopsis": "New synopsis",
            },
        ]
        with (
            patch.object(itch, "load_json", return_value={"rows": rows}),
            patch.object(itch, "DirectusClient") as directus,
            patch.object(itch, "RetryingDirectusClient", return_value=client),
            patch.object(itch, "trigger_site_rebuild") as rebuild,
        ):
            directus.from_config.return_value = object()
            result = itch.apply_plan(set())
        self.assertEqual(result, 0)
        self.assertEqual(
            client.patches,
            [
                (
                    "/items/games/1",
                    {"synopsis": "New synopsis", "synopsis_source": "itch"},
                )
            ],
        )
        rebuild.assert_called_once_with(client.base_client, [1])

    def test_apply_plan_reports_errors_and_missing_plan(self):
        with (
            patch.object(itch, "load_json", return_value=None),
            self.assertRaises(TypeError),
        ):
            itch.apply_plan(set())
        with tempfile.TemporaryDirectory() as directory:
            client = FakeClient({1: RuntimeError("offline")})
            rows = [{"id": 1, "slug": "sample-avn", "action": "create"}]
            with (
                patch.object(itch, "PLAN_PATH", Path(directory) / "plan.json"),
                patch.object(itch, "load_json", return_value={"rows": rows}),
                patch.object(itch, "DirectusClient") as directus,
                patch.object(itch, "RetryingDirectusClient", return_value=client),
                patch.object(itch, "trigger_site_rebuild") as rebuild,
            ):
                directus.from_config.return_value = object()
                self.assertEqual(itch.apply_plan(set()), 1)
            rebuild.assert_not_called()

    def test_main_rejects_invalid_limit(self):
        with (
            patch.object(sys, "argv", ["backfill_itch_synopsis.py", "--limit", "0"]),
            self.assertRaises(SystemExit),
        ):
            itch.main()

    def test_main_dry_run_writes_plan_and_apply_delegates(self):
        game = avn_game()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            client = FakeClient({})
            client.games = [game]
            with (
                patch.object(
                    sys,
                    "argv",
                    [
                        "backfill_itch_synopsis.py",
                        "--only-slug",
                        "sample-avn",
                        "--limit",
                        "1",
                        "--delay",
                        "0",
                    ],
                ),
                patch.object(itch, "CACHE_PATH", root / "cache.json"),
                patch.object(itch, "PLAN_PATH", root / "plan.json"),
                patch.object(itch, "REVIEW_PATH", root / "review.md"),
                patch.object(itch, "DirectusClient") as directus,
                patch.object(itch, "RetryingDirectusClient", return_value=client),
                patch.object(
                    itch, "fetch_page", return_value=({"description": "Summary"}, None)
                ),
            ):
                directus.from_config.return_value = object()
                self.assertEqual(itch.main(), 0)
            self.assertEqual(
                json.loads((root / "plan.json").read_text())["rows"][0]["action"],
                "create",
            )
            self.assertTrue((root / "review.md").exists())

        with (
            patch.object(
                sys,
                "argv",
                ["backfill_itch_synopsis.py", "--apply", "--only-slug", "sample-avn"],
            ),
            patch.object(itch, "apply_plan", return_value=3) as apply,
        ):
            self.assertEqual(itch.main(), 3)
        apply.assert_called_once_with({"sample-avn"})

    def test_main_rejects_negative_delay(self):
        with (
            patch.object(sys, "argv", ["backfill_itch_synopsis.py", "--delay", "-1"]),
            self.assertRaises(SystemExit),
        ):
            itch.main()


class ConsoleLinkTests(unittest.TestCase):
    def test_psn_catalog_parser_keeps_only_unique_game_products(self):
        payload = {
            "links": [
                {
                    "id": "UP0001-CUSA00001",
                    "name": "Game",
                    "container_type": "product",
                    "game_contentType": "Full Game",
                },
                {
                    "id": "UP0001-CUSA00001",
                    "name": "Duplicate",
                    "container_type": "product",
                    "game_contentType": "Full Game",
                },
                {
                    "id": "UP0001-CUSA00002",
                    "name": "DLC",
                    "container_type": "product",
                    "game_contentType": "Add-on",
                },
                {"id": "bad", "name": "Not a product", "container_type": "concept"},
            ]
        }
        rows = console._parse_psn_search(json.dumps(payload).encode())
        self.assertEqual(len(rows), 1)
        self.assertEqual(
            rows[0]["url"],
            "https://store.playstation.com/en-us/product/UP0001-CUSA00001",
        )

    def test_psn_search_uses_public_catalog_endpoint(self):
        with patch.object(
            console, "fetch_with_backoff", return_value=([], None)
        ) as fetch:
            self.assertEqual(console.psn_search("A & B"), ([], None))
        self.assertIn("/tumbler/US/en/999/A%20%26%20B", fetch.call_args.args[0])
        self.assertIs(fetch.call_args.kwargs["parse"], console._parse_psn_search)

    def test_public_result_helpers_and_similarity(self):
        self.assertTrue(console.psn_result_is_non_game("Soundtrack", "Full Game"))
        self.assertFalse(console.psn_result_is_non_game("Sample Game", "Full Game"))
        self.assertTrue(console.xbox_result_is_pc_only("Sample Game (PC)"))
        self.assertTrue(console.xbox_result_is_non_game("Sample Game Upgrade Pack"))
        self.assertFalse(console.xbox_result_is_non_game("Sample Game"))
        self.assertGreater(
            console.store_title_similarity("Sample", "Sample Director's Cut"), 0.8
        )

    def test_title_matching_protects_sequels_and_prefers_newer_generations(self):
        self.assertEqual(repair.installment_numbers("Game II"), {"2"})
        self.assertEqual(repair.installment_numbers("King of Fighters XV"), {"15"})
        self.assertEqual(
            repair.normalized_similarity(
                "Killzone Shadow Fall", "KILLZONE SHADOW FALL™"
            ),
            1.0,
        )
        self.assertLess(repair.protect_sequel_match("Game 2", "Game 3", 1.0), 0.6)
        psn = [
            {
                "name": "Death Stranding",
                "url": "https://store.playstation.com/en-us/product/UP-CUSA123",
            },
            {
                "name": "Death Stranding Director’s Cut",
                "url": "https://store.playstation.com/en-us/product/UP-PPSA123",
            },
        ]
        psn_choice = repair.psn_best_latest("Death Stranding", psn)[2]
        assert psn_choice is not None
        self.assertIn("PPSA", psn_choice)
        xbox = [
            {"Title": "Sample Game", "ProductId": "old"},
            {"Title": "Sample Game Xbox Series X|S", "ProductId": "new"},
            {"Title": "Sample Game Upgrade", "ProductId": "upgrade"},
        ]
        xbox_choice = repair.xbox_best_latest("Sample Game", xbox)[2]
        assert xbox_choice is not None
        self.assertIn("/new", xbox_choice)
        self.assertEqual(repair.psn_best_latest("Unknown", []), (None, 0.0, None))
        self.assertEqual(repair.xbox_best_latest("Unknown", []), (None, 0.0, None))

    def test_console_url_parsers_and_store_lookup_errors(self):
        self.assertEqual(
            repair.search_platform(
                "https://store.playstation.com/en-us/search/Sample%20Game"
            ),
            ("psn", "Sample Game"),
        )
        self.assertEqual(
            repair.search_platform("https://www.xbox.com/en-US/search?q=Sample"),
            ("xbox", "Sample"),
        )
        self.assertIsNone(repair.search_platform("https://example.com/"))
        self.assertEqual(
            repair.product_platform("https://store.playstation.com/en-us/product/ABC"),
            "psn",
        )
        self.assertEqual(
            repair.product_platform("https://www.xbox.com/en-US/games/store/x/id"),
            "xbox",
        )
        self.assertIsNone(repair.product_platform("https://example.com/"))
        self.assertIsNone(repair.canonical_psn_url("/search/game"))
        self.assertEqual(repair.psn_generation("/product/PPSA123"), 2)
        self.assertEqual(repair.psn_generation("/product/CUSA123"), 1)
        self.assertEqual(repair.xbox_generation("Game Xbox Series X|S"), 2)
        self.assertEqual(repair.xbox_generation("Game Xbox One"), 1)
        self.assertEqual(repair.xbox_generation("Game"), 0)
        with patch.object(console, "psn_search", return_value=(None, "http_403")):
            self.assertEqual(
                repair.get_store_result("psn", "x", "x"), (None, 0.0, None, "http_403")
            )
        with patch.object(console, "xbox_search", return_value=([], None)):
            result = repair.get_store_result("xbox", "x", "x")
        self.assertEqual(result, (None, 0.0, None, None))

    def test_console_plan_handles_cached_updates_reviews_and_existing_products(self):
        games = [
            console_game(),
            console_game("https://store.playstation.com/en-us/search/LOW"),
            console_game("https://store.playstation.com/en-us/search/ERROR"),
            console_game(
                "https://store.playstation.com/en-us/search/DUP",
            ),
            console_game(
                "https://store.playstation.com/en-us/search/NOLINK",
            ),
        ]
        games[1]["slug"] = "low"
        games[2]["slug"] = "error"
        games[3]["slug"] = "duplicate"
        games[3]["links"].append(
            {
                "id": 71,
                "kind": "download",
                "url": "https://store.playstation.com/en-us/product/CUSA1",
            }
        )
        games[4]["slug"] = "no-link-id"
        games[4]["links"][0].pop("id")
        cache = {
            "psn:sample:sample game": {
                "store_name": "Sample Game",
                "score": 1,
                "url": "https://store.playstation.com/en-us/product/CUSA2",
            },
            "psn:low:sample game": {
                "store_name": "Unrelated",
                "score": 0,
                "url": "https://store.playstation.com/en-us/product/CUSA3",
            },
            "psn:error:sample game": {"error": "http_429"},
            "psn:dup:sample game": {"store_name": None, "url": None},
            "psn:nolink:sample game": {"store_name": "Sample Game", "url": "url"},
        }
        # Queries are uppercase in the saved URL, while cache keys are case-folded.
        rows = repair.build_plan(games, cache, refresh=False, delay_scale=0)
        self.assertEqual(rows[0]["action"], "update")
        self.assertEqual(rows[1]["action"], "review")
        self.assertEqual(rows[2]["reason"], "http_429")
        self.assertIn("another product", rows[3]["reason"])
        self.assertEqual(rows[4]["reason"], "search link has no Directus row ID")

    def test_console_plan_queries_and_caches_uncached_result(self):
        game = console_game()
        with (
            patch.object(
                repair,
                "get_store_result",
                return_value=(
                    "Sample Game",
                    1.0,
                    "https://store.playstation.com/en-us/product/CUSA1",
                    None,
                ),
            ) as lookup,
            patch.object(repair, "atomic_write") as save,
        ):
            rows = repair.build_plan([game], {}, refresh=True, delay_scale=0)
        self.assertEqual(rows[0]["action"], "update")
        lookup.assert_called_once()
        save.assert_called_once()

    def test_review_and_json_helpers(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "data.json"
            repair.atomic_write(path, {"x": 1})
            self.assertEqual(repair.load_json(path, {}), {"x": 1})
            path.write_text("invalid", encoding="utf-8")
            self.assertEqual(repair.load_json(path, "fallback"), "fallback")
            with patch.object(repair, "REVIEW_PATH", path):
                repair.write_review([{"action": "review", "title": "Need review"}])
            self.assertIn("Need review", path.read_text(encoding="utf-8"))

    def test_console_apply_updates_only_unchanged_links_and_handles_failures(self):
        matching = console_game()
        changed = console_game()
        changed["title"] = "Changed title"
        competing = console_game()
        competing["links"].append(
            {
                "id": 71,
                "kind": "download",
                "url": "https://store.playstation.com/en-us/product/CUSA2",
            }
        )
        client = FakeClient(
            {7: matching, 8: changed, 9: competing, 10: RuntimeError("offline")}
        )
        rows = [
            {
                "game_id": 7,
                "link_id": 70,
                "slug": "sample-game",
                "title": "Sample Game",
                "old_url": matching["links"][0]["url"],
                "platform": "psn",
                "new_url": "https://store.playstation.com/en-us/product/CUSA1",
                "action": "update",
            },
            {
                "game_id": 8,
                "link_id": 70,
                "slug": "sample-game",
                "title": "Sample Game",
                "old_url": changed["links"][0]["url"],
                "platform": "psn",
                "new_url": "new",
                "action": "update",
            },
            {
                "game_id": 9,
                "link_id": 70,
                "slug": "sample-game",
                "title": "Sample Game",
                "old_url": competing["links"][0]["url"],
                "platform": "psn",
                "new_url": "new",
                "action": "update",
            },
            {
                "game_id": 10,
                "link_id": 70,
                "slug": "sample-game",
                "title": "Sample Game",
                "old_url": "url",
                "platform": "psn",
                "new_url": "new",
                "action": "update",
            },
        ]
        with (
            patch.object(repair, "load_json", return_value={"rows": rows}),
            patch.object(repair, "DirectusClient") as directus,
            patch.object(repair, "RetryingDirectusClient", return_value=client),
            patch.object(repair, "trigger_site_rebuild") as rebuild,
        ):
            directus.from_config.return_value = object()
            result = repair.apply_plan(set())
        self.assertEqual(result, 1)
        self.assertEqual(len(client.patches), 1)
        rebuild.assert_called_once_with(client.base_client, [7])

    def test_console_apply_missing_plan_and_main_validation(self):
        with (
            patch.object(repair, "load_json", return_value=None),
            self.assertRaises(TypeError),
        ):
            repair.apply_plan(set())
        for argv in (
            ["repair_console_search_links.py", "--limit", "0"],
            ["repair_console_search_links.py", "--delay-scale", "-1"],
        ):
            with patch.object(sys, "argv", argv), self.assertRaises(SystemExit):
                repair.main()

    def test_console_main_dry_run_and_apply(self):
        game = console_game()
        client = FakeClient({})
        client.games = [game]
        cache = {
            "psn:sample:sample game": {
                "store_name": "Sample Game",
                "url": "https://store.playstation.com/en-us/product/CUSA1",
            }
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with (
                patch.object(
                    sys,
                    "argv",
                    [
                        "repair_console_search_links.py",
                        "--only-slug",
                        "sample-game",
                        "--limit",
                        "1",
                        "--delay-scale",
                        "0",
                    ],
                ),
                patch.object(repair, "CACHE_PATH", root / "cache.json"),
                patch.object(repair, "PLAN_PATH", root / "plan.json"),
                patch.object(repair, "REVIEW_PATH", root / "review.md"),
                patch.object(repair, "load_json", return_value=cache),
                patch.object(repair, "DirectusClient") as directus,
                patch.object(repair, "RetryingDirectusClient", return_value=client),
            ):
                directus.from_config.return_value = object()
                self.assertEqual(repair.main(), 0)
            self.assertEqual(
                json.loads((root / "plan.json").read_text())["rows"][0]["action"],
                "update",
            )
            self.assertTrue((root / "review.md").exists())

        with (
            patch.object(sys, "argv", ["repair_console_search_links.py", "--apply"]),
            patch.object(repair, "apply_plan", return_value=4) as apply,
        ):
            self.assertEqual(repair.main(), 4)
        apply.assert_called_once_with(set())


if __name__ == "__main__":
    unittest.main()
