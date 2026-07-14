#!/usr/bin/env python3
"""Contract checks for Source Parity v1 stale/scale/sign divergence diagnostics."""

from __future__ import annotations

import importlib.util
from datetime import datetime, timedelta, timezone
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
PARITY_PATH = ROOT / "scripts" / "build-market-source-parity.py"


def load_parity_module():
    spec = importlib.util.spec_from_file_location("market_source_parity", PARITY_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load parity module from {PARITY_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def cand(value, source, fetched_at=None, as_of=None):
    return {
        "value": value,
        "source": source,
        "fetched_at": fetched_at,
        "as_of": as_of,
        "confidence": "observed",
    }


class SourceParityDiagnosisTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.mod = load_parity_module()
        cls.now = datetime(2026, 6, 18, 0, 0, 0, tzinfo=timezone.utc)
        cls.now_iso = cls.now.isoformat().replace("+00:00", "Z")
        cls.old_iso = (cls.now - timedelta(days=20)).isoformat().replace("+00:00", "Z")

    def _is_percent_scale_warning(self, diagnosis: dict) -> bool:
        # Mirrors build_payload: a row is a percent_scale_warning only when
        # its diagnosis is 'scale_mismatch'.
        return diagnosis["diagnosis"] == "scale_mismatch"

    def test_stale_percent_is_not_scale_mismatch(self) -> None:
        # PERCENT field: fresh 5.0 (now) vs stale 0.05 (now - 20 days).
        candidates = [
            cand(5.0, "stockanalysis.quote", as_of=self.now_iso),
            cand(0.05, "yf", as_of=self.old_iso),
        ]
        result = self.mod.diagnose_divergence(
            "dividend_yield", candidates, ["stockanalysis.quote", "yf"]
        )

        self.assertEqual(result["diagnosis"], "stale")
        self.assertFalse(result["scale_mismatch"])
        self.assertIn("yf", result["stale_sources"])
        self.assertNotIn("stockanalysis.quote", result["stale_sources"])
        # The >=50 ratio only appears with the stale candidate => NOT a warning.
        self.assertFalse(self._is_percent_scale_warning(result))

    def test_true_scale_mismatch_when_both_fresh(self) -> None:
        # PERCENT field: two FRESH candidates 5.0 and 0.05 (both now).
        candidates = [
            cand(5.0, "stockanalysis.quote", as_of=self.now_iso),
            cand(0.05, "yf", as_of=self.now_iso),
        ]
        result = self.mod.diagnose_divergence(
            "dividend_yield", candidates, ["stockanalysis.quote", "yf"]
        )

        self.assertEqual(result["diagnosis"], "scale_mismatch")
        self.assertTrue(result["scale_mismatch"])
        self.assertAlmostEqual(result["scale_factor"], 100, delta=1)
        self.assertEqual(result["stale_sources"], [])
        self.assertTrue(self._is_percent_scale_warning(result))

    def test_sign_divergence(self) -> None:
        candidates = [
            cand(2.0, "stockanalysis.quote", as_of=self.now_iso),
            cand(-2.0, "yf.derived", as_of=self.now_iso),
        ]
        result = self.mod.diagnose_divergence(
            "change_pct", candidates, ["stockanalysis.quote", "yf", "yf.derived"]
        )

        self.assertEqual(result["diagnosis"], "sign_divergence")
        self.assertTrue(result["sign_divergence"])
        self.assertFalse(result["scale_mismatch"])

    def test_agreement(self) -> None:
        candidates = [
            cand(100.0, "yf", as_of=self.now_iso),
            cand(100.4, "stockanalysis.quote", as_of=self.now_iso),
        ]
        result = self.mod.diagnose_divergence(
            "price", candidates, ["yf", "stockanalysis.quote"]
        )

        self.assertEqual(result["diagnosis"], "agreement")
        self.assertFalse(result["scale_mismatch"])
        self.assertFalse(result["sign_divergence"])
        self.assertEqual(result["stale_sources"], [])

    def test_parse_ts_handles_z_and_offset_and_none(self) -> None:
        self.assertEqual(
            self.mod.parse_ts({"as_of": "2026-06-18T00:00:00Z"}),
            self.now,
        )
        self.assertEqual(
            self.mod.parse_ts({"as_of": "2026-06-18T00:00:00+00:00"}),
            self.now,
        )
        self.assertIsNone(self.mod.parse_ts({"fetched_at": None, "as_of": None}))

    def test_parse_ts_does_not_promote_collection_time(self) -> None:
        self.assertIsNone(self.mod.parse_ts({"fetched_at": self.now_iso}))
        self.assertEqual(
            self.mod.parse_ts({"fetched_at": self.now_iso, "as_of": self.old_iso}),
            self.now - timedelta(days=20),
        )


if __name__ == "__main__":
    unittest.main()
