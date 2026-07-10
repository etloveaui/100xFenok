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
):
    payload = {"ticker": "VYMI", "suffix": suffix}
    row = {
        "schema_version": "data-supply-observation/v1",
        "provider": provider,
        "endpoint_family": (
            "stockanalysis_etf_detail" if provider == "stockanalysis" else "yahoo_finance_etf_detail"
        ),
        "domain": "etf_detail",
        "entity": "VYMI",
        "provider_path": (
            f"data/stockanalysis/etfs/VYMI-{suffix}.json"
            if provider == "stockanalysis"
            else f"data/yf/etf-details/VYMI-{suffix}.json"
        ),
        "payload_sha256": canonical_sha256(payload),
        "provider_schema": "stockanalysis/v1" if provider == "stockanalysis" else "yf-etf-detail/v1",
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


if __name__ == "__main__":
    unittest.main()
