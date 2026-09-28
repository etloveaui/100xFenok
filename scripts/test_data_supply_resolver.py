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

from data_supply_resolver import DataSupplyResolver
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

    def manual_etf(self, run_id, minute, *, payload_changes=None, proof_changes=None):
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
                             source_as_of=payload["source_as_of"], observed_at=stamp, origin="rebuild")
        row.update({"provider_path": "data/stockanalysis/etfs/VYMI.json",
                    "payload_sha256": hashlib.sha256(raw).hexdigest(), "collection_origin": "manual"})
        proof = {"run_id": str(run_id), "run_attempt": 1, "event_name": "workflow_dispatch",
                 "remote": True, "fresh_fetch": True, "started_at": stamp, "completed_at": stamp,
                 "source_as_of": payload["source_as_of"], "fetched_at": stamp,
                 "payload_sha256": row["payload_sha256"]}
        proof.update(proof_changes or {})
        row["etf_acquisition"] = proof
        row["event_id"] = deterministic_event_id("observation", row)
        self.store.provider_truth_root = self.root / "truth"
        canonical = self.store.provider_truth_root / row["provider_path"]
        canonical.parent.mkdir(parents=True, exist_ok=True)
        canonical.write_bytes(raw)
        self.store.store_provider_object(observation=row, payload=raw)
        self.store.record_observation(row)
        return row

    def seed_manual_fallback(self):
        fallback = self.publish(provider="yahoo_finance", suffix="manual-seed",
                                source_as_of="2026-07-14T00:00:00Z", observed_at="2026-07-15T22:00:00Z")
        self.resolver.resolve(domain="etf_detail", entity="VYMI", observations=[fallback],
                              decided_at="2026-07-15T22:01:00Z")
        return fallback

    def resolve_manual(self, row, fallback):
        return self.resolver.resolve(domain="etf_detail", entity="VYMI", observations=[row, fallback],
                                     decided_at="2026-07-15T23:59:00Z")

    def test_three_bound_manual_acquisitions_recover_without_natural_credit(self):
        fallback = self.seed_manual_fallback()
        for count, run_id in enumerate(("901", "902", "903"), 1):
            row = self.manual_etf(run_id, count)
            active = self.resolve_manual(row, fallback)
            self.assertEqual(active["recovery"]["VYMI"]["consecutive_green"], count)
            self.assertEqual(active["current"]["VYMI"]["provider"], "stockanalysis" if count == 3 else "yahoo_finance")
            self.assertEqual(row["observation_origin"], "rebuild")
        self.assertEqual(active["decision"]["reason_code"], "primary_recovered_three_acquisitions")

    def test_manual_run_replay_cannot_earn_another_observation(self):
        fallback = self.seed_manual_fallback()
        self.resolve_manual(self.manual_etf("901", 1), fallback)
        active = self.resolve_manual(self.manual_etf("901", 2), fallback)
        self.assertEqual(active["recovery"]["VYMI"]["consecutive_green"], 1)

    def test_manual_acquisition_rejects_unbound_partial_old_future_or_foreign_evidence(self):
        cases = [
            ({}, {"run_id": "local"}), ({}, {"run_attempt": 2}),
            ({}, {"remote": False}), ({}, {"fresh_fetch": False}),
            ({}, {"noFetch": True}), ({}, {"event_name": "repository_dispatch"}),
            ({}, {"payload_sha256": "0" * 64}), ({}, {"completed_at": "2026-07-16T00:00:00Z"}),
            ({"detail_status": "stockanalysis_partial"}, {}),
            ({"source_as_of": "2026-07-13T00:00:00Z", "raw": {"quote": {"td": "2026-07-13"}}}, {}),
            ({"raw": {"quote": {"td": "2026-07-14"}}}, {}),
            ({"source_provider": "yahoo_finance"}, {}),
        ]
        for payload_changes, proof_changes in cases:
            with self.subTest(payload=payload_changes, proof=proof_changes):
                fallback = self.seed_manual_fallback()
                row = self.manual_etf("901", 1, payload_changes=payload_changes, proof_changes=proof_changes)
                active = self.resolve_manual(row, fallback)
                self.assertEqual(active["recovery"]["VYMI"]["consecutive_green"], 0)
        row = self.manual_etf("901", 2)
        row.pop("etf_acquisition")
        row["event_id"] = deterministic_event_id("observation", row)
        self.assertEqual(self.resolve_manual(row, fallback)["recovery"]["VYMI"]["consecutive_green"], 0)
        row = self.manual_etf("902", 3)
        (self.store.provider_truth_root / row["provider_path"]).write_text('{"ticker":"FOREIGN"}')
        self.assertEqual(self.resolve_manual(row, fallback)["recovery"]["VYMI"]["consecutive_green"], 0)

    def test_primary_failure_resets_manual_sequence_and_preserves_run_replay_barrier(self):
        fallback = self.seed_manual_fallback()
        self.resolve_manual(self.manual_etf("901", 1), fallback)
        self.resolve_manual(self.manual_etf("902", 2), fallback)
        failed = self.publish(provider="stockanalysis", suffix="manual-failure", status="invalid",
                              source_as_of="2026-07-15T00:00:00Z", observed_at="2026-07-15T23:03:00Z")
        active = self.resolve_manual(failed, fallback)
        self.assertEqual(active["recovery"]["VYMI"]["consecutive_green"], 0)
        active = self.resolve_manual(self.manual_etf("901", 4), fallback)
        self.assertEqual(active["recovery"]["VYMI"]["consecutive_green"], 0)
        active = self.resolve_manual(self.manual_etf("903", 5), fallback)
        self.assertEqual(active["recovery"]["VYMI"]["consecutive_green"], 1)

    def test_bound_schedule_rerun_cannot_earn_recovery_credit(self):
        fallback = self.seed_manual_fallback()
        row = self.manual_etf("901", 1, proof_changes={"event_name": "schedule", "run_attempt": 2})
        row["observation_origin"] = "natural"
        row["event_id"] = deterministic_event_id("observation", row)
        active = self.resolve_manual(row, fallback)
        self.assertEqual(active["recovery"]["VYMI"]["consecutive_green"], 0)

    def bound_yahoo_etf(self, *, run_id="911", source="2026-07-15T20:00:00Z"):
        stamp = "2026-07-15T23:03:00Z"
        epoch = int(dt.datetime.fromisoformat(source.replace("Z", "+00:00")).timestamp())
        payload = {"schema_version": "yf-etf-detail/v1", "source": "yahoo_finance",
                   "source_provider": "yahoo_finance", "detail_status": "yf_fallback",
                   "asset_type": "etf", "ticker": "VYMI", "source_as_of": source,
                   "fetched_at": stamp, "normalized": {"holdings": []},
                   "raw": {"yf": {"info": {"symbol": "VYMI", "quoteType": "ETF", "regularMarketTime": epoch}}}}
        raw = (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode()
        row, _ = observation(provider="yahoo_finance", suffix="bound-refresh", source_as_of=source,
                             observed_at=stamp, origin="rebuild")
        provider = {"schema_version": "yf-finance/v2", "ticker": "VYMI", "profile": "etf", "source": "yahoo_finance",
                    "source_as_of": source, "fetched_at": stamp, "data": payload["raw"]["yf"]}
        provider_raw = (json.dumps(provider, ensure_ascii=False, indent=2) + "\n").encode()
        row.update({"provider_path": "data/yf/etf-details/VYMI.json", "payload_sha256": hashlib.sha256(raw).hexdigest(),
                    "collection_origin": "manual", "etf_acquisition": {
                        "run_id": run_id, "run_attempt": 1, "event_name": "workflow_dispatch",
                        "remote": True, "fresh_fetch": True, "source_as_of": source, "fetched_at": stamp,
                        "started_at": stamp, "completed_at": stamp, "payload_sha256": hashlib.sha256(raw).hexdigest(),
                        "provider_payload_sha256": hashlib.sha256(provider_raw).hexdigest()}})
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

    def test_partial_primary_refreshes_selected_yahoo_without_primary_recovery_credit(self):
        self.seed_manual_fallback()
        primary = self.manual_etf("901", 1, payload_changes={"detail_status": "stockanalysis_partial"})
        fallback = self.bound_yahoo_etf()
        active = self.resolve_manual(primary, fallback)
        self.assertEqual(active["current"]["VYMI"]["provider"], "yahoo_finance")
        self.assertEqual(active["current"]["VYMI"]["source_as_of"], "2026-07-15T20:00:00Z")
        self.assertEqual(active["current"]["VYMI"]["payload_sha256"], fallback["payload_sha256"])
        self.assertEqual(active["recovery"]["VYMI"]["consecutive_green"], 0)
        self.assertEqual(active["current"]["VYMI"]["reason_code"], "primary_recovery_pending_fallback_valid")

    def test_selected_fallback_refresh_preserves_primary_count_and_replay_barrier(self):
        prior_fallback = self.seed_manual_fallback()
        self.resolve_manual(self.manual_etf("901", 1), prior_fallback)
        partial = self.manual_etf("902", 2, payload_changes={"detail_status": "stockanalysis_partial"})
        fallback = self.bound_yahoo_etf()
        active = self.resolve_manual(partial, fallback)
        recovery = active["recovery"]["VYMI"]
        self.assertEqual(recovery["consecutive_green"], 1)
        self.assertEqual(recovery["manual_run_ids"], ["901"])
        replay = self.resolve_manual(partial, fallback)
        self.assertEqual(replay["transaction_id"], active["transaction_id"])

    def test_selected_fallback_refresh_rejects_unbound_or_foreign_canonical_bytes(self):
        for fault in ("unbound", "foreign"):
            with self.subTest(fault=fault):
                self.seed_manual_fallback()
                partial = self.manual_etf("901", 1, payload_changes={"detail_status": "stockanalysis_partial"})
                fallback = self.bound_yahoo_etf()
                if fault == "unbound":
                    fallback.pop("etf_acquisition")
                    fallback["event_id"] = deterministic_event_id("observation", fallback)
                else:
                    (self.store.provider_truth_root / fallback["provider_path"]).write_text('{"ticker":"FOREIGN"}')
                active = self.resolve_manual(partial, fallback)
                self.assertEqual(active["current"]["VYMI"]["source_as_of"], "2026-07-14T00:00:00Z")
                self.assertEqual(active["recovery"]["VYMI"]["consecutive_green"], 0)

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

    def test_stale_or_dateless_partial_refresh_requires_proof_and_preserves_recovery(self):
        for kind in ("stale", "dateless"):
            with self.subTest(kind=kind):
                self.store = DataSupplyStateStore(self.root / kind)
                self.resolver = DataSupplyResolver(self.store)
                fallback = self.seed_manual_fallback()
                green = self.manual_etf("901", 1)
                self.resolve_manual(green, fallback)
                before = self.store.read_active_domain("etf_detail")["recovery"]["VYMI"]
                primary = self.nonfresh_partial_etf(kind)
                fallback = self.bound_yahoo_etf()
                active = self.resolve_manual(primary, fallback)
                self.assertEqual(active["current"]["VYMI"]["source_as_of"], fallback["source_as_of"])
                recovery = active["recovery"]["VYMI"]
                for field in ("consecutive_green", "last_primary_event_id", "manual_run_ids", "manual_green_count", "last_primary_source_as_of"):
                    self.assertEqual(recovery[field], before[field])
                self.assertEqual(self.resolve_manual(primary, fallback)["transaction_id"], active["transaction_id"])
                # A previously consumed primary run still cannot contribute after the refresh.
                replay = self.manual_etf("901", 4)
                self.assertEqual(self.resolve_manual(replay, fallback)["recovery"]["VYMI"]["consecutive_green"], 1)

    def test_stale_or_dateless_partial_rejects_local_rerun_unbound_and_foreign_refresh(self):
        for kind in ("stale", "dateless"):
            for fault in ("local", "attempt2", "unbound", "foreign"):
                with self.subTest(kind=kind, fault=fault):
                    self.store = DataSupplyStateStore(self.root / f"{kind}-{fault}")
                    self.resolver = DataSupplyResolver(self.store)
                    prior = self.seed_manual_fallback()
                    self.resolve_manual(self.manual_etf("901", 1), prior)
                    primary = self.nonfresh_partial_etf(kind)
                    fallback = self.bound_yahoo_etf()
                    if fault == "unbound":
                        fallback.pop("etf_acquisition")
                    elif fault == "local":
                        fallback["etf_acquisition"]["remote"] = False
                    elif fault == "attempt2":
                        fallback["etf_acquisition"]["run_attempt"] = 2
                    else:
                        (self.store.provider_truth_root / fallback["provider_path"]).write_text('{"ticker":"FOREIGN"}')
                    fallback["event_id"] = deterministic_event_id("observation", fallback)
                    active = self.resolve_manual(primary, fallback)
                    self.assertEqual(active["current"]["VYMI"]["payload_sha256"], prior["payload_sha256"])
                    self.assertEqual(active["recovery"]["VYMI"]["consecutive_green"], 1)
                    self.assertEqual(active["recovery"]["VYMI"]["manual_green_count"], 1)

    def test_bound_refresh_with_actual_primary_failure_resets_count_but_preserves_replay_ids(self):
        prior = self.seed_manual_fallback()
        self.resolve_manual(self.manual_etf("901", 1), prior)
        failed = self.publish(provider="stockanalysis", suffix="failed-refresh", status="invalid",
                              source_as_of=None, observed_at="2026-07-15T23:02:00Z")
        fallback = self.bound_yahoo_etf()
        active = self.resolve_manual(failed, fallback)
        self.assertEqual(active["current"]["VYMI"]["source_as_of"], fallback["source_as_of"])
        self.assertEqual(active["recovery"]["VYMI"]["consecutive_green"], 0)
        self.assertEqual(active["recovery"]["VYMI"]["manual_run_ids"], ["901"])

    def test_three_distinct_natural_partial_acquisitions_never_recover_primary(self):
        fallback = self.seed_manual_fallback()
        for count in (1, 2, 3):
            row = self.manual_etf(str(930 + count), count, payload_changes={"detail_status": "stockanalysis_partial"},
                                  proof_changes={"event_name": "schedule"})
            row["observation_origin"] = "natural"
            row.pop("collection_origin")
            row["event_id"] = deterministic_event_id("observation", row)
            active = self.resolve_manual(row, fallback)
            self.assertEqual(active["current"]["VYMI"]["provider"], "yahoo_finance")
            self.assertEqual(active["recovery"]["VYMI"]["consecutive_green"], 0)

    def test_three_distinct_bound_natural_complete_acquisitions_recover_primary(self):
        fallback = self.seed_manual_fallback()
        for count in (1, 2, 3):
            row = self.manual_etf(str(940 + count), count, proof_changes={"event_name": "schedule"})
            row["observation_origin"] = "natural"
            row.pop("collection_origin")
            row["event_id"] = deterministic_event_id("observation", row)
            active = self.resolve_manual(row, fallback)
            self.assertEqual(active["recovery"]["VYMI"]["consecutive_green"], count)
            self.assertEqual(active["current"]["VYMI"]["provider"], "stockanalysis" if count == 3 else "yahoo_finance")

    def test_migrated_initial_fallback_refresh_is_consumed_before_local_or_rerun_refresh(self):
        for fault in ("local", "attempt2"):
            with self.subTest(fault=fault):
                self.store = DataSupplyStateStore(self.root / f"migration-{fault}")
                self.resolver = DataSupplyResolver(self.store)
                row, raw = observation(provider="yahoo_finance", suffix="migration", source_as_of="2026-07-01T00:00:00Z",
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
                    recovery={"VYMI": {"consecutive_green": 0, "last_transition": "migration_lkg_fallback"}},
                    candidate_observations=[row], expected_active_transaction_id=active["transaction_id"],
                    transition="migration_lkg_fallback", reason_code="legacy_migration_fallback_lkg",
                    recovery_green_count=0, decided_at=row["observed_at"])
                self.store.commit_prepared("etf_detail", tx)
                first = self.publish(provider="yahoo_finance", suffix="migration-first", source_as_of="2026-07-14T00:00:00Z",
                                     observed_at="2026-07-15T22:00:00Z")
                failed = self.publish(provider="stockanalysis", suffix="migration-failed", status="invalid", source_as_of=None,
                                      observed_at="2026-07-15T22:00:00Z")
                active = self.resolve_manual(failed, first)
                self.assertEqual(active["current"]["VYMI"]["resolution_state"], "fresh_fallback")
                self.assertEqual(active["current"]["VYMI"]["payload_sha256"], first["payload_sha256"])
                self.assertEqual(active["recovery"]["VYMI"]["consecutive_green"], 0)
                self.assertNotEqual(active["current"]["VYMI"]["reason_code"], "legacy_migration_fallback_lkg")
                self.resolve_manual(self.manual_etf("901", 1), first)
                primary = self.nonfresh_partial_etf("dateless")
                fallback = self.bound_yahoo_etf()
                fallback["etf_acquisition"]["remote" if fault == "local" else "run_attempt"] = False if fault == "local" else 2
                fallback["event_id"] = deterministic_event_id("observation", fallback)
                active = self.resolve_manual(primary, fallback)
                self.assertEqual(active["current"]["VYMI"]["payload_sha256"], first["payload_sha256"])
                self.assertEqual(active["recovery"]["VYMI"]["consecutive_green"], 1)
                self.assertEqual(active["recovery"]["VYMI"]["manual_run_ids"], ["901"])

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
                    recovery={"VYMI": {"consecutive_green": 0, "last_transition": "migration_lkg_fallback"}},
                    candidate_observations=[row], expected_active_transaction_id=active["transaction_id"],
                    transition="migration_lkg_fallback", reason_code="legacy_migration_fallback_lkg",
                    recovery_green_count=0, decided_at=row["observed_at"])
                self.store.commit_prepared("etf_detail", tx)
                primary = self.manual_etf("950", 1, payload_changes={"detail_status": "stockanalysis_partial"} if partial else {},
                                          proof_changes={"event_name": "schedule"})
                primary["observation_origin"] = "natural"
                primary.pop("collection_origin")
                primary["event_id"] = deterministic_event_id("observation", primary)
                active = self.resolver.resolve_etf_detail(entity="VYMI", observations=[primary], decided_at="2026-07-15T23:59:00Z")
                self.assertEqual(active["current"]["VYMI"]["provider"], "yahoo_finance" if partial else "stockanalysis")
                self.assertEqual(active["recovery"]["VYMI"]["consecutive_green"], 0)
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
        self.assertEqual(active["recovery"]["VYMI"]["consecutive_green"], 0)
        self.assertEqual(active["lkg"]["VYMI"]["provider"], "stockanalysis")
        self.assertEqual(active["lkg"]["VYMI"]["payload_ref"]["kind"], "provider_lkg")

    def test_primary_recovery_requires_three_distinct_natural_observations(self):
        primary = self.publish(
            provider="stockanalysis",
            suffix="p0",
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
        self.resolver.resolve_etf_detail(
            entity="VYMI",
            observations=[primary_failure, fallback],
            decided_at="2026-07-10T02:00:02Z",
        )

        for count, hour in enumerate((3, 4), start=1):
            recovering = self.publish(
                provider="stockanalysis",
                suffix=f"p{count}",
                source_as_of=f"2026-07-10T0{hour}:00:00Z",
                observed_at=f"2026-07-10T0{hour}:00:00Z",
            )
            active = self.resolver.resolve_etf_detail(
                entity="VYMI",
                observations=[recovering, fallback],
                decided_at=f"2026-07-10T0{hour}:00:01Z",
            )
            self.assertEqual(active["current"]["VYMI"]["provider"], "yahoo_finance")
            self.assertEqual(active["recovery"]["VYMI"]["consecutive_green"], count)

        cached = self.publish(
            provider="stockanalysis",
            suffix="cached",
            source_as_of="2026-07-10T04:30:00Z",
            observed_at="2026-07-10T04:30:00Z",
            origin="cache",
        )
        active = self.resolver.resolve_etf_detail(
            entity="VYMI",
            observations=[cached, fallback],
            decided_at="2026-07-10T04:30:01Z",
        )
        self.assertEqual(active["recovery"]["VYMI"]["consecutive_green"], 2)

        third = self.publish(
            provider="stockanalysis",
            suffix="p3",
            source_as_of="2026-07-10T05:00:00Z",
            observed_at="2026-07-10T05:00:00Z",
        )
        active = self.resolver.resolve_etf_detail(
            entity="VYMI",
            observations=[third, fallback],
            decided_at="2026-07-10T05:00:01Z",
        )
        self.assertEqual(active["current"]["VYMI"]["provider"], "stockanalysis")
        self.assertEqual(active["recovery"]["VYMI"]["consecutive_green"], 3)

    def test_invalid_primary_resets_recovery_sequence_to_zero(self):
        primary = self.publish(
            provider="stockanalysis",
            suffix="p0",
            source_as_of="2026-07-10T00:00:00Z",
            observed_at="2026-07-10T01:00:00Z",
        )
        self.resolver.resolve_etf_detail(entity="VYMI", observations=[primary], decided_at="2026-07-10T01:00:01Z")
        fallback = self.publish(
            provider="yahoo_finance",
            suffix="f1",
            source_as_of="2026-07-10T02:00:00Z",
            observed_at="2026-07-10T02:00:01Z",
        )
        failure = self.publish(
            provider="stockanalysis",
            suffix="fail0",
            source_as_of="2026-07-10T02:00:00Z",
            observed_at="2026-07-10T02:00:00Z",
            status="invalid",
        )
        self.resolver.resolve_etf_detail(
            entity="VYMI", observations=[failure, fallback], decided_at="2026-07-10T02:00:02Z"
        )
        for index, hour in enumerate((3, 4), start=1):
            recovering = self.publish(
                provider="stockanalysis",
                suffix=f"recover{index}",
                source_as_of=f"2026-07-10T0{hour}:00:00Z",
                observed_at=f"2026-07-10T0{hour}:00:00Z",
            )
            active = self.resolver.resolve_etf_detail(
                entity="VYMI",
                observations=[recovering, fallback],
                decided_at=f"2026-07-10T0{hour}:00:01Z",
            )
        self.assertEqual(active["recovery"]["VYMI"]["consecutive_green"], 2)
        reset = self.publish(
            provider="stockanalysis",
            suffix="fail1",
            source_as_of="2026-07-10T05:00:00Z",
            observed_at="2026-07-10T05:00:00Z",
            status="invalid",
        )
        active = self.resolver.resolve_etf_detail(
            entity="VYMI",
            observations=[reset, fallback],
            decided_at="2026-07-10T05:00:01Z",
        )
        self.assertEqual(active["current"]["VYMI"]["provider"], "yahoo_finance")
        self.assertEqual(active["recovery"]["VYMI"]["consecutive_green"], 0)

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
        self.assertEqual(active["current"]["VYMI"]["payload_ref"]["kind"], "provider_lkg")

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

    def test_stock_detail_fallback_to_primary_three_natural(self):
        fallback = self.publish_stock(
            provider="yahoo_finance", suffix="f1", source_as_of="2026-07-10T00:00:00Z",
            observed_at="2026-07-10T01:00:00Z",
        )
        self.resolve_stock([fallback], "2026-07-10T01:00:01Z")
        for hour in (2, 3, 4):
            primary = self.publish_stock(
                provider="stockanalysis", suffix=f"p{hour}",
                source_as_of=f"2026-07-10T0{hour}:00:00Z",
                observed_at=f"2026-07-10T0{hour}:00:00Z",
            )
            active = self.resolve_stock([primary, fallback], f"2026-07-10T0{hour}:00:01Z")
        self.assertEqual(active["current"]["AAPL"]["provider"], "stockanalysis")
        self.assertEqual(active["recovery"]["AAPL"]["consecutive_green"], 3)

    def test_stock_detail_non_natural_recovery_ignored(self):
        fallback = self.publish_stock(
            provider="yahoo_finance", suffix="f1", source_as_of="2026-07-10T00:00:00Z",
            observed_at="2026-07-10T01:00:00Z",
        )
        self.resolve_stock([fallback], "2026-07-10T01:00:01Z")
        cached = self.publish_stock(
            provider="stockanalysis", suffix="cached", source_as_of="2026-07-10T02:00:00Z",
            observed_at="2026-07-10T02:00:00Z", origin="cache",
        )
        active = self.resolve_stock([cached, fallback], "2026-07-10T02:00:01Z")
        self.assertEqual(active["current"]["AAPL"]["provider"], "yahoo_finance")
        self.assertEqual(active["recovery"]["AAPL"]["consecutive_green"], 0)

    def test_stock_detail_invalid_recovery_reset(self):
        fallback = self.publish_stock(
            provider="yahoo_finance", suffix="f1", source_as_of="2026-07-10T00:00:00Z",
            observed_at="2026-07-10T01:00:00Z",
        )
        self.resolve_stock([fallback], "2026-07-10T01:00:01Z")
        for hour in (2, 3):
            primary = self.publish_stock(
                provider="stockanalysis", suffix=f"p{hour}", source_as_of=f"2026-07-10T0{hour}:00:00Z",
                observed_at=f"2026-07-10T0{hour}:00:00Z",
            )
            self.resolve_stock([primary, fallback], f"2026-07-10T0{hour}:00:01Z")
        invalid = self.publish_stock(
            provider="stockanalysis", suffix="pf", source_as_of="2026-07-10T04:00:00Z",
            observed_at="2026-07-10T04:00:00Z", status="invalid",
        )
        active = self.resolve_stock([invalid, fallback], "2026-07-10T04:00:01Z")
        self.assertEqual(active["recovery"]["AAPL"]["consecutive_green"], 0)

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
