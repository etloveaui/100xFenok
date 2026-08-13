#!/usr/bin/env python3
"""Contract checks for yf Finance staged ETF backfill selection."""

from __future__ import annotations

import importlib.util
import hashlib
import io
import json
from datetime import datetime, timezone
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import types
import unittest


ROOT = Path(__file__).resolve().parents[1]
FETCH_PATH = ROOT / "scripts" / "fetch-yf-finance.py"
YAHOO_BATCH_STATE_PATH = ROOT / "scripts" / "yahoo_batch_state.py"
YF_WORKFLOW_PATH = ROOT / ".github" / "workflows" / "fetch-yf-finance.yml"
MANIFEST_WORKFLOW_PATH = ROOT / ".github" / "workflows" / "update-manifest.yml"
MANIFEST_RUNNER_PATH = ROOT / "scripts" / "update-manifest-projections.sh"


def load_fetch_module():
    sys.modules.setdefault("yfinance", types.SimpleNamespace(Ticker=lambda *_args, **_kwargs: None))
    spec = importlib.util.spec_from_file_location("fetch_yf_finance", FETCH_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load fetch module from {FETCH_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_yahoo_batch_state_module():
    spec = importlib.util.spec_from_file_location("yahoo_batch_state", YAHOO_BATCH_STATE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load state module from {YAHOO_BATCH_STATE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


class FetchYfFinanceSelectionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.fetcher = load_fetch_module()
        self.state = load_yahoo_batch_state_module()
        self.tmp = TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.fetcher.STOCKANALYSIS_ETF_UNIVERSE = self.root / "stockanalysis" / "etf_universe.json"
        self.fetcher.STOCKANALYSIS_ETF_SCREENER = self.root / "stockanalysis" / "surfaces" / "etf_screener.json"
        self.fetcher.ETF_CORE_DAILY_BASKET = self.root / "admin" / "fenok-etf-core-daily-basket.json"
        self.fetcher.STOCK_UNIVERSE_DIR = self.root / "global-scouter" / "stocks" / "detail"
        self.fetcher.ETF_INDEX = self.root / "global-scouter" / "etfs" / "index.json"
        self.fetcher.MARKET_FACTS_INDEX = self.root / "computed" / "market_facts" / "index.json"
        self.fetcher.DASHBOARD_CONSTANTS = self.root / "dashboard" / "constants.ts"
        self.fetcher.PORTFOLIO_TS = self.root / "portfolio.ts"
        self.fetcher.OUT_DIR = self.root / "data" / "yf" / "finance"
        self.fetcher.YAHOO_BATCH_STATE_ROOT = self.root / "data" / "admin" / "yahoo-batch-quote-history"
        self.fetcher.DATA_SUPPLY_STATE_ROOT = self.root / "data" / "admin" / "data-supply-state" / "v1"
        self.fetcher.DATA_SUPPLY_PROVIDER_TRUTH_ROOT = self.root
        self.fetcher.STOCK_UNIVERSE_DIR.mkdir(parents=True)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_yahoo_symbol_preserves_single_letter_exchange_suffixes(self) -> None:
        # TSE new-format listing codes end in a letter and must keep the dotted
        # exchange suffix: 285A.T is KIOXIA HOLDINGS on JPX, and 285A-T is a
        # real Yahoo "Not Found" (verified against the live provider 2026-08-11).
        # This is the corpus shape that produced 14 consecutive empty-payload
        # failures classified as transient provider misses (regression #285A).
        self.assertEqual(self.fetcher.yahoo_symbol("285A.T"), "285A.T")
        self.assertEqual(self.fetcher.yahoo_symbol("7203.T"), "7203.T")
        # Other single-letter exchange suffixes are equally exchange suffixes,
        # not class shares.
        self.assertEqual(self.fetcher.yahoo_symbol("VOD.L"), "VOD.L")
        self.assertEqual(self.fetcher.yahoo_symbol("SAP.F"), "SAP.F")
        self.assertEqual(self.fetcher.yahoo_symbol("ACB.V"), "ACB.V")

    def test_yahoo_symbol_keeps_class_share_and_suffix_aliases(self) -> None:
        self.assertEqual(self.fetcher.yahoo_symbol("BRK.A"), "BRK-A")
        self.assertEqual(self.fetcher.yahoo_symbol("BRK.B"), "BRK-B")
        self.assertEqual(self.fetcher.yahoo_symbol("005930.KS"), "005930.KS")
        self.assertEqual(self.fetcher.yahoo_symbol("BMW.DE"), "BMW.DE")
        self.assertEqual(self.fetcher.yahoo_symbol("MC.PA"), "MC.PA")

    def _daily_payload(self, ticker: str) -> dict:
        return self.fetcher.decorate_finance_payload(
            ticker=ticker,
            profile="daily",
            fetched_at="2026-07-14T01:00:00Z",
            data={
                "info": {
                    "symbol": ticker,
                    "quoteType": "EQUITY",
                    "regularMarketTime": 1783990800,
                },
                "history_1y": [{"date": "2026-07-14", "Close": 10}],
            },
        )

    def _run_low_rate_failure(
        self,
        *,
        error: str,
        retain_lkg: bool,
        lose_existing_data: bool = False,
        failure_evidence_error: str | None = None,
    ) -> tuple[int, dict, dict, str]:
        failed_ticker = "FAIL"
        tickers = [failed_ticker, *[f"OK{index:02d}" for index in range(10)]]
        self.fetcher.load_universe_sources = lambda **_kwargs: {
            ticker: ["test_fixture"] for ticker in tickers
        }
        if retain_lkg or lose_existing_data:
            payload = self._daily_payload(failed_ticker)
            canonical = self.fetcher.OUT_DIR / f"{failed_ticker}.json"
            write_json(canonical, payload)
            if lose_existing_data:
                store = self.fetcher.YahooBatchStateStore(
                    self.fetcher.YAHOO_BATCH_STATE_ROOT,
                    self.fetcher.OUT_DIR,
                )
                store.record_success(
                    failed_ticker,
                    payload,
                    self._run("seed-existing-data"),
                    ["test_fixture"],
                    {"attempts_used": 1, "failures": [], "latency_ms": 1},
                )
                canonical.unlink()

        def fake_fetch(ticker, **_kwargs):
            if ticker == failed_ticker:
                evidence_error = failure_evidence_error or error
                return (
                    None,
                    0,
                    error,
                    {
                        "attempts_used": 1,
                        "failures": [{"attempt": 1, "error": evidence_error}],
                        "latency_ms": 0,
                    },
                )
            return (
                self._daily_payload(ticker)["data"],
                1,
                None,
                {"attempts_used": 1, "failures": [], "latency_ms": 1},
            )

        self.fetcher.fetch_with_retry = fake_fetch
        stdout = io.StringIO()
        original_argv, original_stdout = sys.argv, sys.stdout
        try:
            sys.argv = [
                "fetch-yf-finance.py",
                "--tickers",
                ",".join(tickers),
                "--record-batch-state",
                "--run-id",
                "semantic-exit-proof",
                "--run-attempt",
                "1",
                "--event-name",
                "workflow_dispatch",
                "--sleep",
                "0",
                "--retries",
                "0",
            ]
            sys.stdout = stdout
            with self.assertRaises(SystemExit) as raised:
                self.fetcher.main()
        finally:
            sys.argv, sys.stdout = original_argv, original_stdout

        state = json.loads(
            (self.fetcher.YAHOO_BATCH_STATE_ROOT / "tickers" / f"{failed_ticker}.json").read_text()
        )
        index = json.loads((self.fetcher.YAHOO_BATCH_STATE_ROOT / "index.json").read_text())
        return raised.exception.code, state, index, stdout.getvalue()

    def test_low_rate_failure_with_lkg_retry_and_kpi_name_exits_zero(self) -> None:
        code, state, index, output = self._run_low_rate_failure(
            error="isolated provider coverage gap",
            retain_lkg=True,
        )

        self.assertEqual(code, 0)
        self.assertEqual(state["resolution_state"], "lkg_primary")
        self.assertTrue(state["retry"])
        self.assertIn("FAIL", index["retry_symbols"])
        self.assertIn("FAIL", {row["ticker"] for row in index["current_attempt"]["errors"]})
        self.assertIn("FAIL", {row["symbol"] for row in index["lkg_details"]})
        self.assertIn("[degraded] retained LKG: FAIL; deferred without LKG: none", output)

    def test_lkg_less_transient_provider_miss_is_deferred_and_exits_zero(self) -> None:
        code, state, index, output = self._run_low_rate_failure(
            error="ValueError: provider source timestamp is unavailable for HOLX",
            retain_lkg=False,
        )

        self.assertEqual(code, 0)
        self.assertEqual(state["resolution_state"], "unavailable")
        self.assertTrue(state["retry"])
        self.assertEqual(state["latest_failure"]["failure_kind"], "transient_provider_miss")
        self.assertEqual(state["latest_failure"]["lkg_status"], "absent")
        self.assertTrue(state["latest_failure"]["deferred_acquisition"])
        self.assertIn("FAIL", index["retry_symbols"])
        self.assertIn("FAIL", {row["ticker"] for row in index["current_attempt"]["errors"]})
        self.assertIn("FAIL", {row["symbol"] for row in index["unavailable_details"]})
        self.assertIn("[degraded] retained LKG: none; deferred without LKG: FAIL", output)

    def test_controlled_lkg_less_chaos_is_deferred_and_exits_zero(self) -> None:
        code, state, index, output = self._run_low_rate_failure(
            error="controlled failure injection for HOLX",
            retain_lkg=False,
        )

        self.assertEqual(code, 0)
        self.assertTrue(state["latest_failure"]["deferred_acquisition"])
        self.assertIn("FAIL", {row["symbol"] for row in index["unavailable_details"]})
        self.assertIn("[degraded] retained LKG: none; deferred without LKG: FAIL", output)

    def test_loss_of_previously_advertised_data_without_lkg_exits_nonzero(self) -> None:
        code, state, _index, output = self._run_low_rate_failure(
            error="ValueError: provider source timestamp is unavailable for FAIL",
            retain_lkg=False,
            lose_existing_data=True,
        )

        self.assertEqual(code, 2)
        self.assertEqual(state["resolution_state"], "unavailable")
        self.assertTrue(state["retry"])
        self.assertEqual(state["latest_failure"]["lkg_status"], "lost")
        self.assertFalse(state["latest_failure"]["deferred_acquisition"])
        self.assertIn("[corrupt]", output)

    def test_low_rate_systemic_break_exits_nonzero_even_with_lkg(self) -> None:
        code, state, _index, output = self._run_low_rate_failure(
            error="HTTP 429 Too Many Requests",
            retain_lkg=True,
        )

        self.assertEqual(code, 2)
        self.assertEqual(state["resolution_state"], "lkg_primary")
        self.assertTrue(state["retry"])
        self.assertIn("systemic", output)

    def test_swallowed_systemic_evidence_cannot_be_laundered_by_transient_terminal_error(self) -> None:
        code, state, _index, output = self._run_low_rate_failure(
            error="empty payload",
            failure_evidence_error="YFRateLimitError: HTTP 429 Too Many Requests",
            retain_lkg=False,
        )

        self.assertEqual(code, 2)
        self.assertEqual(state["latest_failure"]["failure_kind"], "systemic_rate_limit")
        self.assertFalse(state["latest_failure"]["deferred_acquisition"])
        self.assertIn("[corrupt]", output)

    def test_lkg_less_systemic_or_unknown_failure_remains_corrupt(self) -> None:
        for error in [
            "HTTP 401 Unauthorized",
            "HTTP 429 Too Many Requests",
            "JSONDecodeError: Expecting value",
            "unexpected invariant violation",
        ]:
            with self.subTest(error=error):
                code, state, _index, output = self._run_low_rate_failure(
                    error=error,
                    retain_lkg=False,
                )
                self.assertEqual(code, 2)
                self.assertFalse(state["latest_failure"]["deferred_acquisition"])
                self.assertIn("[corrupt]", output)

    def test_actual_mixed_shape_six_lkg_plus_holx_mmc_transient_is_degraded(self) -> None:
        store = self.fetcher.YahooBatchStateStore(
            self.fetcher.YAHOO_BATCH_STATE_ROOT,
            self.fetcher.OUT_DIR,
        )
        run = self._run("mixed-natural")
        tickers = {"HOLX", "MMC", *{f"LKG{index}" for index in range(6)}}
        errors = []

        for ticker in sorted(tickers):
            if ticker.startswith("LKG"):
                write_json(self.fetcher.OUT_DIR / f"{ticker}.json", self._daily_payload(ticker))
                error = "isolated provider coverage gap"
            else:
                error = f"ValueError: provider source timestamp is unavailable for {ticker}"
            row = {"ticker": ticker, "error": error, "failures": []}
            store.record_failure(
                ticker,
                error,
                run,
                ["market_facts"],
                {"attempts_used": 1, "failures": [], "latency_ms": 0},
                failure_kind=self.fetcher.yahoo_failure_kind(row, event_name=run["event_name"]),
            )
            errors.append(row)

        index = store.rebuild_index(tickers, run)
        assessment = self.fetcher.yahoo_failure_exit_assessment(errors, store, index)

        self.assertEqual(assessment["exit_code"], 0)
        self.assertEqual(index["counts"]["lkg"], 6)
        self.assertEqual(index["counts"]["unavailable"], 2)
        self.assertEqual(index["counts"]["retry"], 8)
        self.assertEqual(index["counts"]["failed"], 8)
        self.assertEqual({row["symbol"] for row in index["unavailable_details"]}, {"HOLX", "MMC"})
        self.assertTrue(all(row["deferred_acquisition"] for row in index["unavailable_details"]))

    def test_legacy_unavailable_state_is_safely_named_during_schema_transition(self) -> None:
        store = self.fetcher.YahooBatchStateStore(
            self.fetcher.YAHOO_BATCH_STATE_ROOT,
            self.fetcher.OUT_DIR,
        )
        run = self._run("legacy-index-rebuild")
        legacy_failure = {
            "run_id": "old-run",
            "run_attempt": 1,
            "observed_at": "2026-07-10T01:00:00Z",
            "error": "ValueError: provider source timestamp is unavailable for HOLX",
            "attempts_used": 1,
            "failures": [],
        }
        write_json(store._state_path("HOLX"), {
            "schema_version": "yahoo-batch-quote-history-state/v1",
            "ticker": "HOLX",
            "resolution_state": "unavailable",
            "retry": True,
            "latest_failure": legacy_failure,
            "last_attempt": {**legacy_failure, "outcome": "failed"},
            "attempts": [{**legacy_failure, "outcome": "failed"}],
        })

        index = store.rebuild_index({"HOLX"}, run)
        detail = index["unavailable_details"][0]

        self.assertEqual(detail["symbol"], "HOLX")
        self.assertEqual(detail["failure_kind"], "legacy_unclassified")
        self.assertEqual(detail["lkg_status"], "absent")
        self.assertFalse(detail["deferred_acquisition"])
        self.assertTrue(detail["retry"])
        self.assertEqual(detail["expected_resolution"], "next_natural_yahoo_run")

    def test_terminal_failed_last_attempt_stays_out_of_retry_pending_failed_count(self) -> None:
        """counts.failed excludes terminal symbols while retryable failures still count.

        Regression: a terminal classification (provider-unsupported, e.g. acquired or
        delisted) keeps the pre-terminal last_attempt.outcome == "failed", which used
        to inflate counts.failed beyond the strict KPI retry-capable equation
        failed <= lkg + pending_history + unavailable. The index rebuild must stay
        deterministic and offline: it reads only per-ticker state files plus the
        passed active universe, so this test drives rebuild_index directly on a
        temporary store with zero provider or network access.
        """
        store = self.fetcher.YahooBatchStateStore(
            self.fetcher.YAHOO_BATCH_STATE_ROOT,
            self.fetcher.OUT_DIR,
        )
        run = self._run("retry-capable-count-equation")
        terminal_failed_attempt = {
            "run_id": "pre-terminal-run",
            "run_attempt": 1,
            "observed_at": "2026-08-08T00:05:10Z",
            "outcome": "failed",
            "attempts_used": 1,
            "failures": [],
        }
        write_json(store._state_path("TERM"), {
            "schema_version": "yahoo-batch-quote-history-state/v1",
            "ticker": "TERM",
            "resolution_state": self.state.TERMINAL_RESOLUTION_STATE,
            "retry": False,
            "last_attempt": terminal_failed_attempt,
            "attempts": [terminal_failed_attempt],
            "terminal": {
                "classified_run_id": run["run_id"],
                "classified_at": run["observed_at"],
            },
        })
        for ticker, resolution, outcome in (
            ("LKG1", "lkg_primary", "failed"),
            ("UNA1", "unavailable", "failed"),
            ("PEND1", "pending_history", "pending_history"),
            ("FRESH1", "fresh_primary", "fresh"),
        ):
            current_attempt = {
                "run_id": run["run_id"],
                "run_attempt": run["run_attempt"],
                "observed_at": run["observed_at"],
                "outcome": outcome,
                "attempts_used": 1,
                "failures": [],
            }
            write_json(store._state_path(ticker), {
                "schema_version": "yahoo-batch-quote-history-state/v1",
                "ticker": ticker,
                "resolution_state": resolution,
                "retry": resolution != "fresh_primary",
                "last_attempt": current_attempt,
                "attempts": [current_attempt],
            })

        index = store.rebuild_index({"TERM", "LKG1", "UNA1", "PEND1", "FRESH1"}, run)

        counts = index["counts"]
        retry_capable = counts["lkg"] + counts["pending_history"] + counts["unavailable"]
        self.assertEqual(
            {
                "active": counts["active"],
                "untracked": counts["untracked"],
                "pending_acquisition": counts["pending_acquisition"],
                "fresh": counts["fresh"],
                "lkg": counts["lkg"],
                "pending_history": counts["pending_history"],
                "unavailable": counts["unavailable"],
                "terminal": counts["terminal"],
                "retry": counts["retry"],
                "failed": counts["failed"],
                "stale": counts["stale"],
            },
            {
                "active": 5,
                "untracked": 0,
                "pending_acquisition": 0,
                "fresh": 1,
                "lkg": 1,
                "pending_history": 1,
                "unavailable": 1,
                "terminal": 1,
                "retry": 3,
                "failed": 2,
                "stale": 0,
            },
        )
        # The strict KPI equation: every counted failure is retry-capable.
        self.assertLessEqual(counts["failed"], retry_capable)
        self.assertEqual(index["terminal_symbols"], ["TERM"])
        self.assertEqual(index["retry_symbols"], ["LKG1", "PEND1", "UNA1"])
        # latest_attempt accounting still reports the real current-run failures.
        self.assertEqual(index["current_attempt"]["attempted"], 4)
        self.assertEqual(index["current_attempt"]["successes"], 2)
        self.assertEqual(index["current_attempt"]["failed"], 2)
        self.assertEqual(index["current_attempt"]["skipped"], 0)

    def test_data_loss_unavailable_cannot_be_laundered_by_promotion_deferral(self) -> None:
        store = self.fetcher.YahooBatchStateStore(self.fetcher.YAHOO_BATCH_STATE_ROOT, self.fetcher.OUT_DIR)
        run = {**self._run("data-loss-deferral"), "event_name": "workflow_dispatch", "natural": False}
        failure = {
            "run_id": "data-loss-origin",
            "run_attempt": 1,
            "event_name": "schedule",
            "observed_at": "2026-07-10T01:00:00Z",
            "failure_kind": "unexpected",
            "lkg_status": "lost",
            "data_loss": True,
            "deferred_acquisition": False,
            "error": "previously advertised data disappeared",
        }
        deferral = {
            "run_id": run["run_id"],
            "run_attempt": run["run_attempt"],
            "event_name": run["event_name"],
            "observed_at": run["observed_at"],
            "reason": "recovery_requires_schedule",
            "provider_quote_as_of": "2026-07-10T20:00:00Z",
            "provider_history_as_of": "2026-07-10",
        }
        write_json(store._state_path("LOST"), {
            "schema_version": "yahoo-batch-quote-history-state/v1",
            "ticker": "LOST",
            "resolution_state": "unavailable",
            "retry": True,
            "latest_failure": failure,
            "latest_promotion_deferral": deferral,
            "last_attempt": {**deferral, "outcome": "failed", "error": "recovery_requires_schedule", "attempts_used": 1, "failures": []},
            "attempts": [{**deferral, "outcome": "failed", "error": "recovery_requires_schedule", "attempts_used": 1, "failures": []}],
        })
        index = store.rebuild_index({"LOST"}, run)
        assessment = self.fetcher.yahoo_failure_exit_assessment(
            [{"ticker": "LOST", "error": "promotion deferred: recovery_requires_schedule", "failure_kind": "recovery_requires_schedule"}],
            store,
            index,
        )
        self.assertEqual(assessment["exit_code"], 2)
        self.assertTrue(any("lost previously advertised" in reason for reason in assessment["reasons"]))

    def test_korean_provider_gap_with_stale_lkg_remains_degraded_not_corrupt(self) -> None:
        ticker = "012510.KS"
        payload = self._daily_payload(ticker)
        write_json(self.fetcher.OUT_DIR / f"{ticker}.json", payload)
        store = self.fetcher.YahooBatchStateStore(
            self.fetcher.YAHOO_BATCH_STATE_ROOT,
            self.fetcher.OUT_DIR,
        )
        run = {
            "run_id": "korean-provider-gap",
            "run_attempt": 1,
            "event_name": "schedule",
            "schedule": "20 23 * * 1-5",
            "natural": True,
            "shard": "0/5",
            "observed_at": "2026-07-14T01:00:00Z",
        }
        store.bootstrap_existing(
            {ticker},
            {ticker: ["market_facts"]},
            run,
            source_age_business_days={ticker: 20},
            max_source_business_days=6,
        )
        store.record_failure(
            ticker,
            "empty payload",
            run,
            ["market_facts"],
            {
                "attempts_used": 2,
                "failures": [
                    {"attempt": 1, "error": "empty payload"},
                    {"attempt": 2, "error": "empty payload"},
                ],
                "latency_ms": 0,
            },
            failure_kind=self.fetcher.yahoo_failure_kind(
                {"ticker": ticker, "error": "empty payload", "failures": []},
                event_name=run["event_name"],
            ),
        )
        index = store.rebuild_index({ticker}, run)
        assessment = self.fetcher.yahoo_failure_exit_assessment(
            [{"ticker": ticker, "error": "empty payload", "failures": []}],
            store,
            index,
        )

        self.assertEqual(assessment["exit_code"], 0)
        self.assertEqual(index["counts"]["lkg"], 1)
        self.assertEqual(index["counts"]["retry"], 1)
        self.assertIn(ticker, index["stale_groups"][0]["symbols"])

    def test_auth_and_decode_markers_are_systemic_without_a_percentage_gate(self) -> None:
        for error, category in [
            ("HTTP 401 Unauthorized", "authentication"),
            ("JSONDecodeError: Expecting value", "decode"),
        ]:
            with self.subTest(error=error):
                reasons = self.fetcher._systemic_failure_reasons(
                    [{"ticker": "FAIL", "error": error, "failures": []}]
                )
                self.assertEqual(len(reasons), 1)
                self.assertIn(category, reasons[0])

    def test_current_failure_is_prioritized_into_bounded_kpi_lkg_details(self) -> None:
        store = self.fetcher.YahooBatchStateStore(
            self.fetcher.YAHOO_BATCH_STATE_ROOT,
            self.fetcher.OUT_DIR,
        )
        old_run = {
            "run_id": "old-run",
            "run_attempt": 1,
            "event_name": "schedule",
            "schedule": "20 23 * * 1-5",
            "natural": True,
            "shard": "0/5",
            "observed_at": "2026-07-13T01:00:00Z",
        }
        current_run = {**old_run, "run_id": "current-run", "observed_at": "2026-07-14T01:00:00Z"}
        active = {"ZZZ"}
        for index in range(25):
            ticker = f"OLD{index:02d}"
            active.add(ticker)
            write_json(self.fetcher.OUT_DIR / f"{ticker}.json", self._daily_payload(ticker))
            store.record_failure(
                ticker,
                "historical isolated failure",
                old_run,
                ["test_fixture"],
                {"attempts_used": 1, "failures": [], "latency_ms": 0},
            )
        write_json(self.fetcher.OUT_DIR / "ZZZ.json", self._daily_payload("ZZZ"))
        store.record_failure(
            "ZZZ",
            "current isolated failure",
            current_run,
            ["test_fixture"],
            {"attempts_used": 1, "failures": [], "latency_ms": 0},
        )

        index = store.rebuild_index(active, current_run)

        self.assertEqual(len(index["lkg_details"]), 20)
        self.assertEqual(index["lkg_details"][0]["symbol"], "ZZZ")

    def test_stockanalysis_etfs_parse_records_tables_and_aum_priority(self) -> None:
        write_json(
            self.fetcher.STOCKANALYSIS_ETF_UNIVERSE,
            {
                "records": [
                    {"ticker": "AAA", "aum_raw": "1M"},
                    {"ticker": "$VOO", "aum": 1_000_000_000},
                    {"ticker": "NASDAQ", "aum": 999_000_000_000},
                    {"ticker": "bad symbol", "aum": 1},
                ]
            },
        )
        write_json(
            self.fetcher.STOCKANALYSIS_ETF_SCREENER,
            {
                "tables": [
                    {
                        "records": [
                            {"s": "BND", "aum": "5B"},
                            {"symbol": "VOO", "aum": "2B"},
                        ]
                    }
                ]
            },
        )

        self.assertEqual(self.fetcher.load_stockanalysis_etfs(), {"AAA", "BND", "VOO"})
        self.assertEqual(
            self.fetcher.sort_universe({"AAA", "BND", "VOO", "ZZZ"}, stockanalysis_etfs=True),
            ["BND", "VOO", "AAA", "ZZZ"],
        )

    def test_load_core_daily_basket_validates_daily_refresh_universe_tickers(self) -> None:
        with self.assertRaisesRegex(ValueError, "core daily basket is unreadable"):
            self.fetcher.load_core_daily_basket()
        write_json(
            self.fetcher.ETF_CORE_DAILY_BASKET,
            {
                "daily_refresh_universe": {
                    "count": 3,
                    "tickers": ["SPY", "qqq", "VTI "],
                }
            },
        )

        self.assertEqual(
            self.fetcher.load_core_daily_basket(),
            {"SPY", "QQQ", "VTI"},
        )

        # The scheduled lane's labeled union is the basket plus the three
        # configured ETF sets, never the StockAnalysis universe/screener.
        sources = self.fetcher.load_core_daily_basket_sources()
        self.assertEqual(
            sources["SPY"],
            ["core_daily_basket", "major_etf_configuration", "rim_tracker_configuration"],
        )
        self.assertEqual(sources["QQQ"], ["core_daily_basket", "major_etf_configuration", "rim_tracker_configuration"])
        self.assertEqual(sources["VTI"], ["core_daily_basket", "major_etf_configuration"])
        self.assertEqual(sources["TQQQ"], ["focus_etf_configuration"])
        self.assertEqual(sources["ONEQ"], ["rim_tracker_configuration"])
        self.assertEqual(len(sources), 56)
        self.assertEqual(list(sources), sorted(sources))

        self.fetcher.ETF_CORE_DAILY_BASKET.write_text("{broken", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "core daily basket is unreadable"):
            self.fetcher.load_core_daily_basket()

        for payload, pattern in [
            (["not", "an", "object"], "core daily basket must be an object"),
            ({"daily_refresh_universe": []}, "daily_refresh_universe must be an object"),
            ({"daily_refresh_universe": {"count": 1, "tickers": "SPY"}}, "tickers must be a list"),
            ({"daily_refresh_universe": {"count": 0, "tickers": []}}, "core daily basket is empty"),
            ({"daily_refresh_universe": {"count": 1, "tickers": ["BAD_SYMBOL"]}}, "invalid tickers"),
            ({"daily_refresh_universe": {"count": 2, "tickers": ["SPY"]}}, "count mismatch"),
            ({"daily_refresh_universe": {"tickers": ["SPY"]}}, "count must be an integer"),
        ]:
            with self.subTest(pattern=pattern):
                write_json(self.fetcher.ETF_CORE_DAILY_BASKET, payload)
                with self.assertRaisesRegex(ValueError, pattern):
                    self.fetcher.load_core_daily_basket()

    def test_core_daily_basket_mode_selects_bounded_union_plus_explicit_tickers(self) -> None:
        write_json(self.fetcher.ETF_CORE_DAILY_BASKET, {"daily_refresh_universe": {"count": 2, "tickers": ["SMALL", "BIG"]}})
        # The StockAnalysis universe/screener must not enter the candidate set.
        write_json(self.fetcher.STOCKANALYSIS_ETF_UNIVERSE, {"records": [{"ticker": "ZZSA", "aum": "9B"}]})
        write_json(self.fetcher.STOCKANALYSIS_ETF_SCREENER, {"records": [{"s": "YYSA", "aum": "8B"}]})
        expected_union = (
            {"BIG", "SMALL"}
            | self.fetcher.MAJOR_ETFS
            | self.fetcher.LEVERAGED_AND_FOCUS_ETFS
            | self.fetcher.RIM_TRACKER_ETFS
        )
        self.fetcher.fetch_with_retry = lambda *args, **kwargs: None
        original_argv, original_stdout = sys.argv, sys.stdout
        buffer = io.StringIO()
        try:
            sys.argv = [
                "fetch-yf-finance.py", "--core-daily-basket", "--plan-only", "--plan-sample-size", "10",
            ]
            sys.stdout = buffer
            self.fetcher.main()
        finally:
            sys.argv, sys.stdout = original_argv, original_stdout

        payload = json.loads(buffer.getvalue())
        self.assertEqual(payload["candidate_count_before_filters"], len(expected_union))
        self.assertEqual(payload["sample"], sorted(expected_union)[:10])
        self.assertEqual(payload["priority"], "ticker")
        self.assertTrue(payload["core_daily_basket"])

        # Manual explicit tickers still work and are the whole plan.
        buffer = io.StringIO()
        try:
            sys.argv = [
                "fetch-yf-finance.py", "--core-daily-basket", "--tickers", "ZZZ,SMALL",
                "--plan-only", "--plan-sample-size", "10",
            ]
            sys.stdout = buffer
            self.fetcher.main()
        finally:
            sys.argv, sys.stdout = original_argv, original_stdout

        payload = json.loads(buffer.getvalue())
        self.assertEqual(payload["candidate_count_before_filters"], 2)
        self.assertEqual(payload["sample"], ["ZZZ", "SMALL"])
        self.assertTrue(payload["tickers_override"])

    def test_core_daily_basket_six_stable_shards_attempt_each_ticker_once(self) -> None:
        canonical = json.loads((ROOT / "data/admin/fenok-etf-core-daily-basket.json").read_text(encoding="utf-8"))
        universe = canonical["daily_refresh_universe"]
        core = set(universe["tickers"])
        self.assertEqual(universe["count"], len(core))
        self.assertEqual(len(core), 100)
        bounded_union = core | self.fetcher.MAJOR_ETFS | self.fetcher.LEVERAGED_AND_FOCUS_ETFS | self.fetcher.RIM_TRACKER_ETFS
        retry = sorted(bounded_union)[:50]
        plans = [
            self.fetcher.select_ticker_plan(
                sorted(bounded_union),
                retry,
                shard=f"{shard_index}/6",
                natural=True,
                all_shards=True,
                retry_limit=40,
                stable_shards=True,
                pin_rim_trackers=False,
                return_retry_overflow_to_regular=True,
            )
            for shard_index in range(6)
        ]
        attempted = [ticker for plan in plans for ticker in plan]
        self.assertEqual(set(attempted), bounded_union)
        self.assertEqual(len(attempted), len(bounded_union))
        self.assertEqual(len(attempted), 155)
        self.assertEqual(len(set(attempted)), 155)

    def test_load_universe_keeps_stockanalysis_etfs_aum_first_for_limited_backfills(self) -> None:
        write_json(self.fetcher.STOCKANALYSIS_ETF_UNIVERSE, {"records": [{"ticker": "SMALL", "aum": "1M"}]})
        write_json(self.fetcher.STOCKANALYSIS_ETF_SCREENER, {"records": [{"s": "BIG", "aum": "10B"}]})
        write_json(self.fetcher.ETF_INDEX, {"etfs": {}})
        self.fetcher.DASHBOARD_CONSTANTS.parent.mkdir(parents=True)
        self.fetcher.DASHBOARD_CONSTANTS.write_text("", encoding="utf-8")
        self.fetcher.PORTFOLIO_TS.write_text("", encoding="utf-8")
        for ticker in ("ZZZ", "AAA"):
            write_json(self.fetcher.STOCK_UNIVERSE_DIR / f"{ticker}.json", {})

        tickers = self.fetcher.load_universe(stockanalysis_etfs=True)

        self.assertEqual(tickers[:2], ["BIG", "SMALL"])
        self.assertIn("AAA", tickers)
        self.assertIn("ZZZ", tickers)

    def test_stocks_only_universe_includes_market_facts_class_and_asia_rows(self) -> None:
        write_json(
            self.fetcher.MARKET_FACTS_INDEX,
            {
                "rows": [
                    {"ticker": "USCLASS-A", "asset_type": "stock", "market": "US_CLASS"},
                    {"ticker": "0700.HK", "asset_type": "stock", "market": "HKEX"},
                    {"ticker": "600519.SS", "asset_type": "stock", "market": "SSE"},
                    {"ticker": "000001.SZ", "asset_type": "stock", "market": "SZSE"},
                    {"ticker": "ETFROW", "asset_type": "etf", "market": "US"},
                    {"ticker": "bad symbol", "asset_type": "stock", "market": "US"},
                ],
            },
        )
        write_json(self.fetcher.STOCKANALYSIS_ETF_UNIVERSE, {"records": []})
        write_json(self.fetcher.STOCKANALYSIS_ETF_SCREENER, {"records": []})

        tickers = self.fetcher.load_universe(stocks_only=True)

        self.assertIn("USCLASS-A", tickers)
        self.assertIn("0700.HK", tickers)
        self.assertIn("600519.SS", tickers)
        self.assertIn("000001.SZ", tickers)
        self.assertNotIn("ETFROW", tickers)
        self.assertNotIn("bad symbol", tickers)

    def test_unlimited_daily_shard_union_covers_future_stock_universe(self) -> None:
        symbols = [f"STK{i:04d}" for i in range(1405)]
        write_json(
            self.fetcher.MARKET_FACTS_INDEX,
            {"rows": [{"ticker": ticker, "asset_type": "stock"} for ticker in symbols]},
        )

        tickers = self.fetcher.load_universe(stocks_only=True)
        shard_union = {
            ticker
            for shard_index in range(5)
            for ticker in tickers[shard_index::5]
        }
        capped_shard_union = {
            ticker
            for shard_index in range(5)
            for ticker in tickers[shard_index::5][:260]
        }

        self.assertEqual(set(tickers), shard_union)
        self.assertLess(len(capped_shard_union), len(tickers))

    def test_filter_history_gaps_skips_only_payloads_with_enough_history_rows(self) -> None:
        write_json(
            self.fetcher.OUT_DIR / "READY.json",
            {"data": {"info": {"quoteType": "ETF"}, "history_1y": [{"date": f"2026-01-{(idx % 28) + 1:02d}"} for idx in range(200)]}},
        )
        write_json(
            self.fetcher.OUT_DIR / "SHORT.json",
            {"data": {"info": {"quoteType": "ETF"}, "history_1y": [{"date": "2026-01-01"} for _ in range(50)]}},
        )
        write_json(self.fetcher.OUT_DIR / "EMPTY.json", {"data": {}})

        selected = self.fetcher.filter_history_gaps(["READY", "SHORT", "MISSING", "EMPTY"], min_rows=200)

        self.assertEqual(selected, ["SHORT", "MISSING", "EMPTY"])

    def test_stable_json_removes_non_finite_numbers(self) -> None:
        text = self.fetcher.stable_json(
            {
                "valid": 1,
                "drop_inf": float("inf"),
                "nested": {
                    "drop_negative_inf": -float("inf"),
                    "keep": 2,
                },
                "rows": [
                    {"drop_nan": float("nan"), "keep": 3},
                ],
            }
        )

        self.assertNotIn("Infinity", text)
        self.assertNotIn("NaN", text)
        payload = json.loads(text)
        self.assertEqual(payload["valid"], 1.0)
        self.assertNotIn("drop_inf", payload)
        self.assertEqual(payload["nested"], {"keep": 2.0})
        self.assertEqual(payload["rows"], [{"keep": 3.0}])

    def test_fetch_with_retry_records_ticker_timeout(self) -> None:
        def timeout_fetch(*_args, **_kwargs):
            raise self.fetcher.FetchTimeout("SLOW exceeded ticker timeout (1s)")

        self.fetcher.fetch_ticker = timeout_fetch

        data, latency_ms, error = self.fetcher.fetch_with_retry(
            "SLOW",
            retries=0,
            timeout_seconds=1,
        )

        self.assertIsNone(data)
        self.assertEqual(latency_ms, 0)
        self.assertEqual(error, "SLOW exceeded ticker timeout (1s)")

    def test_fetch_with_retry_preserves_swallowed_systemic_provider_error(self) -> None:
        def swallowed_rate_limit(*_args, **_kwargs):
            self.fetcher.safe(
                lambda: (_ for _ in ()).throw(RuntimeError("HTTP 429 Too Many Requests"))
            )
            return {"info": None, "history_1y": None}, 1

        self.fetcher.fetch_ticker = swallowed_rate_limit

        data, latency_ms, error, evidence = self.fetcher.fetch_with_retry(
            "HOLX",
            retries=0,
            timeout_seconds=1,
            include_evidence=True,
        )

        self.assertIsNone(data)
        self.assertEqual(latency_ms, 0)
        self.assertEqual(error, "empty payload")
        self.assertIn("HTTP 429", " ".join(row["error"] for row in evidence["failures"]))
        self.assertEqual(
            self.fetcher.yahoo_failure_kind(
                {"ticker": "HOLX", "error": error, "failures": evidence["failures"]},
                event_name="schedule",
            ),
            "systemic_rate_limit",
        )

    def test_safe_provider_failure_evidence_is_bounded_and_sanitized(self) -> None:
        raw_error = (
            "provider optional endpoint failed "
            + "x" * 100
            + " diagnostic-marker https://provider.example/quote?api_key=secret-value "
            + "Authorization: Bearer abc.def payload: {\"token\":\"secret-value\",\"rows\":[1,2,3]}"
        )

        def swallowed_provider_error(*_args, **_kwargs):
            self.fetcher.safe(lambda: (_ for _ in ()).throw(RuntimeError(raw_error)))
            return {"info": {"symbol": "SAFE"}, "history_1y": None}, 1

        self.fetcher.fetch_ticker = swallowed_provider_error
        _data, _latency_ms, error, evidence = self.fetcher.fetch_with_retry(
            "SAFE",
            retries=0,
            timeout_seconds=1,
            include_evidence=True,
        )

        self.assertIsNone(error)
        detail = evidence["failures"][0]["error"]
        self.assertIn("RuntimeError: provider optional endpoint failed", detail)
        self.assertLessEqual(len(detail), 320)
        self.assertNotIn("secret-value", detail)
        self.assertNotIn("abc.def", detail)
        self.assertNotIn('"rows"', detail)

    def test_record_finance_failure_uses_bounded_sanitized_detail(self) -> None:
        raw_error = (
            "provider failure "
            + "x" * 1000
            + " https://provider.example/quote?api_key=secret-value Authorization: Bearer abc.def"
        )
        captured = {}
        self.fetcher.is_enrolled_stock_detail = lambda _ticker: True
        self.fetcher.record_stock_detail_failure = lambda **kwargs: captured.update(kwargs)

        self.fetcher.record_finance_failure("AAPL", raw_error)

        detail = captured["failure_detail"]
        self.assertEqual(len(detail), 320)
        self.assertNotIn("secret-value", detail)
        self.assertNotIn("abc.def", detail)

    def test_failure_log_keeps_a_bounded_sanitized_diagnostic(self) -> None:
        error = (
            "ValueError: "
            + "x" * 100
            + " endpoint moved diagnostic-marker "
            + "https://provider.example/quote?api_key=secret-value "
            + "Authorization: Bearer abc.def payload: {\"token\":\"secret-value\",\"rows\":[1,2,3]}"
        )
        self.fetcher.fetch_with_retry = lambda *_args, **_kwargs: (
            None,
            0,
            error,
            {"attempts_used": 1, "failures": [{"attempt": 1, "error": error}], "latency_ms": 0},
        )
        stdout = io.StringIO()
        original_argv, original_stdout = sys.argv, sys.stdout
        try:
            sys.argv = ["fetch-yf-finance.py", "--tickers", "FAIL", "--sleep", "0", "--retries", "0"]
            sys.stdout = stdout
            with self.assertRaises(SystemExit) as raised:
                self.fetcher.main()
        finally:
            sys.argv, sys.stdout = original_argv, original_stdout

        self.assertEqual(raised.exception.code, 2)
        diagnostic = next(line.split("FAIL: ", 1)[1] for line in stdout.getvalue().splitlines() if "FAIL: " in line)
        self.assertIn("endpoint moved diagnostic-marker", diagnostic)
        self.assertLessEqual(len(diagnostic), 320)
        self.assertNotIn("secret-value", diagnostic)
        self.assertNotIn("abc.def", diagnostic)
        self.assertNotIn('"rows"', diagnostic)
        self.assertIn("[redacted]", diagnostic)
        self.assertEqual(len(self.fetcher.bounded_diagnostic_detail("x" * 1000)), 320)
        userinfo = self.fetcher.bounded_diagnostic_detail(
            RuntimeError("request failed https://alice:supersecret@example.com/quote")
        )
        self.assertNotIn("alice", userinfo)
        self.assertNotIn("supersecret", userinfo)
        self.assertIn("https://example.com/quote", userinfo)
        summary = json.loads((self.fetcher.OUT_DIR / "_summary.json").read_text(encoding="utf-8"))
        persisted_error = summary["errors"][0]["error"]
        self.assertLessEqual(len(persisted_error), 320)
        self.assertNotIn("secret-value", persisted_error)
        self.assertNotIn("abc.def", persisted_error)
        self.assertNotIn('"rows"', persisted_error)

    def test_batch_state_persists_only_bounded_sanitized_failure_details(self) -> None:
        raw_error = (
            "ValueError: "
            + "x" * 100
            + " diagnostic-marker https://provider.example/quote?api_key=secret-value "
            + "Authorization: Bearer abc.def payload: {\"token\":\"secret-value\",\"rows\":[1,2,3]}"
        )
        self.fetcher.load_universe_sources = lambda **_kwargs: {"FAIL": ["test_fixture"]}
        self.fetcher.fetch_with_retry = lambda *_args, **_kwargs: (
            None,
            0,
            raw_error,
            {"attempts_used": 1, "failures": [{"attempt": 1, "error": raw_error}], "latency_ms": 0},
        )
        stdout = io.StringIO()
        original_argv, original_stdout = sys.argv, sys.stdout
        try:
            sys.argv = [
                "fetch-yf-finance.py", "--tickers", "FAIL", "--record-batch-state",
                "--run-id", "redaction-state", "--run-attempt", "1", "--event-name", "workflow_dispatch",
                "--sleep", "0", "--retries", "0",
            ]
            sys.stdout = stdout
            with self.assertRaises(SystemExit) as raised:
                self.fetcher.main()
        finally:
            sys.argv, sys.stdout = original_argv, original_stdout

        self.assertEqual(raised.exception.code, 2)
        state = json.loads((self.fetcher.YAHOO_BATCH_STATE_ROOT / "tickers" / "FAIL.json").read_text(encoding="utf-8"))
        serialized = "\n".join(
            [
                json.dumps(state),
                (self.fetcher.YAHOO_BATCH_STATE_ROOT / "index.json").read_text(encoding="utf-8"),
                (self.fetcher.OUT_DIR / "_summary.json").read_text(encoding="utf-8"),
                stdout.getvalue(),
            ]
        )
        self.assertLessEqual(len(state["latest_failure"]["error"]), 320)
        self.assertIn("diagnostic-marker", state["latest_failure"]["error"])
        self.assertNotIn("secret-value", serialized)
        self.assertNotIn("abc.def", serialized)
        self.assertNotIn('"rows"', serialized)

    def test_source_timestamps_are_provider_derived_and_distinct_from_fetch_time(self) -> None:
        payload = self.fetcher.decorate_finance_payload(
            ticker="AAPL",
            profile="daily",
            fetched_at="2026-07-10T21:15:00Z",
            data={
                "info": {
                    "symbol": "AAPL",
                    "quoteType": "EQUITY",
                    "regularMarketTime": 1783540800,
                    "firstTradeDateEpochUtc": 345459600,
                },
                "history_1y": [
                    {"date": "2026-07-07", "Close": 310},
                    {"date": "2026-07-08", "Close": 313},
                ],
            },
        )

        self.assertEqual(payload["quote_as_of"], "2026-07-08T20:00:00Z")
        self.assertEqual(payload["history_as_of"], "2026-07-08")
        self.assertEqual(payload["source_as_of"], "2026-07-08")
        self.assertEqual(payload["first_trade_date"], "1980-12-12")
        self.assertNotEqual(payload["source_as_of"], payload["fetched_at"])

    def test_source_timestamp_future_or_regression_rejects_candidate_before_overwrite(self) -> None:
        existing = self.fetcher.decorate_finance_payload(
            ticker="AAPL",
            profile="daily",
            fetched_at="2026-07-10T21:15:00Z",
            data={
                "info": {"symbol": "AAPL", "quoteType": "EQUITY", "regularMarketTime": 1783713600},
                "history_1y": [{"date": "2026-07-10", "Close": 314}],
            },
        )
        regressed = self.fetcher.decorate_finance_payload(
            ticker="AAPL",
            profile="daily",
            fetched_at="2026-07-11T21:15:00Z",
            data={
                "info": {"symbol": "AAPL", "quoteType": "EQUITY", "regularMarketTime": 1783540800},
                "history_1y": [{"date": "2026-07-08", "Close": 313}],
            },
        )

        with self.assertRaisesRegex(ValueError, "source timestamp regression"):
            self.fetcher.validate_source_progression(existing, regressed)

        with self.assertRaisesRegex(ValueError, "quote_as_of follows fetched_at"):
            self.fetcher.decorate_finance_payload(
                ticker="FUTR",
                profile="daily",
                fetched_at="2026-07-10T21:15:00Z",
                data={
                    "info": {"symbol": "FUTR", "quoteType": "EQUITY", "regularMarketTime": 1783972800},
                    "history_1y": [{"date": "2026-07-10", "Close": 10}],
                },
            )

    def test_missing_quote_stamp_or_disappearing_history_rejects_candidate(self) -> None:
        with self.assertRaisesRegex(ValueError, "quote_as_of is unavailable"):
            self.fetcher.decorate_finance_payload(
                ticker="NOSTAMP",
                profile="daily",
                fetched_at="2026-07-10T21:15:00Z",
                data={
                    "info": {"symbol": "NOSTAMP", "quoteType": "EQUITY"},
                    "history_1y": [{"date": "2026-07-10", "Close": 10}],
                },
            )

        existing = self.fetcher.decorate_finance_payload(
            ticker="AAPL",
            profile="daily",
            fetched_at="2026-07-10T21:15:00Z",
            data={
                "info": {"symbol": "AAPL", "quoteType": "EQUITY", "regularMarketTime": 1783713600},
                "history_1y": [{"date": "2026-07-10", "Close": 314}],
            },
        )
        no_history = self.fetcher.decorate_finance_payload(
            ticker="AAPL",
            profile="daily",
            fetched_at="2026-07-11T21:15:00Z",
            data={
                "info": {"symbol": "AAPL", "quoteType": "EQUITY", "regularMarketTime": 1783800000},
                "history_1y": None,
            },
        )
        with self.assertRaisesRegex(ValueError, "source history disappeared"):
            self.fetcher.validate_source_progression(existing, no_history)

        collapsed = self.fetcher.decorate_finance_payload(
            ticker="AAPL",
            profile="daily",
            fetched_at="2026-07-11T21:15:00Z",
            data={
                "info": {"symbol": "AAPL", "quoteType": "EQUITY", "regularMarketTime": 1783800000},
                "history_1y": [{"date": "2026-07-11", "Close": 315}],
            },
        )
        with self.assertRaisesRegex(ValueError, "history coverage collapsed"):
            self.fetcher.validate_source_progression(existing, collapsed)

    def test_failed_ticker_preserves_exact_lkg_and_last_fourteen_attempts(self) -> None:
        state_root = self.root / "admin" / "yahoo-batch-quote-history"
        store = self.fetcher.YahooBatchStateStore(state_root, self.fetcher.OUT_DIR)
        payload = self.fetcher.decorate_finance_payload(
            ticker="AAPL",
            profile="daily",
            fetched_at="2026-07-10T21:15:00Z",
            data={
                "info": {"symbol": "AAPL", "quoteType": "EQUITY", "regularMarketTime": 1783713600},
                "history_1y": [{"date": "2026-07-10", "Close": 314}],
            },
        )
        truth = self.fetcher.OUT_DIR / "AAPL.json"
        write_json(truth, payload)
        expected_bytes = truth.read_bytes()
        expected_hash = hashlib.sha256(expected_bytes).hexdigest()
        store.record_success(
            "AAPL", payload, self._run("seed"), ["global_scouter"],
            {"attempts_used": 1, "failures": [], "latency_ms": 1},
        )

        for index in range(16):
            store.record_failure(
                "AAPL",
                f"controlled failure {index}",
                self._run(f"run-{index}"),
                ["global_scouter"],
                {"attempts_used": 2, "failures": [{"attempt": 1, "error": "timeout"}]},
            )

        state = json.loads((state_root / "tickers" / "AAPL.json").read_text())
        lkg = state_root / "lkg" / "AAPL.json"
        self.assertEqual(state["resolution_state"], "lkg_primary")
        self.assertTrue(state["retry"])
        self.assertEqual(state["lkg"]["payload_sha256"], expected_hash)
        self.assertEqual(lkg.read_bytes(), expected_bytes)
        self.assertEqual(len(state["attempts"]), 14)
        self.assertEqual(state["attempts"][0]["run_id"], "run-2")
        self.assertEqual(state["attempts"][-1]["run_id"], "run-15")
        self.assertEqual(len(list((state_root / "lkg").glob("AAPL*.json"))), 1)

        index = store.rebuild_index({"AAPL"}, self._run("run-15"))
        self.assertEqual(index["counts"]["lkg"], 1)
        self.assertEqual(index["counts"]["retry"], 1)
        self.assertEqual(index["current_attempt"]["failed"], 1)
        self.assertEqual(index["latest_failure"]["run_id"], "run-15")

        same_source = dict(payload)
        self.assertFalse(store.recovery_candidate_advances("AAPL", same_source))
        advanced = self.fetcher.decorate_finance_payload(
            ticker="AAPL",
            profile="daily",
            fetched_at="2026-07-11T21:15:00Z",
            data={
                "info": {"symbol": "AAPL", "quoteType": "EQUITY", "regularMarketTime": 1783800000},
                "history_1y": [{"date": "2026-07-11", "Close": 315}],
            },
        )
        self.assertTrue(store.recovery_candidate_advances("AAPL", advanced))
        truth.write_bytes(b"{")
        store.record_failure(
            "AAPL", "canonical corruption probe", self._run("run-corrupt"), ["global_scouter"],
            {"attempts_used": 1, "failures": []},
        )
        self.assertEqual(lkg.read_bytes(), expected_bytes, "invalid canonical bytes must never replace the valid LKG")
        truth.write_text("{}\n", encoding="utf-8")
        store.record_failure(
            "AAPL", "shape corruption probe", self._run("run-shape-corrupt"), ["global_scouter"],
            {"attempts_used": 1, "failures": []},
        )
        self.assertEqual(lkg.read_bytes(), expected_bytes, "shape-invalid canonical JSON must never replace the valid LKG")
        write_json(lkg, {**payload, "ticker": "MSFT"})
        invalid_lkg_state = store.record_failure(
            "AAPL", "LKG tamper probe", self._run("run-lkg-tamper"), ["global_scouter"],
            {"attempts_used": 1, "failures": []},
        )
        self.assertEqual(invalid_lkg_state["resolution_state"], "unavailable")
        self.assertFalse(lkg.exists(), "identity/hash-invalid LKG must not remain advertised")
        self.assertEqual(list(state_root.rglob(".*.tmp")), [])

    def test_yahoo_batch_promotion_v2_fieldwise_proof_and_natural_gate(self) -> None:
        state_root = self.root / "admin" / "yahoo-batch-promotion-v2"
        store = self.fetcher.YahooBatchStateStore(state_root, self.fetcher.OUT_DIR)
        retained = self.fetcher.decorate_finance_payload(
            ticker="AAPL", profile="daily", fetched_at="2026-07-10T21:15:00Z",
            data={
                "info": {"symbol": "AAPL", "quoteType": "EQUITY", "regularMarketTime": 1783713600, "currentPrice": 314},
                "history_1y": [{"date": "2026-07-10", "Close": 314}],
            },
        )
        canonical = self.fetcher.OUT_DIR / "AAPL.json"
        write_json(canonical, retained)
        store.record_success(
            "AAPL", retained, self._run("seed"), ["global_scouter"],
            {"attempts_used": 1, "failures": [], "latency_ms": 1},
        )
        store.record_failure(
            "AAPL", "controlled failure", self._run("chaos"), ["global_scouter"],
            {"attempts_used": 1, "failures": []}, failure_kind="transient_provider_miss",
        )
        state_path = state_root / "tickers" / "AAPL.json"
        lkg_path = state_root / "lkg" / "AAPL.json"
        retained_lkg_bytes = lkg_path.read_bytes()

        same_run = self._run("same-natural")
        same_proof = store.build_provider_observation("AAPL", retained, same_run)
        same_decision = store.evaluate_recovery_candidate("AAPL", retained, same_proof, same_run)
        self.assertFalse(same_decision["eligible"])
        self.assertEqual(same_decision["reason"], "recovery_not_advanced_by_provider")
        same_state = store.record_promotion_deferral(
            "AAPL", same_decision, same_run, ["global_scouter"],
            {"attempts_used": 1, "failures": [], "latency_ms": 1},
        )
        self.assertEqual(same_state["latest_failure"]["run_id"], "chaos")
        self.assertEqual(same_state["latest_promotion_deferral"]["run_id"], "same-natural")
        self.assertEqual(lkg_path.read_bytes(), retained_lkg_bytes)

        advanced_provider = self.fetcher.decorate_finance_payload(
            ticker="AAPL", profile="daily", fetched_at="2026-07-11T21:15:00Z",
            data={
                "info": {"symbol": "AAPL", "quoteType": "EQUITY", "regularMarketTime": 1783800000, "currentPrice": 315},
                "history_1y": None,
            },
        )
        merged_data = self.fetcher.merge_existing_payload_data(retained, advanced_provider["data"])
        merged_data = self.fetcher.preserve_history_coverage(retained, merged_data)
        candidate = self.fetcher.decorate_finance_payload(
            ticker="AAPL", profile="daily", fetched_at="2026-07-11T21:15:00Z", data=merged_data,
        )

        manual_run = {**self._run("manual"), "event_name": "workflow_dispatch", "natural": False}
        manual_proof = store.build_provider_observation("AAPL", advanced_provider, manual_run)
        self.assertEqual(
            store.evaluate_recovery_candidate("AAPL", candidate, manual_proof, manual_run)["reason"],
            "ok",
        )
        rerun = {**self._run("rerun", attempt=2), "natural": True}
        rerun_proof = store.build_provider_observation("AAPL", advanced_provider, rerun)
        self.assertEqual(
            store.evaluate_recovery_candidate("AAPL", candidate, rerun_proof, rerun)["reason"],
            "recovery_requires_schedule",
        )

        recovery_run = self._run("recovery")
        proof = store.build_provider_observation("AAPL", advanced_provider, recovery_run)
        decision = store.evaluate_recovery_candidate("AAPL", candidate, proof, recovery_run)
        self.assertTrue(decision["eligible"], "fresh quote proof may advance while retained history is honestly merged")
        foreign_history_data = json.loads(json.dumps(merged_data))
        foreign_history_data["history_1y"] = [{"date": "2026-07-12", "Close": 999}]
        foreign_history_candidate = self.fetcher.decorate_finance_payload(
            ticker="AAPL", profile="daily", fetched_at="2026-07-12T21:15:00Z", data=foreign_history_data,
        )
        foreign_history_decision = store.evaluate_recovery_candidate(
            "AAPL", foreign_history_candidate, proof, recovery_run,
        )
        self.assertFalse(foreign_history_decision["eligible"])
        self.assertEqual(foreign_history_decision["reason"], "foreign_writer_conflict")
        write_json(canonical, candidate)
        recovered = store.record_success(
            "AAPL", candidate, recovery_run, ["global_scouter"],
            {"attempts_used": 1, "failures": [], "latency_ms": 1},
            provider_observation=proof,
        )
        self.assertEqual(recovered["resolution_state"], "fresh_primary")
        self.assertFalse(recovered["retry"])
        self.assertEqual(recovered["promotion_contract"], "provider_observation/v2")
        self.assertEqual(recovered["provider_observation"]["run_id"], "recovery")
        self.assertEqual(recovered["recovered_from_run_id"], "chaos")
        self.assertEqual(recovered["recovery_run_id"], "recovery")
        self.assertEqual(recovered["recovery_run_attempt"], 1)
        self.assertEqual(recovered["recovery_event_name"], "schedule")
        self.assertEqual(recovered["last_recovered_failure"]["run_id"], "chaos")
        self.assertEqual(lkg_path.read_bytes(), retained_lkg_bytes, "promotion keeps the retained LKG byte-identical")

    def test_yahoo_batch_promotion_v2_rejects_missing_provider_observation_and_tamper(self) -> None:
        state_root = self.root / "admin" / "yahoo-batch-promotion-conflict"
        store = self.fetcher.YahooBatchStateStore(state_root, self.fetcher.OUT_DIR)
        retained = self.fetcher.decorate_finance_payload(
            ticker="AAPL", profile="daily", fetched_at="2026-07-10T21:15:00Z",
            data={"info": {"symbol": "AAPL", "quoteType": "EQUITY", "regularMarketTime": 1783713600},
                  "history_1y": [{"date": "2026-07-10", "Close": 314}]},
        )
        canonical = self.fetcher.OUT_DIR / "AAPL.json"
        write_json(canonical, retained)
        store.record_success("AAPL", retained, self._run("seed"), ["global_scouter"], {"attempts_used": 1, "failures": []})
        store.record_failure("AAPL", "reset", self._run("chaos"), ["global_scouter"], {"attempts_used": 1, "failures": []}, failure_kind="transient_provider_miss")
        provider = self.fetcher.decorate_finance_payload(
            ticker="AAPL", profile="daily", fetched_at="2026-07-11T21:15:00Z",
            data={"info": {"symbol": "AAPL", "quoteType": "EQUITY", "regularMarketTime": 1783800000, "currentPrice": 315},
                  "history_1y": [{"date": "2026-07-11", "Close": 315}]},
        )
        run = self._run("natural")
        proof = store.build_provider_observation("AAPL", provider, run)
        forged_canonical = json.loads(json.dumps(provider))
        forged_canonical["data"]["info"]["currentPrice"] = 999
        write_json(canonical, forged_canonical)
        forged_hash = hashlib.sha256(canonical.read_bytes()).hexdigest()
        with self.assertRaisesRegex(ValueError, "not bound to canonical bytes"):
            store.record_success(
                "AAPL", provider, run, ["global_scouter"], {"attempts_used": 1, "failures": []},
                provider_observation=proof, expected_payload_sha256=forged_hash,
            )
        write_json(canonical, retained)
        contaminated = json.loads(json.dumps(provider))
        contaminated["data"]["info"]["currentPrice"] = 999
        decision = store.evaluate_recovery_candidate("AAPL", contaminated, proof, run)
        self.assertFalse(decision["eligible"])
        self.assertEqual(decision["reason"], "foreign_writer_conflict")
        before_lkg = (state_root / "lkg" / "AAPL.json").read_bytes()
        deferred = store.record_promotion_deferral("AAPL", decision, run, ["global_scouter"], {"attempts_used": 1, "failures": []})
        self.assertEqual(deferred["latest_failure"]["run_id"], "chaos")
        self.assertEqual(deferred["latest_promotion_deferral"]["reason"], "foreign_writer_conflict")
        self.assertEqual((state_root / "lkg" / "AAPL.json").read_bytes(), before_lkg)
        index = store.rebuild_index({"AAPL"}, run)
        assessment = self.fetcher.yahoo_failure_exit_assessment(
            [{"ticker": "AAPL", "error": "promotion deferred: foreign_writer_conflict", "failure_kind": "foreign_writer_conflict"}],
            store,
            index,
        )
        self.assertEqual(assessment["exit_code"], 0)
        self.assertEqual(assessment["retained_lkg_tickers"], ["AAPL"])
        self.assertEqual(index["promotion_deferral_details"][0]["ticker"], "AAPL")

        tampered = dict(proof)
        tampered["payload_sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "provider observation proof"):
            store.evaluate_recovery_candidate("AAPL", provider, tampered, self._run("tamper"))

        for source_field in ("quote_as_of", "history_as_of", "source_as_of"):
            with self.subTest(source_field=source_field):
                source_tampered = json.loads(json.dumps(provider))
                source_tampered[source_field] = "2026-01-01"
                with self.assertRaisesRegex(ValueError, "payload is invalid"):
                    store.build_provider_observation("AAPL", source_tampered, self._run(f"tamper-{source_field}"))

        proof_failure_run = self._run("proof-failure")
        store.record_failure(
            "AAPL", "provider observation proof is not payload-bound", proof_failure_run,
            ["global_scouter"], {"attempts_used": 1, "failures": []}, failure_kind="systemic_proof_contract",
        )
        proof_index = store.rebuild_index({"AAPL"}, proof_failure_run)
        proof_assessment = self.fetcher.yahoo_failure_exit_assessment(
            [{"ticker": "AAPL", "error": "provider observation proof is not payload-bound", "failure_kind": "systemic_proof_contract"}],
            store,
            proof_index,
        )
        self.assertEqual(proof_assessment["exit_code"], 2, "our proof-contract violation is corruption even with LKG")

    def test_yahoo_batch_main_natural_recovery_still_promotes_with_v2_attribution(self) -> None:
        ticker = "AAPL"
        self.fetcher.load_universe_sources = lambda **_kwargs: {ticker: ["global_scouter"]}
        retained = self._daily_payload(ticker)
        canonical = self.fetcher.OUT_DIR / f"{ticker}.json"
        write_json(canonical, retained)
        store = self.fetcher.YahooBatchStateStore(self.fetcher.YAHOO_BATCH_STATE_ROOT, self.fetcher.OUT_DIR)
        store.record_success(
            ticker, retained, self._run("seed"), ["global_scouter"],
            {"attempts_used": 1, "failures": [], "latency_ms": 1},
        )
        store.record_failure(
            ticker, "controlled failure", self._run("chaos"), ["global_scouter"],
            {"attempts_used": 1, "failures": []}, failure_kind="transient_provider_miss",
        )

        advanced_data = {
            "info": {
                "symbol": ticker,
                "quoteType": "EQUITY",
                "regularMarketTime": 1784077200,
                "currentPrice": 11,
                "previousClose": 10,
            },
            "history_1y": [{"date": "2026-07-15", "Close": 11}],
        }
        self.fetcher.fetch_with_retry = lambda *_args, **_kwargs: (
            advanced_data,
            1,
            None,
            {"attempts_used": 1, "failures": [], "latency_ms": 1},
        )
        original_argv = sys.argv
        try:
            sys.argv = [
                "fetch-yf-finance.py", "--tickers", ticker, "--record-batch-state",
                "--run-id", "natural-recovery", "--run-attempt", "1", "--event-name", "schedule",
                "--natural-run", "--sleep", "0", "--retries", "0", "--max-age-hours", "0",
            ]
            self.fetcher.main()
        finally:
            sys.argv = original_argv

        state = json.loads((self.fetcher.YAHOO_BATCH_STATE_ROOT / "tickers" / f"{ticker}.json").read_text())
        self.assertEqual(state["resolution_state"], "fresh_primary")
        self.assertFalse(state["retry"])
        self.assertEqual(state["recovered_from_run_id"], "chaos")
        self.assertEqual(state["recovery_run_id"], "natural-recovery")
        self.assertEqual(state["recovery_run_attempt"], 1)
        self.assertEqual(state["recovery_event_name"], "schedule")
        self.assertEqual(state["promotion_contract"], "provider_observation/v2")
        self.assertEqual(state["provider_observation"]["run_id"], "natural-recovery")

    def test_yahoo_batch_main_rejects_post_write_mutation_and_restores_canonical(self) -> None:
        ticker = "AAPL"
        self.fetcher.load_universe_sources = lambda **_kwargs: {ticker: ["global_scouter"]}
        retained = self._daily_payload(ticker)
        canonical = self.fetcher.OUT_DIR / f"{ticker}.json"
        write_json(canonical, retained)
        before = canonical.read_bytes()
        store = self.fetcher.YahooBatchStateStore(self.fetcher.YAHOO_BATCH_STATE_ROOT, self.fetcher.OUT_DIR)
        store.record_success(ticker, retained, self._run("seed"), ["global_scouter"], {"attempts_used": 1, "failures": []})
        store.record_failure(ticker, "controlled failure", self._run("chaos"), ["global_scouter"], {"attempts_used": 1, "failures": []}, failure_kind="transient_provider_miss")
        self.fetcher.fetch_with_retry = lambda *_args, **_kwargs: (
            {
                "info": {
                    "symbol": ticker,
                    "quoteType": "EQUITY",
                    "regularMarketTime": 1784077200,
                    "currentPrice": 11,
                    "previousClose": 10,
                },
                "history_1y": [{"date": "2026-07-15", "Close": 11}],
            },
            1,
            None,
            {"attempts_used": 1, "failures": [], "latency_ms": 1},
        )
        original_writer = self.fetcher.write_finance_payload

        def mutating_writer(symbol, payload, **kwargs):
            publication = original_writer(symbol, payload, **kwargs)
            mutated = json.loads(canonical.read_text())
            mutated["data"]["info"]["currentPrice"] = 999
            write_json(canonical, mutated)
            return publication

        self.fetcher.write_finance_payload = mutating_writer
        original_argv = sys.argv
        try:
            sys.argv = [
                "fetch-yf-finance.py", "--tickers", ticker, "--record-batch-state",
                "--run-id", "mutated-natural", "--run-attempt", "1", "--event-name", "schedule",
                "--natural-run", "--sleep", "0", "--retries", "0", "--max-age-hours", "0",
            ]
            with self.assertRaises(SystemExit) as raised:
                self.fetcher.main()
        finally:
            self.fetcher.write_finance_payload = original_writer
            sys.argv = original_argv

        self.assertEqual(raised.exception.code, 2)
        self.assertEqual(canonical.read_bytes(), before, "post-write proof failure restores the prior canonical bytes")
        state = json.loads((self.fetcher.YAHOO_BATCH_STATE_ROOT / "tickers" / f"{ticker}.json").read_text())
        self.assertEqual(state["resolution_state"], "lkg_primary")
        self.assertNotEqual(state.get("recovery_run_id"), "mutated-natural")
        self.assertEqual(state["latest_failure"]["failure_kind"], "systemic_proof_contract")
        pending_pointer = self.fetcher.DATA_SUPPLY_STATE_ROOT / "providers" / "yahoo_finance" / "stock_detail" / "pending" / f"{ticker}.json"
        self.assertFalse(pending_pointer.exists(), "batch proof must commit before stock-detail side state")
        self.assertEqual(list((self.fetcher.DATA_SUPPLY_STATE_ROOT / "history" / "observations").glob("*.jsonl")), [])

    def test_yahoo_batch_rolls_back_partial_stock_detail_side_publication(self) -> None:
        ticker = "AAPL"
        self.fetcher.load_universe_sources = lambda **_kwargs: {ticker: ["global_scouter"]}
        retained = self._daily_payload(ticker)
        canonical = self.fetcher.OUT_DIR / f"{ticker}.json"
        write_json(canonical, retained)
        before = canonical.read_bytes()
        store = self.fetcher.YahooBatchStateStore(self.fetcher.YAHOO_BATCH_STATE_ROOT, self.fetcher.OUT_DIR)
        store.record_success(ticker, retained, self._run("seed"), ["global_scouter"], {"attempts_used": 1, "failures": []})
        store.record_failure(ticker, "controlled failure", self._run("chaos"), ["global_scouter"], {"attempts_used": 1, "failures": []}, failure_kind="transient_provider_miss")
        self.fetcher.fetch_with_retry = lambda *_args, **_kwargs: (
            {
                "info": {
                    "symbol": ticker, "quoteType": "EQUITY", "regularMarketTime": 1784077200,
                    "currentPrice": 11, "previousClose": 10,
                },
                "history_1y": [{"date": "2026-07-15", "Close": 11}],
            },
            1,
            None,
            {"attempts_used": 1, "failures": [], "latency_ms": 1},
        )
        original_writer = self.fetcher.write_finance_payload

        def failing_side_writer(symbol, payload, **kwargs):
            publication = original_writer(symbol, payload, **kwargs)
            if isinstance(publication, dict) and "store" in publication:
                original_record = publication["store"].record_observation

                def fail_after_append(observation):
                    original_record(observation)
                    raise RuntimeError("injected observation history failure")

                publication["store"].record_observation = fail_after_append
            return publication

        self.fetcher.write_finance_payload = failing_side_writer
        original_argv = sys.argv
        try:
            sys.argv = [
                "fetch-yf-finance.py", "--tickers", ticker, "--record-batch-state",
                "--run-id", "side-state-failure", "--run-attempt", "1", "--event-name", "schedule",
                "--natural-run", "--sleep", "0", "--retries", "0", "--max-age-hours", "0",
            ]
            with self.assertRaises(SystemExit) as raised:
                self.fetcher.main()
        finally:
            self.fetcher.write_finance_payload = original_writer
            sys.argv = original_argv

        self.assertEqual(raised.exception.code, 2)
        self.assertEqual(canonical.read_bytes(), before)
        state = json.loads((self.fetcher.YAHOO_BATCH_STATE_ROOT / "tickers" / f"{ticker}.json").read_text())
        self.assertEqual(state["resolution_state"], "lkg_primary")
        self.assertEqual(state["latest_failure"]["failure_kind"], "systemic_proof_contract")
        state_files = [
            path for path in self.fetcher.DATA_SUPPLY_STATE_ROOT.rglob("*")
            if path.is_file() and not any(part.startswith(".") for part in path.relative_to(self.fetcher.DATA_SUPPLY_STATE_ROOT).parts)
        ]
        self.assertEqual(state_files, [], "partial stock-detail object, pending pointer, and history append must roll back")

    def test_yahoo_batch_rolls_back_short_jsonl_append_and_side_publication(self) -> None:
        ticker = "AAPL"
        self.fetcher.load_universe_sources = lambda **_kwargs: {ticker: ["global_scouter"]}
        retained = self._daily_payload(ticker)
        canonical = self.fetcher.OUT_DIR / f"{ticker}.json"
        write_json(canonical, retained)
        before = canonical.read_bytes()
        store = self.fetcher.YahooBatchStateStore(self.fetcher.YAHOO_BATCH_STATE_ROOT, self.fetcher.OUT_DIR)
        store.record_success(ticker, retained, self._run("seed"), ["global_scouter"], {"attempts_used": 1, "failures": []})
        store.record_failure(ticker, "controlled failure", self._run("chaos"), ["global_scouter"], {"attempts_used": 1, "failures": []}, failure_kind="transient_provider_miss")
        self.fetcher.fetch_with_retry = lambda *_args, **_kwargs: (
            {
                "info": {
                    "symbol": ticker, "quoteType": "EQUITY", "regularMarketTime": 1784077200,
                    "currentPrice": 11, "previousClose": 10,
                },
                "history_1y": [{"date": "2026-07-15", "Close": 11}],
            },
            1,
            None,
            {"attempts_used": 1, "failures": [], "latency_ms": 1},
        )
        state_module = sys.modules[self.fetcher.DataSupplyStateStore.__module__]
        original_os_write = state_module.os.write
        injected = {"done": False}

        def short_observation_write(fd, payload):
            if not injected["done"] and b'"schema_version":"data-supply-observation/v1"' in payload:
                injected["done"] = True
                partial = max(1, len(payload) // 2)
                return original_os_write(fd, payload[:partial])
            return original_os_write(fd, payload)

        state_module.os.write = short_observation_write
        original_argv = sys.argv
        try:
            sys.argv = [
                "fetch-yf-finance.py", "--tickers", ticker, "--record-batch-state",
                "--run-id", "short-jsonl", "--run-attempt", "1", "--event-name", "schedule",
                "--natural-run", "--sleep", "0", "--retries", "0", "--max-age-hours", "0",
            ]
            with self.assertRaises(SystemExit) as raised:
                self.fetcher.main()
        finally:
            state_module.os.write = original_os_write
            sys.argv = original_argv

        self.assertTrue(injected["done"])
        self.assertEqual(raised.exception.code, 2)
        self.assertEqual(canonical.read_bytes(), before)
        state = json.loads((self.fetcher.YAHOO_BATCH_STATE_ROOT / "tickers" / f"{ticker}.json").read_text())
        self.assertEqual(state["resolution_state"], "lkg_primary")
        self.assertEqual(state["latest_failure"]["failure_kind"], "systemic_proof_contract")
        state_files = [
            path for path in self.fetcher.DATA_SUPPLY_STATE_ROOT.rglob("*")
            if path.is_file() and not any(part.startswith(".") for part in path.relative_to(self.fetcher.DATA_SUPPLY_STATE_ROOT).parts)
        ]
        self.assertEqual(state_files, [], "short JSONL tail and stock-detail side publication must roll back")

    def test_stock_detail_rollback_preserves_concurrent_observation(self) -> None:
        ticker = "AAPL"
        payload = {
            "schema_version": "yf-finance/v2", "ticker": ticker,
            "fetched_at": "2026-07-10T10:00:00Z", "profile": "daily",
            "data": {
                "info": {
                    "symbol": ticker, "quoteType": "EQUITY", "regularMarketTime": 1783713600,
                    "currentPrice": 10, "previousClose": 9,
                },
                "history_1y": [{"date": "2026-07-10", "Close": 10}],
            },
        }
        publication = self.fetcher.write_finance_payload(
            ticker, payload, record_stock_detail_state=False,
        )
        store = publication["store"]
        candidate = publication["candidate"]
        observed_at = publication["observed_at"]
        object_path = store.root / "providers" / candidate.provider / "stock_detail" / "objects" / ticker / f"{candidate.payload_sha256}.json"
        pending_path = store.root / "providers" / candidate.provider / "stock_detail" / "pending" / f"{ticker}.json"
        foreign_payload = json.loads(json.dumps(payload))
        foreign_payload["data"]["info"]["currentPrice"] = 11
        foreign_payload["data"]["history_1y"][0]["Close"] = 11
        foreign_row = self.fetcher.write_finance_payload(ticker, foreign_payload)
        foreign_pending = pending_path.read_bytes()
        foreign_object = store.root / json.loads(foreign_pending)["path"]
        snapshots = {}
        captured = {}
        append_ours = store.record_observation

        def append_then_foreign(observation):
            append_ours(observation)
            foreign_store = self.fetcher.DataSupplyStateStore(
                self.fetcher.DATA_SUPPLY_STATE_ROOT,
                provider_truth_root=self.fetcher.DATA_SUPPLY_PROVIDER_TRUTH_ROOT,
                defer_maintenance=True,
            )
            self.fetcher.record_stock_detail_failure(
                store=foreign_store,
                provider="yahoo_finance",
                entity="AMD",
                provider_path="data/yf/finance/AMD.json",
                observed_at=observed_at,
                reason_code="fetch_failed",
                failure_detail="concurrent writer evidence",
                origin="manual",
            )
            raise RuntimeError("injected failure after concurrent append")

        def tracked(observation):
            captured["row"] = dict(observation)
            return append_then_foreign(observation)

        store.record_observation = tracked
        with self.assertRaises(RuntimeError):
            try:
                self.fetcher.record_stock_detail_success(
                    store=store, candidate=candidate, observed_at=observed_at, origin="manual",
                    rollback_context=snapshots,
                )
            except RuntimeError:
                self.fetcher._rollback_stock_detail_publication(
                    store, candidate, observed_at, snapshots, captured.get("row"),
                )
                raise

        history = store.root / "history" / "observations" / f"{observed_at[:10]}.jsonl"
        rows = [json.loads(line) for line in history.read_text().splitlines()]
        self.assertEqual([row["entity"] for row in rows], [foreign_row["entity"], "AMD"])
        self.assertFalse(object_path.exists())
        self.assertEqual(pending_path.read_bytes(), foreign_pending, "rollback restores the in-lock concurrent pending snapshot")
        self.assertTrue(foreign_object.exists())

    def test_stock_detail_rollback_without_in_lock_capture_preserves_preexisting_files(self) -> None:
        ticker = "AAPL"
        payload = {
            "schema_version": "yf-finance/v2", "ticker": ticker,
            "fetched_at": "2026-07-10T10:00:00Z", "profile": "daily",
            "data": {
                "info": {
                    "symbol": ticker, "quoteType": "EQUITY", "regularMarketTime": 1783713600,
                    "currentPrice": 10, "previousClose": 9,
                },
                "history_1y": [{"date": "2026-07-10", "Close": 10}],
            },
        }
        publication = self.fetcher.write_finance_payload(ticker, payload, record_stock_detail_state=False)
        store = publication["store"]
        candidate = publication["candidate"]
        object_path = store.root / "providers" / candidate.provider / "stock_detail" / "objects" / ticker / f"{candidate.payload_sha256}.json"
        pending_path = store.root / "providers" / candidate.provider / "stock_detail" / "pending" / f"{ticker}.json"
        object_path.parent.mkdir(parents=True, exist_ok=True)
        pending_path.parent.mkdir(parents=True, exist_ok=True)
        object_path.write_bytes(candidate.payload_bytes)
        write_json(pending_path, {
            "path": object_path.relative_to(store.root).as_posix(),
            "sha256": candidate.payload_sha256,
            "observed_at": publication["observed_at"],
        })
        before_object = object_path.read_bytes()
        before_pending = pending_path.read_bytes()
        self.fetcher._rollback_stock_detail_publication(
            store, candidate, publication["observed_at"], {"captured": False, "preimages": {}}, None,
        )
        self.assertEqual(object_path.read_bytes(), before_object)
        self.assertEqual(pending_path.read_bytes(), before_pending)

    def test_new_listing_without_history_is_pending_then_self_promotes(self) -> None:
        state_root = self.root / "admin" / "yahoo-batch-quote-history"
        store = self.fetcher.YahooBatchStateStore(state_root, self.fetcher.OUT_DIR)
        pending = self.fetcher.decorate_finance_payload(
            ticker="NEW",
            profile="daily",
            fetched_at="2026-07-10T21:15:00Z",
            data={
                "info": {
                    "symbol": "NEW",
                    "quoteType": "EQUITY",
                    "regularMarketTime": 1783713600,
                    "firstTradeDateEpochUtc": 1783540800,
                },
                "history_1y": None,
            },
        )
        write_json(self.fetcher.OUT_DIR / "NEW.json", pending)
        store.record_success(
            "NEW", pending, self._run("natural-1"), ["market_facts"],
            {"attempts_used": 1, "failures": [], "latency_ms": 2},
        )
        first = json.loads((state_root / "tickers" / "NEW.json").read_text())
        self.assertEqual(first["resolution_state"], "pending_history")
        self.assertTrue(first["retry"])
        self.assertEqual(first["pending"]["missing"], ["history"])
        self.assertEqual(first["pending"]["discovered_from"], ["market_facts"])
        self.assertEqual(first["pending"]["expected_resolution"], "next_natural_yahoo_run")
        self.assertEqual(first["pending"]["reason"], "recent_listing")

        manual_run = {
            **self._run("manual-pending", attempt=2), "event_name": "workflow_dispatch", "natural": False,
        }
        manual_proof = store.build_provider_observation("NEW", pending, manual_run)
        manual_decision = store.evaluate_recovery_candidate("NEW", pending, manual_proof, manual_run)
        self.assertEqual(manual_decision["reason"], "recovery_requires_schedule")
        store.record_promotion_deferral(
            "NEW", manual_decision, manual_run, ["market_facts"],
            {"attempts_used": 1, "failures": [], "latency_ms": 1},
        )
        manual_index = store.rebuild_index({"NEW"}, manual_run)
        manual_assessment = self.fetcher.yahoo_failure_exit_assessment(
            [{"ticker": "NEW", "error": "promotion deferred: recovery_requires_schedule", "failure_kind": "recovery_requires_schedule"}],
            store,
            manual_index,
        )
        self.assertEqual(manual_assessment["exit_code"], 0)
        self.assertEqual(manual_assessment["deferred_without_lkg_tickers"], ["NEW"])
        (self.fetcher.OUT_DIR / "NEW.json").unlink()
        missing_current_assessment = self.fetcher.yahoo_failure_exit_assessment(
            [{"ticker": "NEW", "error": "promotion deferred: recovery_requires_schedule", "failure_kind": "recovery_requires_schedule"}],
            store,
            manual_index,
        )
        self.assertEqual(missing_current_assessment["exit_code"], 2, "missing advertised pending canonical is corruption")
        write_json(self.fetcher.OUT_DIR / "NEW.json", pending)

        provider_without_history = self.fetcher.decorate_finance_payload(
            ticker="NEW", profile="daily", fetched_at="2026-07-11T20:00:00Z",
            data={
                "info": {
                    "symbol": "NEW", "quoteType": "EQUITY", "regularMarketTime": 1783800000,
                    "firstTradeDateEpochUtc": 1783540800,
                },
                "history_1y": None,
            },
        )
        foreign_data = json.loads(json.dumps(provider_without_history["data"]))
        foreign_data["history_1y"] = [{"date": "2026-07-11", "Close": 999}]
        foreign_history = self.fetcher.decorate_finance_payload(
            ticker="NEW", profile="daily", fetched_at="2026-07-11T20:00:00Z", data=foreign_data,
        )
        foreign_run = self._run("pending-foreign-history")
        foreign_proof = store.build_provider_observation("NEW", provider_without_history, foreign_run)
        foreign_decision = store.evaluate_recovery_candidate(
            "NEW", foreign_history, foreign_proof, foreign_run, canonical_payload=pending,
        )
        self.assertFalse(foreign_decision["eligible"])
        self.assertEqual(foreign_decision["reason"], "foreign_writer_conflict")

        recovered = self.fetcher.decorate_finance_payload(
            ticker="NEW",
            profile="daily",
            fetched_at="2026-07-11T21:15:00Z",
            data={
                "info": {
                    "symbol": "NEW",
                    "quoteType": "EQUITY",
                    "regularMarketTime": 1783800000,
                    "firstTradeDateEpochUtc": 1783540800,
                },
                "history_1y": [{"date": "2026-07-11", "Close": 10}],
            },
        )
        write_json(self.fetcher.OUT_DIR / "NEW.json", recovered)
        recovery_run = self._run("natural-2")
        recovery_proof = store.build_provider_observation("NEW", recovered, recovery_run)
        store.record_success(
            "NEW", recovered, recovery_run, ["market_facts"],
            {"attempts_used": 1, "failures": [], "latency_ms": 2},
            provider_observation=recovery_proof,
        )
        second = json.loads((state_root / "tickers" / "NEW.json").read_text())
        self.assertEqual(second["resolution_state"], "fresh_primary")
        self.assertFalse(second["retry"])
        self.assertEqual(second["recovered_from_run_id"], "natural-1")
        self.assertEqual(second["recovery_run_id"], "natural-2")

        old = self.fetcher.decorate_finance_payload(
            ticker="OLD",
            profile="daily",
            fetched_at="2026-07-10T21:15:00Z",
            data={
                "info": {
                    "symbol": "OLD", "quoteType": "EQUITY", "regularMarketTime": 1783713600,
                    "firstTradeDateEpochUtc": 946684800,
                },
                "history_1y": None,
            },
        )
        write_json(self.fetcher.OUT_DIR / "OLD.json", old)
        first_old_state = store.record_success(
            "OLD", old, self._run("natural-old"), ["market_facts"],
            {"attempts_used": 1, "failures": [], "latency_ms": 2},
        )
        self.assertEqual(first_old_state["resolution_state"], "pending_history")
        self.assertEqual(first_old_state["pending"]["reason"], "newly_discovered_no_history")
        late_run = self._run("natural-old-late")
        late_run["observed_at"] = "2026-08-20T22:00:00Z"
        late_proof = store.build_provider_observation("OLD", old, late_run)
        old_state = store.record_success(
            "OLD", old, late_run, ["market_facts"],
            {"attempts_used": 1, "failures": [], "latency_ms": 2},
            provider_observation=late_proof,
        )
        self.assertEqual(old_state["resolution_state"], "unavailable")
        self.assertNotIn("pending", old_state)

    def test_natural_retry_candidates_are_claimed_once_before_regular_shards(self) -> None:
        tickers = ["AAA", "AAPL", "BBB", "CCC", "DDD", "EEE"]
        retry = {"AAPL"}

        shard_zero = self.fetcher.select_ticker_plan(
            tickers, retry, shard="0/5", natural=True, all_shards=True,
        )
        shard_one = self.fetcher.select_ticker_plan(
            tickers, retry, shard="1/5", natural=True, all_shards=True,
        )
        weekly = self.fetcher.select_ticker_plan(
            tickers, retry, shard="3/6", natural=True, all_shards=False,
        )

        self.assertEqual(shard_zero[0], "AAPL")
        self.assertNotIn("AAPL", shard_one)
        self.assertEqual(weekly[0], "AAPL")

    def test_daily_retry_cap_rotates_oldest_candidates_without_dropping_regular_shards(self) -> None:
        store = self.fetcher.YahooBatchStateStore(
            self.root / "admin" / "yahoo-batch-quote-history",
            self.fetcher.OUT_DIR,
        )
        retries = [f"RETRY{index:03d}" for index in range(45)]
        regular = [f"STOCK{index:04d}" for index in range(1185)]
        for index, ticker in enumerate(retries):
            write_json(store._state_path(ticker), {
                "schema_version": "yahoo-batch-quote-history-state/v1",
                "ticker": ticker,
                "retry": True,
                "last_attempt": {"observed_at": f"2026-07-01T00:{index:02d}:00Z"},
                "attempts": [],
            })

        first_order = store.retry_tickers_ordered(set(retries))
        plans = [
            self.fetcher.select_ticker_plan(
                [*first_order, *regular],
                first_order,
                shard=f"{shard_index}/5",
                natural=True,
                all_shards=True,
                retry_limit=40,
            )
            for shard_index in range(5)
        ]
        first_retry_batch = [ticker for ticker in plans[0] if ticker in set(retries)]
        self.assertEqual(first_retry_batch, retries[:40])
        self.assertTrue(all(ticker not in set(retries) for plan in plans[1:] for ticker in plan))
        selected_regular = [ticker for plan in plans for ticker in plan if ticker in set(regular)]
        self.assertEqual(len(selected_regular), 1185)
        self.assertEqual(set(selected_regular), set(regular))

        for index, ticker in enumerate(first_retry_batch):
            state = json.loads(store._state_path(ticker).read_text(encoding="utf-8"))
            state["last_attempt"]["observed_at"] = f"2026-07-02T00:{index:02d}:00Z"
            write_json(store._state_path(ticker), state)

        second_order = store.retry_tickers_ordered(set(retries))
        second_plan = self.fetcher.select_ticker_plan(
            [*second_order, *regular],
            second_order,
            shard="0/5",
            natural=True,
            all_shards=True,
            retry_limit=40,
        )
        second_retry_batch = [ticker for ticker in second_plan if ticker in set(retries)]
        self.assertEqual(second_retry_batch[:5], retries[40:])

    def test_weekly_stable_shards_survive_gap_removal(self) -> None:
        tickers = [f"ETF{i:04d}" for i in range(240)]
        assignments = {}
        for shard_index in range(6):
            selected = self.fetcher.select_ticker_plan(
                tickers,
                [],
                shard=f"{shard_index}/6",
                stable_shards=True,
            )
            for ticker in selected:
                self.assertNotIn(ticker, assignments)
                assignments[ticker] = shard_index
        self.assertEqual(set(assignments), set(tickers))

        remaining = tickers[37:]
        for shard_index in range(6):
            selected = self.fetcher.select_ticker_plan(
                remaining,
                [],
                shard=f"{shard_index}/6",
                stable_shards=True,
            )
            self.assertTrue(all(assignments[ticker] == shard_index for ticker in selected))

    def test_weekly_stable_shard_overflow_rotates_into_bounded_coverage(self) -> None:
        tickers = [f"ETF{i:04d}" for i in range(2400)]
        membership = self.fetcher.select_ticker_plan(
            tickers,
            [],
            shard="0/6",
            stable_shards=True,
        )
        regular_limit = 100
        cycle_count = (len(membership) + regular_limit - 1) // regular_limit
        self.assertGreater(cycle_count, 1)

        covered = []
        for cycle_index in range(cycle_count):
            selected = self.fetcher.select_ticker_plan(
                tickers,
                [],
                shard="0/6",
                stable_shards=True,
                regular_limit=regular_limit,
                shard_cycle_index=cycle_index,
            )
            self.assertLessEqual(len(selected), regular_limit)
            covered.extend(selected)

        self.assertEqual(len(covered), len(membership))
        self.assertEqual(set(covered), set(membership))
        self.assertEqual(
            self.fetcher.select_ticker_plan(
                tickers,
                [],
                shard="0/6",
                stable_shards=True,
                regular_limit=regular_limit,
                shard_cycle_index=cycle_count,
            ),
            self.fetcher.select_ticker_plan(
                tickers,
                [],
                shard="0/6",
                stable_shards=True,
                regular_limit=regular_limit,
                shard_cycle_index=0,
            ),
        )

    def test_untracked_campaign_drains_a_mutating_shard_from_the_front(self) -> None:
        tickers = [f"ETF{i:04d}" for i in range(4200)]
        remaining = self.fetcher.select_ticker_plan(
            tickers,
            [],
            shard="0/6",
            stable_shards=True,
        )
        expected = set(remaining)
        selected = []
        while remaining:
            batch = self.fetcher.select_ticker_plan(
                remaining,
                [],
                regular_limit=100,
                shard_cycle_index=0,
            )
            self.assertLessEqual(len(batch), 100)
            selected.extend(batch)
            batch_set = set(batch)
            remaining = [ticker for ticker in remaining if ticker not in batch_set]

        self.assertEqual(set(selected), expected)
        self.assertEqual(len(selected), len(expected))

    def test_untracked_campaign_falls_back_to_rotation_when_its_shard_is_empty(self) -> None:
        tickers = [f"ETF{i:04d}" for i in range(200)]
        shard_zero = [ticker for ticker in tickers if self.fetcher.stable_shard_index(ticker, 6) == 0]
        shard_one = [ticker for ticker in tickers if self.fetcher.stable_shard_index(ticker, 6) == 1]
        selected_universe = set(tickers)

        campaign = self.fetcher.select_campaign_or_rotation_plan(
            tickers,
            shard_zero[:3],
            [],
            selected_universe,
            shard="0/6",
            natural=True,
            all_shards=False,
            retry_limit=40,
            stable_shards=True,
            regular_limit=100,
            untracked_limit=100,
            shard_cycle_index=4,
        )
        fallback = self.fetcher.select_campaign_or_rotation_plan(
            tickers,
            shard_one[:3],
            [],
            selected_universe,
            shard="0/6",
            natural=True,
            all_shards=False,
            retry_limit=40,
            stable_shards=True,
            regular_limit=100,
            untracked_limit=100,
            shard_cycle_index=0,
        )

        self.assertEqual(campaign[:3], shard_zero[:3])
        self.assertEqual(set(campaign), set(shard_zero))
        self.assertEqual(set(fallback), set(shard_zero))

    def test_untracked_campaign_reserves_regular_maintenance_capacity(self) -> None:
        tickers = [f"ETF{i:04d}" for i in range(1000)]
        shard_zero = [
            ticker
            for ticker in tickers
            if self.fetcher.stable_shard_index(ticker, 6) == 0
        ]
        untracked = shard_zero[:20]

        selected = self.fetcher.select_campaign_or_rotation_plan(
            tickers,
            untracked,
            [],
            set(tickers),
            shard="0/6",
            natural=True,
            all_shards=False,
            retry_limit=40,
            stable_shards=True,
            regular_limit=10,
            untracked_limit=6,
            shard_cycle_index=0,
        )

        self.assertEqual(selected[:6], untracked[:6])
        self.assertEqual(len(selected), 10)
        self.assertTrue(set(selected[6:]).isdisjoint(untracked))

    def test_untracked_campaign_does_not_reclassify_retries_as_maintenance(self) -> None:
        retries = [f"RETRY{i:04d}" for i in range(60)]
        regular = [f"ZZZ{i:04d}" for i in range(2000)]
        shard_zero = [
            ticker
            for ticker in regular
            if self.fetcher.stable_shard_index(ticker, 6) == 0
        ]
        untracked = shard_zero[:100]

        selected = self.fetcher.select_campaign_or_rotation_plan(
            regular,
            untracked,
            retries,
            set([*retries, *regular]),
            shard="0/6",
            natural=True,
            all_shards=False,
            retry_limit=40,
            stable_shards=True,
            regular_limit=100,
            untracked_limit=80,
            shard_cycle_index=0,
        )

        self.assertEqual(selected[:40], retries[:40])
        self.assertEqual(len([ticker for ticker in selected if ticker in untracked]), 80)
        self.assertTrue(set(selected[40:]).isdisjoint(retries))
        self.assertEqual(len(selected), 140)
        self.assertEqual(len(set(selected)), 140)

    def test_full_active_scale_has_twelve_cycle_upper_bound(self) -> None:
        tickers = [f"ETF{i:04d}" for i in range(6722)]
        for shard_index in range(6):
            membership = self.fetcher.select_ticker_plan(
                tickers,
                [],
                shard=f"{shard_index}/6",
                stable_shards=True,
            )
            cycle_count = (len(membership) + 99) // 100
            self.assertLessEqual(cycle_count, 12)
            covered = []
            for cycle_index in range(cycle_count):
                covered.extend(self.fetcher.select_bounded_cycle_page(membership, 100, cycle_index))
            self.assertEqual(len(covered), len(membership))
            self.assertEqual(set(covered), set(membership))

    def test_weekly_retry_and_rotating_regular_budgets_stay_within_total_cap(self) -> None:
        retries = [f"RETRY{i:04d}" for i in range(200)]
        regular = [f"ETF{i:04d}" for i in range(1200)]
        selected = self.fetcher.select_ticker_plan(
            [*retries, *regular],
            retries,
            natural=True,
            retry_limit=40,
            regular_limit=100,
            shard_cycle_index=3,
        )
        self.assertEqual(selected[:40], retries[:40])
        self.assertEqual(len(selected), 140)
        self.assertEqual(len([ticker for ticker in selected if ticker in regular]), 100)

    def test_bounded_cycle_rejects_invalid_contract_values(self) -> None:
        with self.assertRaisesRegex(ValueError, "regular limit must be positive"):
            self.fetcher.select_bounded_cycle_page(["AAPL"], 0, 0)
        with self.assertRaisesRegex(ValueError, "shard cycle index must be non-negative"):
            self.fetcher.select_bounded_cycle_page(["AAPL"], 100, -1)

    def test_total_limit_cannot_truncate_retry_plus_regular_budgets(self) -> None:
        with self.assertRaisesRegex(ValueError, "total limit must cover retry and regular limits"):
            self.fetcher.validate_ticker_plan_limits(139, 40, 100)
        self.assertIsNone(self.fetcher.validate_ticker_plan_limits(140, 40, 100))
        self.assertIsNone(self.fetcher.validate_ticker_plan_limits(0, 40, 100))

    def test_scheduled_cycle_uses_occurrence_weekday_across_iso_boundaries(self) -> None:
        sunday_before = self.fetcher.scheduled_shard_cycle_index(
            datetime(2026, 12, 27, 22, 0, tzinfo=timezone.utc), 0,
        )
        sunday_delayed = self.fetcher.scheduled_shard_cycle_index(
            datetime(2026, 12, 28, 1, 0, tzinfo=timezone.utc), 0,
        )
        sunday_after = self.fetcher.scheduled_shard_cycle_index(
            datetime(2027, 1, 3, 22, 0, tzinfo=timezone.utc), 0,
        )
        sunday_after_delayed = self.fetcher.scheduled_shard_cycle_index(
            datetime(2027, 1, 4, 1, 0, tzinfo=timezone.utc), 0,
        )
        self.assertEqual(sunday_delayed, sunday_before)
        self.assertEqual(sunday_after, sunday_before + 1)
        self.assertEqual(sunday_after_delayed, sunday_after)

    def test_scheduled_shard_contract_rejects_uncovered_overrides(self) -> None:
        self.assertIsNone(self.fetcher.validate_scheduled_shard("3/6", 3))
        with self.assertRaisesRegex(ValueError, "scheduled shard must match weekday/6"):
            self.fetcher.validate_scheduled_shard("4/6", 3)
        with self.assertRaisesRegex(ValueError, "scheduled shard must match weekday/6"):
            self.fetcher.validate_scheduled_shard("3/7", 3)
        with self.assertRaisesRegex(ValueError, "scheduled weekday must be within 0..5"):
            self.fetcher.validate_scheduled_shard("6/6", 6)

    def test_multi_slot_shard_contract_binds_slot_to_weekday(self) -> None:
        # A lane running several slots a day declares the slot separately from
        # the weekday. Overloading the weekday field with a 0..71 slot index
        # parser-blocked every scheduled ETF run before it fetched anything.
        for shard, weekday, slot in (("0/72", 0, 0), ("12/72", 1, 12), ("71/72", 5, 71)):
            self.assertIsNone(self.fetcher.validate_scheduled_shard(shard, weekday, slot))
        # The legacy single-slot contract must keep working untouched.
        self.assertIsNone(self.fetcher.validate_scheduled_shard("3/6", 3))
        with self.assertRaisesRegex(ValueError, "belongs to weekday 1, not the declared weekday 0"):
            self.fetcher.validate_scheduled_shard("12/72", 0, 12)
        with self.assertRaisesRegex(ValueError, "must start with the declared slot"):
            self.fetcher.validate_scheduled_shard("13/72", 1, 12)
        with self.assertRaisesRegex(ValueError, "must divide into 6 days"):
            self.fetcher.validate_scheduled_shard("12/71", 1, 12)
        with self.assertRaisesRegex(ValueError, "scheduled slot must be within 0..71"):
            self.fetcher.validate_scheduled_shard("72/72", 5, 72)

    def test_scheduled_slot_survives_a_real_argv_run(self) -> None:
        # The unit check above still passes when the flag never reaches the
        # parser, which is exactly how the shipped lane broke: the workflow was
        # text-asserted only, and every scheduled slot exited 2 before
        # fetching. Drive the real entry point with the shipped scheduled ETF
        # lane shape: one slot a day on the six-shard cycle, core daily basket
        # union selection, natural retries, stable shards, and the scheduled
        # slot/limit budget.
        script = Path(__file__).resolve().parent / "fetch-yf-finance.py"
        base = [
            sys.executable, str(script), "--plan-only", "--core-daily-basket",
            "--natural-run", "--stable-shards", "--limit", "200",
            "--regular-limit", "140", "--retry-limit", "40",
        ]

        def run(shard, weekday, slot):
            argv = [*base, "--shard", shard, "--scheduled-weekday", str(weekday)]
            if slot is not None:
                argv += ["--scheduled-slot", str(slot)]
            return subprocess.run(argv, capture_output=True, text=True, cwd=script.parent.parent)

        for shard in range(6):
            result = run(f"{shard}/6", shard, shard)
            self.assertEqual(result.returncode, 0, f"{shard}/6 must plan, got: {result.stderr[-400:]}")

        mismatched = run("1/6", 0, 1)
        self.assertEqual(mismatched.returncode, 2)
        self.assertIn("belongs to weekday 1", mismatched.stderr)

        overloaded = run("5/6", 6, None)
        self.assertEqual(overloaded.returncode, 2, "the overloaded-weekday form must stay rejected")

    def test_scheduled_etf_lane_defaults_to_core_basket_not_stockanalysis_universe(self) -> None:
        workflow = YF_WORKFLOW_PATH.read_text(encoding="utf-8")
        fetcher_source = FETCH_PATH.read_text(encoding="utf-8")
        run_step = workflow[
            workflow.index("      - name: Run batch fetch"):workflow.index("      - name: Refresh owned Yahoo quarter-close source")
        ]
        # Scheduled ETF slots always stay on the bounded core union; broad
        # acquisition remains a manual-dispatch opt-in.
        self.assertIn('INPUT_STOCKANALYSIS_ETFS="false"', run_step)
        self.assertNotIn("YF_WEEKLY_ETF_STOCKANALYSIS_ETFS", run_step)
        self.assertIn('INPUT_CORE_DAILY_BASKET="true"', run_step)
        self.assertNotIn("YF_WEEKLY_ETF_CORE_DAILY_BASKET", run_step)
        self.assertIn("--core-daily-basket", run_step)
        self.assertIn("INPUT_CORE_DAILY_BASKET: 'false'", run_step)
        self.assertIn("if args.core_daily_basket", fetcher_source)
        self.assertIn(
            "load_universe_sources(stocks_only=False, stockanalysis_etfs=True)",
            fetcher_source,
        )

    def test_weekly_budget_reserves_retry_and_regular_capacity(self) -> None:
        retries = [f"RETRY{i:04d}" for i in range(200)]
        regular = [f"ETF{i:04d}" for i in range(200)]
        selected = self.fetcher.select_ticker_plan(
            [*retries, *regular],
            retries,
            natural=True,
            retry_limit=40,
        )[:140]
        self.assertEqual(selected[:40], retries[:40])
        self.assertEqual(len([ticker for ticker in selected if ticker in regular]), 100)
        self.assertEqual(len(selected), 140)

    def test_retry_queue_is_oldest_attempt_first(self) -> None:
        store = self.fetcher.YahooBatchStateStore(
            self.root / "admin" / "yahoo-batch-quote-history",
            self.fetcher.OUT_DIR,
        )
        for ticker, observed_at in [
            ("NEWEST", "2026-07-18T00:00:00Z"),
            ("OLDEST", "2026-07-16T00:00:00Z"),
            ("MIDDLE", "2026-07-17T00:00:00Z"),
        ]:
            write_json(store._state_path(ticker), {
                "schema_version": "yahoo-batch-quote-history-state/v1",
                "ticker": ticker,
                "retry": True,
                "last_attempt": {"observed_at": observed_at},
                "attempts": [],
            })
        self.assertEqual(
            store.retry_tickers_ordered({"NEWEST", "OLDEST", "MIDDLE"}),
            ["OLDEST", "MIDDLE", "NEWEST"],
        )

    def test_scheduled_campaign_selects_only_untracked_regular_candidates(self) -> None:
        store = self.fetcher.YahooBatchStateStore(
            self.root / "admin" / "yahoo-batch-quote-history",
            self.fetcher.OUT_DIR,
        )
        write_json(store._state_path("TRACKED"), {
            "schema_version": "yahoo-batch-quote-history-state/v1",
            "ticker": "TRACKED",
            "resolution_state": "fresh_primary",
            "retry": False,
            "attempts": [],
        })
        filter_candidates = getattr(
            self.fetcher,
            "filter_untracked_candidates",
            lambda tickers, _store, _active: list(tickers),
        )

        self.assertEqual(
            filter_candidates(["TRACKED", "UNTRACKED"], store, {"TRACKED", "UNTRACKED"}),
            ["UNTRACKED"],
            "scheduled Yahoo campaign must exclude state-tracked regular candidates",
        )

    def test_active_universe_pending_acquisition_is_honest_and_keeps_first_seen_provenance(self) -> None:
        store = self.fetcher.YahooBatchStateStore(
            self.root / "admin" / "yahoo-batch-quote-history",
            self.fetcher.OUT_DIR,
        )
        first = {**self._run("first-discovery"), "observed_at": "2026-08-01T01:00:00Z"}
        store.reconcile_active_universe({"PENDING"}, {"PENDING": ["stockanalysis_etf"]}, first)
        second = {**self._run("second-discovery"), "observed_at": "2026-08-02T01:00:00Z"}
        store.reconcile_active_universe({"PENDING"}, {"PENDING": ["dashboard_configuration"]}, second)

        inventory = json.loads(store.active_universe_path.read_text(encoding="utf-8"))
        pending = inventory["items"]["PENDING"]
        self.assertEqual(pending["resolution_state"], "pending_acquisition")
        self.assertFalse(pending["coverage"])
        self.assertEqual(pending["coverage_status"], "not_observed")
        self.assertEqual(pending["provider_reachability"], "not_attempted")
        self.assertEqual(pending["first_seen_at"], first["observed_at"])
        self.assertEqual(pending["first_seen_run_id"], "first-discovery")
        self.assertEqual(pending["first_seen_from"], ["stockanalysis_etf"])
        self.assertEqual(pending["discovered_from"], ["dashboard_configuration", "stockanalysis_etf"])
        index = store.rebuild_index({"PENDING"}, second)
        self.assertEqual(index["counts"]["pending_acquisition"], 1)
        self.assertEqual(index["counts"]["untracked"], 0)
        self.assertEqual(index["counts"]["fresh"], 0)
        self.assertEqual(index["counts"]["lkg"], 0)

    def test_observed_and_terminal_state_win_over_stale_pending_inventory(self) -> None:
        store = self.fetcher.YahooBatchStateStore(
            self.root / "admin" / "yahoo-batch-quote-history",
            self.fetcher.OUT_DIR,
        )
        run = self._run("precedence")
        write_json(store.active_universe_path, {
            "schema_version": "yahoo-batch-active-universe/v1",
            "generated_at": run["observed_at"],
            "items": {
                ticker: {
                    "resolution_state": "pending_acquisition",
                    "coverage": False,
                    "coverage_status": "not_observed",
                    "provider_reachability": "not_attempted",
                    "discovered_from": ["stockanalysis_etf"],
                    "first_seen_at": run["observed_at"],
                    "first_seen_run_id": run["run_id"],
                    "last_seen_at": run["observed_at"],
                    "last_seen_run_id": run["run_id"],
                }
                for ticker in ("FRESH", "BLD", "PENDING")
            },
        })
        write_json(store._state_path("FRESH"), {
            "schema_version": "yahoo-batch-quote-history-state/v1", "ticker": "FRESH",
            "resolution_state": "fresh_primary", "retry": False, "attempts": [],
        })
        write_json(store._state_path("BLD"), {
            "schema_version": "yahoo-batch-quote-history-state/v1", "ticker": "BLD",
            "resolution_state": "terminal_provider_unsupported", "retry": False, "attempts": [],
        })

        index = store.rebuild_index({"FRESH", "BLD", "PENDING"}, run)
        self.assertEqual(index["counts"]["fresh"], 1)
        self.assertEqual(index["counts"]["terminal"], 1)
        self.assertEqual(index["counts"]["pending_acquisition"], 1)
        self.assertEqual(index["counts"]["untracked"], 0)
        self.assertEqual(store.pending_acquisition_tickers({"FRESH", "BLD", "PENDING"}), {"PENDING"})

    def test_terminal_artifact_excludes_bld_day_holx_but_retains_mmc_alias_retry(self) -> None:
        store = self.fetcher.YahooBatchStateStore(
            self.root / "admin" / "yahoo-batch-quote-history",
            self.fetcher.OUT_DIR,
        )
        run = self._run("terminal-transition")
        for ticker in ("BLD", "DAY", "HOLX", "MMC"):
            write_json(store._state_path(ticker), {
                "schema_version": "yahoo-batch-quote-history-state/v1", "ticker": ticker,
                "resolution_state": "unavailable", "retry": True,
                "last_attempt": {"observed_at": "2026-07-30T00:00:00Z"}, "attempts": [],
            })
        artifact = self.root / "terminal-evidence.json"
        write_json(artifact, {
            "schema_version": "fenok-s1-stock-public-promotion-dry-run/v0.1",
            "generated_at": run["observed_at"], "dry_run": True,
            "blocked_rows": [
                {"ticker": ticker, "corporate_action_policy": {"evidence": [
                    {"symbol": ticker, "terminal": terminal, "alias_target": alias}
                ]}}
                for ticker, terminal, alias in (
                    ("BLD", True, None), ("DAY", True, None), ("HOLX", True, None), ("MMC", False, "MRSH"),
                )
            ],
        })
        evidence = store.load_terminal_evidence(artifact)
        store.transition_terminal_tickers({"BLD", "DAY", "HOLX", "MMC"}, evidence, run)

        self.assertEqual(store.retry_tickers_ordered({"BLD", "DAY", "HOLX", "MMC"}), ["MMC"])
        for ticker in ("BLD", "DAY", "HOLX"):
            state = json.loads(store._state_path(ticker).read_text(encoding="utf-8"))
            self.assertEqual(state["resolution_state"], "terminal_provider_unsupported")
            self.assertFalse(state["retry"])
            self.assertEqual(state["terminal"]["evidence_sha256"], evidence["artifact_sha256"])
        self.assertTrue(json.loads(store._state_path("MMC").read_text(encoding="utf-8"))["retry"])

        checked_in = store.load_terminal_evidence(self.fetcher.S1_STOCK_PROMOTION_DRY_RUN)
        self.assertTrue({"BLD", "DAY", "HOLX"}.issubset(checked_in["tickers"]))
        self.assertNotIn("MMC", checked_in["tickers"])

        write_json(artifact, {"schema_version": "bad", "blocked_rows": []})
        with self.assertRaisesRegex(ValueError, "terminal evidence"):
            store.load_terminal_evidence(artifact)

    def test_observed_state_is_written_before_pending_inventory_cleanup(self) -> None:
        store = self.fetcher.YahooBatchStateStore(
            self.root / "admin" / "yahoo-batch-quote-history",
            self.fetcher.OUT_DIR,
        )
        run = self._run("crash-safe")
        store.reconcile_active_universe({"AAPL"}, {"AAPL": ["stockanalysis_etf"]}, run)
        payload = self._daily_payload("AAPL")
        write_json(self.fetcher.OUT_DIR / "AAPL.json", payload)
        original_cleanup = store._remove_pending_after_state
        store._remove_pending_after_state = lambda _ticker: None
        try:
            store.record_success("AAPL", payload, run, ["stockanalysis_etf"], {"attempts_used": 1, "failures": [], "latency_ms": 1})
        finally:
            store._remove_pending_after_state = original_cleanup

        self.assertTrue(store._state_path("AAPL").exists())
        self.assertIn("AAPL", json.loads(store.active_universe_path.read_text())["items"])
        index = store.rebuild_index({"AAPL"}, run)
        self.assertEqual(index["counts"]["fresh"], 1)
        self.assertEqual(index["counts"]["pending_acquisition"], 0)
        store.reconcile_active_universe({"AAPL"}, {"AAPL": ["stockanalysis_etf"]}, run)
        self.assertNotIn("AAPL", json.loads(store.active_universe_path.read_text())["items"])

    def test_untracked_campaign_bootstraps_usable_local_payloads_before_selection(self) -> None:
        self.assertEqual(
            self.fetcher.bootstrap_exclusions(["LOCAL", "MISSING"], untracked_only=True),
            set(),
        )
        self.assertEqual(
            self.fetcher.bootstrap_exclusions(["LOCAL", "MISSING"], untracked_only=False),
            {"LOCAL", "MISSING"},
        )

    def test_controlled_failure_scope_is_manual_targeted_and_stateful_only(self) -> None:
        self.fetcher.validate_controlled_failure_scope(
            {"AAPL"}, ["AAPL"], event_name="workflow_dispatch", record_batch_state=True,
        )
        for injected, selected, event_name, stateful, message in [
            ({"AAPL"}, ["AAPL"], "schedule", True, "workflow_dispatch"),
            ({"AAPL"}, ["MSFT"], "workflow_dispatch", True, "explicit --tickers"),
            ({"AAPL"}, ["AAPL"], "workflow_dispatch", False, "batch state"),
        ]:
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                self.fetcher.validate_controlled_failure_scope(
                    injected, selected, event_name=event_name, record_batch_state=stateful,
                )

    def test_ticker_retry_and_cache_guards_are_bounded(self) -> None:
        self.assertEqual(self.fetcher.validate_explicit_tickers(["aapl", "005930.ks"]), ["AAPL", "005930.KS"])
        for ticker in ("../AAPL", "AAPL/../../x", "bad symbol"):
            with self.subTest(ticker=ticker), self.assertRaisesRegex(ValueError, "invalid explicit ticker"):
                self.fetcher.validate_explicit_tickers([ticker])
        self.assertEqual(self.fetcher.validate_retry_count(5), 5)
        with self.assertRaisesRegex(ValueError, "between 0 and 5"):
            self.fetcher.validate_retry_count(100)
        payload = {"fetched_at": self.fetcher._observed_now(), "data": {"history_1y": [{"date": "2026-07-10"}]}}
        self.assertTrue(self.fetcher.should_skip_cached_payload("AAPL", payload, 24, set(), set()))
        self.assertFalse(self.fetcher.should_skip_cached_payload("AAPL", payload, 24, {"AAPL"}, set()))
        self.assertFalse(self.fetcher.should_skip_cached_payload("AAPL", payload, 24, set(), {"AAPL"}))

    def test_current_attempt_isolated_by_run_attempt_and_skip_costs_zero_fetches(self) -> None:
        state_root = self.root / "admin" / "yahoo-batch-quote-history"
        store = self.fetcher.YahooBatchStateStore(state_root, self.fetcher.OUT_DIR)
        payload = self.fetcher.decorate_finance_payload(
            ticker="AAPL", profile="daily", fetched_at="2026-07-10T21:15:00Z",
            data={
                "info": {"symbol": "AAPL", "quoteType": "EQUITY", "regularMarketTime": 1783713600},
                "history_1y": [{"date": "2026-07-10", "Close": 314}],
            },
        )
        write_json(self.fetcher.OUT_DIR / "AAPL.json", payload)
        run_one = self._run("same-run", attempt=1)
        run_two = self._run("same-run", attempt=2)
        store.record_success("AAPL", payload, run_one, ["global_scouter"], {"attempts_used": 1, "failures": [], "latency_ms": 1})
        store.record_skip("AAPL", payload, run_two, ["global_scouter"])
        index = store.rebuild_index({"AAPL"}, run_two)
        self.assertEqual(index["current_attempt"]["attempted"], 1)
        self.assertEqual(index["current_attempt"]["skipped"], 1)
        self.assertEqual(index["current_attempt"]["fetch_attempts"], 0)

        legacy = {
            "schema_version": "yf-finance/v2", "ticker": "MSFT",
            "fetched_at": "2026-07-10T21:15:00Z", "profile": "daily",
            "data": {
                "info": {"symbol": "MSFT", "quoteType": "EQUITY", "regularMarketTime": 1783713600},
                "history_1y": [{"date": "2026-07-10", "Close": 500}],
            },
        }
        write_json(self.fetcher.OUT_DIR / "MSFT.json", legacy)
        self.assertEqual(store.bootstrap_existing({"AAPL", "MSFT"}, {"MSFT": ["market_facts"]}, run_two, {"AAPL"}), 1)
        msft = json.loads((state_root / "tickers" / "MSFT.json").read_text())
        self.assertEqual(msft["current"]["quote_as_of"], "2026-07-10T20:00:00Z")
        self.assertEqual(msft["current"]["source_as_of"], "2026-07-10")
        run_three = self._run("terminated-run", attempt=1)
        terminated = store.rebuild_index({"AAPL", "MSFT"}, run_three, batch_failure="batch terminated")
        self.assertEqual(terminated["current_attempt"]["attempted"], 1)
        self.assertEqual(terminated["current_attempt"]["failed"], 1)
        self.assertEqual(terminated["latest_failure"]["scope"], "batch")

    def test_bootstrap_reclassifies_source_stale_payload_as_exact_lkg_before_selection(self) -> None:
        state_root = self.root / "admin" / "yahoo-batch-quote-history"
        store = self.fetcher.YahooBatchStateStore(state_root, self.fetcher.OUT_DIR)
        payload = self.fetcher.decorate_finance_payload(
            ticker="GOOGL", profile="daily", fetched_at="2026-07-11T21:15:00Z",
            data={
                "info": {"symbol": "GOOGL", "quoteType": "EQUITY", "regularMarketTime": 1783713600},
                "history_1y": [{"date": "2026-06-26", "Close": 180}],
            },
        )
        canonical = self.fetcher.OUT_DIR / "GOOGL.json"
        write_json(canonical, payload)
        canonical_bytes = canonical.read_bytes()
        canonical_hash = hashlib.sha256(canonical_bytes).hexdigest()

        # Reproduce the existing lie first: history existence alone produced fresh_primary.
        store.record_skip("GOOGL", payload, self._run("seed-lie"), ["global_scouter_stock"])
        before = json.loads((state_root / "tickers" / "GOOGL.json").read_text())
        self.assertEqual(before["resolution_state"], "fresh_primary")

        changed = store.bootstrap_existing(
            {"GOOGL"},
            {"GOOGL": ["global_scouter_stock"]},
            self._run("classification"),
            exclude_tickers={"GOOGL"},
            source_age_business_days={"GOOGL": 7},
            max_source_business_days=6,
        )
        self.assertEqual(changed, 1, "selected/excluded existing state must still be reconciled")
        state = json.loads((state_root / "tickers" / "GOOGL.json").read_text())
        lkg = state_root / "lkg" / "GOOGL.json"
        self.assertEqual(state["resolution_state"], "lkg_primary")
        self.assertTrue(state["retry"])
        self.assertEqual(state["stale"]["reason"], "source_age_exceeds_lane_bound")
        self.assertEqual(state["stale"]["source_as_of"], "2026-06-26")
        self.assertEqual(state["stale"]["age_business_days"], 7)
        self.assertEqual(state["stale"]["max_business_days"], 6)
        self.assertNotIn("latest_failure", state, "source staleness is not a fabricated fetch failure")
        self.assertEqual(state["lkg"]["payload_sha256"], canonical_hash)
        self.assertEqual(lkg.read_bytes(), canonical_bytes)
        self.assertEqual(store.retry_tickers({"GOOGL"}), {"GOOGL"})
        self.assertFalse(store.recovery_candidate_advances("GOOGL", payload))

        index = store.rebuild_index({"GOOGL"}, self._run("classification"))
        self.assertEqual(index["counts"]["stale"], 1)
        self.assertEqual(index["counts"]["failed"], 0)
        self.assertEqual(index["stale_groups"][0]["symbols"], ["GOOGL"])

    def test_yahoo_source_business_day_age_uses_canonical_market_calendars(self) -> None:
        ages = self.fetcher.yahoo_source_business_day_ages(
            {"AAPL": "2026-07-02", "005930.KS": "2026-07-02"},
            "2026-07-13T04:15:19Z",
        )
        self.assertEqual(ages["AAPL"], 6, "US July 3 market holiday is excluded")
        self.assertEqual(ages["005930.KS"], 7, "KRX was open on US July 3 holiday")

        source = FETCH_PATH.read_text(encoding="utf-8")
        self.assertLess(
            source.index("state_store.bootstrap_existing("),
            source.index("retry_queue = ("),
            "stale classification must enter the retry set before natural-run selection",
        )

    def _run(self, run_id: str, attempt: int = 1) -> dict:
        return {
            "run_id": run_id,
            "run_attempt": attempt,
            "event_name": "schedule",
            "schedule": "20 23 * * 1-5",
            "natural": True,
            "shard": "0/5",
            "observed_at": "2026-07-11T22:00:00Z",
        }

    def test_merge_existing_payload_data_preserves_heavy_fields(self) -> None:
        existing = {
            "data": {
                "info": {"currentPrice": 10, "trailingPE": 20, "sector": "Technology"},
                "income_statement": {"2025-12-31": {"Total Revenue": 100}},
                "history_1y": [{"date": "2026-01-01", "Close": 10}],
            }
        }
        fetched = {
            "info": {"currentPrice": 11, "previousClose": 10.5},
            "fast_info": {"last_price": 11},
            "income_statement": None,
            "history_1y": [{"date": "2026-01-02", "Close": 11}],
        }

        merged = self.fetcher.merge_existing_payload_data(existing, fetched)

        self.assertEqual(merged["info"]["currentPrice"], 11)
        self.assertEqual(merged["info"]["trailingPE"], 20)
        self.assertEqual(merged["info"]["previousClose"], 10.5)
        self.assertEqual(merged["income_statement"], {"2025-12-31": {"Total Revenue": 100}})
        self.assertEqual(merged["fast_info"], {"last_price": 11})
        self.assertEqual(merged["history_1y"], [{"date": "2026-01-02", "Close": 11}])
        preserved = self.fetcher.preserve_history_coverage(existing, fetched)
        self.assertEqual(
            [row["date"] for row in preserved["history_1y"]],
            ["2026-01-01", "2026-01-02"],
        )

    def test_plan_only_prints_resolved_plan_without_fetching_or_writing_summary(self) -> None:
        write_json(self.fetcher.STOCKANALYSIS_ETF_UNIVERSE, {"records": [{"ticker": "SMALL", "aum": "1M"}]})
        write_json(self.fetcher.STOCKANALYSIS_ETF_SCREENER, {"records": [{"s": "BIG", "aum": "10B"}]})
        write_json(self.fetcher.ETF_INDEX, {"etfs": {}})
        self.fetcher.DASHBOARD_CONSTANTS.parent.mkdir(parents=True)
        self.fetcher.DASHBOARD_CONSTANTS.write_text("", encoding="utf-8")
        self.fetcher.PORTFOLIO_TS.write_text("", encoding="utf-8")

        calls = []
        self.fetcher.fetch_with_retry = lambda *args, **kwargs: calls.append((args, kwargs))
        original_argv = sys.argv
        original_stdout = sys.stdout
        buffer = io.StringIO()
        try:
            sys.argv = [
                "fetch-yf-finance.py",
                "--stockanalysis-etfs",
                "--history-gaps-only",
                "--limit",
                "1",
                "--plan-only",
                "--plan-sample-size",
                "1",
            ]
            sys.stdout = buffer
            self.fetcher.main()
        finally:
            sys.argv = original_argv
            sys.stdout = original_stdout

        payload = json.loads(buffer.getvalue())
        self.assertEqual(calls, [])
        self.assertFalse((self.fetcher.OUT_DIR / "_summary.json").exists())
        self.assertEqual(payload["mode"], "plan_only")
        self.assertEqual(payload["sample"], ["BIG"])
        self.assertEqual(payload["count"], 1)
        self.assertTrue(payload["history_gaps_only"])
        self.assertEqual(payload["priority"], "stockanalysis_etf_aum")

    def test_stateful_plan_only_prospectively_selects_pending_without_writing_inventory(self) -> None:
        self.fetcher.load_universe_sources = lambda **_kwargs: {"PENDING": ["stockanalysis_etf"]}
        before = list(self.fetcher.YAHOO_BATCH_STATE_ROOT.rglob("*")) if self.fetcher.YAHOO_BATCH_STATE_ROOT.exists() else []
        original_argv, original_stdout = sys.argv, sys.stdout
        buffer = io.StringIO()
        try:
            sys.argv = [
                "fetch-yf-finance.py", "--tickers", "PENDING", "--record-batch-state",
                "--natural-run", "--untracked-only", "--untracked-limit", "1",
                "--regular-limit", "1", "--plan-only", "--plan-sample-size", "1",
            ]
            sys.stdout = buffer
            self.fetcher.main()
        finally:
            sys.argv, sys.stdout = original_argv, original_stdout

        self.assertEqual(json.loads(buffer.getvalue())["sample"], ["PENDING"])
        self.assertFalse(self.fetcher.YAHOO_BATCH_STATE_ROOT.exists())
        self.assertEqual(before, [])

    def test_enrolled_yahoo_write_records_exact_manual_object(self) -> None:
        self.fetcher.DATA_SUPPLY_STATE_ROOT = self.root / "state"
        payload = {
            "schema_version": "yf-finance/v2", "ticker": "AAPL",
            "fetched_at": "2026-07-10T10:00:00Z", "profile": "full",
            "data": {"info": {"symbol": "AAPL", "quoteType": "EQUITY", "currentPrice": 10, "previousClose": 9}, "history_1y": [{"date": "2026-07-10", "Close": 10}]},
        }
        row = self.fetcher.write_finance_payload("AAPL", payload)
        truth = self.fetcher.OUT_DIR / "AAPL.json"
        pending = self.root / "state" / "providers" / "yahoo_finance" / "stock_detail" / "pending" / "AAPL.json"
        pointer = json.loads(pending.read_text())
        self.assertEqual((self.root / "state" / pointer["path"]).read_bytes(), truth.read_bytes())
        self.assertEqual(row["observation_origin"], "rebuild")
        self.assertEqual(row["collection_origin"], "manual")

    def test_yahoo_only_write_keeps_canonical_ownership_without_enrollment(self) -> None:
        self.fetcher.DATA_SUPPLY_STATE_ROOT = self.root / "state"
        payload = {
            "schema_version": "yf-finance/v2", "ticker": "ZZZZ",
            "fetched_at": "2026-07-10T10:00:00Z", "profile": "full",
            "data": {"info": {"symbol": "ZZZZ", "quoteType": "EQUITY", "currentPrice": 5, "previousClose": 4}, "history_1y": [{"date": "2026-07-10", "Close": 5}]},
        }
        row = self.fetcher.write_finance_payload("ZZZZ", payload)
        self.assertIsNone(row)
        self.assertTrue((self.fetcher.OUT_DIR / "ZZZZ.json").exists())
        self.assertFalse((self.root / "state").exists())

    def test_enrolled_yahoo_invalid_preserves_truth_and_records_evidence_only(self) -> None:
        self.fetcher.DATA_SUPPLY_STATE_ROOT = self.root / "state"
        truth = self.fetcher.OUT_DIR / "AAPL.json"
        truth.parent.mkdir(parents=True)
        sentinel = b'{"sentinel":true}'
        truth.write_bytes(sentinel)
        payload = {
            "schema_version": "yf-finance/v2", "ticker": "AAPL",
            "fetched_at": "2026-07-10T10:00:00Z", "profile": "full",
            "data": {"info": {"symbol": "AAPL", "quoteType": "ETF", "currentPrice": 10, "previousClose": 9}, "history_1y": [{"date": "2026-07-10", "Close": 10}]},
        }
        with self.assertRaises(ValueError):
            self.fetcher.write_finance_payload("AAPL", payload)
        observation = json.loads(next((self.root / "state" / "history" / "observations").glob("*.jsonl")).read_text())
        self.assertEqual(truth.read_bytes(), sentinel)
        self.assertEqual(observation["validation_status"], "invalid")
        self.assertFalse((self.root / "state" / "providers").exists())

    def test_deferred_enrolled_validation_failure_has_no_side_effect_before_batch_proof(self) -> None:
        self.fetcher.DATA_SUPPLY_STATE_ROOT = self.root / "state"
        truth = self.fetcher.OUT_DIR / "AAPL.json"
        truth.parent.mkdir(parents=True)
        sentinel = b'{"sentinel":true}'
        truth.write_bytes(sentinel)
        invalid = {
            "schema_version": "yf-finance/v2", "ticker": "AAPL",
            "fetched_at": "2026-07-10T10:00:00Z", "profile": "full",
            "data": {
                "info": {"symbol": "AAPL", "quoteType": "ETF", "currentPrice": 10, "previousClose": 9},
                "history_1y": [{"date": "2026-07-10", "Close": 10}],
            },
        }
        with self.assertRaises(ValueError):
            self.fetcher.write_finance_payload("AAPL", invalid, record_stock_detail_state=False)
        self.assertEqual(truth.read_bytes(), sentinel)
        state_files = [
            path for path in (self.root / "state").rglob("*")
            if path.is_file() and not any(part.startswith(".") for part in path.relative_to(self.root / "state").parts)
        ]
        self.assertEqual(state_files, [], "deferred stock-detail validation cannot publish failure evidence before batch proof")

    def test_enrolled_merge_preserves_heavy_fields_but_never_fills_quote_from_old_payload(self) -> None:
        existing = {
            "data": {
                "info": {"symbol": "AAPL", "quoteType": "EQUITY", "currentPrice": 10, "previousClose": 9, "marketCap": 100},
                "income_statement": {"2025": {"Revenue": 50}},
            }
        }
        fresh = {"info": {"symbol": "AAPL", "quoteType": "EQUITY", "currentPrice": 11}}
        merged = self.fetcher.merge_existing_payload_data(existing, fresh)
        bound = self.fetcher.bind_enrolled_quote_group_to_fresh_fetch(merged, fresh)
        self.assertEqual(bound["info"]["marketCap"], 100)
        self.assertEqual(bound["income_statement"], {"2025": {"Revenue": 50}})
        self.assertEqual(bound["info"]["currentPrice"], 11)
        self.assertNotIn("previousClose", bound["info"])

    def test_validation_failure_isolated_to_ticker_and_batch_summary_continues(self) -> None:
        self.fetcher.DATA_SUPPLY_STATE_ROOT = self.root / "state"
        truth = self.fetcher.OUT_DIR / "AAPL.json"
        truth.parent.mkdir(parents=True)
        sentinel = b'{"sentinel":true}'
        truth.write_bytes(sentinel)

        def fake_fetch(ticker, **_kwargs):
            if ticker == "AAPL":
                return {
                    "info": {"symbol": ticker, "quoteType": "ETF", "currentPrice": 10, "previousClose": 9, "regularMarketTime": 1783713600},
                    "history_1y": [{"date": "2026-07-10", "Close": 10}],
                }, 1, None
            return {
                "info": {"symbol": ticker, "quoteType": "EQUITY", "currentPrice": 20, "previousClose": 19, "regularMarketTime": 1783713600},
                "history_1y": [{"date": "2026-07-10", "Close": 20}],
            }, 1, None

        self.fetcher.fetch_with_retry = fake_fetch
        original_argv, original_stdout = sys.argv, sys.stdout
        try:
            sys.argv = ["fetch-yf-finance.py", "--tickers", "AAPL,MSFT", "--sleep", "0", "--retries", "0"]
            sys.stdout = io.StringIO()
            with self.assertRaises(SystemExit) as raised:
                self.fetcher.main()
        finally:
            sys.argv, sys.stdout = original_argv, original_stdout
        self.assertEqual(raised.exception.code, 2)
        self.assertEqual(truth.read_bytes(), sentinel)
        self.assertTrue((self.fetcher.OUT_DIR / "MSFT.json").exists())
        self.assertTrue((self.fetcher.OUT_DIR / "_summary.json").exists())

    def test_failed_batch_attempt_persists_run_evidence_and_holds_canonical_hash(self) -> None:
        truth = self.fetcher.OUT_DIR / "AAPL.json"
        write_json(
            truth,
            {
                "schema_version": "yf-finance/v2",
                "ticker": "AAPL",
                "fetched_at": "2026-07-10T21:15:00Z",
                "profile": "daily",
                "data": {
                    "info": {"symbol": "AAPL", "quoteType": "EQUITY", "regularMarketTime": 1783713600},
                    "history_1y": [{"date": "2026-07-10", "Close": 10}],
                },
            },
        )
        before = hashlib.sha256(truth.read_bytes()).hexdigest()
        self.fetcher.fetch_with_retry = lambda *_args, **_kwargs: (
            None,
            0,
            "controlled AAPL failure",
            {"attempts_used": 2, "failures": [{"attempt": 1, "error": "injected"}], "latency_ms": 0},
        )

        original_argv, original_stdout = sys.argv, sys.stdout
        try:
            sys.argv = [
                "fetch-yf-finance.py", "--tickers", "AAPL", "--record-batch-state",
                "--run-id", "12345", "--run-attempt", "2", "--event-name", "workflow_dispatch",
                "--sleep", "0", "--retries", "1",
            ]
            sys.stdout = io.StringIO()
            with self.assertRaises(SystemExit) as raised:
                self.fetcher.main()
        finally:
            sys.argv, sys.stdout = original_argv, original_stdout

        self.assertEqual(raised.exception.code, 0)
        self.assertEqual(hashlib.sha256(truth.read_bytes()).hexdigest(), before)
        state = json.loads((self.fetcher.YAHOO_BATCH_STATE_ROOT / "tickers" / "AAPL.json").read_text())
        index = json.loads((self.fetcher.YAHOO_BATCH_STATE_ROOT / "index.json").read_text())
        self.assertEqual(state["resolution_state"], "lkg_primary")
        self.assertEqual(state["latest_failure"]["run_id"], "12345")
        self.assertEqual(state["latest_failure"]["run_attempt"], 2)
        self.assertEqual(index["current_attempt"]["attempted"], 1)
        self.assertEqual(index["current_attempt"]["failed"], 1)
        self.assertEqual(index["current_attempt"]["fetch_attempts"], 2)

    def test_fresh_enrolled_cache_skip_emits_no_observation(self) -> None:
        self.fetcher.DATA_SUPPLY_STATE_ROOT = self.root / "state"
        write_json(
            self.fetcher.OUT_DIR / "AAPL.json",
            {
                "schema_version": "yf-finance/v2",
                "ticker": "AAPL",
                "fetched_at": self.fetcher._observed_now(),
                "profile": "full",
                "data": {
                    "info": {"symbol": "AAPL", "quoteType": "EQUITY", "currentPrice": 10, "previousClose": 9},
                    "history_1y": [{"date": "2026-07-10", "Close": 10}],
                },
            },
        )
        self.fetcher.fetch_with_retry = lambda *_args, **_kwargs: self.fail("fresh cache should skip fetch")
        original_argv, original_stdout = sys.argv, sys.stdout
        try:
            sys.argv = ["fetch-yf-finance.py", "--tickers", "AAPL", "--max-age-hours", "24", "--sleep", "0"]
            sys.stdout = io.StringIO()
            self.fetcher.main()
        finally:
            sys.argv, sys.stdout = original_argv, original_stdout
        self.assertFalse((self.root / "state").exists())

    def test_local_universe_loader_import_does_not_require_yfinance(self) -> None:
        code = """
import builtins
import runpy
import sys

real_import = builtins.__import__
def guarded_import(name, *args, **kwargs):
    if name == "yfinance":
        raise ImportError("yfinance must stay collection-only")
    return real_import(name, *args, **kwargs)

builtins.__import__ = guarded_import
namespace = runpy.run_path(sys.argv[1])
assert callable(namespace["load_universe"])
"""
        subprocess.run([sys.executable, "-c", code, str(FETCH_PATH)], check=True)

    def test_workflow_persists_candidates_before_public_promotion(self) -> None:
        workflow = YF_WORKFLOW_PATH.read_text(encoding="utf-8")
        quarter_start = workflow.index("      - name: Refresh owned Yahoo quarter-close source")
        candidate_start = workflow.index("      - name: Persist fetched Yahoo source data")
        failure_dispatch_start = workflow.index("      - name: Publish failed Yahoo attempt evidence")
        shared_dispatch_start = workflow.index("      - name: Dispatch shared projection rebuild")
        candidate_step = workflow[candidate_start:failure_dispatch_start]
        failure_dispatch = workflow[failure_dispatch_start:shared_dispatch_start]
        shared_dispatch = workflow[shared_dispatch_start:]

        self.assertLess(quarter_start, candidate_start)
        self.assertLess(candidate_start, failure_dispatch_start)
        self.assertLess(failure_dispatch_start, shared_dispatch_start)
        self.assertIn("git add -- \\", candidate_step)
        self.assertIn("data/yf/finance", candidate_step)
        self.assertIn("data/admin/yahoo-batch-quote-history", candidate_step)
        self.assertIn("data/yf/quarter_closes.json", candidate_step)
        self.assertIn("git restore --staged --worktree -- data/yf/finance/_summary.json", candidate_step)
        self.assertIn("always()", candidate_step)
        # #377 slice 2: the lane persists canonical candidates only; the public
        # mirror is owned by the merge boundary, so no public path may be
        # staged from this lane (03365d7c44 removed the last one).
        self.assertNotIn("100xfenok-next/public", candidate_step)

        run_step = workflow[workflow.index("      - name: Run batch fetch"):quarter_start]
        self.assertIn("id: fetch_batch", run_step)
        self.assertIn("--record-batch-state", run_step)
        self.assertIn("--run-id", run_step)
        self.assertIn("--natural-run", run_step)
        self.assertIn("--all-shards-run", run_step)
        # One scheduled ETF slot a day, Sunday-Friday at 00:07 UTC: six runs a
        # week on the six-shard cycle. The weekday is read from the clock and
        # maps directly to the shard index; the daily stock cron stays
        # untouched. Seven minutes past, not on the hour: GitHub warns
        # hour-start schedules may be delayed or dropped, and three
        # consecutive :00 slots did not fire.
        self.assertIn("- cron: '20 23 * * 1-5'", workflow)
        self.assertIn("- cron: '7 0 * * 0-5'", workflow)
        for hour in range(2, 24, 2):
            self.assertNotIn(f"- cron: '7 {hour} * * 0-5'", workflow)
        self.assertNotIn("- cron: '0 0 * * 0-5'", workflow)
        self.assertNotIn("SLOT_HOUR=", run_step)
        self.assertNotIn("SLOT_WEEKDAY * 12", run_step)
        self.assertIn("DAILY_SHARDS=6", run_step)
        self.assertIn('DAILY_INDEX="$SLOT_WEEKDAY"', run_step)
        self.assertIn("date -u +%w", run_step)
        # The weekday field must carry the real weekday and the slot must be
        # coherent with the shard, or the runtime validator rejects the run.
        self.assertIn('INPUT_SCHEDULED_WEEKDAY="$SLOT_WEEKDAY"', run_step)
        self.assertIn('INPUT_SCHEDULED_SLOT="$DAILY_INDEX"', run_step)
        self.assertIn("--scheduled-slot", run_step)
        # workflow_dispatch is hard-capped at 25 inputs. Exceeding it makes
        # GitHub reject the whole file, which took the lane down after
        # e0c95a68f6, so the count is asserted rather than trusted.
        dispatch_inputs = workflow.split("  workflow_dispatch:")[1].split("\npermissions:")[0]
        declared = [
            line for line in dispatch_inputs.split("\n")
            if line.startswith("      ") and line.rstrip().endswith(":") and not line.startswith("       ")
        ]
        self.assertLessEqual(len(declared), 25, f"workflow_dispatch declares {len(declared)} inputs; the limit is 25")
        # A manual run of a multi-slot shard must still resolve its slot.
        self.assertIn('SHARD_COUNT="${INPUT_SHARD#*/}"', run_step)
        self.assertIn("--scheduled-weekday", run_step)
        self.assertIn('INPUT_RETRY_LIMIT="${YF_DAILY_STOCK_RETRY_LIMIT:-40}"', run_step)
        self.assertIn("YF_WEEKLY_ETF_RETRY_LIMIT:-40", run_step)
        # The regular cap must clear the largest 6-way shard, or that shard's
        # tail is never collected.
        self.assertIn("YF_WEEKLY_ETF_REGULAR_LIMIT:-140", run_step)
        self.assertIn("YF_WEEKLY_ETF_LIMIT:-200", run_step)
        self.assertIn("YF_WEEKLY_ETF_UNTRACKED_LIMIT:-80", run_step)
        # The ETF slot is a refresh pass. Either narrowing flag turns it back
        # into an acquisition-and-backfill pass that never revisits a tracked
        # ticker with complete history.
        self.assertIn('INPUT_UNTRACKED_ONLY="${YF_WEEKLY_ETF_UNTRACKED_ONLY:-false}"', run_step)
        self.assertIn('INPUT_HISTORY_GAPS_ONLY="${YF_WEEKLY_ETF_HISTORY_GAPS_ONLY:-false}"', run_step)
        # Quarter-close owns a universe of its own and belongs to the stock
        # lane; running it after an ETF slot is what produced the 429 storm.
        self.assertIn("YF_LANE=", run_step)
        self.assertIn("env.YF_LANE != 'etf'", workflow)
        self.assertIn("--retry-limit", run_step)
        self.assertIn("--regular-limit", run_step)
        self.assertIn("--untracked-limit", run_step)
        self.assertIn("--untracked-only", run_step)
        self.assertIn("--shard-cycle-index", run_step)
        self.assertIn("--stable-shards", run_step)
        self.assertNotIn("GITHUB_RUN_NUMBER", run_step)
        self.assertIn("controlled_failure_tickers", workflow)
        self.assertIn("--controlled-failure-tickers", run_step)
        self.assertIn("steps.fetch_batch.outcome == 'failure'", failure_dispatch)
        self.assertIn("steps.quarter_closes.outcome == 'failure'", failure_dispatch)
        self.assertIn("steps.persist_yahoo_state.outcome == 'success'", failure_dispatch)
        self.assertIn("steps.persist_yahoo_state.outputs.persisted == 'true'", failure_dispatch)
        self.assertIn('persisted=true', candidate_step)
        self.assertIn("gh workflow run update-manifest.yml --ref main", failure_dispatch)
        self.assertIn("gh workflow run update-manifest.yml --ref main", shared_dispatch)
        self.assertNotIn("build-market-facts.py", workflow)
        self.assertNotIn("build-rim-index.mjs", workflow)
        self.assertNotIn("data/manifest.json", workflow)
        self.assertNotIn("100xfenok-next/public", run_step)
        self.assertIn("python3 scripts/build-quarter-closes.py", workflow[quarter_start:candidate_start])

        manifest_workflow = MANIFEST_WORKFLOW_PATH.read_text(encoding="utf-8")
        manifest_runner = MANIFEST_RUNNER_PATH.read_text(encoding="utf-8")
        self.assertIn("      - '!data/yf/**'", manifest_workflow)
        self.assertIn("      - '!data/admin/yahoo-batch-quote-history/**'", manifest_workflow)
        self.assertIn("run: bash scripts/update-manifest-projections.sh", manifest_workflow)
        self.assertIn("python3 scripts/rebuild-yf-finance-summary.py", manifest_runner)
        self.assertIn("python3 scripts/build-market-facts.py --no-public-mirror", manifest_runner)
        for command in (
            "node scripts/build-rim-index.mjs",
            "node scripts/build-rim-index-five-canonical.mjs",
            "node scripts/check-rim-index-five-canonical.mjs",
        ):
            self.assertNotIn(command, manifest_workflow)
        self.assertNotIn("python3 scripts/build-quarter-closes.py", manifest_workflow)

    def test_ticker_names_containing_key_are_not_dropped_as_secret_files(self) -> None:
        for ticker in ("KEYG", "KEYX"):
            for state_dir in ("tickers", "lkg"):
                candidate = ROOT / "data" / "admin" / "yahoo-batch-quote-history" / state_dir / f"{ticker}.json"
                ignored = subprocess.run(
                    ["git", "check-ignore", "--quiet", "--no-index", str(candidate)],
                    cwd=ROOT,
                    check=False,
                )
                self.assertNotEqual(ignored.returncode, 0, f"{candidate} must remain persistable")


if __name__ == "__main__":
    unittest.main()
