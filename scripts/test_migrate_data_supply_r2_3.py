import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from data_supply_state import DataSupplyStateStore, IntegrityError, SchemaError
from migrate_data_supply_r2_3 import LegacyYahooMigration


class LegacyYahooMigrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name)
        self.state = self.repo / "data/admin/data-supply-state/v1"
        (self.repo / "data/stockanalysis/etfs").mkdir(parents=True)
        (self.repo / "data/yf/finance").mkdir(parents=True)

    def tearDown(self):
        self.tmp.cleanup()

    def write_legacy(
        self,
        ticker="GOOD",
        *,
        raw_ticker=None,
        fetched_at="2026-07-10T00:00:00Z",
        source_as_of="2026-07-10T00:00:00Z",
        minimum_detail=True,
    ):
        legacy = {
            "schema_version": "stockanalysis/v1",
            "source": "yahoo_finance",
            "source_provider": "yahoo_finance",
            "detail_status": "yf_fallback",
            "asset_type": "etf",
            "ticker": ticker,
            "fetched_at": fetched_at,
            "normalized": {"quote": {"p": 10.0}},
        }
        raw = {
            "schema_version": "yf-finance/v2",
            "ticker": raw_ticker or ticker,
            "fetched_at": fetched_at,
            "profile": "etf",
            "source": "yahoo_finance",
            "data": {
                "info": (
                    {"quoteType": "ETF", "currentPrice": 10.0}
                    if minimum_detail
                    else {"quoteType": "MUTUALFUND"}
                ),
                "funds_data": {"top_holdings": []} if minimum_detail else None,
                "history_1y": (
                    [{"date": source_as_of[:10], "Close": 10.0}]
                    if minimum_detail and source_as_of
                    else None
                ),
            },
        }
        legacy_path = self.repo / f"data/stockanalysis/etfs/{ticker}.json"
        raw_path = self.repo / f"data/yf/finance/{ticker}.json"
        legacy_path.write_text(json.dumps(legacy, indent=2) + "\n", encoding="utf-8")
        raw_path.write_text(json.dumps(raw, indent=2) + "\n", encoding="utf-8")
        return legacy_path, raw_path

    def test_manifest_proves_identity_and_apply_deletes_only_matching_contamination(self):
        legacy_path, raw_path = self.write_legacy()
        primary_path = self.repo / "data/stockanalysis/etfs/TRUE.json"
        primary_bytes = b'{"source":"stockanalysis","ticker":"TRUE"}\n'
        primary_path.write_bytes(primary_bytes)
        migration = LegacyYahooMigration(self.repo, self.state)

        manifest = migration.plan(expected_count=1, created_at="2026-07-11T00:00:00Z")
        self.assertEqual(manifest["entries"][0]["identity_proof"], "legacy_wrapper_filename_manifest")
        self.assertEqual(manifest["entries"][0]["entity"], "GOOD")
        self.assertEqual(len(manifest["payload_refs"]), 1)

        result = migration.apply(
            manifest,
            decided_at="2026-07-11T00:00:00Z",
            delete_legacy=True,
        )

        self.assertEqual(result["migrated"], 1)
        self.assertEqual(result["deleted_legacy"], 1)
        self.assertFalse(legacy_path.exists())
        self.assertTrue(raw_path.exists())
        self.assertEqual(primary_path.read_bytes(), primary_bytes)
        normalized = self.repo / "data/yf/etf-details/GOOD.json"
        self.assertTrue(normalized.exists())
        active = DataSupplyStateStore(self.state).read_active_domain("etf_detail")
        self.assertEqual(active["current"]["GOOD"]["provider"], "yahoo_finance")
        self.assertEqual(active["current"]["GOOD"]["resolution_state"], "fresh_fallback")
        self.assertEqual(DataSupplyStateStore(self.state).read_resolved_payload("etf_detail", "GOOD")["ticker"], "GOOD")
        self.assertFalse((self.state / "domains/etf_detail/migration.json").exists())

    def test_identity_disagreement_blocks_plan_before_any_state_write(self):
        self.write_legacy(raw_ticker="WRONG")
        migration = LegacyYahooMigration(self.repo, self.state)
        with self.assertRaises(SchemaError):
            migration.plan(expected_count=1, created_at="2026-07-11T00:00:00Z")
        self.assertFalse(self.state.exists())

    def test_source_tamper_after_plan_blocks_apply_and_deletes_nothing(self):
        legacy_path, _ = self.write_legacy()
        migration = LegacyYahooMigration(self.repo, self.state)
        manifest = migration.plan(expected_count=1, created_at="2026-07-11T00:00:00Z")
        legacy_path.write_text('{"tampered":true}\n', encoding="utf-8")
        with self.assertRaises(IntegrityError):
            migration.apply(manifest, decided_at="2026-07-11T00:00:00Z", delete_legacy=True)
        self.assertTrue(legacy_path.exists())
        self.assertFalse((self.repo / "data/yf/etf-details/GOOD.json").exists())

    def test_expired_candidate_materializes_verified_unavailable_state_with_deletion_held(self):
        legacy_path, _ = self.write_legacy(
            fetched_at="2026-07-11T00:00:00Z",
            source_as_of="2026-06-18T00:00:00Z",
        )
        migration = LegacyYahooMigration(self.repo, self.state)
        manifest = migration.plan(expected_count=1, created_at="2026-07-11T00:00:00Z")
        result = migration.apply(
            manifest,
            decided_at="2026-07-11T00:00:00Z",
            delete_legacy=False,
        )
        self.assertTrue(result["deletion_held"])
        self.assertEqual(result["states"]["unavailable"], 1)
        self.assertTrue(legacy_path.exists())
        self.assertTrue((self.state / "domains/etf_detail/migration.json").exists())
        active = DataSupplyStateStore(self.state).read_active_domain("etf_detail")
        self.assertNotIn("GOOD", active["current"])
        self.assertEqual(active["recovery"]["GOOD"]["last_transition"], "unavailable")
        object_path = self.state / manifest["entries"][0]["provider_object_path"]
        self.assertTrue(object_path.exists())
        self.assertEqual(list((self.state / "providers/yahoo_finance/etf_detail/pending").glob("*.json")), [])

    def test_lkg_candidate_clears_consumed_pending_pointer(self):
        self.write_legacy(
            fetched_at="2026-07-11T00:00:00Z",
            source_as_of="2026-07-01T00:00:00Z",
        )
        migration = LegacyYahooMigration(self.repo, self.state)
        manifest = migration.plan(expected_count=1, created_at="2026-07-11T00:00:00Z")
        result = migration.apply(manifest, decided_at="2026-07-11T00:00:00Z", delete_legacy=False)
        self.assertEqual(result["states"]["lkg_fallback"], 1)
        active = DataSupplyStateStore(self.state).read_active_domain("etf_detail")
        self.assertEqual(active["current"]["GOOD"]["resolution_state"], "lkg_fallback")
        self.assertEqual(list((self.state / "providers/yahoo_finance/etf_detail/pending").glob("*.json")), [])

    def test_minimum_detail_exception_is_invalid_unavailable_without_provider_object(self):
        legacy_path, raw_path = self.write_legacy(
            ticker="GLX",
            fetched_at="2026-07-11T00:00:00Z",
            source_as_of="2026-06-30T00:00:00Z",
            minimum_detail=False,
        )
        migration = LegacyYahooMigration(self.repo, self.state)
        manifest = migration.plan(expected_count=1, created_at="2026-07-11T00:00:00Z")
        entry = manifest["entries"][0]
        self.assertEqual(entry["migration_action"], "invalid_unavailable")
        self.assertEqual(entry["reason_code"], "migration_minimum_detail_missing")
        self.assertEqual(manifest["payload_refs"], [])
        result = migration.apply(manifest, decided_at="2026-07-11T00:00:00Z", delete_legacy=False)
        self.assertTrue(result["deletion_held"])
        self.assertTrue(legacy_path.exists())
        self.assertTrue(raw_path.exists())
        evidence = self.repo / entry["evidence_path"]
        self.assertEqual(evidence.read_bytes(), legacy_path.read_bytes())
        active = DataSupplyStateStore(self.state).read_active_domain("etf_detail")
        self.assertNotIn("GLX", active["current"])
        self.assertEqual(active["recovery"]["GLX"]["last_transition"], "unavailable")
        object_root = self.state / "providers/yahoo_finance/etf_detail/objects/GLX"
        self.assertFalse(object_root.exists())

    def test_missing_provider_source_date_is_invalid_unavailable_not_a_plan_abort(self):
        legacy_path, raw_path = self.write_legacy(
            ticker="NODATE",
            fetched_at="2026-07-11T00:00:00Z",
            source_as_of=None,
            minimum_detail=True,
        )
        migration = LegacyYahooMigration(self.repo, self.state)
        manifest = migration.plan(expected_count=1, created_at="2026-07-11T00:00:00Z")
        entry = manifest["entries"][0]
        self.assertEqual(entry["migration_action"], "invalid_unavailable")
        self.assertEqual(entry["reason_code"], "migration_source_date_unavailable")
        self.assertEqual(manifest["payload_refs"], [])

        result = migration.apply(
            manifest,
            decided_at="2026-07-11T00:00:00Z",
            delete_legacy=False,
        )
        self.assertTrue(result["deletion_held"])
        self.assertTrue(legacy_path.exists())
        self.assertTrue(raw_path.exists())
        active = DataSupplyStateStore(self.state).read_active_domain("etf_detail")
        self.assertNotIn("NODATE", active["current"])
        self.assertEqual(active["recovery"]["NODATE"]["last_transition"], "unavailable")
        self.assertFalse((self.state / "providers/yahoo_finance/etf_detail/objects/NODATE").exists())


if __name__ == "__main__":
    unittest.main()
