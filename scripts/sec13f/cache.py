#!/usr/bin/env python3
"""Immutable, content-addressed raw cache for SEC 13F filing documents."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
from typing import Any, Iterable, Mapping
from urllib.parse import urlsplit


SCHEMA_VERSION = "sec13f-raw-cache/v1"
REQUIRED_ROLES = frozenset({"primary", "information_table"})
CIK_PATTERN = re.compile(r"^\d{10}$")
ACCESSION_PATTERN = re.compile(r"^(\d{10})-\d{2}-\d{6}$")
ROLE_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
MANIFEST_KEYS = frozenset(
    {"schema_version", "cik", "accession", "documents", "content_digest"}
)
DOCUMENT_KEYS = frozenset({"role", "name", "url", "sha256", "bytes"})
PROJECT_ROOT = Path(__file__).resolve().parents[2]
PROTECTED_CACHE_ROOTS = (
    PROJECT_ROOT / "data" / "sec-13f",
    PROJECT_ROOT / "100xfenok-next" / "public" / "data" / "sec-13f",
)


class RawCacheError(RuntimeError):
    """A raw cache entry is unsafe, incomplete, corrupt, or immutable."""

    def __init__(
        self,
        reason: str,
        *,
        cik: str | None = None,
        accession: str | None = None,
        detail: str = "",
    ) -> None:
        self.reason = reason
        self.cik = cik
        self.accession = accession
        self.detail = detail
        message = ": ".join(part for part in (cik, accession, reason) if part)
        if detail:
            message = f"{message}: {detail}"
        super().__init__(message)


@dataclass(frozen=True)
class RawCacheRecord:
    path: Path
    manifest: dict[str, Any]
    documents: dict[str, bytes]


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
        allow_nan=False,
    ).encode("utf-8")


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _validate_identity(cik: str, accession: str) -> tuple[str, str]:
    if not isinstance(cik, str) or CIK_PATTERN.fullmatch(cik) is None:
        raise RawCacheError("invalid_cik", detail=str(cik))
    if not isinstance(accession, str):
        raise RawCacheError("invalid_accession", cik=cik, detail=str(accession))
    match = ACCESSION_PATTERN.fullmatch(accession)
    if match is None or match.group(1) != cik:
        raise RawCacheError("invalid_accession", cik=cik, accession=accession)
    return cik, accession


def _validate_name(name: Any, *, cik: str, accession: str) -> str:
    if (
        not isinstance(name, str)
        or not name
        or name in {".", ".."}
        or Path(name).name != name
        or "/" in name
        or "\\" in name
    ):
        raise RawCacheError(
            "invalid_document_name", cik=cik, accession=accession, detail=str(name)
        )
    return name


def _validate_url(url: Any, *, cik: str, accession: str) -> str:
    if not isinstance(url, str):
        raise RawCacheError("invalid_document_url", cik=cik, accession=accession)
    parsed = urlsplit(url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not host or not (host == "sec.gov" or host.endswith(".sec.gov")):
        raise RawCacheError(
            "invalid_document_url", cik=cik, accession=accession, detail=url
        )
    return url


def _validate_role(role: Any, *, cik: str, accession: str) -> str:
    if not isinstance(role, str) or ROLE_PATTERN.fullmatch(role) is None:
        raise RawCacheError(
            "invalid_document_role", cik=cik, accession=accession, detail=str(role)
        )
    return role


def _require_roles(roles: set[str], *, cik: str, accession: str) -> None:
    missing = sorted(REQUIRED_ROLES - roles)
    if missing:
        raise RawCacheError(
            "missing_required_document_role",
            cik=cik,
            accession=accession,
            detail=",".join(missing),
        )


def _manifest_for_documents(
    *,
    cik: str,
    accession: str,
    documents: Iterable[Mapping[str, Any]],
) -> tuple[dict[str, Any], dict[str, bytes]]:
    entries: list[dict[str, Any]] = []
    bodies: dict[str, bytes] = {}
    names: set[str] = set()
    for source in documents:
        if not isinstance(source, Mapping):
            raise RawCacheError("invalid_document", cik=cik, accession=accession)
        role = _validate_role(source.get("role"), cik=cik, accession=accession)
        name = _validate_name(source.get("name"), cik=cik, accession=accession)
        url = _validate_url(source.get("url"), cik=cik, accession=accession)
        content = source.get("content")
        if isinstance(content, bytearray):
            content = bytes(content)
        if not isinstance(content, bytes) or not content:
            raise RawCacheError(
                "invalid_document_content", cik=cik, accession=accession, detail=role
            )
        if role in bodies:
            raise RawCacheError(
                "duplicate_document_role", cik=cik, accession=accession, detail=role
            )
        if name in names:
            raise RawCacheError(
                "duplicate_document_name", cik=cik, accession=accession, detail=name
            )
        names.add(name)
        bodies[role] = content
        entries.append(
            {
                "role": role,
                "name": name,
                "url": url,
                "sha256": _sha256(content),
                "bytes": len(content),
            }
        )
    _require_roles(set(bodies), cik=cik, accession=accession)
    entries.sort(key=lambda row: (row["role"], row["name"], row["url"], row["sha256"]))
    unsigned: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "cik": cik,
        "accession": accession,
        "documents": entries,
    }
    return {
        **unsigned,
        "content_digest": _sha256(_canonical_bytes(unsigned)),
    }, bodies


def _write_file(path: Path, payload: bytes) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o444)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(payload)
            output.flush()
            os.fsync(output.fileno())
    except Exception:
        try:
            os.close(descriptor)
        except OSError:
            pass
        raise


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


class RawCache:
    """Store one immutable document set for each exact CIK/accession identity."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root).resolve()
        for protected in PROTECTED_CACHE_ROOTS:
            protected = protected.resolve()
            if self.root == protected or self.root in protected.parents or protected in self.root.parents:
                raise RawCacheError("cache_root_overlaps_protected_data", detail=str(self.root))

    def _entry_path(self, cik: str, accession: str) -> Path:
        return self.root / cik / accession

    def store(
        self,
        *,
        cik: str,
        accession: str,
        documents: Iterable[Mapping[str, Any]],
    ) -> RawCacheRecord:
        cik, accession = _validate_identity(cik, accession)
        manifest, bodies = _manifest_for_documents(
            cik=cik,
            accession=accession,
            documents=documents,
        )
        target = self._entry_path(cik, accession)
        if target.exists() or target.is_symlink():
            existing = self.load(cik=cik, accession=accession)
            if existing.manifest != manifest:
                raise RawCacheError(
                    "accession_content_drift", cik=cik, accession=accession
                )
            return existing

        parent = target.parent
        parent.mkdir(parents=True, exist_ok=True)
        if parent.is_symlink() or not parent.is_dir():
            raise RawCacheError("unsafe_cache_path", cik=cik, accession=accession)
        stage = Path(tempfile.mkdtemp(prefix=f".{accession}.tmp-", dir=parent))
        published = False
        try:
            objects = stage / "objects"
            objects.mkdir()
            by_digest = {entry["sha256"]: bodies[entry["role"]] for entry in manifest["documents"]}
            for digest, payload in sorted(by_digest.items()):
                _write_file(objects / digest, payload)
            _write_file(stage / "manifest.json", _canonical_bytes(manifest) + b"\n")
            _fsync_directory(objects)
            _fsync_directory(stage)
            try:
                os.rename(stage, target)
                published = True
                _fsync_directory(parent)
            except OSError as error:
                if target.exists() and not target.is_symlink():
                    existing = self.load(cik=cik, accession=accession)
                    if existing.manifest != manifest:
                        raise RawCacheError(
                            "accession_content_drift", cik=cik, accession=accession
                        ) from error
                    return existing
                raise RawCacheError(
                    "cache_write_failed",
                    cik=cik,
                    accession=accession,
                    detail=str(error),
                ) from error
        except RawCacheError:
            raise
        except Exception as error:
            raise RawCacheError(
                "cache_write_failed", cik=cik, accession=accession, detail=str(error)
            ) from error
        finally:
            if not published and stage.exists():
                shutil.rmtree(stage)
        return self.load(cik=cik, accession=accession)

    def load(self, *, cik: str, accession: str) -> RawCacheRecord:
        cik, accession = _validate_identity(cik, accession)
        entry = self._entry_path(cik, accession)
        if entry.is_symlink() or not entry.is_dir():
            raise RawCacheError("missing_cache_entry", cik=cik, accession=accession)
        manifest_path = entry / "manifest.json"
        if manifest_path.is_symlink() or not manifest_path.is_file():
            raise RawCacheError("missing_cache_manifest", cik=cik, accession=accession)
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise RawCacheError(
                "invalid_manifest", cik=cik, accession=accession, detail=str(error)
            ) from error
        if not isinstance(manifest, dict) or set(manifest) != MANIFEST_KEYS:
            raise RawCacheError("invalid_manifest", cik=cik, accession=accession)
        declared_digest = manifest.get("content_digest")
        unsigned = dict(manifest)
        unsigned.pop("content_digest")
        if (
            not isinstance(declared_digest, str)
            or SHA256_PATTERN.fullmatch(declared_digest) is None
            or declared_digest != _sha256(_canonical_bytes(unsigned))
        ):
            raise RawCacheError("manifest_digest_mismatch", cik=cik, accession=accession)
        if manifest.get("schema_version") != SCHEMA_VERSION:
            raise RawCacheError("unsupported_schema", cik=cik, accession=accession)
        if manifest.get("cik") != cik or manifest.get("accession") != accession:
            raise RawCacheError("manifest_identity_mismatch", cik=cik, accession=accession)

        declared_documents = manifest.get("documents")
        if not isinstance(declared_documents, list) or not declared_documents:
            raise RawCacheError("invalid_manifest", cik=cik, accession=accession)
        validated: list[dict[str, Any]] = []
        roles: set[str] = set()
        names: set[str] = set()
        for source in declared_documents:
            if not isinstance(source, dict) or set(source) != DOCUMENT_KEYS:
                raise RawCacheError("invalid_manifest", cik=cik, accession=accession)
            role = _validate_role(source.get("role"), cik=cik, accession=accession)
            name = _validate_name(source.get("name"), cik=cik, accession=accession)
            _validate_url(source.get("url"), cik=cik, accession=accession)
            digest = source.get("sha256")
            size = source.get("bytes")
            if (
                not isinstance(digest, str)
                or SHA256_PATTERN.fullmatch(digest) is None
                or isinstance(size, bool)
                or not isinstance(size, int)
                or size <= 0
            ):
                raise RawCacheError("invalid_manifest", cik=cik, accession=accession)
            if role in roles or name in names:
                raise RawCacheError("invalid_manifest", cik=cik, accession=accession)
            roles.add(role)
            names.add(name)
            validated.append(source)
        if validated != sorted(
            validated,
            key=lambda row: (row["role"], row["name"], row["url"], row["sha256"]),
        ):
            raise RawCacheError("invalid_manifest", cik=cik, accession=accession)
        _require_roles(roles, cik=cik, accession=accession)

        objects = entry / "objects"
        if objects.is_symlink() or not objects.is_dir():
            raise RawCacheError("missing_document_object", cik=cik, accession=accession)
        expected_objects = {source["sha256"] for source in validated}
        actual_objects = {
            path.name
            for path in objects.iterdir()
            if path.is_file() and not path.is_symlink()
        }
        if actual_objects - expected_objects:
            raise RawCacheError("undeclared_document_object", cik=cik, accession=accession)

        loaded: dict[str, bytes] = {}
        for source in validated:
            object_path = objects / source["sha256"]
            if object_path.is_symlink() or not object_path.is_file():
                raise RawCacheError(
                    "missing_document_object",
                    cik=cik,
                    accession=accession,
                    detail=source["role"],
                )
            payload = object_path.read_bytes()
            if len(payload) != source["bytes"]:
                raise RawCacheError(
                    "document_size_mismatch",
                    cik=cik,
                    accession=accession,
                    detail=source["role"],
                )
            if _sha256(payload) != source["sha256"]:
                raise RawCacheError(
                    "document_digest_mismatch",
                    cik=cik,
                    accession=accession,
                    detail=source["role"],
                )
            loaded[source["role"]] = payload
        return RawCacheRecord(path=entry, manifest=manifest, documents=loaded)
