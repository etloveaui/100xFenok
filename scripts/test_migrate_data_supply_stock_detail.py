import hashlib
import json
import shutil
import sys
import tempfile
import threading
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from data_supply_state import (
    ConcurrencyError,
    DataSupplyStateStore,
    IntegrityError,
    deterministic_event_id,
)
from data_supply_stock_detail import FROZEN_STOCK_DETAIL_TICKERS
from migrate_data_supply_stock_detail import StockDetailMigration


DECIDED_AT = "2026-07-11T00:00:00Z"
EMPTY_SHA256 = "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"


def canonical_bytes(value):
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def canonical_sha(value):
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(canonical_bytes(value))


def stockanalysis_payload(ticker, *, fetched_at="2026-07-10T00:00:00Z", price=10.0):
    return {
        "schema_version": "stockanalysis/v1",
        "source": "stockanalysis",
        "asset_type": "stock",
        "ticker": ticker,
        "fetched_at": fetched_at,
        "normalized": {
            "overview": {"name": ticker},
            "quote": {
                "symbol": ticker,
                "uid": ticker,
                "p": price,
                "cl": price - 1,
                "pd": price - 1,
                "c": 1.0,
                "cp": 10.0,
            },
            "history": [{"t": "2026-07-09", "c": price - 1}],
        },
    }


def yahoo_payload(ticker, *, fetched_at="2026-07-10T00:00:00Z", price=11.0):
    return {
        "schema_version": "yf-finance/v2",
        "source": "yahoo_finance",
        "ticker": ticker,
        "fetched_at": fetched_at,
        "data": {
            "info": {
                "symbol": ticker,
                "quoteType": "EQUITY",
                "currentPrice": price,
                "previousClose": price - 1,
            },
            "history_1y": [{"date": "2026-07-09", "Close": price - 1}],
        },
    }


def write_pair(
    root,
    ticker,
    *,
    sa_fetched_at="2026-07-10T00:00:00Z",
    yf_fetched_at="2026-07-10T00:00:00Z",
    price=10.0,
):
    write_json(
        root / f"data/stockanalysis/stocks/{ticker}.json",
        stockanalysis_payload(ticker, fetched_at=sa_fetched_at, price=price),
    )
    write_json(
        root / f"data/yf/finance/{ticker}.json",
        yahoo_payload(ticker, fetched_at=yf_fetched_at, price=price + 1),
    )


def write_protected_index(root):
    write_json(
        root / "data/computed/data-supply/etf-detail/index.json",
        {
            "schema_version": "data-supply-etf-detail-public-index/v1",
            "active_generation_manifest_sha256": "a" * 64,
            "active_transaction_id": "b" * 64,
            "index_sha256": "c" * 64,
            "membership_sha256": "d" * 64,
            "enrolled_count": 718,
            "selected_count": 718,
            "unavailable_count": 0,
            "resolution_state_counts": {
                "fresh_primary": 718,
                "fresh_fallback": 0,
                "lkg_primary": 0,
                "lkg_fallback": 0,
                "unavailable": 0,
            },
            "entries": {},
        },
    )


def pair_records(root, tickers):
    rows = []
    for ticker in sorted(tickers):
        sa_path = root / f"data/stockanalysis/stocks/{ticker}.json"
        yf_path = root / f"data/yf/finance/{ticker}.json"
        rows.append(
            {
                "ticker": ticker,
                "stockanalysis_path": sa_path.relative_to(root).as_posix(),
                "stockanalysis_sha256": hashlib.sha256(sa_path.read_bytes()).hexdigest(),
                "yahoo_path": yf_path.relative_to(root).as_posix(),
                "yahoo_sha256": hashlib.sha256(yf_path.read_bytes()).hexdigest(),
            }
        )
    return rows


class InjectedCrash(RuntimeError):
    pass


class OneShotCrash:
    def __init__(self, target):
        self.target = target
        self.fired = False

    def __call__(self, point):
        if point == self.target and not self.fired:
            self.fired = True
            raise InjectedCrash(point)


class StockDetailMigrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name)
        self.state = self.repo / "data/admin/data-supply-state/v1"
        write_protected_index(self.repo)

    def tearDown(self):
        self.tmp.cleanup()

    def migration(self, tickers, *, failpoint_hook=None):
        return StockDetailMigration(
            self.repo,
            self.state,
            tickers=tuple(sorted(tickers)),
            failpoint_hook=failpoint_hook,
            enforce_approved_digests=False,
        )

    def repo_via_ancestor_alias(self):
        alias = self.repo / "repo-parent-alias"
        alias.symlink_to(self.repo.parent, target_is_directory=True)
        return alias, alias / self.repo.name

    def plan(self, tickers, *, migration=None, created_at=DECIDED_AT):
        migration = migration or self.migration(tickers)
        return migration.plan(
            expected_count=len(tickers),
            expected_ticker_sha256=canonical_sha(sorted(tickers)),
            expected_pair_sha256=canonical_sha(pair_records(self.repo, tickers)),
            expected_delete_sha256=EMPTY_SHA256,
            created_at=created_at,
        )

    def test_pair_49_happy_path(self):
        for ticker in FROZEN_STOCK_DETAIL_TICKERS:
            write_pair(self.repo, ticker)
        migration = self.migration(FROZEN_STOCK_DETAIL_TICKERS)
        manifest = migration.plan(
            expected_count=49,
            expected_ticker_sha256="da4e5ec74ea0d741d529a627f2ea2f5507213787c5fa5395081e17566544e09f",
            expected_pair_sha256=canonical_sha(pair_records(self.repo, FROZEN_STOCK_DETAIL_TICKERS)),
            expected_delete_sha256=EMPTY_SHA256,
            created_at=DECIDED_AT,
        )

        self.assertEqual(manifest["ticker_sha256"], canonical_sha(sorted(FROZEN_STOCK_DETAIL_TICKERS)))
        self.assertEqual(len(manifest["entries"]), 49)
        self.assertEqual(len(manifest["payload_refs"]), 98)
        self.assertEqual(manifest["delete_candidates"], [])
        self.assertFalse(self.state.exists())
        verified = migration.verify_plan(manifest, expected_count=49, require_delete_count=0)
        self.assertEqual(verified["pair_sha256"], manifest["pair_sha256"])

    def test_pair_count_48_blocks(self):
        tickers = FROZEN_STOCK_DETAIL_TICKERS[:-1]
        for ticker in tickers:
            write_pair(self.repo, ticker)
        migration = self.migration(FROZEN_STOCK_DETAIL_TICKERS)
        with self.assertRaises(IntegrityError):
            migration.plan(
                expected_count=49,
                expected_ticker_sha256=canonical_sha(sorted(FROZEN_STOCK_DETAIL_TICKERS)),
                expected_pair_sha256="0" * 64,
                expected_delete_sha256=EMPTY_SHA256,
                created_at=DECIDED_AT,
            )
        self.assertFalse(self.state.exists())

    def test_pair_count_50_blocks(self):
        for ticker in FROZEN_STOCK_DETAIL_TICKERS:
            write_pair(self.repo, ticker)
        write_pair(self.repo, "ZZZZ")
        migration = self.migration(FROZEN_STOCK_DETAIL_TICKERS)
        with self.assertRaises(IntegrityError):
            migration.plan(
                expected_count=49,
                expected_ticker_sha256=canonical_sha(sorted(FROZEN_STOCK_DETAIL_TICKERS)),
                expected_pair_sha256="0" * 64,
                expected_delete_sha256=EMPTY_SHA256,
                created_at=DECIDED_AT,
            )

    def test_yahoo_only_1129_excluded(self):
        write_pair(self.repo, "AAPL")
        for index in range(1129):
            ticker = f"Y{index:04d}"
            write_json(self.repo / f"data/yf/finance/{ticker}.json", yahoo_payload(ticker))
        manifest = self.plan(("AAPL",))
        self.assertEqual([entry["ticker"] for entry in manifest["entries"]], ["AAPL"])
        self.assertEqual(manifest["excluded_yahoo_only_count"], 1129)

    def test_delete_set_non_empty_blocks(self):
        write_pair(self.repo, "AAPL")
        write_json(
            self.repo / "data/stockanalysis/stocks/CONTAM.json",
            {
                "schema_version": "stockanalysis/v1",
                "source": "yahoo_finance",
                "source_provider": "yahoo_finance",
                "ticker": "CONTAM",
            },
        )
        with self.assertRaises(IntegrityError):
            self.plan(("AAPL",))
        self.assertFalse(self.state.exists())

    def test_source_tamper_after_plan_blocks(self):
        write_pair(self.repo, "AAPL")
        migration = self.migration(("AAPL",))
        manifest = self.plan(("AAPL",), migration=migration)
        (self.repo / "data/yf/finance/AAPL.json").write_bytes(b'{"tampered":true}')
        with self.assertRaises(IntegrityError):
            migration.verify_plan(manifest, expected_count=1, require_delete_count=0)
        with self.assertRaises(IntegrityError):
            migration.apply(manifest, decided_at=DECIDED_AT, no_delete=True)
        self.assertFalse(self.state.exists())

    def test_protected_rebaseline_drift_blocks(self):
        write_pair(self.repo, "AAPL")
        baseline_migration = self.migration(("AAPL",))
        baseline = baseline_migration._protected_snapshot()
        protected = self.repo / "data/computed/data-supply/etf-detail/index.json"
        payload = json.loads(protected.read_text())
        payload["membership_sha256"] = "e" * 64
        write_json(protected, payload)
        migration = StockDetailMigration(
            self.repo,
            self.state,
            tickers=("AAPL",),
            enforce_approved_digests=False,
            enforce_protected_snapshot=True,
            approved_protected_snapshot=baseline,
        )
        with self.assertRaises(IntegrityError):
            self.plan(("AAPL",), migration=migration)

    def test_same_payload_from_different_decision_is_not_false_resume(self):
        write_pair(self.repo, "AAPL", sa_fetched_at="2026-07-10T00:00:00Z", yf_fetched_at="2026-07-10T00:00:00Z")
        migration = self.migration(("AAPL",))
        first_time = "2026-07-10T12:00:00Z"
        first = self.plan(("AAPL",), migration=migration, created_at=first_time)
        migration.apply(first, decided_at=first_time, no_delete=True)
        (self.state / "domains/stock_detail/migration.json").unlink()

        second = self.plan(("AAPL",), migration=migration, created_at=DECIDED_AT)
        result = migration.apply(second, decided_at=DECIDED_AT, no_delete=True)
        self.assertEqual(result["resumed"], 0)
        selected = DataSupplyStateStore(self.state).read_active_domain("stock_detail")["current"]["AAPL"]
        self.assertEqual(selected["selected_at"], DECIDED_AT)
        self.assertEqual(selected["observed_at"], DECIDED_AT)

    def test_history_deletion_or_corruption_blocks_verify_state(self):
        write_pair(self.repo, "AAPL")
        migration = self.migration(("AAPL",))
        manifest = self.plan(("AAPL",), migration=migration)
        migration.apply(manifest, decided_at=DECIDED_AT, no_delete=True)
        observation_path = self.state / "history/observations/2026-07-11.jsonl"
        resolution_path = self.state / "history/resolutions/2026-07-11.jsonl"
        observation_bytes = observation_path.read_bytes()
        resolution_bytes = resolution_path.read_bytes()

        observation_path.unlink()
        with self.assertRaises(IntegrityError):
            migration.verify_state(manifest, expected_count=1)
        observation_path.write_bytes(observation_bytes)
        resolution_path.unlink()
        with self.assertRaises(IntegrityError):
            migration.verify_state(manifest, expected_count=1)
        resolution_path.write_bytes(resolution_bytes[:-1])
        with self.assertRaises(IntegrityError):
            migration.verify_state(manifest, expected_count=1)

    def test_semantically_forged_resolution_history_is_rejected(self):
        for ticker in ("AAPL", "ABBV"):
            write_pair(self.repo, ticker)
        migration = self.migration(("AAPL", "ABBV"))
        manifest = self.plan(("AAPL", "ABBV"), migration=migration)
        migration.apply(manifest, decided_at=DECIDED_AT, no_delete=True)
        path = self.state / "history/resolutions/2026-07-11.jsonl"
        rows = [json.loads(line) for line in path.read_text().splitlines()]
        rows[0]["reason_code"] = "forged_reason"
        rows[0]["new_selection_digest"] = "0" * 64
        rows[0]["event_id"] = deterministic_event_id("resolution", rows[0])
        path.write_bytes(b"".join(canonical_bytes(row) + b"\n" for row in rows))
        with self.assertRaises(IntegrityError):
            migration.verify_state(manifest, expected_count=2)

    def test_unavailable_verify_requires_exact_manifest_evidence(self):
        write_pair(
            self.repo,
            "AAPL",
            sa_fetched_at="2026-06-20T00:00:00Z",
            yf_fetched_at="2026-06-20T00:00:00Z",
        )
        migration = self.migration(("AAPL",))
        first = self.plan(("AAPL",), migration=migration)
        migration.apply(first, decided_at=DECIDED_AT, no_delete=True)
        (self.state / "domains/stock_detail/migration.json").unlink()
        second_time = "2026-07-11T01:00:00Z"
        second = self.plan(("AAPL",), migration=migration, created_at=second_time)
        migration._write_state_pin(second)
        with self.assertRaises(IntegrityError):
            migration.verify_state(second, expected_count=1)

    def test_corrupt_selected_lkg_latest_blocks_verify_state(self):
        write_pair(
            self.repo,
            "AAPL",
            sa_fetched_at="2026-07-01T00:00:00Z",
            yf_fetched_at="2026-07-01T00:00:00Z",
        )
        migration = self.migration(("AAPL",))
        manifest = self.plan(("AAPL",), migration=migration)
        migration.apply(manifest, decided_at=DECIDED_AT, no_delete=True)
        latest_path = self.state / "providers/stockanalysis/stock_detail/lkg/AAPL/latest.json"
        latest = json.loads(latest_path.read_text())
        latest["path"] = "providers/stockanalysis/stock_detail/lkg/AAPL/objects/" + "0" * 64 + ".json"
        write_json(latest_path, latest)
        with self.assertRaises(IntegrityError):
            migration.verify_state(manifest, expected_count=1)

    def test_canonical_state_root_symlink_escape_blocks_apply(self):
        write_pair(self.repo, "AAPL")
        alias, alias_repo = self.repo_via_ancestor_alias()
        alias_state = alias_repo / "data/admin/data-supply-state/v1"
        outside = self.repo.resolve().parent / f"{self.repo.name}-outside-state"
        outside.mkdir()
        self.state.parent.mkdir(parents=True)
        self.state.symlink_to(outside, target_is_directory=True)
        migration = StockDetailMigration(
            alias_repo,
            alias_state,
            tickers=("AAPL",),
            enforce_approved_digests=False,
        )
        try:
            manifest = self.plan(("AAPL",), migration=migration)
            self.assertEqual(alias_state.resolve(strict=False), outside.resolve())
            with self.assertRaises(ValueError):
                outside.resolve().relative_to(self.repo.resolve())
            with self.assertRaises(IntegrityError):
                migration.apply(manifest, decided_at=DECIDED_AT, no_delete=True)
            self.assertFalse((outside / "domains").exists())
        finally:
            if self.state.is_symlink():
                self.state.unlink()
            if alias.is_symlink():
                alias.unlink()
            if outside.exists():
                shutil.rmtree(outside)

    def test_internal_state_ancestor_symlink_blocks_before_first_write(self):
        write_pair(self.repo, "AAPL")
        self.state.mkdir(parents=True)
        relocated = self.state / "real-domains"
        relocated.mkdir()
        (self.state / "domains").symlink_to(relocated, target_is_directory=True)
        migration = self.migration(("AAPL",))
        manifest = self.plan(("AAPL",), migration=migration)
        with self.assertRaises(IntegrityError):
            migration.apply(manifest, decided_at=DECIDED_AT, no_delete=True)
        self.assertEqual(list(relocated.iterdir()), [])
        self.assertFalse((self.state / "providers").exists())
        self.assertFalse((self.state / "history").exists())

    def test_entity_object_ancestor_symlink_blocks_before_first_write(self):
        write_pair(self.repo, "AAPL")
        relocated = self.state / "relocated-aapl"
        relocated.mkdir(parents=True)
        object_root = self.state / "providers/stockanalysis/stock_detail/objects/AAPL"
        object_root.parent.mkdir(parents=True)
        object_root.symlink_to(relocated, target_is_directory=True)
        migration = self.migration(("AAPL",))
        manifest = self.plan(("AAPL",), migration=migration)
        with self.assertRaises(IntegrityError):
            migration.apply(manifest, decided_at=DECIDED_AT, no_delete=True)
        self.assertEqual(list(relocated.iterdir()), [])
        self.assertFalse((self.state / "domains").exists())
        self.assertFalse((self.state / "history").exists())

    def test_in_root_provider_object_ancestor_symlink_blocks_verify(self):
        write_pair(self.repo, "AAPL")
        migration = self.migration(("AAPL",))
        manifest = self.plan(("AAPL",), migration=migration)
        migration.apply(manifest, decided_at=DECIDED_AT, no_delete=True)
        directory = self.state / "providers/stockanalysis/stock_detail/objects/AAPL"
        relocated = directory.with_name("AAPL.real")
        directory.rename(relocated)
        directory.symlink_to(relocated, target_is_directory=True)
        with self.assertRaises(IntegrityError):
            migration.verify_state(manifest, expected_count=1)

    def test_canonical_state_root_symlink_blocks_verify(self):
        write_pair(self.repo, "AAPL")
        migration = self.migration(("AAPL",))
        manifest = self.plan(("AAPL",), migration=migration)
        migration.apply(manifest, decided_at=DECIDED_AT, no_delete=True)
        relocated = self.state.with_name("v1.real")
        self.state.rename(relocated)
        self.state.symlink_to(relocated, target_is_directory=True)
        alias, alias_repo = self.repo_via_ancestor_alias()
        alias_state = alias_repo / "data/admin/data-supply-state/v1"
        verifier = StockDetailMigration(
            alias_repo,
            alias_state,
            tickers=("AAPL",),
            enforce_approved_digests=False,
        )
        try:
            self.assertEqual(alias_state.resolve(strict=False), relocated.resolve())
            self.assertTrue(alias_state.is_symlink())
            with self.assertRaises(IntegrityError):
                verifier.verify_state(manifest, expected_count=1)
        finally:
            if alias.is_symlink():
                alias.unlink()

    def test_archive_byte_identity(self):
        write_pair(self.repo, "AAPL")
        migration = self.migration(("AAPL",))
        manifest = self.plan(("AAPL",), migration=migration)
        with tempfile.TemporaryDirectory() as runner:
            plan_path = Path(runner) / "plan.json"
            archive_path = self.repo / "data/yf/migration-evidence/stock-detail-test.json"
            migration.write_manifest(manifest, plan_path)
            result = migration.archive(plan_path, archive_path)
            self.assertEqual(plan_path.read_bytes(), archive_path.read_bytes())
            self.assertFalse(plan_path.read_bytes().endswith(b"\n"))
            self.assertEqual(result["archive_sha256"], hashlib.sha256(plan_path.read_bytes()).hexdigest())
            archive_path.write_bytes(b"different")
            with self.assertRaises(IntegrityError):
                migration.archive(plan_path, archive_path)

    def test_plan_and_archive_output_scope_is_fail_closed(self):
        write_pair(self.repo, "AAPL")
        migration = self.migration(("AAPL",))
        manifest = self.plan(("AAPL",), migration=migration)
        with self.assertRaises(IntegrityError):
            migration.write_manifest(
                manifest,
                self.repo / "data/admin/data-supply-state/v1/forbidden-plan.json",
            )
        with tempfile.TemporaryDirectory() as runner:
            plan_path = Path(runner) / "plan.json"
            migration.write_manifest(manifest, plan_path)
            with self.assertRaises(IntegrityError):
                migration.archive(
                    plan_path,
                    self.repo / "data/yf/migration-evidence/wrong-name.json",
                )

    def test_resume_after_each_entity_transaction(self):
        tickers = ("AAPL", "ABBV")
        for ticker in tickers:
            write_pair(self.repo, ticker)
        crash = OneShotCrash("after_entity_commit:AAPL")
        migration = self.migration(tickers, failpoint_hook=crash)
        manifest = self.plan(tickers, migration=migration)
        with self.assertRaises(InjectedCrash):
            migration.apply(manifest, decided_at=DECIDED_AT, no_delete=True)

        result = self.migration(tickers).apply(manifest, decided_at=DECIDED_AT, no_delete=True)
        self.assertEqual(result["verified"], 2)
        self.assertGreaterEqual(result["resumed"], 1)
        self.migration(tickers).verify_state(manifest, expected_count=2)

    def test_provider_object_crash_matrix(self):
        points = (
            "provider_object_after_temp_write",
            "provider_object_after_temp_fsync",
            "provider_object_after_replace_before_dir_fsync",
            "provider_object_after_dir_fsync",
            "after_provider_object",
            "provider_pending_after_temp_write",
            "provider_pending_after_temp_fsync",
            "provider_pending_after_replace_before_dir_fsync",
            "provider_pending_after_dir_fsync",
            "after_provider_pending",
        )
        for point in points:
            with self.subTest(point=point), tempfile.TemporaryDirectory() as tmp:
                repo = Path(tmp)
                state = repo / "data/admin/data-supply-state/v1"
                write_protected_index(repo)
                write_pair(repo, "AAPL")
                crashing = StockDetailMigration(repo, state, tickers=("AAPL",), failpoint_hook=OneShotCrash(point), enforce_approved_digests=False)
                manifest = crashing.plan(
                    expected_count=1,
                    expected_ticker_sha256=canonical_sha(["AAPL"]),
                    expected_pair_sha256=canonical_sha(pair_records(repo, ("AAPL",))),
                    expected_delete_sha256=EMPTY_SHA256,
                    created_at=DECIDED_AT,
                )
                with self.assertRaises(InjectedCrash):
                    crashing.apply(manifest, decided_at=DECIDED_AT, no_delete=True)
                resumed = StockDetailMigration(repo, state, tickers=("AAPL",), enforce_approved_digests=False)
                resumed.apply(manifest, decided_at=DECIDED_AT, no_delete=True)
                resumed.verify_state(manifest, expected_count=1)

    def test_lkg_provider_object_latest_crash_matrix(self):
        points = (
            "provider_lkg_object_after_temp_write",
            "provider_lkg_object_after_temp_fsync",
            "provider_lkg_object_after_replace_before_dir_fsync",
            "provider_lkg_object_after_dir_fsync",
            "after_provider_lkg_object",
            "provider_lkg_latest_after_temp_write",
            "provider_lkg_latest_after_temp_fsync",
            "provider_lkg_latest_after_replace_before_dir_fsync",
            "provider_lkg_latest_after_dir_fsync",
        )
        for point in points:
            with self.subTest(point=point), tempfile.TemporaryDirectory() as tmp:
                repo = Path(tmp)
                state = repo / "data/admin/data-supply-state/v1"
                write_protected_index(repo)
                write_pair(
                    repo,
                    "AAPL",
                    sa_fetched_at="2026-07-01T00:00:00Z",
                    yf_fetched_at="2026-07-01T00:00:00Z",
                )
                crashing = StockDetailMigration(repo, state, tickers=("AAPL",), failpoint_hook=OneShotCrash(point), enforce_approved_digests=False)
                manifest = crashing.plan(
                    expected_count=1,
                    expected_ticker_sha256=canonical_sha(["AAPL"]),
                    expected_pair_sha256=canonical_sha(pair_records(repo, ("AAPL",))),
                    expected_delete_sha256=EMPTY_SHA256,
                    created_at=DECIDED_AT,
                )
                with self.assertRaises(InjectedCrash):
                    crashing.apply(manifest, decided_at=DECIDED_AT, no_delete=True)
                resumed = StockDetailMigration(repo, state, tickers=("AAPL",), enforce_approved_digests=False)
                resumed.apply(manifest, decided_at=DECIDED_AT, no_delete=True)
                verified = resumed.verify_state(manifest, expected_count=1)
                self.assertEqual(verified["states"]["lkg_primary"], 1)

    def test_observation_pending_generation_crash_matrix(self):
        points = (
            "after_observation:stockanalysis",
            "after_observation:yahoo_finance",
            "after_all_observations:AAPL",
            "after_prepare:AAPL",
            "generation_current_after_temp_write",
            "generation_lkg_after_temp_fsync",
            "generation_recovery_after_replace_before_dir_fsync",
            "generation_decision_after_dir_fsync",
            "generation_manifest_after_temp_write",
            "generation_manifest_after_temp_fsync",
            "generation_manifest_after_replace_before_dir_fsync",
            "generation_manifest_after_dir_fsync",
            "after_write_current",
            "after_write_lkg",
            "after_write_recovery",
            "after_write_decision",
            "after_write_manifest",
            "after_generation_fsync",
            "active_after_temp_write",
            "active_after_temp_fsync",
            "active_after_replace_before_dir_fsync",
            "active_after_dir_fsync",
            "after_active_replace",
            "before_resolution_append",
        )
        for point in points:
            with self.subTest(point=point), tempfile.TemporaryDirectory() as tmp:
                repo = Path(tmp)
                state = repo / "data/admin/data-supply-state/v1"
                write_protected_index(repo)
                write_pair(repo, "AAPL")
                crashing = StockDetailMigration(repo, state, tickers=("AAPL",), failpoint_hook=OneShotCrash(point), enforce_approved_digests=False)
                manifest = crashing.plan(
                    expected_count=1,
                    expected_ticker_sha256=canonical_sha(["AAPL"]),
                    expected_pair_sha256=canonical_sha(pair_records(repo, ("AAPL",))),
                    expected_delete_sha256=EMPTY_SHA256,
                    created_at=DECIDED_AT,
                )
                with self.assertRaises(InjectedCrash):
                    crashing.apply(manifest, decided_at=DECIDED_AT, no_delete=True)
                resumed = StockDetailMigration(repo, state, tickers=("AAPL",), enforce_approved_digests=False)
                resumed.apply(manifest, decided_at=DECIDED_AT, no_delete=True)
                resumed.verify_state(manifest, expected_count=1)

    def test_concurrent_reader_promotion_prune_rollback(self):
        write_pair(self.repo, "AAPL", price=10.0)
        write_pair(self.repo, "ABBV", price=20.0)
        migration = self.migration(("AAPL", "ABBV"))
        manifest = self.plan(("AAPL", "ABBV"), migration=migration)
        migration.apply(manifest, decided_at=DECIDED_AT, no_delete=True)
        store = DataSupplyStateStore(self.state, provider_truth_root=self.repo)
        active = store.read_active_domain("stock_detail")
        rollback_target = active["retained_generation_ids"][1]
        original_transaction = active["transaction_id"]
        entered = threading.Event()
        release = threading.Event()
        writer_done = threading.Event()
        seen = []
        failures = []

        def reader_failpoint(point):
            if point == "resolved_payload_after_active":
                entered.set()
                release.wait(timeout=2)

        def reader():
            try:
                reader_store = DataSupplyStateStore(
                    self.state,
                    provider_truth_root=self.repo,
                    failpoint_hook=reader_failpoint,
                )
                seen.append(reader_store.read_resolved_payload("stock_detail", "AAPL")["normalized"]["quote"]["p"])
            except Exception as exc:  # pragma: no cover - asserted below
                failures.append(exc)

        def writer():
            try:
                store.prune_domain("stock_detail")
                store.rollback_domain(
                    "stock_detail",
                    target_transaction_id=rollback_target,
                    expected_active_transaction_id=original_transaction,
                    decided_at="2026-07-12T01:00:00Z",
                )
            except Exception as exc:  # pragma: no cover - asserted below
                failures.append(exc)
            finally:
                writer_done.set()

        reader_thread = threading.Thread(target=reader)
        reader_thread.start()
        self.assertTrue(entered.wait(timeout=2))
        writer_thread = threading.Thread(target=writer)
        writer_thread.start()
        self.assertFalse(writer_done.wait(timeout=0.05))
        release.set()
        reader_thread.join(timeout=2)
        writer_thread.join(timeout=2)
        self.assertEqual(failures, [])
        self.assertEqual(set(seen), {10.0})
        current = store.read_active_domain("stock_detail")["transaction_id"]
        with self.assertRaises(ConcurrencyError):
            store.rollback_domain(
                "stock_detail",
                target_transaction_id="0" * 64,
                expected_active_transaction_id=current,
                decided_at="2026-07-12T02:00:00Z",
            )

    def test_corrupt_active_manifest_pin_latest_path_symlink(self):
        cases = ("active", "manifest", "pin", "latest", "pending", "path_symlink")
        for case in cases:
            with self.subTest(case=case), tempfile.TemporaryDirectory() as tmp:
                repo = Path(tmp)
                state = repo / "data/admin/data-supply-state/v1"
                write_protected_index(repo)
                stamp = "2026-07-01T00:00:00Z" if case == "latest" else "2026-07-10T00:00:00Z"
                write_pair(repo, "AAPL", sa_fetched_at=stamp, yf_fetched_at=stamp)
                migration = StockDetailMigration(repo, state, tickers=("AAPL",), enforce_approved_digests=False)
                manifest = migration.plan(
                    expected_count=1,
                    expected_ticker_sha256=canonical_sha(["AAPL"]),
                    expected_pair_sha256=canonical_sha(pair_records(repo, ("AAPL",))),
                    expected_delete_sha256=EMPTY_SHA256,
                    created_at=DECIDED_AT,
                )
                migration.apply(manifest, decided_at=DECIDED_AT, no_delete=True)
                store = DataSupplyStateStore(state, provider_truth_root=repo)
                active = store.read_active_domain("stock_detail")
                object_files = sorted(state.glob("providers/*/stock_detail/objects/*/*.json"))
                before = {path: path.read_bytes() for path in object_files}

                if case == "active":
                    (state / "domains/stock_detail/active.json").write_bytes(b"{}")
                elif case == "manifest":
                    path = state / f"domains/stock_detail/generations/{active['transaction_id']}/manifest.json"
                    path.write_bytes(path.read_bytes() + b" ")
                elif case == "pin":
                    path = state / "domains/stock_detail/migration.json"
                    payload = json.loads(path.read_text())
                    payload["payload_refs"][0]["path"] = "../escape.json"
                    write_json(path, payload)
                elif case == "latest":
                    path = state / "providers/stockanalysis/stock_detail/lkg/AAPL/latest.json"
                    payload = json.loads(path.read_text())
                    payload["path"] = "providers/stockanalysis/stock_detail/lkg/AAPL/objects/" + "0" * 64 + ".json"
                    write_json(path, payload)
                elif case == "pending":
                    path = state / "providers/stockanalysis/stock_detail/pending/AAPL.json"
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.symlink_to(state / "missing-pending-target.json")
                else:
                    selected = active["current"]["AAPL"]["payload_ref"]
                    path = state / selected["path"]
                    original = path.read_bytes()
                    outside = repo / "outside.json"
                    outside.write_bytes(original)
                    path.unlink()
                    path.symlink_to(outside)

                maintenance = store.prune_domain("stock_detail")
                self.assertEqual(maintenance["deleted_objects"], 0)
                self.assertEqual(maintenance["skipped"], "pin_validation_failed")
                for path, payload in before.items():
                    if case != "path_symlink" or path.exists() and not path.is_symlink():
                        self.assertEqual(path.read_bytes(), payload)


if __name__ == "__main__":
    unittest.main()
