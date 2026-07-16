import hashlib
import sys
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from data_supply_state import DataSupplyStateStore
from data_supply_stock_detail import (
    FROZEN_STOCK_DETAIL_TICKERS,
    FROZEN_TICKER_SHA256,
    StockDetailValidationError,
    is_enrolled_stock_detail,
    record_stock_detail_failure,
    record_stock_detail_success,
    validate_stock_detail_candidate,
    yahoo_provider_symbol,
)


FIXTURES = SCRIPT_DIR / "fixtures" / "data_supply" / "stock_detail"
OBSERVED_AT = "2026-07-10T11:00:00Z"


class StockDetailValidationTests(unittest.TestCase):
    def fixture(self, name):
        return (FIXTURES / name).read_bytes()

    def validate(self, provider, entity, fixture, **kwargs):
        provider_path = (
            f"data/stockanalysis/stocks/{entity}.json"
            if provider == "stockanalysis"
            else f"data/yf/finance/{entity}.json"
        )
        return validate_stock_detail_candidate(
            provider=provider,
            entity=entity,
            provider_path=provider_path,
            payload_bytes=self.fixture(fixture),
            observed_at=OBSERVED_AT,
            **kwargs,
        )

    def test_frozen_49_digest_and_yahoo_only_exclusion(self):
        self.assertEqual(len(FROZEN_STOCK_DETAIL_TICKERS), 49)
        self.assertEqual(FROZEN_TICKER_SHA256, "da4e5ec74ea0d741d529a627f2ea2f5507213787c5fa5395081e17566544e09f")
        self.assertTrue(is_enrolled_stock_detail("BRK.A"))
        self.assertFalse(is_enrolled_stock_detail("SPY"))

    def test_stockanalysis_valid_preserves_exact_bytes(self):
        candidate = self.validate("stockanalysis", "BRK.A", "stockanalysis_valid.fixture.json")
        self.assertEqual(candidate.payload_bytes, self.fixture("stockanalysis_valid.fixture.json"))
        self.assertEqual(candidate.payload_sha256, hashlib.sha256(candidate.payload_bytes).hexdigest())
        self.assertEqual(candidate.source_as_of, "2026-07-10T00:00:00Z")

    def test_yahoo_valid_preserves_exact_bytes(self):
        candidate = self.validate("yahoo_finance", "BRK.A", "yahoo_equity_valid.fixture.json")
        self.assertEqual(candidate.payload_bytes, self.fixture("yahoo_equity_valid.fixture.json"))
        self.assertEqual(candidate.provider_schema, "yf-finance/v2")

    def test_yahoo_class_share_provider_aliases_are_valid(self):
        for entity, fixture in (
            ("BRK.A", "yahoo_class_share_brk_a.fixture.json"),
            ("BRK.B", "yahoo_class_share_brk_b.fixture.json"),
        ):
            with self.subTest(entity=entity):
                candidate = self.validate("yahoo_finance", entity, fixture)
                self.assertEqual(candidate.entity, entity)

    def test_yahoo_provider_symbol_only_normalizes_single_letter_class_shares(self):
        self.assertEqual(yahoo_provider_symbol("BRK.A"), "BRK-A")
        self.assertEqual(yahoo_provider_symbol("BRK.B"), "BRK-B")
        self.assertEqual(yahoo_provider_symbol("005930.KS"), "005930.KS")
        self.assertEqual(yahoo_provider_symbol("BMW.DE"), "BMW.DE")

    def test_yahoo_true_quote_identity_mismatch_is_rejected(self):
        with self.assertRaises(StockDetailValidationError) as caught:
            self.validate("yahoo_finance", "BRK.A", "yahoo_quote_identity_mismatch.fixture.json")
        self.assertEqual(caught.exception.reason_code, "identity_mismatch")

    def test_schema_identity_and_non_equity_fail_closed(self):
        cases = (
            ("stockanalysis", "stockanalysis_schema_drift.fixture.json"),
            ("stockanalysis", "stockanalysis_identity_mismatch.fixture.json"),
            ("yahoo_finance", "yahoo_non_equity.fixture.json"),
            ("yahoo_finance", "yahoo_identity_mismatch.fixture.json"),
            ("yahoo_finance", "yahoo_malformed.fixture.json"),
        )
        for provider, fixture in cases:
            with self.subTest(fixture=fixture), self.assertRaises(StockDetailValidationError):
                self.validate(provider, "BRK.A", fixture)

    def test_duplicate_key_nonfinite_and_quote_group_fail_closed(self):
        base = self.fixture("yahoo_equity_valid.fixture.json")
        bad_rows = (
            base.replace(b'"ticker":"BRK.A"', b'"ticker":"BRK.A","ticker":"BRK.A"', 1),
            base.replace(b'"currentPrice":500.0', b'"currentPrice":NaN', 1),
            base.replace(b',"previousClose":495.0', b'', 1),
            base.replace(b'"currentPrice":500.0', b'"currentPrice":-1', 1),
            base.replace(b'{"date":"2026-07-10","Close":500.0}', b'{}', 1),
        )
        for payload in bad_rows:
            with self.subTest(payload=payload[:40]), self.assertRaises(StockDetailValidationError):
                validate_stock_detail_candidate(
                    provider="yahoo_finance", entity="BRK.A",
                    provider_path="data/yf/finance/BRK.A.json",
                    payload_bytes=payload, observed_at=OBSERVED_AT,
                )

    def test_naive_future_and_expected_digest_corruption_fail_closed(self):
        base = self.fixture("stockanalysis_valid.fixture.json")
        cases = (
            (base.replace(b'"t":"2026-07-10"', b'"t":"not-a-date"'), None),
            (base.replace(b'"t":"2026-07-10"', b'"t":"2026-07-11"'), None),
            (base, "0" * 64),
        )
        for payload, digest in cases:
            with self.subTest(digest=digest), self.assertRaises(StockDetailValidationError):
                validate_stock_detail_candidate(
                    provider="stockanalysis", entity="BRK.A",
                    provider_path="data/stockanalysis/stocks/BRK.A.json",
                    payload_bytes=payload, observed_at=OBSERVED_AT,
                    expected_sha256=digest,
                )

    def test_path_escape_cross_provider_and_symlink_fail_closed(self):
        payload = self.fixture("stockanalysis_valid.fixture.json")
        for path in ("../BRK.A.json", "data/yf/finance/BRK.A.json"):
            with self.subTest(path=path), self.assertRaises(StockDetailValidationError):
                validate_stock_detail_candidate(
                    provider="stockanalysis", entity="BRK.A", provider_path=path,
                    payload_bytes=payload, observed_at=OBSERVED_AT,
                )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "real"
            target.mkdir()
            link = root / "data"
            link.symlink_to(target, target_is_directory=True)
            with self.assertRaises(StockDetailValidationError):
                validate_stock_detail_candidate(
                    provider="stockanalysis", entity="BRK.A",
                    provider_path="data/stockanalysis/stocks/BRK.A.json",
                    payload_bytes=payload, observed_at=OBSERVED_AT,
                    provider_truth_root=root,
                )

    def test_success_writes_exact_object_and_idempotent_observation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            store = DataSupplyStateStore(root / "state", provider_truth_root=root)
            candidate = self.validate("stockanalysis", "BRK.A", "stockanalysis_valid.fixture.json")
            row = record_stock_detail_success(store=store, candidate=candidate, observed_at=OBSERVED_AT)
            again = record_stock_detail_success(store=store, candidate=candidate, observed_at=OBSERVED_AT)
            object_path = root / "state" / "providers" / "stockanalysis" / "stock_detail" / "objects" / "BRK.A" / f"{candidate.payload_sha256}.json"
            self.assertEqual(object_path.read_bytes(), candidate.payload_bytes)
            self.assertEqual(row["event_id"], again["event_id"])
            self.assertEqual(row["observation_origin"], "rebuild")
            self.assertEqual(row["collection_origin"], "manual")

    def test_ungated_natural_origin_is_rejected_before_state_write(self):
        candidate = self.validate("stockanalysis", "BRK.A", "stockanalysis_valid.fixture.json")
        with tempfile.TemporaryDirectory() as tmp:
            store = DataSupplyStateStore(Path(tmp) / "state")
            with self.assertRaises(StockDetailValidationError):
                record_stock_detail_success(
                    store=store,
                    candidate=candidate,
                    observed_at=OBSERVED_AT,
                    origin="natural",
                )
            self.assertFalse((Path(tmp) / "state" / "providers").exists())

    def test_manual_origin_is_non_natural_without_shared_core_change(self):
        candidate = self.validate("yahoo_finance", "BRK.A", "yahoo_equity_valid.fixture.json")
        with tempfile.TemporaryDirectory() as tmp:
            store = DataSupplyStateStore(Path(tmp) / "state")
            row = record_stock_detail_success(store=store, candidate=candidate, observed_at=OBSERVED_AT, origin="manual")
            self.assertNotEqual(row["observation_origin"], "natural")
            self.assertEqual(row["collection_origin"], "manual")

    def test_forged_candidate_metadata_is_revalidated_at_persistence_boundary(self):
        candidate = self.validate("yahoo_finance", "BRK.A", "yahoo_equity_valid.fixture.json")
        forged = replace(candidate, endpoint_family="stockanalysis_stock_detail")
        with tempfile.TemporaryDirectory() as tmp:
            store = DataSupplyStateStore(Path(tmp) / "state")
            with self.assertRaises(StockDetailValidationError):
                record_stock_detail_success(
                    store=store,
                    candidate=forged,
                    observed_at=OBSERVED_AT,
                    origin="manual",
                )
            self.assertFalse((Path(tmp) / "state" / "providers").exists())

    def test_invalid_evidence_changes_no_domain_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = DataSupplyStateStore(Path(tmp) / "state")
            before = store.read_active_domain("stock_detail")
            row = record_stock_detail_failure(
                store=store, provider="stockanalysis", entity="BRK.A",
                provider_path="data/stockanalysis/stocks/BRK.A.json",
                observed_at=OBSERVED_AT, reason_code="schema_invalid",
                failure_detail="fixture failure", origin="manual",
            )
            self.assertEqual(store.read_active_domain("stock_detail"), before)
            self.assertEqual(row["validation_status"], "invalid")
            self.assertIsNone(row["source_as_of"])
            self.assertEqual(row["reason_code"], "schema_invalid")
            self.assertFalse((Path(tmp) / "state" / "providers").exists())


if __name__ == "__main__":
    unittest.main()
