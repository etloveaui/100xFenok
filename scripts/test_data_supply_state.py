import hashlib
import json
import math
import subprocess
import sys
import tempfile
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
    bind_selection_to_provider_lkg,
    build_selection,
    canonical_json_bytes,
    canonical_sha256,
    deterministic_event_id,
    selection_age_status,
)


CRASH_PROBE = SCRIPT_DIR / "test_data_supply_state_crash_probe.py"


def observation(*, status="valid", observed_at="2026-07-10T02:00:00Z", suffix="a"):
    payload = {"ticker": "VYMI", "suffix": suffix}
    row = {
        "schema_version": "data-supply-observation/v1",
        "provider": "stockanalysis",
        "endpoint_family": "stockanalysis_etf_detail",
        "domain": "etf_detail",
        "entity": "VYMI",
        "provider_path": f"data/stockanalysis/etfs/VYMI-{suffix}.json",
        "payload_sha256": canonical_sha256(payload),
        "provider_schema": "stockanalysis/v1",
        "source_as_of": "2026-07-10T00:00:00Z",
        "observed_at": observed_at,
        "validation_status": status,
        "reason_code": "contract_valid" if status == "valid" else "schema_drift",
    }
    row["event_id"] = deterministic_event_id("observation", row)
    return row


def materialize_provider_truth(root, row):
    suffix = Path(row["provider_path"]).stem.rsplit("-", 1)[-1]
    path = Path(root) / row["provider_path"]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(canonical_json_bytes({"ticker": "VYMI", "suffix": suffix}))


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
        payload_ref_kind="provider_truth",
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

    def test_missing_or_digest_mismatched_provider_truth_cannot_prepare(self):
        for mode in ("missing", "mismatch"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                store = DataSupplyStateStore(root, provider_truth_root=root)
                row = observation()
                store.record_observation(row)
                if mode == "mismatch":
                    path = root / row["provider_path"]
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(b"different-payload")
                with self.assertRaises(SchemaError):
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
        with self.assertRaises(IntegrityError):
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
        with self.assertRaises(IntegrityError):
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
