#!/usr/bin/env python3
"""Crash-safe state storage primitives for the data-supply resolver.

The library deliberately uses only the Python standard library.  Domain state
is stored in immutable generations; ``active.json`` is the sole mutable commit
pointer.  A process may therefore die at any point before the pointer replace
without exposing a mixed generation.
"""

from __future__ import annotations

import contextlib
import datetime as dt
import fcntl
import hashlib
import json
import os
import re
import secrets
import tempfile
from pathlib import Path, PurePosixPath
from typing import Any, Callable, Iterator, Mapping

from data_supply_policy import get_domain_policy


GENERATIONS_RETAINED = 3
MAX_LIVE_PREPARED_GENERATIONS = 4
PREPARATION_LEASE_HOURS = 24
_ETF_DETAIL_POLICY = get_domain_policy("etf_detail")
ETF_DETAIL_FRESH_TTL_HOURS = _ETF_DETAIL_POLICY.fresh_ttl_hours
ETF_DETAIL_EMERGENCY_LKG_TTL_DAYS = _ETF_DETAIL_POLICY.emergency_lkg_ttl_days

_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_COMPONENT = re.compile(r"^[A-Za-z0-9._-]+$")
_SELECTION_STATES = {"fresh_primary", "fresh_fallback", "lkg_primary", "lkg_fallback"}
_PAYLOAD_REF_KINDS = {"provider_truth", "provider_object", "provider_lkg"}


class DataSupplyStateError(RuntimeError):
    """Base class for data-supply state errors."""


class SchemaError(DataSupplyStateError):
    """An input record violates the storage contract."""


class IntegrityError(DataSupplyStateError):
    """Persisted state is corrupt or internally inconsistent."""


class ConcurrencyError(DataSupplyStateError):
    """A compare-and-swap precondition was not satisfied."""


class UnavailableError(DataSupplyStateError):
    """No current immutable payload is selected for an entity."""


def canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()


def _strict_json_loads(payload: bytes) -> Any:
    def reject_constant(value: str) -> None:
        raise ValueError(f"non-finite JSON number: {value}")

    return json.loads(payload.decode("utf-8"), parse_constant=reject_constant)


def deterministic_event_id(kind: str, record: Mapping[str, Any]) -> str:
    if not isinstance(kind, str) or not kind:
        raise ValueError("event kind must be a non-empty string")
    payload = dict(record)
    payload.pop("event_id", None)
    return canonical_sha256({"kind": kind, "payload": payload})


def _parse_timestamp(value: Any, field: str) -> dt.datetime:
    if not isinstance(value, str) or not value:
        raise SchemaError(f"{field} must be a non-empty timestamp")
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        parsed = dt.datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise SchemaError(f"{field} is malformed") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise SchemaError(f"{field} must include a timezone")
    return parsed.astimezone(dt.timezone.utc)


def _day_from_timestamp(value: Any, field: str) -> str:
    return _parse_timestamp(value, field).date().isoformat()


def _format_timestamp(value: dt.datetime) -> str:
    if value.tzinfo is None or value.utcoffset() is None:
        raise SchemaError("clock must return a timezone-aware datetime")
    return value.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def _safe_component(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value or not _COMPONENT.fullmatch(value):
        raise SchemaError(f"{field} is not a safe path component")
    if value in {".", ".."}:
        raise SchemaError(f"{field} is not a safe path component")
    return value


def _safe_label(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 256:
        raise SchemaError(f"{field} must be a non-empty label")
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise SchemaError(f"{field} contains control characters")
    return value


def _safe_relative_path(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value or "\\" in value or "\x00" in value:
        raise SchemaError(f"{field} must be a safe repository-relative path")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise SchemaError(f"{field} must be a safe repository-relative path")
    return path.as_posix()


def _require_keys(record: Mapping[str, Any], required: set[str], label: str) -> None:
    missing = sorted(required.difference(record))
    if missing:
        raise SchemaError(f"{label} missing required keys: {', '.join(missing)}")


def _validate_sha(value: Any, field: str) -> str:
    if not isinstance(value, str) or not _HEX64.fullmatch(value):
        raise SchemaError(f"{field} must be a lowercase SHA-256 digest")
    return value


def validate_observation(
    record: Mapping[str, Any],
    *,
    require_valid: bool = False,
    allow_legacy_failure_source_as_of: bool = False,
) -> dict[str, Any]:
    if not isinstance(record, Mapping):
        raise SchemaError("observation must be an object")
    row = dict(record)
    _require_keys(
        row,
        {
            "schema_version",
            "event_id",
            "provider",
            "endpoint_family",
            "domain",
            "entity",
            "provider_path",
            "payload_sha256",
            "provider_schema",
            "source_as_of",
            "observed_at",
            "validation_status",
            "reason_code",
        },
        "observation",
    )
    if row["schema_version"] != "data-supply-observation/v1":
        raise SchemaError("unsupported observation schema")
    for field in ("provider", "endpoint_family", "domain", "entity", "reason_code"):
        _safe_component(row[field], field)
    _safe_label(row["provider_schema"], "provider_schema")
    row["provider_path"] = _safe_relative_path(row["provider_path"], "provider_path")
    _validate_sha(row["payload_sha256"], "payload_sha256")
    if row["validation_status"] not in {"valid", "invalid"}:
        raise SchemaError("validation_status must be valid or invalid")
    source = None
    if row["source_as_of"] is not None:
        source = _parse_timestamp(row["source_as_of"], "source_as_of")
    elif row["validation_status"] == "valid":
        raise SchemaError("valid observations require source_as_of")
    observed = _parse_timestamp(row["observed_at"], "observed_at")
    if source is not None and observed < source:
        raise SchemaError("observed_at cannot precede source_as_of")
    if "observation_origin" in row and row["observation_origin"] not in {
        "natural",
        "cache",
        "rebuild",
        "migration",
    }:
        raise SchemaError("observation_origin must be natural, cache, rebuild, or migration")
    has_failure_extension = "payload_available" in row or "failure_detail_sha256" in row
    if has_failure_extension:
        if row["validation_status"] != "invalid" or row.get("payload_available") is not False:
            raise SchemaError("payload-unavailable extension is allowed only for invalid observations")
        if row["source_as_of"] is not None and not allow_legacy_failure_source_as_of:
            raise SchemaError("payload-unavailable observations require source_as_of null")
        failure_detail_sha256 = _validate_sha(
            row.get("failure_detail_sha256"), "failure_detail_sha256"
        )
        failure_descriptor = {
            "provider": row["provider"],
            "endpoint_family": row["endpoint_family"],
            "domain": row["domain"],
            "entity": row["entity"],
            "observed_at": row["observed_at"],
            "reason_code": row["reason_code"],
            "failure_detail_sha256": failure_detail_sha256,
        }
        if row["payload_sha256"] != canonical_sha256(failure_descriptor):
            raise SchemaError("payload-unavailable observation descriptor digest mismatch")
    if require_valid and row["validation_status"] != "valid":
        raise SchemaError("invalid observations cannot participate in a promotion")
    expected = deterministic_event_id("observation", row)
    if row["event_id"] != expected:
        raise SchemaError("observation event_id does not match its payload")
    return row


def _validate_selection(record: Mapping[str, Any]) -> dict[str, Any]:
    if not isinstance(record, Mapping):
        raise SchemaError("selection must be an object")
    row = dict(record)
    _require_keys(
        row,
        {
            "schema_version",
            "domain",
            "entity",
            "provider",
            "provider_path",
            "payload_sha256",
            "provider_schema",
            "source_as_of",
            "observed_at",
            "selected_at",
            "resolution_state",
            "reason_code",
            "fallback_depth",
            "age_seconds",
            "payload_ref",
        },
        "selection",
    )
    if row["schema_version"] != "data-supply-selection/v1":
        raise SchemaError("unsupported selection schema")
    for field in ("domain", "entity", "provider", "reason_code"):
        _safe_component(row[field], field)
    _safe_label(row["provider_schema"], "provider_schema")
    row["provider_path"] = _safe_relative_path(row["provider_path"], "provider_path")
    _validate_sha(row["payload_sha256"], "payload_sha256")
    source = _parse_timestamp(row["source_as_of"], "source_as_of")
    observed = _parse_timestamp(row["observed_at"], "observed_at")
    selected = _parse_timestamp(row["selected_at"], "selected_at")
    if observed < source or selected < source:
        raise SchemaError("selection timestamps cannot precede source_as_of")
    expected_age = int((selected - source).total_seconds())
    if not isinstance(row["age_seconds"], int) or isinstance(row["age_seconds"], bool):
        raise SchemaError("age_seconds must be an integer")
    if row["age_seconds"] != expected_age or expected_age < 0:
        raise SchemaError("age_seconds must derive from source_as_of")
    if row["resolution_state"] not in _SELECTION_STATES:
        raise SchemaError("unsupported resolution_state")
    if not isinstance(row["fallback_depth"], int) or isinstance(row["fallback_depth"], bool) or row["fallback_depth"] < 0:
        raise SchemaError("fallback_depth must be a non-negative integer")
    payload_ref = row["payload_ref"]
    if not isinstance(payload_ref, Mapping):
        raise SchemaError("payload_ref must be an object")
    _require_keys(payload_ref, {"kind", "path", "sha256"}, "payload_ref")
    if payload_ref["kind"] not in _PAYLOAD_REF_KINDS:
        raise SchemaError("unsupported payload_ref.kind")
    _safe_relative_path(payload_ref["path"], "payload_ref.path")
    _validate_sha(payload_ref["sha256"], "payload_ref.sha256")
    if payload_ref["sha256"] != row["payload_sha256"]:
        raise SchemaError("payload_ref digest differs from selection digest")
    if payload_ref["kind"] == "provider_truth" and payload_ref["path"] != row["provider_path"]:
        raise SchemaError("provider-truth ref must match provider_path")
    if "candidate_event_id" in row:
        _validate_sha(row["candidate_event_id"], "candidate_event_id")
    return row


def build_selection(
    observation: Mapping[str, Any],
    *,
    selected_at: str,
    resolution_state: str,
    reason_code: str,
    fallback_depth: int,
    payload_ref_kind: str,
    payload_ref_path: str | None = None,
) -> dict[str, Any]:
    row = validate_observation(observation, require_valid=True)
    _safe_component(reason_code, "reason_code")
    if resolution_state not in _SELECTION_STATES:
        raise SchemaError("unsupported resolution_state")
    if payload_ref_kind not in _PAYLOAD_REF_KINDS:
        raise SchemaError("unsupported payload_ref_kind")
    if not isinstance(fallback_depth, int) or isinstance(fallback_depth, bool) or fallback_depth < 0:
        raise SchemaError("fallback_depth must be a non-negative integer")
    source = _parse_timestamp(row["source_as_of"], "source_as_of")
    selected = _parse_timestamp(selected_at, "selected_at")
    age_seconds = int((selected - source).total_seconds())
    if age_seconds < 0:
        raise SchemaError("selected_at cannot precede source_as_of")
    ref_path = payload_ref_path or row["provider_path"]
    _safe_relative_path(ref_path, "payload_ref_path")
    result = {
        "schema_version": "data-supply-selection/v1",
        "domain": row["domain"],
        "entity": row["entity"],
        "provider": row["provider"],
        "provider_path": row["provider_path"],
        "payload_sha256": row["payload_sha256"],
        "provider_schema": row["provider_schema"],
        "source_as_of": row["source_as_of"],
        "observed_at": row["observed_at"],
        "selected_at": selected_at,
        "resolution_state": resolution_state,
        "reason_code": reason_code,
        "fallback_depth": fallback_depth,
        "age_seconds": age_seconds,
        "payload_ref": {"kind": payload_ref_kind, "path": ref_path, "sha256": row["payload_sha256"]},
        "candidate_event_id": row["event_id"],
    }
    return _validate_selection(result)


def bind_selection_to_provider_lkg(
    selection: Mapping[str, Any], provider_lkg_ref: Mapping[str, Any]
) -> dict[str, Any]:
    """Rebind a prior selected record to its immutable provider-LKG object."""

    selected = _validate_selection(selection)
    if not isinstance(provider_lkg_ref, Mapping):
        raise SchemaError("provider_lkg_ref must be an object")
    _require_keys(provider_lkg_ref, {"path", "sha256"}, "provider_lkg_ref")
    path = _safe_relative_path(provider_lkg_ref["path"], "provider_lkg_ref.path")
    sha256 = _validate_sha(provider_lkg_ref["sha256"], "provider_lkg_ref.sha256")
    if sha256 != selected["payload_sha256"]:
        raise SchemaError("provider LKG object digest differs from prior selection")
    expected_path = (
        Path("providers")
        / selected["provider"]
        / selected["domain"]
        / "lkg"
        / selected["entity"]
        / "objects"
        / f"{sha256}.json"
    ).as_posix()
    if path != expected_path:
        raise SchemaError("provider LKG ref identity differs from prior selection")
    rebound = dict(selected)
    rebound["payload_ref"] = {"kind": "provider_lkg", "path": path, "sha256": sha256}
    return _validate_selection(rebound)


def restate_selection(
    selection: Mapping[str, Any],
    *,
    selected_at: str,
    resolution_state: str,
    reason_code: str,
    fallback_depth: int,
) -> dict[str, Any]:
    """Reuse an immutable selection payload with a new resolver-state envelope."""

    selected = _validate_selection(selection)
    source = _parse_timestamp(selected["source_as_of"], "source_as_of")
    decided = _parse_timestamp(selected_at, "selected_at")
    age_seconds = int((decided - source).total_seconds())
    if age_seconds < 0:
        raise SchemaError("selected_at cannot precede source_as_of")
    rebound = dict(selected)
    rebound.update(
        {
            "selected_at": selected_at,
            "resolution_state": resolution_state,
            "reason_code": _safe_component(reason_code, "reason_code"),
            "fallback_depth": fallback_depth,
            "age_seconds": age_seconds,
        }
    )
    return _validate_selection(rebound)


def selection_age_status(
    resolution_state: str,
    age_seconds: int,
    *,
    domain: str = "etf_detail",
) -> str:
    if not isinstance(age_seconds, int) or isinstance(age_seconds, bool) or age_seconds < 0:
        raise SchemaError("age_seconds must be a non-negative integer")
    try:
        policy = get_domain_policy(domain)
    except KeyError as exc:
        raise SchemaError("unavailable authority proof is not configured for this domain") from exc
    if resolution_state in {"fresh_primary", "fresh_fallback"}:
        return "fresh" if age_seconds <= policy.fresh_ttl_hours * 3600 else "stale"
    if resolution_state in {"lkg_primary", "lkg_fallback"}:
        return "stale" if age_seconds <= policy.emergency_lkg_ttl_days * 86400 else "unavailable"
    raise SchemaError("unsupported resolution_state")


def _validate_recovery_map(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise SchemaError("recovery must be an object")
    result = dict(value)
    for entity, record in result.items():
        _safe_component(entity, "recovery entity")
        if not isinstance(record, Mapping):
            raise SchemaError("recovery entry must be an object")
        _require_keys(record, {"consecutive_green", "last_transition"}, "recovery entry")
        count = record["consecutive_green"]
        if not isinstance(count, int) or isinstance(count, bool) or count < 0:
            raise SchemaError("consecutive_green must be a non-negative integer")
        _safe_component(record["last_transition"], "last_transition")
        if "last_primary_event_id" in record and record["last_primary_event_id"] is not None:
            _validate_sha(record["last_primary_event_id"], "last_primary_event_id")
    return result


def _validate_selection_map(value: Any, domain: str, label: str) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise SchemaError(f"{label} must be an object")
    result = dict(value)
    for entity, record in result.items():
        _safe_component(entity, f"{label} entity")
        selected = _validate_selection(record)
        if selected["domain"] != domain or selected["entity"] != entity:
            raise SchemaError(f"{label} selection identity mismatch")
    return result


def _validate_decision(record: Mapping[str, Any]) -> dict[str, Any]:
    if not isinstance(record, Mapping):
        raise SchemaError("decision must be an object")
    row = dict(record)
    _require_keys(
        row,
        {
            "schema_version",
            "event_id",
            "domain",
            "entity",
            "decided_at",
            "candidate_event_ids",
            "evidence_event_ids",
            "previous_selection_digest",
            "new_selection_digest",
            "transition",
            "reason_code",
            "recovery_green_count",
        },
        "decision",
    )
    if row["schema_version"] != "data-supply-resolution-event/v1":
        raise SchemaError("unsupported decision schema")
    for field in ("domain", "entity", "transition", "reason_code"):
        _safe_component(row[field], field)
    _parse_timestamp(row["decided_at"], "decided_at")
    if not isinstance(row["candidate_event_ids"], list):
        raise SchemaError("candidate_event_ids must be a list")
    if not isinstance(row["evidence_event_ids"], list):
        raise SchemaError("evidence_event_ids must be a list")
    for field, event_ids in (
        ("candidate_event_id", row["candidate_event_ids"]),
        ("evidence_event_id", row["evidence_event_ids"]),
    ):
        for event_id in event_ids:
            _validate_sha(event_id, field)
        if event_ids != sorted(set(event_ids)):
            raise SchemaError(f"{field}s must be sorted and unique")
    _validate_sha(row["previous_selection_digest"], "previous_selection_digest")
    _validate_sha(row["new_selection_digest"], "new_selection_digest")
    count = row["recovery_green_count"]
    if not isinstance(count, int) or isinstance(count, bool) or count < 0:
        raise SchemaError("recovery_green_count must be a non-negative integer")
    if row["event_id"] != deterministic_event_id("resolution", row):
        raise SchemaError("decision event_id does not match its payload")
    if "transaction_id" in row:
        _safe_component(row["transaction_id"], "transaction_id")
    return row


class DataSupplyStateStore:
    def __init__(
        self,
        root: Path | str,
        *,
        failpoint_hook: Callable[[str], None] | None = None,
        allowed_provider_truth_roots: tuple[str, ...] = ("data/stockanalysis", "data/yf"),
        provider_truth_root: Path | str | None = None,
        now_fn: Callable[[], dt.datetime] | None = None,
        defer_maintenance: bool = False,
    ):
        self.root = Path(root).expanduser().resolve(strict=False)
        missing: list[Path] = []
        cursor = self.root
        while not cursor.exists():
            missing.append(cursor)
            cursor = cursor.parent
        if not cursor.is_dir():
            raise SchemaError("state root ancestor is not a directory")
        for directory in reversed(missing):
            directory.mkdir()
            parent_fd = os.open(directory.parent, os.O_RDONLY)
            try:
                os.fsync(parent_fd)
            finally:
                os.close(parent_fd)
        self._failpoint_hook = failpoint_hook or (lambda _point: None)
        self._allowed_provider_truth_roots = tuple(
            _safe_relative_path(value, "allowed_provider_truth_root").rstrip("/")
            for value in allowed_provider_truth_roots
        )
        self.provider_truth_root = Path(provider_truth_root).expanduser().resolve() if provider_truth_root else None
        self._now_fn = now_fn or (lambda: dt.datetime.now(dt.timezone.utc))
        if not isinstance(defer_maintenance, bool):
            raise SchemaError("defer_maintenance must be a boolean")
        self._defer_maintenance = defer_maintenance
        self._generation_cache: dict[tuple[str, str], dict[str, Any]] = {}

    def _now(self) -> dt.datetime:
        value = self._now_fn()
        if not isinstance(value, dt.datetime) or value.tzinfo is None or value.utcoffset() is None:
            raise SchemaError("now_fn must return a timezone-aware datetime")
        return value.astimezone(dt.timezone.utc)

    def _failpoint(self, point: str) -> None:
        self._failpoint_hook(point)

    def _inside_root(self, path: Path) -> Path:
        resolved = path.resolve(strict=False)
        try:
            resolved.relative_to(self.root)
        except ValueError as exc:
            raise SchemaError("path escapes the data-supply state root") from exc
        return resolved

    def _ensure_directory(self, path: Path) -> Path:
        path = self._inside_root(path)
        missing: list[Path] = []
        cursor = path
        while not cursor.exists():
            missing.append(cursor)
            cursor = cursor.parent
        if not cursor.is_dir():
            raise IntegrityError("state path ancestor is not a directory")
        for directory in reversed(missing):
            try:
                directory.mkdir()
            except FileExistsError:
                if not directory.is_dir():
                    raise IntegrityError("concurrent state path creation produced a non-directory")
            else:
                self._fsync_directory(directory.parent)
        if not path.is_dir():
            raise IntegrityError("state directory path is not a directory")
        return path

    @contextlib.contextmanager
    def _lock(self, path: Path, *, shared: bool = False) -> Iterator[None]:
        path = self._inside_root(path)
        self._ensure_directory(path.parent)
        fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_SH if shared else fcntl.LOCK_EX)
            yield
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
            os.close(fd)

    def _fsync_directory(self, path: Path) -> None:
        fd = os.open(path, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def _atomic_write_bytes(
        self, path: Path, payload: bytes, *, failpoint_prefix: str | None = None
    ) -> None:
        path = self._inside_root(path)
        self._ensure_directory(path.parent)
        fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
        temp_path = Path(temp_name)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(payload)
                handle.flush()
                if failpoint_prefix:
                    self._failpoint(f"{failpoint_prefix}_after_temp_write")
                os.fsync(handle.fileno())
                if failpoint_prefix:
                    self._failpoint(f"{failpoint_prefix}_after_temp_fsync")
            os.replace(temp_path, path)
            if failpoint_prefix:
                self._failpoint(f"{failpoint_prefix}_after_replace_before_dir_fsync")
            self._fsync_directory(path.parent)
            if failpoint_prefix:
                self._failpoint(f"{failpoint_prefix}_after_dir_fsync")
        finally:
            if temp_path.exists():
                temp_path.unlink()

    def _atomic_write_json(self, path: Path, value: Any, *, failpoint_prefix: str | None = None) -> None:
        self._atomic_write_bytes(
            path,
            canonical_json_bytes(value) + b"\n",
            failpoint_prefix=failpoint_prefix,
        )

    def _write_immutable_json(self, path: Path, value: Any, *, failpoint_prefix: str | None = None) -> None:
        path = self._inside_root(path)
        if path.exists():
            existing = self._read_json(path)
            if canonical_json_bytes(existing) != canonical_json_bytes(value):
                raise IntegrityError(f"immutable file collision: {path.name}")
            return
        self._atomic_write_json(path, value, failpoint_prefix=failpoint_prefix)

    def _write_immutable_bytes(
        self, path: Path, payload: bytes, *, failpoint_prefix: str | None = None
    ) -> None:
        path = self._inside_root(path)
        if path.exists():
            if path.read_bytes() != payload:
                raise IntegrityError(f"immutable file collision: {path.name}")
            return
        self._atomic_write_bytes(path, payload, failpoint_prefix=failpoint_prefix)

    def _read_json(self, path: Path) -> Any:
        path = self._inside_root(path)
        try:
            raw = path.read_bytes()
        except FileNotFoundError as exc:
            raise IntegrityError(f"missing state file: {path.name}") from exc
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise IntegrityError(f"corrupt JSON state file: {path.name}") from exc

    def _append_event(self, category: str, day: str, record: Mapping[str, Any]) -> bool:
        if category not in {"observations", "resolutions"}:
            raise ValueError("unsupported history category")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
            raise SchemaError("history day is malformed")
        directory = self.root / "history" / category
        history = self._inside_root(directory / f"{day}.jsonl")
        lock_path = directory / f".{day}.lock"
        with self._lock(lock_path):
            directory.mkdir(parents=True, exist_ok=True)
            existing_ids: set[str] = set()
            if history.exists():
                data = history.read_bytes()
                if data and not data.endswith(b"\n"):
                    last_newline = data.rfind(b"\n")
                    tail = data[last_newline + 1 :]
                    try:
                        parsed_tail = json.loads(tail.decode("utf-8"))
                    except (UnicodeDecodeError, json.JSONDecodeError):
                        complete = data[: last_newline + 1] if last_newline >= 0 else b""
                        with history.open("r+b") as handle:
                            handle.truncate(len(complete))
                            handle.flush()
                            os.fsync(handle.fileno())
                        data = complete
                    else:
                        try:
                            if category == "observations":
                                validate_observation(
                                    parsed_tail,
                                    allow_legacy_failure_source_as_of=True,
                                )
                            else:
                                _validate_decision(parsed_tail)
                        except SchemaError as exc:
                            raise IntegrityError(f"{category} history has a schema-invalid tail") from exc
                        with history.open("ab") as handle:
                            handle.write(b"\n")
                            handle.flush()
                            os.fsync(handle.fileno())
                        data += b"\n"
                for index, line in enumerate(data.splitlines(), start=1):
                    try:
                        parsed = json.loads(line.decode("utf-8"))
                    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                        raise IntegrityError(f"corrupt {category} history at line {index}") from exc
                    event_id = parsed.get("event_id") if isinstance(parsed, dict) else None
                    if not isinstance(event_id, str):
                        raise IntegrityError(f"history row {index} has no event_id")
                    try:
                        if category == "observations":
                            validate_observation(
                                parsed,
                                allow_legacy_failure_source_as_of=True,
                            )
                        else:
                            _validate_decision(parsed)
                    except SchemaError as exc:
                        raise IntegrityError(f"history row {index} violates its schema") from exc
                    existing_ids.add(event_id)
            event_id = record.get("event_id")
            if event_id in existing_ids:
                return False
            payload = canonical_json_bytes(dict(record)) + b"\n"
            fd = os.open(history, os.O_CREAT | os.O_APPEND | os.O_WRONLY, 0o600)
            try:
                written = os.write(fd, payload)
                if written != len(payload):
                    raise OSError("short JSONL append")
                os.fsync(fd)
            finally:
                os.close(fd)
            self._fsync_directory(directory)
            return True

    def record_observation(self, observation: Mapping[str, Any]) -> bool:
        row = validate_observation(observation)
        day = _day_from_timestamp(row["observed_at"], "observed_at")
        return self._append_event("observations", day, row)

    def _history_contains(self, category: str, timestamp: str, record: Mapping[str, Any]) -> bool:
        field = "observed_at" if category == "observations" else "decided_at"
        day = _day_from_timestamp(timestamp, field)
        directory = self.root / "history" / category
        history = self._inside_root(directory / f"{day}.jsonl")
        with self._lock(directory / f".{day}.lock", shared=True):
            if not history.exists():
                return False
            data = history.read_bytes()
            if data and not data.endswith(b"\n"):
                raise IntegrityError(f"{category} history has an uncommitted tail")
            for index, line in enumerate(data.splitlines(), start=1):
                try:
                    parsed = json.loads(line.decode("utf-8"))
                    if category == "observations":
                        validate_observation(
                            parsed,
                            allow_legacy_failure_source_as_of=True,
                        )
                    else:
                        _validate_decision(parsed)
                except (UnicodeDecodeError, json.JSONDecodeError, SchemaError) as exc:
                    raise IntegrityError(f"corrupt {category} history at line {index}") from exc
                if parsed.get("event_id") == record.get("event_id"):
                    if canonical_json_bytes(parsed) != canonical_json_bytes(dict(record)):
                        raise IntegrityError("history event ID is bound to different content")
                    return True
            return False

    def _record_resolution(self, decision: Mapping[str, Any]) -> bool:
        row = _validate_decision(decision)
        day = _day_from_timestamp(row["decided_at"], "decided_at")
        return self._append_event("resolutions", day, row)

    def _domain_dir(self, domain: str) -> Path:
        return self.root / "domains" / _safe_component(domain, "domain")

    def _empty_domain(self) -> dict[str, Any]:
        return {
            "transaction_id": None,
            "retained_generation_ids": [],
            "current": {},
            "lkg": {},
            "recovery": {},
        }

    def _generation_digest_payload(
        self,
        *,
        domain: str,
        current: Mapping[str, Any],
        lkg: Mapping[str, Any],
        recovery: Mapping[str, Any],
        decision: Mapping[str, Any],
        previous_transaction_id: str | None,
    ) -> dict[str, Any]:
        return {
            "domain": domain,
            "current": dict(current),
            "lkg": dict(lkg),
            "recovery": dict(recovery),
            "decision": dict(decision),
            "previous_transaction_id": previous_transaction_id,
        }

    def _validate_payload_refs(self, records: Mapping[str, Any]) -> None:
        for selected in records.values():
            row = _validate_selection(selected)
            ref = row["payload_ref"]
            if ref["kind"] == "provider_truth":
                raise SchemaError("mutable provider-truth refs cannot participate in active state")
            ref_path = self._inside_root(self.root / _safe_relative_path(ref["path"], "payload_ref.path"))
            if ref["kind"] == "provider_object":
                expected_path = (
                    Path("providers")
                    / row["provider"]
                    / row["domain"]
                    / "objects"
                    / row["entity"]
                    / f"{ref['sha256']}.json"
                ).as_posix()
                label = "provider object"
            else:
                expected_path = (
                    Path("providers")
                    / row["provider"]
                    / row["domain"]
                    / "lkg"
                    / row["entity"]
                    / "objects"
                    / f"{ref['sha256']}.json"
                ).as_posix()
                label = "provider LKG"
            if ref["path"] != expected_path:
                raise SchemaError(f"{label} ref identity mismatch")
            try:
                payload_bytes = ref_path.read_bytes()
            except FileNotFoundError as exc:
                raise IntegrityError(f"{label} payload is missing") from exc
            try:
                _strict_json_loads(payload_bytes)
            except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
                raise IntegrityError(f"{label} payload is not strict JSON") from exc
            if hashlib.sha256(payload_bytes).hexdigest() != ref["sha256"]:
                raise IntegrityError(f"{label} payload digest mismatch")

    def _validate_generation(self, domain: str, transaction_id: str) -> dict[str, Any]:
        _safe_component(transaction_id, "transaction_id")
        cache_key = (domain, transaction_id)
        if self._defer_maintenance and cache_key in self._generation_cache:
            return dict(self._generation_cache[cache_key])
        generation = self._domain_dir(domain) / "generations" / transaction_id
        manifest_path = generation / "manifest.json"
        manifest = self._read_json(manifest_path)
        if not isinstance(manifest, dict):
            raise IntegrityError("generation manifest must be an object")
        required = {
            "schema_version",
            "transaction_id",
            "domain",
            "previous_transaction_id",
            "previous_selection_digest",
            "new_selection_digest",
            "members",
            "generations_retained",
            "protected_generation_ids",
            "preparation_nonce",
            "prepared_at",
            "prepared_expires_at",
        }
        if required.difference(manifest):
            raise IntegrityError("generation manifest is incomplete")
        if manifest["schema_version"] != "data-supply-generation/v1":
            raise IntegrityError("unsupported generation manifest schema")
        if manifest["transaction_id"] != transaction_id or manifest["domain"] != domain:
            raise IntegrityError("generation manifest identity mismatch")
        if manifest["generations_retained"] != GENERATIONS_RETAINED:
            raise IntegrityError("generation retention bound mismatch")
        try:
            prepared_at = _parse_timestamp(manifest["prepared_at"], "prepared_at")
            prepared_expires_at = _parse_timestamp(
                manifest["prepared_expires_at"], "prepared_expires_at"
            )
        except SchemaError as exc:
            raise IntegrityError("generation preparation lease is malformed") from exc
        if prepared_expires_at - prepared_at != dt.timedelta(hours=PREPARATION_LEASE_HOURS):
            raise IntegrityError("generation preparation lease duration mismatch")
        previous_transaction_id = manifest["previous_transaction_id"]
        if previous_transaction_id is not None:
            try:
                _safe_component(previous_transaction_id, "previous_transaction_id")
            except SchemaError as exc:
                raise IntegrityError("previous transaction ID is malformed") from exc
        protected = manifest["protected_generation_ids"]
        expected_protected = {transaction_id}
        if previous_transaction_id is not None:
            expected_protected.add(previous_transaction_id)
        if not isinstance(protected, list) or set(protected) != expected_protected:
            raise IntegrityError("protected generation IDs do not match active/previous generations")
        members = manifest["members"]
        if not isinstance(members, dict) or set(members) != {"current.json", "lkg.json", "recovery.json", "decision.json"}:
            raise IntegrityError("generation member set mismatch")
        loaded: dict[str, Any] = {}
        for name, expected_sha in members.items():
            _validate_sha(expected_sha, f"manifest member {name}")
            member_path = generation / name
            try:
                raw = member_path.read_bytes()
            except FileNotFoundError as exc:
                raise IntegrityError(f"missing generation member: {name}") from exc
            if hashlib.sha256(raw).hexdigest() != expected_sha:
                raise IntegrityError(f"generation member digest mismatch: {name}")
            try:
                loaded[name] = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise IntegrityError(f"corrupt generation member: {name}") from exc
        try:
            current = _validate_selection_map(loaded["current.json"], domain, "current")
            lkg = _validate_selection_map(loaded["lkg.json"], domain, "lkg")
            recovery = _validate_recovery_map(loaded["recovery.json"])
            decision = _validate_decision(loaded["decision.json"])
        except SchemaError as exc:
            raise IntegrityError("generation member schema violation") from exc
        if decision["domain"] != domain:
            raise IntegrityError("decision domain mismatch")
        previous_digest = manifest["previous_selection_digest"]
        new_digest = manifest["new_selection_digest"]
        try:
            _validate_sha(previous_digest, "previous_selection_digest")
            _validate_sha(new_digest, "new_selection_digest")
        except SchemaError as exc:
            raise IntegrityError("manifest selection digest malformed") from exc
        if canonical_sha256(current) != new_digest or decision["new_selection_digest"] != new_digest:
            raise IntegrityError("new selection digest mismatch")
        if decision["previous_selection_digest"] != previous_digest:
            raise IntegrityError("previous selection digest mismatch")
        payload = self._generation_digest_payload(
            domain=domain,
            current=current,
            lkg=lkg,
            recovery=recovery,
            decision=decision,
            previous_transaction_id=manifest["previous_transaction_id"],
        )
        preparation_nonce = manifest["preparation_nonce"]
        if not isinstance(preparation_nonce, str) or not re.fullmatch(r"[0-9a-f]{32}", preparation_nonce):
            raise IntegrityError("preparation nonce is malformed")
        if canonical_sha256({"generation": payload, "preparation_nonce": preparation_nonce}) != transaction_id:
            raise IntegrityError("transaction_id does not match generation content")
        try:
            self._validate_payload_refs(current)
            self._validate_payload_refs(lkg)
        except SchemaError as exc:
            raise IntegrityError("generation payload ref violates its allowlist") from exc
        result = {
            "transaction_id": transaction_id,
            "current": current,
            "lkg": lkg,
            "recovery": recovery,
            "decision": decision,
            "manifest": manifest,
            "manifest_sha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
            "prepared_at": prepared_at,
            "prepared_expires_at": prepared_expires_at,
        }
        if self._defer_maintenance:
            self._generation_cache[cache_key] = dict(result)
        return result

    def _read_active_domain_unlocked(self, domain: str) -> dict[str, Any]:
        domain_dir = self._domain_dir(domain)
        active_path = domain_dir / "active.json"
        if not active_path.exists():
            return self._empty_domain()
        active = self._read_json(active_path)
        if not isinstance(active, dict):
            raise IntegrityError("active pointer must be an object")
        required = {
            "schema_version",
            "domain",
            "transaction_id",
            "generation_manifest_sha256",
            "decision",
            "retained_generation_ids",
        }
        if required.difference(active):
            raise IntegrityError("active pointer is incomplete")
        if active["schema_version"] != "data-supply-active/v1" or active["domain"] != domain:
            raise IntegrityError("active pointer identity mismatch")
        transaction_id = active["transaction_id"]
        try:
            _safe_component(transaction_id, "transaction_id")
            _validate_sha(active["generation_manifest_sha256"], "generation_manifest_sha256")
            pointer_decision = _validate_decision(active["decision"])
        except SchemaError as exc:
            raise IntegrityError("active pointer schema violation") from exc
        generation = self._validate_generation(domain, transaction_id)
        if active["generation_manifest_sha256"] != generation["manifest_sha256"]:
            raise IntegrityError("active manifest digest mismatch")
        if pointer_decision["domain"] != domain:
            raise IntegrityError("active decision domain mismatch")
        if pointer_decision.get("transaction_id") != transaction_id:
            raise IntegrityError("active decision is not bound to its transaction")
        if pointer_decision["new_selection_digest"] != generation["manifest"]["new_selection_digest"]:
            raise IntegrityError("active decision target mismatch")
        retained = active["retained_generation_ids"]
        if (
            not isinstance(retained, list)
            or not retained
            or len(retained) > GENERATIONS_RETAINED
            or len(set(retained)) != len(retained)
            or retained[0] != transaction_id
        ):
            raise IntegrityError("active retained generation list is malformed")
        for retained_id in retained:
            try:
                _safe_component(retained_id, "retained_generation_id")
            except SchemaError as exc:
                raise IntegrityError("active retained generation ID is malformed") from exc
            if retained_id != transaction_id:
                self._validate_generation(domain, retained_id)
        generation["active_decision"] = pointer_decision
        generation["retained_generation_ids"] = list(retained)
        return generation

    def read_active_domain(self, domain: str) -> dict[str, Any]:
        domain_dir = self._domain_dir(domain)
        with self._lock(domain_dir / ".lock", shared=True):
            return self._read_active_domain_unlocked(domain)

    def read_resolved_payload(self, domain: str, entity: str) -> Any:
        """Read, verify, and parse the selected immutable payload under one shared lock."""

        domain = _safe_component(domain, "domain")
        entity = _safe_component(entity, "entity")
        domain_dir = self._domain_dir(domain)
        with self._lock(domain_dir / ".lock", shared=True):
            active = self._read_active_domain_unlocked(domain)
            selected = active["current"].get(entity)
            if selected is None:
                raise UnavailableError(f"no current selection for {domain}/{entity}")
            self._failpoint("resolved_payload_after_active")
            row = _validate_selection(selected)
            ref = row["payload_ref"]
            if ref["kind"] == "provider_truth":
                raise IntegrityError("active selection references mutable provider truth")
            payload_path = self._inside_root(
                self.root / _safe_relative_path(ref["path"], "payload_ref.path")
            )
            self._failpoint("resolved_payload_before_object_read")
            try:
                payload_bytes = payload_path.read_bytes()
            except FileNotFoundError as exc:
                raise IntegrityError("selected immutable payload is missing") from exc
            self._failpoint("resolved_payload_after_object_read")
            if hashlib.sha256(payload_bytes).hexdigest() != ref["sha256"]:
                raise IntegrityError("selected immutable payload digest mismatch")
            try:
                return _strict_json_loads(payload_bytes)
            except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
                raise IntegrityError("selected immutable payload is not strict JSON") from exc

    def _generation_directories(self, domain: str) -> list[Path]:
        parent = self._domain_dir(domain) / "generations"
        if not parent.exists():
            return []
        if parent.is_symlink() or not parent.is_dir():
            raise IntegrityError("generation root is not a regular directory")
        result: list[Path] = []
        for path in parent.iterdir():
            if path.is_symlink() or not path.is_dir():
                raise IntegrityError("generation root contains an unsafe entry")
            try:
                _safe_component(path.name, "transaction_id")
            except SchemaError as exc:
                raise IntegrityError("generation root contains a malformed transaction ID") from exc
            result.append(path)
        return sorted(result, key=lambda path: path.name)

    def _generation_was_committed(
        self,
        generation: Mapping[str, Any],
        retained_generation_ids: set[str],
    ) -> bool:
        transaction_id = generation["transaction_id"]
        if transaction_id in retained_generation_ids:
            return True
        committed = self._bind_committed_transaction(generation["decision"], transaction_id)
        return self._history_contains(
            "resolutions", committed["decided_at"], committed
        )

    def _live_prepared_generation_ids_unlocked(
        self,
        domain: str,
        *,
        now: dt.datetime,
        active: Mapping[str, Any] | None = None,
    ) -> list[str]:
        active = dict(active) if active is not None else self._read_active_domain_unlocked(domain)
        retained = set(active.get("retained_generation_ids", []))
        live: list[str] = []
        for path in self._generation_directories(domain):
            generation = self._validate_generation(domain, path.name)
            if self._generation_was_committed(generation, retained):
                continue
            if now < generation["prepared_expires_at"]:
                live.append(path.name)
        return live

    def _remove_generation_directory_unlocked(self, domain: str, transaction_id: str) -> None:
        generation_root = self._domain_dir(domain) / "generations"
        generation = generation_root / _safe_component(transaction_id, "transaction_id")
        if generation.is_symlink() or not generation.is_dir():
            raise IntegrityError("generation deletion target is unsafe")
        members = list(generation.iterdir())
        allowed = {"current.json", "lkg.json", "recovery.json", "decision.json", "manifest.json"}
        if any(path.is_symlink() or not path.is_file() or path.name not in allowed for path in members):
            raise IntegrityError("generation deletion target contains unsafe members")
        if {path.name for path in members} != allowed:
            raise IntegrityError("generation deletion target is incomplete")
        for path in sorted(members, key=lambda item: item.name):
            self._failpoint("before_generation_unlink")
            path.unlink()
            self._failpoint("after_generation_unlink")
        self._fsync_directory(generation)
        self._failpoint("after_generation_directory_fsync")
        generation.rmdir()
        self._fsync_directory(generation_root)
        self._generation_cache.pop((domain, transaction_id), None)

    def _remove_incomplete_generation_directory_unlocked(
        self,
        domain: str,
        transaction_id: str,
    ) -> None:
        generation_root = self._domain_dir(domain) / "generations"
        generation = generation_root / _safe_component(transaction_id, "transaction_id")
        if generation.is_symlink() or not generation.is_dir():
            raise IntegrityError("incomplete generation target is unsafe")
        allowed = {"current.json", "lkg.json", "recovery.json", "decision.json", "manifest.json"}
        for path in generation.iterdir():
            is_temp = path.name.startswith(".") and path.name.endswith(".tmp")
            if path.is_symlink() or not path.is_file() or (path.name not in allowed and not is_temp):
                raise IntegrityError("incomplete generation contains unsafe members")
        for path in sorted(generation.iterdir(), key=lambda item: item.name):
            path.unlink()
        self._fsync_directory(generation)
        generation.rmdir()
        self._fsync_directory(generation_root)
        self._generation_cache.pop((domain, transaction_id), None)

    def _reconcile_stale_prepared_unlocked(
        self,
        domain: str,
        *,
        now: dt.datetime,
        active: Mapping[str, Any],
    ) -> int:
        retained = set(active.get("retained_generation_ids", []))
        stale: list[str] = []
        for path in self._generation_directories(domain):
            if not (path / "manifest.json").exists():
                if path.name in retained:
                    raise IntegrityError("retained generation is incomplete")
                self._remove_incomplete_generation_directory_unlocked(domain, path.name)
                continue
            generation = self._validate_generation(domain, path.name)
            if self._generation_was_committed(generation, retained):
                continue
            if now >= generation["prepared_expires_at"]:
                stale.append(path.name)
        for transaction_id in stale:
            self._remove_generation_directory_unlocked(domain, transaction_id)
        return len(stale)

    def _validate_recorded_evidence(
        self,
        *,
        domain: str,
        entity: str,
        evidence_observations: list[Mapping[str, Any]],
    ) -> list[dict[str, Any]]:
        if not isinstance(evidence_observations, list):
            raise SchemaError("evidence_observations must be a list")
        evidence = [
            validate_observation(row, allow_legacy_failure_source_as_of=True)
            for row in evidence_observations
        ]
        event_ids = [row["event_id"] for row in evidence]
        if len(event_ids) != len(set(event_ids)):
            raise SchemaError("evidence_observations must not contain duplicates")
        for row in evidence:
            if row["domain"] != domain or row["entity"] != entity:
                raise SchemaError("evidence observation identity mismatch")
            if not self._history_contains("observations", row["observed_at"], row):
                raise SchemaError("evidence observation must be recorded before decision")
        return evidence

    def _write_prepared_generation_unlocked(
        self,
        *,
        domain: str,
        current: Mapping[str, Any],
        lkg: Mapping[str, Any],
        recovery: Mapping[str, Any],
        decision: Mapping[str, Any],
        active: Mapping[str, Any],
        now: dt.datetime,
    ) -> str:
        domain_dir = self._domain_dir(domain)
        digest_payload = self._generation_digest_payload(
            domain=domain,
            current=current,
            lkg=lkg,
            recovery=recovery,
            decision=decision,
            previous_transaction_id=active["transaction_id"],
        )
        preparation_nonce = secrets.token_hex(16)
        transaction_id = canonical_sha256(
            {"generation": digest_payload, "preparation_nonce": preparation_nonce}
        )
        generation = domain_dir / "generations" / transaction_id
        if generation.exists():
            self._validate_generation(domain, transaction_id)
            return transaction_id
        self._ensure_directory(generation.parent)
        generation.mkdir(exist_ok=False)
        self._fsync_directory(generation.parent)

        members = (
            ("current.json", current, "after_write_current"),
            ("lkg.json", lkg, "after_write_lkg"),
            ("recovery.json", recovery, "after_write_recovery"),
            ("decision.json", decision, "after_write_decision"),
        )
        member_digests: dict[str, str] = {}
        for name, value, failpoint in members:
            path = generation / name
            self._write_immutable_json(
                path,
                value,
                failpoint_prefix=f"generation_{name.removesuffix('.json')}",
            )
            member_digests[name] = hashlib.sha256(path.read_bytes()).hexdigest()
            self._failpoint(failpoint)

        protected = [transaction_id]
        if active["transaction_id"] is not None:
            protected.append(active["transaction_id"])
        manifest = {
            "schema_version": "data-supply-generation/v1",
            "transaction_id": transaction_id,
            "domain": domain,
            "previous_transaction_id": active["transaction_id"],
            "previous_selection_digest": decision["previous_selection_digest"],
            "new_selection_digest": decision["new_selection_digest"],
            "members": member_digests,
            "generations_retained": GENERATIONS_RETAINED,
            "protected_generation_ids": protected,
            "preparation_nonce": preparation_nonce,
            "prepared_at": _format_timestamp(now),
            "prepared_expires_at": _format_timestamp(
                now + dt.timedelta(hours=PREPARATION_LEASE_HOURS)
            ),
        }
        self._write_immutable_json(
            generation / "manifest.json",
            manifest,
            failpoint_prefix="generation_manifest",
        )
        self._failpoint("after_write_manifest")
        self._fsync_directory(generation)
        self._failpoint("after_generation_fsync")
        self._validate_generation(domain, transaction_id)
        return transaction_id

    def prepare_transition(
        self,
        *,
        domain: str,
        entity: str,
        current: Mapping[str, Any],
        lkg: Mapping[str, Any],
        recovery: Mapping[str, Any],
        candidate_observations: list[Mapping[str, Any]],
        expected_active_transaction_id: str | None,
        transition: str,
        reason_code: str,
        recovery_green_count: int,
        decided_at: str,
        evidence_observations: list[Mapping[str, Any]] | None = None,
    ) -> str:
        domain = _safe_component(domain, "domain")
        entity = _safe_component(entity, "entity")
        transition = _safe_component(transition, "transition")
        reason_code = _safe_component(reason_code, "reason_code")
        _parse_timestamp(decided_at, "decided_at")
        if expected_active_transaction_id is not None:
            _safe_component(expected_active_transaction_id, "expected_active_transaction_id")
        if not isinstance(recovery_green_count, int) or isinstance(recovery_green_count, bool) or recovery_green_count < 0:
            raise SchemaError("recovery_green_count must be a non-negative integer")
        if not isinstance(candidate_observations, list):
            raise SchemaError("candidate_observations must be a list")
        candidates = [validate_observation(row, require_valid=True) for row in candidate_observations]
        if any(row["domain"] != domain for row in candidates):
            raise SchemaError("candidate domain mismatch")
        for candidate in candidates:
            if not self._history_contains("observations", candidate["observed_at"], candidate):
                raise SchemaError("candidate observation must be recorded before promotion")
        evidence = self._validate_recorded_evidence(
            domain=domain,
            entity=entity,
            evidence_observations=evidence_observations or [],
        )
        next_current = _validate_selection_map(current, domain, "current")
        next_lkg = _validate_selection_map(lkg, domain, "lkg")
        next_recovery = _validate_recovery_map(recovery)
        self._validate_payload_refs(next_current)
        self._validate_payload_refs(next_lkg)
        if entity not in next_current:
            raise SchemaError("transition entity must exist in current state")

        domain_dir = self._domain_dir(domain)
        with self._lock(domain_dir / ".lock"):
            active = self._read_active_domain_unlocked(domain)
            if active["transaction_id"] != expected_active_transaction_id:
                raise ConcurrencyError("stale expected_active_transaction_id")
            now = self._now()
            if not self._defer_maintenance:
                self._reconcile_stale_prepared_unlocked(
                    domain,
                    now=now,
                    active=active,
                )
                live_prepared = self._live_prepared_generation_ids_unlocked(
                    domain,
                    now=now,
                    active=active,
                )
                if len(live_prepared) >= MAX_LIVE_PREPARED_GENERATIONS:
                    raise ConcurrencyError("live prepared generation cap reached")
            prior_current = active["current"]
            prior_lkg = active["lkg"]
            prior_recovery = active["recovery"]
            for name in set(prior_current).union(next_current).difference({entity}):
                if prior_current.get(name) != next_current.get(name):
                    raise SchemaError("a single-entity transition cannot mutate another current selection")
            for name in set(prior_lkg).union(next_lkg).difference({entity}):
                if prior_lkg.get(name) != next_lkg.get(name):
                    raise SchemaError("a single-entity transition cannot mutate another LKG selection")
            for name in set(prior_recovery).union(next_recovery).difference({entity}):
                if prior_recovery.get(name) != next_recovery.get(name):
                    raise SchemaError("a single-entity transition cannot mutate another recovery record")
            proposed_lkg = next_lkg.get(entity)
            prior_selected = prior_current.get(entity)
            if next_current[entity] != prior_selected:
                if prior_selected is None:
                    if proposed_lkg is not None:
                        raise SchemaError("an initial selection cannot inject an LKG")
                else:
                    next_selected = next_current[entity]
                    same_provider_refresh = (
                        prior_selected["provider"] == next_selected["provider"]
                        and prior_selected["resolution_state"] in {"fresh_primary", "fresh_fallback"}
                        and next_selected["resolution_state"] in {"fresh_primary", "fresh_fallback"}
                        and transition in {"primary_refresh", "fallback_refresh"}
                    )
                    if same_provider_refresh:
                        if proposed_lkg != prior_lkg.get(entity):
                            raise SchemaError("same-provider refresh cannot mutate LKG")
                    else:
                        if proposed_lkg is None:
                            raise SchemaError("a changed current selection must preserve prior current as LKG")
                        prior_without_ref = dict(prior_selected)
                        proposed_without_ref = dict(proposed_lkg)
                        prior_without_ref.pop("payload_ref", None)
                        proposed_without_ref.pop("payload_ref", None)
                        if proposed_without_ref != prior_without_ref:
                            raise SchemaError("LKG metadata must exactly preserve the prior current selection")
                        proposed_ref = proposed_lkg["payload_ref"]
                        if (
                            proposed_ref["kind"] != "provider_lkg"
                            or proposed_ref["sha256"] != prior_selected["payload_sha256"]
                        ):
                            raise SchemaError("prior current must be rebound to an immutable provider LKG object")
            elif proposed_lkg != prior_lkg.get(entity):
                raise SchemaError("an unchanged current selection cannot mutate its LKG")
            proposed_recovery = next_recovery.get(entity)
            if proposed_recovery is None:
                raise SchemaError("transition entity requires a recovery record")
            if proposed_recovery["consecutive_green"] != recovery_green_count:
                raise SchemaError("recovery_green_count differs from recovery state")
            if proposed_recovery["last_transition"] != transition:
                raise SchemaError("last_transition differs from decision transition")
            prior_green_count = prior_recovery.get(entity, {}).get("consecutive_green", 0)
            if (
                any(row["validation_status"] == "invalid" for row in evidence)
                and recovery_green_count > prior_green_count
            ):
                raise SchemaError("invalid evidence cannot advance recovery")
            candidate_by_id = {row["event_id"]: row for row in candidates}
            if any(candidate["entity"] != entity for candidate in candidates):
                raise SchemaError("candidate entity differs from transition entity")
            for name, selected in next_current.items():
                if prior_current.get(name) == selected:
                    continue
                candidate_id = selected.get("candidate_event_id")
                candidate = candidate_by_id.get(candidate_id)
                if candidate is None:
                    proposed_lkg = next_lkg.get(name)
                    stable_fields = (
                        "domain",
                        "entity",
                        "provider",
                        "provider_path",
                        "payload_sha256",
                        "provider_schema",
                        "source_as_of",
                        "observed_at",
                        "candidate_event_id",
                    )
                    is_lkg_reselection = (
                        selected["resolution_state"] in {"lkg_primary", "lkg_fallback"}
                        and selected["payload_ref"]["kind"] == "provider_lkg"
                        and isinstance(proposed_lkg, Mapping)
                        and all(selected.get(field) == proposed_lkg.get(field) for field in stable_fields)
                        and selected["payload_ref"] == proposed_lkg["payload_ref"]
                    )
                    if is_lkg_reselection:
                        continue
                    raise SchemaError("changed current selection has no matching candidate")
                for field in ("domain", "entity", "provider", "provider_path", "payload_sha256", "provider_schema", "source_as_of", "observed_at"):
                    if selected[field] != candidate[field]:
                        raise SchemaError(f"candidate/selection {field} mismatch")

            previous_selection_digest = canonical_sha256(prior_current)
            new_selection_digest = canonical_sha256(next_current)
            decision: dict[str, Any] = {
                "schema_version": "data-supply-resolution-event/v1",
                "domain": domain,
                "entity": entity,
                "decided_at": decided_at,
                "candidate_event_ids": sorted(candidate_by_id),
                "evidence_event_ids": sorted(row["event_id"] for row in evidence),
                "previous_selection_digest": previous_selection_digest,
                "new_selection_digest": new_selection_digest,
                "transition": transition,
                "reason_code": reason_code,
                "recovery_green_count": recovery_green_count,
            }
            decision["event_id"] = deterministic_event_id("resolution", decision)
            _validate_decision(decision)
            return self._write_prepared_generation_unlocked(
                domain=domain,
                current=next_current,
                lkg=next_lkg,
                recovery=next_recovery,
                decision=decision,
                active=active,
                now=now,
            )

    def prepare_unavailable_transition(
        self,
        *,
        domain: str,
        entity: str,
        evidence_observations: list[Mapping[str, Any]],
        expected_active_transaction_id: str | None,
        reason_code: str,
        decided_at: str,
    ) -> str:
        """Prepare an atomic current-removal after complete negative authority proof."""

        domain = _safe_component(domain, "domain")
        entity = _safe_component(entity, "entity")
        reason_code = _safe_component(reason_code, "reason_code")
        if expected_active_transaction_id is not None:
            expected_active_transaction_id = _safe_component(
                expected_active_transaction_id,
                "expected_active_transaction_id",
            )
        decided = _parse_timestamp(decided_at, "decided_at")
        evidence = self._validate_recorded_evidence(
            domain=domain,
            entity=entity,
            evidence_observations=evidence_observations,
        )
        try:
            policy = get_domain_policy(domain)
        except KeyError as exc:
            raise SchemaError("unavailable authority proof is not configured for this domain") from exc
        required_providers = set(policy.provider_names)
        latest_by_provider: dict[str, dict[str, Any]] = {}
        for row in evidence:
            if row["provider"] not in required_providers:
                raise SchemaError("evidence provider is outside the domain authority set")
            provider_policy = policy.provider(row["provider"])
            if (
                row["endpoint_family"] != provider_policy.endpoint_family
                or row["provider_schema"] != provider_policy.schema
            ):
                raise SchemaError("evidence provider contract mismatch")
            observed = _parse_timestamp(row["observed_at"], "observed_at")
            if observed > decided:
                raise SchemaError("evidence observation cannot follow the decision time")
            previous = latest_by_provider.get(row["provider"])
            if previous is None or observed > _parse_timestamp(previous["observed_at"], "observed_at"):
                latest_by_provider[row["provider"]] = row
        if set(latest_by_provider) != required_providers:
            raise SchemaError("unavailable transition requires complete provider evidence")
        for provider, row in latest_by_provider.items():
            if row["validation_status"] == "invalid":
                continue
            source = _parse_timestamp(row["source_as_of"], "source_as_of")
            age_seconds = int((decided - source).total_seconds())
            if age_seconds < 0:
                raise SchemaError("provider evidence source time follows the decision")
            if age_seconds <= policy.fresh_ttl_hours * 3600:
                raise SchemaError(f"fresh {provider} evidence prevents unavailable")

        domain_dir = self._domain_dir(domain)
        with self._lock(domain_dir / ".lock"):
            active = self._read_active_domain_unlocked(domain)
            if active["transaction_id"] != expected_active_transaction_id:
                raise ConcurrencyError("stale expected_active_transaction_id")
            now = self._now()
            if not self._defer_maintenance:
                self._reconcile_stale_prepared_unlocked(
                    domain,
                    now=now,
                    active=active,
                )
                if len(
                    self._live_prepared_generation_ids_unlocked(
                        domain,
                        now=now,
                        active=active,
                    )
                ) >= MAX_LIVE_PREPARED_GENERATIONS:
                    raise ConcurrencyError("live prepared generation cap reached")
            prior_current = active["current"]
            prior_selected = prior_current.get(entity)
            audit_lkg = active["lkg"].get(entity, prior_selected)
            if audit_lkg is not None:
                lkg_source = _parse_timestamp(audit_lkg["source_as_of"], "LKG source_as_of")
                lkg_age_seconds = int((decided - lkg_source).total_seconds())
                if lkg_age_seconds < 0:
                    raise SchemaError("LKG source time follows the decision")
                if lkg_age_seconds <= policy.emergency_lkg_ttl_days * 86400:
                    raise SchemaError("unexpired selected LKG prevents unavailable")

            next_current = dict(prior_current)
            next_current.pop(entity, None)
            next_lkg = dict(active["lkg"])
            if prior_selected is not None:
                next_lkg.setdefault(entity, prior_selected)
            next_recovery = dict(active["recovery"])
            next_recovery[entity] = {
                "consecutive_green": 0,
                "last_transition": "unavailable",
            }
            self._validate_payload_refs(next_current)
            self._validate_payload_refs(next_lkg)
            decision: dict[str, Any] = {
                "schema_version": "data-supply-resolution-event/v1",
                "domain": domain,
                "entity": entity,
                "decided_at": decided_at,
                "candidate_event_ids": [],
                "evidence_event_ids": sorted(row["event_id"] for row in evidence),
                "previous_selection_digest": canonical_sha256(prior_current),
                "new_selection_digest": canonical_sha256(next_current),
                "transition": "unavailable",
                "reason_code": reason_code,
                "recovery_green_count": 0,
            }
            decision["event_id"] = deterministic_event_id("resolution", decision)
            _validate_decision(decision)
            return self._write_prepared_generation_unlocked(
                domain=domain,
                current=next_current,
                lkg=next_lkg,
                recovery=next_recovery,
                decision=decision,
                active=active,
                now=now,
            )

    def _active_pointer(
        self,
        domain: str,
        generation: Mapping[str, Any],
        decision: Mapping[str, Any],
        retained_generation_ids: list[str],
    ) -> dict[str, Any]:
        return {
            "schema_version": "data-supply-active/v1",
            "domain": domain,
            "transaction_id": generation["transaction_id"],
            "generation_manifest_sha256": generation["manifest_sha256"],
            "decision": dict(decision),
            "retained_generation_ids": list(retained_generation_ids),
        }

    def _bind_committed_transaction(
        self, decision: Mapping[str, Any], transaction_id: str
    ) -> dict[str, Any]:
        committed = dict(decision)
        committed["transaction_id"] = _safe_component(transaction_id, "transaction_id")
        committed["event_id"] = deterministic_event_id("resolution", committed)
        return _validate_decision(committed)

    def commit_prepared(self, domain: str, transaction_id: str) -> dict[str, Any]:
        domain = _safe_component(domain, "domain")
        transaction_id = _safe_component(transaction_id, "transaction_id")
        domain_dir = self._domain_dir(domain)
        with self._lock(domain_dir / ".lock"):
            generation = self._validate_generation(domain, transaction_id)
            active = self._read_active_domain_unlocked(domain)
            expected = generation["manifest"]["previous_transaction_id"]
            if active["transaction_id"] != expected:
                raise ConcurrencyError("prepared generation lost its compare-and-swap race")
            if self._now() >= generation["prepared_expires_at"]:
                raise ConcurrencyError("prepared generation lease expired")
            committed_decision = self._bind_committed_transaction(
                generation["decision"], generation["transaction_id"]
            )
            retained = [transaction_id]
            retained.extend(
                retained_id
                for retained_id in active.get("retained_generation_ids", [])
                if retained_id != transaction_id
            )
            retained = retained[:GENERATIONS_RETAINED]
            pointer = self._active_pointer(
                domain,
                generation,
                committed_decision,
                retained,
            )
            self._atomic_write_json(domain_dir / "active.json", pointer, failpoint_prefix="active")
            self._failpoint("after_active_replace")
            self._failpoint("before_resolution_append")
            self._record_resolution(committed_decision)
            try:
                self._clear_matching_pending_unlocked(generation)
            except DataSupplyStateError:
                pass
            if not self._defer_maintenance:
                self._prune_domain_unlocked(
                    domain,
                    in_flight_generation_ids={transaction_id},
                )
            return self._read_active_domain_unlocked(domain)

    def recover_domain(self, domain: str) -> dict[str, Any]:
        domain = _safe_component(domain, "domain")
        domain_dir = self._domain_dir(domain)
        with self._lock(domain_dir / ".lock"):
            active = self._read_active_domain_unlocked(domain)
            if active["transaction_id"] is None:
                return active
            self._record_resolution(active["active_decision"])
            try:
                self._clear_matching_pending_unlocked(active)
            except DataSupplyStateError:
                pass
            if not self._defer_maintenance:
                self._prune_domain_unlocked(
                    domain,
                    in_flight_generation_ids={active["transaction_id"]},
                )
            return active

    def rollback_domain(
        self,
        domain: str,
        *,
        target_transaction_id: str,
        expected_active_transaction_id: str,
        decided_at: str,
    ) -> dict[str, Any]:
        domain = _safe_component(domain, "domain")
        target_transaction_id = _safe_component(target_transaction_id, "target_transaction_id")
        expected_active_transaction_id = _safe_component(expected_active_transaction_id, "expected_active_transaction_id")
        _parse_timestamp(decided_at, "decided_at")
        domain_dir = self._domain_dir(domain)
        with self._lock(domain_dir / ".lock"):
            active = self._read_active_domain_unlocked(domain)
            if active["transaction_id"] != expected_active_transaction_id:
                raise ConcurrencyError("rollback compare-and-swap precondition failed")
            if target_transaction_id not in active.get("retained_generation_ids", []):
                raise ConcurrencyError("rollback target is outside the retained generation window")
            target = self._validate_generation(domain, target_transaction_id)
            target_commit = self._bind_committed_transaction(
                target["decision"], target_transaction_id
            )
            if not self._history_contains(
                "resolutions", target_commit["decided_at"], target_commit
            ):
                raise IntegrityError("rollback target was prepared but never committed")
            decision: dict[str, Any] = {
                "schema_version": "data-supply-resolution-event/v1",
                "domain": domain,
                "entity": "domain",
                "decided_at": decided_at,
                "candidate_event_ids": [],
                "evidence_event_ids": [],
                "previous_selection_digest": canonical_sha256(active["current"]),
                "new_selection_digest": canonical_sha256(target["current"]),
                "transition": "rollback",
                "reason_code": "operator_rollback",
                "recovery_green_count": 0,
                "transaction_id": target_transaction_id,
            }
            decision["event_id"] = deterministic_event_id("resolution", decision)
            _validate_decision(decision)
            retained = [target_transaction_id]
            retained.extend(
                retained_id
                for retained_id in active.get("retained_generation_ids", [])
                if retained_id != target_transaction_id
            )
            retained = retained[:GENERATIONS_RETAINED]
            pointer = self._active_pointer(domain, target, decision, retained)
            self._atomic_write_json(domain_dir / "active.json", pointer, failpoint_prefix="active")
            self._failpoint("after_active_replace")
            self._failpoint("before_resolution_append")
            self._record_resolution(decision)
            if not self._defer_maintenance:
                self._prune_domain_unlocked(
                    domain,
                    in_flight_generation_ids={target_transaction_id},
                )
            return self._read_active_domain_unlocked(domain)

    def _validate_pending_pointer(
        self,
        path: Path,
        *,
        provider: str,
        domain: str,
        entity: str,
    ) -> dict[str, Any]:
        if path.is_symlink() or not path.is_file():
            raise IntegrityError("pending pointer is not a regular file")
        pointer = self._read_json(path)
        required = {
            "schema_version",
            "provider",
            "endpoint_family",
            "domain",
            "entity",
            "provider_path",
            "provider_schema",
            "source_as_of",
            "observed_at",
            "observation_event_id",
            "sha256",
            "path",
        }
        if not isinstance(pointer, dict) or required.difference(pointer):
            raise IntegrityError("pending pointer is incomplete")
        try:
            sha256 = _validate_sha(pointer["sha256"], "pending sha256")
            _validate_sha(pointer["observation_event_id"], "pending observation_event_id")
            _safe_relative_path(pointer["provider_path"], "pending provider_path")
            _safe_label(pointer["provider_schema"], "pending provider_schema")
            _safe_component(pointer["endpoint_family"], "pending endpoint_family")
            _parse_timestamp(pointer["source_as_of"], "pending source_as_of")
            _parse_timestamp(pointer["observed_at"], "pending observed_at")
        except SchemaError as exc:
            raise IntegrityError("pending pointer schema is malformed") from exc
        expected_path = (
            Path("providers")
            / provider
            / domain
            / "objects"
            / entity
            / f"{sha256}.json"
        ).as_posix()
        if (
            pointer["schema_version"] != "data-supply-provider-pending/v1"
            or pointer["provider"] != provider
            or pointer["domain"] != domain
            or pointer["entity"] != entity
            or pointer["path"] != expected_path
        ):
            raise IntegrityError("pending pointer identity mismatch")
        object_path = self._inside_root(self.root / expected_path)
        if object_path.is_symlink() or not object_path.is_file():
            raise IntegrityError("pending provider object is missing or unsafe")
        payload = object_path.read_bytes()
        try:
            _strict_json_loads(payload)
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
            raise IntegrityError("pending provider object is not strict JSON") from exc
        if hashlib.sha256(payload).hexdigest() != sha256:
            raise IntegrityError("pending provider object digest mismatch")
        return pointer

    def _validate_provider_lkg_latest(
        self,
        path: Path,
        *,
        provider: str,
        domain: str,
        entity: str,
    ) -> dict[str, Any]:
        if path.is_symlink() or not path.is_file():
            raise IntegrityError("provider LKG latest pointer is not a regular file")
        pointer = self._read_json(path)
        if not isinstance(pointer, dict):
            raise IntegrityError("provider LKG latest pointer is corrupt")
        try:
            sha256 = _validate_sha(pointer.get("sha256"), "provider LKG latest sha256")
        except SchemaError as exc:
            raise IntegrityError("provider LKG latest pointer is malformed") from exc
        expected_path = (
            Path("providers")
            / provider
            / domain
            / "lkg"
            / entity
            / "objects"
            / f"{sha256}.json"
        ).as_posix()
        if (
            pointer.get("schema_version") != "data-supply-provider-lkg-pointer/v1"
            or pointer.get("provider") != provider
            or pointer.get("domain") != domain
            or pointer.get("entity") != entity
            or pointer.get("path") != expected_path
        ):
            raise IntegrityError("provider LKG latest pointer identity mismatch")
        object_path = self._inside_root(self.root / expected_path)
        if object_path.is_symlink() or not object_path.is_file():
            raise IntegrityError("provider LKG latest object is missing or unsafe")
        payload = object_path.read_bytes()
        try:
            _strict_json_loads(payload)
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
            raise IntegrityError("provider LKG latest object is not strict JSON") from exc
        if hashlib.sha256(payload).hexdigest() != sha256:
            raise IntegrityError("provider LKG latest object digest mismatch")
        return pointer

    def _committed_transaction_ids_from_history(self, domain: str) -> set[str]:
        directory = self.root / "history" / "resolutions"
        if not directory.exists():
            return set()
        if directory.is_symlink() or not directory.is_dir():
            raise IntegrityError("resolution history root is unsafe")
        committed: set[str] = set()
        for history in sorted(directory.glob("*.jsonl")):
            day = history.stem
            with self._lock(directory / f".{day}.lock", shared=True):
                payload = history.read_bytes()
            if payload and not payload.endswith(b"\n"):
                raise IntegrityError("resolution history has an uncommitted tail")
            for line in payload.splitlines():
                try:
                    record = json.loads(line.decode("utf-8"))
                    decision = _validate_decision(record)
                except (UnicodeDecodeError, json.JSONDecodeError, SchemaError) as exc:
                    raise IntegrityError("resolution history contains an invalid event") from exc
                transaction_id = decision.get("transaction_id")
                if decision["domain"] == domain and transaction_id is not None:
                    committed.add(transaction_id)
        return committed

    def _consumed_observation_ids_from_history(self, domain: str) -> set[str]:
        directory = self.root / "history" / "resolutions"
        if not directory.exists():
            return set()
        consumed: set[str] = set()
        for history in sorted(directory.glob("*.jsonl")):
            day = history.stem
            with self._lock(directory / f".{day}.lock", shared=True):
                payload = history.read_bytes()
            if payload and not payload.endswith(b"\n"):
                raise IntegrityError("resolution history has an uncommitted tail")
            for line in payload.splitlines():
                try:
                    decision = _validate_decision(json.loads(line.decode("utf-8")))
                except (UnicodeDecodeError, json.JSONDecodeError, SchemaError) as exc:
                    raise IntegrityError("resolution history contains an invalid event") from exc
                if decision["domain"] == domain and decision.get("transaction_id") is not None:
                    consumed.update(decision["candidate_event_ids"])
                    consumed.update(decision["evidence_event_ids"])
        return consumed

    def _live_prepared_generation_ids_deferred(
        self,
        domain: str,
        *,
        now: dt.datetime,
        retained_generation_ids: set[str],
    ) -> list[str]:
        committed = self._committed_transaction_ids_from_history(domain)
        live: list[str] = []
        for path in self._generation_directories(domain):
            if path.name in retained_generation_ids or path.name in committed:
                continue
            generation = self._validate_generation(domain, path.name)
            if now < generation["prepared_expires_at"]:
                live.append(path.name)
        return live

    def _collect_domain_pins_unlocked(
        self,
        domain: str,
        *,
        in_flight_generation_ids: set[str] | None = None,
    ) -> tuple[set[str], set[str]]:
        active = self._read_active_domain_unlocked(domain)
        now = self._now()
        retained = set(active.get("retained_generation_ids", []))
        if self._defer_maintenance:
            live_prepared = set(
                self._live_prepared_generation_ids_deferred(
                    domain,
                    now=now,
                    retained_generation_ids=retained,
                )
            )
        else:
            live_prepared = set(
                self._live_prepared_generation_ids_unlocked(
                    domain,
                    now=now,
                    active=active,
                )
            )
        generation_pins = retained | live_prepared | set(in_flight_generation_ids or set())
        object_pins: set[str] = set()
        for transaction_id in sorted(generation_pins):
            generation = self._validate_generation(domain, transaction_id)
            for records in (generation["current"], generation["lkg"]):
                for selected in records.values():
                    ref = selected["payload_ref"]
                    if ref["kind"] == "provider_truth":
                        raise IntegrityError("pinned generation contains mutable provider truth")
                    object_pins.add(_safe_relative_path(ref["path"], "pinned payload path"))

        providers_root = self.root / "providers"
        if providers_root.exists():
            if providers_root.is_symlink() or not providers_root.is_dir():
                raise IntegrityError("providers root is unsafe")
            for provider_dir in providers_root.iterdir():
                if provider_dir.is_symlink() or not provider_dir.is_dir():
                    raise IntegrityError("providers root contains an unsafe entry")
                try:
                    provider = _safe_component(provider_dir.name, "provider")
                except SchemaError as exc:
                    raise IntegrityError("providers root contains a malformed provider") from exc
                provider_domain = provider_dir / domain
                if not provider_domain.exists():
                    continue
                if provider_domain.is_symlink() or not provider_domain.is_dir():
                    raise IntegrityError("provider domain root is unsafe")
                pending_dir = provider_domain / "pending"
                if pending_dir.exists():
                    if pending_dir.is_symlink() or not pending_dir.is_dir():
                        raise IntegrityError("pending root is unsafe")
                    for pending_path in pending_dir.iterdir():
                        if pending_path.suffix != ".json":
                            raise IntegrityError("pending root contains an unexpected entry")
                        try:
                            entity = _safe_component(pending_path.stem, "pending entity")
                        except SchemaError as exc:
                            raise IntegrityError("pending pointer filename is malformed") from exc
                        pointer = self._validate_pending_pointer(
                            pending_path,
                            provider=provider,
                            domain=domain,
                            entity=entity,
                        )
                        object_pins.add(pointer["path"])
                lkg_root = provider_domain / "lkg"
                if lkg_root.exists():
                    if lkg_root.is_symlink() or not lkg_root.is_dir():
                        raise IntegrityError("provider LKG root is unsafe")
                    for entity_dir in lkg_root.iterdir():
                        if entity_dir.is_symlink() or not entity_dir.is_dir():
                            raise IntegrityError("provider LKG root contains an unsafe entry")
                        try:
                            entity = _safe_component(entity_dir.name, "provider LKG entity")
                        except SchemaError as exc:
                            raise IntegrityError("provider LKG entity is malformed") from exc
                        latest = entity_dir / "latest.json"
                        if latest.exists():
                            pointer = self._validate_provider_lkg_latest(
                                latest,
                                provider=provider,
                                domain=domain,
                                entity=entity,
                            )
                            object_pins.add(pointer["path"])

        migration_path = self._domain_dir(domain) / "migration.json"
        if migration_path.exists():
            if migration_path.is_symlink() or not migration_path.is_file():
                raise IntegrityError("migration manifest is unsafe")
            migration = self._read_json(migration_path)
            if (
                not isinstance(migration, dict)
                or migration.get("schema_version") != "data-supply-migration/v1"
                or migration.get("domain") != domain
                or not isinstance(migration.get("payload_refs"), list)
                or len(migration["payload_refs"]) > 718
            ):
                raise IntegrityError("migration manifest is malformed")
            for ref in migration["payload_refs"]:
                if not isinstance(ref, Mapping) or {"path", "sha256"}.difference(ref):
                    raise IntegrityError("migration payload ref is malformed")
                path = _safe_relative_path(ref["path"], "migration payload path")
                sha256 = _validate_sha(ref["sha256"], "migration payload sha256")
                if not path.endswith(f"/{sha256}.json"):
                    raise IntegrityError("migration payload ref identity mismatch")
                payload_path = self._inside_root(self.root / path)
                if payload_path.is_symlink() or not payload_path.is_file():
                    raise IntegrityError("migration payload ref is missing or unsafe")
                payload = payload_path.read_bytes()
                if hashlib.sha256(payload).hexdigest() != sha256:
                    raise IntegrityError("migration payload digest mismatch")
                object_pins.add(path)
        return object_pins, generation_pins

    def _provider_object_candidates(self, domain: str) -> list[Path]:
        providers_root = self.root / "providers"
        if not providers_root.exists():
            return []
        candidates: list[Path] = []
        for provider_dir in providers_root.iterdir():
            provider_domain = provider_dir / domain
            if not provider_domain.exists():
                continue
            roots: list[Path] = []
            object_root = provider_domain / "objects"
            if object_root.exists():
                if object_root.is_symlink() or not object_root.is_dir():
                    raise IntegrityError("provider object root is unsafe")
                roots.append(object_root)
            lkg_root = provider_domain / "lkg"
            if lkg_root.exists():
                for entity_dir in lkg_root.iterdir():
                    objects = entity_dir / "objects"
                    if objects.exists():
                        if objects.is_symlink() or not objects.is_dir():
                            raise IntegrityError("provider LKG object root is unsafe")
                        roots.append(objects)
            for root in roots:
                if root.name == "objects" and root.parent == provider_domain:
                    entity_dirs = list(root.iterdir())
                else:
                    entity_dirs = [root]
                for entity_dir in entity_dirs:
                    if entity_dir.is_symlink() or not entity_dir.is_dir():
                        raise IntegrityError("provider object root contains an unsafe entry")
                    for path in entity_dir.iterdir():
                        if path.is_symlink() or not path.is_file() or path.suffix != ".json":
                            raise IntegrityError("provider object root contains an unsafe file")
                        sha256 = path.stem
                        try:
                            _validate_sha(sha256, "provider object filename")
                        except SchemaError as exc:
                            raise IntegrityError("provider object filename is malformed") from exc
                        payload = path.read_bytes()
                        try:
                            _strict_json_loads(payload)
                        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
                            raise IntegrityError("provider object candidate is not strict JSON") from exc
                        if hashlib.sha256(payload).hexdigest() != sha256:
                            raise IntegrityError("provider object candidate digest mismatch")
                        candidates.append(path)
        return candidates

    def _prune_domain_unlocked(
        self,
        domain: str,
        *,
        in_flight_generation_ids: set[str] | None = None,
        prune_generations: bool = True,
    ) -> dict[str, Any]:
        try:
            object_pins, generation_pins = self._collect_domain_pins_unlocked(
                domain,
                in_flight_generation_ids=in_flight_generation_ids,
            )
            object_candidates = self._provider_object_candidates(domain)
            generation_candidates: list[str] = []
            if prune_generations:
                for path in self._generation_directories(domain):
                    if not self._defer_maintenance or path.name in generation_pins:
                        self._validate_generation(domain, path.name)
                    if path.name not in generation_pins:
                        generation_candidates.append(path.name)
        except (DataSupplyStateError, OSError, ValueError):
            return {
                "deleted_objects": 0,
                "deleted_generations": 0,
                "skipped": "pin_validation_failed",
            }

        deleted_generations = 0
        for transaction_id in generation_candidates:
            self._remove_generation_directory_unlocked(domain, transaction_id)
            deleted_generations += 1
        deleted_objects = 0
        for path in object_candidates:
            relative_path = path.relative_to(self.root).as_posix()
            if relative_path in object_pins:
                continue
            self._failpoint("before_provider_object_unlink")
            path.unlink()
            self._failpoint("after_provider_object_unlink")
            self._fsync_directory(path.parent)
            self._failpoint("after_provider_object_directory_fsync")
            deleted_objects += 1
        return {
            "deleted_objects": deleted_objects,
            "deleted_generations": deleted_generations,
            "skipped": None,
        }

    def prune_domain(self, domain: str) -> dict[str, Any]:
        domain = _safe_component(domain, "domain")
        domain_dir = self._domain_dir(domain)
        with self._lock(domain_dir / ".lock"):
            self._generation_cache.clear()
            return self._prune_domain_unlocked(domain)

    def reconcile_committed_pending(self, domain: str) -> int:
        """Remove only pending pointers cited by transaction-bound committed decisions."""

        domain = _safe_component(domain, "domain")
        with self._lock(self._domain_dir(domain) / ".lock"):
            consumed = self._consumed_observation_ids_from_history(domain)
            providers_root = self.root / "providers"
            if not providers_root.exists():
                return 0
            cleared = 0
            for provider_dir in sorted(providers_root.iterdir(), key=lambda path: path.name):
                provider = _safe_component(provider_dir.name, "provider")
                provider_domain = provider_dir / domain
                pending_root = provider_domain / "pending"
                if not pending_root.exists():
                    continue
                for pending in sorted(pending_root.glob("*.json")):
                    entity = _safe_component(pending.stem, "pending entity")
                    with self._lock(provider_domain / ".locks" / f"{entity}.lock"):
                        if not pending.exists():
                            continue
                        pointer = self._validate_pending_pointer(
                            pending,
                            provider=provider,
                            domain=domain,
                            entity=entity,
                        )
                        if pointer["observation_event_id"] not in consumed:
                            continue
                        pending.unlink()
                        self._fsync_directory(pending.parent)
                        cleared += 1
            return cleared

    def _clear_matching_pending_unlocked(self, generation: Mapping[str, Any]) -> bool:
        decision = generation.get("decision", {})
        entity = decision.get("entity")
        if not isinstance(entity, str) or entity == "domain":
            return False
        selected = generation.get("current", {}).get(entity)
        domain = decision.get("domain")
        if not isinstance(domain, str):
            return False
        consumed_event_ids = set(decision.get("candidate_event_ids", [])) | set(
            decision.get("evidence_event_ids", [])
        )
        if not consumed_event_ids:
            return False
        providers_root = self.root / "providers"
        if not providers_root.exists():
            return False
        cleared = False
        for provider_dir in sorted(providers_root.iterdir(), key=lambda path: path.name):
            if provider_dir.is_symlink() or not provider_dir.is_dir():
                raise IntegrityError("providers root contains an unsafe entry")
            provider = _safe_component(provider_dir.name, "provider")
            provider_domain = provider_dir / domain
            pending = provider_domain / "pending" / f"{entity}.json"
            if not pending.exists():
                continue
            with self._lock(provider_domain / ".locks" / f"{entity}.lock"):
                if not pending.exists():
                    continue
                pointer = self._validate_pending_pointer(
                    pending,
                    provider=provider,
                    domain=domain,
                    entity=entity,
                )
                if pointer["observation_event_id"] not in consumed_event_ids:
                    continue
                if isinstance(selected, Mapping) and selected.get("provider") == provider:
                    ref = selected["payload_ref"]
                    if pointer["sha256"] != ref["sha256"]:
                        continue
                    if ref["kind"] == "provider_object" and pointer["path"] != ref["path"]:
                        continue
                pending.unlink()
                self._fsync_directory(pending.parent)
                cleared = True
        return cleared

    def preserve_current_as_provider_lkg(
        self,
        domain: str,
        entity: str,
        *,
        expected_active_transaction_id: str,
    ) -> dict[str, Any]:
        """Copy the CAS-bound current immutable bytes into provider LKG under lock order."""

        domain = _safe_component(domain, "domain")
        entity = _safe_component(entity, "entity")
        expected_active_transaction_id = _safe_component(
            expected_active_transaction_id,
            "expected_active_transaction_id",
        )
        with self._lock(self._domain_dir(domain) / ".lock"):
            active = self._read_active_domain_unlocked(domain)
            if active["transaction_id"] != expected_active_transaction_id:
                raise ConcurrencyError("current-to-LKG compare-and-swap precondition failed")
            selected = active["current"].get(entity)
            if selected is None:
                raise SchemaError("current-to-LKG requires a current selection")
            ref = selected["payload_ref"]
            if ref["kind"] == "provider_lkg":
                return dict(selected)
            payload_path = self._inside_root(self.root / ref["path"])
            payload = payload_path.read_bytes()
            if hashlib.sha256(payload).hexdigest() != ref["sha256"]:
                raise IntegrityError("current immutable payload digest mismatch")
            provider = selected["provider"]
            base = self.root / "providers" / provider / domain / "lkg" / entity
            latest_path = base / "latest.json"
            expected_latest = None
            if latest_path.exists():
                latest = self._validate_provider_lkg_latest(
                    latest_path,
                    provider=provider,
                    domain=domain,
                    entity=entity,
                )
                expected_latest = latest["sha256"]
            stored = self._store_provider_lkg_unlocked(
                provider=provider,
                domain=domain,
                entity=entity,
                payload=payload,
                meaningful_transition=True,
                expected_latest_sha256=expected_latest,
            )
            return bind_selection_to_provider_lkg(selected, stored)

    def store_provider_object(
        self,
        *,
        observation: Mapping[str, Any],
        payload: Any,
    ) -> dict[str, str]:
        """Publish exact immutable candidate bytes and its one-per-entity pending pointer."""

        row = validate_observation(observation, require_valid=True)
        provider = row["provider"]
        domain = row["domain"]
        entity = row["entity"]
        if isinstance(payload, bytes):
            payload_bytes = payload
            try:
                _strict_json_loads(payload_bytes)
            except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
                raise SchemaError("provider object bytes must contain strict JSON") from exc
        else:
            payload_bytes = canonical_json_bytes(payload)
        payload_sha = hashlib.sha256(payload_bytes).hexdigest()
        if payload_sha != row["payload_sha256"]:
            raise SchemaError("provider object digest differs from observation")

        relative_path = (
            Path("providers")
            / provider
            / domain
            / "objects"
            / entity
            / f"{payload_sha}.json"
        ).as_posix()
        pending_relative_path = (
            Path("providers") / provider / domain / "pending" / f"{entity}.json"
        ).as_posix()
        provider_domain = self.root / "providers" / provider / domain
        domain_dir = self._domain_dir(domain)
        with self._lock(domain_dir / ".lock"):
            active = self._read_active_domain_unlocked(domain)
            if not self._defer_maintenance:
                self._reconcile_stale_prepared_unlocked(
                    domain,
                    now=self._now(),
                    active=active,
                )
            with self._lock(provider_domain / ".locks" / f"{entity}.lock"):
                object_path = self.root / relative_path
                self._write_immutable_bytes(
                    object_path,
                    payload_bytes,
                    failpoint_prefix="provider_object",
                )
                if hashlib.sha256(object_path.read_bytes()).hexdigest() != payload_sha:
                    raise IntegrityError("provider object verification failed")
                self._failpoint("after_provider_object")
                pointer = {
                    "schema_version": "data-supply-provider-pending/v1",
                    "provider": provider,
                    "endpoint_family": row["endpoint_family"],
                    "domain": domain,
                    "entity": entity,
                    "provider_path": row["provider_path"],
                    "provider_schema": row["provider_schema"],
                    "source_as_of": row["source_as_of"],
                    "observed_at": row["observed_at"],
                    "observation_event_id": row["event_id"],
                    "sha256": payload_sha,
                    "path": relative_path,
                }
                self._atomic_write_json(
                    self.root / pending_relative_path,
                    pointer,
                    failpoint_prefix="provider_pending",
                )
                self._failpoint("after_provider_pending")
                if not self._defer_maintenance:
                    self._prune_domain_unlocked(
                        domain,
                        prune_generations=False,
                    )
        return {
            "sha256": payload_sha,
            "path": relative_path,
            "pending_path": pending_relative_path,
        }

    def store_provider_lkg(
        self,
        *,
        provider: str,
        domain: str,
        entity: str,
        payload: Any,
        meaningful_transition: bool,
        expected_latest_sha256: str | None,
    ) -> dict[str, str]:
        domain_component = _safe_component(domain, "domain")
        with self._lock(self._domain_dir(domain_component) / ".lock"):
            return self._store_provider_lkg_unlocked(
                provider=provider,
                domain=domain_component,
                entity=entity,
                payload=payload,
                meaningful_transition=meaningful_transition,
                expected_latest_sha256=expected_latest_sha256,
            )

    def _store_provider_lkg_unlocked(
        self,
        *,
        provider: str,
        domain: str,
        entity: str,
        payload: Any,
        meaningful_transition: bool,
        expected_latest_sha256: str | None,
    ) -> dict[str, str]:
        provider = _safe_component(provider, "provider")
        domain = _safe_component(domain, "domain")
        entity = _safe_component(entity, "entity")
        if expected_latest_sha256 is not None:
            _validate_sha(expected_latest_sha256, "expected_latest_sha256")
        base = self.root / "providers" / provider / domain / "lkg" / entity
        latest_path = base / "latest.json"
        with self._lock(base / ".lock"):
            latest: dict[str, Any] | None = None
            if latest_path.exists():
                loaded = self._read_json(latest_path)
                if not isinstance(loaded, dict) or loaded.get("schema_version") != "data-supply-provider-lkg-pointer/v1":
                    raise IntegrityError("provider LKG latest pointer is corrupt")
                try:
                    _validate_sha(loaded.get("sha256"), "latest sha256")
                    _safe_relative_path(loaded.get("path"), "latest path")
                except SchemaError as exc:
                    raise IntegrityError("provider LKG latest pointer is malformed") from exc
                expected_path = (
                    Path("providers")
                    / provider
                    / domain
                    / "lkg"
                    / entity
                    / "objects"
                    / f"{loaded['sha256']}.json"
                ).as_posix()
                if (
                    loaded.get("provider") != provider
                    or loaded.get("domain") != domain
                    or loaded.get("entity") != entity
                    or loaded.get("path") != expected_path
                ):
                    raise IntegrityError("provider LKG latest pointer identity mismatch")
                object_path = self._inside_root(self.root / expected_path)
                try:
                    object_payload = object_path.read_bytes()
                except FileNotFoundError as exc:
                    raise IntegrityError("provider LKG latest object is missing") from exc
                if hashlib.sha256(object_payload).hexdigest() != loaded["sha256"]:
                    raise IntegrityError("provider LKG latest object digest mismatch")
                latest = loaded
            actual_latest = latest["sha256"] if latest else None
            if actual_latest != expected_latest_sha256:
                raise ConcurrencyError("provider LKG latest compare-and-swap precondition failed")
            if not meaningful_transition:
                if latest is None:
                    raise SchemaError("non-transition provider LKG write requires an existing latest pointer")
                return {"sha256": latest["sha256"], "path": latest["path"]}

            if isinstance(payload, bytes):
                payload_bytes = payload
                try:
                    _strict_json_loads(payload_bytes)
                except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
                    raise SchemaError("provider LKG bytes must contain strict JSON") from exc
            else:
                payload_bytes = canonical_json_bytes(payload)
            payload_sha = hashlib.sha256(payload_bytes).hexdigest()
            relative_path = (
                Path("providers") / provider / domain / "lkg" / entity / "objects" / f"{payload_sha}.json"
            ).as_posix()
            object_path = self.root / relative_path
            self._write_immutable_bytes(
                object_path,
                payload_bytes,
                failpoint_prefix="provider_lkg_object",
            )
            if hashlib.sha256(object_path.read_bytes()).hexdigest() != payload_sha:
                raise IntegrityError("provider LKG object verification failed")
            self._failpoint("after_provider_lkg_object")
            pointer = {
                "schema_version": "data-supply-provider-lkg-pointer/v1",
                "provider": provider,
                "domain": domain,
                "entity": entity,
                "sha256": payload_sha,
                "path": relative_path,
            }
            self._atomic_write_json(latest_path, pointer, failpoint_prefix="provider_lkg_latest")
            return {"sha256": payload_sha, "path": relative_path}


__all__ = [
    "ConcurrencyError",
    "DataSupplyStateStore",
    "DataSupplyStateError",
    "ETF_DETAIL_EMERGENCY_LKG_TTL_DAYS",
    "ETF_DETAIL_FRESH_TTL_HOURS",
    "GENERATIONS_RETAINED",
    "IntegrityError",
    "SchemaError",
    "UnavailableError",
    "build_selection",
    "bind_selection_to_provider_lkg",
    "canonical_json_bytes",
    "canonical_sha256",
    "deterministic_event_id",
    "selection_age_status",
    "validate_observation",
]
