#!/usr/bin/env python3
"""Deterministic LKG/recovery contracts for StockAnalysis producer artifacts."""

from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SCRIPT_DIR = ROOT / "scripts"
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from stockanalysis_recovery_state import (  # noqa: E402
    StockAnalysisRecoveryStateError,
    StockAnalysisRecoveryStateStore,
    archived_etf_history,
    etf_detail_regression,
    payload_source_fields,
    validate_etf_history_archive,
)


def write_json(path: Path, payload: dict) -> bytes:
    payload_bytes = (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload_bytes)
    return payload_bytes


def stock_payload(ticker: str, source_as_of: str) -> dict:
    return {
        "schema_version": "stockanalysis/v1",
        "source": "stockanalysis",
        "asset_type": "stock",
        "ticker": ticker,
        "source_as_of": source_as_of,
        "fetched_at": f"{source_as_of[:10]}T23:00:00Z",
        "normalized": {
            "overview": {"marketCap": 1},
            "quote": {"symbol": ticker, "uid": ticker, "p": 10, "cl": 9},
            "history": [{"t": source_as_of[:10], "c": 10}],
        },
    }


def financial_payload(ticker: str, period_as_of: str) -> dict:
    statement = {
        "ticker": ticker,
        "statement": "financials",
        "period": "annual",
        "periods": [period_as_of, "2025-12-31"],
        "rows": [{"field": "revenue", "values": [2, 1]}],
    }
    return {
        "schema_version": "stockanalysis/v1",
        "source": "stockanalysis",
        "asset_type": "stock",
        "ticker": ticker,
        "fetched_at": f"{period_as_of}T23:00:00Z",
        "statements": {"annual": {"income": statement}},
        "summary": {"annual": {"income": {"period_count": 2}}},
    }


def etf_payload(ticker: str, source_as_of: str | None) -> dict:
    return {
        "schema_version": "stockanalysis/v1",
        "source": "stockanalysis",
        "asset_type": "etf",
        "ticker": ticker,
        "source_as_of": source_as_of,
        "fetched_at": "2026-07-15T23:00:00Z",
        "normalized": {"overview": {"aum": 1}},
    }


def surface_payload(name: str, fetched_at: str, row: str, provider_date: str = "2026-07-14") -> dict:
    return {
        "schema_version": "stockanalysis/v1",
        "source": "stockanalysis",
        "surface": name,
        "group": "events",
        "priority": "high",
        "role": "fixture",
        "source_as_of": None,
        "source_as_of_reason": "provider publishes no aggregate source date",
        "fetched_at": fetched_at,
        "endpoint": f"/{name}",
        "url": f"https://stockanalysis.com/{name}",
        "format": "svelte_devalue",
        "counts": {"records": 1},
        "records": [{"symbol": row, "date": provider_date}],
        "metadata": {},
    }


def universe_payload(fetched_at: str, *tickers: str) -> dict:
    records = [
        {"ticker": ticker, "name": f"{ticker} ETF", "source_page": 1}
        for ticker in sorted(tickers)
    ]
    return {
        "schema_version": "stockanalysis/v1",
        "source": "stockanalysis",
        "asset_type": "etf",
        "generated_at": fetched_at,
        "source_as_of": None,
        "source_as_of_reason": "provider publishes no aggregate source date",
        "fetched_at": fetched_at,
        "endpoint": "/etf/",
        "counts": {"records": len(records), "pages": 1},
        "warnings": [],
        "pages": [{"page": 1, "path": "/etf/", "record_count": len(records)}],
        "records": records,
    }


class StockAnalysisRecoveryStateTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.data_root = self.root / "data" / "stockanalysis"
        self.state_root = self.root / "data" / "admin" / "stockanalysis-recovery"
        self.store = StockAnalysisRecoveryStateStore(self.state_root, self.root)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    @staticmethod
    def run_context(run_id: str, *, attempt: int = 1) -> dict:
        return {
            "run_id": run_id,
            "run_attempt": attempt,
            "event_name": "workflow_dispatch",
            "schedule": "",
            "natural": False,
            "observed_at": "2026-07-15T08:00:00Z",
        }

    def test_official_etf_same_aggregate_rejects_component_regression(self):
        from datetime import datetime, timezone
        def detail(day: str) -> dict:
            epoch = int(datetime.fromisoformat(f"{day}T20:00:00+00:00").timestamp())
            rows = [{"t": day, "c": 25.6}]
            return {
                "schema_version": "stockanalysis/v1", "source": "stockanalysis",
                "asset_type": "etf", "ticker": "IBIC", "source_as_of": "2026-10-01T00:00:00Z",
                "fetched_at": "2026-10-05T02:14:14Z",
                "endpoints": {"quote": "/api/quotes/e/IBIC", "history_periods": {"daily_1y": "/history"}},
                "raw": {"official_holdings": {"source_as_of": "2026-10-01"},
                        "quote": {"td": day, "ts": epoch}, "history_periods": {"daily_1y": rows}},
                "normalized": {"overview": {}, "holdings": [{"symbol": "TIP", "weight_pct": 100}],
                               "history_periods": {"daily_1y": rows}},
            }
        prior = detail("2026-10-02")
        path = self.store.canonical_path("etf", "IBIC")
        original = write_json(path, prior)
        write_json(self.state_root / "states/etf/IBIC.json", {
            "current": {"path": "data/stockanalysis/etfs/IBIC.json",
                        "payload_sha256": hashlib.sha256(original).hexdigest(),
                        "source_as_of": prior["source_as_of"]},
            "retry": False,
        })
        self.assertTrue(self.store.recovery_candidate_advances("etf", "IBIC", detail("2026-10-02")))
        self.assertFalse(self.store.recovery_candidate_advances("etf", "IBIC", detail("2026-10-01")))
        prior["raw"].pop("history_periods")
        prior["normalized"].pop("history_periods")
        missing_bytes = write_json(path, prior)
        write_json(self.state_root / "states/etf/IBIC.json", {
            "current": {"path": "data/stockanalysis/etfs/IBIC.json",
                        "payload_sha256": hashlib.sha256(missing_bytes).hexdigest(),
                        "source_as_of": prior["source_as_of"]}, "retry": False})
        self.assertFalse(self.store.recovery_candidate_advances("etf", "IBIC", detail("2026-10-02")))

    def test_complete_native_portfolio_can_shrink_after_its_holdings_date_advances(self):
        def portfolio(count, day):
            rows = [{"n": f"Position {index}", "as": f"{100 / count:.2f}%"} for index in range(count)]
            return {
                "schema_version": "stockanalysis/v1", "source": "stockanalysis", "asset_type": "etf",
                "ticker": "SDCI", "source_as_of": "2026-10-05T20:00:00Z",
                "fetched_at": "2026-10-06T07:50:10Z",
                "raw": {"holdings": {"count": count, "date": day, "holdings": rows}},
                "normalized": {"overview": {}, "holding_count": count, "holdings_updated": day,
                               "holdings": [{"name": row["n"], "raw": row} for row in rows]},
            }

        old = portfolio(22, "Sep 25, 2026")
        new = portfolio(21, "Oct 2, 2026")
        self.assertIsNone(etf_detail_regression(new, old))
        for label, side, edit in (
            ("truncated-raw-total", "new", lambda p: p["raw"]["holdings"].update(count=22)),
            ("truncated-normalized-total", "new", lambda p: p["normalized"].update(holding_count=22)),
            ("missing-raw-count", "new", lambda p: p["raw"]["holdings"].pop("count")),
            ("boolean-count", "new", lambda p: p["raw"]["holdings"].update(count=True)),
            ("raw-row-loss", "new", lambda p: p["raw"]["holdings"]["holdings"].pop()),
            ("unbound-normalized-row", "new", lambda p: p["normalized"]["holdings"][0].update(raw={})),
            ("wrong-normalized-identity", "new", lambda p: p["normalized"]["holdings"][0].update(name="Other")),
            ("missing-normalized-identity", "new", lambda p: p["normalized"]["holdings"][0].pop("name")),
            ("wrong-ticker", "new", lambda p: p.update(ticker="OTHER")),
            ("other-provider", "new", lambda p: p.update(source="yf_fallback", source_provider="yahoo_finance")),
            ("unbound-date", "new", lambda p: p["normalized"].update(holdings_updated="Oct 1, 2026")),
            ("same-date", "new", lambda p: (p["raw"]["holdings"].update(date="Sep 25, 2026"),
                                             p["normalized"].update(holdings_updated="Sep 25, 2026"))),
            ("regressed-date", "new", lambda p: (p["raw"]["holdings"].update(date="Sep 24, 2026"),
                                                  p["normalized"].update(holdings_updated="Sep 24, 2026"))),
            ("future-holdings", "new", lambda p: p.update(fetched_at="2026-10-01T20:00:00Z")),
            ("old-sample-is-not-whole-fund", "old", lambda p: (p["raw"]["holdings"].update(count=63),
                                                              p["normalized"].update(holding_count=63))),
        ):
            with self.subTest(label=label):
                before, after = json.loads(json.dumps(old)), json.loads(json.dumps(new))
                edit(before if side == "old" else after)
                self.assertEqual(etf_detail_regression(after, before), "holdings")
        yahoo = portfolio(1, "Oct 2, 2026")
        yahoo.update(source="yf_fallback", source_provider="yahoo_finance", schema_version="yf-etf-detail/v1")
        self.assertEqual(etf_detail_regression(yahoo, old), "holdings")
        old["normalized"]["countries"] = [{"name": "United States", "weight": 100}]
        self.assertEqual(etf_detail_regression(new, old), "countries")

    def test_archived_yahoo_daily_series_requires_exact_embedded_bytes(self):
        from datetime import datetime
        raw_rows = [{"t": "2025-10-02", "c": 25.69}, {"t": "2026-10-02", "c": 25.64}]
        yahoo_rows = [{"date": "2025-09-26", "Close": 24.78},
                      {"date": "2026-10-02", "Close": 25.64}]
        source = {"schema_version": "yf-etf-detail/v1", "ticker": "IBIC",
                  "source_provider": "yahoo_finance", "source_as_of": "2026-10-02T19:51:28Z",
                  "fetched_at": "2026-10-05T02:14:14Z", "raw": {"yf": {
                      "info": {"symbol": "IBIC", "quoteType": "ETF", "regularMarketTime": int(
                          datetime.fromisoformat("2026-10-02T19:51:28+00:00").timestamp())},
                      "history_1y": yahoo_rows}}}
        source_bytes = (json.dumps(source) + "\n").encode()
        digest = hashlib.sha256(source_bytes).hexdigest()
        payload = {"ticker": "IBIC", "raw": {"history_periods": {"daily_1y": raw_rows}},
                   "normalized": {"history_periods": {"daily_1y": raw_rows},
                                  "history_archive": [{"provider": "yahoo_finance", "price_basis": "yahoo_adjusted",
                                       "source_payload": source_bytes.decode(),
                                       "payload_sha256": digest, "source_as_of": source["source_as_of"],
                                       "fetched_at": source["fetched_at"], "history_first": "2025-09-26",
                                       "history_last": "2026-10-02"}]}}
        self.assertTrue(validate_etf_history_archive(payload))
        payload["normalized"]["history_periods"]["daily_1y"] = yahoo_rows
        self.assertFalse(validate_etf_history_archive(payload))
        payload["normalized"]["history_periods"]["daily_1y"] = raw_rows
        payload["normalized"]["history_archive"][0]["source_payload"] += " "
        self.assertFalse(validate_etf_history_archive(payload))

    def test_archive_keeps_ordinary_primary_native_history_and_survives_rolling_tail(self):
        from datetime import datetime
        spec = importlib.util.spec_from_file_location("stockanalysis_archive_fixture", SCRIPT_DIR / "fetch-stockanalysis.py")
        fetcher = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(fetcher)
        stamp = "2026-10-02T19:51:28Z"
        epoch = int(datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp())
        yahoo_rows = [{"date": day, "Close": 24.0 + index} for index, day in enumerate(
            ("2025-09-26", "2025-10-02", "2026-09-30", "2026-10-02"))]
        yahoo_data = {"info": {"symbol": "IBIC", "quoteType": "ETF", "regularMarketTime": epoch},
                      "history_1y": yahoo_rows}
        source = {"schema_version": "yf-etf-detail/v1", "source": "yahoo_finance",
                  "source_provider": "yahoo_finance", "ticker": "IBIC", "source_as_of": stamp,
                  "fetched_at": "2026-10-05T02:14:14Z", "raw": {"yf": yahoo_data}}
        source_bytes = (json.dumps(source) + "\n").encode()
        digest = hashlib.sha256(source_bytes).hexdigest()
        state_root = self.root / "state"
        object_file = state_root / f"providers/yahoo_finance/etf_detail/objects/IBIC/{digest}.json"
        canonical_file = self.root / "truth/data/yf/etf-details/IBIC.json"
        canonical_file.parent.mkdir(parents=True)
        canonical_file.write_bytes(source_bytes)
        object_file.parent.mkdir(parents=True)
        object_file.write_bytes(source_bytes)
        finance = {"schema_version": "yf-finance/v2", "source": "yahoo_finance", "ticker": "IBIC",
                   "source_as_of": stamp, "fetched_at": source["fetched_at"], "data": yahoo_data}
        write_json(self.root / "truth/data/yf/finance/IBIC.json", finance)
        selected = {"provider": "yahoo_finance", "domain": "etf_detail", "entity": "IBIC",
                    "provider_path": "data/yf/etf-details/IBIC.json", "payload_sha256": digest,
                    "source_as_of": stamp, "observed_at": source["fetched_at"]}
        class FakeStore:
            def read_active_domain(self, _domain):
                return {"current": {"IBIC": selected}}
        def primary(rows):
            periods = {"daily_1y": rows, "monthly_1y": [{"t": "2026-10-01", "c": 25.0}]}
            return {"ticker": "IBIC", "raw": {"history_periods": periods},
                    "normalized": {"history_periods": periods, "overview": {}}}
        native = [{"t": "2025-10-02", "c": 25.69}, {"t": "2026-10-02", "c": 25.64}]
        first = primary(native)
        with (patch.object(fetcher, "DATA_SUPPLY_STATE_ROOT", state_root),
              patch.object(fetcher, "STORAGE_ROOT", self.root / "truth"),
              patch.object(fetcher, "OUT_DIR", self.root / "truth/data/stockanalysis"),
              patch.object(fetcher, "data_supply_store", return_value=FakeStore())):
            fetcher.retain_yahoo_etf_history_archive("IBIC", first)
            self.assertIs(first["raw"]["history_periods"], first["normalized"]["history_periods"])
            self.assertEqual(first["normalized"]["history_periods"]["daily_1y"], native)
            self.assertEqual(first["normalized"]["history_periods"]["monthly_1y"], [{"t": "2026-10-01", "c": 25.0}])
            self.assertEqual(first["normalized"]["history_archive"][0]["source_payload"].encode(), source_bytes)
            self.assertTrue(validate_etf_history_archive(first))
            dropped_archive = json.loads(json.dumps(first))
            dropped_archive["normalized"].pop("history_archive")
            self.assertTrue(validate_etf_history_archive(dropped_archive))
            self.assertEqual(etf_detail_regression(dropped_archive, first), "history_archive")
            country_only = primary(native)
            country_only.update({"detail_status": "stockanalysis_partial",
                                 "partial_reason_codes": ["holdings_countries_unavailable"]})
            fetcher.retain_yahoo_etf_history_archive("IBIC", country_only)
            self.assertEqual(country_only["normalized"]["history_archive"], first["normalized"]["history_archive"])
            write_json(fetcher.OUT_DIR / "etfs/IBIC.json", first)
            selected["provider"] = "stockanalysis"
            # The native tail advances and omits an interior Yahoo date. Its
            # current price basis remains native while the old archive persists.
            later = primary([{"t": "2025-10-03", "c": 25.71}, {"t": "2026-10-05", "c": 25.66}])
            fetcher.retain_yahoo_etf_history_archive("IBIC", later)
            self.assertEqual(later["normalized"]["history_archive"], first["normalized"]["history_archive"])
            self.assertEqual(later["normalized"]["history_periods"]["daily_1y"], later["raw"]["history_periods"]["daily_1y"])
            self.assertTrue(validate_etf_history_archive(later))
            write_json(fetcher.OUT_DIR / "etfs/IBIC.json", later)
            next_stamp = "2026-10-03T19:51:28Z"
            next_rows = [{"date": day, "Close": 25.0 + index} for index, day in enumerate(
                ("2025-10-03", "2026-10-02", "2026-10-03"))]
            next_source = json.loads(json.dumps(source))
            next_source["source_as_of"] = next_stamp
            next_source["raw"]["yf"]["info"]["regularMarketTime"] = int(
                datetime.fromisoformat(next_stamp.replace("Z", "+00:00")).timestamp())
            next_source["raw"]["yf"]["history_1y"] = next_rows
            next_bytes = (json.dumps(next_source) + "\n").encode()
            next_digest = hashlib.sha256(next_bytes).hexdigest()
            next_object = state_root / f"providers/yahoo_finance/etf_detail/objects/IBIC/{next_digest}.json"
            next_object.write_bytes(next_bytes)
            canonical_file.write_bytes(next_bytes)
            finance["source_as_of"] = next_stamp
            finance["data"] = next_source["raw"]["yf"]
            write_json(self.root / "truth/data/yf/finance/IBIC.json", finance)
            selected.update({"provider": "yahoo_finance", "payload_sha256": next_digest,
                             "source_as_of": next_stamp})
            canonical_file.write_text('{"ticker": "IBIC", "newer": true}')
            write_json(self.root / "truth/data/yf/finance/IBIC.json", {"newer": True})
            third = primary([{"t": row["date"], "c": row["Close"]} for row in next_rows])
            fetcher.retain_yahoo_etf_history_archive("IBIC", third)
            self.assertEqual(len(third["normalized"]["history_archive"]), 2)
            self.assertTrue({"2025-09-26", "2026-09-30", "2026-10-03"} <= archived_etf_history(third))
            self.assertEqual(third["normalized"]["history_periods"]["daily_1y"], third["raw"]["history_periods"]["daily_1y"])

    def test_two_tracked_etf_refreshes_rebind_each_written_hash(self):
        from datetime import datetime
        path = self.store.canonical_path("etf", "IBIC")
        def candidate(day):
            epoch = int(datetime.fromisoformat(f"{day}T20:00:00+00:00").timestamp())
            rows = [{"t": day, "c": 25.6}]
            return {"schema_version": "stockanalysis/v1", "source": "stockanalysis", "asset_type": "etf",
                    "ticker": "IBIC", "source_as_of": "2026-10-01T00:00:00Z", "fetched_at": "2026-10-05T02:14:14Z",
                    "endpoints": {"quote": "/quote", "history_periods": {"daily_1y": "/history"}},
                    "raw": {"official_holdings": {"source_as_of": "2026-10-01"},
                            "quote": {"td": day, "ts": epoch}, "history_periods": {"daily_1y": rows}},
                    "normalized": {"overview": {}, "holdings": [{"symbol": "TIP"}],
                                   "history_periods": {"daily_1y": rows}}}
        first = candidate("2026-10-01")
        original = write_json(path, first)
        write_json(self.state_root / "states/etf/IBIC.json", {
            "current": {"path": "data/stockanalysis/etfs/IBIC.json",
                        "payload_sha256": hashlib.sha256(original).hexdigest(),
                        "source_as_of": first["source_as_of"]}, "retry": False})
        self.assertTrue(self.store.is_tracked("etf", "IBIC"))
        for day in ("2026-10-02", "2026-10-03"):
            payload = candidate(day)
            self.assertTrue(self.store.recovery_candidate_advances("etf", "IBIC", payload))
            written = write_json(path, payload)
            state = self.store.record_success("etf", "IBIC", payload, {}, prevalidated_etf=True)
            self.assertEqual(state["current"]["payload_sha256"], hashlib.sha256(written).hexdigest())
        self.assertFalse(self.store.recovery_candidate_advances("etf", "IBIC", candidate("2026-10-01")))

    def test_ordinary_quote_only_etf_can_gain_daily_history(self):
        def candidate(day, history):
            payload = {"schema_version": "stockanalysis/v1", "source": "stockanalysis", "asset_type": "etf",
                       "ticker": "IBIC", "source_as_of": day + "T00:00:00Z", "fetched_at": "2026-10-05T02:14:14Z",
                       "normalized": {"overview": {"aum": 1}, "holdings": [{"symbol": "TIP"}]},
                       "raw": {"quote": {"td": day}}}
            if history:
                payload["raw"]["history_periods"] = {"daily_1y": [{"t": day, "c": 25.6}]}
                payload["normalized"]["history_periods"] = payload["raw"]["history_periods"]
            return payload
        old = candidate("2026-10-01", False)
        write_json(self.store.canonical_path("etf", "IBIC"), old)
        self.store.record_failure("etf", "IBIC", "HTTP 503", {})
        self.assertTrue(self.store.recovery_candidate_advances("etf", "IBIC", candidate("2026-10-02", True)))
        self.assertFalse(self.store.recovery_candidate_advances("etf", "IBIC", candidate("2026-09-30", True)))

    def test_ordinary_aggregate_floor_applies_when_component_clocks_are_empty(self):
        old = {"schema_version": "stockanalysis/v1", "source": "stockanalysis", "asset_type": "etf",
               "ticker": "IBIH", "source_as_of": "2026-10-02T00:00:00Z", "fetched_at": "2026-10-05T02:14:14Z",
               "normalized": {"overview": {"aum": 1}, "holdings": [{"symbol": "TIP"}],
                              "history": [{"t": "2026-10-02", "c": 25.6}]}, "raw": {}}
        write_json(self.store.canonical_path("etf", "IBIH"), old)
        self.store.record_failure("etf", "IBIH", "HTTP 503", {})
        candidate = json.loads(json.dumps(old))
        candidate["source_as_of"] = "2026-10-01T00:00:00Z"
        candidate["raw"]["quote"] = {"td": "2026-10-01"}
        self.assertFalse(self.store.recovery_candidate_advances("etf", "IBIH", candidate))

    def test_same_source_date_recovers_for_any_execution_context(self):
        payload = stock_payload("AAPL", "2026-07-14T20:00:00Z")
        path = self.data_root / "stocks" / "AAPL.json"
        original = write_json(path, payload)
        for context in ({}, {"event_name": "workflow_dispatch"},
                        {"event_name": "schedule", "run_attempt": 2}):
            self.store.record_failure("stock", "AAPL", "HTTP 503", context)
            self.assertTrue(self.store.recovery_candidate_advances("stock", "AAPL", payload))
            state = self.store.record_success("stock", "AAPL", payload, context)
            self.assertFalse(state["retry"])
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual((self.state_root / "lkg/stock/AAPL.json").read_bytes(), original)
            self.assertEqual(state["current"]["source_as_of"], payload["source_as_of"])

    def test_older_candidate_is_rejected_before_good_bytes_change(self):
        good = stock_payload("AAPL", "2026-07-14T20:00:00Z")
        path = self.data_root / "stocks/AAPL.json"
        original = write_json(path, good)
        self.store.record_failure("stock", "AAPL", "HTTP 503", {})
        self.assertFalse(self.store.recovery_candidate_advances(
            "stock", "AAPL", stock_payload("AAPL", "2026-07-13T20:00:00Z")))
        self.assertEqual(path.read_bytes(), original)
        self.assertEqual((self.state_root / "lkg/stock/AAPL.json").read_bytes(), original)



    def seed_lane(self) -> dict[tuple[str, str], bytes]:
        return {
            ("stock", "AAPL"): write_json(
                self.data_root / "stocks" / "AAPL.json",
                stock_payload("AAPL", "2026-07-14T20:00:00Z"),
            ),
            ("financial", "AAPL"): write_json(
                self.data_root / "financials" / "AAPL.json",
                financial_payload("AAPL", "2026-06-30"),
            ),
            ("surface", "actions_recent"): write_json(
                self.data_root / "surfaces" / "actions_recent.json",
                surface_payload("actions_recent", "2026-07-15T07:00:00Z", "AAPL"),
            ),
        }

    def test_bootstrap_and_failure_retain_exact_sha_bound_lkg_and_retry(self) -> None:
        seeded = self.seed_lane()
        self.assertEqual(self.store.bootstrap_existing(self.run_context("bootstrap")), 3)

        for (kind, entity), expected_bytes in seeded.items():
            state = self.store.record_failure(
                kind,
                entity,
                "controlled failure injection",
                self.run_context("chaos-1"),
                controlled=True,
            )
            lkg_path = self.state_root / "lkg" / kind / f"{entity}.json"
            self.assertEqual(state["resolution_state"], "lkg_primary")
            self.assertTrue(state["retry"])
            self.assertEqual(lkg_path.read_bytes(), expected_bytes)
            self.assertEqual(
                state["lkg"]["payload_sha256"],
                hashlib.sha256(expected_bytes).hexdigest(),
            )
            self.assertEqual(state["current"], state["lkg"])
            self.assertIn("controlled failure", state["latest_failure"]["error"])

        index = self.store.rebuild_index(self.run_context("chaos-1"))
        self.assertEqual(index["counts"]["lkg"], 3)
        self.assertEqual(index["counts"]["retry"], 3)
        self.assertEqual(index["current_results"]["failed"], 3)
        self.assertEqual(index["degraded_tickers"], ["AAPL"])
        self.assertEqual(index["degraded_surfaces"], ["actions_recent"])
        self.assertEqual(self.store.assess_current_attempt(index)["status"], "degraded")

    def test_provider_row_dates_supply_strict_advancement_markers(self) -> None:
        stock = stock_payload("AAPL", "2026-07-14T20:00:00Z")
        stock["source_as_of"] = None
        stock["normalized"]["quote"]["td"] = "2026-07-14"
        stock["normalized"]["history"] = [{"t": "2026-07-13", "c": 10}]
        surface = surface_payload(
            "market_gainers", "2026-07-15T07:00:00Z", "AAPL", "Jul 14, 2026"
        )
        self.assertEqual(
            payload_source_fields("stock", stock)["source_as_of"],
            "2026-07-14T00:00:00Z",
        )
        self.assertEqual(
            payload_source_fields("surface", surface)["source_as_of"],
            "2026-07-14T00:00:00Z",
        )






    def test_upcoming_calendar_events_do_not_invent_source_freshness(self):
        payload = surface_payload("earnings_calendar", "2026-07-15T07:00:00Z", "AAPL", "2099-01-01")
        self.assertIsNone(payload_source_fields("surface", payload)["source_as_of"])
        self.assertTrue(self.store.recovery_candidate_advances("surface", "earnings_calendar", payload))
        path = self.data_root / "surfaces/earnings_calendar.json"
        original = write_json(path, payload)
        self.store.bootstrap_existing({})
        state_path = self.state_root / "states/surface/earnings_calendar.json"
        legacy_state = json.loads(state_path.read_bytes())
        legacy_state["current"]["source_as_of"] = "2099-01-01T00:00:00Z"
        write_json(state_path, legacy_state)
        self.assertTrue(self.store.recovery_candidate_advances("surface", "earnings_calendar", payload))
        self.store.record_failure("surface", "earnings_calendar", "HTTP 503", {})
        self.assertEqual((self.state_root / "lkg/surface/earnings_calendar.json").read_bytes(), original)
        state = self.store.record_success("surface", "earnings_calendar", payload, {})
        self.assertIsNone(state["current"]["source_as_of"])
        self.assertEqual(state["current"]["fetched_at"], payload["fetched_at"])
        self.assertEqual(json.loads(path.read_bytes())["records"][0]["date"], "2099-01-01")

    def test_upcoming_ipo_calendar_events_do_not_invent_source_freshness(self):
        payload = surface_payload("ipos_calendar", "2026-07-15T07:00:00Z", "NEW")
        payload["format"] = "html_table"
        payload["records"] = [{"symbol": "NEW", "ipo_date": "Sep 30, 2099"}]
        self.assertIsNone(payload_source_fields("surface", payload)["source_as_of"])
        self.assertTrue(self.store.recovery_candidate_advances("surface", "ipos_calendar", payload))
        path = self.data_root / "surfaces/ipos_calendar.json"
        original = write_json(path, payload)
        self.store.bootstrap_existing({})
        state_path = self.state_root / "states/surface/ipos_calendar.json"
        legacy_state = json.loads(state_path.read_bytes())
        legacy_state["current"]["source_as_of"] = "2099-09-30T00:00:00Z"
        write_json(state_path, legacy_state)
        self.assertTrue(self.store.recovery_candidate_advances("surface", "ipos_calendar", payload))
        self.store.record_failure("surface", "ipos_calendar", "HTTP 503", {})
        self.assertEqual((self.state_root / "lkg/surface/ipos_calendar.json").read_bytes(), original)
        state = self.store.record_success("surface", "ipos_calendar", payload, {})
        self.assertIsNone(state["current"]["source_as_of"])
        self.assertEqual(json.loads(path.read_bytes())["records"][0]["ipo_date"], "Sep 30, 2099")
        for candidate in ({**payload, "source_as_of": "2099-01-01T00:00:00Z"},
                          {**payload, "fetched_at": "2099-01-01T00:00:00Z"}):
            self.assertFalse(self.store.recovery_candidate_advances("surface", "ipos_calendar", candidate))

    def test_corporate_action_event_dates_do_not_invent_source_freshness(self):
        for name in ("actions_recent", "actions_splits"):
            with self.subTest(surface=name):
                payload = surface_payload(name, "2026-09-30T02:31:15Z", "MYPS", "Oct 1, 2026")
                if name == "actions_splits":
                    payload["format"] = "html_table"
                    payload["tables"] = [{"records": payload.pop("records")}]
                    payload["counts"] = {"tables": 1, "rows": 1}
                self.assertIsNone(payload_source_fields("surface", payload)["source_as_of"])
                self.assertTrue(self.store.recovery_candidate_advances("surface", name, payload))
                path = self.data_root / "surfaces" / f"{name}.json"
                original = write_json(path, payload)
                self.store.bootstrap_existing({})
                state_path = self.state_root / "states" / "surface" / f"{name}.json"
                legacy_state = json.loads(state_path.read_bytes())
                legacy_state["current"]["source_as_of"] = "2026-10-01T00:00:00Z"
                for field, invalid_value in (("path", "wrong.json"), ("payload_sha256", "0" * 64)):
                    invalid_state = {
                        **legacy_state,
                        "current": {**legacy_state["current"], field: invalid_value},
                    }
                    write_json(state_path, invalid_state)
                    self.assertFalse(self.store.recovery_candidate_advances("surface", name, payload))
                write_json(state_path, legacy_state)
                self.assertTrue(self.store.recovery_candidate_advances("surface", name, payload))
                self.store.record_failure("surface", name, "HTTP 503", {})
                self.assertEqual((self.state_root / "lkg" / "surface" / f"{name}.json").read_bytes(), original)
                retained_state = json.loads(state_path.read_bytes())
                for field in ("current", "lkg"):
                    retained_state[field]["source_as_of"] = "2026-10-01T00:00:00Z"
                write_json(state_path, retained_state)
                self.assertTrue(self.store.recovery_candidate_advances("surface", name, payload))
                state = self.store.record_success("surface", name, payload, {})
                self.assertFalse(state["retry"])
                self.assertEqual(state["failure_count"], 0)
                self.assertIsNone(state["current"]["source_as_of"])
                self.assertEqual(state["current"]["fetched_at"], payload["fetched_at"])
                self.assertEqual(path.read_bytes(), original)
                for field in ("source_as_of", "fetched_at"):
                    self.assertFalse(self.store.recovery_candidate_advances(
                        "surface", name, {**payload, field: "2099-01-01T00:00:00Z"}
                    ))
                dated = {**payload, "source_as_of": "2026-09-30T00:00:00Z"}
                write_json(path, dated)
                self.store.bootstrap_existing({})
                self.assertFalse(self.store.recovery_candidate_advances(
                    "surface", name, {**dated, "source_as_of": "2026-09-29T00:00:00Z"}
                ))

    def test_calendar_still_refuses_future_provider_source_or_observation(self):
        payload = surface_payload("earnings_calendar", "2026-07-15T07:00:00Z", "AAPL", "2099-01-01")
        for candidate in ({**payload, "source_as_of": "2099-01-01T00:00:00Z"},
                          {**payload, "fetched_at": "2099-01-01T00:00:00Z"}):
            with self.subTest(candidate=candidate):
                self.assertFalse(self.store.recovery_candidate_advances("surface", "earnings_calendar", candidate))

    def test_existing_payload_loss_is_corruption(self) -> None:
        self.seed_lane()
        self.store.bootstrap_existing(self.run_context("bootstrap"))
        (self.data_root / "stocks" / "AAPL.json").write_text("{broken", encoding="utf-8")
        state = self.store.record_failure(
            "stock", "AAPL", "decode collapse", self.run_context("broken-1")
        )
        self.assertEqual(state["resolution_state"], "unavailable")
        self.assertTrue(state["latest_failure"]["data_loss"])
        index = self.store.rebuild_index(self.run_context("broken-1"))
        assessment = self.store.assess_current_attempt(index)
        self.assertEqual(assessment["status"], "corrupt")
        self.assertEqual(assessment["exit_code"], 2)

    def test_systemic_auth_failure_is_corruption_even_with_retained_lkg(self) -> None:
        self.seed_lane()
        self.store.bootstrap_existing(self.run_context("bootstrap"))
        state = self.store.record_failure(
            "stock",
            "AAPL",
            "HTTP Error 401: Unauthorized",
            self.run_context("auth-1"),
        )
        self.assertTrue(self.store.valid_retained_lkg("stock", "AAPL", state))
        assessment = self.store.assess_current_attempt(
            self.store.rebuild_index(self.run_context("auth-1"))
        )
        self.assertEqual(assessment["status"], "corrupt")
        self.assertEqual(assessment["exit_code"], 2)
        self.assertIn("authentication", assessment["reasons"][0])

    def test_universe_failure_retains_exact_lkg_and_names_retry_then_recovers(self) -> None:
        entity = "etf_universe"
        canonical = self.data_root / "etf_universe.json"
        expected_lkg = write_json(
            canonical,
            universe_payload("2026-07-15T07:00:00Z", "AAA", "BBB"),
        )
        self.assertEqual(self.store.bootstrap_existing(self.run_context("bootstrap")), 1)

        state = self.store.record_failure(
            "universe",
            entity,
            "TimeoutError: transient universe timeout",
            self.run_context("universe-failed"),
        )
        self.assertEqual(state["resolution_state"], "lkg_primary")
        self.assertTrue(state["retry"])
        self.assertEqual(
            (self.state_root / "lkg" / "universe" / f"{entity}.json").read_bytes(),
            expected_lkg,
        )
        self.assertEqual(self.store.retry_entities("universe"), {entity})

        failed_index = self.store.rebuild_index(self.run_context("universe-failed"))
        self.assertIn(
            {"artifact_kind": "universe", "entity": entity},
            failed_index["retry_artifacts"],
        )
        self.assertEqual(failed_index["degraded_universes"], [entity])
        self.assertEqual(
            self.store.assess_current_attempt(failed_index),
            {
                "status": "degraded",
                "exit_code": 0,
                "artifacts": ["universe:etf_universe"],
                "reasons": [],
            },
        )

        advanced = universe_payload("2026-07-15T08:05:00Z", "AAA", "BBB", "CCC")
        write_json(canonical, advanced)
        recovered = self.store.record_success(
            "universe",
            entity,
            advanced,
            {
                **self.run_context("universe-recovered"),
                "event_name": "schedule",
                "natural": True,
            },
        )
        self.assertEqual(recovered["resolution_state"], "fresh_primary")
        self.assertFalse(recovered["retry"])
        recovered_index = self.store.rebuild_index(self.run_context("universe-recovered"))
        self.assertEqual(recovered_index["degraded_universes"], [])

    def test_reconcile_current_payload_sha_fails_closed_and_distinguishes_noop(self) -> None:
        entity = "etf_universe"
        canonical = self.data_root / "etf_universe.json"
        write_json(canonical, universe_payload("2026-07-15T07:00:00Z", "AAA"))
        self.store.bootstrap_existing(self.run_context("bootstrap"))

        self.assertFalse(
            self.store.reconcile_current_payload_sha256("universe", entity),
            "matching canonical bytes are a no-op, not a reconciliation failure",
        )
        state_path = self.state_root / "states" / "universe" / f"{entity}.json"
        state_path.unlink()
        with self.assertRaisesRegex(StockAnalysisRecoveryStateError, "missing recovery state"):
            self.store.reconcile_current_payload_sha256("universe", entity)

        state_path.write_text("{broken", encoding="utf-8")
        with self.assertRaisesRegex(StockAnalysisRecoveryStateError, "malformed recovery state"):
            self.store.reconcile_current_payload_sha256("universe", entity)

        self.store.bootstrap_existing(self.run_context("rebootstrap"))
        canonical.unlink()
        with self.assertRaisesRegex(StockAnalysisRecoveryStateError, "canonical payload is unreadable"):
            self.store.reconcile_current_payload_sha256("universe", entity)

    def test_reconcile_current_payload_sha_preserves_degraded_lkg_binding(self) -> None:
        entity = "etf_universe"
        canonical = self.data_root / "etf_universe.json"
        payload = universe_payload("2026-07-15T07:00:00Z", "AAA")
        write_json(canonical, payload)
        self.store.bootstrap_existing(self.run_context("bootstrap"))
        self.store.record_failure(
            "universe",
            entity,
            "controlled failure",
            self.run_context("controlled-failure"),
            controlled=True,
        )

        reclassified = {**payload, "classification_refreshed_at": "2026-07-15T08:00:00Z"}
        write_json(canonical, reclassified)

        self.assertFalse(
            self.store.reconcile_current_payload_sha256("universe", entity),
            "a degraded current pointer must remain bound to its retained LKG",
        )
        state = json.loads(
            (self.state_root / "states" / "universe" / f"{entity}.json").read_text()
        )
        self.assertEqual(state["current"], state["lkg"])
        self.assertTrue(self.store.valid_retained_lkg("universe", entity, state))




if __name__ == "__main__":
    unittest.main()
