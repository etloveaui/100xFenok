from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import stat
import tempfile
import types
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from typing import Any
from unittest.mock import patch


SCRIPT_PATH = Path(__file__).with_name("run-winddown-luna-batches.py")
SPEC = importlib.util.spec_from_file_location("run_winddown_luna_batches", SCRIPT_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("failed to load run-winddown-luna-batches.py")
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


def canonical(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def digest(value: str | bytes) -> str:
    if isinstance(value, str):
        value = value.encode("utf-8")
    return hashlib.sha256(value).hexdigest()


def material(index: int) -> dict[str, Any]:
    return {
        "id": f"winddown-material-{index}",
        "sourceLocator": f"legacy-v1:test:legacy-{index}",
        "legacyAliases": [f"legacy-{index}"],
        "ko": f"오늘 문장 {index}을 연습합니다",
        "en": f"Practice sentence number {index} today",
        "acceptedVariants": [f"Practice number {index} today"],
        "difficulty": 1,
        "grounded": True,
        "verifiedInSource": True,
        "provenance": {
            "namespace": "test",
            "source": "fixture",
            "sourcePath": "fixture.json",
        },
        "sourceMetadata": {
            "wordCount": None,
            "pattern": None,
            "variationsEn": [],
            "theme": None,
            "register": None,
            "note": None,
            "enrichment": {
                "addedAt": None,
                "extractedAt": None,
                "enrichedAt": None,
                "enrichVersion": None,
                "upstreamVerifiedInSource": None,
                "sibling": None,
            },
        },
        "materialWarnings": [],
        "staticQaStatus": "passed",
    }


def fixture() -> tuple[dict[str, Any], bytes, dict[str, Any], bytes]:
    materials = [material(index) for index in range(1, 4)]
    artifact = {
        "schemaVersion": 2,
        "kind": "winddown-static-material",
        "generatedAt": "2026-07-31T00:00:00.000Z",
        "source": {
            "namespace": "test",
            "source": "fixture",
            "sourcePath": "fixture.json",
            "sourceRevision": "v1",
        },
        "mode": "legacy-v1-bootstrap",
        "qualityPolicy": {
            "difficultyRange": {"min": 1, "max": 2},
            "requireGrounded": True,
            "requireVerifiedInSource": True,
        },
        "migration": {
            "legacyAliasBootstrap": {
                "sourceSchemaVersion": 1,
                "policy": "record-v1-aliases-once",
                "locatorStrategy": "frozen-legacy-v1-namespaced",
            },
            "legacyAliasMap": [
                {"legacyV1Id": f"legacy-{index}", "canonicalId": f"winddown-material-{index}"}
                for index in range(1, 5)
            ],
            "legacyAliasCoverage": {
                "expectedCount": 4,
                "mappedCount": 4,
                "missingCount": 0,
                "unaliasedRowCount": 0,
                "missingAliases": [],
                "status": "complete",
            },
        },
        "materials": materials,
        "quarantine": [
            {
                "canonicalId": "winddown-material-4",
                "sourceLocator": "legacy-v1:test:legacy-4",
                "legacyAliases": ["legacy-4"],
                "reasons": ["not_verified_in_source"],
            }
        ],
        "summary": {
            "inputCount": 4,
            "staticCandidateCount": 3,
            "quarantinedCount": 1,
        },
        "digest": "",
    }
    artifact["digest"] = digest(
        canonical(
            {
                key: artifact[key]
                for key in (
                    "schemaVersion",
                    "kind",
                    "source",
                    "mode",
                    "qualityPolicy",
                    "migration",
                    "materials",
                    "quarantine",
                    "summary",
                )
            }
        )
    )
    artifact_bytes = (json.dumps(artifact, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    prompt_bytes = b"Wind Down Luna prompt fixture\n"
    items = [
        {
            "materialId": entry["id"],
            "inputMaterialDigest": digest(canonical(entry)),
        }
        for entry in materials
    ]
    shard_inputs = [items[:2], items[2:]]
    artifact_bytes_digest = digest(artifact_bytes)
    manifest_digest = "1" * 64
    prompt_digest = digest(prompt_bytes)
    shards: list[dict[str, Any]] = []
    for shard_index, shard_items in enumerate(shard_inputs):
        shard_id = digest(
            canonical(
                {
                    "artifactDigest": artifact["digest"],
                    "artifactBytesDigest": artifact_bytes_digest,
                    "manifestDigest": manifest_digest,
                    "promptTemplateDigest": prompt_digest,
                    "requestedModel": runner.MODEL_ALIAS,
                    "shardIndex": shard_index,
                    "items": shard_items,
                }
            )
        )
        shards.append(
            {
                "shardIndex": shard_index,
                "shardId": shard_id,
                "items": shard_items,
            }
        )
    without_digest = {
        "schemaVersion": 1,
        "kind": "winddown-luna-shard-plan",
        "artifactDigest": artifact["digest"],
        "artifactBytesDigest": artifact_bytes_digest,
        "manifestDigest": manifest_digest,
        "promptTemplateDigest": prompt_digest,
        "requestedModel": runner.MODEL_ALIAS,
        "materialCount": len(materials),
        "shardSize": 2,
        "shardCount": len(shards),
        "shards": shards,
    }
    plan = {**without_digest, "digest": digest(canonical(without_digest))}
    return artifact, artifact_bytes, plan, prompt_bytes


def response_item(binding: dict[str, Any], source: dict[str, Any]) -> dict[str, Any]:
    return {
        "materialId": binding["materialId"],
        "inputMaterialDigest": binding["inputMaterialDigest"],
        "verdict": "approve",
        "evidence": ["Grounded in the immutable source."],
        "enrichment": {
            "chunks": [source["en"].split(" ")[0]],
            "distractors": [f"Incorrect {source['legacyAliases'][0]}"],
            "difficultyNote": None,
            "scenarioTags": ["daily-life"],
            "naturalnessFlags": ["natural"],
        },
    }


def fake_result(
    artifact: dict[str, Any],
    plan: dict[str, Any],
    shard_index: int,
    response_model: str | None = "gpt-5.6-luna-2026-07-31",
) -> types.SimpleNamespace:
    shard = plan["shards"][shard_index]
    by_id = {entry["id"]: entry for entry in artifact["materials"]}
    value = {
        "schemaVersion": 1,
        "kind": "winddown-luna-shard-response",
        "shardId": shard["shardId"],
        "items": [
            response_item(binding, by_id[binding["materialId"]])
            for binding in shard["items"]
        ],
    }
    return types.SimpleNamespace(
        text=canonical(value),
        error=None,
        requested_model=runner.MODEL_ALIAS,
        response_model=response_model,
        model=runner.MODEL_ALIAS,
        provider="must-not-escape",
        account_slot="must-not-escape",
        usage={"secret": "must-not-escape"},
    )


class FakeFacade:
    def __init__(
        self,
        artifact: dict[str, Any],
        plan: dict[str, Any],
        *,
        response_model: str | None = "gpt-5.6-luna-2026-07-31",
    ) -> None:
        self.artifact = artifact
        self.plan = plan
        self.response_model = response_model
        self.calls: list[dict[str, Any]] = []

    def __call__(self, prompt: str, **kwargs: Any) -> types.SimpleNamespace:
        shard_index = len(self.calls)
        self.calls.append({"prompt": prompt, **kwargs})
        return fake_result(
            self.artifact,
            self.plan,
            shard_index,
            response_model=self.response_model,
        )


class ShardSequenceFacade:
    def __init__(
        self,
        artifact: dict[str, Any],
        plan: dict[str, Any],
        shard_indexes: list[int],
    ) -> None:
        self.artifact = artifact
        self.plan = plan
        self.shard_indexes = shard_indexes
        self.calls: list[dict[str, Any]] = []

    def __call__(self, prompt: str, **kwargs: Any) -> types.SimpleNamespace:
        shard_index = self.shard_indexes[len(self.calls)]
        self.calls.append({"prompt": prompt, **kwargs})
        return fake_result(self.artifact, self.plan, shard_index)


class WindDownLunaRunnerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.artifact, self.artifact_bytes, self.plan, self.prompt_bytes = fixture()

    def run_valid(self, facade: Any | None = None) -> tuple[dict[str, Any], Any]:
        fake = facade or FakeFacade(self.artifact, self.plan)
        output = runner.run_batches(
            artifact=self.artifact,
            artifact_bytes=self.artifact_bytes,
            plan=self.plan,
            prompt_template=self.prompt_bytes,
            generate_json=fake,
        )
        return output, fake

    def test_valid_run_uses_exact_alias_and_emits_ts_unsigned_bundle(self) -> None:
        output, fake = self.run_valid()
        self.assertEqual(len(fake.calls), 2)
        for call in fake.calls:
            self.assertEqual(call["alias"], runner.MODEL_ALIAS)
            self.assertNotIn("model", call)
            self.assertNotIn("provider", call)
            self.assertEqual(call["temperature"], 0)
            self.assertEqual(call["reasoning"], {"effort": "low"})
            self.assertIn("schema", call)
        self.assertEqual(
            set(output),
            {
                "schemaVersion",
                "kind",
                "planDigest",
                "artifactDigest",
                "artifactBytesDigest",
                "manifestDigest",
                "promptTemplateDigest",
                "requestedModel",
                "materialCount",
                "shardCount",
                "shards",
            },
        )
        self.assertEqual(output["kind"], "winddown-luna-receipt-bundle")
        self.assertEqual(output["materialCount"], 3)
        self.assertEqual(
            [item["materialId"] for shard in output["shards"] for item in shard["items"]],
            [entry["id"] for entry in self.artifact["materials"]],
        )
        serialized = canonical(output)
        for forbidden in ("must-not-escape", "provider", "account_slot", "usage", "request_id"):
            self.assertNotIn(forbidden, serialized)

    def test_quarantine_is_not_in_luna_coverage(self) -> None:
        output, _ = self.run_valid()
        ids = [item["materialId"] for shard in output["shards"] for item in shard["items"]]
        self.assertNotIn("winddown-material-4", ids)
        self.assertEqual(len(ids), len(self.artifact["materials"]))

    def test_partial_plan_fails_before_call(self) -> None:
        fake = FakeFacade(self.artifact, self.plan)
        self.plan["shards"].pop()
        self.plan["shardCount"] = 1
        self.plan["digest"] = digest(
            canonical({key: value for key, value in self.plan.items() if key != "digest"})
        )
        with self.assertRaisesRegex(runner.RunnerContractError, "plan_material_coverage_mismatch"):
            self.run_valid(fake)
        self.assertEqual(fake.calls, [])

    def test_artifact_bytes_mismatch_fails_before_call(self) -> None:
        fake = FakeFacade(self.artifact, self.plan)
        with self.assertRaisesRegex(runner.RunnerContractError, "artifact_bytes_content_mismatch"):
            runner.run_batches(
                artifact=self.artifact,
                artifact_bytes=b"{}",
                plan=self.plan,
                prompt_template=self.prompt_bytes,
                generate_json=fake,
            )
        self.assertEqual(fake.calls, [])

    def test_prompt_digest_mismatch_fails_before_call(self) -> None:
        fake = FakeFacade(self.artifact, self.plan)
        with self.assertRaisesRegex(runner.RunnerContractError, "prompt_template_digest_mismatch"):
            runner.run_batches(
                artifact=self.artifact,
                artifact_bytes=self.artifact_bytes,
                plan=self.plan,
                prompt_template=b"different",
                generate_json=fake,
            )
        self.assertEqual(fake.calls, [])

    def test_plan_or_artifact_digest_tamper_fails_before_call(self) -> None:
        for target, expected_code in (
            ("plan", "plan_digest_mismatch"),
            ("artifact", "artifact_digest_invalid"),
        ):
            with self.subTest(target=target):
                artifact, artifact_bytes, plan, prompt_bytes = fixture()
                if target == "plan":
                    plan["digest"] = "0" * 64
                else:
                    artifact["digest"] = "0" * 64
                    artifact_bytes = (
                        json.dumps(artifact, ensure_ascii=False, indent=2) + "\n"
                    ).encode("utf-8")
                fake = FakeFacade(artifact, plan)
                with self.assertRaisesRegex(
                    runner.RunnerContractError,
                    expected_code,
                ):
                    runner.run_batches(
                        artifact=artifact,
                        artifact_bytes=artifact_bytes,
                        plan=plan,
                        prompt_template=prompt_bytes,
                        generate_json=fake,
                    )
                self.assertEqual(fake.calls, [])

    def test_empty_response_fails_closed(self) -> None:
        fake = FakeFacade(self.artifact, self.plan)

        def empty(prompt: str, **kwargs: Any) -> types.SimpleNamespace:
            result = fake(prompt, **kwargs)
            result.text = ""
            return result

        with self.assertRaisesRegex(runner.RunnerContractError, "facade_response_empty"):
            self.run_valid(empty)

    def test_facade_error_details_are_not_exposed(self) -> None:
        calls = 0

        def failed(_prompt: str, **_kwargs: Any) -> types.SimpleNamespace:
            nonlocal calls
            calls += 1
            return types.SimpleNamespace(
                text="",
                error=types.SimpleNamespace(message="token=secret", code="sensitive"),
                requested_model=runner.MODEL_ALIAS,
                response_model=runner.MODEL_ALIAS,
                model=runner.MODEL_ALIAS,
            )

        with self.assertRaisesRegex(
            runner.RunnerContractError,
            r"^shard_0:facade_call_failed$",
        ):
            self.run_valid(failed)
        self.assertEqual(calls, 1)

    def test_requested_model_mismatch_fails_closed(self) -> None:
        fake = FakeFacade(self.artifact, self.plan)

        def wrong(prompt: str, **kwargs: Any) -> types.SimpleNamespace:
            result = fake(prompt, **kwargs)
            result.requested_model = "gpt-5.6-sol"
            return result

        with self.assertRaisesRegex(runner.RunnerContractError, "requested_model_mismatch"):
            self.run_valid(wrong)
        self.assertEqual(len(fake.calls), 1)

    def test_repair_allowlist_contains_only_safe_response_format_codes(self) -> None:
        self.assertEqual(
            runner.SAFE_ENRICHMENT_REPAIR_CODES,
            {
                "response_material_coverage_mismatch",
                "response_input_digest_mismatch",
                "response_enrichment_shape_invalid",
                "response_chunks_invalid",
                "response_chunk_not_grounded",
                "response_distractors_invalid",
                "response_distractor_matches_answer",
                "response_difficulty_note_invalid",
                "response_scenario_tags_invalid",
                "response_naturalness_flags_invalid",
            },
        )

    def test_missing_or_wrong_response_model_fails_closed(self) -> None:
        for response_model in (None, "gpt-5.6-luna-other", "gpt-5.6-sol"):
            with self.subTest(response_model=response_model):
                fake = FakeFacade(
                    self.artifact,
                    self.plan,
                    response_model=response_model,
                )
                with self.assertRaisesRegex(runner.RunnerContractError, "response_model_mismatch"):
                    self.run_valid(fake)
                self.assertEqual(len(fake.calls), 1)

    def test_coverage_mismatch_repair_recovers_once(self) -> None:
        calls: list[dict[str, Any]] = []

        def partial(prompt: str, **kwargs: Any) -> types.SimpleNamespace:
            shard_index = 0 if len(calls) < 2 else 1
            calls.append({"prompt": prompt, **kwargs})
            result = fake_result(self.artifact, self.plan, shard_index)
            if len(calls) == 1:
                payload = json.loads(result.text)
                payload["items"].pop()
                result.text = canonical(payload)
            return result

        output, _ = self.run_valid(partial)
        self.assertEqual(len(calls), 3)
        self.assertIn("response_material_coverage_mismatch", calls[1]["prompt"])
        self.assertEqual(output["shardCount"], 2)

    def test_persistent_coverage_mismatch_stops_after_one_retry(self) -> None:
        calls: list[str] = []

        def partial(prompt: str, **_kwargs: Any) -> types.SimpleNamespace:
            calls.append(prompt)
            result = fake_result(self.artifact, self.plan, 0)
            payload = json.loads(result.text)
            payload["items"].pop()
            result.text = canonical(payload)
            return result

        with self.assertRaisesRegex(
            runner.RunnerContractError,
            r"^shard_0:response_material_coverage_mismatch$",
        ):
            self.run_valid(partial)
        self.assertEqual(len(calls), 2)

    def test_input_digest_echo_mismatch_retries_once_and_recovers(self) -> None:
        calls: list[dict[str, Any]] = []

        def wrong_digest(prompt: str, **kwargs: Any) -> types.SimpleNamespace:
            shard_index = 0 if len(calls) < 2 else 1
            calls.append({"prompt": prompt, **kwargs})
            result = fake_result(self.artifact, self.plan, shard_index)
            if len(calls) == 1:
                payload = json.loads(result.text)
                payload["items"][0]["inputMaterialDigest"] = "0" * 64
                result.text = canonical(payload)
            return result

        output, _ = self.run_valid(wrong_digest)
        self.assertEqual(len(calls), 3)
        repair_prompt = calls[1]["prompt"]
        self.assertIn("response_input_digest_mismatch", repair_prompt)
        self.assertIn("INPUT DIGEST ECHO CORRECTION", repair_prompt)
        expected_bindings = [
            {
                "materialId": item["materialId"],
                "inputMaterialDigest": item["inputMaterialDigest"],
            }
            for item in self.plan["shards"][0]["items"]
        ]
        self.assertIn(canonical(expected_bindings), repair_prompt)
        self.assertNotIn("0" * 64, repair_prompt)
        self.assertEqual(output["shardCount"], 2)

    def test_persistent_input_digest_echo_mismatch_stops_after_one_retry(self) -> None:
        calls: list[str] = []

        def wrong_digest(prompt: str, **_kwargs: Any) -> types.SimpleNamespace:
            calls.append(prompt)
            result = fake_result(self.artifact, self.plan, 0)
            payload = json.loads(result.text)
            payload["items"][0]["inputMaterialDigest"] = "0" * 64
            result.text = canonical(payload)
            return result

        with self.assertRaisesRegex(
            runner.RunnerContractError,
            r"^shard_0:response_input_digest_mismatch$",
        ):
            self.run_valid(wrong_digest)
        self.assertEqual(len(calls), 2)

    def test_digest_mismatch_with_tampered_identity_or_fields_is_not_retried(
        self,
    ) -> None:
        cases = (
            (
                "wrong_id",
                lambda payload: payload["items"][1].update(
                    {"materialId": payload["items"][0]["materialId"]}
                ),
                "response_material_order_or_id_mismatch",
            ),
            (
                "source_truth",
                lambda payload: payload["items"][1].update({"en": "mutation"}),
                "response_forbidden_field",
            ),
            (
                "provider",
                lambda payload: payload["items"][1].update({"provider": "leak"}),
                "response_forbidden_field",
            ),
            (
                "unknown",
                lambda payload: payload["items"][1].update({"unexpected": True}),
                "response_item_shape_invalid",
            ),
            (
                "unknown_enrichment",
                lambda payload: payload["items"][1]["enrichment"].update(
                    {"unexpected": True}
                ),
                "response_unknown_field",
            ),
        )
        for name, mutate, expected_code in cases:
            with self.subTest(name=name):
                fake = FakeFacade(self.artifact, self.plan)

                def tampered(prompt: str, **kwargs: Any) -> types.SimpleNamespace:
                    result = fake(prompt, **kwargs)
                    payload = json.loads(result.text)
                    payload["items"][0]["inputMaterialDigest"] = "0" * 64
                    mutate(payload)
                    result.text = canonical(payload)
                    return result

                with self.assertRaisesRegex(
                    runner.RunnerContractError,
                    rf"^shard_0:{expected_code}$",
                ):
                    self.run_valid(tampered)
                self.assertEqual(len(fake.calls), 1)

    def test_material_id_or_order_violation_is_not_retried(self) -> None:
        fake = FakeFacade(self.artifact, self.plan)

        def wrong_id(prompt: str, **kwargs: Any) -> types.SimpleNamespace:
            result = fake(prompt, **kwargs)
            payload = json.loads(result.text)
            payload["items"][0]["materialId"] = payload["items"][1]["materialId"]
            result.text = canonical(payload)
            return result

        with self.assertRaisesRegex(
            runner.RunnerContractError,
            r"^shard_0:response_material_order_or_id_mismatch$",
        ):
            self.run_valid(wrong_id)
        self.assertEqual(len(fake.calls), 1)

    def test_source_truth_or_provider_fields_are_rejected(self) -> None:
        for extra in ({"en": "mutation"}, {"provider": "leak"}, {"account_slot": "leak"}):
            with self.subTest(extra=extra):
                fake = FakeFacade(self.artifact, self.plan)

                def injected(prompt: str, **kwargs: Any) -> types.SimpleNamespace:
                    result = fake(prompt, **kwargs)
                    payload = json.loads(result.text)
                    payload["items"][0].update(extra)
                    result.text = canonical(payload)
                    return result

                with self.assertRaisesRegex(
                    runner.RunnerContractError,
                    r"^shard_0:response_forbidden_field$",
                ):
                    self.run_valid(injected)
                self.assertEqual(len(fake.calls), 1)

    def test_safe_enrichment_error_retries_once_with_sanitized_instruction(self) -> None:
        calls: list[dict[str, Any]] = []

        def repaired(prompt: str, **kwargs: Any) -> types.SimpleNamespace:
            shard_index = 0 if len(calls) < 2 else 1
            calls.append({"prompt": prompt, **kwargs})
            result = fake_result(self.artifact, self.plan, shard_index)
            if len(calls) == 1:
                payload = json.loads(result.text)
                payload["items"][0]["enrichment"]["chunks"] = [
                    "RAW_PRIOR_SENTINEL"
                ]
                result.text = canonical(payload)
            return result

        output, _ = self.run_valid(repaired)
        self.assertEqual(len(calls), 3)
        repair_prompt = calls[1]["prompt"]
        self.assertIn("response_chunk_not_grounded", repair_prompt)
        self.assertIn(
            "chunks, distractors, scenarioTags, and naturalnessFlags to []",
            repair_prompt,
        )
        self.assertNotIn("RAW_PRIOR_SENTINEL", repair_prompt)
        self.assertNotIn("must-not-escape", repair_prompt)
        self.assertEqual(calls[1]["reasoning"], {"effort": "low"})
        self.assertEqual(output["shardCount"], 2)

    def test_persistent_safe_error_stops_after_exactly_one_retry(self) -> None:
        calls: list[str] = []

        def always_invalid(prompt: str, **_kwargs: Any) -> types.SimpleNamespace:
            calls.append(prompt)
            result = fake_result(self.artifact, self.plan, 0)
            payload = json.loads(result.text)
            payload["items"][0]["enrichment"]["chunks"] = ["invented chunk"]
            result.text = canonical(payload)
            return result

        with self.assertRaisesRegex(
            runner.RunnerContractError,
            r"^shard_0:response_chunk_not_grounded$",
        ):
            self.run_valid(always_invalid)
        self.assertEqual(len(calls), 2)
        self.assertEqual(
            calls[1].count("response_chunk_not_grounded"),
            1,
        )

    def test_no_partial_output_is_written(self) -> None:
        fake = FakeFacade(self.artifact, self.plan)

        def fail_second(prompt: str, **kwargs: Any) -> types.SimpleNamespace:
            result = fake(prompt, **kwargs)
            if len(fake.calls) == 2:
                result.text = ""
            return result

        with tempfile.TemporaryDirectory() as temp:
            output_path = Path(temp) / "unsigned.json"
            with self.assertRaisesRegex(
                runner.RunnerContractError,
                r"^shard_1:facade_response_empty$",
            ):
                runner.run_to_path(
                    artifact=self.artifact,
                    artifact_bytes=self.artifact_bytes,
                    plan=self.plan,
                    prompt_template=self.prompt_bytes,
                    generate_json=fail_second,
                    output_path=output_path,
                )
            self.assertFalse(output_path.exists())

    def test_retry_failure_on_later_shard_writes_no_partial_output(self) -> None:
        calls: list[int] = []

        def fail_second_shard(prompt: str, **_kwargs: Any) -> types.SimpleNamespace:
            shard_index = 0 if not calls else 1
            calls.append(shard_index)
            result = fake_result(self.artifact, self.plan, shard_index)
            if shard_index == 1:
                payload = json.loads(result.text)
                payload["items"][0]["enrichment"]["chunks"] = [
                    "invented later chunk"
                ]
                result.text = canonical(payload)
            return result

        with tempfile.TemporaryDirectory() as temp:
            output_path = Path(temp) / "unsigned.json"
            with self.assertRaisesRegex(
                runner.RunnerContractError,
                r"^shard_1:response_chunk_not_grounded$",
            ):
                runner.run_to_path(
                    artifact=self.artifact,
                    artifact_bytes=self.artifact_bytes,
                    plan=self.plan,
                    prompt_template=self.prompt_bytes,
                    generate_json=fail_second_shard,
                    output_path=output_path,
                )
            self.assertEqual(calls, [0, 1, 1])
            self.assertFalse(output_path.exists())

    def test_late_failure_keeps_valid_checkpoint_but_no_final_output(self) -> None:
        calls: list[int] = []

        def fail_second_shard(prompt: str, **_kwargs: Any) -> types.SimpleNamespace:
            shard_index = 0 if not calls else 1
            calls.append(shard_index)
            result = fake_result(self.artifact, self.plan, shard_index)
            if shard_index == 1:
                payload = json.loads(result.text)
                payload["items"].pop()
                result.text = canonical(payload)
            return result

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            output_path = root / "unsigned.json"
            checkpoint_dir = root / "checkpoints"
            with self.assertRaisesRegex(
                runner.RunnerContractError,
                r"^shard_1:response_material_coverage_mismatch$",
            ):
                runner.run_to_path(
                    artifact=self.artifact,
                    artifact_bytes=self.artifact_bytes,
                    plan=self.plan,
                    prompt_template=self.prompt_bytes,
                    generate_json=fail_second_shard,
                    output_path=output_path,
                    checkpoint_dir=checkpoint_dir,
                )
            self.assertEqual(calls, [0, 1, 1])
            self.assertFalse(output_path.exists())
            self.assertEqual(len(list(checkpoint_dir.iterdir())), 1)

    def test_resume_skips_completed_calls_and_reports_checkpoint_source(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            checkpoint_dir = root / "checkpoints"
            first_output = root / "first.json"
            calls: list[int] = []

            def fail_second(prompt: str, **_kwargs: Any) -> types.SimpleNamespace:
                shard_index = 0 if not calls else 1
                calls.append(shard_index)
                result = fake_result(self.artifact, self.plan, shard_index)
                if shard_index == 1:
                    result.text = ""
                return result

            with self.assertRaisesRegex(runner.RunnerContractError, "facade_response_empty"):
                runner.run_to_path(
                    artifact=self.artifact,
                    artifact_bytes=self.artifact_bytes,
                    plan=self.plan,
                    prompt_template=self.prompt_bytes,
                    generate_json=fail_second,
                    output_path=first_output,
                    checkpoint_dir=checkpoint_dir,
                )

            resumed = ShardSequenceFacade(self.artifact, self.plan, [1])
            progress: list[str] = []
            output_path = root / "resumed.json"
            output = runner.run_to_path(
                artifact=self.artifact,
                artifact_bytes=self.artifact_bytes,
                plan=self.plan,
                prompt_template=self.prompt_bytes,
                generate_json=resumed,
                output_path=output_path,
                checkpoint_dir=checkpoint_dir,
                progress=progress.append,
            )
            self.assertEqual(len(resumed.calls), 1)
            self.assertEqual(
                progress,
                [
                    "winddown_luna_runner: shard 1/2 validated source=checkpoint",
                    "winddown_luna_runner: shard 2/2 validated source=live",
                ],
            )
            joined = "\n".join(progress)
            for forbidden in (
                self.plan["digest"],
                self.plan["shards"][0]["shardId"],
                "provider",
                "account",
            ):
                self.assertNotIn(forbidden, joined)
            self.assertTrue(output_path.is_file())
            self.assertEqual(output["materialCount"], 3)
            self.assertEqual(len(list(checkpoint_dir.iterdir())), 2)

    def test_tampered_checkpoint_is_rejected_before_provider_call(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            checkpoint_dir = Path(temp) / "checkpoints"
            self.run_valid_with_checkpoints(checkpoint_dir)
            checkpoint_path = sorted(checkpoint_dir.iterdir())[0]
            checkpoint = json.loads(checkpoint_path.read_text(encoding="utf-8"))
            checkpoint["receipt"]["items"][0]["verdict"] = "reject"
            checkpoint_path.write_text(canonical(checkpoint), encoding="utf-8")
            fake = FakeFacade(self.artifact, self.plan)
            with self.assertRaisesRegex(
                runner.RunnerContractError,
                "checkpoint_digest_mismatch",
            ):
                runner.run_batches(
                    artifact=self.artifact,
                    artifact_bytes=self.artifact_bytes,
                    plan=self.plan,
                    prompt_template=self.prompt_bytes,
                    generate_json=fake,
                    checkpoint_dir=checkpoint_dir,
                )
            self.assertEqual(fake.calls, [])

    def test_checkpoint_parent_fsync_failure_is_resumable(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            checkpoint_dir = Path(temp) / "checkpoints"
            fake = FakeFacade(self.artifact, self.plan)
            real_fsync = runner.os.fsync
            directory_failures = 0

            def fail_first_directory_fsync(descriptor: int) -> None:
                nonlocal directory_failures
                if (
                    stat.S_ISDIR(runner.os.fstat(descriptor).st_mode)
                ):
                    directory_failures += 1
                    if directory_failures == 1:
                        raise OSError("injected checkpoint directory fsync failure")
                real_fsync(descriptor)

            with patch.object(
                runner.os,
                "fsync",
                side_effect=fail_first_directory_fsync,
            ):
                with self.assertRaisesRegex(
                    runner.RunnerContractError,
                    "checkpoint_write_failed",
                ):
                    runner.run_batches(
                        artifact=self.artifact,
                        artifact_bytes=self.artifact_bytes,
                        plan=self.plan,
                        prompt_template=self.prompt_bytes,
                        generate_json=fake,
                        checkpoint_dir=checkpoint_dir,
                    )
            self.assertEqual(len(fake.calls), 1)
            self.assertEqual(len(list(checkpoint_dir.iterdir())), 1)

            resumed = ShardSequenceFacade(self.artifact, self.plan, [1])
            output = runner.run_batches(
                artifact=self.artifact,
                artifact_bytes=self.artifact_bytes,
                plan=self.plan,
                prompt_template=self.prompt_bytes,
                generate_json=resumed,
                checkpoint_dir=checkpoint_dir,
            )
            self.assertEqual(len(resumed.calls), 1)
            self.assertEqual(output["shardCount"], 2)

    def test_output_parent_fsync_failure_leaves_retryable_complete_output(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            checkpoint_dir = root / "checkpoints"
            self.run_valid_with_checkpoints(checkpoint_dir)
            output_path = root / "unsigned.json"
            real_fsync = runner.os.fsync
            directory_failures = 0

            def fail_first_directory_fsync(descriptor: int) -> None:
                nonlocal directory_failures
                if (
                    stat.S_ISDIR(runner.os.fstat(descriptor).st_mode)
                ):
                    directory_failures += 1
                    if directory_failures == 2:
                        raise OSError("injected output directory fsync failure")
                real_fsync(descriptor)

            calls = 0

            def unexpected_call(_prompt: str, **_kwargs: Any) -> None:
                nonlocal calls
                calls += 1
                raise AssertionError("checkpointed shards must skip provider")

            with patch.object(
                runner.os,
                "fsync",
                side_effect=fail_first_directory_fsync,
            ):
                with self.assertRaisesRegex(
                    runner.RunnerContractError,
                    "output_write_failed",
                ):
                    runner.run_to_path(
                        artifact=self.artifact,
                        artifact_bytes=self.artifact_bytes,
                        plan=self.plan,
                        prompt_template=self.prompt_bytes,
                        generate_json=unexpected_call,
                        output_path=output_path,
                        checkpoint_dir=checkpoint_dir,
                    )
            self.assertEqual(calls, 0)
            self.assertTrue(output_path.is_file())

            output = runner.run_to_path(
                artifact=self.artifact,
                artifact_bytes=self.artifact_bytes,
                plan=self.plan,
                prompt_template=self.prompt_bytes,
                generate_json=unexpected_call,
                output_path=output_path,
                checkpoint_dir=checkpoint_dir,
            )
            self.assertEqual(calls, 0)
            self.assertEqual(output["materialCount"], 3)

    def test_final_checkpoint_parent_fsync_failure_heals_without_provider(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            checkpoint_dir = Path(temp) / "checkpoints"
            fake = FakeFacade(self.artifact, self.plan)
            real_fsync = runner.os.fsync
            directory_fsyncs = 0

            def fail_second_directory_fsync(descriptor: int) -> None:
                nonlocal directory_fsyncs
                if stat.S_ISDIR(runner.os.fstat(descriptor).st_mode):
                    directory_fsyncs += 1
                    if directory_fsyncs == 2:
                        raise OSError("injected final directory fsync failure")
                real_fsync(descriptor)

            with patch.object(
                runner.os,
                "fsync",
                side_effect=fail_second_directory_fsync,
            ):
                with self.assertRaisesRegex(
                    runner.RunnerContractError,
                    "checkpoint_write_failed",
                ):
                    runner.run_batches(
                        artifact=self.artifact,
                        artifact_bytes=self.artifact_bytes,
                        plan=self.plan,
                        prompt_template=self.prompt_bytes,
                        generate_json=fake,
                        checkpoint_dir=checkpoint_dir,
                    )
            self.assertEqual(len(fake.calls), 2)
            self.assertEqual(len(list(checkpoint_dir.iterdir())), 2)

            calls = 0
            healed_directory_fsyncs = 0

            def unexpected_call(_prompt: str, **_kwargs: Any) -> None:
                nonlocal calls
                calls += 1
                raise AssertionError("complete checkpoints must skip provider")

            def record_directory_fsync(descriptor: int) -> None:
                nonlocal healed_directory_fsyncs
                if stat.S_ISDIR(runner.os.fstat(descriptor).st_mode):
                    healed_directory_fsyncs += 1
                real_fsync(descriptor)

            with patch.object(
                runner.os,
                "fsync",
                side_effect=record_directory_fsync,
            ):
                output = runner.run_batches(
                    artifact=self.artifact,
                    artifact_bytes=self.artifact_bytes,
                    plan=self.plan,
                    prompt_template=self.prompt_bytes,
                    generate_json=unexpected_call,
                    checkpoint_dir=checkpoint_dir,
                )
            self.assertEqual(calls, 0)
            self.assertEqual(healed_directory_fsyncs, 1)
            self.assertEqual(output["shardCount"], 2)

    def test_stale_or_unknown_checkpoint_is_rejected_before_provider_call(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            checkpoint_dir = Path(temp) / "checkpoints"
            checkpoint_dir.mkdir()
            (checkpoint_dir / "stale.json").write_text("{}", encoding="utf-8")
            fake = FakeFacade(self.artifact, self.plan)
            with self.assertRaisesRegex(
                runner.RunnerContractError,
                "checkpoint_unknown_or_stale",
            ):
                runner.run_batches(
                    artifact=self.artifact,
                    artifact_bytes=self.artifact_bytes,
                    plan=self.plan,
                    prompt_template=self.prompt_bytes,
                    generate_json=fake,
                    checkpoint_dir=checkpoint_dir,
                )
            self.assertEqual(fake.calls, [])

    def run_valid_with_checkpoints(self, checkpoint_dir: Path) -> dict[str, Any]:
        fake = FakeFacade(self.artifact, self.plan)
        return runner.run_batches(
            artifact=self.artifact,
            artifact_bytes=self.artifact_bytes,
            plan=self.plan,
            prompt_template=self.prompt_bytes,
            generate_json=fake,
            checkpoint_dir=checkpoint_dir,
        )

    def test_approved_import_path_gate_rejects_escape_and_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            cch_root = Path(temp) / "claude-code-hub"
            runtime_root = cch_root / "docs/products/llm-runtime/python"
            package_file = runtime_root / "feno_llm/__init__.py"
            package_file.parent.mkdir(parents=True)
            package_file.write_text("# fixture\n", encoding="utf-8")
            self.assertEqual(
                runner.verify_approved_feno_llm_path(
                    approved_cch_root=cch_root,
                    approved_feno_llm_root=runtime_root,
                    loaded_package_file=package_file,
                ),
                package_file.resolve(),
            )
            with self.assertRaisesRegex(
                runner.RunnerContractError,
                "feno_llm_root_outside_approved_cch",
            ):
                runner.verify_approved_feno_llm_path(
                    approved_cch_root=cch_root,
                    approved_feno_llm_root=Path(temp) / "outside",
                    loaded_package_file=package_file,
                )
            with self.assertRaisesRegex(
                runner.RunnerContractError,
                "feno_llm_import_path_mismatch",
            ):
                runner.verify_approved_feno_llm_path(
                    approved_cch_root=cch_root,
                    approved_feno_llm_root=runtime_root,
                    loaded_package_file=Path(temp) / "shadow/feno_llm/__init__.py",
                )

    def test_cli_requires_explicit_execute_before_reading_inputs(self) -> None:
        stderr = io.StringIO()
        with redirect_stderr(stderr):
            status = runner.main(
                [
                    "--artifact",
                    "/does/not/exist/artifact.json",
                    "--shard-plan",
                    "/does/not/exist/plan.json",
                    "--prompt-template",
                    "/does/not/exist/prompt.txt",
                    "--output",
                    "/does/not/exist/output.json",
                    "--approved-cch-root",
                    "/does/not/exist/claude-code-hub",
                ]
            )
        self.assertEqual(status, 2)
        self.assertEqual(
            stderr.getvalue().strip(),
            "winddown_luna_runner: live_execution_not_opted_in",
        )


if __name__ == "__main__":
    unittest.main()
