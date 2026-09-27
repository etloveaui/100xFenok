#!/usr/bin/env python3
"""Focused policy tests for current membership versus retained history."""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("validate-slickcharts-integrity.py")
SPEC = importlib.util.spec_from_file_location("slickcharts_integrity", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"unable to load {SCRIPT}")
integrity = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(integrity)


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


class SlickChartsIntegrityPolicyTest(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(prefix="slickcharts-integrity-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.current = {
            "AAA": ["sp500"],
            "BBB": ["nasdaq100"],
            "CCC": ["dowjones"],
        }
        self.available = set(integrity.INDEX_FILES)
        self.write_universe(["AAA", "BBB", "CCC"])
        self.write_membership()

    def write_universe(self, symbols: list[str]) -> None:
        membership = {**self.current, "OLD": ["nasdaq100"]}
        rows = [
            {
                "symbol": symbol,
                "indices": membership[symbol],
                "indexCount": len(membership[symbol]),
            }
            for symbol in symbols
        ]
        write_json(self.root / "universe.json", {
            "uniqueCount": len(rows),
            "indexCounts": {"sp500": 1, "nasdaq100": 1, "dowjones": 1},
            "stocks": rows,
        })

    def write_membership(self, overrides: dict[str, dict] | None = None) -> None:
        indices = {
            "sp500": {"count": 1, "tickers": ["AAA"]},
            "nasdaq100": {"count": 1, "tickers": ["BBB"]},
            "dowjones": {"count": 1, "tickers": ["CCC"]},
        }
        indices.update(overrides or {})
        write_json(self.root / "membership-changes.json", {"indices": indices})

    def write_aggregate(self, symbols: list[str]) -> None:
        write_json(self.root / "stocks-returns.json", {
            "updated": "2026-09-07T07:41:09Z",
            "count": len(symbols),
            "stocks": [{"symbol": symbol} for symbol in symbols],
        })

    def test_clean_current_membership_passes(self) -> None:
        warnings: list[str] = []
        symbols = integrity.assert_universe(self.root, self.current, True, warnings)
        integrity.assert_membership_history(self.root, self.current, self.available, warnings)
        self.assertEqual(symbols, ["AAA", "BBB", "CCC"])
        self.assertEqual(warnings, [])

    def test_stale_current_universe_fails(self) -> None:
        self.write_universe(["AAA", "BBB", "CCC", "OLD"])
        with self.assertRaisesRegex(RuntimeError, "stale"):
            integrity.assert_universe(self.root, self.current, True, [])

    def test_stale_current_membership_state_fails(self) -> None:
        self.write_membership({
            "nasdaq100": {"count": 2, "tickers": ["BBB", "OLD"]},
        })
        with self.assertRaisesRegex(RuntimeError, "membership state mismatch"):
            integrity.assert_membership_history(self.root, self.current, self.available, [])

    def test_unknown_membership_index_fails(self) -> None:
        self.write_membership({
            "retired_index": {"count": 1, "tickers": ["OLD"]},
        })
        with self.assertRaisesRegex(RuntimeError, "unknown indices"):
            integrity.assert_membership_history(self.root, self.current, self.available, [])

    def test_historical_aggregate_may_retain_former_member(self) -> None:
        self.write_aggregate(["AAA", "BBB", "CCC", "OLD"])
        warnings: list[str] = []
        integrity.assert_aggregate(
            self.root,
            "stocks-returns.json",
            ["AAA", "BBB", "CCC"],
            warnings,
            membership_complete=True,
        )
        self.assertTrue(any("stale superset" in warning for warning in warnings), warnings)

    def test_historical_aggregate_missing_current_member_fails(self) -> None:
        self.write_aggregate(["AAA", "BBB"])
        with self.assertRaisesRegex(RuntimeError, "missing"):
            integrity.assert_aggregate(
                self.root,
                "stocks-returns.json",
                ["AAA", "BBB", "CCC"],
                [],
                membership_complete=True,
            )

    def test_projection_retains_history_bytes_and_reports_new_member_gap(self) -> None:
        for index_name, filename in integrity.INDEX_FILES.items():
            symbols = [symbol for symbol, indices in self.current.items() if index_name in indices]
            write_json(self.root / filename, {
                "count": len(symbols),
                "holdings": [{"symbol": symbol} for symbol in symbols],
            })
        self.write_aggregate(["AAA", "BBB", "OLD"])
        history = self.root / "stocks-returns.json"
        before = history.read_bytes()
        result = subprocess.run([
            sys.executable, str(SCRIPT), "--data-dir", str(self.root),
            "--skip-public", "--allow-history-coverage-lag",
        ], text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report["status"], "degraded")
        self.assertTrue(any(
            "history coverage lag" in warning
            and "missing=['CCC']" in warning and "retained=['OLD']" in warning
            for warning in report["warnings"]
        ), report)
        self.assertEqual(history.read_bytes(), before)

    def test_coverage_lag_never_allows_corrupt_history(self) -> None:
        for payload, message in [
            ({"count": 3, "stocks": [{"symbol": "AAA"}]}, "count mismatch"),
            ({"count": 2, "stocks": [{"symbol": "AAA"}, {"symbol": "AAA"}]}, "duplicate ticker"),
            ({"count": 1, "stocks": [{}]}, "missing ticker identity"),
            ({"count": 1, "stocks": ["AAA"]}, "malformed row"),
            ({"stocks": {}}, "must be an array"),
        ]:
            with self.subTest(message=message):
                write_json(self.root / "stocks-returns.json", payload)
                with self.assertRaisesRegex(RuntimeError, message):
                    integrity.assert_aggregate(
                        self.root, "stocks-returns.json", ["AAA", "BBB", "CCC"], [],
                        allow_history_coverage_lag=True,
                    )

    def test_coverage_lag_never_allows_invalid_json_or_nonfinite_numbers(self) -> None:
        for text in ['{"stocks":', '{"stocks": [], "value": NaN}', '{"stocks": [], "value": Infinity}']:
            with self.subTest(text=text):
                (self.root / "stocks-returns.json").write_text(text, encoding="utf-8")
                with self.assertRaisesRegex(RuntimeError, "Invalid JSON"):
                    integrity.assert_aggregate(
                        self.root, "stocks-returns.json", ["AAA", "BBB", "CCC"], [],
                        allow_history_coverage_lag=True,
                    )

    def test_coverage_lag_does_not_replace_mirror_validation(self) -> None:
        self.write_aggregate(["AAA", "BBB", "OLD"])
        integrity.assert_aggregate(
            self.root, "stocks-returns.json", ["AAA", "BBB", "CCC"], [],
            allow_history_coverage_lag=True,
        )
        public = self.root / "public"
        public.mkdir()
        for filename in integrity.CRITICAL_MIRROR_FILES:
            source = self.root / filename
            if source.exists():
                (public / filename).write_bytes(source.read_bytes())
        (public / "stocks-returns.json").write_text("{}", encoding="utf-8")
        with self.assertRaisesRegex(RuntimeError, "Public mirror drift"):
            integrity.assert_public_mirror(self.root, public, ["AAA", "BBB", "CCC"], [])


if __name__ == "__main__":
    unittest.main()
