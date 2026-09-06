#!/usr/bin/env python3
"""Contract tests for dynamic SEC inline-XBRL revenue segment extraction.

The fixtures are bounded issuer snippets.  They intentionally include exact
quarter contexts beside YTD/prior-year contexts, subtotal members, and nested
dimension views so a producer cannot pass by selecting the latest-looking
value or by summing unrelated revenue tables.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "earnings_segments.py"
FIXTURE_DIR = ROOT / "scripts" / "fixtures" / "earnings-segments"

REVENUE = "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax"


def load_module():
    spec = importlib.util.spec_from_file_location("earnings_segments", MODULE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load earnings segment extractor from {MODULE_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def fixture(name: str) -> str:
    return (FIXTURE_DIR / name).read_text(encoding="utf-8")


def values(result):
    assert result is not None
    return [(item["name"], item["revenue"]) for item in result["segments"]]


class EarningsSegmentsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.mod = load_module()

    def test_aapl_uses_exact_quarter_leaf_product_group_and_excludes_products_subtotal(self) -> None:
        result = self.mod.extract_revenue_segments(
            "AAPL",
            fixture("aapl_product_quarter.html"),
            "2026-03-29",
            "2026-06-27",
            109_417_000_000,
        )
        self.assertIsNotNone(result)
        self.assertEqual(result["segmentBasis"], "제품별 매출")
        self.assertEqual(
            values(result),
            [
                ("iPhone", 54_252_000_000),
                ("Mac", 10_352_000_000),
                ("iPad", 6_191_000_000),
                ("Wearables, Home and Accessories", 7_883_000_000),
                ("Services", 30_739_000_000),
            ],
        )
        self.assertNotIn("Products", [name for name, _value in values(result)])
        self.assertEqual(sum(value for _name, value in values(result)), 109_417_000_000)

    def test_nested_presentation_table_does_not_invalidate_valid_xbrl_facts(self) -> None:
        result = self.mod.extract_revenue_segments(
            "AAPL",
            fixture("aapl_product_quarter.html"),
            "2026-03-29",
            "2026-06-27",
            109_417_000_000,
        )
        self.assertEqual(values(result)[0], ("iPhone", 54_252_000_000))

    def test_amzn_prefers_reportable_segments_over_product_sales_group(self) -> None:
        result = self.mod.extract_revenue_segments(
            "AMZN",
            fixture("amzn_reportable_segments.html"),
            "2026-04-01",
            "2026-06-30",
            200_606_000_000,
        )
        self.assertIsNotNone(result)
        self.assertEqual(result["segmentBasis"], "사업부별 매출")
        self.assertEqual(
            values(result),
            [
                ("North America", 116_177_000_000),
                ("International", 42_197_000_000),
                ("AWS", 42_232_000_000),
            ],
        )
        self.assertNotIn("Online stores", [name for name, _value in values(result)])

    def test_meta_excludes_product_facts_nested_inside_family_of_apps(self) -> None:
        result = self.mod.extract_revenue_segments(
            "META",
            fixture("meta_nested_segments.html"),
            "2026-04-01",
            "2026-06-30",
            60_801_000_000,
        )
        self.assertIsNotNone(result)
        self.assertEqual(result["segmentBasis"], "사업부별 매출")
        self.assertEqual(
            values(result),
            [("Family of Apps", 60_370_000_000), ("Reality Labs", 431_000_000)],
        )
        self.assertNotIn("Advertising", [name for name, _value in values(result)])

    def test_msft_reads_current_quarter_revenue_rows_from_official_segment_table(self) -> None:
        result = self.mod.extract_revenue_segments(
            "MSFT",
            fixture("msft_segment_revenue_quarter.html"),
            "2026-04-01",
            "2026-06-30",
            90_007_000_000,
        )
        self.assertIsNotNone(result)
        self.assertEqual(result["segmentBasis"], "사업부별 매출")
        self.assertEqual(
            values(result),
            [
                ("Productivity and Business Processes", 37_847_000_000),
                ("Intelligent Cloud", 39_306_000_000),
                ("More Personal Computing", 12_854_000_000),
            ],
        )
        self.assertEqual(sum(value for _name, value in values(result)), 90_007_000_000)

    def test_msft_plain_table_requires_matching_quarter_header_and_total(self) -> None:
        html = fixture("msft_segment_revenue_quarter.html")
        self.assertIsNone(
            self.mod.extract_revenue_segments(
                "MSFT", html, "2025-04-01", "2025-06-30", 90_007_000_000
            )
        )
        self.assertIsNone(
            self.mod.extract_revenue_segments(
                "MSFT", html, "2026-04-01", "2026-06-30", 90_008_000_000
            )
        )

    def test_msft_non_gaap_segment_table_cannot_supply_revenue(self) -> None:
        html = fixture("msft_segment_revenue_quarter.html")
        html = html.replace("SEGMENT REVENUE AND OPERATING INCOME", "NON-GAAP SEGMENT REVENUE")
        html = html.replace("SEGMENT RESULTS", "NON-GAAP RECONCILIATION")
        self.assertIsNone(
            self.mod.extract_revenue_segments(
                "MSFT", html, "2026-04-01", "2026-06-30", 90_007_000_000
            )
        )

    def test_exact_start_and_end_reject_ytd_and_prior_year_contexts(self) -> None:
        html = fixture("aapl_product_quarter.html")
        result = self.mod.extract_revenue_segments(
            "AAPL", html, "2026-03-29", "2026-06-27", 109_417_000_000
        )
        self.assertEqual(values(result)[0], ("iPhone", 54_252_000_000))
        self.assertIsNone(
            self.mod.extract_revenue_segments(
                "AAPL", html, "2026-01-01", "2026-06-27", 109_417_000_000
            )
        )
        self.assertIsNone(
            self.mod.extract_revenue_segments(
                "AAPL", html, "2025-03-30", "2025-06-28", 109_417_000_000
            )
        )

    def test_sum_mismatch_omits_candidate_instead_of_publishing_partial_segments(self) -> None:
        result = self.mod.extract_revenue_segments(
            "AAPL",
            fixture("aapl_product_quarter.html"),
            "2026-03-29",
            "2026-06-27",
            109_418_000_000,
        )
        self.assertIsNone(result)

    def test_wrong_concept_is_not_treated_as_revenue(self) -> None:
        html = fixture("aapl_product_quarter.html").replace(
            REVENUE, "us-gaap:RevenueOther"
        )
        self.assertIsNone(
            self.mod.extract_revenue_segments(
                "AAPL", html, "2026-03-29", "2026-06-27", 109_417_000_000
            )
        )

    def test_non_usd_unit_is_rejected(self) -> None:
        html = fixture("aapl_product_quarter.html").replace('unitRef="USD"', 'unitRef="shares"')
        self.assertIsNone(
            self.mod.extract_revenue_segments(
                "AAPL", html, "2026-03-29", "2026-06-27", 109_417_000_000
            )
        )

    def test_scale_and_sign_are_applied_without_absolute_value_repair(self) -> None:
        html = fixture("aapl_product_quarter.html")
        result = self.mod.extract_revenue_segments(
            "AAPL", html, "2026-03-29", "2026-06-27", 109_417_000_000
        )
        self.assertEqual(dict(values(result))["iPhone"], 54_252_000_000)
        signed = html.replace(
            'contextRef="c14" name="us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax" unitRef="USD" scale="6" decimals="-3">30,739',
            'contextRef="c14" name="us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax" unitRef="USD" scale="6" sign="-" decimals="-3">30,739',
        )
        self.assertIsNone(
            self.mod.extract_revenue_segments(
                "AAPL", signed, "2026-03-29", "2026-06-27", 109_417_000_000
            )
        )

    def test_malformed_inline_markup_omits_all_segments(self) -> None:
        html = fixture("aapl_product_quarter.html").replace(
            "</ix:nonFraction>", "", 1
        )
        self.assertIsNone(
            self.mod.extract_revenue_segments(
                "AAPL", html, "2026-03-29", "2026-06-27", 109_417_000_000
            )
        )

    def test_plain_html_and_invalid_arguments_are_unsupported(self) -> None:
        self.assertIsNone(
            self.mod.extract_revenue_segments(
                "MSFT", fixture("plain_html.html"), "2026-04-01", "2026-06-30", 90_007_000_000
            )
        )
        self.assertIsNone(
            self.mod.extract_revenue_segments(
                "AAPL", fixture("aapl_product_quarter.html"), "2026-02-30", "2026-06-27", 1
            )
        )
        self.assertIsNone(
            self.mod.extract_revenue_segments(
                "AAPL", fixture("aapl_product_quarter.html"), "2026-03-29", "2026-06-27", 0
            )
        )


if __name__ == "__main__":
    unittest.main()
