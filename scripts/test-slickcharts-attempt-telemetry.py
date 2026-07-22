#!/usr/bin/env python3

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import requests

from scrapers.scraper_utils import (
    ProviderThrottledError,
    fetch_html,
    is_cloudflare_challenge,
)


class FakeSession:
    def __init__(self, value):
        self.value = value

    def get(self, *_args, **_kwargs):
        if isinstance(self.value, Exception):
            raise self.value
        response = requests.Response()
        response.status_code = self.value[0]
        response._content = self.value[1].encode("utf-8")
        response.encoding = "utf-8"
        return response


class SequenceSession:
    def __init__(self, values):
        self.values = list(values)
        self.calls = 0

    def get(self, *_args, **_kwargs):
        value = self.values[self.calls]
        self.calls += 1
        response = requests.Response()
        response.status_code = value[0]
        response._content = value[1].encode("utf-8")
        response.encoding = "utf-8"
        response.headers.update(value[2] if len(value) > 2 else {})
        return response


class SlickChartsAttemptTelemetryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.events = Path(self.tmp.name) / "events.jsonl"
        self.env = patch.dict(os.environ, {"SLICKCHARTS_ATTEMPT_EVENTS_PATH": str(self.events)})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def rows(self):
        return [json.loads(line) for line in self.events.read_text().splitlines()]

    def test_successful_table_emits_ready_tuple(self):
        html = "<table><tbody><tr><td>A</td><td>B</td></tr></tbody></table>"
        self.assertEqual(fetch_html(FakeSession((200, html)), "https://example.test", max_retries=1, rate_limit=0), html)
        row = self.rows()[0]
        self.assertEqual(row["http_status"], 200)
        self.assertEqual(row["decode"], "ok")
        self.assertEqual(row["payload"], "non_empty")
        self.assertEqual(row["assertions"], [{"id": "table_rows", "passed": True}])

    def test_nonempty_html_without_rows_emits_failed_assertion(self):
        fetch_html(FakeSession((200, "<html><body>blocked</body></html>")), "https://example.test", max_retries=1, rate_limit=0)
        self.assertEqual(self.rows()[0]["assertions"], [{"id": "table_rows", "passed": False}])

    def test_challenge_signature_requires_cloudflare_or_just_a_moment_title(self):
        self.assertTrue(is_cloudflare_challenge(
            403,
            {"server": "cloudflare"},
            "<html><title>ordinary page</title></html>",
        ))
        self.assertTrue(is_cloudflare_challenge(
            200,
            {},
            "<html><title>Just a moment...</title></html>",
        ))
        self.assertFalse(is_cloudflare_challenge(
            200,
            {},
            "<html><title>ordinary page</title></html>",
        ))

    @patch("scrapers.scraper_utils.random.uniform", return_value=0.0)
    @patch("scrapers.scraper_utils.time.sleep")
    def test_challenge_retries_then_returns_normal_html(self, sleep, _jitter):
        session = SequenceSession([
            (403, "<html><title>Just a moment...</title></html>", {"server": "cloudflare"}),
            (200, "<table><tr><td>ready</td></tr></table>"),
        ])
        html = fetch_html(session, "https://example.test", max_retries=2, rate_limit=0)
        self.assertIn("ready", html)
        self.assertEqual(session.calls, 2)
        self.assertEqual(sleep.call_args_list[0].args, (0,))
        self.assertEqual(sleep.call_args_list[1].args, (1.0,))
        self.assertEqual(self.rows()[0]["assertions"], [{"id": "table_rows", "passed": True}])

    @patch("scrapers.scraper_utils.random.uniform", return_value=0.0)
    @patch("scrapers.scraper_utils.time.sleep")
    def test_challenge_exhaustion_preserves_403_and_emits_provider_throttled(self, sleep, _jitter):
        session = SequenceSession([
            (403, "<html><title>Just a moment...</title></html>", {"cf-mitigated": "challenge"}),
            (403, "<html><title>Just a moment...</title></html>", {"cf-mitigated": "challenge"}),
        ])
        with self.assertRaisesRegex(ProviderThrottledError, "provider_throttled"):
            fetch_html(session, "https://example.test", max_retries=2, rate_limit=0)
        self.assertEqual(session.calls, 2)
        self.assertEqual(sleep.call_args_list[1].args, (1.0,))
        self.assertEqual(self.rows(), [{
            "execution": "returned",
            "exception_kind": None,
            "http_status": 403,
            "auth": "not_applicable",
            "rate_limited": False,
            "decode": "ok",
            "payload": "non_empty",
            "assertions": [{"id": "provider_throttled", "passed": False}],
        }])

    def test_rate_limit_emits_strict_returned_tuple(self):
        with self.assertRaises(RuntimeError):
            fetch_html(FakeSession((429, "slow down")), "https://example.test", max_retries=1, rate_limit=0)
        row = self.rows()[0]
        self.assertEqual(row["execution"], "returned")
        self.assertEqual(row["http_status"], 429)
        self.assertTrue(row["rate_limited"])
        self.assertEqual(row["assertions"], [])

    def test_transport_failure_emits_strict_threw_tuple(self):
        with self.assertRaises(RuntimeError):
            fetch_html(FakeSession(requests.ConnectionError("reset")), "https://example.test", max_retries=1, rate_limit=0)
        row = self.rows()[0]
        self.assertEqual(row["execution"], "threw")
        self.assertEqual(row["exception_kind"], "transport")
        self.assertIsNone(row["http_status"])
        self.assertEqual(row["assertions"], [])


if __name__ == "__main__":
    unittest.main()
