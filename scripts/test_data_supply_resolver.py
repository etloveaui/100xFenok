import tempfile
import hashlib
import json
import datetime as dt
import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from data_supply_resolver import DataSupplyResolver, NoFreshInitialCandidateError
from data_supply_state import (
    DataSupplyStateStore,
    SchemaError,
    build_selection,
    canonical_json_bytes,
    canonical_sha256,
    deterministic_event_id,
)


def observation(
    *,
    provider,
    suffix,
    source_as_of,
    observed_at,
    status="valid",
    origin="natural",
    domain="etf_detail",
    entity="VYMI",
):
    is_primary = provider == "stockanalysis"
    is_stock = domain == "stock_detail"
    payload = {"ticker": entity, "suffix": suffix}
    if is_primary and not is_stock and status == "valid":
        payload.update({"schema_version": "stockanalysis/v1", "source": "stockanalysis", "asset_type": "etf",
                        "source_as_of": source_as_of, "fetched_at": observed_at,
                        "normalized": {"overview": {"aum": 1}, "holdings": [{"symbol": "AAPL", "weight_pct": 1}]},
                        "raw": {"quote": {"ts": int(dt.datetime.fromisoformat(source_as_of.replace("Z", "+00:00")).timestamp())}}})
    elif not is_primary and not is_stock and status == "valid":
        payload.update({"schema_version": "yf-etf-detail/v1", "source": "yahoo_finance",
                        "source_provider": "yahoo_finance", "asset_type": "etf", "detail_status": "yf_fallback",
                        "source_as_of": source_as_of, "fetched_at": observed_at,
                        "normalized": {"overview": {"aum": 1}, "holdings": [{"symbol": "AAPL", "weight_pct": 1}]},
                        "raw": {"yf": {"info": {"symbol": entity, "quoteType": "ETF",
                            "regularMarketTime": int(dt.datetime.fromisoformat(source_as_of.replace("Z", "+00:00")).timestamp())}}}})
    row = {
        "schema_version": "data-supply-observation/v1",
        "provider": provider,
        "endpoint_family": (
            ("stockanalysis_stock_detail" if is_stock else "stockanalysis_etf_detail")
            if is_primary
            else ("yahoo_finance_stock_detail" if is_stock else "yahoo_finance_etf_detail")
        ),
        "domain": domain,
        "entity": entity,
        "provider_path": (
            f"data/stockanalysis/{'stocks' if is_stock else 'etfs'}/{entity}-{suffix}.json"
            if is_primary
            else f"data/yf/{'finance' if is_stock else 'etf-details'}/{entity}-{suffix}.json"
        ),
        "payload_sha256": canonical_sha256(payload),
        "provider_schema": (
            "stockanalysis/v1"
            if is_primary
            else ("yf-finance/v2" if is_stock else "yf-etf-detail/v1")
        ),
        "source_as_of": source_as_of,
        "observed_at": observed_at,
        "validation_status": status,
        "reason_code": "contract_valid" if status == "valid" else "fetch_failed",
        "observation_origin": origin,
    }
    row["event_id"] = deterministic_event_id("observation", row)
    return row, canonical_json_bytes(payload)


class DataSupplyResolverTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.store = DataSupplyStateStore(self.root)
        self.resolver = DataSupplyResolver(self.store)

    def tearDown(self):
        self.tmp.cleanup()

    def publish(self, **kwargs):
        row, payload = observation(**kwargs)
        if row["validation_status"] == "valid":
            self.store.store_provider_object(observation=row, payload=payload)
        self.store.record_observation(row)
        return row

    def publish_stock(self, **kwargs):
        return self.publish(domain="stock_detail", entity="AAPL", **kwargs)

    def resolve_stock(self, observations, decided_at):
        return self.resolver.resolve(
            domain="stock_detail",
            entity="AAPL",
            observations=observations,
            decided_at=decided_at,
        )

    def manual_etf(self, run_id, minute, *, payload_changes=None, proof_changes=None, origin="rebuild"):
        stamp = f"2026-07-15T23:{minute:02d}:00Z"
        payload = {
            "schema_version": "stockanalysis/v1", "source": "stockanalysis",
            "asset_type": "etf", "ticker": "VYMI",
            "source_as_of": "2026-07-15T00:00:00Z", "fetched_at": stamp,
            "normalized": {"overview": {"aum": 1}, "holdings": [{"ticker": "AAPL", "weight": 1}]},
            "raw": {"quote": {"td": "2026-07-15"}},
        }
        payload.update(payload_changes or {})
        raw = (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode()
        row, _ = observation(provider="stockanalysis", suffix=f"manual-{run_id}-{minute}",
                             source_as_of=payload["source_as_of"], observed_at=stamp, origin=origin)
        row.update({"provider_path": "data/stockanalysis/etfs/VYMI.json",
                    "payload_sha256": hashlib.sha256(raw).hexdigest()})
        if origin == "rebuild":
            row["collection_origin"] = "manual"
        row["event_id"] = deterministic_event_id("observation", row)
        self.store.provider_truth_root = self.root / "truth"
        canonical = self.store.provider_truth_root / row["provider_path"]
        canonical.parent.mkdir(parents=True, exist_ok=True)
        self.store.store_provider_object(observation=row, payload=raw)
        canonical.write_bytes(raw)
        self.store.record_observation(row)
        return row

    def seed_manual_fallback(self):
        self.manual_case = getattr(self, "manual_case", 0) + 1
        self.store = DataSupplyStateStore(self.root / f"manual-case-{self.manual_case}")
        self.resolver = DataSupplyResolver(self.store)
        fallback = self.publish(provider="yahoo_finance", suffix="manual-seed",
                                source_as_of="2026-07-14T00:00:00Z", observed_at="2026-07-15T22:00:00Z")
        self.resolver.resolve(domain="etf_detail", entity="VYMI", observations=[fallback],
                              decided_at="2026-07-15T22:01:00Z")
        return fallback

    def resolve_manual(self, row, fallback):
        return self.resolver.resolve(domain="etf_detail", entity="VYMI", observations=[row, fallback],
                                     decided_at="2026-07-15T23:59:00Z")

    def test_primary_recovery_rejects_partial_old_future_and_wrong_provider_dates(self):
        for changes in (
            {"detail_status": "stockanalysis_partial"},
            {"source_as_of": "2026-07-13T00:00:00Z", "raw": {"quote": {"td": "2026-07-13"}}},
            {"source_as_of": "2026-07-16T00:00:00Z", "raw": {"quote": {"td": "2026-07-16"}}},
            {"raw": {"quote": {"td": "2026-07-14"}}},
            {"source_provider": "yahoo_finance"},
            {"normalized": {"overview": {}, "holdings": []}},
            {"ticker": "FOREIGN"},
        ):
            with self.subTest(changes=changes):
                fallback = self.seed_manual_fallback()
                if changes.get("source_as_of") == "2026-07-16T00:00:00Z":
                    before = self.store.read_active_domain("etf_detail")
                    canonical = self.root / "truth/data/stockanalysis/etfs/VYMI.json"
                    before_bytes = canonical.read_bytes() if canonical.exists() else None
                    with self.assertRaisesRegex(SchemaError, "observed_at cannot precede"):
                        self.manual_etf("901", 1, payload_changes=changes)
                    self.assertEqual(self.store.read_active_domain("etf_detail"), before)
                    self.assertEqual(canonical.read_bytes() if canonical.exists() else None, before_bytes)
                    continue
                row = self.manual_etf("901", 1, payload_changes=changes)
                active = self.resolve_manual(row, fallback)
                self.assertEqual(active["current"]["VYMI"]["provider"], "yahoo_finance")

    def test_complete_primary_recovers_immediately_without_execution_proof(self):
        for origin in ("cache", "rebuild", "natural"):
            with self.subTest(origin=origin):
                fallback = self.seed_manual_fallback()
                row = self.publish(provider="stockanalysis", suffix=origin,
                    source_as_of="2026-07-14T00:00:00Z", observed_at="2026-07-15T23:01:00Z", origin=origin)
                active = self.resolve_manual(row, fallback)
                self.assertEqual(active["current"]["VYMI"]["provider"], "stockanalysis")






    def bound_yahoo_etf(self, *, run_id="911", source="2026-07-15T20:00:00Z"):
        stamp = "2026-07-15T23:03:00Z"
        epoch = int(dt.datetime.fromisoformat(source.replace("Z", "+00:00")).timestamp())
        payload = {"schema_version": "yf-etf-detail/v1", "source": "yahoo_finance",
                   "source_provider": "yahoo_finance", "detail_status": "yf_fallback",
                   "asset_type": "etf", "ticker": "VYMI", "source_as_of": source,
                   "fetched_at": stamp, "normalized": {"overview": {"aum": 1}, "holdings": [{"symbol": "AAPL", "weight_pct": 1}]},
                   "raw": {"yf": {"info": {"symbol": "VYMI", "quoteType": "ETF", "regularMarketTime": epoch}}}}
        raw = (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode()
        row, _ = observation(provider="yahoo_finance", suffix="bound-refresh", source_as_of=source,
                             observed_at=stamp, origin="rebuild")
        provider = {"schema_version": "yf-finance/v2", "ticker": "VYMI", "profile": "etf", "source": "yahoo_finance",
                    "source_as_of": source, "fetched_at": stamp, "data": payload["raw"]["yf"]}
        provider_raw = (json.dumps(provider, ensure_ascii=False, indent=2) + "\n").encode()
        row.update({"provider_path": "data/yf/etf-details/VYMI.json", "payload_sha256": hashlib.sha256(raw).hexdigest(),
                    "collection_origin": "manual"})
        row["event_id"] = deterministic_event_id("observation", row)
        canonical = self.store.provider_truth_root / row["provider_path"]
        canonical.parent.mkdir(parents=True, exist_ok=True)
        canonical.write_bytes(raw)
        provider_path = self.store.provider_truth_root / "data/yf/finance/VYMI.json"
        provider_path.parent.mkdir(parents=True, exist_ok=True)
        provider_path.write_bytes(provider_raw)
        self.store.store_provider_object(observation=row, payload=raw)
        self.store.record_observation(row)
        return row

    def test_complete_primary_recovers_after_mutable_yahoo_pair_advances(self):
        self.store.provider_truth_root = self.root / "truth"
        fallback = self.bound_yahoo_etf(source="2026-07-14T00:00:00Z")
        self.resolver.resolve_etf_detail(entity="VYMI", observations=[fallback], decided_at="2026-07-15T23:04:00Z")
        for rel in ("data/yf/etf-details/VYMI.json", "data/yf/finance/VYMI.json"):
            (self.store.provider_truth_root / rel).write_text('{"newer":true}')
        primary = self.manual_etf("advance", 5)
        active = self.resolve_manual(primary, fallback)
        self.assertEqual(active["current"]["VYMI"]["provider"], "stockanalysis")

    def test_metadata_only_candidate_cannot_become_initial_authority(self):
        fallback, _ = observation(provider="yahoo_finance", suffix="unbound-history",
                                  source_as_of="2026-07-14T00:00:00Z", observed_at="2026-07-15T22:00:00Z")
        raw = canonical_json_bytes({"ticker": "VYMI", "normalized": {"history": [{"date": "2026-07-14", "Close": 1}]}})
        fallback["payload_sha256"] = hashlib.sha256(raw).hexdigest()
        fallback["event_id"] = deterministic_event_id("observation", fallback)
        self.store.store_provider_object(observation=fallback, payload=raw)
        self.store.record_observation(fallback)
        with self.assertRaises(NoFreshInitialCandidateError):
            self.resolver.resolve_etf_detail(entity="VYMI", observations=[fallback], decided_at="2026-07-15T22:01:00Z")
        self.assertNotIn("VYMI", self.store.read_active_domain("etf_detail")["current"])

    def test_partial_primary_refreshes_selected_yahoo_without_primary_recovery_credit(self):
        self.seed_manual_fallback()
        primary = self.manual_etf("901", 1, payload_changes={"detail_status": "stockanalysis_partial"})
        fallback = self.bound_yahoo_etf()
        active = self.resolve_manual(primary, fallback)
        self.assertEqual(active["current"]["VYMI"]["provider"], "yahoo_finance")
        self.assertEqual(active["current"]["VYMI"]["source_as_of"], "2026-07-15T20:00:00Z")
        self.assertEqual(active["current"]["VYMI"]["payload_sha256"], fallback["payload_sha256"])
        self.assertEqual(active["current"]["VYMI"]["reason_code"], "primary_unavailable_fallback_valid")



    def nonfresh_partial_etf(self, kind):
        if kind == "stale":
            return self.manual_etf("902", 2, payload_changes={"detail_status": "stockanalysis_partial",
                "source_as_of": "2026-07-01T00:00:00Z", "raw": {"quote": {"td": "2026-07-01"}}})
        payload = {"schema_version": "stockanalysis/v1", "source": "stockanalysis", "asset_type": "etf",
                   "ticker": "VYMI", "detail_status": "stockanalysis_partial", "source_as_of": None,
                   "source_as_of_reason": "provider publishes no dated detail", "fetched_at": "2026-07-15T23:02:00Z",
                   "normalized": {"overview": {"aum": 1}, "holdings": []}, "raw": {}}
        raw = (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode()
        row, _ = observation(provider="stockanalysis", suffix="dateless-partial", source_as_of=None,
                             observed_at=payload["fetched_at"], status="invalid", origin="rebuild")
        row.update({"provider_path": "data/stockanalysis/etfs/VYMI.json", "collection_origin": "manual",
                    "payload_sha256": hashlib.sha256(raw).hexdigest(), "reason_code": "partial_source_date_unavailable"})
        row["event_id"] = deterministic_event_id("observation", row)
        (self.store.provider_truth_root / row["provider_path"]).write_bytes(raw)
        self.store.record_observation(row)
        return row







    def test_migrated_lkg_primary_advance_requires_complete_payload(self):
        for partial in (True, False):
            with self.subTest(partial=partial):
                self.store = DataSupplyStateStore(self.root / f"migration-primary-{partial}")
                self.resolver = DataSupplyResolver(self.store)
                row, raw = observation(provider="yahoo_finance", suffix="migration-primary", source_as_of="2026-07-01T00:00:00Z",
                                       observed_at="2026-07-01T00:00:00Z")
                self.store.store_provider_object(observation=row, payload=raw)
                self.store.record_observation(row)
                lkg = self.store.store_provider_lkg(provider="yahoo_finance", domain="etf_detail", entity="VYMI",
                    payload=raw, meaningful_transition=True, expected_latest_sha256=None)
                selected = build_selection(row, selected_at=row["observed_at"], resolution_state="lkg_fallback",
                    reason_code="legacy_migration_fallback_lkg", fallback_depth=2,
                    payload_ref_kind="provider_lkg", payload_ref_path=lkg["path"])
                active = self.store.read_active_domain("etf_detail")
                tx = self.store.prepare_transition(domain="etf_detail", entity="VYMI", current={"VYMI": selected}, lkg={},
                    recovery={"VYMI": {"last_transition": "migration_lkg_fallback"}},
                    candidate_observations=[row], expected_active_transaction_id=active["transaction_id"],
                    transition="migration_lkg_fallback", reason_code="legacy_migration_fallback_lkg",
                    decided_at=row["observed_at"])
                self.store.commit_prepared("etf_detail", tx)
                primary = self.manual_etf("950", 1, payload_changes={"detail_status": "stockanalysis_partial"} if partial else {},
                                          proof_changes={"event_name": "schedule"}, origin="natural")
                active = self.resolver.resolve_etf_detail(entity="VYMI", observations=[primary], decided_at="2026-07-15T23:59:00Z")
                self.assertEqual(active["current"]["VYMI"]["provider"], "yahoo_finance" if partial else "stockanalysis")
                self.assertEqual(active["current"]["VYMI"]["reason_code"],
                                 "legacy_migration_fallback_lkg" if partial else "primary_valid")

    def test_primary_has_domain_atomic_authority_over_fallback(self):
        primary = self.publish(
            provider="stockanalysis",
            suffix="p1",
            source_as_of="2026-07-10T00:00:00Z",
            observed_at="2026-07-10T01:00:00Z",
        )
        fallback = self.publish(
            provider="yahoo_finance",
            suffix="f1",
            source_as_of="2026-07-10T00:30:00Z",
            observed_at="2026-07-10T01:00:01Z",
        )
        active = self.resolver.resolve_etf_detail(
            entity="VYMI",
            observations=[fallback, primary],
            decided_at="2026-07-10T01:00:02Z",
        )
        selected = active["current"]["VYMI"]
        self.assertEqual(selected["provider"], "stockanalysis")
        self.assertEqual(selected["resolution_state"], "fresh_primary")
        self.assertEqual(selected["payload_ref"]["kind"], "provider_object")

    def test_primary_invalid_demotes_immediately_to_fallback_and_preserves_lkg(self):
        primary = self.publish(
            provider="stockanalysis",
            suffix="p1",
            source_as_of="2026-07-10T00:00:00Z",
            observed_at="2026-07-10T01:00:00Z",
        )
        self.resolver.resolve_etf_detail(
            entity="VYMI",
            observations=[primary],
            decided_at="2026-07-10T01:00:01Z",
        )
        primary_failure = self.publish(
            provider="stockanalysis",
            suffix="p-fail",
            source_as_of="2026-07-10T02:00:00Z",
            observed_at="2026-07-10T02:00:00Z",
            status="invalid",
        )
        fallback = self.publish(
            provider="yahoo_finance",
            suffix="f1",
            source_as_of="2026-07-10T02:00:00Z",
            observed_at="2026-07-10T02:00:01Z",
        )
        active = self.resolver.resolve_etf_detail(
            entity="VYMI",
            observations=[fallback, primary_failure],
            decided_at="2026-07-10T02:00:02Z",
        )
        self.assertEqual(active["current"]["VYMI"]["provider"], "yahoo_finance")
        self.assertEqual(active["current"]["VYMI"]["resolution_state"], "fresh_fallback")
        self.assertEqual(active["lkg"]["VYMI"]["provider"], "stockanalysis")
        self.assertEqual(active["lkg"]["VYMI"]["payload_ref"]["kind"], "provider_object")

    def test_bclo_sized_primary_rejects_fresh_fallback_detail_losses(self):
        from stockanalysis_recovery_state import etf_detail_regression

        for lost in ("holdings", "holding_count", "expenseRatio", "monthly_5y"):
            with self.subTest(lost=lost), tempfile.TemporaryDirectory() as tmp:
                store = DataSupplyStateStore(Path(tmp))
                resolver = DataSupplyResolver(store)

                def publish_payload(provider, payload, stamp):
                    row, _ = observation(provider=provider, suffix=lost, entity="BCLO",
                        source_as_of=payload["source_as_of"], observed_at=stamp)
                    raw = canonical_json_bytes(payload)
                    row["payload_sha256"] = hashlib.sha256(raw).hexdigest()
                    row["event_id"] = deterministic_event_id("observation", row)
                    store.store_provider_object(observation=row, payload=raw)
                    store.record_observation(row)
                    return row

                normalized = {
                    "overview": {"aum": 100, "expenseRatio": "0.45%", "dividendYield": "6.31%"},
                    "holdings": [{"symbol": f"CLO{i}", "weight_pct": 1} for i in range(25)],
                    "holding_count": 67,
                    "history_periods": {"monthly_5y": [{"t": "2025-01-31", "c": 49}, {"t": "2026-09-30", "c": 50}]},
                }
                primary = {"schema_version": "stockanalysis/v1", "source": "stockanalysis", "asset_type": "etf",
                           "ticker": "BCLO", "source_as_of": "2026-09-30T20:00:00Z", "fetched_at": "2026-10-01T00:00:00Z",
                           "detail_status": "stockanalysis_partial", "partial_reason_codes": ["holdings_countries_unavailable"],
                           "normalized": normalized, "raw": {"quote": {"td": "2026-09-30"}}}
                primary["raw"]["quote"]["ts"] = int(dt.datetime.fromisoformat(primary["source_as_of"].replace("Z", "+00:00")).timestamp())
                first = publish_payload("stockanalysis", primary, primary["fetched_at"])
                resolver.resolve_etf_detail(entity="BCLO", observations=[first], decided_at="2026-10-01T00:01:00Z")
                fallback = json.loads(json.dumps(primary))
                fallback.update({"schema_version": "yf-etf-detail/v1", "source": "yahoo_finance", "source_provider": "yahoo_finance", "detail_status": "yf_fallback",
                                 "source_as_of": "2026-10-05T20:00:00Z", "fetched_at": "2026-10-06T03:27:56Z",
                                 "raw": {"yf": {"info": {"symbol": "BCLO", "quoteType": "ETF", "regularMarketTime": 1791230400}}}})
                if lost == "holdings":
                    fallback["normalized"]["holdings"] = fallback["normalized"]["holdings"][:1]
                elif lost == "holding_count":
                    fallback["normalized"]["holding_count"] = None
                elif lost == "expenseRatio":
                    fallback["normalized"]["overview"].pop("expenseRatio")
                else:
                    fallback["normalized"]["history_periods"] = {}
                self.assertIsNotNone(etf_detail_regression(fallback, primary))
                candidate = publish_payload("yahoo_finance", fallback, fallback["fetched_at"])
                failed, _ = observation(provider="stockanalysis", suffix="failed", entity="BCLO", status="invalid",
                    source_as_of="2026-10-05T20:00:00Z", observed_at="2026-10-06T03:27:56Z")
                store.record_observation(failed)
                active = resolver.resolve_etf_detail(entity="BCLO", observations=[failed, candidate], decided_at="2026-10-06T04:00:00Z")
                self.assertEqual(active["current"]["BCLO"]["resolution_state"], "lkg_primary")
                self.assertEqual(store.read_resolved_payload("etf_detail", "BCLO"), primary)
                self.assertEqual(active["lkg"]["BCLO"]["payload_sha256"], first["payload_sha256"])

    def test_country_only_partial_primary_recovers_over_sparse_yahoo(self):
        fallback = self.seed_manual_fallback()
        row = self.manual_etf("country-gap", 1, payload_changes={
            "detail_status": "stockanalysis_partial", "partial_reason_codes": ["holdings_countries_unavailable"],
            "normalized": {"overview": {"aum": 100}, "holdings": [{"symbol": f"CLO{i}", "weight_pct": 1} for i in range(25)],
                           "holding_count": 67, "countries": None},
        })
        active = self.resolve_manual(row, fallback)
        self.assertEqual(active["current"]["VYMI"]["provider"], "stockanalysis")
        self.assertEqual(len(self.store.read_resolved_payload("etf_detail", "VYMI")["normalized"]["holdings"]), 25)



    def test_no_fresh_provider_uses_lkg_then_expires_to_unavailable(self):
        primary = self.publish(
            provider="stockanalysis",
            suffix="p0",
            source_as_of="2026-07-10T00:00:00Z",
            observed_at="2026-07-10T01:00:00Z",
        )
        self.resolver.resolve_etf_detail(entity="VYMI", observations=[primary], decided_at="2026-07-10T01:00:01Z")
        failures = [
            self.publish(
                provider="stockanalysis",
                suffix="pf",
                source_as_of="2026-07-10T03:00:00Z",
                observed_at="2026-07-10T03:00:00Z",
                status="invalid",
            ),
            self.publish(
                provider="yahoo_finance",
                suffix="ff",
                source_as_of="2026-07-10T03:00:00Z",
                observed_at="2026-07-10T03:00:01Z",
                status="invalid",
            ),
        ]
        active = self.resolver.resolve_etf_detail(
            entity="VYMI", observations=failures, decided_at="2026-07-10T03:00:02Z"
        )
        self.assertEqual(active["current"]["VYMI"]["resolution_state"], "lkg_primary")
        self.assertEqual(active["current"]["VYMI"]["payload_ref"]["kind"], "provider_object")

        expired_failures = [
            self.publish(
                provider="stockanalysis",
                suffix="pf2",
                source_as_of="2026-07-25T03:00:00Z",
                observed_at="2026-07-25T03:00:00Z",
                status="invalid",
            ),
            self.publish(
                provider="yahoo_finance",
                suffix="ff2",
                source_as_of="2026-07-25T03:00:00Z",
                observed_at="2026-07-25T03:00:01Z",
                status="invalid",
            ),
        ]
        active = self.resolver.resolve_etf_detail(
            entity="VYMI",
            observations=expired_failures,
            decided_at="2026-07-25T03:00:02Z",
        )
        self.assertNotIn("VYMI", active["current"])
        self.assertIn("VYMI", active["lkg"])

    def expire_to_unavailable(self):
        primary = self.publish(
            provider="stockanalysis",
            suffix="p0",
            source_as_of="2026-07-10T00:00:00Z",
            observed_at="2026-07-10T01:00:00Z",
        )
        self.resolver.resolve_etf_detail(
            entity="VYMI", observations=[primary], decided_at="2026-07-10T01:00:01Z"
        )
        expired_failures = [
            self.publish(
                provider="stockanalysis",
                suffix="pf2",
                source_as_of="2026-07-25T03:00:00Z",
                observed_at="2026-07-25T03:00:00Z",
                status="invalid",
            ),
            self.publish(
                provider="yahoo_finance",
                suffix="ff2",
                source_as_of="2026-07-25T03:00:00Z",
                observed_at="2026-07-25T03:00:01Z",
                status="invalid",
            ),
        ]
        removed = self.resolver.resolve_etf_detail(
            entity="VYMI",
            observations=expired_failures,
            decided_at="2026-07-25T03:00:02Z",
        )
        self.assertNotIn("VYMI", removed["current"])
        self.assertEqual(removed["recovery"]["VYMI"]["last_transition"], "unavailable")
        return removed

    def still_stale(self, day):
        return [
            self.publish(
                provider="stockanalysis",
                suffix=f"pf{day}",
                source_as_of=f"2026-07-{day}T03:00:00Z",
                observed_at=f"2026-07-{day}T03:00:00Z",
                status="invalid",
            ),
            self.publish(
                provider="yahoo_finance",
                suffix=f"ff{day}",
                source_as_of=f"2026-07-{day}T03:00:00Z",
                observed_at=f"2026-07-{day}T03:00:01Z",
                status="invalid",
            ),
        ]

    def test_known_unavailable_holds_unchanged_while_every_provider_stays_stale(self):
        # Two-cycle regression for runs 33825689997 / 33936218442: after the
        # committed removal, the next cycle with still-stale evidence must hold
        # the honest unavailable state, not raise an initial-selection fault.
        removed = self.expire_to_unavailable()
        held = self.resolver.resolve_etf_detail(
            entity="VYMI",
            observations=self.still_stale(26),
            decided_at="2026-07-26T03:00:02Z",
        )
        self.assertEqual(held, removed)
        self.assertEqual(
            self.store.read_active_domain("etf_detail")["transaction_id"],
            removed["transaction_id"],
        )
        held_again = self.resolver.resolve_etf_detail(
            entity="VYMI",
            observations=self.still_stale(27),
            decided_at="2026-07-27T03:00:02Z",
        )
        self.assertEqual(held_again, removed)

    def test_known_unavailable_hold_requires_complete_provider_evidence(self):
        self.expire_to_unavailable()
        partial = [
            self.publish(
                provider="stockanalysis",
                suffix="pf26",
                source_as_of="2026-07-26T03:00:00Z",
                observed_at="2026-07-26T03:00:00Z",
                status="invalid",
            )
        ]
        with self.assertRaisesRegex(SchemaError, "complete provider evidence"):
            self.resolver.resolve_etf_detail(
                entity="VYMI", observations=partial, decided_at="2026-07-26T03:00:02Z"
            )

    def test_known_unavailable_recovers_through_fresh_primary(self):
        self.expire_to_unavailable()
        fresh_primary = self.publish(
            provider="stockanalysis",
            suffix="p1",
            source_as_of="2026-07-28T00:00:00Z",
            observed_at="2026-07-28T01:00:00Z",
        )
        recovered = self.resolver.resolve_etf_detail(
            entity="VYMI",
            observations=[fresh_primary],
            decided_at="2026-07-28T01:00:01Z",
        )
        self.assertEqual(recovered["current"]["VYMI"]["provider"], "stockanalysis")
        self.assertEqual(recovered["current"]["VYMI"]["resolution_state"], "fresh_primary")
        self.assertEqual(recovered["recovery"]["VYMI"]["last_transition"], "initial_primary")
        # The expired audit LKG from the removal is superseded by the fresh
        # initial selection; it must not ride into the initial transition.
        self.assertNotIn("VYMI", recovered["lkg"])

    def test_known_unavailable_recovers_through_fresh_fallback(self):
        self.expire_to_unavailable()
        fresh_fallback = self.publish(
            provider="yahoo_finance",
            suffix="f1",
            source_as_of="2026-07-28T00:00:00Z",
            observed_at="2026-07-28T01:00:00Z",
        )
        recovered = self.resolver.resolve_etf_detail(
            entity="VYMI",
            observations=[fresh_fallback],
            decided_at="2026-07-28T01:00:01Z",
        )
        self.assertEqual(recovered["current"]["VYMI"]["provider"], "yahoo_finance")
        self.assertEqual(recovered["current"]["VYMI"]["resolution_state"], "fresh_fallback")
        self.assertEqual(recovered["recovery"]["VYMI"]["last_transition"], "initial_fallback")
        self.assertNotIn("VYMI", recovered["lkg"])

    def test_no_prior_without_unavailable_marker_still_fails_initial_selection(self):
        with self.assertRaisesRegex(SchemaError, "no fresh provider candidate exists for initial selection"):
            self.resolver.resolve_etf_detail(
                entity="VYMI",
                observations=self.still_stale(26),
                decided_at="2026-08-26T03:00:02Z",
            )

    def test_known_unavailable_hold_rejects_evidence_observed_after_the_decision(self):
        # Mirrors prepare_unavailable_transition: evidence observed after the
        # decision time is rejected by the store, so the hold must reject it too.
        self.expire_to_unavailable()
        evidence = [
            self.publish(
                provider="stockanalysis",
                suffix="pf27",
                source_as_of="2026-07-27T03:00:00Z",
                observed_at="2026-07-27T03:00:00Z",
                status="invalid",
            ),
            self.publish(
                provider="yahoo_finance",
                suffix="ff27late",
                source_as_of="2026-07-27T03:00:00Z",
                observed_at="2026-07-27T04:00:00Z",
                status="invalid",
            ),
        ]
        with self.assertRaisesRegex(SchemaError, "cannot follow the decision time"):
            self.resolver.resolve_etf_detail(
                entity="VYMI", observations=evidence, decided_at="2026-07-27T03:00:02Z"
            )

    def test_known_unavailable_hold_rejects_valid_evidence_from_the_future(self):
        # A valid observation dated after the decision is merely "not fresh" to
        # _fresh (negative age), so without the mirrored checks the hold would
        # silently accept it. validate_observation forbids observed_at before
        # source_as_of, so a future source always comes with a future
        # observation; either mirrored check must refuse it, never the hold.
        self.expire_to_unavailable()
        evidence = [
            self.publish(
                provider="stockanalysis",
                suffix="pf27",
                source_as_of="2026-07-27T03:00:00Z",
                observed_at="2026-07-27T03:00:00Z",
                status="invalid",
            ),
            self.publish(
                provider="yahoo_finance",
                suffix="ffuture",
                source_as_of="2026-07-28T00:00:00Z",
                observed_at="2026-07-28T00:00:01Z",
            ),
        ]
        with self.assertRaisesRegex(SchemaError, "follows? the decision"):
            self.resolver.resolve_etf_detail(
                entity="VYMI", observations=evidence, decided_at="2026-07-27T03:00:02Z"
            )
        self.assertNotIn("VYMI", self.store.read_active_domain("etf_detail")["current"])

    def expire_stock_to_unavailable(self):
        primary = self.publish_stock(
            provider="stockanalysis",
            suffix="p1",
            source_as_of="2026-07-10T00:00:00Z",
            observed_at="2026-07-10T01:00:00Z",
        )
        self.resolve_stock([primary], "2026-07-10T01:00:01Z")
        failures = [
            self.publish_stock(
                provider="stockanalysis",
                suffix="pf",
                source_as_of="2026-07-25T00:00:00Z",
                observed_at="2026-07-25T00:00:00Z",
                status="invalid",
            ),
            self.publish_stock(
                provider="yahoo_finance",
                suffix="ff",
                source_as_of="2026-07-25T00:00:00Z",
                observed_at="2026-07-25T00:00:01Z",
                status="invalid",
            ),
        ]
        active = self.resolve_stock(failures, "2026-07-25T00:00:02Z")
        self.assertNotIn("AAPL", active["current"])
        self.assertEqual(active["recovery"]["AAPL"]["last_transition"], "unavailable")

    def test_stock_detail_does_not_acquire_the_etf_unavailable_hold(self):
        # The incident and its authority are ETF-only: stock_detail keeps its
        # existing behavior after an unavailable removal.
        self.expire_stock_to_unavailable()
        still_stale = [
            self.publish_stock(
                provider="stockanalysis",
                suffix="pf26",
                source_as_of="2026-07-26T00:00:00Z",
                observed_at="2026-07-26T00:00:00Z",
                status="invalid",
            ),
            self.publish_stock(
                provider="yahoo_finance",
                suffix="ff26",
                source_as_of="2026-07-26T00:00:00Z",
                observed_at="2026-07-26T00:00:01Z",
                status="invalid",
            ),
        ]
        with self.assertRaisesRegex(SchemaError, "no fresh provider candidate exists for initial selection"):
            self.resolve_stock(still_stale, "2026-07-26T00:00:02Z")

    def test_stock_detail_does_not_acquire_the_etf_audit_lkg_cleanup(self):
        self.expire_stock_to_unavailable()
        fresh_primary = self.publish_stock(
            provider="stockanalysis",
            suffix="p2",
            source_as_of="2026-07-28T00:00:00Z",
            observed_at="2026-07-28T01:00:00Z",
        )
        with self.assertRaisesRegex(SchemaError, "an initial selection cannot inject an LKG"):
            self.resolve_stock([fresh_primary], "2026-07-28T01:00:01Z")
        self.assertIn("AAPL", self.store.read_active_domain("stock_detail")["lkg"])

    def test_stock_detail_primary_has_domain_atomic_authority_over_fallback(self):
        primary = self.publish(
            provider="stockanalysis",
            suffix="p1",
            source_as_of="2026-07-10T00:00:00Z",
            observed_at="2026-07-10T01:00:00Z",
            domain="stock_detail",
            entity="AAPL",
        )
        fallback = self.publish(
            provider="yahoo_finance",
            suffix="f1",
            source_as_of="2026-07-10T00:30:00Z",
            observed_at="2026-07-10T01:00:01Z",
            domain="stock_detail",
            entity="AAPL",
        )
        active = self.resolver.resolve(
            domain="stock_detail",
            entity="AAPL",
            observations=[fallback, primary],
            decided_at="2026-07-10T01:00:02Z",
        )
        self.assertEqual(active["current"]["AAPL"]["provider"], "stockanalysis")
        self.assertEqual(active["current"]["AAPL"]["resolution_state"], "fresh_primary")

    def test_stock_detail_rejects_provider_contract_mismatch(self):
        row, _ = observation(
            provider="yahoo_finance",
            suffix="bad-schema",
            source_as_of="2026-07-10T00:30:00Z",
            observed_at="2026-07-10T01:00:01Z",
            domain="stock_detail",
            entity="AAPL",
        )
        row["provider_schema"] = "yf-etf-detail/v1"
        row["event_id"] = deterministic_event_id("observation", row)
        with self.assertRaises(SchemaError):
            self.resolver.resolve(
                domain="stock_detail",
                entity="AAPL",
                observations=[row],
                decided_at="2026-07-10T01:00:02Z",
            )

    def test_stock_detail_primary_invalid_immediate_fallback(self):
        primary = self.publish_stock(
            provider="stockanalysis", suffix="p1", source_as_of="2026-07-10T00:00:00Z",
            observed_at="2026-07-10T01:00:00Z",
        )
        self.resolve_stock([primary], "2026-07-10T01:00:01Z")
        invalid = self.publish_stock(
            provider="stockanalysis", suffix="pf", source_as_of="2026-07-10T02:00:00Z",
            observed_at="2026-07-10T02:00:00Z", status="invalid",
        )
        fallback = self.publish_stock(
            provider="yahoo_finance", suffix="f1", source_as_of="2026-07-10T02:00:00Z",
            observed_at="2026-07-10T02:00:01Z",
        )
        active = self.resolve_stock([invalid, fallback], "2026-07-10T02:00:02Z")
        self.assertEqual(active["current"]["AAPL"]["provider"], "yahoo_finance")

    def test_stock_detail_primary_stale_immediate_fallback(self):
        primary = self.publish_stock(
            provider="stockanalysis", suffix="p1", source_as_of="2026-07-01T00:00:00Z",
            observed_at="2026-07-10T01:00:00Z",
        )
        fallback = self.publish_stock(
            provider="yahoo_finance", suffix="f1", source_as_of="2026-07-10T00:00:00Z",
            observed_at="2026-07-10T01:00:01Z",
        )
        active = self.resolve_stock([primary, fallback], "2026-07-10T01:00:02Z")
        self.assertEqual(active["current"]["AAPL"]["provider"], "yahoo_finance")




    def test_stock_detail_lkg_primary(self):
        primary = self.publish_stock(
            provider="stockanalysis", suffix="p1", source_as_of="2026-07-10T00:00:00Z",
            observed_at="2026-07-10T01:00:00Z",
        )
        self.resolve_stock([primary], "2026-07-10T01:00:01Z")
        failures = [
            self.publish_stock(provider="stockanalysis", suffix="pf", source_as_of="2026-07-11T00:00:00Z", observed_at="2026-07-11T00:00:00Z", status="invalid"),
            self.publish_stock(provider="yahoo_finance", suffix="ff", source_as_of="2026-07-11T00:00:00Z", observed_at="2026-07-11T00:00:01Z", status="invalid"),
        ]
        active = self.resolve_stock(failures, "2026-07-11T00:00:02Z")
        self.assertEqual(active["current"]["AAPL"]["resolution_state"], "lkg_primary")

    def test_stock_detail_lkg_fallback(self):
        fallback = self.publish_stock(
            provider="yahoo_finance", suffix="f1", source_as_of="2026-07-10T00:00:00Z",
            observed_at="2026-07-10T01:00:00Z",
        )
        self.resolve_stock([fallback], "2026-07-10T01:00:01Z")
        failures = [
            self.publish_stock(provider="stockanalysis", suffix="pf", source_as_of="2026-07-11T00:00:00Z", observed_at="2026-07-11T00:00:00Z", status="invalid"),
            self.publish_stock(provider="yahoo_finance", suffix="ff", source_as_of="2026-07-11T00:00:00Z", observed_at="2026-07-11T00:00:01Z", status="invalid"),
        ]
        active = self.resolve_stock(failures, "2026-07-11T00:00:02Z")
        self.assertEqual(active["current"]["AAPL"]["resolution_state"], "lkg_fallback")

    def test_stock_detail_expired_lkg_unavailable(self):
        primary = self.publish_stock(
            provider="stockanalysis", suffix="p1", source_as_of="2026-07-10T00:00:00Z",
            observed_at="2026-07-10T01:00:00Z",
        )
        self.resolve_stock([primary], "2026-07-10T01:00:01Z")
        failures = [
            self.publish_stock(provider="stockanalysis", suffix="pf", source_as_of="2026-07-25T00:00:00Z", observed_at="2026-07-25T00:00:00Z", status="invalid"),
            self.publish_stock(provider="yahoo_finance", suffix="ff", source_as_of="2026-07-25T00:00:00Z", observed_at="2026-07-25T00:00:01Z", status="invalid"),
        ]
        active = self.resolve_stock(failures, "2026-07-25T00:00:02Z")
        self.assertNotIn("AAPL", active["current"])

    def test_stock_detail_complete_evidence_required(self):
        primary = self.publish_stock(
            provider="stockanalysis", suffix="p1", source_as_of="2026-07-10T00:00:00Z",
            observed_at="2026-07-10T01:00:00Z",
        )
        self.resolve_stock([primary], "2026-07-10T01:00:01Z")
        failure = self.publish_stock(
            provider="stockanalysis", suffix="pf", source_as_of="2026-07-11T00:00:00Z",
            observed_at="2026-07-11T00:00:00Z", status="invalid",
        )
        with self.assertRaises(SchemaError):
            self.resolve_stock([failure], "2026-07-11T00:00:01Z")


if __name__ == "__main__":
    unittest.main()
