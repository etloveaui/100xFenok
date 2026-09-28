#!/usr/bin/env python3
"""Run deterministic Wind Down Luna shards through the approved CCH facade.

The runner emits the unsigned receipt-content object expected by the TypeScript
signing layer. Provider diagnostics, account attribution, usage, request IDs,
errors, and secrets never cross that output boundary.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence


MODEL_ALIAS = "gpt-5.6-luna"
SCHEMA_VERSION = 1
MAX_SHARD_SIZE = 128
DEFAULT_TIMEOUT_SECONDS = 180
HEX_SHA256 = re.compile(r"^[a-f0-9]{64}$")
RESPONSE_MODEL = re.compile(r"^gpt-5\.6-luna(?:-\d{4}-\d{2}-\d{2})?$")
SECRET_LIKE_TEXT = re.compile(
    r"(?:\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\bsk-[A-Za-z0-9_-]{12,})",
    re.IGNORECASE,
)
SCENARIO_TAGS = frozenset(
    {"daily-life", "travel", "work", "school", "shopping", "food", "health", "social"}
)
NATURALNESS_FLAGS = frozenset(
    {"natural", "idiomatic", "literal", "awkward", "ambiguous", "register-mismatch"}
)
SAFE_ENRICHMENT_REPAIR_CODES = frozenset(
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
    }
)

PLAN_KEYS = frozenset(
    {
        "schemaVersion",
        "kind",
        "artifactDigest",
        "artifactBytesDigest",
        "manifestDigest",
        "promptTemplateDigest",
        "requestedModel",
        "materialCount",
        "shardSize",
        "shardCount",
        "shards",
        "digest",
    }
)
SHARD_KEYS = frozenset({"shardIndex", "shardId", "items"})
PLAN_ITEM_KEYS = frozenset({"materialId", "inputMaterialDigest"})
RESPONSE_KEYS = frozenset({"schemaVersion", "kind", "shardId", "items"})
RESPONSE_ITEM_KEYS = frozenset(
    {"materialId", "inputMaterialDigest", "verdict", "evidence", "enrichment"}
)
RECEIPT_KEYS = frozenset(
    {
        "schemaVersion",
        "kind",
        "shardIndex",
        "shardId",
        "requestedModel",
        "responseModel",
        "responseDigest",
        "items",
    }
)
CHECKPOINT_KEYS = frozenset(
    {
        "schemaVersion",
        "kind",
        "planDigest",
        "shardIndex",
        "shardId",
        "responseDigest",
        "receipt",
        "checkpointDigest",
    }
)
CHECKPOINT_FILE = re.compile(
    r"^(?P<plan>[a-f0-9]{64})\."
    r"(?P<index>[0-9]{5})\."
    r"(?P<shard>[a-f0-9]{64})\."
    r"(?P<response>[a-f0-9]{64})\.json$"
)
ENRICHMENT_KEYS = frozenset(
    {"chunks", "distractors", "difficultyNote", "scenarioTags", "naturalnessFlags"}
)
FORBIDDEN_RESPONSE_FIELDS = frozenset(
    {
        "id",
        "sourceLocator",
        "legacyAliases",
        "ko",
        "en",
        "acceptedVariants",
        "difficulty",
        "grounded",
        "verifiedInSource",
        "provenance",
        "sourceMetadata",
        "materialWarnings",
        "staticQaStatus",
        "provider",
        "account",
        "account_slot",
        "usage",
        "request",
        "request_id",
        "error",
    }
)

RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["schemaVersion", "kind", "shardId", "items"],
    "additionalProperties": False,
    "properties": {
        "schemaVersion": {"type": "integer", "enum": [SCHEMA_VERSION]},
        "kind": {"type": "string", "enum": ["winddown-luna-shard-response"]},
        "shardId": {"type": "string"},
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "required": [
                    "materialId",
                    "inputMaterialDigest",
                    "verdict",
                    "evidence",
                    "enrichment",
                ],
                "additionalProperties": False,
                "properties": {
                    "materialId": {"type": "string"},
                    "inputMaterialDigest": {"type": "string"},
                    "verdict": {
                        "type": "string",
                        "enum": ["approve", "needs_human_review", "reject"],
                    },
                    "evidence": {"type": "array", "items": {"type": "string"}},
                    "enrichment": {
                        "type": "object",
                        "required": [
                            "chunks",
                            "distractors",
                            "difficultyNote",
                            "scenarioTags",
                            "naturalnessFlags",
                        ],
                        "additionalProperties": False,
                        "properties": {
                            "chunks": {"type": "array", "items": {"type": "string"}},
                            "distractors": {"type": "array", "items": {"type": "string"}},
                            "difficultyNote": {},
                            "scenarioTags": {"type": "array", "items": {"type": "string"}},
                            "naturalnessFlags": {
                                "type": "array",
                                "items": {"type": "string"},
                            },
                        },
                    },
                },
            },
        },
    },
}


class RunnerContractError(RuntimeError):
    """Sanitized, stable failure code safe for stderr."""


GenerateJson = Callable[..., Any]


def canonical_json(value: Any) -> str:
    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=True,
        )
    except (TypeError, ValueError, RecursionError):
        raise RunnerContractError("json_not_canonicalizable") from None


def sha256_hex(value: str | bytes) -> str:
    if isinstance(value, str):
        value = value.encode("utf-8")
    return hashlib.sha256(value).hexdigest()


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, entry in pairs:
        if key in value:
            raise RunnerContractError("json_duplicate_key")
        value[key] = entry
    return value


def parse_json_bytes(value: bytes, code: str) -> Any:
    try:
        return json.loads(
            value.decode("utf-8"),
            object_pairs_hook=_reject_duplicate_keys,
            parse_constant=lambda _value: (_ for _ in ()).throw(ValueError()),
        )
    except RunnerContractError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError, RecursionError):
        raise RunnerContractError(code) from None


def _require_exact_keys(value: Any, keys: frozenset[str], code: str) -> Mapping[str, Any]:
    if not isinstance(value, dict) or frozenset(value) != keys:
        raise RunnerContractError(code)
    return value


def _require_sha256(value: Any, code: str) -> str:
    if not isinstance(value, str) or HEX_SHA256.fullmatch(value) is None:
        raise RunnerContractError(code)
    return value


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return True


def verify_approved_feno_llm_path(
    *,
    approved_cch_root: Path,
    approved_feno_llm_root: Path,
    loaded_package_file: Path,
) -> Path:
    cch_root = approved_cch_root.expanduser().resolve()
    runtime_root = approved_feno_llm_root.expanduser().resolve()
    if not _is_relative_to(runtime_root, cch_root):
        raise RunnerContractError("feno_llm_root_outside_approved_cch")
    expected_runtime_root = (cch_root / "docs/products/llm-runtime/python").resolve()
    if runtime_root != expected_runtime_root:
        raise RunnerContractError("feno_llm_root_not_canonical")
    expected_package = (runtime_root / "feno_llm/__init__.py").resolve()
    if loaded_package_file.expanduser().resolve() != expected_package:
        raise RunnerContractError("feno_llm_import_path_mismatch")
    return expected_package


def load_approved_generate_json(approved_cch_root: Path) -> GenerateJson:
    cch_root = approved_cch_root.expanduser().resolve()
    runtime_root = (cch_root / "docs/products/llm-runtime/python").resolve()
    expected_package = (runtime_root / "feno_llm/__init__.py").resolve()
    if not expected_package.is_file():
        raise RunnerContractError("approved_feno_llm_package_missing")

    loaded = sys.modules.get("feno_llm")
    if loaded is None:
        runtime_text = str(runtime_root)
        if runtime_text not in sys.path:
            sys.path.insert(0, runtime_text)
        try:
            loaded = importlib.import_module("feno_llm")
        except Exception:
            raise RunnerContractError("feno_llm_import_failed") from None

    loaded_file = getattr(loaded, "__file__", None)
    if not isinstance(loaded_file, str) or not loaded_file:
        raise RunnerContractError("feno_llm_import_path_missing")
    verify_approved_feno_llm_path(
        approved_cch_root=cch_root,
        approved_feno_llm_root=runtime_root,
        loaded_package_file=Path(loaded_file),
    )
    generate_json = getattr(loaded, "generate_json", None)
    if not callable(generate_json):
        raise RunnerContractError("feno_llm_generate_json_missing")
    return generate_json


def _artifact_semantic_digest(artifact: Mapping[str, Any]) -> str:
    required = (
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
    if any(key not in artifact for key in required):
        raise RunnerContractError("artifact_shape_invalid")
    return sha256_hex(canonical_json({key: artifact[key] for key in required}))


def _validate_artifact(
    artifact: Any,
    artifact_bytes: bytes,
) -> tuple[Mapping[str, Any], list[Mapping[str, Any]]]:
    if not isinstance(artifact, dict):
        raise RunnerContractError("artifact_shape_invalid")
    parsed_bytes = parse_json_bytes(artifact_bytes, "artifact_bytes_invalid_json")
    if canonical_json(parsed_bytes) != canonical_json(artifact):
        raise RunnerContractError("artifact_bytes_content_mismatch")
    if artifact.get("schemaVersion") != 2 or artifact.get("kind") != "winddown-static-material":
        raise RunnerContractError("artifact_shape_invalid")
    artifact_digest = _require_sha256(artifact.get("digest"), "artifact_digest_invalid")
    if artifact_digest != _artifact_semantic_digest(artifact):
        raise RunnerContractError("artifact_digest_invalid")

    migration = artifact.get("migration")
    coverage = migration.get("legacyAliasCoverage") if isinstance(migration, dict) else None
    if not isinstance(coverage, dict):
        raise RunnerContractError("legacy_alias_coverage_incomplete")
    if (
        coverage.get("status") != "complete"
        or coverage.get("expectedCount") != coverage.get("mappedCount")
        or coverage.get("missingCount") != 0
        or coverage.get("unaliasedRowCount") != 0
    ):
        raise RunnerContractError("legacy_alias_coverage_incomplete")

    materials = artifact.get("materials")
    if not isinstance(materials, list) or not materials:
        raise RunnerContractError("artifact_materials_empty")
    typed_materials: list[Mapping[str, Any]] = []
    ids: set[str] = set()
    for entry in materials:
        if not isinstance(entry, dict):
            raise RunnerContractError("artifact_material_shape_invalid")
        material_id = entry.get("id")
        if not isinstance(material_id, str) or not material_id or material_id in ids:
            raise RunnerContractError("artifact_material_id_invalid")
        ids.add(material_id)
        typed_materials.append(entry)
    return artifact, typed_materials


def _validate_plan(
    *,
    artifact: Mapping[str, Any],
    artifact_bytes: bytes,
    materials: Sequence[Mapping[str, Any]],
    plan: Any,
    prompt_template: bytes,
) -> Mapping[str, Any]:
    plan = _require_exact_keys(plan, PLAN_KEYS, "plan_shape_invalid")
    if plan["schemaVersion"] != SCHEMA_VERSION or plan["kind"] != "winddown-luna-shard-plan":
        raise RunnerContractError("plan_shape_invalid")
    if plan["requestedModel"] != MODEL_ALIAS:
        raise RunnerContractError("plan_model_mismatch")
    if plan["artifactDigest"] != artifact["digest"]:
        raise RunnerContractError("plan_artifact_digest_mismatch")
    if plan["artifactBytesDigest"] != sha256_hex(artifact_bytes):
        raise RunnerContractError("plan_artifact_bytes_digest_mismatch")
    if plan["promptTemplateDigest"] != sha256_hex(prompt_template):
        raise RunnerContractError("prompt_template_digest_mismatch")
    for key in (
        "artifactDigest",
        "artifactBytesDigest",
        "manifestDigest",
        "promptTemplateDigest",
        "digest",
    ):
        _require_sha256(plan[key], f"plan_{key}_invalid")
    shard_size = plan["shardSize"]
    if (
        not isinstance(shard_size, int)
        or isinstance(shard_size, bool)
        or shard_size < 1
        or shard_size > MAX_SHARD_SIZE
    ):
        raise RunnerContractError("plan_shard_size_invalid")
    if plan["materialCount"] != len(materials):
        raise RunnerContractError("plan_material_count_mismatch")
    shards = plan["shards"]
    if not isinstance(shards, list) or plan["shardCount"] != len(shards):
        raise RunnerContractError("plan_shard_count_mismatch")

    expected_bindings = [
        {
            "materialId": material["id"],
            "inputMaterialDigest": sha256_hex(canonical_json(material)),
        }
        for material in materials
    ]
    actual_bindings: list[Mapping[str, Any]] = []
    for position, shard_value in enumerate(shards):
        shard = _require_exact_keys(shard_value, SHARD_KEYS, "plan_shard_shape_invalid")
        if shard["shardIndex"] != position:
            raise RunnerContractError("plan_shard_order_mismatch")
        _require_sha256(shard["shardId"], "plan_shard_id_invalid")
        items = shard["items"]
        if not isinstance(items, list) or not items or len(items) > shard_size:
            raise RunnerContractError("plan_shard_items_invalid")
        if position < len(shards) - 1 and len(items) != shard_size:
            raise RunnerContractError("plan_shard_items_invalid")
        typed_items: list[Mapping[str, Any]] = []
        for item_value in items:
            item = _require_exact_keys(item_value, PLAN_ITEM_KEYS, "plan_item_shape_invalid")
            if not isinstance(item["materialId"], str):
                raise RunnerContractError("plan_item_shape_invalid")
            _require_sha256(item["inputMaterialDigest"], "plan_item_digest_invalid")
            typed_items.append(item)
            actual_bindings.append(item)
        expected_shard_id = sha256_hex(
            canonical_json(
                {
                    "artifactDigest": plan["artifactDigest"],
                    "artifactBytesDigest": plan["artifactBytesDigest"],
                    "manifestDigest": plan["manifestDigest"],
                    "promptTemplateDigest": plan["promptTemplateDigest"],
                    "requestedModel": MODEL_ALIAS,
                    "shardIndex": position,
                    "items": typed_items,
                }
            )
        )
        if shard["shardId"] != expected_shard_id:
            raise RunnerContractError("plan_shard_id_mismatch")
    if actual_bindings != expected_bindings:
        raise RunnerContractError("plan_material_coverage_mismatch")

    without_digest = {key: plan[key] for key in PLAN_KEYS if key != "digest"}
    if plan["digest"] != sha256_hex(canonical_json(without_digest)):
        raise RunnerContractError("plan_digest_mismatch")
    return plan


def _bounded_strings(
    value: Any,
    *,
    minimum: int,
    maximum: int,
    max_length: int,
    code: str,
) -> list[str]:
    if not isinstance(value, list) or not minimum <= len(value) <= maximum:
        raise RunnerContractError(code)
    result: list[str] = []
    seen: set[str] = set()
    for entry in value:
        if (
            not isinstance(entry, str)
            or not entry.strip()
            or len(entry) > max_length
            or SECRET_LIKE_TEXT.search(entry)
        ):
            raise RunnerContractError(code)
        normalized = entry.strip().casefold()
        if normalized in seen:
            raise RunnerContractError(code)
        seen.add(normalized)
        result.append(entry)
    return result


def _normalize_text(value: str) -> str:
    return " ".join(value.strip().casefold().split())


def _sanitize_response_item(
    value: Any,
    *,
    binding: Mapping[str, Any],
    material: Mapping[str, Any],
) -> dict[str, Any]:
    if isinstance(value, dict) and FORBIDDEN_RESPONSE_FIELDS.intersection(value):
        raise RunnerContractError("response_forbidden_field")
    item = _require_exact_keys(value, RESPONSE_ITEM_KEYS, "response_item_shape_invalid")
    if item["materialId"] != binding["materialId"]:
        raise RunnerContractError("response_material_order_or_id_mismatch")
    if item["inputMaterialDigest"] != binding["inputMaterialDigest"]:
        raise RunnerContractError("response_input_digest_mismatch")
    if item["verdict"] not in {"approve", "needs_human_review", "reject"}:
        raise RunnerContractError("response_verdict_invalid")
    evidence = _bounded_strings(
        item["evidence"],
        minimum=1,
        maximum=2,
        max_length=240,
        code="response_evidence_invalid",
    )
    enrichment_value = item["enrichment"]
    if (
        isinstance(enrichment_value, dict)
        and FORBIDDEN_RESPONSE_FIELDS.intersection(enrichment_value)
    ):
        raise RunnerContractError("response_forbidden_field")
    enrichment = _require_exact_keys(
        enrichment_value, ENRICHMENT_KEYS, "response_enrichment_shape_invalid"
    )
    chunks = _bounded_strings(
        enrichment["chunks"],
        minimum=0,
        maximum=8,
        max_length=120,
        code="response_chunks_invalid",
    )
    source_texts = [
        material.get("en"),
        *(
            material.get("acceptedVariants")
            if isinstance(material.get("acceptedVariants"), list)
            else []
        ),
    ]
    normalized_sources = [
        _normalize_text(entry) for entry in source_texts if isinstance(entry, str)
    ]
    if any(
        not any(_normalize_text(chunk) in source for source in normalized_sources)
        for chunk in chunks
    ):
        raise RunnerContractError("response_chunk_not_grounded")

    distractors = _bounded_strings(
        enrichment["distractors"],
        minimum=0,
        maximum=4,
        max_length=140,
        code="response_distractors_invalid",
    )
    accepted = set(normalized_sources)
    if any(_normalize_text(entry) in accepted for entry in distractors):
        raise RunnerContractError("response_distractor_matches_answer")

    difficulty_note = enrichment["difficultyNote"]
    if difficulty_note is not None and (
        not isinstance(difficulty_note, str)
        or not difficulty_note.strip()
        or len(difficulty_note) > 240
        or SECRET_LIKE_TEXT.search(difficulty_note)
    ):
        raise RunnerContractError("response_difficulty_note_invalid")
    scenario_tags = _bounded_strings(
        enrichment["scenarioTags"],
        minimum=0,
        maximum=8,
        max_length=32,
        code="response_scenario_tags_invalid",
    )
    if any(tag not in SCENARIO_TAGS for tag in scenario_tags):
        raise RunnerContractError("response_scenario_tags_invalid")
    naturalness_flags = _bounded_strings(
        enrichment["naturalnessFlags"],
        minimum=0,
        maximum=6,
        max_length=32,
        code="response_naturalness_flags_invalid",
    )
    if any(flag not in NATURALNESS_FLAGS for flag in naturalness_flags):
        raise RunnerContractError("response_naturalness_flags_invalid")
    positive = bool({"natural", "idiomatic"}.intersection(naturalness_flags))
    negative = bool(
        {"literal", "awkward", "ambiguous", "register-mismatch"}.intersection(
            naturalness_flags
        )
    )
    if positive and negative:
        raise RunnerContractError("response_naturalness_flags_invalid")

    return {
        "materialId": item["materialId"],
        "inputMaterialDigest": item["inputMaterialDigest"],
        "verdict": item["verdict"],
        "evidence": evidence,
        "enrichment": {
            "chunks": chunks,
            "distractors": distractors,
            "difficultyNote": difficulty_note,
            "scenarioTags": scenario_tags,
            "naturalnessFlags": naturalness_flags,
        },
    }


def _sanitize_response_items_with_safe_digest_echo_gate(
    values: Sequence[Any],
    *,
    bindings: Sequence[Mapping[str, Any]],
    materials_by_id: Mapping[str, Mapping[str, Any]],
) -> list[dict[str, Any]]:
    typed_items: list[Mapping[str, Any]] = []
    for value in values:
        if isinstance(value, dict) and FORBIDDEN_RESPONSE_FIELDS.intersection(value):
            raise RunnerContractError("response_forbidden_field")
        item = _require_exact_keys(
            value, RESPONSE_ITEM_KEYS, "response_item_shape_invalid"
        )
        enrichment_value = item["enrichment"]
        if (
            isinstance(enrichment_value, dict)
            and FORBIDDEN_RESPONSE_FIELDS.intersection(enrichment_value)
        ):
            raise RunnerContractError("response_forbidden_field")
        if isinstance(enrichment_value, dict) and (
            frozenset(enrichment_value) - ENRICHMENT_KEYS
        ):
            raise RunnerContractError("response_unknown_field")
        _require_exact_keys(
            enrichment_value,
            ENRICHMENT_KEYS,
            "response_enrichment_shape_invalid",
        )
        typed_items.append(item)

    for item, binding in zip(typed_items, bindings, strict=True):
        if item["materialId"] != binding["materialId"]:
            raise RunnerContractError("response_material_order_or_id_mismatch")

    digest_mismatch = False
    sanitized_items: list[dict[str, Any]] = []
    for item, binding in zip(typed_items, bindings, strict=True):
        candidate = dict(item)
        if candidate["inputMaterialDigest"] != binding["inputMaterialDigest"]:
            digest_mismatch = True
            candidate["inputMaterialDigest"] = binding["inputMaterialDigest"]
        sanitized_items.append(
            _sanitize_response_item(
                candidate,
                binding=binding,
                material=materials_by_id[binding["materialId"]],
            )
        )
    if digest_mismatch:
        raise RunnerContractError("response_input_digest_mismatch")
    return sanitized_items


def _build_shard_prompt(
    prompt_template: bytes,
    shard: Mapping[str, Any],
    materials_by_id: Mapping[str, Mapping[str, Any]],
) -> str:
    try:
        template = prompt_template.decode("utf-8")
    except UnicodeDecodeError:
        raise RunnerContractError("prompt_template_not_utf8") from None
    if not template.strip():
        raise RunnerContractError("prompt_template_empty")
    payload = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": "winddown-luna-shard-input",
        "shardId": shard["shardId"],
        "items": [
            {
                "materialId": binding["materialId"],
                "inputMaterialDigest": binding["inputMaterialDigest"],
                "material": materials_by_id[binding["materialId"]],
            }
            for binding in shard["items"]
        ],
    }
    return f"{template.rstrip()}\n\nINPUT SHARD JSON\n{canonical_json(payload)}"


def _call_and_sanitize_shard_once(
    *,
    generate_json: GenerateJson,
    prompt: str,
    shard: Mapping[str, Any],
    materials_by_id: Mapping[str, Mapping[str, Any]],
    timeout_seconds: int,
) -> dict[str, Any]:
    try:
        result = generate_json(
            prompt,
            alias=MODEL_ALIAS,
            schema=RESPONSE_SCHEMA,
            temperature=0,
            timeout=timeout_seconds,
            reasoning={"effort": "low"},
        )
    except Exception:
        raise RunnerContractError("facade_call_failed") from None
    if getattr(result, "error", None) is not None:
        raise RunnerContractError("facade_call_failed")
    requested_model = getattr(result, "requested_model", None) or getattr(result, "model", None)
    if requested_model != MODEL_ALIAS:
        raise RunnerContractError("requested_model_mismatch")
    response_model = getattr(result, "response_model", None)
    if not isinstance(response_model, str) or RESPONSE_MODEL.fullmatch(response_model) is None:
        raise RunnerContractError("response_model_mismatch")
    text = getattr(result, "text", None)
    if not isinstance(text, str) or not text.strip():
        raise RunnerContractError("facade_response_empty")
    response = parse_json_bytes(text.encode("utf-8"), "facade_response_invalid_json")
    response = _require_exact_keys(response, RESPONSE_KEYS, "response_shape_invalid")
    if (
        response["schemaVersion"] != SCHEMA_VERSION
        or response["kind"] != "winddown-luna-shard-response"
        or response["shardId"] != shard["shardId"]
    ):
        raise RunnerContractError("response_shape_invalid")
    response_items = response["items"]
    bindings = shard["items"]
    if not isinstance(response_items, list) or len(response_items) != len(bindings):
        raise RunnerContractError("response_material_coverage_mismatch")
    sanitized_items = _sanitize_response_items_with_safe_digest_echo_gate(
        response_items,
        bindings=bindings,
        materials_by_id=materials_by_id,
    )
    sanitized_response = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": "winddown-luna-shard-response",
        "shardId": shard["shardId"],
        "items": sanitized_items,
    }
    return {
        "schemaVersion": SCHEMA_VERSION,
        "kind": "winddown-luna-shard-receipt",
        "shardIndex": shard["shardIndex"],
        "shardId": shard["shardId"],
        "requestedModel": MODEL_ALIAS,
        "responseModel": response_model,
        "responseDigest": sha256_hex(canonical_json(sanitized_response)),
        "items": sanitized_items,
    }


def _repair_prompt(
    prompt: str,
    code: str,
    shard: Mapping[str, Any],
) -> str:
    if code == "response_input_digest_mismatch":
        identity_instruction = (
            "Preserve every materialId, shardId, item count, and item order.\n"
            "INPUT DIGEST ECHO CORRECTION\n"
            "Set each inputMaterialDigest to the exact expected value in this "
            "ordered binding list; copy every value byte-for-byte:\n"
            f"{canonical_json(shard['items'])}\n"
        )
    else:
        identity_instruction = (
            "Preserve every materialId, inputMaterialDigest, shardId, item count, "
            "and item order.\n"
        )
    return (
        f"{prompt}\n\n"
        "BOUNDED REPAIR ATTEMPT 1 OF 1\n"
        f"Validation code: {code}\n"
        "Return the full exact shard response again. "
        f"{identity_instruction}"
        "Do not add "
        "source-truth, provider, account, usage, request, or error fields. "
        "Set uncertain chunks, distractors, scenarioTags, and naturalnessFlags to []. "
        "Set an uncertain difficultyNote to null."
    )


def _call_and_sanitize_shard(
    *,
    generate_json: GenerateJson,
    prompt: str,
    shard: Mapping[str, Any],
    materials_by_id: Mapping[str, Mapping[str, Any]],
    timeout_seconds: int,
) -> dict[str, Any]:
    current_prompt = prompt
    for attempt in range(2):
        try:
            return _call_and_sanitize_shard_once(
                generate_json=generate_json,
                prompt=current_prompt,
                shard=shard,
                materials_by_id=materials_by_id,
                timeout_seconds=timeout_seconds,
            )
        except RunnerContractError as exc:
            code = str(exc)
            if attempt == 0 and code in SAFE_ENRICHMENT_REPAIR_CODES:
                current_prompt = _repair_prompt(prompt, code, shard)
                continue
            raise RunnerContractError(
                f"shard_{shard['shardIndex']}:{code}"
            ) from None
    raise RunnerContractError(
        f"shard_{shard['shardIndex']}:repair_attempt_exhausted"
    )


def _checkpoint_digest(value: Mapping[str, Any]) -> str:
    return sha256_hex(
        canonical_json({key: value[key] for key in CHECKPOINT_KEYS if key != "checkpointDigest"})
    )


def _checkpoint_value(
    *,
    plan: Mapping[str, Any],
    shard: Mapping[str, Any],
    receipt: Mapping[str, Any],
) -> dict[str, Any]:
    value = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": "winddown-luna-shard-checkpoint",
        "planDigest": plan["digest"],
        "shardIndex": shard["shardIndex"],
        "shardId": shard["shardId"],
        "responseDigest": receipt["responseDigest"],
        "receipt": receipt,
    }
    return {**value, "checkpointDigest": _checkpoint_digest(value)}


def _checkpoint_filename(value: Mapping[str, Any]) -> str:
    return (
        f"{value['planDigest']}.{value['shardIndex']:05d}."
        f"{value['shardId']}.{value['responseDigest']}.json"
    )


def _prepare_checkpoint_dir(checkpoint_dir: Path) -> Path:
    destination = checkpoint_dir.expanduser().absolute()
    try:
        if destination.is_symlink():
            raise RunnerContractError("checkpoint_dir_invalid")
        destination.mkdir(parents=True, exist_ok=True)
        if destination.is_symlink() or not destination.is_dir():
            raise RunnerContractError("checkpoint_dir_invalid")
    except RunnerContractError:
        raise
    except OSError:
        raise RunnerContractError("checkpoint_dir_invalid") from None
    return destination


def _fsync_directory(path: Path, code: str) -> None:
    try:
        directory_fd = os.open(path, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except OSError:
        raise RunnerContractError(code) from None


def _validate_checkpoint_receipt(
    *,
    value: Any,
    shard: Mapping[str, Any],
    materials_by_id: Mapping[str, Mapping[str, Any]],
) -> dict[str, Any]:
    receipt = _require_exact_keys(value, RECEIPT_KEYS, "checkpoint_receipt_shape_invalid")
    if (
        not isinstance(receipt["schemaVersion"], int)
        or isinstance(receipt["schemaVersion"], bool)
        or receipt["schemaVersion"] != SCHEMA_VERSION
        or receipt["kind"] != "winddown-luna-shard-receipt"
        or not isinstance(receipt["shardIndex"], int)
        or isinstance(receipt["shardIndex"], bool)
        or receipt["shardIndex"] != shard["shardIndex"]
        or receipt["shardId"] != shard["shardId"]
        or receipt["requestedModel"] != MODEL_ALIAS
    ):
        raise RunnerContractError("checkpoint_receipt_binding_mismatch")
    response_model = receipt["responseModel"]
    if not isinstance(response_model, str) or RESPONSE_MODEL.fullmatch(response_model) is None:
        raise RunnerContractError("checkpoint_response_model_mismatch")
    response_digest = _require_sha256(
        receipt["responseDigest"], "checkpoint_response_digest_invalid"
    )
    items = receipt["items"]
    bindings = shard["items"]
    if not isinstance(items, list) or len(items) != len(bindings):
        raise RunnerContractError("checkpoint_material_coverage_mismatch")
    sanitized_items = [
        _sanitize_response_item(
            item,
            binding=binding,
            material=materials_by_id[binding["materialId"]],
        )
        for item, binding in zip(items, bindings, strict=True)
    ]
    sanitized_response = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": "winddown-luna-shard-response",
        "shardId": shard["shardId"],
        "items": sanitized_items,
    }
    if response_digest != sha256_hex(canonical_json(sanitized_response)):
        raise RunnerContractError("checkpoint_response_digest_mismatch")
    sanitized_receipt = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": "winddown-luna-shard-receipt",
        "shardIndex": shard["shardIndex"],
        "shardId": shard["shardId"],
        "requestedModel": MODEL_ALIAS,
        "responseModel": response_model,
        "responseDigest": response_digest,
        "items": sanitized_items,
    }
    if canonical_json(receipt) != canonical_json(sanitized_receipt):
        raise RunnerContractError("checkpoint_receipt_not_canonical")
    return sanitized_receipt


def _load_checkpoints(
    *,
    checkpoint_dir: Path,
    plan: Mapping[str, Any],
    materials_by_id: Mapping[str, Mapping[str, Any]],
) -> tuple[Path, dict[int, dict[str, Any]]]:
    directory = _prepare_checkpoint_dir(checkpoint_dir)
    shards_by_index = {shard["shardIndex"]: shard for shard in plan["shards"]}
    receipts: dict[int, dict[str, Any]] = {}
    try:
        entries = sorted(directory.iterdir(), key=lambda path: path.name)
    except OSError:
        raise RunnerContractError("checkpoint_dir_invalid") from None
    for path in entries:
        match = CHECKPOINT_FILE.fullmatch(path.name)
        if (
            match is None
            or path.is_symlink()
            or not path.is_file()
            or match.group("plan") != plan["digest"]
        ):
            raise RunnerContractError("checkpoint_unknown_or_stale")
        shard_index = int(match.group("index"))
        shard = shards_by_index.get(shard_index)
        if (
            shard is None
            or shard_index in receipts
            or match.group("shard") != shard["shardId"]
        ):
            raise RunnerContractError("checkpoint_unknown_or_stale")
        try:
            raw = path.read_bytes()
        except OSError:
            raise RunnerContractError("checkpoint_read_failed") from None
        checkpoint = parse_json_bytes(raw, "checkpoint_invalid_json")
        checkpoint = _require_exact_keys(
            checkpoint, CHECKPOINT_KEYS, "checkpoint_shape_invalid"
        )
        if checkpoint["checkpointDigest"] != _checkpoint_digest(checkpoint):
            raise RunnerContractError("checkpoint_digest_mismatch")
        if (
            not isinstance(checkpoint["schemaVersion"], int)
            or isinstance(checkpoint["schemaVersion"], bool)
            or checkpoint["schemaVersion"] != SCHEMA_VERSION
            or checkpoint["kind"] != "winddown-luna-shard-checkpoint"
            or checkpoint["planDigest"] != plan["digest"]
            or not isinstance(checkpoint["shardIndex"], int)
            or isinstance(checkpoint["shardIndex"], bool)
            or checkpoint["shardIndex"] != shard_index
            or checkpoint["shardId"] != shard["shardId"]
            or checkpoint["responseDigest"] != match.group("response")
        ):
            raise RunnerContractError("checkpoint_binding_mismatch")
        receipt = _validate_checkpoint_receipt(
            value=checkpoint["receipt"],
            shard=shard,
            materials_by_id=materials_by_id,
        )
        if checkpoint["responseDigest"] != receipt["responseDigest"]:
            raise RunnerContractError("checkpoint_response_digest_mismatch")
        if path.name != _checkpoint_filename(checkpoint):
            raise RunnerContractError("checkpoint_binding_mismatch")
        receipts[shard_index] = receipt
    if entries:
        _fsync_directory(directory, "checkpoint_write_failed")
    return directory, receipts


def _write_checkpoint(
    *,
    checkpoint_dir: Path,
    plan: Mapping[str, Any],
    shard: Mapping[str, Any],
    receipt: Mapping[str, Any],
) -> None:
    checkpoint = _checkpoint_value(plan=plan, shard=shard, receipt=receipt)
    payload = (canonical_json(checkpoint) + "\n").encode("utf-8")
    destination = checkpoint_dir / _checkpoint_filename(checkpoint)
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            dir=checkpoint_dir.parent,
            prefix=".winddown-luna-checkpoint.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temp_path = Path(handle.name)
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temp_path, destination)
        except FileExistsError:
            if destination.is_symlink() or destination.read_bytes() != payload:
                raise RunnerContractError("checkpoint_immutable_collision") from None
        _fsync_directory(checkpoint_dir, "checkpoint_write_failed")
    except RunnerContractError:
        raise
    except OSError:
        raise RunnerContractError("checkpoint_write_failed") from None
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


def run_batches(
    *,
    artifact: Any,
    artifact_bytes: bytes,
    plan: Any,
    prompt_template: bytes,
    generate_json: GenerateJson,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    checkpoint_dir: Path | None = None,
    progress: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    if not callable(generate_json):
        raise RunnerContractError("generate_json_not_callable")
    if (
        not isinstance(timeout_seconds, int)
        or isinstance(timeout_seconds, bool)
        or timeout_seconds < 1
        or timeout_seconds > 1800
    ):
        raise RunnerContractError("timeout_invalid")
    artifact, materials = _validate_artifact(artifact, artifact_bytes)
    plan = _validate_plan(
        artifact=artifact,
        artifact_bytes=artifact_bytes,
        materials=materials,
        plan=plan,
        prompt_template=prompt_template,
    )
    materials_by_id = {material["id"]: material for material in materials}
    checkpoint_path: Path | None = None
    checkpoint_receipts: dict[int, dict[str, Any]] = {}
    if checkpoint_dir is not None:
        checkpoint_path, checkpoint_receipts = _load_checkpoints(
            checkpoint_dir=checkpoint_dir,
            plan=plan,
            materials_by_id=materials_by_id,
        )
    receipts: list[dict[str, Any]] = []
    for shard in plan["shards"]:
        receipt = checkpoint_receipts.get(shard["shardIndex"])
        source = "checkpoint"
        if receipt is None:
            source = "live"
            receipt = _call_and_sanitize_shard(
                generate_json=generate_json,
                prompt=_build_shard_prompt(prompt_template, shard, materials_by_id),
                shard=shard,
                materials_by_id=materials_by_id,
                timeout_seconds=timeout_seconds,
            )
            if checkpoint_path is not None:
                _write_checkpoint(
                    checkpoint_dir=checkpoint_path,
                    plan=plan,
                    shard=shard,
                    receipt=receipt,
                )
        receipts.append(receipt)
        if progress is not None:
            progress(
                "winddown_luna_runner: "
                f"shard {shard['shardIndex'] + 1}/{plan['shardCount']} "
                f"validated source={source}"
            )
    output_ids = [
        item["materialId"] for receipt in receipts for item in receipt["items"]
    ]
    if output_ids != [material["id"] for material in materials]:
        raise RunnerContractError("response_material_coverage_mismatch")
    return {
        "schemaVersion": SCHEMA_VERSION,
        "kind": "winddown-luna-receipt-bundle",
        "planDigest": plan["digest"],
        "artifactDigest": plan["artifactDigest"],
        "artifactBytesDigest": plan["artifactBytesDigest"],
        "manifestDigest": plan["manifestDigest"],
        "promptTemplateDigest": plan["promptTemplateDigest"],
        "requestedModel": MODEL_ALIAS,
        "materialCount": plan["materialCount"],
        "shardCount": plan["shardCount"],
        "shards": receipts,
    }


def run_to_path(
    *,
    artifact: Any,
    artifact_bytes: bytes,
    plan: Any,
    prompt_template: bytes,
    generate_json: GenerateJson,
    output_path: Path,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    checkpoint_dir: Path | None = None,
    progress: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    output = run_batches(
        artifact=artifact,
        artifact_bytes=artifact_bytes,
        plan=plan,
        prompt_template=prompt_template,
        generate_json=generate_json,
        timeout_seconds=timeout_seconds,
        checkpoint_dir=checkpoint_dir,
        progress=progress,
    )
    destination = output_path.expanduser().resolve()
    if not destination.parent.is_dir():
        raise RunnerContractError("output_parent_missing")
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="\n",
            dir=destination.parent,
            prefix=f".{destination.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temp_path = Path(handle.name)
            json.dump(output, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, destination)
        _fsync_directory(destination.parent, "output_write_failed")
    except OSError:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)
        raise RunnerContractError("output_write_failed") from None
    return output


def _load_json_file(path: Path, code: str) -> tuple[Any, bytes]:
    try:
        raw = path.expanduser().resolve().read_bytes()
    except OSError:
        raise RunnerContractError(code) from None
    return parse_json_bytes(raw, code), raw


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run Wind Down Luna shards through the approved CCH feno_llm facade."
    )
    parser.add_argument("--artifact", type=Path, required=True)
    parser.add_argument("--shard-plan", type=Path, required=True)
    parser.add_argument("--prompt-template", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--approved-cch-root", type=Path, required=True)
    parser.add_argument("--checkpoint-dir", type=Path)
    parser.add_argument("--timeout-seconds", type=int, default=DEFAULT_TIMEOUT_SECONDS)
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Explicitly opt in to real feno_llm calls.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if not args.execute:
        print("winddown_luna_runner: live_execution_not_opted_in", file=sys.stderr)
        return 2
    try:
        artifact, artifact_bytes = _load_json_file(args.artifact, "artifact_read_failed")
        plan, _plan_bytes = _load_json_file(args.shard_plan, "plan_read_failed")
        try:
            prompt_template = args.prompt_template.expanduser().resolve().read_bytes()
        except OSError:
            raise RunnerContractError("prompt_template_read_failed") from None
        generate_json = load_approved_generate_json(args.approved_cch_root)
        output = run_to_path(
            artifact=artifact,
            artifact_bytes=artifact_bytes,
            plan=plan,
            prompt_template=prompt_template,
            generate_json=generate_json,
            output_path=args.output,
            timeout_seconds=args.timeout_seconds,
            checkpoint_dir=args.checkpoint_dir,
            progress=lambda message: print(message, file=sys.stderr),
        )
    except RunnerContractError as exc:
        print(f"winddown_luna_runner: {exc}", file=sys.stderr)
        return 1
    print(
        canonical_json(
            {
                "status": "ok",
                "materialCount": output["materialCount"],
                "shardCount": output["shardCount"],
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
