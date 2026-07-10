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


GENERATIONS_RETAINED = 3
ETF_DETAIL_FRESH_TTL_HOURS = 168
ETF_DETAIL_EMERGENCY_LKG_TTL_DAYS = 14

_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_COMPONENT = re.compile(r"^[A-Za-z0-9._-]+$")
_SELECTION_STATES = {"fresh_primary", "fresh_fallback", "lkg_primary", "lkg_fallback"}
_PAYLOAD_REF_KINDS = {"provider_truth", "provider_lkg"}


class DataSupplyStateError(RuntimeError):
    """Base class for data-supply state errors."""


class SchemaError(DataSupplyStateError):
    """An input record violates the storage contract."""


class IntegrityError(DataSupplyStateError):
    """Persisted state is corrupt or internally inconsistent."""


class ConcurrencyError(DataSupplyStateError):
    """A compare-and-swap precondition was not satisfied."""


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


def validate_observation(record: Mapping[str, Any], *, require_valid: bool = False) -> dict[str, Any]:
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
    source = _parse_timestamp(row["source_as_of"], "source_as_of")
    observed = _parse_timestamp(row["observed_at"], "observed_at")
    if observed < source:
        raise SchemaError("observed_at cannot precede source_as_of")
    if row["validation_status"] not in {"valid", "invalid"}:
        raise SchemaError("validation_status must be valid or invalid")
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


def selection_age_status(resolution_state: str, age_seconds: int) -> str:
    if not isinstance(age_seconds, int) or isinstance(age_seconds, bool) or age_seconds < 0:
        raise SchemaError("age_seconds must be a non-negative integer")
    if resolution_state in {"fresh_primary", "fresh_fallback"}:
        return "fresh" if age_seconds <= ETF_DETAIL_FRESH_TTL_HOURS * 3600 else "stale"
    if resolution_state in {"lkg_primary", "lkg_fallback"}:
        return "stale" if age_seconds <= ETF_DETAIL_EMERGENCY_LKG_TTL_DAYS * 86400 else "unavailable"
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
    for event_id in row["candidate_event_ids"]:
        _validate_sha(event_id, "candidate_event_id")
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
                                validate_observation(parsed_tail)
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
                            validate_observation(parsed)
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
                        validate_observation(parsed)
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
        return {"transaction_id": None, "current": {}, "lkg": {}, "recovery": {}}

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
                ref_path = _safe_relative_path(ref["path"], "payload_ref.path")
                if not any(ref_path == root or ref_path.startswith(f"{root}/") for root in self._allowed_provider_truth_roots):
                    raise SchemaError("provider-truth ref is outside the configured allowlist")
                if self.provider_truth_root is None:
                    raise SchemaError("provider_truth_root is required to verify provider-truth selections")
                candidate_path = (self.provider_truth_root / ref_path).resolve(strict=False)
                try:
                    candidate_path.relative_to(self.provider_truth_root)
                except ValueError as exc:
                    raise SchemaError("provider-truth ref escapes the configured corpus root") from exc
                try:
                    payload_bytes = candidate_path.read_bytes()
                except FileNotFoundError as exc:
                    raise SchemaError("provider-truth payload is missing") from exc
                if hashlib.sha256(payload_bytes).hexdigest() != ref["sha256"]:
                    raise SchemaError("provider-truth payload digest mismatch")
                continue
            ref_path = self._inside_root(self.root / _safe_relative_path(ref["path"], "payload_ref.path"))
            expected_path = (
                Path("providers")
                / row["provider"]
                / row["domain"]
                / "lkg"
                / row["entity"]
                / "objects"
                / f"{ref['sha256']}.json"
            ).as_posix()
            if ref["path"] != expected_path:
                raise SchemaError("provider LKG ref identity mismatch")
            try:
                payload_bytes = ref_path.read_bytes()
            except FileNotFoundError as exc:
                raise IntegrityError("provider LKG payload is missing") from exc
            try:
                _strict_json_loads(payload_bytes)
            except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
                raise IntegrityError("provider LKG payload is not strict JSON") from exc
            if hashlib.sha256(payload_bytes).hexdigest() != ref["sha256"]:
                raise IntegrityError("provider LKG payload digest mismatch")

    def _validate_generation(self, domain: str, transaction_id: str) -> dict[str, Any]:
        _safe_component(transaction_id, "transaction_id")
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
        }
        if required.difference(manifest):
            raise IntegrityError("generation manifest is incomplete")
        if manifest["schema_version"] != "data-supply-generation/v1":
            raise IntegrityError("unsupported generation manifest schema")
        if manifest["transaction_id"] != transaction_id or manifest["domain"] != domain:
            raise IntegrityError("generation manifest identity mismatch")
        if manifest["generations_retained"] != GENERATIONS_RETAINED:
            raise IntegrityError("generation retention bound mismatch")
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
        return {
            "transaction_id": transaction_id,
            "current": current,
            "lkg": lkg,
            "recovery": recovery,
            "decision": decision,
            "manifest": manifest,
            "manifest_sha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
        }

    def _read_active_domain_unlocked(self, domain: str) -> dict[str, Any]:
        domain_dir = self._domain_dir(domain)
        active_path = domain_dir / "active.json"
        if not active_path.exists():
            return self._empty_domain()
        active = self._read_json(active_path)
        if not isinstance(active, dict):
            raise IntegrityError("active pointer must be an object")
        required = {"schema_version", "domain", "transaction_id", "generation_manifest_sha256", "decision"}
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
        generation["active_decision"] = pointer_decision
        return generation

    def read_active_domain(self, domain: str) -> dict[str, Any]:
        domain_dir = self._domain_dir(domain)
        with self._lock(domain_dir / ".lock", shared=True):
            return self._read_active_domain_unlocked(domain)

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
        if not isinstance(candidate_observations, list) or not candidate_observations:
            raise SchemaError("candidate_observations must be a non-empty list")
        candidates = [validate_observation(row, require_valid=True) for row in candidate_observations]
        if any(row["domain"] != domain for row in candidates):
            raise SchemaError("candidate domain mismatch")
        for candidate in candidates:
            if not self._history_contains("observations", candidate["observed_at"], candidate):
                raise SchemaError("candidate observation must be recorded before promotion")
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
            candidate_by_id = {row["event_id"]: row for row in candidates}
            if any(candidate["entity"] != entity for candidate in candidates):
                raise SchemaError("candidate entity differs from transition entity")
            for name, selected in next_current.items():
                if prior_current.get(name) == selected:
                    continue
                candidate_id = selected.get("candidate_event_id")
                candidate = candidate_by_id.get(candidate_id)
                if candidate is None:
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
                "previous_selection_digest": previous_selection_digest,
                "new_selection_digest": new_selection_digest,
                "transition": transition,
                "reason_code": reason_code,
                "recovery_green_count": recovery_green_count,
            }
            decision["event_id"] = deterministic_event_id("resolution", decision)
            _validate_decision(decision)
            digest_payload = self._generation_digest_payload(
                domain=domain,
                current=next_current,
                lkg=next_lkg,
                recovery=next_recovery,
                decision=decision,
                previous_transaction_id=active["transaction_id"],
            )
            preparation_nonce = secrets.token_hex(16)
            transaction_id = canonical_sha256({"generation": digest_payload, "preparation_nonce": preparation_nonce})
            generation = domain_dir / "generations" / transaction_id
            if generation.exists():
                self._validate_generation(domain, transaction_id)
                return transaction_id
            self._ensure_directory(generation.parent)
            generation.mkdir(exist_ok=False)
            self._fsync_directory(generation.parent)

            members = (
                ("current.json", next_current, "after_write_current"),
                ("lkg.json", next_lkg, "after_write_lkg"),
                ("recovery.json", next_recovery, "after_write_recovery"),
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
                "previous_selection_digest": previous_selection_digest,
                "new_selection_digest": new_selection_digest,
                "members": member_digests,
                "generations_retained": GENERATIONS_RETAINED,
                "protected_generation_ids": protected,
                "preparation_nonce": preparation_nonce,
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

    def _active_pointer(self, domain: str, generation: Mapping[str, Any], decision: Mapping[str, Any]) -> dict[str, Any]:
        return {
            "schema_version": "data-supply-active/v1",
            "domain": domain,
            "transaction_id": generation["transaction_id"],
            "generation_manifest_sha256": generation["manifest_sha256"],
            "decision": dict(decision),
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
            committed_decision = self._bind_committed_transaction(
                generation["decision"], generation["transaction_id"]
            )
            pointer = self._active_pointer(domain, generation, committed_decision)
            self._atomic_write_json(domain_dir / "active.json", pointer, failpoint_prefix="active")
            self._failpoint("after_active_replace")
            self._failpoint("before_resolution_append")
            self._record_resolution(committed_decision)
            return self._read_active_domain_unlocked(domain)

    def recover_domain(self, domain: str) -> dict[str, Any]:
        domain = _safe_component(domain, "domain")
        domain_dir = self._domain_dir(domain)
        with self._lock(domain_dir / ".lock"):
            active = self._read_active_domain_unlocked(domain)
            if active["transaction_id"] is None:
                return active
            self._record_resolution(active["active_decision"])
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
                "previous_selection_digest": canonical_sha256(active["current"]),
                "new_selection_digest": canonical_sha256(target["current"]),
                "transition": "rollback",
                "reason_code": "operator_rollback",
                "recovery_green_count": 0,
                "transaction_id": target_transaction_id,
            }
            decision["event_id"] = deterministic_event_id("resolution", decision)
            _validate_decision(decision)
            pointer = self._active_pointer(domain, target, decision)
            self._atomic_write_json(domain_dir / "active.json", pointer, failpoint_prefix="active")
            self._failpoint("after_active_replace")
            self._failpoint("before_resolution_append")
            self._record_resolution(decision)
            return self._read_active_domain_unlocked(domain)

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
    "build_selection",
    "bind_selection_to_provider_lkg",
    "canonical_json_bytes",
    "canonical_sha256",
    "deterministic_event_id",
    "selection_age_status",
    "validate_observation",
]
