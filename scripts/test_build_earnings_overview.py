#!/usr/bin/env python3
"""Contract tests for the official companyfacts earnings normalizer.

These tests are intentionally written before the producer.  They pin the
period identity, source, unit, derivation, and retention rules that the
hosted RED/GREEN run must exercise.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime
import importlib.util
import json
import math
from pathlib import Path
import re
import unittest
from typing import Any, Mapping


ROOT = Path(__file__).resolve().parents[1]
BUILD_PATH = ROOT / "scripts" / "build-earnings-overview.py"
FIXTURE_DIR = ROOT / "scripts" / "fixtures" / "earnings-overview"
NOW = "2026-09-06T12:00:00Z"


def load_build_module():
    spec = importlib.util.spec_from_file_location("build_earnings_overview", BUILD_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load earnings producer from {BUILD_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_fixture(name: str) -> dict[str, Any]:
    path = FIXTURE_DIR / name
    if not path.exists():
        raise AssertionError(f"missing earnings fixture: {path}")
    with path.open(encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise AssertionError(f"fixture must be an object: {path}")
    return value


def load_fixture_text(name: str) -> str:
    path = FIXTURE_DIR / name
    if not path.exists():
        raise AssertionError(f"missing earnings fixture: {path}")
    return path.read_text(encoding="utf-8")


def call_normalizer(
    module: Any,
    ticker: str,
    companyfacts: dict[str, Any],
    previous: dict[str, Any] | None = None,
    supplement: dict[str, Any] | None = None,
):
    """Accept the agreed pair result as tuple or named mapping.

    The producer may expose the pair as ``(document, validation)`` or as a
    mapping with ``document`` and ``validation`` keys; the data contract is
    the pair itself, not a Python container preference.
    """

    result = module.normalize_companyfacts(
        ticker,
        companyfacts,
        previous=previous,
        now=NOW,
        supplement=supplement,
    )
    if isinstance(result, tuple) and len(result) == 2:
        return result
    if isinstance(result, Mapping):
        document = result.get("document", result.get("doc"))
        validation = result.get("validation", result.get("result"))
        if document is not None and validation is not None:
            return document, validation
    document = getattr(result, "document", None)
    validation = getattr(result, "validation", None)
    if document is not None and validation is not None:
        return document, validation
    raise AssertionError(
        "normalize_companyfacts must return a document and validation result"
    )


def validation_ok(validation: Any) -> bool:
    if isinstance(validation, bool):
        return validation
    if isinstance(validation, Mapping):
        value = validation.get("ok", validation.get("valid"))
    else:
        value = getattr(validation, "ok", getattr(validation, "valid", None))
    if not isinstance(value, bool):
        raise AssertionError(f"validation result needs boolean ok/valid: {validation!r}")
    return value


def assert_finite_or_none(test: unittest.TestCase, value: Any, label: str) -> None:
    test.assertTrue(
        value is None or (isinstance(value, (int, float)) and not isinstance(value, bool)),
        f"{label} must be numeric or null",
    )
    if value is not None:
        test.assertTrue(math.isfinite(value), f"{label} must be finite")


def period_for(document: Mapping[str, Any], end: str) -> Mapping[str, Any] | None:
    for period in document.get("periods", []):
        if period.get("end") == end:
            return period
    return None


class BuildEarningsOverviewTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.mod = load_build_module()

    def assert_document_contract(self, document: Mapping[str, Any], ticker: str) -> None:
        self.assertEqual(document.get("schemaVersion"), 1)
        self.assertEqual(document.get("ticker"), ticker)
        self.assertEqual(document.get("currency"), "USD")
        self.assertIsInstance(document.get("companyName"), str)
        self.assertTrue(document["companyName"])
        self.assertIsInstance(document.get("updatedAt"), str)
        datetime.fromisoformat(document["updatedAt"].replace("Z", "+00:00"))
        self.assertIn(document.get("status"), {"current", "retained"})
        self.assertTrue(document.get("notice") is None or isinstance(document["notice"], str))

        periods = document.get("periods")
        self.assertIsInstance(periods, list)
        self.assertGreater(len(periods), 0)
        self.assertLessEqual(len(periods), 8)
        ends = [period.get("end") for period in periods]
        self.assertEqual(len(ends), len(set(ends)), "period end dates must be unique")
        self.assertEqual(ends, sorted(ends, reverse=True), "periods must be newest first")

        expected_metrics = {
            "revenue",
            "costOfRevenue",
            "grossProfit",
            "operatingExpenses",
            "operatingIncome",
            "pretaxIncome",
            "incomeTax",
            "netIncome",
            "dilutedEps",
        }
        for index, period in enumerate(periods):
            label = f"{ticker}.periods[{index}]"
            self.assertIsInstance(period.get("end"), str, f"{label}.end missing")
            datetime.fromisoformat(period["end"])
            self.assertIsInstance(period.get("label"), str)
            self.assertTrue(period["label"])
            income = period.get("income")
            self.assertIsInstance(income, Mapping)
            self.assertEqual(set(income) - {"afterTaxOther"}, expected_metrics)
            for metric, value in income.items():
                assert_finite_or_none(self, value, f"{label}.income.{metric}")
            source = period.get("source")
            self.assertIsInstance(source, Mapping)
            self.assertIsInstance(source.get("name"), str)
            self.assertTrue(source["name"])
            self.assertIsInstance(source.get("url"), str)
            self.assertRegex(source["url"], r"^https://")
            self.assertNotRegex(source["url"], r"(?i)^(javascript|data):")
            self.assertTrue(source.get("filedAt") is None or isinstance(source["filedAt"], str))
            if source.get("filedAt"):
                datetime.fromisoformat(source["filedAt"])
            self.assertIsInstance(period.get("segments"), list)
            self.assertIsNone(period.get("segmentBasis"), "companyfacts alone cannot invent segments")
            self.assertIsInstance(period.get("notes"), list)
            self.assertTrue(all(isinstance(note, str) and note for note in period["notes"]))

    def test_all_four_allowlisted_companies_use_the_shared_document_shape(self) -> None:
        fixtures = {
            "AAPL": "aapl_companyfacts.json",
            "AMZN": "amzn_companyfacts.json",
            "MSFT": "msft_q4_companyfacts.json",
            "META": "meta_negative_companyfacts.json",
        }
        for ticker, filename in fixtures.items():
            with self.subTest(ticker=ticker):
                document, validation = call_normalizer(
                    self.mod, ticker, load_fixture(filename)
                )
                self.assertTrue(validation_ok(validation), f"{ticker} fixture should validate")
                self.assert_document_contract(document, ticker)

    def test_aapl_uses_direct_quarter_latest_restatement_and_absolute_usd(self) -> None:
        document, validation = call_normalizer(
            self.mod, "AAPL", load_fixture("aapl_companyfacts.json")
        )
        self.assertTrue(validation_ok(validation))
        latest = period_for(document, "2026-06-30")
        self.assertIsNotNone(latest, "direct Q2 must be present")
        income = latest["income"]

        # The direct 90-day fact wins over the 180-day YTD fact and the older
        # filing duplicate.  Values are absolute USD, not statement millions.
        self.assertEqual(income["revenue"], 100_000_000_000)
        self.assertEqual(income["costOfRevenue"], 60_000_000_000)
        self.assertEqual(income["grossProfit"], 40_000_000_000)
        self.assertEqual(
            income["operatingExpenses"],
            20_000_000_000,
            "operating expenses derive from gross profit minus operating income",
        )
        self.assertEqual(income["operatingIncome"], 20_000_000_000)
        self.assertEqual(income["pretaxIncome"], 20_000_000_000)
        self.assertEqual(income["incomeTax"], 4_000_000_000)
        self.assertEqual(income["netIncome"], 16_000_000_000)
        self.assertEqual(income["dilutedEps"], 1.6)
        self.assertEqual(latest["source"]["filedAt"], "2026-07-31")
        self.assertIn("sec.gov", latest["source"]["url"])
        self.assertTrue(any(re.search(r"[가-힣]", note) for note in latest["notes"]))
        self.assertNotEqual(latest["source"]["filedAt"], NOW[:10], "source clock is filing time")

    def test_period_cap_keeps_prior_year_counterpart(self) -> None:
        document, validation = call_normalizer(
            self.mod, "AAPL", load_fixture("aapl_companyfacts.json")
        )
        self.assertTrue(validation_ok(validation))
        ends = [period["end"] for period in document["periods"]]
        self.assertIn("2026-06-30", ends)
        self.assertIn("2025-06-30", ends, "same-quarter prior-year counterpart must survive the cap")
        self.assertNotIn("2024-06-30", ends, "oldest excess quarter should be pruned")
        self.assertEqual(len(ends), 8)

    def test_period_label_uses_period_end_when_filing_fy_is_republished(self) -> None:
        facts = deepcopy(load_fixture("aapl_companyfacts.json"))
        for namespace_facts in facts["facts"].values():
            for fact in namespace_facts.values():
                if not isinstance(fact, Mapping):
                    continue
                for unit_values in fact.get("units", {}).values():
                    for observation in unit_values:
                        if observation.get("end") == "2025-06-30":
                            observation["fy"] = 2026
                            observation["fp"] = "Q3"
        document, validation = call_normalizer(self.mod, "AAPL", facts)
        self.assertTrue(validation_ok(validation))
        prior = period_for(document, "2025-06-30")
        self.assertIsNotNone(prior)
        self.assertEqual(prior["label"], "FY2025 Q3")

    def test_aapl_fiscal_identity_handles_early_next_month_53_week_ends(self) -> None:
        self.assertEqual(self.mod._period_label("AAPL", "2023-04-01"), "FY2023 Q2")
        self.assertEqual(self.mod._period_label("AAPL", "2022-10-01"), "FY2022 Q4")

    def test_q4_annual_minus_same_fiscal_year_nine_months_withholds_eps(self) -> None:
        document, validation = call_normalizer(
            self.mod, "MSFT", load_fixture("msft_q4_companyfacts.json")
        )
        self.assertTrue(validation_ok(validation))
        q4 = period_for(document, "2026-06-30")
        self.assertIsNotNone(q4, "Q4 should be derived from annual and exact-start nine-month facts")
        income = q4["income"]
        self.assertEqual(income["revenue"], 90_000_000_000)
        self.assertEqual(income["costOfRevenue"], 40_000_000_000)
        self.assertEqual(income["grossProfit"], 50_000_000_000)
        self.assertEqual(income["operatingExpenses"], 20_000_000_000)
        self.assertEqual(income["operatingIncome"], 30_000_000_000)
        self.assertEqual(income["pretaxIncome"], 30_000_000_000)
        self.assertEqual(income["incomeTax"], 5_000_000_000)
        self.assertEqual(income["netIncome"], 25_000_000_000)
        self.assertIsNone(
            income["dilutedEps"],
            "annual minus YTD EPS is forbidden even when both EPS facts exist",
        )
        self.assertTrue(any(re.search(r"[가-힣]", note) for note in q4["notes"]))
        self.assertTrue(
            any(re.search(r"(?i)q4|4분기|연간", note) for note in q4["notes"]),
            "Q4 derivation must carry an explicit caveat",
        )

    def test_amzn_missing_tax_and_pretax_stay_null_and_gross_is_explicitly_derived(self) -> None:
        document, validation = call_normalizer(
            self.mod, "AMZN", load_fixture("amzn_companyfacts.json")
        )
        self.assertTrue(validation_ok(validation))
        period = period_for(document, "2026-06-30")
        self.assertIsNotNone(period)
        income = period["income"]
        self.assertEqual(income["revenue"], 200_606_000_000)
        self.assertEqual(income["costOfRevenue"], 95_778_000_000)
        self.assertEqual(income["grossProfit"], 104_828_000_000)
        self.assertIsNone(income["pretaxIncome"])
        self.assertIsNone(income["incomeTax"])
        self.assertEqual(income["operatingExpenses"], 77_367_000_000)
        self.assertEqual(income["operatingIncome"], 27_461_000_000)
        self.assertEqual(income["netIncome"], 62_647_000_000)
        self.assertEqual(income["dilutedEps"], 5.75)
        self.assertTrue(any(re.search(r"[가-힣]", note) for note in period["notes"]))
        self.assertEqual(period["segments"], [])
        self.assertIsNone(period["segmentBasis"])

    def test_msft_release_parser_validates_gaap_header_and_required_rows(self) -> None:
        source_url = "https://www.microsoft.com/en-us/investor/earnings/fy-2026-q4/press-release-webcast"
        supplement = self.mod.parse_msft_release_table(
            load_fixture_text("msft_release_table_fixture.html"),
            source_url=source_url,
        )
        self.assertEqual(supplement["ticker"], "MSFT")
        self.assertEqual(supplement["period"], {"label": "FY2026 Q4", "start": "2026-04-01", "end": "2026-06-30"})
        self.assertTrue(supplement["gaap"])
        self.assertEqual(supplement["values"]["revenue"], 90_007_000_000)
        self.assertEqual(supplement["values"]["costOfRevenue"], 29_525_000_000)
        self.assertEqual(supplement["values"]["grossProfit"], 60_482_000_000)
        self.assertEqual(supplement["values"]["operatingExpenses"], 19_879_000_000)
        self.assertEqual(supplement["values"]["operatingIncome"], 40_603_000_000)
        self.assertEqual(supplement["values"]["pretaxIncome"], 44_047_000_000)
        self.assertEqual(supplement["values"]["incomeTax"], 8_281_000_000)
        self.assertEqual(supplement["values"]["netIncome"], 35_766_000_000)
        self.assertEqual(supplement["values"]["dilutedEps"], 4.81)
        self.assertEqual(supplement["prior"]["revenue"], 76_441_000_000)
        self.assertEqual(supplement["prior"]["dilutedEps"], 3.65)
        self.assertEqual(
            self.mod.msft_release_url_for_period({"end": "2026-06-30", "label": "FY2026 Q4"}),
            source_url,
        )

        with self.assertRaises(ValueError):
            self.mod.parse_msft_release_table(
                load_fixture_text("msft_release_table_fixture.html").replace(
                    "Three Months Ended", "Twelve Months Ended"
                ),
                source_url=source_url,
            )
        with self.assertRaises(ValueError):
            self.mod.parse_msft_release_table(
                load_fixture_text("msft_release_table_fixture.html").replace(
                    "Total revenue", "Revenue total"
                ),
                source_url=source_url,
            )
        with self.assertRaises(ValueError):
            self.mod.parse_msft_release_table(
                load_fixture_text("msft_release_table_fixture.html").replace(
                    "MICROSOFT CORPORATION", "MICROSOFT CORPORATION NON-GAAP"
                ),
                source_url=source_url,
            )

    def test_msft_release_parser_binds_non_q4_period_and_rejects_wrong_url(self) -> None:
        html = load_fixture_text("msft_release_table_fixture.html").replace(
            "June 30", "September 30"
        )
        source_url = "https://www.microsoft.com/en-us/investor/earnings/fy-2027-q1/press-release-webcast"
        supplement = self.mod.parse_msft_release_table(html, source_url=source_url)
        self.assertEqual(
            supplement["period"],
            {"label": "FY2027 Q1", "start": "2026-07-01", "end": "2026-09-30"},
        )
        with self.assertRaises(ValueError):
            self.mod.parse_msft_release_table(
                html,
                source_url="https://www.microsoft.com/en-us/investor/earnings/fy-2026-q4/press-release-webcast",
            )

    def test_msft_release_supplement_supersedes_annual_ytd_q4_derivation(self) -> None:
        supplement = self.mod.parse_msft_release_table(
            load_fixture_text("msft_release_table_fixture.html")
        )
        document, validation = call_normalizer(
            self.mod,
            "MSFT",
            load_fixture("msft_q4_companyfacts.json"),
            supplement=supplement,
        )
        self.assertTrue(validation_ok(validation))
        q4 = period_for(document, "2026-06-30")
        self.assertIsNotNone(q4)
        income = q4["income"]
        self.assertEqual(income["revenue"], 90_007_000_000)
        self.assertEqual(income["costOfRevenue"], 29_525_000_000)
        self.assertEqual(income["grossProfit"], 60_482_000_000)
        self.assertEqual(income["operatingExpenses"], 19_879_000_000)
        self.assertEqual(income["operatingIncome"], 40_603_000_000)
        self.assertEqual(income["pretaxIncome"], 44_047_000_000)
        self.assertEqual(income["incomeTax"], 8_281_000_000)
        self.assertEqual(income["netIncome"], 35_766_000_000)
        self.assertEqual(income["dilutedEps"], 4.81)
        self.assertIn("microsoft.com", q4["source"]["url"])
        prior = period_for(document, "2025-06-30")
        self.assertIsNotNone(prior, "official prior-year column should retain a same-quarter counterpart")
        self.assertEqual(prior["income"]["revenue"], 76_441_000_000)
        self.assertEqual(prior["income"]["dilutedEps"], 3.65)

    def test_negative_earnings_and_tax_benefit_remain_signed(self) -> None:
        document, validation = call_normalizer(
            self.mod, "META", load_fixture("meta_negative_companyfacts.json")
        )
        self.assertTrue(validation_ok(validation))
        period = period_for(document, "2026-06-30")
        self.assertIsNotNone(period)
        income = period["income"]
        self.assertEqual(income["revenue"], 10_000_000_000)
        self.assertEqual(income["costOfRevenue"], 12_000_000_000)
        self.assertEqual(income["grossProfit"], -2_000_000_000)
        self.assertEqual(income["operatingExpenses"], 4_000_000_000)
        self.assertEqual(income["operatingIncome"], -6_000_000_000)
        self.assertEqual(income["pretaxIncome"], -4_000_000_000)
        self.assertEqual(income["incomeTax"], -1_000_000_000)
        self.assertEqual(income["netIncome"], -3_000_000_000)
        self.assertEqual(income["dilutedEps"], -0.3)

    def test_nonfinite_observation_is_rejected_without_nan_output(self) -> None:
        document, validation = call_normalizer(
            self.mod, "AAPL", load_fixture("invalid_companyfacts.json")
        )
        self.assertFalse(validation_ok(validation), "invalid observation must fail validation")
        for period in document.get("periods", []):
            for metric, value in period.get("income", {}).items():
                assert_finite_or_none(self, value, f"invalid.{metric}")
            self.assertNotEqual(period.get("end"), "2026-06-30", "bad period cannot be published")

    def test_inconsistent_period_identity_is_rejected_without_silent_blending(self) -> None:
        facts = load_fixture("aapl_companyfacts.json")
        broken = deepcopy(facts)
        for observation in broken["facts"]["us-gaap"]["CostOfGoodsAndServicesSold"]["units"]["USD"]:
            if observation.get("start") == "2026-04-01" and observation.get("end") == "2026-06-30":
                observation["start"] = "2026-04-02"
        document, validation = call_normalizer(self.mod, "AAPL", broken)
        self.assertFalse(validation_ok(validation), "period start mismatch must be visible")
        latest = period_for(document, "2026-06-30")
        if latest is not None:
            self.assertIsNone(latest["income"]["costOfRevenue"])
            self.assertIsNone(latest["income"]["grossProfit"])

    def test_failed_refresh_retains_previous_document_and_filing_clock(self) -> None:
        previous = load_fixture("previous_valid_document.json")
        document, validation = call_normalizer(
            self.mod,
            "AAPL",
            load_fixture("invalid_companyfacts.json"),
            previous=previous,
        )
        self.assertFalse(validation_ok(validation))
        self.assertEqual(document["status"], "retained")
        self.assertIsInstance(document.get("notice"), str)
        self.assertTrue(document["notice"])
        self.assertEqual(document["periods"], previous["periods"])
        self.assertEqual(document["updatedAt"], previous["updatedAt"])
        self.assertNotEqual(document["updatedAt"], NOW)
        self.assertEqual(document["periods"][0]["source"]["filedAt"], "2026-05-01")

    def test_unsupported_ticker_cannot_be_promoted(self) -> None:
        facts = load_fixture("aapl_companyfacts.json")
        try:
            _document, validation = call_normalizer(self.mod, "NOPE", facts)
        except (KeyError, ValueError):
            return
        self.assertFalse(validation_ok(validation), "only the four allowlisted tickers are supported")

    def test_companyfacts_cik_is_required_and_must_match_ticker(self) -> None:
        missing = deepcopy(load_fixture("aapl_companyfacts.json"))
        missing.pop("cik")
        with self.assertRaises(ValueError):
            call_normalizer(self.mod, "AAPL", missing)

        mismatched = deepcopy(load_fixture("aapl_companyfacts.json"))
        mismatched["cik"] = 789019
        with self.assertRaises(ValueError):
            call_normalizer(self.mod, "AAPL", mismatched)


if __name__ == "__main__":
    unittest.main()
