#!/usr/bin/env python3

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import requests

from scrapers.scraper_utils import fetch_html


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
