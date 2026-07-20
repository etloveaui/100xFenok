#!/usr/bin/env python3
"""Transactional private run ledger for SEC 13F acquisition and generation."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
from typing import Any, Callable


RUN_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
HEX64_PATTERN = re.compile(r"^[0-9a-f]{64}$")
REQUIRED_DOCUMENT_FIELDS = (
    "investor_id",
    "cik",
    "accession",
    "form",
    "report_date",
    "filing_date",
    "amendment_type",
    "amendment_number",
    "component_order",
    "documents",
)
REQUIRED_BLOB_FIELDS = ("role", "name", "url", "sha256", "bytes", "cache_path")
REQUIRED_BLOB_ROLES = frozenset({"primary", "information_table"})
PROJECT_ROOT = Path(__file__).resolve().parents[2]
PROTECTED_STATE_ROOTS = (
    PROJECT_ROOT / "data" / "sec-13f",
    PROJECT_ROOT / "100xfenok-next" / "public" / "data" / "sec-13f",
)


class LedgerError(RuntimeError):
    """The private incremental state boundary is invalid."""


class RunFailure(RuntimeError):
    """A typed acquisition/generation failure that must block publication."""

    def __init__(
        self,
        kind: str,
        *,
        http_status: int | None = None,
        accession: str | None = None,
        detail: str = "",
    ) -> None:
        self.kind = kind
        self.http_status = http_status
        self.accession = accession
        self.detail = detail
        super().__init__(kind if not detail else f"{kind}: {detail}")


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
        allow_nan=False,
    ).encode("utf-8")


def _pretty_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        indent=2,
        sort_keys=False,
        allow_nan=False,
    ).encode("utf-8")


def _digest(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _atomic_write(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        with temporary.open("xb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def _safe_relative(value: Any, *, label: str) -> str:
    if not isinstance(value, str) or not value or value.startswith("/"):
        raise LedgerError(f"{label} must be a repository-relative path")
    normalized = Path(value)
    if ".." in normalized.parts or normalized.as_posix() in {"", "."}:
        raise LedgerError(f"{label} escapes its root")
    return normalized.as_posix()


def _validate_documents(rows: Any) -> list[dict[str, Any]]:
    if not isinstance(rows, list) or not rows:
        raise LedgerError("acquisition documents must be a non-empty list")
    output: list[dict[str, Any]] = []
    accession_keys: set[tuple[str, str]] = set()
    for index, row in enumerate(rows):
        if not isinstance(row, dict) or any(field not in row for field in REQUIRED_DOCUMENT_FIELDS):
            raise LedgerError(f"documents[{index}] is incomplete")
        cik = row["cik"]
        accession = row["accession"]
        if not isinstance(cik, str) or len(cik) != 10 or not cik.isdigit():
            raise LedgerError(f"documents[{index}].cik is invalid")
        if not isinstance(accession, str) or not accession:
            raise LedgerError(f"documents[{index}].accession is invalid")
        key = (cik, accession)
        if key in accession_keys:
            raise LedgerError(f"duplicate accession manifest: {cik}/{accession}")
        accession_keys.add(key)
        blobs = row["documents"]
        if not isinstance(blobs, list) or not blobs:
            raise LedgerError(f"documents[{index}].documents is empty")
        roles: set[str] = set()
        normalized_blobs = []
        for blob_index, blob in enumerate(blobs):
            if not isinstance(blob, dict) or any(field not in blob for field in REQUIRED_BLOB_FIELDS):
                raise LedgerError(f"documents[{index}].documents[{blob_index}] is incomplete")
            if blob["role"] in roles:
                raise LedgerError(f"duplicate document role: {cik}/{accession}/{blob['role']}")
            roles.add(blob["role"])
            if not isinstance(blob["sha256"], str) or HEX64_PATTERN.fullmatch(blob["sha256"]) is None:
                raise LedgerError(f"invalid document digest: {cik}/{accession}")
            if isinstance(blob["bytes"], bool) or not isinstance(blob["bytes"], int) or blob["bytes"] < 0:
                raise LedgerError(f"invalid document size: {cik}/{accession}")
            normalized = deepcopy(blob)
            normalized["cache_path"] = _safe_relative(blob["cache_path"], label="cache_path")
            normalized_blobs.append(normalized)
        if not REQUIRED_BLOB_ROLES.issubset(roles):
            raise LedgerError(f"documents[{index}] is missing required XML roles")
        normalized_row = deepcopy(row)
        normalized_row["documents"] = sorted(normalized_blobs, key=lambda item: (item["role"], item["name"]))
        output.append(normalized_row)
    return sorted(output, key=lambda item: (item["investor_id"], item["report_date"], item["filing_date"], item["component_order"], item["accession"]))


@dataclass(frozen=True)
class AcquisitionSnapshot:
    registry_digest: str
    investor_data: dict[str, Any]
    documents: list[dict[str, Any]]

    def validated(self) -> dict[str, Any]:
        if not isinstance(self.registry_digest, str) or HEX64_PATTERN.fullmatch(self.registry_digest) is None:
            raise LedgerError("registry_digest must be sha256")
        if not isinstance(self.investor_data, dict) or not self.investor_data:
            raise LedgerError("investor_data must be a non-empty mapping")
        investor_data = deepcopy(self.investor_data)
        documents = _validate_documents(self.documents)
        investor_digest = _digest(_pretty_bytes(investor_data))
        source_set = {
            "registry_digest": self.registry_digest,
            "investor_data_digest": investor_digest,
            "documents": documents,
        }
        return {
            **source_set,
            "investor_data": investor_data,
            "source_set_digest": _digest(_canonical_bytes(source_set)),
        }


def _failure_payload(error: Exception) -> dict[str, Any]:
    kind = getattr(error, "kind", None) or getattr(error, "reason", None)
    if not isinstance(kind, str) or not kind:
        kind = "incremental_run_failed"
    status = getattr(error, "http_status", None)
    accession = getattr(error, "accession", None)
    return {
        "kind": kind,
        "http_status": status if isinstance(status, int) else None,
        "accession": accession if isinstance(accession, str) else None,
        "detail": str(error),
    }


def _completion(documents: list[dict[str, Any]]) -> dict[str, list[str]]:
    completed: dict[str, list[str]] = {}
    for row in documents:
        key = f"{row['investor_id']}/{row['report_date']}"
        completed.setdefault(key, []).append(row["accession"])
    return {key: sorted(values) for key, values in sorted(completed.items())}


class IncrementalLedger:
    """Publish verified immutable runs by atomically replacing one state file."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root).resolve()
        for protected in PROTECTED_STATE_ROOTS:
            protected = protected.resolve()
            if self.root == protected or self.root in protected.parents or protected in self.root.parents:
                raise LedgerError(f"ledger root overlaps protected data tree: {self.root}")
        self.attempts_root = self.root / "attempts"
        self.staging_root = self.root / "staging"
        self.runs_root = self.root / "runs"
        self.state_path = self.root / "state.json"

    def _attempt_path(self, run_id: str) -> Path:
        if not isinstance(run_id, str) or RUN_ID_PATTERN.fullmatch(run_id) is None:
            raise LedgerError("run_id is unsafe")
        return self.attempts_root / f"{run_id}.json"

    def _write_attempt(self, run_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        row = {
            "schema_version": "sec13f-attempt/v1",
            "run_id": run_id,
            **payload,
        }
        _atomic_write(self._attempt_path(run_id), _pretty_bytes(row) + b"\n")
        return row

    def _current_state(self) -> dict[str, Any] | None:
        if not self.state_path.exists():
            return None
        try:
            value = json.loads(self.state_path.read_text(encoding="utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise LedgerError(f"state is corrupt: {error}") from error
        if not isinstance(value, dict) or value.get("schema_version") != "sec13f-active-state/v1":
            raise LedgerError("state schema is invalid")
        return value

    def _load_verified_run(self, run_root: Path, source_set_digest: str) -> dict[str, Any]:
        try:
            run_manifest = json.loads((run_root / "run-manifest.json").read_text(encoding="utf-8"))
            generation_manifest = json.loads(
                (run_root / "generation-manifest.json").read_text(encoding="utf-8")
            )
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise RunFailure("verified_run_manifest_corrupt", detail=str(error)) from error
        if (
            not isinstance(run_manifest, dict)
            or run_manifest.get("schema_version") != "sec13f-run-manifest/v1"
            or run_manifest.get("status") != "verified"
            or run_manifest.get("publish_blocked") is not False
            or run_manifest.get("source_set_digest") != source_set_digest
        ):
            raise RunFailure("verified_run_manifest_corrupt")
        declared = run_manifest.get("run_manifest_digest")
        unsigned = dict(run_manifest)
        unsigned.pop("run_manifest_digest", None)
        if declared != _digest(_canonical_bytes(unsigned)):
            raise RunFailure("verified_run_manifest_digest_mismatch")
        if run_manifest.get("generation_manifest_digest") != _digest(_pretty_bytes(generation_manifest)):
            raise RunFailure("generation_manifest_digest_mismatch")
        output_root = run_root / "outputs"
        self._verify_generation(
            output_root,
            generation_manifest,
            run_manifest.get("investor_data_digest"),
        )
        if run_manifest.get("output_tree_digest") != self._output_tree_digest(output_root):
            raise RunFailure("generation_output_digest_mismatch")
        return run_manifest

    def recover_abandoned_runs(self) -> list[str]:
        """Close interrupted attempts without mutating the active/LKG pointer."""

        if not self.attempts_root.exists():
            return []
        recovered: list[str] = []
        state = self._current_state() or {}
        active_digest = ((state.get("current") or {}).get("source_set_digest"))
        for path in sorted(self.attempts_root.glob("*.json")):
            try:
                row = json.loads(path.read_text(encoding="utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as error:
                raise LedgerError(f"attempt is corrupt: {path.name}: {error}") from error
            if row.get("status") not in {"running", "acquired", "generated"}:
                continue
            run_id = row.get("run_id")
            if not isinstance(run_id, str) or self._attempt_path(run_id) != path:
                raise LedgerError(f"attempt identity is invalid: {path.name}")
            source_digest = row.get("source_set_digest")
            if isinstance(source_digest, str) and source_digest == active_digest:
                payload = {
                    "status": "published_recovered",
                    "publish_blocked": False,
                    "source_set_digest": source_digest,
                }
            else:
                payload = {
                    "status": "blocked",
                    "publish_blocked": True,
                    "source_set_digest": source_digest if isinstance(source_digest, str) else None,
                    "failure": {
                        "kind": "abandoned_run",
                        "http_status": None,
                        "accession": None,
                        "detail": "interrupted before atomic state publication",
                    },
                }
            self._write_attempt(run_id, payload)
            recovered.append(run_id)
        return recovered

    @staticmethod
    def _verify_generation(output_root: Path, manifest: dict[str, Any], investor_digest: str) -> None:
        if (
            not isinstance(manifest, dict)
            or manifest.get("schema_version") != "sec13f-base-generation/v1"
            or manifest.get("output_count") != 73
            or manifest.get("investor_count") != 60
            or manifest.get("investor_data_digest") != investor_digest
        ):
            raise RunFailure("generation_manifest_invalid")
        entries = manifest.get("entries")
        if not isinstance(entries, list) or len(entries) != 73:
            raise RunFailure("generation_manifest_invalid")
        seen: set[str] = set()
        for entry in entries:
            relative = _safe_relative(entry.get("path"), label="generated path") if isinstance(entry, dict) else ""
            if relative in seen:
                raise RunFailure("generation_manifest_invalid", detail=f"duplicate {relative}")
            seen.add(relative)
            path = (output_root / relative).resolve()
            if output_root.resolve() not in path.parents or not path.is_file():
                raise RunFailure("generation_output_missing", detail=relative)
            payload = path.read_bytes()
            if len(payload) != entry.get("bytes") or _digest(payload) != entry.get("sha256"):
                raise RunFailure("generation_output_digest_mismatch", detail=relative)
        actual = {
            path.relative_to(output_root).as_posix()
            for path in output_root.rglob("*.json")
            if path.is_file()
        }
        if actual != seen:
            raise RunFailure("generation_output_boundary_mismatch")

    @staticmethod
    def _output_tree_digest(output_root: Path) -> str:
        rows = []
        for path in sorted(item for item in output_root.rglob("*") if item.is_file()):
            rows.append({
                "path": path.relative_to(output_root).as_posix(),
                "sha256": _digest(path.read_bytes()),
                "bytes": path.stat().st_size,
            })
        return _digest(_canonical_bytes(rows))

    def execute(
        self,
        *,
        run_id: str,
        acquire: Callable[[], AcquisitionSnapshot],
        generate: Callable[[dict[str, Any], Path], dict[str, Any]],
        failpoint: str | None = None,
        verify: Callable[[Path, dict[str, Any]], None] | None = None,
    ) -> dict[str, Any]:
        attempt_path = self._attempt_path(run_id)
        if attempt_path.exists():
            raise LedgerError(f"run_id already exists: {run_id}")
        self._write_attempt(run_id, {"status": "running", "publish_blocked": True})
        source_set_digest: str | None = None
        try:
            snapshot_value = acquire()
            if not isinstance(snapshot_value, AcquisitionSnapshot):
                raise RunFailure("invalid_acquisition_snapshot")
            snapshot = snapshot_value.validated()
            source_set_digest = snapshot["source_set_digest"]
            self._write_attempt(run_id, {
                "status": "acquired",
                "publish_blocked": True,
                "source_set_digest": source_set_digest,
            })
            if failpoint == "after_acquisition":
                raise RunFailure("simulated_crash", detail=failpoint)

            run_root = self.runs_root / source_set_digest
            existing_manifest = run_root / "run-manifest.json"
            if existing_manifest.is_file():
                verified = self._load_verified_run(run_root, source_set_digest)
                pointer = {
                    "source_set_digest": source_set_digest,
                    "run_manifest_digest": verified["run_manifest_digest"],
                    "run_root": run_root.relative_to(self.root).as_posix(),
                }
                current_state = self._current_state() or {}
                current = current_state.get("current") or {}
                if current.get("source_set_digest") == source_set_digest:
                    status = "replayed"
                else:
                    current_lkg_digest = (current_state.get("lkg") or {}).get("run_manifest_digest")
                    if verified.get("previous_lkg_digest") != current_lkg_digest:
                        raise RunFailure("stale_verified_run")
                    _atomic_write(
                        self.state_path,
                        _pretty_bytes({
                            "schema_version": "sec13f-active-state/v1",
                            "current": pointer,
                            "lkg": pointer,
                        }) + b"\n",
                    )
                    status = "published_recovered"
                result = {
                    "status": status,
                    "publish_blocked": False,
                    **pointer,
                }
                self._write_attempt(run_id, result)
                return result

            candidate = self.staging_root / run_id
            if candidate.exists():
                raise RunFailure("staging_collision")
            output_root = candidate / "outputs"
            output_root.mkdir(parents=True)
            generation_manifest = generate(deepcopy(snapshot["investor_data"]), output_root)
            self._verify_generation(output_root, generation_manifest, snapshot["investor_data_digest"])
            if verify is not None:
                verify(output_root, deepcopy(generation_manifest))

            generation_manifest_digest = _digest(_pretty_bytes(generation_manifest))
            run_manifest = {
                "schema_version": "sec13f-run-manifest/v1",
                "status": "verified",
                "publish_blocked": False,
                "registry_digest": snapshot["registry_digest"],
                "source_set_digest": source_set_digest,
                "previous_lkg_digest": (
                    ((self._current_state() or {}).get("lkg") or {}).get("run_manifest_digest")
                ),
                "documents": snapshot["documents"],
                "completion": _completion(snapshot["documents"]),
                "investor_data_digest": snapshot["investor_data_digest"],
                "generation_manifest_digest": generation_manifest_digest,
                "output_tree_digest": self._output_tree_digest(output_root),
            }
            unsigned_digest = _digest(_canonical_bytes(run_manifest))
            run_manifest["run_manifest_digest"] = unsigned_digest
            _atomic_write(candidate / "generation-manifest.json", _pretty_bytes(generation_manifest) + b"\n")
            _atomic_write(candidate / "run-manifest.json", _pretty_bytes(run_manifest) + b"\n")
            self._write_attempt(run_id, {
                "status": "generated",
                "publish_blocked": True,
                "source_set_digest": source_set_digest,
            })
            if failpoint == "after_generation":
                raise RunFailure("simulated_crash", detail=failpoint)

            self.runs_root.mkdir(parents=True, exist_ok=True)
            os.replace(candidate, run_root)
            if failpoint == "after_run_publish":
                raise RunFailure("simulated_crash", detail=failpoint)
            pointer = {
                "source_set_digest": source_set_digest,
                "run_manifest_digest": unsigned_digest,
                "run_root": run_root.relative_to(self.root).as_posix(),
            }
            state = {
                "schema_version": "sec13f-active-state/v1",
                "current": pointer,
                "lkg": pointer,
            }
            _atomic_write(self.state_path, _pretty_bytes(state) + b"\n")
            result = {
                "status": "published",
                "publish_blocked": False,
                "source_set_digest": source_set_digest,
                "run_root": pointer["run_root"],
                "run_manifest_digest": unsigned_digest,
            }
            self._write_attempt(run_id, result)
            return result
        except Exception as error:
            failure = _failure_payload(error)
            result = {
                "status": "blocked",
                "publish_blocked": True,
                "source_set_digest": source_set_digest,
                "failure": failure,
            }
            self._write_attempt(run_id, result)
            return result


__all__ = ["AcquisitionSnapshot", "IncrementalLedger", "LedgerError", "RunFailure"]
