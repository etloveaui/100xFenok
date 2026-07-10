import tempfile
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
