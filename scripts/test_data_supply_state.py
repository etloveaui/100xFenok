import hashlib
import datetime as dt
import json
import math
import subprocess
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
    SchemaError,
    UnavailableError,
    bind_selection_to_provider_lkg,
    build_selection,
    canonical_json_bytes,
    canonical_sha256,
    deterministic_event_id,
    selection_age_status,
)


CRASH_PROBE = SCRIPT_DIR / "test_data_supply_state_crash_probe.py"


def observation(
    *,
    status="valid",
    observed_at="2026-07-10T02:00:00Z",
    suffix="a",
    provider="stockanalysis",
):
    payload = {"ticker": "VYMI", "suffix": suffix}
    is_primary = provider == "stockanalysis"
    row = {
        "schema_version": "data-supply-observation/v1",
        "provider": provider,
        "endpoint_family": "stockanalysis_etf_detail" if is_primary else "yahoo_finance_etf_detail",
        "domain": "etf_detail",
        "entity": "VYMI",
        "provider_path": (
            f"data/stockanalysis/etfs/VYMI-{suffix}.json"
            if is_primary
            else f"data/yf/etf-details/VYMI-{suffix}.json"
        ),
        "payload_sha256": canonical_sha256(payload),
        "provider_schema": "stockanalysis/v1" if is_primary else "yf-etf-detail/v1",
        "source_as_of": "2026-07-10T00:00:00Z",
        "observed_at": observed_at,
        "validation_status": status,
        "reason_code": "contract_valid" if status == "valid" else "schema_drift",
    }
    row["event_id"] = deterministic_event_id("observation", row)
    return row


def materialize_provider_truth(root, row):
    suffix = Path(row["provider_path"]).stem.rsplit("-", 1)[-1]
    payload = canonical_json_bytes({"ticker": "VYMI", "suffix": suffix})
    path = Path(root) / row["provider_path"]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)
    object_path = Path(root) / provider_object_path(row)
    object_path.parent.mkdir(parents=True, exist_ok=True)
    object_path.write_bytes(payload)


def provider_object_path(row):
    return (
        Path("providers")
        / row["provider"]
        / row["domain"]
        / "objects"
        / row["entity"]
        / f"{row['payload_sha256']}.json"
    ).as_posix()


def materialize_provider_lkg(store, selection_row, suffix="a"):
    latest_path = (
        store.root
        / "providers"
        / selection_row["provider"]
        / selection_row["domain"]
        / "lkg"
        / selection_row["entity"]
        / "latest.json"
    )
    expected = json.loads(latest_path.read_text(encoding="utf-8"))["sha256"] if latest_path.exists() else None
    ref = store.store_provider_lkg(
        provider=selection_row["provider"],
        domain=selection_row["domain"],
        entity=selection_row["entity"],
        payload={"ticker": "VYMI", "suffix": suffix},
        meaningful_transition=True,
        expected_latest_sha256=expected,
    )
    return bind_selection_to_provider_lkg(selection_row, ref)


def selection(row, *, state="fresh_primary", selected_at="2026-07-10T02:00:00Z"):
    return build_selection(
        row,
        selected_at=selected_at,
        resolution_state=state,
        reason_code="primary_valid" if state == "fresh_primary" else "primary_unavailable_fallback_valid",
        fallback_depth=0 if state == "fresh_primary" else 1,
        payload_ref_kind="provider_object",
        payload_ref_path=provider_object_path(row),
    )


class DataSupplyStateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.store = DataSupplyStateStore(self.root, provider_truth_root=self.root)

    def tearDown(self):
        self.tmp.cleanup()

    def commit_primary(self):
        row = observation()
        materialize_provider_truth(self.root, row)
        self.store.store_provider_object(
            observation=row,
            payload=canonical_json_bytes({"ticker": "VYMI", "suffix": "a"}),
        )
        self.store.record_observation(row)
        selected = selection(row)
        transaction_id = self.store.prepare_transition(
            domain="etf_detail",
            entity="VYMI",
            current={"VYMI": selected},
            lkg={},
            recovery={"VYMI": {"consecutive_green": 1, "last_transition": "initial_primary"}},
            candidate_observations=[row],
            expected_active_transaction_id=None,
            transition="initial_primary",
            reason_code="primary_valid",
            recovery_green_count=1,
            decided_at="2026-07-10T02:00:00Z",
        )
        self.store.commit_prepared("etf_detail", transaction_id)
        return transaction_id, row, selected

    def prepare_next(
        self,
        *,
        suffix,
        observed_at,
        expected_active_transaction_id=None,
        evidence_observations=None,
    ):
        active = self.store.read_active_domain("etf_detail")
        expected = active["transaction_id"] if expected_active_transaction_id is None else expected_active_transaction_id
        row = observation(suffix=suffix, observed_at=observed_at)
        payload = canonical_json_bytes({"ticker": "VYMI", "suffix": suffix})
        ref = self.store.store_provider_object(observation=row, payload=payload)
        self.store.record_observation(row)
        selected = build_selection(
            row,
            selected_at=observed_at,
            resolution_state="fresh_fallback",
            reason_code="primary_unavailable_fallback_valid",
            fallback_depth=1,
            payload_ref_kind="provider_object",
            payload_ref_path=ref["path"],
        )
        prior = active["current"]["VYMI"]
        latest_path = (
            self.root
            / "providers"
            / prior["provider"]
            / prior["domain"]
            / "lkg"
            / prior["entity"]
            / "latest.json"
        )
        expected_latest = json.loads(latest_path.read_text(encoding="utf-8"))["sha256"] if latest_path.exists() else None
        lkg_ref = self.store.store_provider_lkg(
            provider=prior["provider"],
            domain=prior["domain"],
            entity=prior["entity"],
            payload=(self.root / prior["payload_ref"]["path"]).read_bytes(),
            meaningful_transition=True,
            expected_latest_sha256=expected_latest,
        )
        lkg_selected = bind_selection_to_provider_lkg(prior, lkg_ref)
        transaction_id = self.store.prepare_transition(
            domain="etf_detail",
            entity="VYMI",
            current={"VYMI": selected},
            lkg={"VYMI": lkg_selected},
            recovery={"VYMI": {"consecutive_green": 0, "last_transition": "primary_to_fallback"}},
            candidate_observations=[row],
            evidence_observations=evidence_observations or [],
            expected_active_transaction_id=expected,
            transition="primary_to_fallback",
            reason_code="primary_unavailable_fallback_valid",
            recovery_green_count=0,
            decided_at=observed_at,
        )
        return transaction_id, row, selected

    def commit_next(self, *, suffix, observed_at):
        transaction_id, row, selected = self.prepare_next(suffix=suffix, observed_at=observed_at)
        self.store.commit_prepared("etf_detail", transaction_id)
        return transaction_id, row, selected

    def test_canonical_hash_and_event_id_are_deterministic_and_reject_nan(self):
        self.assertEqual(canonical_sha256({"b": 2, "a": 1}), canonical_sha256({"a": 1, "b": 2}))
        self.assertEqual(
            deterministic_event_id("observation", {"b": 2, "a": 1}),
            deterministic_event_id("observation", {"a": 1, "b": 2}),
        )
        with self.assertRaises(ValueError):
            canonical_sha256({"bad": math.nan})

    def test_observation_history_is_idempotent_across_store_instances_and_key_order(self):
        row = observation()
        self.assertTrue(self.store.record_observation(row))
        reordered = dict(reversed(list(row.items())))
        self.assertFalse(DataSupplyStateStore(self.root, provider_truth_root=self.root).record_observation(reordered))
        history = self.root / "history" / "observations" / "2026-07-10.jsonl"
        self.assertEqual(len(history.read_text(encoding="utf-8").splitlines()), 1)

    def test_provider_object_preserves_exact_raw_bytes_and_pending_identity(self):
        payload = b'{\n  "ticker": "VYMI",\n  "suffix": "a"\n}\n'
        row = observation()
        row["payload_sha256"] = hashlib.sha256(payload).hexdigest()
        row["event_id"] = deterministic_event_id("observation", row)

        stored = self.store.store_provider_object(observation=row, payload=payload)

        expected_path = provider_object_path(row)
        self.assertEqual(stored["path"], expected_path)
        self.assertEqual(stored["sha256"], row["payload_sha256"])
        self.assertEqual((self.root / expected_path).read_bytes(), payload)
        pending_path = self.root / "providers/stockanalysis/etf_detail/pending/VYMI.json"
        pending = json.loads(pending_path.read_text(encoding="utf-8"))
        self.assertEqual(pending["path"], expected_path)
        self.assertEqual(pending["observation_event_id"], row["event_id"])
        self.assertEqual(pending["provider_path"], row["provider_path"])

    def test_provider_object_digest_mismatch_never_publishes_pending(self):
        row = observation()
        with self.assertRaises(SchemaError):
            self.store.store_provider_object(observation=row, payload=b'{"ticker":"OTHER"}')
        self.assertFalse((self.root / "providers/stockanalysis/etf_detail/pending/VYMI.json").exists())

    def test_pending_pointer_is_one_per_provider_domain_entity(self):
        first = observation()
        second = observation(suffix="b", observed_at="2026-07-10T03:00:00Z")
        first_ref = self.store.store_provider_object(
            observation=first,
            payload=canonical_json_bytes({"ticker": "VYMI", "suffix": "a"}),
        )
        second_ref = self.store.store_provider_object(
            observation=second,
            payload=canonical_json_bytes({"ticker": "VYMI", "suffix": "b"}),
        )
        pending_dir = self.root / "providers/stockanalysis/etf_detail/pending"
        self.assertEqual([path.name for path in pending_dir.glob("*.json")], ["VYMI.json"])
        pending = json.loads((pending_dir / "VYMI.json").read_text(encoding="utf-8"))
        self.assertEqual(pending["path"], second_ref["path"])
        self.assertNotEqual(first_ref["sha256"], second_ref["sha256"])

    def test_pending_replacement_prunes_unpinned_superseded_object(self):
        first = observation()
        second = observation(suffix="b", observed_at="2026-07-10T03:00:00Z")
        first_ref = self.store.store_provider_object(
            observation=first,
            payload=canonical_json_bytes({"ticker": "VYMI", "suffix": "a"}),
        )
        second_ref = self.store.store_provider_object(
            observation=second,
            payload=canonical_json_bytes({"ticker": "VYMI", "suffix": "b"}),
        )
        self.assertFalse((self.root / first_ref["path"]).exists())
        self.assertTrue((self.root / second_ref["path"]).exists())

    def test_pending_replacement_preserves_active_pin_and_prunes_only_superseded_pending(self):
        _, _, active_selected = self.commit_primary()
        second = observation(suffix="b", observed_at="2026-07-10T03:00:00Z")
        third = observation(suffix="c", observed_at="2026-07-10T04:00:00Z")
        second_ref = self.store.store_provider_object(
            observation=second,
            payload=canonical_json_bytes({"ticker": "VYMI", "suffix": "b"}),
        )
        third_ref = self.store.store_provider_object(
            observation=third,
            payload=canonical_json_bytes({"ticker": "VYMI", "suffix": "c"}),
        )
        self.assertTrue((self.root / active_selected["payload_ref"]["path"]).exists())
        self.assertFalse((self.root / second_ref["path"]).exists())
        self.assertTrue((self.root / third_ref["path"]).exists())

    def test_commit_clears_only_matching_pending_and_preserves_newer_candidate(self):
        active_id, _, _ = self.commit_primary()
        prepared, _, prepared_selected = self.prepare_next(
            suffix="b",
            observed_at="2026-07-10T03:00:00Z",
            expected_active_transaction_id=active_id,
        )
        newer = observation(suffix="c", observed_at="2026-07-10T04:00:00Z")
        newer_ref = self.store.store_provider_object(
            observation=newer,
            payload=canonical_json_bytes({"ticker": "VYMI", "suffix": "c"}),
        )
        self.store.commit_prepared("etf_detail", prepared)
        pending = self.root / "providers/stockanalysis/etf_detail/pending/VYMI.json"
        pointer = json.loads(pending.read_text(encoding="utf-8"))
        self.assertEqual(pointer["path"], newer_ref["path"])
        self.assertTrue((self.root / newer_ref["path"]).exists())
        self.assertTrue((self.root / prepared_selected["payload_ref"]["path"]).exists())

    def test_successful_commit_clears_matching_pending(self):
        self.commit_primary()
        self.assertFalse((self.root / "providers/stockanalysis/etf_detail/pending/VYMI.json").exists())

    def test_provider_object_publication_crashes_never_change_active_or_record_observation(self):
        failpoints = (
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
        for failpoint in failpoints:
            with self.subTest(failpoint=failpoint), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                self.root = root
                self.store = DataSupplyStateStore(root, provider_truth_root=root)
                _, _, selected = self.commit_primary()
                result = subprocess.run(
                    [
                        sys.executable,
                        str(CRASH_PROBE),
                        str(root),
                        "--mode",
                        "provider-object",
                        "--failpoint",
                        failpoint,
                    ],
                    check=False,
                )
                self.assertEqual(result.returncode, 91)
                self.assertEqual(self.store.read_resolved_payload("etf_detail", "VYMI"), {"ticker": "VYMI", "suffix": "a"})
                self.assertEqual(self.store.read_active_domain("etf_detail")["current"]["VYMI"], selected)
                history = root / "history/observations/2026-07-10.jsonl"
                self.assertEqual(len(history.read_text(encoding="utf-8").splitlines()), 1)
                pending = root / "providers/stockanalysis/etf_detail/pending/VYMI.json"
                if pending.exists():
                    pointer = json.loads(pending.read_text(encoding="utf-8"))
                    self.assertEqual(pointer["observation_event_id"], observation(suffix="b", observed_at="2026-07-10T03:00:00Z")["event_id"])
                    self.assertTrue((root / pointer["path"]).exists())

    def test_resolved_reader_holds_shared_lock_through_payload_parse(self):
        self.commit_primary()
        reader_started = threading.Event()
        release_reader = threading.Event()
        reader_done = threading.Event()
        writer_done = threading.Event()
        results = []
        errors = []

        def reader_failpoint(point):
            if point == "resolved_payload_after_active":
                reader_started.set()
                release_reader.wait(5)

        def read_payload():
            try:
                reader = DataSupplyStateStore(
                    self.root,
                    provider_truth_root=self.root,
                    failpoint_hook=reader_failpoint,
                )
                results.append(reader.read_resolved_payload("etf_detail", "VYMI"))
            except Exception as exc:  # pragma: no cover - asserted below
                errors.append(exc)
            finally:
                reader_done.set()

        def publish_next():
            try:
                row = observation(suffix="b", observed_at="2026-07-10T03:00:00Z")
                writer = DataSupplyStateStore(self.root, provider_truth_root=self.root)
                writer.store_provider_object(
                    observation=row,
                    payload=canonical_json_bytes({"ticker": "VYMI", "suffix": "b"}),
                )
            except Exception as exc:  # pragma: no cover - asserted below
                errors.append(exc)
            finally:
                writer_done.set()

        reader_thread = threading.Thread(target=read_payload)
        writer_thread = threading.Thread(target=publish_next)
        reader_thread.start()
        self.assertTrue(reader_started.wait(2))
        writer_thread.start()
        self.assertFalse(writer_done.wait(0.2))
        release_reader.set()
        self.assertTrue(reader_done.wait(2))
        self.assertTrue(writer_done.wait(2))
        reader_thread.join()
        writer_thread.join()
        self.assertEqual(errors, [])
        self.assertEqual(results, [{"ticker": "VYMI", "suffix": "a"}])

    def test_slow_reader_blocks_two_commits_and_one_cas_wins_after_release(self):
        active_id, _, _ = self.commit_primary()
        first, _, _ = self.prepare_next(
            suffix="b",
            observed_at="2026-07-10T03:00:00Z",
            expected_active_transaction_id=active_id,
        )
        second, _, _ = self.prepare_next(
            suffix="c",
            observed_at="2026-07-10T04:00:00Z",
            expected_active_transaction_id=active_id,
        )
        reader_started = threading.Event()
        release_reader = threading.Event()
        reader_result = []
        commit_results = []

        def reader_failpoint(point):
            if point == "resolved_payload_after_active":
                reader_started.set()
                release_reader.wait(5)

        def read_payload():
            store = DataSupplyStateStore(self.root, failpoint_hook=reader_failpoint)
            reader_result.append(store.read_resolved_payload("etf_detail", "VYMI"))

        def commit(transaction_id):
            try:
                DataSupplyStateStore(self.root).commit_prepared("etf_detail", transaction_id)
            except ConcurrencyError:
                commit_results.append("lost")
            else:
                commit_results.append("won")

        reader_thread = threading.Thread(target=read_payload)
        commit_threads = [threading.Thread(target=commit, args=(transaction_id,)) for transaction_id in (first, second)]
        reader_thread.start()
        self.assertTrue(reader_started.wait(2))
        for thread in commit_threads:
            thread.start()
        self.assertEqual(commit_results, [])
        release_reader.set()
        reader_thread.join(2)
        for thread in commit_threads:
            thread.join(2)
        self.assertEqual(reader_result, [{"ticker": "VYMI", "suffix": "a"}])
        self.assertEqual(sorted(commit_results), ["lost", "won"])

    def test_newest_three_committed_generations_are_retained(self):
        first, _, _ = self.commit_primary()
        second, _, _ = self.commit_next(suffix="b", observed_at="2026-07-10T03:00:00Z")
        third, _, _ = self.commit_next(suffix="c", observed_at="2026-07-10T04:00:00Z")
        fourth, _, _ = self.commit_next(suffix="d", observed_at="2026-07-10T05:00:00Z")
        generations = self.root / "domains/etf_detail/generations"
        retained = {path.name for path in generations.iterdir() if path.is_dir()}
        self.assertEqual(retained, {second, third, fourth})
        self.assertNotIn(first, retained)
        self.assertEqual(self.store.read_resolved_payload("etf_detail", "VYMI"), {"ticker": "VYMI", "suffix": "d"})

    def test_rollback_is_limited_to_newest_three_committed_generations(self):
        first, _, _ = self.commit_primary()
        second, _, second_selected = self.commit_next(suffix="b", observed_at="2026-07-10T03:00:00Z")
        self.commit_next(suffix="c", observed_at="2026-07-10T04:00:00Z")
        fourth, _, _ = self.commit_next(suffix="d", observed_at="2026-07-10T05:00:00Z")
        with self.assertRaises(ConcurrencyError):
            self.store.rollback_domain(
                "etf_detail",
                target_transaction_id=first,
                expected_active_transaction_id=fourth,
                decided_at="2026-07-10T06:00:00Z",
            )
        rolled = self.store.rollback_domain(
            "etf_detail",
            target_transaction_id=second,
            expected_active_transaction_id=fourth,
            decided_at="2026-07-10T06:00:01Z",
        )
        self.assertEqual(rolled["transaction_id"], second)
        self.assertEqual(rolled["current"]["VYMI"], second_selected)

    def test_four_live_prepared_generations_are_pinned_and_fifth_is_rejected(self):
        active_id, _, _ = self.commit_primary()
        prepared = []
        for index, suffix in enumerate(("b", "c", "d", "e"), start=3):
            transaction_id, _, _ = self.prepare_next(
                suffix=suffix,
                observed_at=f"2026-07-10T0{index}:00:00Z",
                expected_active_transaction_id=active_id,
            )
            prepared.append(transaction_id)
        with self.assertRaises(ConcurrencyError):
            self.prepare_next(
                suffix="f",
                observed_at="2026-07-10T07:00:00Z",
                expected_active_transaction_id=active_id,
            )
        generations = self.root / "domains/etf_detail/generations"
        self.assertEqual({path.name for path in generations.iterdir() if path.is_dir()}, {active_id, *prepared})

    def test_stale_prepared_generations_are_reconciled_after_24_hours(self):
        now = [dt.datetime(2026, 7, 10, 2, tzinfo=dt.timezone.utc)]
        self.store = DataSupplyStateStore(self.root, provider_truth_root=self.root, now_fn=lambda: now[0])
        active_id, _, _ = self.commit_primary()
        for index, suffix in enumerate(("b", "c", "d", "e"), start=3):
            self.prepare_next(
                suffix=suffix,
                observed_at=f"2026-07-10T0{index}:00:00Z",
                expected_active_transaction_id=active_id,
            )
        now[0] += dt.timedelta(hours=24, seconds=1)
        fifth, _, _ = self.prepare_next(
            suffix="f",
            observed_at="2026-07-11T07:00:01Z",
            expected_active_transaction_id=active_id,
        )
        generations = self.root / "domains/etf_detail/generations"
        self.assertEqual({path.name for path in generations.iterdir() if path.is_dir()}, {active_id, fifth})

    def test_prepared_generation_expires_at_exact_24_hour_boundary(self):
        now = [dt.datetime(2026, 7, 10, 2, tzinfo=dt.timezone.utc)]
        self.store = DataSupplyStateStore(self.root, provider_truth_root=self.root, now_fn=lambda: now[0])
        active_id, _, _ = self.commit_primary()
        prepared, _, _ = self.prepare_next(
            suffix="b",
            observed_at="2026-07-10T03:00:00Z",
            expected_active_transaction_id=active_id,
        )
        now[0] += dt.timedelta(hours=24)
        with self.assertRaises(ConcurrencyError):
            self.store.commit_prepared("etf_detail", prepared)
        self.assertEqual(self.store.read_active_domain("etf_detail")["transaction_id"], active_id)

    def test_provider_lkg_pending_prepared_and_migration_pins_survive_prune(self):
        self.commit_primary()
        prepared, _, prepared_selected = self.prepare_next(
            suffix="c",
            observed_at="2026-07-10T04:00:00Z",
        )
        pending_row = observation(suffix="d", observed_at="2026-07-10T05:00:00Z")
        pending_ref = self.store.store_provider_object(
            observation=pending_row,
            payload=canonical_json_bytes({"ticker": "VYMI", "suffix": "d"}),
        )
        lkg_ref = self.store.store_provider_lkg(
            provider="stockanalysis",
            domain="etf_detail",
            entity="PINLKG",
            payload={"ticker": "PINLKG"},
            meaningful_transition=True,
            expected_latest_sha256=None,
        )
        migration_payload = canonical_json_bytes({"ticker": "MIGRATION"})
        migration_sha = hashlib.sha256(migration_payload).hexdigest()
        migration_relative = f"providers/yf/etf_detail/objects/MIGRATION/{migration_sha}.json"
        migration_object = self.root / migration_relative
        migration_object.parent.mkdir(parents=True, exist_ok=True)
        migration_object.write_bytes(migration_payload)
        migration = {
            "schema_version": "data-supply-migration/v1",
            "domain": "etf_detail",
            "payload_refs": [{"path": migration_relative, "sha256": migration_sha}],
        }
        migration_path = self.root / "domains/etf_detail/migration.json"
        migration_path.write_bytes(canonical_json_bytes(migration) + b"\n")
        unused_payload = canonical_json_bytes({"ticker": "UNUSED"})
        unused_sha = hashlib.sha256(unused_payload).hexdigest()
        unused = self.root / f"providers/yf/etf_detail/objects/UNUSED/{unused_sha}.json"
        unused.parent.mkdir(parents=True, exist_ok=True)
        unused.write_bytes(unused_payload)

        report = self.store.prune_domain("etf_detail")

        self.assertIsNone(report["skipped"])
        self.assertFalse(unused.exists())
        self.assertTrue((self.root / pending_ref["path"]).exists())
        self.assertTrue((self.root / prepared_selected["payload_ref"]["path"]).exists())
        self.assertTrue((self.root / lkg_ref["path"]).exists())
        self.assertTrue(migration_object.exists())
        self.assertTrue((self.root / "domains/etf_detail/generations" / prepared).exists())

    def test_corrupt_pending_pin_causes_prune_to_delete_zero(self):
        row = observation()
        ref = self.store.store_provider_object(
            observation=row,
            payload=canonical_json_bytes({"ticker": "VYMI", "suffix": "a"}),
        )
        distractor = self.root / "providers/stockanalysis/etf_detail/objects/VYMI" / f"{'f' * 64}.json"
        distractor.write_bytes(b'{}')
        pending = self.root / ref["pending_path"]
        pending.write_text('{"corrupt":true}\n', encoding="utf-8")
        report = self.store.prune_domain("etf_detail")
        self.assertEqual(report["deleted_objects"], 0)
        self.assertTrue(distractor.exists())

    def test_decision_binds_recorded_valid_and_invalid_evidence(self):
        active_id, _, _ = self.commit_primary()
        invalid = observation(
            status="invalid",
            suffix="invalid",
            observed_at="2026-07-10T02:30:00Z",
        )
        valid = observation(
            suffix="evidence",
            observed_at="2026-07-10T02:45:00Z",
            provider="yahoo_finance",
        )
        self.store.record_observation(invalid)
        self.store.record_observation(valid)
        transaction_id, _, _ = self.prepare_next(
            suffix="b",
            observed_at="2026-07-10T03:00:00Z",
            expected_active_transaction_id=active_id,
            evidence_observations=[valid, invalid],
        )
        generation = self.root / "domains/etf_detail/generations" / transaction_id
        decision = json.loads((generation / "decision.json").read_text(encoding="utf-8"))
        self.assertEqual(decision["evidence_event_ids"], sorted([invalid["event_id"], valid["event_id"]]))

    def test_unrecorded_or_wrong_entity_evidence_cannot_prepare(self):
        active_id, _, _ = self.commit_primary()
        invalid = observation(status="invalid", suffix="invalid", observed_at="2026-07-10T02:30:00Z")
        with self.assertRaises(SchemaError):
            self.prepare_next(
                suffix="b",
                observed_at="2026-07-10T03:00:00Z",
                expected_active_transaction_id=active_id,
                evidence_observations=[invalid],
            )

    def test_invalid_evidence_cannot_advance_recovery(self):
        active_id, candidate, _ = self.commit_primary()
        invalid = observation(
            status="invalid",
            suffix="invalid",
            observed_at="2026-07-10T02:30:00Z",
        )
        self.store.record_observation(invalid)
        active = self.store.read_active_domain("etf_detail")
        recovery = dict(active["recovery"])
        recovery["VYMI"] = {
            "consecutive_green": 2,
            "last_transition": "primary_recovery_observation",
        }
        with self.assertRaises(SchemaError):
            self.store.prepare_transition(
                domain="etf_detail",
                entity="VYMI",
                current=active["current"],
                lkg=active["lkg"],
                recovery=recovery,
                candidate_observations=[candidate],
                evidence_observations=[invalid],
                expected_active_transaction_id=active_id,
                transition="primary_recovery_observation",
                reason_code="primary_recovery_pending",
                recovery_green_count=2,
                decided_at="2026-07-10T02:31:00Z",
            )

    def test_unavailable_removes_current_retains_lkg_and_evidence_history(self):
        active_id, _, selected = self.commit_primary()
        primary_failure = observation(
            status="invalid",
            suffix="primary-failure",
            observed_at="2026-07-25T02:00:00Z",
        )
        fallback_failure = observation(
            status="invalid",
            suffix="fallback-failure",
            observed_at="2026-07-25T02:00:01Z",
            provider="yahoo_finance",
        )
        self.store.record_observation(primary_failure)
        self.store.record_observation(fallback_failure)
        unavailable_id = self.store.prepare_unavailable_transition(
            domain="etf_detail",
            entity="VYMI",
            evidence_observations=[fallback_failure, primary_failure],
            expected_active_transaction_id=active_id,
            reason_code="all_authorities_exhausted",
            decided_at="2026-07-25T02:00:02Z",
        )
        committed = self.store.commit_prepared("etf_detail", unavailable_id)
        self.assertNotIn("VYMI", committed["current"])
        self.assertEqual(committed["lkg"]["VYMI"], selected)
        self.assertEqual(committed["recovery"]["VYMI"]["consecutive_green"], 0)
        self.assertEqual(
            committed["decision"]["evidence_event_ids"],
            sorted([primary_failure["event_id"], fallback_failure["event_id"]]),
        )
        with self.assertRaises(UnavailableError):
            self.store.read_resolved_payload("etf_detail", "VYMI")
        self.assertTrue((self.root / selected["payload_ref"]["path"]).exists())

    def test_unavailable_rejects_fresh_provider_or_unexpired_lkg(self):
        active_id, _, _ = self.commit_primary()
        fresh_primary = observation(suffix="fresh", observed_at="2026-07-10T03:00:00Z")
        fallback_failure = observation(
            status="invalid",
            suffix="fallback-failure",
            observed_at="2026-07-10T03:00:01Z",
            provider="yahoo_finance",
        )
        self.store.record_observation(fresh_primary)
        self.store.record_observation(fallback_failure)
        with self.assertRaises(SchemaError):
            self.store.prepare_unavailable_transition(
                domain="etf_detail",
                entity="VYMI",
                evidence_observations=[fresh_primary, fallback_failure],
                expected_active_transaction_id=active_id,
                reason_code="all_authorities_exhausted",
                decided_at="2026-07-10T03:00:02Z",
            )

        primary_failure = observation(status="invalid", suffix="primary-failure", observed_at="2026-07-10T03:01:00Z")
        self.store.record_observation(primary_failure)
        with self.assertRaises(SchemaError):
            self.store.prepare_unavailable_transition(
                domain="etf_detail",
                entity="VYMI",
                evidence_observations=[primary_failure, fallback_failure],
                expected_active_transaction_id=active_id,
                reason_code="all_authorities_exhausted",
                decided_at="2026-07-10T03:01:01Z",
            )

    def test_unavailable_generation_can_rollback_to_retained_payload(self):
        active_id, _, _ = self.commit_primary()
        failures = [
            observation(status="invalid", suffix="primary-failure", observed_at="2026-07-25T02:00:00Z"),
            observation(
                status="invalid",
                suffix="fallback-failure",
                observed_at="2026-07-25T02:00:01Z",
                provider="yahoo_finance",
            ),
        ]
        for row in failures:
            self.store.record_observation(row)
        unavailable_id = self.store.prepare_unavailable_transition(
            domain="etf_detail",
            entity="VYMI",
            evidence_observations=failures,
            expected_active_transaction_id=active_id,
            reason_code="all_authorities_exhausted",
            decided_at="2026-07-25T02:00:02Z",
        )
        self.store.commit_prepared("etf_detail", unavailable_id)
        self.store.rollback_domain(
            "etf_detail",
            target_transaction_id=active_id,
            expected_active_transaction_id=unavailable_id,
            decided_at="2026-07-25T02:00:03Z",
        )
        self.assertEqual(self.store.read_resolved_payload("etf_detail", "VYMI"), {"ticker": "VYMI", "suffix": "a"})

    def test_unavailable_crash_matrix_preserves_one_atomic_state(self):
        cases = {
            "after_write_current": True,
            "after_write_lkg": True,
            "after_write_recovery": True,
            "after_write_decision": True,
            "after_write_manifest": True,
            "after_generation_fsync": True,
            "active_after_temp_write": True,
            "active_after_temp_fsync": True,
            "active_after_replace_before_dir_fsync": False,
            "active_after_dir_fsync": False,
            "after_active_replace": False,
            "before_resolution_append": False,
        }
        for failpoint, current_present in cases.items():
            with self.subTest(failpoint=failpoint), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                self.root = root
                self.store = DataSupplyStateStore(root, provider_truth_root=root)
                self.commit_primary()
                result = subprocess.run(
                    [
                        sys.executable,
                        str(CRASH_PROBE),
                        str(root),
                        "--mode",
                        "unavailable",
                        "--failpoint",
                        failpoint,
                    ],
                    check=False,
                )
                self.assertEqual(result.returncode, 91)
                active = DataSupplyStateStore(root).read_active_domain("etf_detail")
                self.assertEqual("VYMI" in active["current"], current_present)
                if current_present:
                    self.assertEqual(DataSupplyStateStore(root).read_resolved_payload("etf_detail", "VYMI")["suffix"], "a")

    def test_prune_crash_is_pin_safe_and_recovery_is_idempotent(self):
        for failpoint, exists_after_crash in (
            ("before_provider_object_unlink", True),
            ("after_provider_object_unlink", False),
        ):
            with self.subTest(failpoint=failpoint), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                self.root = root
                self.store = DataSupplyStateStore(root, provider_truth_root=root)
                self.commit_primary()
                payload = canonical_json_bytes({"ticker": "UNUSED"})
                sha256 = hashlib.sha256(payload).hexdigest()
                unused = root / f"providers/yf/etf_detail/objects/UNUSED/{sha256}.json"
                unused.parent.mkdir(parents=True, exist_ok=True)
                unused.write_bytes(payload)
                crashed = subprocess.run(
                    [
                        sys.executable,
                        str(CRASH_PROBE),
                        str(root),
                        "--mode",
                        "prune",
                        "--failpoint",
                        failpoint,
                    ],
                    check=False,
                )
                self.assertEqual(crashed.returncode, 91)
                self.assertEqual(unused.exists(), exists_after_crash)
                self.assertEqual(DataSupplyStateStore(root).read_resolved_payload("etf_detail", "VYMI")["suffix"], "a")
                retried = subprocess.run(
                    [sys.executable, str(CRASH_PROBE), str(root), "--mode", "prune"],
                    check=False,
                )
                self.assertEqual(retried.returncode, 0)
                self.assertFalse(unused.exists())
                self.assertEqual(DataSupplyStateStore(root).read_resolved_payload("etf_detail", "VYMI")["suffix"], "a")

    def test_disk_full_faults_preserve_authoritative_active_payload_bytes(self):
        first_id, _, first_selected = self.commit_primary()

        def disk_full_at(target):
            def fail(point):
                if point == target:
                    raise OSError("simulated ENOSPC")
            return fail

        row = observation(suffix="disk", observed_at="2026-07-10T02:30:00Z")
        with self.assertRaises(OSError):
            DataSupplyStateStore(self.root, failpoint_hook=disk_full_at("provider_object_after_temp_write")).store_provider_object(
                observation=row,
                payload=canonical_json_bytes({"ticker": "VYMI", "suffix": "disk"}),
            )
        self.assertEqual(self.store.read_resolved_payload("etf_detail", "VYMI")["suffix"], "a")

        second_id, _, _ = self.prepare_next(suffix="b", observed_at="2026-07-10T03:00:00Z")
        with self.assertRaises(OSError):
            DataSupplyStateStore(self.root, failpoint_hook=disk_full_at("active_after_temp_write")).commit_prepared(
                "etf_detail", second_id
            )
        self.assertEqual(self.store.read_active_domain("etf_detail")["transaction_id"], first_id)
        self.assertTrue((self.root / first_selected["payload_ref"]["path"]).exists())

        self.store.commit_prepared("etf_detail", second_id)
        self.commit_next(suffix="c", observed_at="2026-07-10T04:00:00Z")
        previous = self.store.read_active_domain("etf_detail")["current"]["VYMI"]
        fourth_id, _, _ = self.prepare_next(suffix="d", observed_at="2026-07-10T05:00:00Z")
        with self.assertRaises(OSError):
            DataSupplyStateStore(self.root, failpoint_hook=disk_full_at("before_generation_unlink")).commit_prepared(
                "etf_detail", fourth_id
            )
        self.assertEqual(self.store.read_active_domain("etf_detail")["transaction_id"], fourth_id)
        self.assertTrue((self.root / previous["payload_ref"]["path"]).exists())

    def test_active_current_rejects_mutable_provider_truth_ref(self):
        row = observation()
        materialize_provider_truth(self.root, row)
        self.store.record_observation(row)
        selected = build_selection(
            row,
            selected_at="2026-07-10T02:00:00Z",
            resolution_state="fresh_primary",
            reason_code="primary_valid",
            fallback_depth=0,
            payload_ref_kind="provider_truth",
        )
        with self.assertRaises(SchemaError):
            self.store.prepare_transition(
                domain="etf_detail",
                entity="VYMI",
                current={"VYMI": selected},
                lkg={},
                recovery={"VYMI": {"consecutive_green": 1, "last_transition": "initial_primary"}},
                candidate_observations=[row],
                expected_active_transaction_id=None,
                transition="initial_primary",
                reason_code="primary_valid",
                recovery_green_count=1,
                decided_at="2026-07-10T02:00:00Z",
            )

    def test_resolved_payload_reads_selected_immutable_object(self):
        _, row, selected = self.commit_primary()
        resolved = self.store.read_resolved_payload("etf_detail", "VYMI")
        self.assertEqual(resolved, {"ticker": "VYMI", "suffix": "a"})
        (self.root / row["provider_path"]).write_bytes(b'{"ticker":"MUTATED"}')
        self.assertEqual(self.store.read_resolved_payload("etf_detail", "VYMI"), resolved)
        self.assertEqual(selected["payload_ref"]["kind"], "provider_object")

    def test_event_id_mismatch_and_path_escape_fail_closed(self):
        bad_id = observation()
        bad_id["event_id"] = "0" * 64
        with self.assertRaises(SchemaError):
            self.store.record_observation(bad_id)
        bad_path = observation()
        bad_path["provider_path"] = "../../secret.json"
        bad_path["event_id"] = deterministic_event_id("observation", bad_path)
        with self.assertRaises(SchemaError):
            self.store.record_observation(bad_path)

    def test_payload_unavailable_observation_extension_is_digest_bound(self):
        row = observation(status="invalid")
        row["payload_available"] = False
        row["failure_detail_sha256"] = "f" * 64
        descriptor = {
            "provider": row["provider"],
            "endpoint_family": row["endpoint_family"],
            "domain": row["domain"],
            "entity": row["entity"],
            "observed_at": row["observed_at"],
            "reason_code": row["reason_code"],
            "failure_detail_sha256": row["failure_detail_sha256"],
        }
        row["payload_sha256"] = canonical_sha256(descriptor)
        row["event_id"] = deterministic_event_id("observation", row)
        self.assertTrue(self.store.record_observation(row))
        bad = dict(row)
        bad["failure_detail_sha256"] = "e" * 64
        bad["event_id"] = deterministic_event_id("observation", bad)
        with self.assertRaises(SchemaError):
            self.store.record_observation(bad)
        invalid_valid = dict(row)
        invalid_valid["validation_status"] = "valid"
        invalid_valid["event_id"] = deterministic_event_id("observation", invalid_valid)
        with self.assertRaises(SchemaError):
            self.store.record_observation(invalid_valid)

    def test_partial_jsonl_tail_is_recovered_and_duplicate_stays_single(self):
        row = observation()
        self.store.record_observation(row)
        history = self.root / "history" / "observations" / "2026-07-10.jsonl"
        with history.open("ab") as handle:
            handle.write(b'{"partial":')
        self.assertFalse(DataSupplyStateStore(self.root, provider_truth_root=self.root).record_observation(row))
        lines = history.read_text(encoding="utf-8").splitlines()
        self.assertEqual(len(lines), 1)
        self.assertEqual(json.loads(lines[0])["event_id"], row["event_id"])

    def test_valid_jsonl_tail_without_newline_is_preserved(self):
        first = observation()
        self.store.record_observation(first)
        history = self.root / "history" / "observations" / "2026-07-10.jsonl"
        history.write_bytes(history.read_bytes().rstrip(b"\n"))
        second = observation(suffix="b")
        self.assertTrue(self.store.record_observation(second))
        rows = [json.loads(line) for line in history.read_text(encoding="utf-8").splitlines()]
        self.assertEqual([row["event_id"] for row in rows], [first["event_id"], second["event_id"]])

    def test_concurrent_observation_append_is_one_event(self):
        commands = [
            [sys.executable, str(CRASH_PROBE), str(self.root), "--mode", "record"]
            for _ in range(2)
        ]
        procs = [subprocess.Popen(command) for command in commands]
        self.assertEqual([proc.wait() for proc in procs], [0, 0])
        history = self.root / "history" / "observations" / "2026-07-10.jsonl"
        self.assertEqual(len(history.read_text(encoding="utf-8").splitlines()), 1)

    def test_corrupt_complete_history_row_fails_closed(self):
        first = observation()
        self.store.record_observation(first)
        history = self.root / "history" / "observations" / "2026-07-10.jsonl"
        with history.open("ab") as handle:
            handle.write(b'{"event_id":"not-valid"}\n')
        with self.assertRaises(IntegrityError):
            self.store.record_observation(observation(suffix="b"))

    def test_state_root_symlink_escape_is_rejected(self):
        with tempfile.TemporaryDirectory() as outside:
            (self.root / "providers").symlink_to(outside, target_is_directory=True)
            with self.assertRaises(SchemaError):
                self.store.store_provider_lkg(
                    provider="stockanalysis",
                    domain="etf_detail",
                    entity="VYMI",
                    payload={"ticker": "VYMI"},
                    meaningful_transition=True,
                    expected_latest_sha256=None,
                )

    def test_selection_age_and_ttl_boundaries_use_source_stamp(self):
        selected = selection(observation())
        self.assertEqual(selected["age_seconds"], 7200)
        self.assertEqual(selection_age_status("fresh_primary", 168 * 3600), "fresh")
        self.assertEqual(selection_age_status("fresh_primary", 168 * 3600 + 1), "stale")
        self.assertEqual(selection_age_status("lkg_primary", 14 * 86400), "stale")
        self.assertEqual(selection_age_status("lkg_primary", 14 * 86400 + 1), "unavailable")

    def test_future_naive_and_malformed_source_stamps_are_rejected(self):
        for source_as_of in ("2026-07-11T00:00:00Z", "2026-07-10T00:00:00", "not-a-date"):
            row = observation()
            row["source_as_of"] = source_as_of
            row["event_id"] = deterministic_event_id("observation", row)
            with self.assertRaises(SchemaError, msg=source_as_of):
                selection(row)

    def test_prepare_commit_reads_one_generation_and_appends_resolution(self):
        transaction_id, _, selected = self.commit_primary()
        active = self.store.read_active_domain("etf_detail")
        self.assertEqual(active["transaction_id"], transaction_id)
        self.assertEqual(active["current"]["VYMI"], selected)
        generation = self.root / "domains" / "etf_detail" / "generations" / transaction_id
        self.assertTrue((generation / "current.json").exists())
        self.assertTrue((generation / "manifest.json").exists())
        history = self.root / "history" / "resolutions" / "2026-07-10.jsonl"
        self.assertEqual(len(history.read_text(encoding="utf-8").splitlines()), 1)

    def test_unrecorded_candidate_cannot_prepare(self):
        row = observation()
        materialize_provider_truth(self.root, row)
        with self.assertRaises(SchemaError):
            self.store.prepare_transition(
                domain="etf_detail",
                entity="VYMI",
                current={"VYMI": selection(row)},
                lkg={},
                recovery={"VYMI": {"consecutive_green": 1, "last_transition": "initial_primary"}},
                candidate_observations=[row],
                expected_active_transaction_id=None,
                transition="initial_primary",
                reason_code="primary_valid",
                recovery_green_count=1,
                decided_at="2026-07-10T02:00:00Z",
            )

    def test_missing_or_digest_mismatched_provider_object_cannot_prepare(self):
        for mode in ("missing", "mismatch"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                store = DataSupplyStateStore(root, provider_truth_root=root)
                row = observation()
                store.record_observation(row)
                if mode == "mismatch":
                    path = root / provider_object_path(row)
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(b"different-payload")
                with self.assertRaises(IntegrityError):
                    store.prepare_transition(
                        domain="etf_detail",
                        entity="VYMI",
                        current={"VYMI": selection(row)},
                        lkg={},
                        recovery={"VYMI": {"consecutive_green": 1, "last_transition": "initial_primary"}},
                        candidate_observations=[row],
                        expected_active_transaction_id=None,
                        transition="initial_primary",
                        reason_code="primary_valid",
                        recovery_green_count=1,
                        decided_at="2026-07-10T02:00:00Z",
                    )

    def test_invalid_or_mixed_candidate_batch_cannot_prepare(self):
        valid = observation()
        invalid = observation(status="invalid", suffix="b")
        with self.assertRaises(SchemaError):
            self.store.prepare_transition(
                domain="etf_detail",
                entity="VYMI",
                current={"VYMI": selection(valid)},
                lkg={},
                recovery={},
                candidate_observations=[valid, invalid],
                expected_active_transaction_id=None,
                transition="initial_primary",
                reason_code="primary_valid",
                recovery_green_count=1,
                decided_at="2026-07-10T02:00:00Z",
            )
        self.assertIsNone(self.store.read_active_domain("etf_detail")["transaction_id"])

    def test_stale_writer_is_rejected_and_cannot_lose_update(self):
        first_id, _, first_selected = self.commit_primary()
        row = observation(observed_at="2026-07-10T03:00:00Z", suffix="b")
        materialize_provider_truth(self.root, row)
        self.store.record_observation(row)
        second = selection(row, state="fresh_fallback", selected_at="2026-07-10T03:00:00Z")
        lkg_selected = materialize_provider_lkg(self.store, first_selected)
        kwargs = dict(
            domain="etf_detail",
            entity="VYMI",
            current={"VYMI": second},
            lkg={"VYMI": lkg_selected},
            recovery={"VYMI": {"consecutive_green": 0, "last_transition": "primary_to_fallback"}},
            candidate_observations=[row],
            expected_active_transaction_id=first_id,
            transition="primary_to_fallback",
            reason_code="primary_unavailable_fallback_valid",
            recovery_green_count=0,
            decided_at="2026-07-10T03:00:00Z",
        )
        prepared_one = self.store.prepare_transition(**kwargs)
        kwargs["decided_at"] = "2026-07-10T03:00:01Z"
        prepared_two = self.store.prepare_transition(**kwargs)
        self.store.commit_prepared("etf_detail", prepared_one)
        with self.assertRaises(ConcurrencyError):
            self.store.commit_prepared("etf_detail", prepared_two)

    def test_two_process_commit_race_has_exactly_one_winner(self):
        first_id, _, first_selected = self.commit_primary()
        row = observation(observed_at="2026-07-10T03:00:00Z", suffix="b")
        materialize_provider_truth(self.root, row)
        self.store.record_observation(row)
        selected = selection(row, state="fresh_fallback", selected_at="2026-07-10T03:00:00Z")
        lkg_selected = materialize_provider_lkg(self.store, first_selected)
        common = dict(
            domain="etf_detail",
            entity="VYMI",
            current={"VYMI": selected},
            lkg={"VYMI": lkg_selected},
            recovery={"VYMI": {"consecutive_green": 0, "last_transition": "primary_to_fallback"}},
            candidate_observations=[row],
            expected_active_transaction_id=first_id,
            transition="primary_to_fallback",
            reason_code="primary_unavailable_fallback_valid",
            recovery_green_count=0,
        )
        one = self.store.prepare_transition(**common, decided_at="2026-07-10T03:00:00Z")
        two = self.store.prepare_transition(**common, decided_at="2026-07-10T03:00:01Z")
        procs = [
            subprocess.Popen([sys.executable, str(CRASH_PROBE), str(self.root), "--transaction-id", transaction_id])
            for transaction_id in (one, two)
        ]
        self.assertEqual(sorted(proc.wait() for proc in procs), [0, 73])
        self.assertIn(self.store.read_active_domain("etf_detail")["transaction_id"], {one, two})

    def test_crashes_before_pointer_commit_keep_prior_active(self):
        failpoints = (
            "after_write_current",
            "after_write_lkg",
            "after_write_recovery",
            "after_write_decision",
            "after_write_manifest",
            "after_generation_fsync",
        )
        for failpoint in failpoints:
            with self.subTest(failpoint=failpoint), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                store = DataSupplyStateStore(root, provider_truth_root=root)
                self.root, self.store = root, store
                first_id, _, _ = self.commit_primary()
                result = subprocess.run(
                    [sys.executable, str(CRASH_PROBE), str(root), "--failpoint", failpoint],
                    check=False,
                )
                self.assertEqual(result.returncode, 91)
                recovered = DataSupplyStateStore(root, provider_truth_root=root).recover_domain("etf_detail")
                self.assertEqual(recovered["transaction_id"], first_id)

    def test_initial_crash_leaves_empty_active_and_retry_can_commit(self):
        result = subprocess.run(
            [sys.executable, str(CRASH_PROBE), str(self.root), "--failpoint", "after_write_current"],
            check=False,
        )
        self.assertEqual(result.returncode, 91)
        self.assertIsNone(self.store.read_active_domain("etf_detail")["transaction_id"])
        retry = subprocess.run([sys.executable, str(CRASH_PROBE), str(self.root)], check=False)
        self.assertEqual(retry.returncode, 0)
        self.assertIsNotNone(self.store.read_active_domain("etf_detail")["transaction_id"])

    def test_generation_atomic_writer_internal_crashes_never_change_active(self):
        failpoints = (
            "generation_current_after_temp_write",
            "generation_current_after_temp_fsync",
            "generation_current_after_replace_before_dir_fsync",
            "generation_manifest_after_replace_before_dir_fsync",
        )
        for failpoint in failpoints:
            with self.subTest(failpoint=failpoint), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                self.root = root
                self.store = DataSupplyStateStore(root, provider_truth_root=root)
                first_id, _, _ = self.commit_primary()
                result = subprocess.run(
                    [sys.executable, str(CRASH_PROBE), str(root), "--failpoint", failpoint],
                    check=False,
                )
                self.assertEqual(result.returncode, 91)
                self.assertEqual(self.store.read_active_domain("etf_detail")["transaction_id"], first_id)

    def test_active_atomic_writer_crash_boundary_is_recoverable(self):
        cases = {
            "active_after_temp_write": False,
            "active_after_temp_fsync": False,
            "active_after_replace_before_dir_fsync": True,
            "active_after_dir_fsync": True,
        }
        for failpoint, committed in cases.items():
            with self.subTest(failpoint=failpoint), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                self.root = root
                self.store = DataSupplyStateStore(root, provider_truth_root=root)
                first_id, _, _ = self.commit_primary()
                result = subprocess.run(
                    [sys.executable, str(CRASH_PROBE), str(root), "--failpoint", failpoint],
                    check=False,
                )
                self.assertEqual(result.returncode, 91)
                active = self.store.read_active_domain("etf_detail")
                self.assertEqual(active["transaction_id"] != first_id, committed)
                recovered = self.store.recover_domain("etf_detail")
                self.assertEqual(recovered["transaction_id"], active["transaction_id"])

    def test_crash_after_active_pointer_is_recovered_into_resolution_history(self):
        first_id, _, _ = self.commit_primary()
        result = subprocess.run(
            [sys.executable, str(CRASH_PROBE), str(self.root), "--failpoint", "after_active_replace"],
            check=False,
        )
        self.assertEqual(result.returncode, 91)
        before = self.store.read_active_domain("etf_detail")
        self.assertNotEqual(before["transaction_id"], first_id)
        history = self.root / "history" / "resolutions" / "2026-07-10.jsonl"
        self.assertEqual(len(history.read_text(encoding="utf-8").splitlines()), 1)
        self.store.recover_domain("etf_detail")
        self.assertEqual(len(history.read_text(encoding="utf-8").splitlines()), 2)

    def test_crash_immediately_before_resolution_append_is_recovered(self):
        first_id, _, _ = self.commit_primary()
        result = subprocess.run(
            [sys.executable, str(CRASH_PROBE), str(self.root), "--failpoint", "before_resolution_append"],
            check=False,
        )
        self.assertEqual(result.returncode, 91)
        active = self.store.read_active_domain("etf_detail")
        self.assertNotEqual(active["transaction_id"], first_id)
        history = self.root / "history" / "resolutions" / "2026-07-10.jsonl"
        self.assertEqual(len(history.read_text(encoding="utf-8").splitlines()), 1)
        self.store.recover_domain("etf_detail")
        self.assertEqual(len(history.read_text(encoding="utf-8").splitlines()), 2)

    def test_concurrent_resolution_recovery_appends_one_event(self):
        self.commit_primary()
        result = subprocess.run(
            [sys.executable, str(CRASH_PROBE), str(self.root), "--failpoint", "after_active_replace"],
            check=False,
        )
        self.assertEqual(result.returncode, 91)
        commands = [[sys.executable, str(CRASH_PROBE), str(self.root), "--mode", "recover"] for _ in range(2)]
        procs = [subprocess.Popen(command) for command in commands]
        self.assertEqual([proc.wait() for proc in procs], [0, 0])
        history = self.root / "history" / "resolutions" / "2026-07-10.jsonl"
        self.assertEqual(len(history.read_text(encoding="utf-8").splitlines()), 2)

    def test_corrupt_active_missing_member_and_digest_mismatch_fail_closed(self):
        transaction_id, _, _ = self.commit_primary()
        active_path = self.root / "domains" / "etf_detail" / "active.json"
        original = active_path.read_bytes()
        active_path.write_text("{", encoding="utf-8")
        with self.assertRaises(IntegrityError):
            self.store.read_active_domain("etf_detail")
        active_path.write_bytes(original)
        generation = self.root / "domains" / "etf_detail" / "generations" / transaction_id
        current_path = generation / "current.json"
        current_original = current_path.read_bytes()
        current_path.write_text("{}\n", encoding="utf-8")
        with self.assertRaises(IntegrityError):
            self.store.read_active_domain("etf_detail")
        current_path.write_bytes(current_original)
        (generation / "lkg.json").unlink()
        with self.assertRaises(IntegrityError):
            self.store.read_active_domain("etf_detail")

    def test_active_decision_must_be_bound_to_pointer_transaction(self):
        transaction_id, _, _ = self.commit_primary()
        active_path = self.root / "domains" / "etf_detail" / "active.json"
        active = json.loads(active_path.read_text(encoding="utf-8"))
        generation_decision = json.loads(
            (self.root / "domains" / "etf_detail" / "generations" / transaction_id / "decision.json").read_text(
                encoding="utf-8"
            )
        )
        active["decision"] = generation_decision
        active_path.write_text(json.dumps(active), encoding="utf-8")
        with self.assertRaises(IntegrityError):
            self.store.read_active_domain("etf_detail")

    def test_provider_lkg_is_content_addressed_and_old_reference_survives(self):
        first = self.store.store_provider_lkg(
            provider="stockanalysis",
            domain="etf_detail",
            entity="VYMI",
            payload={"ticker": "VYMI", "value": 1},
            meaningful_transition=True,
            expected_latest_sha256=None,
        )
        second = self.store.store_provider_lkg(
            provider="stockanalysis",
            domain="etf_detail",
            entity="VYMI",
            payload={"ticker": "VYMI", "value": 2},
            meaningful_transition=True,
            expected_latest_sha256=first["sha256"],
        )
        self.assertNotEqual(first["sha256"], second["sha256"])
        self.assertTrue((self.root / first["path"]).exists())
        self.assertTrue((self.root / second["path"]).exists())
        unchanged = self.store.store_provider_lkg(
            provider="stockanalysis",
            domain="etf_detail",
            entity="VYMI",
            payload={"ticker": "VYMI", "value": 3},
            meaningful_transition=False,
            expected_latest_sha256=second["sha256"],
        )
        self.assertEqual(unchanged["sha256"], second["sha256"])

    def test_provider_lkg_preserves_pretty_json_raw_bytes_and_sha(self):
        payload_bytes = b'{\n  "ticker": "VYMI",\n  "value": 1\n}\n'
        stored = self.store.store_provider_lkg(
            provider="stockanalysis",
            domain="etf_detail",
            entity="VYMI",
            payload=payload_bytes,
            meaningful_transition=True,
            expected_latest_sha256=None,
        )
        self.assertEqual(stored["sha256"], hashlib.sha256(payload_bytes).hexdigest())
        self.assertEqual((self.root / stored["path"]).read_bytes(), payload_bytes)
        row = observation()
        row["payload_sha256"] = stored["sha256"]
        row["event_id"] = deterministic_event_id("observation", row)
        rebound = bind_selection_to_provider_lkg(selection(row), stored)
        self.assertEqual(rebound["payload_ref"]["sha256"], stored["sha256"])

    def test_provider_lkg_ref_cannot_cross_provider_domain_or_entity_scope(self):
        payload = {"ticker": "VYMI", "suffix": "a"}
        wrong_ref = self.store.store_provider_lkg(
            provider="yf",
            domain="wrong_domain",
            entity="OTHER",
            payload=payload,
            meaningful_transition=True,
            expected_latest_sha256=None,
        )
        row = observation()
        prior = selection(row)
        self.assertEqual(wrong_ref["sha256"], prior["payload_sha256"])
        with self.assertRaises(SchemaError):
            bind_selection_to_provider_lkg(prior, wrong_ref)

    def test_provider_lkg_cas_and_selected_payload_digest_fail_closed(self):
        payload = {"ticker": "VYMI", "value": 1}
        stored = self.store.store_provider_lkg(
            provider="stockanalysis",
            domain="etf_detail",
            entity="VYMI",
            payload=payload,
            meaningful_transition=True,
            expected_latest_sha256=None,
        )
        with self.assertRaises(ConcurrencyError):
            self.store.store_provider_lkg(
                provider="stockanalysis",
                domain="etf_detail",
                entity="VYMI",
                payload={"ticker": "VYMI", "value": 2},
                meaningful_transition=True,
                expected_latest_sha256="0" * 64,
            )
        row = observation()
        row["payload_sha256"] = stored["sha256"]
        row["event_id"] = deterministic_event_id("observation", row)
        self.store.record_observation(row)
        selected = build_selection(
            row,
            selected_at="2026-07-10T02:00:00Z",
            resolution_state="lkg_primary",
            reason_code="primary_unavailable_lkg_valid",
            fallback_depth=1,
            payload_ref_kind="provider_lkg",
            payload_ref_path=stored["path"],
        )
        transaction_id = self.store.prepare_transition(
            domain="etf_detail",
            entity="VYMI",
            current={"VYMI": selected},
            lkg={},
            recovery={"VYMI": {"consecutive_green": 0, "last_transition": "initial_lkg"}},
            candidate_observations=[row],
            expected_active_transaction_id=None,
            transition="initial_lkg",
            reason_code="primary_unavailable_lkg_valid",
            recovery_green_count=0,
            decided_at="2026-07-10T02:00:00Z",
        )
        self.store.commit_prepared("etf_detail", transaction_id)
        (self.root / stored["path"]).write_text('{"ticker":"VYMI","value":9}\n', encoding="utf-8")
        with self.assertRaises(IntegrityError):
            self.store.read_active_domain("etf_detail")

    def test_provider_lkg_crash_windows_preserve_a_valid_latest_pointer(self):
        before_latest_commit = (
            "provider_lkg_object_after_temp_write",
            "provider_lkg_object_after_temp_fsync",
            "provider_lkg_object_after_replace_before_dir_fsync",
            "after_provider_lkg_object",
            "provider_lkg_latest_after_temp_write",
            "provider_lkg_latest_after_temp_fsync",
        )
        after_latest_commit = ("provider_lkg_latest_after_replace_before_dir_fsync", "provider_lkg_latest_after_dir_fsync")
        for failpoint in before_latest_commit + after_latest_commit:
            with self.subTest(failpoint=failpoint), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                store = DataSupplyStateStore(root, provider_truth_root=root)
                first = store.store_provider_lkg(
                    provider="stockanalysis",
                    domain="etf_detail",
                    entity="VYMI",
                    payload={"ticker": "VYMI", "value": 1},
                    meaningful_transition=True,
                    expected_latest_sha256=None,
                )
                result = subprocess.run(
                    [sys.executable, str(CRASH_PROBE), str(root), "--mode", "provider-lkg", "--failpoint", failpoint],
                    check=False,
                )
                self.assertEqual(result.returncode, 91)
                latest_path = root / "providers/stockanalysis/etf_detail/lkg/VYMI/latest.json"
                latest = json.loads(latest_path.read_text(encoding="utf-8"))
                expected = canonical_sha256({"ticker": "VYMI", "value": 2}) if failpoint in after_latest_commit else first["sha256"]
                self.assertEqual(latest["sha256"], expected)
                verified = DataSupplyStateStore(root, provider_truth_root=root).store_provider_lkg(
                    provider="stockanalysis",
                    domain="etf_detail",
                    entity="VYMI",
                    payload={"ignored": True},
                    meaningful_transition=False,
                    expected_latest_sha256=expected,
                )
                self.assertEqual(verified["sha256"], expected)

    def test_transition_cannot_inject_arbitrary_lkg_or_recovery(self):
        first_id, _, first_selected = self.commit_primary()
        row = observation(observed_at="2026-07-10T03:00:00Z", suffix="b")
        materialize_provider_truth(self.root, row)
        self.store.record_observation(row)
        selected = selection(row, state="fresh_fallback", selected_at="2026-07-10T03:00:00Z")
        lkg_selected = materialize_provider_lkg(self.store, first_selected)
        injected = dict(first_selected)
        injected["reason_code"] = "injected"
        cases = (
            ({"VYMI": injected}, {"VYMI": {"consecutive_green": 0, "last_transition": "primary_to_fallback"}}),
            ({"VYMI": lkg_selected}, {"VYMI": {"consecutive_green": 9, "last_transition": "primary_to_fallback"}}),
            ({"VYMI": lkg_selected}, {"VYMI": {"consecutive_green": 0, "last_transition": "wrong_transition"}}),
        )
        active_before = (self.root / "domains" / "etf_detail" / "active.json").read_bytes()
        for lkg, recovery in cases:
            with self.subTest(lkg=lkg, recovery=recovery), self.assertRaises(SchemaError):
                self.store.prepare_transition(
                    domain="etf_detail",
                    entity="VYMI",
                    current={"VYMI": selected},
                    lkg=lkg,
                    recovery=recovery,
                    candidate_observations=[row],
                    expected_active_transaction_id=first_id,
                    transition="primary_to_fallback",
                    reason_code="primary_unavailable_fallback_valid",
                    recovery_green_count=0,
                    decided_at="2026-07-10T03:00:00Z",
                )
        self.assertEqual((self.root / "domains" / "etf_detail" / "active.json").read_bytes(), active_before)

    def test_rollback_switches_pointer_without_deleting_generations_or_history(self):
        first_id, _, first_selected = self.commit_primary()
        result = subprocess.run([sys.executable, str(CRASH_PROBE), str(self.root)], check=False)
        self.assertEqual(result.returncode, 0)
        second_id = self.store.read_active_domain("etf_detail")["transaction_id"]
        rolled = self.store.rollback_domain(
            "etf_detail",
            target_transaction_id=first_id,
            expected_active_transaction_id=second_id,
            decided_at="2026-07-10T04:00:00Z",
        )
        self.assertEqual(rolled["transaction_id"], first_id)
        self.assertEqual(rolled["current"]["VYMI"], first_selected)
        generations = self.root / "domains" / "etf_detail" / "generations"
        self.assertTrue((generations / first_id).exists())
        self.assertTrue((generations / second_id).exists())
        resolution_history = self.root / "history" / "resolutions" / "2026-07-10.jsonl"
        self.assertEqual(len(resolution_history.read_text(encoding="utf-8").splitlines()), 3)

    def test_prepared_never_active_generation_cannot_be_rollback_target(self):
        first_id, _, first_selected = self.commit_primary()
        row = observation(observed_at="2026-07-10T03:00:00Z", suffix="b")
        materialize_provider_truth(self.root, row)
        self.store.record_observation(row)
        selected = selection(row, state="fresh_fallback", selected_at="2026-07-10T03:00:00Z")
        lkg_selected = materialize_provider_lkg(self.store, first_selected)
        orphan = self.store.prepare_transition(
            domain="etf_detail",
            entity="VYMI",
            current={"VYMI": selected},
            lkg={"VYMI": lkg_selected},
            recovery={"VYMI": {"consecutive_green": 0, "last_transition": "primary_to_fallback"}},
            candidate_observations=[row],
            expected_active_transaction_id=first_id,
            transition="primary_to_fallback",
            reason_code="primary_unavailable_fallback_valid",
            recovery_green_count=0,
            decided_at="2026-07-10T03:00:00Z",
        )
        with self.assertRaises(ConcurrencyError):
            self.store.rollback_domain(
                "etf_detail",
                target_transaction_id=orphan,
                expected_active_transaction_id=first_id,
                decided_at="2026-07-10T04:00:00Z",
            )
        self.assertEqual(self.store.read_active_domain("etf_detail")["transaction_id"], first_id)

    def test_same_decision_orphan_cannot_borrow_committed_lineage(self):
        first_id, _, first_selected = self.commit_primary()
        row = observation(observed_at="2026-07-10T03:00:00Z", suffix="b")
        materialize_provider_truth(self.root, row)
        self.store.record_observation(row)
        selected = selection(row, state="fresh_fallback", selected_at="2026-07-10T03:00:00Z")
        lkg_selected = materialize_provider_lkg(self.store, first_selected)
        kwargs = dict(
            domain="etf_detail",
            entity="VYMI",
            current={"VYMI": selected},
            lkg={"VYMI": lkg_selected},
            recovery={"VYMI": {"consecutive_green": 0, "last_transition": "primary_to_fallback"}},
            candidate_observations=[row],
            expected_active_transaction_id=first_id,
            transition="primary_to_fallback",
            reason_code="primary_unavailable_fallback_valid",
            recovery_green_count=0,
            decided_at="2026-07-10T03:00:00Z",
        )
        winner = self.store.prepare_transition(**kwargs)
        orphan = self.store.prepare_transition(**kwargs)
        self.assertNotEqual(winner, orphan)
        self.store.commit_prepared("etf_detail", winner)
        with self.assertRaises(ConcurrencyError):
            self.store.rollback_domain(
                "etf_detail",
                target_transaction_id=orphan,
                expected_active_transaction_id=winner,
                decided_at="2026-07-10T04:00:00Z",
            )

    def test_rollback_crash_after_pointer_is_recovered_into_history(self):
        first_id, _, _ = self.commit_primary()
        result = subprocess.run([sys.executable, str(CRASH_PROBE), str(self.root)], check=False)
        self.assertEqual(result.returncode, 0)
        second_id = self.store.read_active_domain("etf_detail")["transaction_id"]
        crashed = subprocess.run(
            [
                sys.executable,
                str(CRASH_PROBE),
                str(self.root),
                "--mode",
                "rollback",
                "--target-transaction-id",
                first_id,
                "--expected-active-transaction-id",
                second_id,
                "--failpoint",
                "before_resolution_append",
            ],
            check=False,
        )
        self.assertEqual(crashed.returncode, 91)
        self.assertEqual(self.store.read_active_domain("etf_detail")["transaction_id"], first_id)
        history = self.root / "history" / "resolutions" / "2026-07-10.jsonl"
        self.assertEqual(len(history.read_text(encoding="utf-8").splitlines()), 2)
        self.store.recover_domain("etf_detail")
        self.assertEqual(len(history.read_text(encoding="utf-8").splitlines()), 3)


if __name__ == "__main__":
    unittest.main()
