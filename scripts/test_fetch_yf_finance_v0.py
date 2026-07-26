#!/usr/bin/env python3
"""Diagnostic contract for the deprecated yf Finance v0 reproduction path."""

from __future__ import annotations

from contextlib import redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "fetch-yf-finance-v0.py"


def load_v0_module():
    spec = importlib.util.spec_from_file_location("fetch_yf_finance_v0", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load fetch module from {SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FetchYfFinanceV0DiagnosticTest(unittest.TestCase):
    def test_failure_log_keeps_a_bounded_sanitized_diagnostic(self):
        fetcher = load_v0_module()
        error = (
            "ValueError: "
            + "x" * 100
            + " endpoint moved diagnostic-marker "
            + "https://provider.example/quote?api_key=secret-value "
            + "Authorization: Bearer abc.def payload: {\"token\":\"secret-value\",\"rows\":[1,2,3]}"
        )
        with tempfile.TemporaryDirectory() as tmp:
            fetcher.TICKERS = ["FAIL"]
            fetcher.OUT_DIR = Path(tmp) / "finance"
            fetcher.fetch_ticker = lambda _ticker: ({}, 1, error)
            fetcher.time.sleep = lambda _seconds: None
            stdout = io.StringIO()
            with redirect_stdout(stdout):
                self.assertEqual(fetcher.main(["--allow-deprecated-v0"]), 0)
            payload = json.loads((fetcher.OUT_DIR / "FAIL.json").read_text(encoding="utf-8"))
            summary = json.loads((fetcher.OUT_DIR / "_summary.json").read_text(encoding="utf-8"))

        diagnostic = next(line.split("ERR: ", 1)[1].split(" (", 1)[0] for line in stdout.getvalue().splitlines() if "ERR: " in line)
        self.assertIn("endpoint moved diagnostic-marker", diagnostic)
        self.assertLessEqual(len(diagnostic), 240)
        self.assertNotIn("secret-value", diagnostic)
        self.assertNotIn("abc.def", diagnostic)
        self.assertNotIn('"rows"', diagnostic)
        self.assertIn("[redacted]", diagnostic)
        self.assertEqual(len(fetcher.bounded_diagnostic_detail("x" * 1000)), 240)
        userinfo = fetcher.bounded_diagnostic_detail(
            RuntimeError("request failed https://alice:supersecret@example.com/quote")
        )
        self.assertNotIn("alice", userinfo)
        self.assertNotIn("supersecret", userinfo)
        self.assertIn("https://example.com/quote", userinfo)
        for persisted_error in (payload["error"], summary["results"][0]["error"], summary["errors"][0]["error"]):
            self.assertLessEqual(len(persisted_error), 240)
            self.assertNotIn("secret-value", persisted_error)
            self.assertNotIn("abc.def", persisted_error)
            self.assertNotIn('"rows"', persisted_error)


if __name__ == "__main__":
    unittest.main()
