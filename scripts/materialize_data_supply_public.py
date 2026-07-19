#!/usr/bin/env python3
"""Fail-closed R2.4 ETF-detail public projection materializer.

The selected payload files are copied byte-for-byte from immutable state-store
objects.  Resolution metadata lives only in the separately hashed public index.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Callable, Mapping

from data_supply_state import DataSupplyStateStore, canonical_sha256


DOMAIN = "etf_detail"
ENROLLMENT_SCHEMA = "data-supply-etf-detail-enrollment/v1"
INDEX_SCHEMA = "data-supply-etf-detail-public-index/v1"
EXPECTED_ENROLLMENT_COUNT = 718
EXPECTED_MEMBERSHIP_SHA256 = "6b30e5d314daae54f635ba46d4936c4ab228416599dcc35eba8638115fdeff32"
STATE_REL_ROOT = Path("data/admin/data-supply-state/v1")
CANONICAL_REL_ROOT = Path("data/computed/data-supply/etf-detail")
PUBLIC_DATA_REL_ROOT = Path("100xfenok-next/public/data")
PRIVATE_RECONCILE_REL_PATH = Path("_private/admin/data-supply-public-reconcile/etf-detail.json")
HEX64 = re.compile(r"^[0-9a-f]{64}$")
TICKER = re.compile(r"^[A-Z0-9][A-Z0-9._-]*$")
PROVIDER = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
SELECTED_STATES = {"fresh_primary", "fresh_fallback", "lkg_primary", "lkg_fallback"}
STATE_COUNT_KEYS = ("fresh_primary", "fresh_fallback", "lkg_primary", "lkg_fallback", "unavailable")
IMMUTABLE_REF_KINDS = {"provider_object", "provider_lkg"}
FORBIDDEN_PUBLIC_TOKENS = (
    b"_private/",
    b"admin/data-supply-state/",
    b"data/admin/data-supply-state/",
    b"yf/migration-evidence/",
    b"yf/etf-details/",
    b"providers/",
    # Private derived proxies (apewisdom_attention / gdelt_news_tone lanes,
    # public_mirror:[]). File-granular private canonical outputs registered here
    # as forbidden prefixes for parity with the lane-registry derivation.
    b"computed/fenok_news_tone_proxy.json/",
    b"computed/fenok_news_tone_proxy_history.json/",
    b"computed/fenok_social_attention_proxy.json/",
    b"computed/fenok_social_attention_proxy_history.json/",
)
USAGE_MANIFEST_TOKENS = (
    b"admin/data-supply-state/",
    b"data/admin/data-supply-state/",
    b"yf/migration-evidence/",
    b"yf/etf-details/",
)
FORBIDDEN_METADATA_TOKENS = FORBIDDEN_PUBLIC_TOKENS + (b"http://", b"https://")
SELECTED_ENTRY_KEYS = {
    "ticker",
    "enrollment_state",
    "resolution_state",
    "provider_role",
    "fallback_depth",
    "source_as_of",
    "selected_at",
    "reason_code",
    "payload_sha256",
    "payload_path",
}
UNAVAILABLE_ENTRY_KEYS = {
    "ticker",
    "enrollment_state",
    "resolution_state",
    "provider_role",
    "fallback_depth",
    "source_as_of",
    "payload_sha256",
    "payload_path",
    "recovery_transition",
}


class MaterializationError(RuntimeError):
    """Projection or reconciliation evidence is unsafe or inconsistent."""


@dataclass(frozen=True)
class Projection:
    enrollment: dict[str, Any]
    index: dict[str, Any]
    payloads: dict[str, bytes]
    counts: dict[str, int]
    tracked_paths: tuple[str, ...]


def _pretty_json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode("utf-8")


def _strict_json_bytes(payload: bytes, label: str) -> dict[str, Any]:
    def reject_constant(value: str) -> None:
        raise ValueError(f"non-finite number {value}")

    def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"duplicate key {key!r}")
            result[key] = value
        return result

    try:
        value = json.loads(
            payload.decode("utf-8"),
            parse_constant=reject_constant,
            object_pairs_hook=reject_duplicate_keys,
        )
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        raise MaterializationError(f"{label} is not strict JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise MaterializationError(f"{label} must be a JSON object")
    return value


def _timestamp(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise MaterializationError(f"{label} must be a non-empty timestamp")
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        parsed = dt.datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise MaterializationError(f"{label} is malformed") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise MaterializationError(f"{label} must include a timezone")
    return value


def _sha(value: Any, label: str) -> str:
    if not isinstance(value, str) or not HEX64.fullmatch(value):
        raise MaterializationError(f"{label} must be a lowercase SHA-256 digest")
    return value


def _ticker(value: Any, label: str) -> str:
    if not isinstance(value, str) or not TICKER.fullmatch(value) or value in {".", ".."}:
        raise MaterializationError(f"{label} is not a safe ticker")
    return value


def _safe_rel_path(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value or "\\" in value or "\x00" in value:
        raise MaterializationError(f"{label} is not a safe relative path")
    candidate = PurePosixPath(value)
    if candidate.is_absolute() or any(part in {"", ".", ".."} for part in candidate.parts):
        raise MaterializationError(f"{label} is not a safe relative path")
    return candidate.as_posix()


def index_content_sha256(index: Mapping[str, Any]) -> str:
    """Digest the logical index with its self-referential field omitted."""

    logical = dict(index)
    logical.pop("index_sha256", None)
    return canonical_sha256(logical)


def _fsync_dir(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _write_file_fsync(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as handle:
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())


def _atomic_write(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temp = Path(temp_name)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, path)
        _fsync_dir(path.parent)
    finally:
        temp.unlink(missing_ok=True)


class PublicDataSupplyMaterializer:
    def __init__(
        self,
        *,
        repo_root: Path | str,
        state_root: Path | str | None = None,
        canonical_root: Path | str | None = None,
        public_data_root: Path | str | None = None,
        state_reader: Any | None = None,
        expected_enrollment_count: int = EXPECTED_ENROLLMENT_COUNT,
        expected_membership_sha256: str = EXPECTED_MEMBERSHIP_SHA256,
        failpoint: Callable[[str], None] | None = None,
        require_git_tracking: bool = True,
    ):
        self.repo_root = Path(repo_root).expanduser().resolve()
        self.state_root = self._rooted(state_root, STATE_REL_ROOT)
        self.canonical_root = self._rooted(canonical_root, CANONICAL_REL_ROOT)
        self.public_data_root = self._rooted(public_data_root, PUBLIC_DATA_REL_ROOT)
        self.reconcile_journal = self.repo_root / PRIVATE_RECONCILE_REL_PATH
        self.state_reader = state_reader or DataSupplyStateStore(self.state_root, defer_maintenance=True)
        self.expected_enrollment_count = expected_enrollment_count
        self.expected_membership_sha256 = _sha(expected_membership_sha256, "expected_membership_sha256")
        self.failpoint = failpoint or (lambda _point: None)
        self.require_git_tracking = require_git_tracking

    def _rooted(self, value: Path | str | None, default: Path) -> Path:
        path = Path(value) if value is not None else default
        if not path.is_absolute():
            path = self.repo_root / path
        resolved = path.expanduser().resolve(strict=False)
        try:
            resolved.relative_to(self.repo_root)
        except ValueError as exc:
            raise MaterializationError(f"path escapes repository root: {path}") from exc
        return resolved

    def _regular_file(self, path: Path, *, root: Path, label: str) -> Path:
        try:
            relative = path.relative_to(root)
        except ValueError as exc:
            raise MaterializationError(f"{label} escapes its root") from exc
        cursor = root
        if root.is_symlink() or not root.is_dir():
            raise MaterializationError(f"{label} root is not a regular directory")
        for part in relative.parts:
            cursor = cursor / part
            try:
                cursor.lstat()
            except FileNotFoundError as exc:
                raise MaterializationError(f"{label} is missing") from exc
            if cursor.is_symlink():
                raise MaterializationError(f"{label} contains a symlink")
        if not path.is_file():
            raise MaterializationError(f"{label} is not a regular file")
        return path

    def _repo_rel(self, path: Path) -> str:
        try:
            return path.relative_to(self.repo_root).as_posix()
        except ValueError as exc:
            raise MaterializationError(f"path is outside repository: {path}") from exc

    def _git_tracked_set(self) -> set[str]:
        if not self.require_git_tracking:
            return set()
        run = subprocess.run(
            ["git", "ls-files", "-z", "--cached"],
            cwd=self.repo_root,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if run.returncode != 0:
            raise MaterializationError(f"Git tracked-file inventory failed: {run.stderr.decode(errors='replace').strip()}")
        return {item.decode("utf-8") for item in run.stdout.split(b"\0") if item}

    def _require_tracked(self, paths: set[str]) -> None:
        if not self.require_git_tracking:
            return
        tracked = self._git_tracked_set()
        missing = sorted(paths - tracked)
        if missing:
            raise MaterializationError(f"required state/ref paths are not Git-tracked: {missing[:5]}")

    def _validate_usage_manifests(self) -> None:
        for path in (
            self.repo_root / "data/admin/data-usage-manifest.json",
            self.public_data_root / "admin/data-usage-manifest.json",
        ):
            regular = self._regular_file(path, root=self.repo_root, label=self._repo_rel(path))
            payload = regular.read_bytes()
            _strict_json_bytes(payload, self._repo_rel(path))
            hits = [token.decode() for token in USAGE_MANIFEST_TOKENS if token in payload]
            if hits:
                raise MaterializationError(f"data-usage manifest contains private state paths: {self._repo_rel(path)} {hits}")

    def _validate_selection(self, entity: str, selection: Any) -> dict[str, Any]:
        if not isinstance(selection, Mapping):
            raise MaterializationError(f"selection {entity} must be an object")
        row = dict(selection)
        if row.get("schema_version") != "data-supply-selection/v1" or row.get("domain") != DOMAIN or row.get("entity") != entity:
            raise MaterializationError(f"selection {entity} identity mismatch")
        state = row.get("resolution_state")
        if state not in SELECTED_STATES:
            raise MaterializationError(f"selection {entity} has unknown resolution state")
        fallback_depth = row.get("fallback_depth")
        if not isinstance(fallback_depth, int) or isinstance(fallback_depth, bool) or fallback_depth < 0:
            raise MaterializationError(f"selection {entity} fallback_depth is invalid")
        _timestamp(row.get("source_as_of"), f"selection {entity} source_as_of")
        _timestamp(row.get("selected_at"), f"selection {entity} selected_at")
        ref = row.get("payload_ref")
        if not isinstance(ref, Mapping) or ref.get("kind") not in IMMUTABLE_REF_KINDS:
            raise MaterializationError(f"selection {entity} payload_ref is not immutable")
        digest = _sha(row.get("payload_sha256"), f"selection {entity} payload_sha256")
        if ref.get("sha256") != digest:
            raise MaterializationError(f"selection {entity} payload_ref digest mismatch")
        provider = row.get("provider")
        if not isinstance(provider, str) or not PROVIDER.fullmatch(provider):
            raise MaterializationError(f"selection {entity} provider is invalid")
        if not isinstance(row.get("provider_schema"), str) or not row["provider_schema"]:
            raise MaterializationError(f"selection {entity} provider_schema is invalid")
        if not isinstance(row.get("reason_code"), str) or not row["reason_code"]:
            raise MaterializationError(f"selection {entity} reason_code is invalid")
        expected = (
            f"providers/{provider}/{DOMAIN}/objects/{entity}/{digest}.json"
            if ref.get("kind") == "provider_object"
            else f"providers/{provider}/{DOMAIN}/lkg/{entity}/objects/{digest}.json"
        )
        if _safe_rel_path(ref.get("path"), f"selection {entity} payload_ref.path") != expected:
            raise MaterializationError(f"selection {entity} payload_ref identity mismatch")
        return row

    def _retained_files_and_refs(self, active: Mapping[str, Any]) -> tuple[set[str], dict[str, dict[str, Any]]]:
        retained = active.get("retained_generation_ids")
        transaction_id = _sha(active.get("transaction_id"), "active transaction_id")
        if not isinstance(retained, list) or not retained or retained[0] != transaction_id or len(set(retained)) != len(retained):
            raise MaterializationError("active retained generation list is invalid")
        required = {self._repo_rel(self.state_root / f"domains/{DOMAIN}/active.json")}
        refs: dict[str, dict[str, Any]] = {}
        for generation_id in retained:
            _sha(generation_id, "retained generation id")
            generation = self.state_root / f"domains/{DOMAIN}/generations/{generation_id}"
            for name in ("manifest", "current", "lkg", "recovery", "decision"):
                path = generation / f"{name}.json"
                self._regular_file(path, root=self.state_root, label=f"retained {generation_id}/{name}")
                required.add(self._repo_rel(path))
            for name in ("current", "lkg"):
                payload = _strict_json_bytes((generation / f"{name}.json").read_bytes(), f"retained {generation_id}/{name}")
                for entity, selection in payload.items():
                    entity = _ticker(entity, f"retained {name} entity")
                    row = self._validate_selection(entity, selection)
                    refs[row["payload_ref"]["path"]] = row
        return required, refs

    def _read_ref_objects_once(
        self,
        refs: Mapping[str, Mapping[str, Any]],
        required_paths: set[str],
    ) -> dict[str, bytes]:
        payloads: dict[str, bytes] = {}
        for rel_path in sorted(refs):
            row = refs[rel_path]
            path = self.state_root / _safe_rel_path(rel_path, "payload_ref.path")
            self._regular_file(path, root=self.state_root, label=f"immutable payload {rel_path}")
            required_paths.add(self._repo_rel(path))
            body = path.read_bytes()
            if hashlib.sha256(body).hexdigest() != row["payload_sha256"]:
                raise MaterializationError(f"immutable payload digest mismatch: {row['entity']}")
            payloads[rel_path] = body
        return payloads

    def _payload_for_selection(self, entity: str, row: Mapping[str, Any], body: bytes) -> dict[str, Any]:
        payload = _strict_json_bytes(body, f"selected payload {entity}")
        if payload.get("ticker") != entity or payload.get("asset_type") != "etf" or payload.get("schema_version") != row.get("provider_schema"):
            raise MaterializationError(f"selected payload {entity} identity mismatch")
        if payload.get("source_as_of") != row.get("source_as_of"):
            raise MaterializationError(f"selected payload {entity} source_as_of mismatch")
        if "data_supply" in payload:
            raise MaterializationError(f"selected payload {entity} collides with data_supply metadata")
        hits = [token.decode() for token in FORBIDDEN_PUBLIC_TOKENS if token in body]
        if hits:
            raise MaterializationError(f"selected payload {entity} contains private path token(s): {hits}")
        return payload

    def build_projection(self, *, generated_at: str) -> Projection:
        generated_at = _timestamp(generated_at, "generated_at")
        self._validate_usage_manifests()
        try:
            active = self.state_reader.read_active_domain(DOMAIN)
        except Exception as exc:
            raise MaterializationError(f"active domain validation failed: {exc}") from exc
        if not isinstance(active, Mapping):
            raise MaterializationError("active domain must be an object")
        transaction_id = _sha(active.get("transaction_id"), "active transaction_id")
        manifest_sha = _sha(active.get("manifest_sha256"), "active manifest_sha256")
        current = active.get("current")
        recovery = active.get("recovery")
        if not isinstance(current, Mapping) or not isinstance(recovery, Mapping):
            raise MaterializationError("active current/recovery maps are invalid")
        current_keys = {_ticker(value, "current entity") for value in current}
        recovery_keys = {_ticker(value, "recovery entity") for value in recovery}
        if not current_keys.issubset(recovery_keys):
            raise MaterializationError("active current is not a subset of recovery enrollment")
        tickers = sorted(recovery_keys)
        membership_sha = canonical_sha256(tickers)
        if len(tickers) != self.expected_enrollment_count:
            raise MaterializationError(
                f"enrollment count mismatch: expected={self.expected_enrollment_count} actual={len(tickers)}"
            )
        if membership_sha != self.expected_membership_sha256:
            raise MaterializationError(
                f"membership digest mismatch: expected={self.expected_membership_sha256} actual={membership_sha}"
            )

        required_paths, retained_refs = self._retained_files_and_refs(active)
        active_rows: dict[str, dict[str, Any]] = {}
        for entity in sorted(current_keys):
            row = self._validate_selection(entity, current[entity])
            active_rows[entity] = row
            retained_refs[row["payload_ref"]["path"]] = row
        ref_bytes = self._read_ref_objects_once(retained_refs, required_paths)
        self._require_tracked(required_paths)

        entries: dict[str, dict[str, Any]] = {}
        projection_payloads: dict[str, bytes] = {}
        state_counts = {key: 0 for key in STATE_COUNT_KEYS}
        for entity in tickers:
            if entity in active_rows:
                row = active_rows[entity]
                state = row["resolution_state"]
                state_counts[state] += 1
                body = ref_bytes[row["payload_ref"]["path"]]
                self._payload_for_selection(entity, row, body)
                role = "primary" if state in {"fresh_primary", "lkg_primary"} else "fallback"
                projection_payloads[entity] = body
                entries[entity] = {
                    "ticker": entity,
                    "enrollment_state": "enrolled",
                    "resolution_state": state,
                    "provider_role": role,
                    "fallback_depth": row["fallback_depth"],
                    "source_as_of": row["source_as_of"],
                    "selected_at": row["selected_at"],
                    "reason_code": row["reason_code"],
                    "payload_sha256": row["payload_sha256"],
                    "payload_path": f"payloads/{entity}.json",
                }
            else:
                recovery_row = recovery[entity]
                if not isinstance(recovery_row, Mapping) or recovery_row.get("last_transition") != "unavailable":
                    raise MaterializationError(f"unselected enrolled entity is not committed unavailable: {entity}")
                transition = recovery_row.get("last_transition")
                state_counts["unavailable"] += 1
                entries[entity] = {
                    "ticker": entity,
                    "enrollment_state": "enrolled",
                    "resolution_state": "unavailable",
                    "provider_role": None,
                    "fallback_depth": None,
                    "source_as_of": None,
                    "recovery_transition": transition,
                    "payload_sha256": None,
                    "payload_path": None,
                }

        logical_index = {
            "schema_version": INDEX_SCHEMA,
            "domain": DOMAIN,
            "generated_at": generated_at,
            "active_transaction_id": transaction_id,
            "active_generation_manifest_sha256": manifest_sha,
            "membership_sha256": membership_sha,
            "enrolled_count": len(tickers),
            "selected_count": len(current_keys),
            "unavailable_count": len(tickers) - len(current_keys),
            "resolution_state_counts": state_counts,
            "entries": entries,
        }
        index_sha = index_content_sha256(logical_index)
        index = {**logical_index, "index_sha256": index_sha}
        enrollment = {
            "schema_version": ENROLLMENT_SCHEMA,
            "domain": DOMAIN,
            "generated_at": generated_at,
            "active_transaction_id": transaction_id,
            "active_generation_manifest_sha256": manifest_sha,
            "index_sha256": index_sha,
            "membership_sha256": membership_sha,
            "enrolled_count": len(tickers),
            "tickers": tickers,
        }
        for label, payload in (("index", _pretty_json_bytes(index)), ("enrollment", _pretty_json_bytes(enrollment))):
            hits = [token.decode() for token in FORBIDDEN_METADATA_TOKENS if token in payload]
            if hits:
                raise MaterializationError(f"{label} contains private token(s): {hits}")
        counts = {
            "enrolled": len(tickers),
            "selected": len(current_keys),
            "unavailable": len(tickers) - len(current_keys),
            "payloads": len(projection_payloads),
        }
        return Projection(enrollment, index, projection_payloads, counts, tuple(sorted(required_paths)))

    def _tree_files(self, root: Path) -> set[str]:
        if root.is_symlink() or not root.is_dir():
            raise MaterializationError(f"projection root is unsafe: {root}")
        files: set[str] = set()
        for path in root.rglob("*"):
            if path.is_symlink():
                raise MaterializationError(f"projection contains symlink: {path}")
            if path.is_file():
                files.add(path.relative_to(root).as_posix())
            elif not path.is_dir():
                raise MaterializationError(f"projection contains special file: {path}")
        return files

    def _load_projection_tree(self, root: Path) -> Projection:
        files = self._tree_files(root)
        if "enrollment.json" not in files or "index.json" not in files:
            raise MaterializationError("projection is missing enrollment.json or index.json")
        enrollment = _strict_json_bytes((root / "enrollment.json").read_bytes(), "projection enrollment")
        index = _strict_json_bytes((root / "index.json").read_bytes(), "projection index")
        if enrollment.get("schema_version") != ENROLLMENT_SCHEMA or enrollment.get("domain") != DOMAIN:
            raise MaterializationError("projection enrollment identity mismatch")
        if index.get("schema_version") != INDEX_SCHEMA or index.get("domain") != DOMAIN:
            raise MaterializationError("projection index identity mismatch")
        index_sha = _sha(index.get("index_sha256"), "projection index_sha256")
        if index_sha != index_content_sha256(index) or enrollment.get("index_sha256") != index_sha:
            raise MaterializationError("projection index digest binding mismatch")
        tickers = enrollment.get("tickers")
        if not isinstance(tickers, list) or tickers != sorted(set(tickers)):
            raise MaterializationError("projection enrollment tickers are not sorted/unique")
        membership_sha = canonical_sha256(tickers)
        if enrollment.get("membership_sha256") != membership_sha or index.get("membership_sha256") != membership_sha:
            raise MaterializationError("projection membership digest mismatch")
        if enrollment.get("enrolled_count") != len(tickers) or index.get("enrolled_count") != len(tickers):
            raise MaterializationError("projection enrollment count mismatch")
        entries = index.get("entries")
        if not isinstance(entries, dict) or list(entries) != tickers:
            raise MaterializationError("projection entries do not match enrollment")
        payloads: dict[str, bytes] = {}
        selected_count = 0
        unavailable_count = 0
        expected_files = {"enrollment.json", "index.json"}
        state_counts = {key: 0 for key in STATE_COUNT_KEYS}
        for ticker in tickers:
            entry = entries[ticker]
            if not isinstance(entry, dict) or entry.get("ticker") != ticker or entry.get("enrollment_state") != "enrolled":
                raise MaterializationError(f"projection entry identity mismatch: {ticker}")
            state = entry.get("resolution_state")
            if state == "unavailable":
                if set(entry) != UNAVAILABLE_ENTRY_KEYS:
                    raise MaterializationError(f"unavailable entry fields are not public-contract exact: {ticker}")
                unavailable_count += 1
                state_counts[state] += 1
                if any(entry.get(key) is not None for key in ("provider_role", "fallback_depth", "source_as_of", "payload_sha256", "payload_path")):
                    raise MaterializationError(f"unavailable entry carries selected fields: {ticker}")
                continue
            if state not in SELECTED_STATES:
                raise MaterializationError(f"projection entry has unknown state: {ticker}")
            if set(entry) != SELECTED_ENTRY_KEYS:
                raise MaterializationError(f"selected entry fields are not public-contract exact: {ticker}")
            expected_role = "primary" if state in {"fresh_primary", "lkg_primary"} else "fallback"
            if entry.get("provider_role") != expected_role or entry.get("payload_path") != f"payloads/{ticker}.json":
                raise MaterializationError(f"projection selected entry shape mismatch: {ticker}")
            digest = _sha(entry.get("payload_sha256"), f"projection {ticker} payload digest")
            path = root / f"payloads/{ticker}.json"
            self._regular_file(path, root=root, label=f"projection payload {ticker}")
            body = path.read_bytes()
            if hashlib.sha256(body).hexdigest() != digest:
                raise MaterializationError(f"projection payload digest mismatch: {ticker}")
            self._payload_for_selection(
                ticker,
                {"provider_schema": _strict_json_bytes(body, ticker).get("schema_version"), "source_as_of": entry.get("source_as_of")},
                body,
            )
            payloads[ticker] = body
            expected_files.add(f"payloads/{ticker}.json")
            selected_count += 1
            state_counts[state] += 1
        if files != expected_files:
            raise MaterializationError(f"projection contains missing/orphan files: {sorted(files ^ expected_files)[:5]}")
        if index.get("selected_count") != selected_count or index.get("unavailable_count") != unavailable_count:
            raise MaterializationError("projection selected/unavailable count mismatch")
        if index.get("resolution_state_counts") != state_counts:
            raise MaterializationError("projection state counts mismatch")
        return Projection(
            enrollment,
            index,
            payloads,
            {"enrolled": len(tickers), "selected": selected_count, "unavailable": unavailable_count, "payloads": len(payloads)},
            (),
        )

    def _write_projection_tree(self, root: Path, projection: Projection) -> None:
        payload_root = root / "payloads"
        payload_root.mkdir(parents=True)
        for ticker, body in projection.payloads.items():
            _write_file_fsync(payload_root / f"{ticker}.json", body)
        _fsync_dir(payload_root)
        _write_file_fsync(root / "index.json", _pretty_json_bytes(projection.index))
        _write_file_fsync(root / "enrollment.json", _pretty_json_bytes(projection.enrollment))
        _fsync_dir(root)

    def _swap_tree(self, temporary: Path) -> None:
        parent = self.canonical_root.parent
        parent.mkdir(parents=True, exist_ok=True)
        backup = parent / f".{self.canonical_root.name}.backup-{uuid.uuid4().hex}"
        had_previous = self.canonical_root.exists()
        try:
            if had_previous:
                os.replace(self.canonical_root, backup)
            os.replace(temporary, self.canonical_root)
            _fsync_dir(parent)
        except Exception:
            if not self.canonical_root.exists() and backup.exists():
                os.replace(backup, self.canonical_root)
                _fsync_dir(parent)
            raise
        if backup.exists():
            shutil.rmtree(backup)
            _fsync_dir(parent)

    def write_canonical(self, *, generated_at: str, bootstrap_enrollment: bool = False) -> dict[str, Any]:
        projection = self.build_projection(generated_at=generated_at)
        exists = self.canonical_root.exists()
        if exists:
            existing = self._load_projection_tree(self.canonical_root)
            if bootstrap_enrollment:
                raise MaterializationError("--bootstrap-enrollment is allowed only for the first canonical write")
            if existing.enrollment.get("membership_sha256") != projection.enrollment["membership_sha256"]:
                raise MaterializationError("existing enrollment membership differs from active membership")
        elif not bootstrap_enrollment:
            raise MaterializationError("first canonical write requires --bootstrap-enrollment")

        parent = self.canonical_root.parent
        parent.mkdir(parents=True, exist_ok=True)
        temporary = Path(tempfile.mkdtemp(prefix=f".{self.canonical_root.name}.build-", dir=parent))
        try:
            self._write_projection_tree(temporary, projection)
            checked = self._load_projection_tree(temporary)
            if checked.index != projection.index or checked.enrollment != projection.enrollment or checked.payloads != projection.payloads:
                raise MaterializationError("temporary projection verification mismatch")
            self.failpoint("canonical_before_swap")
            self._swap_tree(temporary)
        finally:
            if temporary.exists():
                shutil.rmtree(temporary)
        return {
            "mode": "write-canonical",
            "counts": projection.counts,
            "membership_sha256": projection.enrollment["membership_sha256"],
            "index_sha256": projection.index["index_sha256"],
            "active_transaction_id": projection.index["active_transaction_id"],
            "active_generation_manifest_sha256": projection.index["active_generation_manifest_sha256"],
        }

    def check(self, *, generated_at: str | None = None) -> dict[str, Any]:
        existing = self._load_projection_tree(self.canonical_root)
        clock = generated_at or existing.index.get("generated_at")
        expected = self.build_projection(generated_at=clock)
        parent = self.canonical_root.parent
        temporary = Path(tempfile.mkdtemp(prefix=f".{self.canonical_root.name}.check-", dir=parent))
        try:
            self._write_projection_tree(temporary, expected)
            regenerated = self._load_projection_tree(temporary)
            if regenerated.counts != existing.counts:
                raise MaterializationError("canonical projection count mismatch")
            generated_files = self._tree_files(temporary)
            canonical_files = self._tree_files(self.canonical_root)
            if generated_files != canonical_files:
                raise MaterializationError("canonical projection file set differs from regenerated tree")
            for rel in sorted(generated_files):
                if (self.canonical_root / rel).read_bytes() != (temporary / rel).read_bytes():
                    raise MaterializationError(f"canonical projection differs from regenerated bytes: {rel}")
        finally:
            shutil.rmtree(temporary, ignore_errors=True)
        return {
            "mode": "check",
            "counts": expected.counts,
            "membership_sha256": expected.enrollment["membership_sha256"],
            "index_sha256": expected.index["index_sha256"],
        }

    @staticmethod
    def _is_yahoo(payload: Mapping[str, Any]) -> bool:
        return payload.get("source") == "yahoo_finance" or payload.get("source_provider") == "yahoo_finance" or payload.get("detail_status") == "yf_fallback"

    @staticmethod
    def _is_true_primary(payload: Mapping[str, Any]) -> bool:
        return (
            payload.get("schema_version") == "stockanalysis/v1"
            and payload.get("asset_type") == "etf"
            and (payload.get("source") == "stockanalysis" or payload.get("source_provider") == "stockanalysis")
            and not PublicDataSupplyMaterializer._is_yahoo(payload)
        )

    def _stockanalysis_files(self, root: Path, label: str) -> dict[str, tuple[dict[str, Any], bytes, Path]]:
        if root.is_symlink() or not root.is_dir():
            raise MaterializationError(f"{label} directory is unsafe or missing")
        result = {}
        for path in sorted(root.iterdir()):
            if path.suffix != ".json":
                continue
            self._regular_file(path, root=root, label=f"{label}/{path.name}")
            ticker = _ticker(path.stem, f"{label} filename")
            body = path.read_bytes()
            payload = _strict_json_bytes(body, f"{label}/{path.name}")
            if payload.get("ticker") != ticker or payload.get("asset_type") != "etf":
                raise MaterializationError(f"{label}/{path.name} ticker/asset identity mismatch")
            result[ticker] = (payload, body, path)
        return result

    def _write_reconcile_journal(self, projection: Projection, stale: Mapping[str, tuple[dict[str, Any], bytes, Path]]) -> dict[str, Any]:
        plan = {
            "schema_version": "data-supply-etf-detail-public-reconcile-plan/v1",
            "domain": DOMAIN,
            "membership_sha256": projection.enrollment["membership_sha256"],
            "index_sha256": projection.index["index_sha256"],
            "tickers": projection.enrollment["tickers"],
            "legacy_sha256": {ticker: hashlib.sha256(stale[ticker][1]).hexdigest() for ticker in sorted(stale)},
        }
        _atomic_write(self.reconcile_journal, _pretty_json_bytes(plan))
        return plan

    def _load_reconcile_journal(self, projection: Projection) -> dict[str, Any] | None:
        if not self.reconcile_journal.exists():
            return None
        self._regular_file(self.reconcile_journal, root=self.repo_root, label="public reconcile journal")
        plan = _strict_json_bytes(self.reconcile_journal.read_bytes(), "public reconcile journal")
        if (
            plan.get("schema_version") != "data-supply-etf-detail-public-reconcile-plan/v1"
            or plan.get("domain") != DOMAIN
            or plan.get("membership_sha256") != projection.enrollment["membership_sha256"]
            or plan.get("index_sha256") != projection.index["index_sha256"]
            or plan.get("tickers") != projection.enrollment["tickers"]
            or not isinstance(plan.get("legacy_sha256"), dict)
        ):
            raise MaterializationError("public reconcile journal binding mismatch")
        return plan

    def reconcile_public(self) -> dict[str, Any]:
        canonical = self._load_projection_tree(self.canonical_root)
        generated_at = canonical.index.get("generated_at")
        projection = self.build_projection(generated_at=generated_at)
        if canonical.index != projection.index or canonical.enrollment != projection.enrollment or canonical.payloads != projection.payloads:
            raise MaterializationError("canonical projection does not match active snapshot")
        public_projection_root = self.public_data_root / "computed/data-supply/etf-detail"
        public_projection = self._load_projection_tree(public_projection_root)
        if (
            (public_projection_root / "index.json").read_bytes() != (self.canonical_root / "index.json").read_bytes()
            or (public_projection_root / "enrollment.json").read_bytes() != (self.canonical_root / "enrollment.json").read_bytes()
            or public_projection.payloads != canonical.payloads
        ):
            raise MaterializationError("canonical/public projection byte parity mismatch")

        root_dir = self.repo_root / "data/stockanalysis/etfs"
        public_dir = self.public_data_root / "stockanalysis/etfs"
        root_files = self._stockanalysis_files(root_dir, "root stockanalysis ETF")
        public_files = self._stockanalysis_files(public_dir, "public stockanalysis ETF")
        for ticker, (payload, _body, _path) in root_files.items():
            if not self._is_true_primary(payload):
                raise MaterializationError(f"root StockAnalysis ETF is not true primary: {ticker}")
        root_only = sorted(set(root_files) - set(public_files))
        if root_only:
            raise MaterializationError(f"root-only StockAnalysis ETF files exist: {root_only[:5]}")
        for ticker in sorted(set(root_files) & set(public_files)):
            public_payload, public_body, _ = public_files[ticker]
            if root_files[ticker][1] != public_body or not self._is_true_primary(public_payload):
                raise MaterializationError(f"shared true-primary parity mismatch: {ticker}")

        public_only = sorted(set(public_files) - set(root_files))
        enrollment_set = set(projection.enrollment["tickers"])
        invalid_public_only = []
        for ticker in public_only:
            payload, _body, _path = public_files[ticker]
            if ticker not in enrollment_set or not self._is_yahoo(payload):
                invalid_public_only.append(ticker)
        if invalid_public_only:
            raise MaterializationError(f"public-only ETF files are outside validated Yahoo enrollment: {invalid_public_only[:5]}")

        journal = self._load_reconcile_journal(projection)
        stale = {ticker: public_files[ticker] for ticker in public_only}
        if journal is None and stale:
            if set(stale) != enrollment_set:
                raise MaterializationError(
                    f"initial public cleanup must prove full enrollment: expected={len(enrollment_set)} actual={len(stale)}"
                )
            journal = self._write_reconcile_journal(projection, stale)
        if journal is not None:
            planned = set(journal["tickers"])
            if not set(stale).issubset(planned):
                raise MaterializationError("remaining public cleanup set is outside the committed plan")
            for ticker, (_payload, body, _path) in stale.items():
                if journal["legacy_sha256"].get(ticker) != hashlib.sha256(body).hexdigest():
                    raise MaterializationError(f"remaining public legacy digest mismatch: {ticker}")

        deleted = 0
        for ticker in sorted(stale):
            stale[ticker][2].unlink()
            deleted += 1
            _fsync_dir(public_dir)
            self.failpoint(f"public_unlink_{deleted}")
        if journal is not None and not (set(self._stockanalysis_files(public_dir, "public stockanalysis ETF")) - set(root_files)):
            self.reconcile_journal.unlink(missing_ok=True)
            if self.reconcile_journal.parent.exists():
                _fsync_dir(self.reconcile_journal.parent)

        post = self._stockanalysis_files(public_dir, "public stockanalysis ETF")
        yahoo_count = sum(1 for payload, _body, _path in post.values() if self._is_yahoo(payload))
        true_count = sum(1 for payload, _body, _path in post.values() if self._is_true_primary(payload))
        if yahoo_count or set(post) != set(root_files):
            raise MaterializationError("public StockAnalysis ETF postcondition failed")
        postcondition = {
            "public_stockanalysis_true_primary": true_count,
            "public_stockanalysis_yahoo": yahoo_count,
            "public_projection_payloads": len(public_projection.payloads),
            "public_status_rows": public_projection.counts["enrolled"],
        }
        return {
            "mode": "reconcile-public",
            "stale_deleted": deleted,
            "membership_sha256": projection.enrollment["membership_sha256"],
            "index_sha256": projection.index["index_sha256"],
            "postcondition": postcondition,
        }


def _default_generated_at() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--check", action="store_true")
    modes.add_argument("--write-canonical", action="store_true")
    modes.add_argument("--reconcile-public", action="store_true")
    parser.add_argument("--bootstrap-enrollment", action="store_true")
    parser.add_argument("--generated-at")
    parser.add_argument("--repo-root", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--state-root", default=STATE_REL_ROOT.as_posix())
    parser.add_argument("--canonical-root", default=CANONICAL_REL_ROOT.as_posix())
    parser.add_argument("--public-data-root", default=PUBLIC_DATA_REL_ROOT.as_posix())
    args = parser.parse_args(argv)
    if args.bootstrap_enrollment and not args.write_canonical:
        parser.error("--bootstrap-enrollment requires --write-canonical")
    materializer = PublicDataSupplyMaterializer(
        repo_root=args.repo_root,
        state_root=args.state_root,
        canonical_root=args.canonical_root,
        public_data_root=args.public_data_root,
    )
    try:
        if args.write_canonical:
            result = materializer.write_canonical(
                generated_at=args.generated_at or _default_generated_at(),
                bootstrap_enrollment=args.bootstrap_enrollment,
            )
        elif args.check:
            result = materializer.check(generated_at=args.generated_at)
        else:
            result = materializer.reconcile_public()
    except MaterializationError as exc:
        print(f"materialize-data-supply-public: FAIL: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
