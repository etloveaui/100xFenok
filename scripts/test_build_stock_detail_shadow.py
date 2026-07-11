import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from build_stock_detail_shadow import ShadowBuildError, StockDetailShadowBuilder
from data_supply_state import DataSupplyStateStore
from migrate_data_supply_stock_detail import StockDetailMigration
from test_migrate_data_supply_stock_detail import (
    DECIDED_AT,
    EMPTY_SHA256,
    InjectedCrash,
    canonical_bytes,
    canonical_sha,
    pair_records,
    write_json,
    write_pair,
    write_protected_index,
)


def file_tree_digest(root):
    rows = []
    for path in sorted(root.rglob("*")):
        if path.is_file() and not path.is_symlink():
            rows.append(
                {
                    "path": path.relative_to(root).as_posix(),
                    "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                }
            )
    return canonical_sha(rows)


def market_fact(ticker, *, both=True, price=100.0):
    return {
        "schema_version": "market-facts/v1",
        "ticker": ticker,
        "asset_type": "stock",
        "generated_at": "2026-07-10T13:48:28Z",
        "identity": {"name": ticker},
        "facts": {
            "price": {
                "value": price,
                "source": "yf",
                "as_of": None,
                "fetched_at": "2026-07-10T00:00:00Z",
            },
            "change": {
                "value": 1.0,
                "source": "stockanalysis.quote",
                "as_of": None,
                "fetched_at": "2026-07-10T00:00:00Z",
            },
        },
        "sources": {
            "yf": True,
            "stockanalysis": both,
            "stockanalysis_yf_fallback": False,
            "stockanalysis_etf_catalog": False,
            "slickcharts": False,
        },
        "source_files": {
            "yf": f"yf/finance/{ticker}.json",
            "stockanalysis": f"stockanalysis/stocks/{ticker}.json" if both else None,
        },
        "resolver": {
            "version": "market-facts-resolver/v1",
            "field_source_policy": {
                "price": ["yf", "stockanalysis.quote"],
                "change": ["stockanalysis.quote", "yf"],
            },
        },
    }


def write_market_facts(repo, tickers, *, yahoo_only=3):
    root = repo / "data/computed/market_facts"
    rows = []
    for ticker in tickers:
        payload = market_fact(ticker, both=True)
        write_json(root / "tickers" / f"{ticker}.json", payload)
        rows.append(
            {
                "ticker": ticker,
                "asset_type": "stock",
                "sources": payload["sources"],
                "fact_count": len(payload["facts"]),
            }
        )
    for index in range(yahoo_only):
        ticker = f"Y{index:04d}"
        payload = market_fact(ticker, both=False)
        write_json(root / "tickers" / f"{ticker}.json", payload)
        rows.append(
            {
                "ticker": ticker,
                "asset_type": "stock",
                "sources": payload["sources"],
                "fact_count": len(payload["facts"]),
            }
        )
    write_json(
        root / "index.json",
        {
            "schema_version": "market-facts/v1",
            "generated_at": "2026-07-10T13:48:28Z",
            "count": len(rows),
            "coverage": {
                "stock": len(rows),
                "yf": len(rows),
                "stockanalysis": len(tickers),
                "stockanalysis_yf_fallback": 0,
            },
            "rows": sorted(rows, key=lambda row: row["ticker"]),
            "resolver": {
                "version": "market-facts-resolver/v1",
                "field_source_policy": {
                    "price": ["yf", "stockanalysis.quote"],
                    "change": ["stockanalysis.quote", "yf"],
                },
            },
        },
    )
    return root


class StockDetailShadowBuilderTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name)
        self.state = self.repo / "data/admin/data-supply-state/v1"
        self.tickers = ("AAPL", "ABBV", "AMAT", "AMD")
        write_protected_index(self.repo)
        write_pair(self.repo, "AAPL", price=10.0)
        write_pair(
            self.repo,
            "ABBV",
            sa_fetched_at="2026-07-01T00:00:00Z",
            yf_fetched_at="2026-07-10T00:00:00Z",
            price=20.0,
        )
        write_pair(
            self.repo,
            "AMAT",
            sa_fetched_at="2026-07-01T00:00:00Z",
            yf_fetched_at="2026-07-01T00:00:00Z",
            price=30.0,
        )
        write_pair(
            self.repo,
            "AMD",
            sa_fetched_at="2026-06-20T00:00:00Z",
            yf_fetched_at="2026-06-20T00:00:00Z",
            price=40.0,
        )
        self.market = write_market_facts(self.repo, self.tickers, yahoo_only=3)
        migration = StockDetailMigration(
            self.repo,
            self.state,
            tickers=self.tickers,
            enforce_approved_digests=False,
        )
        manifest = migration.plan(
            expected_count=4,
            expected_ticker_sha256=canonical_sha(sorted(self.tickers)),
            expected_pair_sha256=canonical_sha(pair_records(self.repo, self.tickers)),
            expected_delete_sha256=EMPTY_SHA256,
            created_at=DECIDED_AT,
        )
        migration.apply(manifest, decided_at=DECIDED_AT, no_delete=True)

    def tearDown(self):
        self.tmp.cleanup()

    def builder(self, *, failpoint_hook=None):
        return StockDetailShadowBuilder(
            repo_root=self.repo,
            state_root=self.state,
            market_facts_root=self.market,
            tickers=self.tickers,
            failpoint_hook=failpoint_hook,
        )

    def output_paths(self):
        root = self.state / "domains/stock_detail"
        return root / "market_facts_shadow.json", root / "coverage.json"

    def test_exact_partitions_and_yahoo_only_exclusion(self):
        shadow, coverage = self.builder().build(expected_count=4)
        self.assertEqual(sorted(shadow["entries"]), sorted(self.tickers))
        self.assertEqual(coverage["partitions"]["dual_source_enrolled"], 4)
        self.assertEqual(coverage["partitions"]["yahoo_only_legacy_excluded"], 3)
        self.assertEqual(
            coverage["resolution_state_counts"],
            {
                "fresh_primary": 1,
                "fresh_fallback": 1,
                "lkg_primary": 1,
                "lkg_fallback": 0,
                "unavailable": 1,
            },
        )
        self.assertEqual(coverage["diagnostics"]["fallback"], 1)
        self.assertEqual(coverage["diagnostics"]["lkg"], 1)
        self.assertEqual(coverage["diagnostics"]["unavailable"], 1)
        self.assertTrue(coverage["shadow_only"])

    def test_provider_atomic_field_comparison_exposes_mixing(self):
        shadow, _ = self.builder().build(expected_count=4)
        aapl = shadow["entries"]["AAPL"]
        self.assertEqual(aapl["selected_provider"], "stockanalysis")
        self.assertEqual(aapl["field_diagnostics"]["price"]["status"], "different")
        self.assertEqual(aapl["field_diagnostics"]["change"]["status"], "match")
        self.assertNotIn("selected_values", shadow)

    def test_market_index_and_ticker_sources_must_match(self):
        path = self.market / "tickers/AAPL.json"
        payload = json.loads(path.read_text())
        payload["sources"]["stockanalysis"] = False
        write_json(path, payload)
        with self.assertRaises(ShadowBuildError):
            self.builder().build(expected_count=4)

    def test_transient_market_fact_aba_is_rejected(self):
        path = self.market / "tickers/AAPL.json"

        class TransientBuilder(StockDetailShadowBuilder):
            changed = False

            def _current_market_fact(inner_self, ticker):
                if ticker != "AAPL" or inner_self.changed:
                    return super()._current_market_fact(ticker)
                inner_self.changed = True
                original = path.read_bytes()
                payload = json.loads(original)
                payload["facts"]["price"]["value"] = 999.0
                write_json(path, payload)
                try:
                    return super()._current_market_fact(ticker)
                finally:
                    path.write_bytes(original)

        builder = TransientBuilder(
            repo_root=self.repo,
            state_root=self.state,
            market_facts_root=self.market,
            tickers=self.tickers,
        )
        with self.assertRaises(ShadowBuildError):
            builder.build(expected_count=4)

    def test_deterministic_rerun_byte_identity(self):
        output, coverage = self.output_paths()
        builder = self.builder()
        builder.write(expected_count=4, output=output, coverage_output=coverage)
        first = output.read_bytes(), coverage.read_bytes()
        builder.write(expected_count=4, output=output, coverage_output=coverage)
        self.assertEqual(first, (output.read_bytes(), coverage.read_bytes()))
        builder.validate_output_pair(output, coverage)

    def test_only_private_outputs_change(self):
        output, coverage = self.output_paths()
        market_before = file_tree_digest(self.market)
        protected = self.repo / "data/computed/data-supply/etf-detail/index.json"
        protected_before = protected.read_bytes()
        self.builder().write(expected_count=4, output=output, coverage_output=coverage)
        self.assertEqual(file_tree_digest(self.market), market_before)
        self.assertEqual(protected.read_bytes(), protected_before)
        self.assertTrue(output.is_file())
        self.assertTrue(coverage.is_file())
        self.assertFalse((self.repo / "100xfenok-next/public/data/admin/data-supply-state").exists())

    def test_active_change_aborts_before_output(self):
        output, coverage = self.output_paths()
        output.write_bytes(b"old-shadow")
        coverage.write_bytes(b"old-coverage")

        class MutateActive:
            fired = False

            def __call__(inner_self, point):
                if point == "before_active_recheck" and not inner_self.fired:
                    inner_self.fired = True
                    path = self.state / "domains/stock_detail/active.json"
                    payload = json.loads(path.read_text())
                    payload["transaction_id"] = "0" * 64
                    write_json(path, payload)

        with self.assertRaises(ShadowBuildError):
            self.builder(failpoint_hook=MutateActive()).write(
                expected_count=4,
                output=output,
                coverage_output=coverage,
            )
        self.assertEqual(output.read_bytes(), b"old-shadow")
        self.assertEqual(coverage.read_bytes(), b"old-coverage")

    def test_corrupt_or_symlink_selected_ref_preserves_prior_reports(self):
        for mode in ("corrupt", "symlink"):
            with self.subTest(mode=mode):
                output, coverage = self.output_paths()
                output.write_bytes(b"old-shadow")
                coverage.write_bytes(b"old-coverage")
                active = json.loads((self.state / "domains/stock_detail/active.json").read_text())
                generation = self.state / f"domains/stock_detail/generations/{active['transaction_id']}/current.json"
                current = json.loads(generation.read_text())
                selected_path = self.state / current["AAPL"]["payload_ref"]["path"]
                original = selected_path.read_bytes()
                if mode == "corrupt":
                    selected_path.write_bytes(b"{}")
                else:
                    outside = self.repo / "outside.json"
                    outside.write_bytes(original)
                    selected_path.unlink()
                    selected_path.symlink_to(outside)
                with self.assertRaises(ShadowBuildError):
                    self.builder().write(expected_count=4, output=output, coverage_output=coverage)
                self.assertEqual(output.read_bytes(), b"old-shadow")
                self.assertEqual(coverage.read_bytes(), b"old-coverage")
                if selected_path.is_symlink():
                    selected_path.unlink()
                selected_path.write_bytes(original)

    def test_semantic_migration_pin_corruption_preserves_prior_reports(self):
        output, coverage = self.output_paths()
        output.write_bytes(b"old-shadow")
        coverage.write_bytes(b"old-coverage")
        pin = self.state / "domains/stock_detail/migration.json"
        original = pin.read_bytes()
        payload = json.loads(original)
        payload["migration_id"] = "0" * 64
        write_json(pin, payload)
        with self.assertRaises(ShadowBuildError):
            self.builder().write(expected_count=4, output=output, coverage_output=coverage)
        self.assertEqual(output.read_bytes(), b"old-shadow")
        self.assertEqual(coverage.read_bytes(), b"old-coverage")
        pin.write_bytes(original)

    def test_corrupt_lkg_latest_blocks_shadow(self):
        path = self.state / "providers/stockanalysis/stock_detail/lkg/AMAT/latest.json"
        payload = json.loads(path.read_text())
        payload["path"] = "providers/stockanalysis/stock_detail/lkg/AMAT/objects/" + "0" * 64 + ".json"
        write_json(path, payload)
        with self.assertRaises(ShadowBuildError):
            self.builder().build(expected_count=4)

    def test_canonical_market_root_symlink_is_rejected(self):
        outside = self.repo / "outside-market-facts"
        self.market.rename(outside)
        self.market.symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ShadowBuildError):
            self.builder()

    def test_resolved_ancestor_alias_is_accepted(self):
        alias = self.repo / "repo-parent-alias"
        alias.symlink_to(self.repo.parent, target_is_directory=True)
        alias_repo = alias / self.repo.name
        try:
            builder = StockDetailShadowBuilder(
                repo_root=alias_repo,
                state_root=alias_repo / "data/admin/data-supply-state/v1",
                market_facts_root=alias_repo / "data/computed/market_facts",
                tickers=self.tickers,
            )
            shadow, coverage = builder.build(expected_count=4)
            self.assertEqual(shadow["entry_count"], 4)
            self.assertEqual(coverage["partitions"]["dual_source_enrolled"], 4)
        finally:
            if alias.is_symlink():
                alias.unlink()

    def test_nested_state_domain_symlink_is_rejected(self):
        domain = self.state / "domains/stock_detail"
        relocated = self.state / "relocated-stock-detail"
        domain.rename(relocated)
        domain.symlink_to(relocated, target_is_directory=True)
        with self.assertRaises(ShadowBuildError):
            self.builder().build(expected_count=4)

    def test_selected_provider_state_ref_semantics_are_enforced(self):
        builder = self.builder()
        store = DataSupplyStateStore(self.state, provider_truth_root=self.repo)
        selected = dict(store.read_active_domain("stock_detail")["current"]["AAPL"])
        selected["resolution_state"] = "fresh_fallback"
        with self.assertRaises(ShadowBuildError):
            builder._selected_payload(store, "AAPL", selected)

    def test_output_escape_and_market_overlap_are_rejected(self):
        output, coverage = self.output_paths()
        with self.assertRaises(ShadowBuildError):
            self.builder().write(
                expected_count=4,
                output=self.repo / "outside.json",
                coverage_output=coverage,
            )
        with self.assertRaises(ShadowBuildError):
            self.builder().write(
                expected_count=4,
                output=output,
                coverage_output=self.market / "coverage.json",
            )

    def test_invalid_second_output_target_preserves_first_output(self):
        output, coverage = self.output_paths()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(b"old-shadow")
        coverage.mkdir()
        with self.assertRaises(ShadowBuildError):
            self.builder().write(expected_count=4, output=output, coverage_output=coverage)
        self.assertEqual(output.read_bytes(), b"old-shadow")

    def test_active_rollback_aba_is_detected(self):
        store = DataSupplyStateStore(self.state, provider_truth_root=self.repo)
        active = store.read_active_domain("stock_detail")
        original = active["transaction_id"]
        target = active["retained_generation_ids"][1]

        class RollbackAba:
            fired = False

            def __call__(inner_self, point):
                if point != "before_active_recheck" or inner_self.fired:
                    return
                inner_self.fired = True
                store.rollback_domain(
                    "stock_detail",
                    target_transaction_id=target,
                    expected_active_transaction_id=original,
                    decided_at="2026-07-12T00:00:00Z",
                )
                middle = store.read_active_domain("stock_detail")["transaction_id"]
                store.rollback_domain(
                    "stock_detail",
                    target_transaction_id=original,
                    expected_active_transaction_id=middle,
                    decided_at="2026-07-12T01:00:00Z",
                )

        with self.assertRaises(ShadowBuildError):
            self.builder(failpoint_hook=RollbackAba()).build(expected_count=4)

    def test_partial_pair_crash_is_detected_and_rerun_converges(self):
        output, coverage = self.output_paths()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(b"old-shadow")
        coverage.write_bytes(b"old-coverage")

        class CrashAfterShadow:
            fired = False

            def __call__(inner_self, point):
                if point == "after_shadow_write" and not inner_self.fired:
                    inner_self.fired = True
                    raise InjectedCrash(point)

        crashing = self.builder(failpoint_hook=CrashAfterShadow())
        with self.assertRaises(InjectedCrash):
            crashing.write(expected_count=4, output=output, coverage_output=coverage)
        with self.assertRaises(ShadowBuildError):
            self.builder().validate_output_pair(output, coverage)

        self.builder().write(expected_count=4, output=output, coverage_output=coverage)
        self.builder().validate_output_pair(output, coverage)

    def test_validate_output_pair_rejects_forged_snapshot(self):
        output, coverage = self.output_paths()
        builder = self.builder()
        builder.write(expected_count=4, output=output, coverage_output=coverage)
        shadow = json.loads(output.read_text())
        report = json.loads(coverage.read_text())
        shadow["snapshot"]["membership_sha256"] = "0" * 64
        shadow["snapshot_sha256"] = canonical_sha(shadow["snapshot"])
        shadow_bytes = canonical_bytes(shadow)
        report["snapshot"] = shadow["snapshot"]
        report["snapshot_sha256"] = shadow["snapshot_sha256"]
        report["shadow_sha256"] = hashlib.sha256(shadow_bytes).hexdigest()
        output.write_bytes(shadow_bytes)
        write_json(coverage, report)
        with self.assertRaises(ShadowBuildError):
            builder.validate_output_pair(output, coverage)


if __name__ == "__main__":
    unittest.main()
