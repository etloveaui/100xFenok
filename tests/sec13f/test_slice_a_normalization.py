#!/usr/bin/env python3

from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "sec13f"))

from normalization import NormalizationError, apply_weight_filter, normalize_values  # noqa: E402


class SliceANormalizationTest(unittest.TestCase):
    def test_thousands_are_explicit_and_rows_keep_order(self) -> None:
        rows = [{"cusip": "A", "value": 10, "shares": 2}, {"cusip": "B", "value": 20, "shares": 3}]
        result = normalize_values(rows, unit="thousands", evidence="cover_implied_price", confidence=0.9)
        self.assertEqual([row["cusip"] for row in result], ["A", "B"])
        self.assertEqual(result[0]["value"], 10_000)

    def test_unresolved_or_low_confidence_unit_fails_closed(self) -> None:
        with self.assertRaises(NormalizationError):
            normalize_values([], unit="unknown", evidence="", confidence=0)
        with self.assertRaises(NormalizationError):
            normalize_values([], unit="dollars", evidence="guess", confidence=0.49)

    def test_round_then_filter_matches_cch_boundary(self) -> None:
        rows = [{"cusip": "KEEP", "value": 0.00096, "shares": 1}, {"cusip": "REST", "value": 0.99904, "shares": 1}]
        result = apply_weight_filter(rows)
        self.assertEqual([row["cusip"] for row in result], ["KEEP", "REST"])
        self.assertEqual(result[0]["weight"], 0.001)


if __name__ == "__main__":
    unittest.main()
