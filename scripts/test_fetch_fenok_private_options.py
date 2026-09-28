#!/usr/bin/env python3
"""Deterministic contracts for the private Yahoo options collector."""

from __future__ import annotations

import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from contextlib import redirect_stdout


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "fetch-fenok-private-options.py"
SPEC = importlib.util.spec_from_file_location("fetch_fenok_private_options", SCRIPT)
COLLECTOR = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(COLLECTOR)


class Frame:
    def __init__(self, rows):
        self._rows = rows
        self.empty = not rows

    def head(self, limit):
        return Frame(self._rows[:limit])

    def reset_index(self, drop=True):
        del drop
        return self

    def to_dict(self, orient):
        assert orient == "records"
        return self._rows


class Chain:
    def __init__(self, calls=None, puts=None):
        self.calls = Frame(calls if calls is not None else [{"contractSymbol": "C", "strike": 1}])
        self.puts = Frame(puts if puts is not None else [{"contractSymbol": "P", "strike": 1}])


class Ticker:
    options = ["2026-07-24", "2026-07-31"]

    def option_chain(self, expiry):
        del expiry
        return Chain()


class EmptyTicker(Ticker):
    options = []


class MalformedTicker(Ticker):
    def option_chain(self, expiry):
        del expiry
        return Chain(calls=[], puts=[])


class ProviderFailureTicker(Ticker):
    def option_chain(self, expiry):
        del expiry
        raise RuntimeError(
            "income statement endpoint moved after schema change "
            "https://provider.example/options?api_key=secret-value "
            "Authorization: Bearer abc.def payload: {\"token\":\"secret-value\",\"rows\":[1,2,3]}"
        )


class PrivateOptionsCollectorTest(unittest.TestCase):
    def test_scheduled_selection_is_exact_and_rejects_partial_or_foreign(self):
        self.assertEqual(COLLECTOR.SCHEDULED_TICKERS, COLLECTOR.DEFAULT_REFERENCE_TICKERS)
        COLLECTOR.validate_scheduled_tickers(COLLECTOR.SCHEDULED_TICKERS)
        with self.assertRaisesRegex(ValueError, "exact scheduled allowlist"):
            COLLECTOR.validate_scheduled_tickers(COLLECTOR.SCHEDULED_TICKERS[:-1])
        with self.assertRaisesRegex(ValueError, "exact scheduled allowlist"):
            COLLECTOR.validate_scheduled_tickers([*COLLECTOR.SCHEDULED_TICKERS[:-1], "SPY"])

    def test_collection_writes_private_raw_and_safe_summary_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            output = root / "raw"
            summary_path = root / "summary.json"
            result = COLLECTOR.collect_options(
                COLLECTOR.SCHEDULED_TICKERS,
                output_dir=output,
                summary_path=summary_path,
                ticker_factory=lambda _ticker: Ticker(),
                observed_at="2026-07-18T01:10:00Z",
                sleep_seconds=0,
                scheduled=True,
            )
            self.assertEqual(result["ready_count"], 8)
            self.assertEqual(result["failed_count"], 0)
            self.assertEqual(len(list(output.glob("*.json"))), 8)
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
            def keys(value):
                if isinstance(value, dict):
                    return set(value) | {item for nested in value.values() for item in keys(nested)}
                if isinstance(value, list):
                    return {item for nested in value for item in keys(nested)}
                return set()

            for forbidden in ["options", "calls", "puts", "strike", "contractSymbol"]:
                self.assertNotIn(forbidden, keys(summary))
            self.assertEqual(summary["tickers"], COLLECTOR.SCHEDULED_TICKERS)
            self.assertTrue(all(row["expiry_count"] == 2 for row in summary["results"]))

    def test_zero_expiry_and_empty_chain_are_failures(self):
        for factory in [lambda _ticker: EmptyTicker(), lambda _ticker: MalformedTicker()]:
            with self.subTest(factory=factory), tempfile.TemporaryDirectory() as tmp:
                summary = COLLECTOR.collect_options(
                    ["DASH"],
                    output_dir=Path(tmp) / "raw",
                    summary_path=Path(tmp) / "summary.json",
                    ticker_factory=factory,
                    observed_at="2026-07-18T01:10:00Z",
                    sleep_seconds=0,
                    scheduled=False,
                )
                self.assertEqual(summary["ready_count"], 0)
                self.assertEqual(summary["failed_count"], 1)

    def test_provider_failure_keeps_a_bounded_sanitized_diagnostic_beside_reason(self):
        with tempfile.TemporaryDirectory() as tmp:
            stdout = io.StringIO()
            with redirect_stdout(stdout):
                summary = COLLECTOR.collect_options(
                    ["DASH"],
                    output_dir=Path(tmp) / "raw",
                    summary_path=Path(tmp) / "summary.json",
                    ticker_factory=lambda _ticker: ProviderFailureTicker(),
                    observed_at="2026-07-18T01:10:00Z",
                    sleep_seconds=0,
                )

            failure = summary["results"][0]
            diagnostic = failure["diagnostic"]
            self.assertEqual(failure["reason"], "provider_error")
            self.assertIn("RuntimeError: income statement endpoint moved", diagnostic)
            self.assertLessEqual(len(diagnostic), 320)
            self.assertNotIn("secret-value", diagnostic)
            self.assertNotIn("abc.def", diagnostic)
            self.assertNotIn('"rows"', diagnostic)
            self.assertIn("[redacted]", diagnostic)
            self.assertIn(diagnostic, stdout.getvalue())
            self.assertEqual(
                json.loads((Path(tmp) / "summary.json").read_text(encoding="utf-8"))["results"][0]["diagnostic"],
                diagnostic,
            )
            self.assertEqual(len(COLLECTOR.bounded_diagnostic_detail(RuntimeError("x" * 1000))), 320)
            userinfo = COLLECTOR.bounded_diagnostic_detail(
                RuntimeError("request failed https://alice:supersecret@example.com/options")
            )
            self.assertNotIn("alice", userinfo)
            self.assertNotIn("supersecret", userinfo)
            self.assertIn("https://example.com/options", userinfo)

    def test_plan_only_creates_no_output_or_summary(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            output = root / "raw"
            summary_path = root / "summary.json"
            plan = COLLECTOR.build_plan(COLLECTOR.SCHEDULED_TICKERS, output, scheduled=True)
            self.assertEqual(plan["tickers"], COLLECTOR.SCHEDULED_TICKERS)
            self.assertFalse(output.exists())
            self.assertFalse(summary_path.exists())


if __name__ == "__main__":
    unittest.main()
