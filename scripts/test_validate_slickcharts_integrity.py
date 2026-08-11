#!/usr/bin/env python3
"""Focused policy tests for current membership versus retained history."""
from __future__ import annotations

import importlib.util
import json
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
        self.root = Path(tempfile.mkdtemp())
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


if __name__ == "__main__":
    unittest.main()
