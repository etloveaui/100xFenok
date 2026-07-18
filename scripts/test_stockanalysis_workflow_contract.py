#!/usr/bin/env python3
"""Static route contract for bounded scheduled StockAnalysis stock acquisition."""

from __future__ import annotations

from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "fetch-stockanalysis.yml"
STOCK_CRON = "20 21 * * *"


class StockAnalysisWorkflowContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.text = WORKFLOW.read_text(encoding="utf-8")

    def test_dedicated_stock_schedule_is_fixed_bounded_and_pair_required(self) -> None:
        self.assertIn(f"- cron: '{STOCK_CRON}'", self.text)
        branch = re.search(
            rf'if \[ "\$EVENT_SCHEDULE" = "{re.escape(STOCK_CRON)}" \]; then(?P<body>.*?)\n\s*(?:elif|else) ',
            self.text,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(branch)
        body = branch.group("body")
        focus = re.search(r'INPUT_STOCKS="([A-Z0-9.,-]+)"', body)
        self.assertIsNotNone(focus)
        tickers = [item for item in focus.group(1).split(",") if item]
        self.assertGreater(len(tickers), 0)
        self.assertLessEqual(len(tickers), 8)
        self.assertEqual(len(tickers), len(set(tickers)))
        for expected in (
            'INPUT_STOCKS_ONLY="true"',
            'INPUT_FETCH_FINANCIALS="true"',
            'INPUT_INCREMENTAL_ETF_BACKFILL="false"',
            'INPUT_FETCH_SURFACES="false"',
            'INPUT_DISCOVER_UNIVERSE="false"',
            'NATURAL_RECOVERY_KINDS="stock,financial"',
            'INPUT_STOCK_LIMIT="8"',
            'INPUT_REQUIRE_STOCK_FINANCIAL_PAIR="true"',
            'INPUT_ISOLATED_STOCK_SCHEDULE="true"',
        ):
            self.assertIn(expected, body)
        self.assertIn(
            'if [ "${INPUT_ISOLATED_STOCK_SCHEDULE:-false}" = "true" ]; then',
            self.text,
        )

    def test_each_known_schedule_has_an_exact_recovery_scope_and_unknown_fails_closed(self) -> None:
        for schedule, scope in (
            ("20 21 * * *", "stock,financial"),
            ("50 22 * * 1-5", "none"),
            ("50 23 * * 1-5", "surface"),
            ("20 23 * * 0", "surface,universe"),
        ):
            self.assertIsNotNone(
                re.search(
                    rf'\$EVENT_SCHEDULE" = "{re.escape(schedule)}".*?NATURAL_RECOVERY_KINDS="{re.escape(scope)}"',
                    self.text,
                    flags=re.DOTALL,
                ),
                f"schedule {schedule} must select recovery scope {scope}",
            )
        self.assertIn('echo "unknown StockAnalysis schedule: $EVENT_SCHEDULE" >&2', self.text)
        self.assertIn("exit 64", self.text)
        self.assertIn('--natural-recovery-kinds $NATURAL_RECOVERY_KINDS', self.text)


if __name__ == "__main__":
    unittest.main()
