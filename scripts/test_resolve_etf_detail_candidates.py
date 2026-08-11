#!/usr/bin/env python3

from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from data_supply_state import (
    DataSupplyStateStore,
    SchemaError,
    canonical_json_bytes,
    canonical_sha256,
    deterministic_event_id,
)
from resolve_etf_detail_candidates import (
    artifact_entities,
    latest_recorded_observations,
    resolve_entities,
)


FRESH_FALLBACKS = {
    "HYGW": "2026-07-24T19:28:20Z",
    "LQDW": "2026-07-24T19:59:45Z",
    "PFFL": "2026-07-24T16:36:46Z",
    "TLTW": "2026-07-24T20:00:00Z",
    "UTRE": "2026-07-24T20:00:00Z",
    "UTWO": "2026-07-24T20:00:00Z",
}


def observation(
    *,
    provider: str,
    entity: str,
    source_as_of: str | None,
    observed_at: str,
    valid: bool,
    legacy_yahoo_endpoint: bool = False,
) -> tuple[dict, bytes]:
    payload = {
        "schema_version": "yf-etf-detail/v1",
        "source_provider": "yahoo_finance",
        "source_as_of": source_as_of,
        "ticker": entity,
    }
    row = {
        "schema_version": "data-supply-observation/v1",
        "provider": provider,
        "endpoint_family": (
            (
                "yahoo_etf_detail"
                if legacy_yahoo_endpoint
                else "yahoo_finance_etf_detail"
            )
            if provider == "yahoo_finance"
            else "stockanalysis_etf_detail"
        ),
        "domain": "etf_detail",
        "entity": entity,
        "provider_path": (
            f"data/yf/etf-details/{entity}.json"
            if provider == "yahoo_finance"
            else f"data/stockanalysis/etfs/{entity}.json"
        ),
        "payload_sha256": canonical_sha256(payload),
        "provider_schema": (
            "yf-etf-detail/v1" if provider == "yahoo_finance" else "stockanalysis/v1"
        ),
        "source_as_of": source_as_of,
        "observed_at": observed_at,
        "validation_status": "valid" if valid else "invalid",
        "reason_code": "contract_valid" if valid else "schema_invalid",
        "observation_origin": "natural",
    }
    if not valid:
        row["payload_available"] = False
        row["failure_detail_sha256"] = "a" * 64
        row["payload_sha256"] = canonical_sha256(
            {
                "provider": row["provider"],
                "endpoint_family": row["endpoint_family"],
                "domain": row["domain"],
                "entity": row["entity"],
                "observed_at": row["observed_at"],
                "reason_code": row["reason_code"],
                "failure_detail_sha256": row["failure_detail_sha256"],
            }
        )
    row["event_id"] = deterministic_event_id("observation", row)
    return row, canonical_json_bytes(payload)


class ResolveEtfDetailCandidatesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.store = DataSupplyStateStore(self.root)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def publish_pair(
        self,
        entity: str,
        source_as_of: str,
        observed_at: str,
        *,
        legacy_yahoo_endpoint: bool = False,
    ) -> tuple[dict, bytes]:
        primary, _ = observation(
            provider="stockanalysis",
            entity=entity,
            source_as_of=None,
            observed_at=observed_at,
            valid=False,
        )
        fallback, payload = observation(
            provider="yahoo_finance",
            entity=entity,
            source_as_of=source_as_of,
            observed_at=observed_at,
            valid=True,
            legacy_yahoo_endpoint=legacy_yahoo_endpoint,
        )
        self.store.record_observation(primary)
        self.store.store_provider_object(observation=fallback, payload=payload)
        self.store.record_observation(fallback)
        return fallback, payload

    def resolution_count(self) -> int:
        return sum(
            len(path.read_text(encoding="utf-8").splitlines())
            for path in (self.root / "history" / "resolutions").glob("*.jsonl")
        )

    def test_artifact_scope_uses_only_changed_etf_pending_pointers(self) -> None:
        manifest = self.root / "manifest.json"
        manifest.write_text(
            json.dumps(
                {
                    "paths": [
                        "data/admin/data-supply-state/v1/providers/yahoo_finance/etf_detail/pending/HYGW.json",
                        "data/admin/data-supply-state/v1/history/observations/2026-07-26.jsonl",
                        "data/yf/etf-details/HYGW.json",
                    ]
                }
            ),
            encoding="utf-8",
        )
        self.assertEqual(artifact_entities(manifest), ["HYGW"])

    def test_six_provider_bound_yahoo_candidates_promote_exact_source_stamp(self) -> None:
        legacy_by_entity = {}
        for entity, source_as_of in FRESH_FALLBACKS.items():
            with self.subTest(entity=entity):
                legacy, _ = self.publish_pair(
                    entity,
                    source_as_of,
                    "2026-07-26T04:30:00Z",
                    legacy_yahoo_endpoint=True,
                )
                legacy_by_entity[entity] = legacy
                self.assertTrue(
                    (
                        self.root
                        / "providers/yahoo_finance/etf_detail/pending"
                        / f"{entity}.json"
                    ).exists(),
                    "provider object and pending evidence must exist before resolution",
                )
        result = resolve_entities(
            self.store,
            entities=FRESH_FALLBACKS,
            decided_at="2026-07-26T04:30:01Z",
        )
        rows = {row["entity"]: row for row in result["results"]}
        for entity, source_as_of in FRESH_FALLBACKS.items():
            with self.subTest(entity=entity):
                self.assertEqual(rows[entity]["provider"], "yahoo_finance")
                self.assertEqual(rows[entity]["resolution_state"], "fresh_fallback")
                self.assertEqual(rows[entity]["source_as_of"], source_as_of)
                selected = self.store.read_active_domain("etf_detail")["current"][entity]
                migrated = next(
                    row
                    for row in latest_recorded_observations(self.root, [entity])[entity]
                    if row["provider"] == "yahoo_finance"
                )
                self.assertEqual(migrated["endpoint_family"], "yahoo_finance_etf_detail")
                self.assertEqual(
                    migrated["source_observation_event_id"],
                    legacy_by_entity[entity]["event_id"],
                )
                self.assertEqual(selected["candidate_event_id"], migrated["event_id"])
                pending = (
                    self.root
                    / "providers/yahoo_finance/etf_detail/pending"
                    / f"{entity}.json"
                )
                self.assertFalse(pending.exists(), "commit must clear its consumed pending pointer")

    def test_bhyp_and_ibim_stale_candidates_fail_closed(self) -> None:
        for entity, source_as_of in {
            "BHYP": "2026-06-18T11:25:17Z",
            "IBIM": "2026-06-18T19:17:27Z",
        }.items():
            with self.subTest(entity=entity):
                self.publish_pair(
                    entity,
                    source_as_of,
                    "2026-08-01T00:00:00Z",
                    legacy_yahoo_endpoint=True,
                )
                with self.assertRaises(SchemaError):
                    resolve_entities(
                        self.store,
                        entities=[entity],
                        decided_at="2026-08-01T00:00:01Z",
                    )
                self.assertIsNone(self.store.read_active_domain("etf_detail")["transaction_id"])
                self.assertTrue(
                    (
                        self.root
                        / "providers/yahoo_finance/etf_detail/pending"
                        / f"{entity}.json"
                    ).exists()
                )

    def test_freshness_boundary_is_168_hours_inclusive_and_one_second_later_stale(self) -> None:
        source = "2026-07-01T00:00:00Z"
        self.publish_pair("EXACT", source, "2026-07-01T00:00:01Z")
        exact = resolve_entities(
            self.store,
            entities=["EXACT"],
            decided_at="2026-07-08T00:00:00Z",
        )
        self.assertEqual(exact["results"][0]["resolution_state"], "fresh_fallback")

        with tempfile.TemporaryDirectory() as stale_tmp:
            stale_store = DataSupplyStateStore(stale_tmp)
            self.store = stale_store
            self.root = Path(stale_tmp)
            self.publish_pair("STALE", source, "2026-07-01T00:00:01Z")
            with self.assertRaises(SchemaError):
                resolve_entities(
                    stale_store,
                    entities=["STALE"],
                    decided_at="2026-07-08T00:00:01Z",
                )

    def test_repeat_semantic_decision_reuses_committed_transaction(self) -> None:
        self.publish_pair("HYGW", FRESH_FALLBACKS["HYGW"], "2026-07-26T04:30:00Z")
        first = resolve_entities(
            self.store,
            entities=["HYGW"],
            decided_at="2026-07-26T04:30:01Z",
        )
        second = resolve_entities(
            self.store,
            entities=["HYGW"],
            decided_at="2026-07-26T04:30:02Z",
        )
        self.assertEqual(
            first["results"][0]["transaction_id"],
            second["results"][0]["transaction_id"],
        )
        self.assertFalse(second["results"][0]["committed"])
        self.assertEqual(self.resolution_count(), 1)

        _row, payload = observation(
            provider="yahoo_finance",
            entity="HYGW",
            source_as_of=FRESH_FALLBACKS["HYGW"],
            observed_at="2026-07-26T04:30:00Z",
            valid=True,
        )
        migrated = next(
            row
            for row in latest_recorded_observations(self.root, ["HYGW"])["HYGW"]
            if row["provider"] == "yahoo_finance"
        )
        self.store.store_provider_object(observation=migrated, payload=payload)
        recreated = self.root / "providers/yahoo_finance/etf_detail/pending/HYGW.json"
        self.assertTrue(recreated.exists())
        third = resolve_entities(
            self.store,
            entities=["HYGW"],
            decided_at="2026-07-26T04:30:03Z",
        )
        self.assertFalse(third["results"][0]["committed"])
        self.assertFalse(recreated.exists())
        self.assertEqual(self.resolution_count(), 1)

    def test_compare_and_swap_race_has_one_committed_winner(self) -> None:
        self.publish_pair("HYGW", FRESH_FALLBACKS["HYGW"], "2026-07-26T04:30:00Z")
        barrier = threading.Barrier(2)
        original_prepare = self.store.prepare_transition

        def raced_prepare(**kwargs):
            barrier.wait(timeout=5)
            return original_prepare(**kwargs)

        self.store.prepare_transition = raced_prepare  # type: ignore[method-assign]
        results: list[dict] = []
        errors: list[BaseException] = []

        def run() -> None:
            try:
                results.append(
                    resolve_entities(
                        self.store,
                        entities=["HYGW"],
                        decided_at="2026-07-26T04:30:01Z",
                    )
                )
            except BaseException as exc:  # pragma: no cover - retained for assertion output
                errors.append(exc)

        threads = [threading.Thread(target=run) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
        self.assertFalse(errors)
        self.assertEqual(len(results), 2)
        self.assertEqual(
            {result["results"][0]["transaction_id"] for result in results},
            {self.store.read_active_domain("etf_detail")["transaction_id"]},
        )
        self.assertEqual(
            sorted(result["results"][0]["committed"] for result in results),
            [False, True],
        )
        self.assertEqual(self.resolution_count(), 1)

    def test_cas_retry_reloads_observations_and_cannot_replace_newer_winner(self) -> None:
        self.publish_pair(
            "HYGW",
            "2026-07-24T20:00:00Z",
            "2026-07-26T00:00:00Z",
        )
        stale_waiting = threading.Event()
        winner_committed = threading.Event()
        original_commit = self.store.commit_prepared

        def interleaved_commit(domain, transaction_id):
            if threading.current_thread().name == "stale-resolver":
                stale_waiting.set()
                self.assertTrue(winner_committed.wait(timeout=5))
            return original_commit(domain, transaction_id)

        self.store.commit_prepared = interleaved_commit  # type: ignore[method-assign]
        stale_result: list[dict] = []
        stale_errors: list[BaseException] = []

        def run_stale() -> None:
            try:
                stale_result.append(
                    resolve_entities(
                        self.store,
                        entities=["HYGW"],
                        decided_at="2026-07-26T04:30:01Z",
                    )
                )
            except BaseException as exc:  # pragma: no cover - assertion retains the error
                stale_errors.append(exc)

        stale_thread = threading.Thread(target=run_stale, name="stale-resolver")
        stale_thread.start()
        self.assertTrue(stale_waiting.wait(timeout=5))
        self.publish_pair(
            "HYGW",
            "2026-07-25T20:00:00Z",
            "2026-07-26T01:00:00Z",
        )
        winner = resolve_entities(
            self.store,
            entities=["HYGW"],
            decided_at="2026-07-26T04:30:01Z",
        )
        winner_committed.set()
        stale_thread.join(timeout=10)

        self.assertFalse(stale_errors)
        self.assertEqual(len(stale_result), 1)
        self.assertTrue(winner["results"][0]["committed"])
        self.assertFalse(stale_result[0]["results"][0]["committed"])
        self.assertEqual(
            self.store.read_active_domain("etf_detail")["current"]["HYGW"]["source_as_of"],
            "2026-07-25T20:00:00Z",
        )
        self.assertEqual(self.resolution_count(), 1)

    def test_same_provider_stale_candidate_cannot_overwrite_newer_active_selection(self) -> None:
        newer, _ = self.publish_pair(
            "HYGW",
            "2026-07-25T20:00:00Z",
            "2026-07-26T01:00:00Z",
        )
        winner = resolve_entities(
            self.store,
            entities=["HYGW"],
            decided_at="2026-07-26T04:30:01Z",
        )
        self.assertTrue(winner["results"][0]["committed"])
        stale, _ = self.publish_pair(
            "HYGW",
            "2026-07-24T20:00:00Z",
            "2026-07-26T02:00:00Z",
        )
        self.assertNotEqual(newer["event_id"], stale["event_id"])
        held = resolve_entities(
            self.store,
            entities=["HYGW"],
            decided_at="2026-07-26T04:30:02Z",
        )
        self.assertFalse(held["results"][0]["committed"])
        self.assertEqual(held["results"][0]["source_as_of"], "2026-07-25T20:00:00Z")
        self.assertTrue(
            (self.root / "providers/yahoo_finance/etf_detail/pending/HYGW.json").exists(),
            "an unconsumed stale candidate must not be cleared as a semantic no-op",
        )
        self.assertEqual(self.resolution_count(), 1)

    def test_workflow_runs_resolver_and_projection_inside_writer_before_git_commit(self) -> None:
        workflow = (SCRIPT_DIR.parent / ".github/workflows/fetch-stockanalysis.yml").read_text(
            encoding="utf-8"
        )
        publish = workflow.split("  publish-stockanalysis:\n", 1)[1]
        resolve_call = "python3 scripts/resolve_etf_detail_candidates.py"
        stage_call = "scripts/stage-lane-manifest.sh"
        build_call = "npm run build:data-supply-public"
        reconcile_call = "node scripts/sync-public-data.mjs --write"
        self.assertNotIn(resolve_call, workflow.split("  publish-stockanalysis:\n", 1)[0])
        self.assertIn("group: fenok-data-writer-refs/heads/main", publish)
        self.assertLess(publish.index("audit-stage"), publish.index(resolve_call))
        post_resolver_stage = publish.index(stage_call, publish.index(resolve_call))
        self.assertLess(publish.index(resolve_call), post_resolver_stage)
        self.assertLess(post_resolver_stage, publish.index(build_call))
        self.assertLess(publish.index(build_call), publish.index(reconcile_call))
        self.assertLess(publish.index(reconcile_call), publish.index("git commit"))
        self.assertNotIn("fetched_at", (SCRIPT_DIR / "resolve_etf_detail_candidates.py").read_text())

    def test_producer_records_policy_bound_yahoo_endpoint_family(self) -> None:
        producer = (SCRIPT_DIR / "fetch-stockanalysis.py").read_text(encoding="utf-8")
        self.assertNotIn('endpoint_family="yahoo_etf_detail"', producer)
        self.assertGreaterEqual(
            producer.count('endpoint_family="yahoo_finance_etf_detail"'),
            3,
        )


if __name__ == "__main__":
    unittest.main()
