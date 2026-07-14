#!/usr/bin/env python3
"""Fail-closed R2.3 migration for legacy Yahoo payloads in StockAnalysis paths."""

from __future__ import annotations

import argparse
import copy
import datetime as dt
import hashlib
import importlib.util
import json
import os
import tempfile
from pathlib import Path, PurePosixPath
from typing import Any, Callable, Mapping

from data_supply_state import (
    ETF_DETAIL_EMERGENCY_LKG_TTL_DAYS,
    ETF_DETAIL_FRESH_TTL_HOURS,
    DataSupplyStateStore,
    IntegrityError,
    SchemaError,
    build_selection,
    canonical_json_bytes,
    canonical_sha256,
    deterministic_event_id,
)


IDENTITY_PROOF = "legacy_wrapper_filename_manifest"
MIGRATION_SCHEMA = "data-supply-migration/v1"


class MinimumDetailUnavailable(SchemaError):
    """Historical Yahoo identity is valid but no selectable detail exists."""

    reason_code = "migration_minimum_detail_missing"


class SourceDateUnavailable(SchemaError):
    """Historical Yahoo payload is usable but carries no provider observation date."""

    reason_code = "migration_source_date_unavailable"


def _parse_timestamp(value: str, field: str) -> dt.datetime:
    if not isinstance(value, str) or not value:
        raise SchemaError(f"{field} must be a timestamp")
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        parsed = dt.datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise SchemaError(f"{field} is malformed") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise SchemaError(f"{field} must include a timezone")
    return parsed.astimezone(dt.timezone.utc)


def _yahoo_raw_source_timestamp(raw: Mapping[str, Any]) -> str | None:
    data = raw.get("data") if isinstance(raw.get("data"), Mapping) else {}
    info = data.get("info") if isinstance(data.get("info"), Mapping) else {}
    epoch = info.get("regularMarketTime")
    if isinstance(epoch, (int, float)) and not isinstance(epoch, bool):
        try:
            parsed = dt.datetime.fromtimestamp(float(epoch), dt.timezone.utc)
        except (OverflowError, OSError, ValueError):
            parsed = None
        if parsed is not None:
            return parsed.isoformat().replace("+00:00", "Z")
    dates: list[dt.date] = []
    for row in data.get("history_1y") if isinstance(data.get("history_1y"), list) else []:
        if not isinstance(row, Mapping):
            continue
        value = row.get("date")
        if not isinstance(value, str):
            continue
        try:
            dates.append(dt.date.fromisoformat(value[:10]))
        except ValueError:
            continue
    return f"{max(dates).isoformat()}T00:00:00Z" if dates else None


def _safe_relative_path(value: str) -> str:
    if not isinstance(value, str) or not value or "\\" in value or "\x00" in value:
        raise SchemaError("migration path must be repository-relative")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise SchemaError("migration path must be repository-relative")
    return path.as_posix()


def _pretty_json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")


def _strict_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"), parse_constant=lambda token: (_ for _ in ()).throw(ValueError(token)))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        raise IntegrityError(f"invalid JSON: {path}") from exc
    if not isinstance(value, dict):
        raise IntegrityError(f"JSON root must be an object: {path}")
    return value


def _fsync_directory(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _atomic_write(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temp_path = Path(temp_name)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
        _fsync_directory(path.parent)
    finally:
        if temp_path.exists():
            temp_path.unlink()


def _load_default_normalizer() -> Callable[[str, dict[str, Any]], dict[str, Any]]:
    fetcher_path = Path(__file__).resolve().with_name("fetch-stockanalysis.py")
    spec = importlib.util.spec_from_file_location("r2_3_migration_stockanalysis", fetcher_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load StockAnalysis normalizer")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.yahoo_etf_payload


class LegacyYahooMigration:
    def __init__(
        self,
        repo_root: Path | str,
        state_root: Path | str,
        *,
        normalizer: Callable[[str, dict[str, Any]], dict[str, Any]] | None = None,
    ):
        self.repo_root = Path(repo_root).expanduser().resolve()
        self.state_root = Path(state_root).expanduser().resolve(strict=False)
        self.normalizer = normalizer or _load_default_normalizer()

    def _repo_path(self, relative: str) -> Path:
        relative = _safe_relative_path(relative)
        path = (self.repo_root / relative).resolve(strict=False)
        try:
            path.relative_to(self.repo_root)
        except ValueError as exc:
            raise SchemaError("migration path escapes repository root") from exc
        return path

    def _identity_payloads(
        self,
        *,
        entity: str,
        legacy_path: Path,
        raw_path: Path,
    ) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
        legacy = _strict_json(legacy_path)
        raw = _strict_json(raw_path)
        if (
            legacy_path.stem != entity
            or raw_path.stem != entity
            or legacy.get("ticker") != entity
            or raw.get("ticker") != entity
            or legacy.get("source") != "yahoo_finance"
            or legacy.get("source_provider") != "yahoo_finance"
        ):
            raise SchemaError(f"legacy identity disagreement: {entity}")
        data = raw.get("data")
        if not isinstance(data, dict):
            raise SchemaError(f"Yahoo raw data container is invalid: {entity}")
        info = data.get("info") or {}
        funds_data = data.get("funds_data") or {}
        if not isinstance(info, dict) or not isinstance(funds_data, dict):
            raise SchemaError(f"Yahoo raw identity containers are invalid: {entity}")
        returned_symbols = [value for value in (info.get("symbol"), funds_data.get("symbol")) if value]
        if any(str(value).upper() != entity for value in returned_symbols):
            raise SchemaError(f"Yahoo provider symbol disagrees with manifest identity: {entity}")
        quote_type = str(info.get("quoteType") or funds_data.get("quote_type") or "").upper()
        if quote_type not in {"ETF", "MUTUALFUND"}:
            raise SchemaError(f"Yahoo fund type is invalid: {entity}")
        injected = copy.deepcopy(raw)
        injected["data"]["info"]["symbol"] = entity
        return legacy, raw, injected

    def _normalize_entry(
        self,
        *,
        entity: str,
        legacy_path: Path,
        raw_path: Path,
    ) -> tuple[dict[str, Any], dict[str, Any], bytes]:
        legacy, raw, injected = self._identity_payloads(
            entity=entity,
            legacy_path=legacy_path,
            raw_path=raw_path,
        )
        try:
            normalized = self.normalizer(entity, injected)
        except (TypeError, ValueError) as exc:
            if str(exc) == "Yahoo fallback does not satisfy the minimum ETF detail contract":
                raise MinimumDetailUnavailable(
                    f"Yahoo minimum detail is unavailable for {entity}"
                ) from exc
            raise SchemaError(f"Yahoo normalization failed for {entity}: {exc}") from exc
        if (
            normalized.get("schema_version") != "yf-etf-detail/v1"
            or normalized.get("source_provider") != "yahoo_finance"
            or normalized.get("ticker") != entity
        ):
            raise SchemaError(f"normalized Yahoo identity is invalid: {entity}")
        provider_source_as_of = _yahoo_raw_source_timestamp(raw)
        if provider_source_as_of is None:
            raise SourceDateUnavailable(f"Yahoo provider source date is unavailable: {entity}")
        source_as_of = normalized.get("source_as_of")
        if _parse_timestamp(source_as_of, f"{entity} source_as_of") != _parse_timestamp(
            provider_source_as_of,
            f"{entity} provider source_as_of",
        ):
            raise SchemaError(f"normalized Yahoo source stamp disagrees with provider evidence: {entity}")
        normalized_bytes = _pretty_json_bytes(normalized)
        return legacy, raw, normalized_bytes

    def plan(self, *, expected_count: int, created_at: str) -> dict[str, Any]:
        _parse_timestamp(created_at, "created_at")
        legacy_root = self.repo_root / "data/stockanalysis/etfs"
        entries: list[dict[str, Any]] = []
        for legacy_path in sorted(legacy_root.glob("*.json")):
            legacy = _strict_json(legacy_path)
            if legacy.get("source_provider") != "yahoo_finance":
                continue
            entity = legacy_path.stem
            raw_path = self.repo_root / "data/yf/finance" / f"{entity}.json"
            if not raw_path.is_file():
                raise IntegrityError(f"matching Yahoo raw file is missing: {entity}")
            legacy_sha = hashlib.sha256(legacy_path.read_bytes()).hexdigest()
            common = {
                "entity": entity,
                "legacy_path": legacy_path.relative_to(self.repo_root).as_posix(),
                "raw_path": raw_path.relative_to(self.repo_root).as_posix(),
                "legacy_sha256": legacy_sha,
                "raw_sha256": hashlib.sha256(raw_path.read_bytes()).hexdigest(),
                "identity_proof": IDENTITY_PROOF,
            }
            try:
                _, _, normalized_bytes = self._normalize_entry(
                    entity=entity,
                    legacy_path=legacy_path,
                    raw_path=raw_path,
                )
            except (MinimumDetailUnavailable, SourceDateUnavailable) as exc:
                self._identity_payloads(
                    entity=entity,
                    legacy_path=legacy_path,
                    raw_path=raw_path,
                )
                entries.append(
                    {
                        **common,
                        "migration_action": "invalid_unavailable",
                        "reason_code": exc.reason_code,
                        "evidence_path": f"data/yf/migration-evidence/etf-details/{entity}-{legacy_sha}.json",
                    }
                )
                continue
            normalized_sha = hashlib.sha256(normalized_bytes).hexdigest()
            object_path = f"providers/yahoo_finance/etf_detail/objects/{entity}/{normalized_sha}.json"
            entries.append(
                {
                    **common,
                    "migration_action": "valid_candidate",
                    "normalized_path": f"data/yf/etf-details/{entity}.json",
                    "normalized_sha256": normalized_sha,
                    "provider_object_path": object_path,
                }
            )
        if len(entries) != expected_count:
            raise IntegrityError(
                f"legacy migration count mismatch: expected={expected_count} actual={len(entries)}"
            )
        migration_id = canonical_sha256(
            {
                "schema_version": MIGRATION_SCHEMA,
                "domain": "etf_detail",
                "created_at": created_at,
                "entries": entries,
            }
        )
        return {
            "schema_version": MIGRATION_SCHEMA,
            "migration_id": migration_id,
            "domain": "etf_detail",
            "created_at": created_at,
            "expected_count": expected_count,
            "identity_proof": IDENTITY_PROOF,
            "payload_refs": [
                {"path": entry["provider_object_path"], "sha256": entry["normalized_sha256"]}
                for entry in entries
                if entry["migration_action"] == "valid_candidate"
            ],
            "entries": entries,
        }

    def _validate_manifest(self, manifest: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(manifest, Mapping):
            raise SchemaError("migration manifest must be an object")
        row = dict(manifest)
        required = {
            "schema_version",
            "migration_id",
            "domain",
            "created_at",
            "expected_count",
            "identity_proof",
            "payload_refs",
            "entries",
        }
        if required.difference(row):
            raise SchemaError("migration manifest is incomplete")
        if (
            row["schema_version"] != MIGRATION_SCHEMA
            or row["domain"] != "etf_detail"
            or row["identity_proof"] != IDENTITY_PROOF
            or not isinstance(row["entries"], list)
            or not isinstance(row["payload_refs"], list)
            or row["expected_count"] != len(row["entries"])
            or len(row["entries"]) > 718
        ):
            raise SchemaError("migration manifest contract mismatch")
        expected_id = canonical_sha256(
            {
                "schema_version": MIGRATION_SCHEMA,
                "domain": "etf_detail",
                "created_at": row["created_at"],
                "entries": row["entries"],
            }
        )
        if row["migration_id"] != expected_id:
            raise IntegrityError("migration manifest digest mismatch")
        actions = [entry.get("migration_action") if isinstance(entry, Mapping) else None for entry in row["entries"]]
        if any(action not in {"valid_candidate", "invalid_unavailable"} for action in actions):
            raise SchemaError("migration entry action is invalid")
        if any(
            entry.get("reason_code")
            not in {"migration_minimum_detail_missing", "migration_source_date_unavailable"}
            for entry in row["entries"]
            if entry.get("migration_action") == "invalid_unavailable"
        ):
            raise SchemaError("migration invalid entry reason is unsupported")
        expected_refs = [
            {"path": entry["provider_object_path"], "sha256": entry["normalized_sha256"]}
            for entry in row["entries"]
            if entry["migration_action"] == "valid_candidate"
        ]
        if row["payload_refs"] != expected_refs:
            raise IntegrityError("migration payload refs differ from valid entries")
        if row["expected_count"] == 718 and (
            actions.count("valid_candidate") != 717
            or actions.count("invalid_unavailable") != 1
        ):
            raise IntegrityError("718-entry migration must contain the approved 717+1 disposition")
        return row

    def _preflight_sources(self, manifest: Mapping[str, Any], *, allow_missing: bool) -> None:
        for entry in manifest["entries"]:
            if not isinstance(entry, Mapping) or entry.get("identity_proof") != IDENTITY_PROOF:
                raise SchemaError("migration entry identity proof is missing")
            entity = entry.get("entity")
            if not isinstance(entity, str) or not entity:
                raise SchemaError("migration entry entity is invalid")
            legacy_path = self._repo_path(entry["legacy_path"])
            raw_path = self._repo_path(entry["raw_path"])
            if not legacy_path.exists():
                if allow_missing:
                    continue
                raise IntegrityError(f"migration source is missing: {entity}")
            if hashlib.sha256(legacy_path.read_bytes()).hexdigest() != entry["legacy_sha256"]:
                raise IntegrityError(f"migration source digest changed: {entity}")
            if not raw_path.is_file() or hashlib.sha256(raw_path.read_bytes()).hexdigest() != entry["raw_sha256"]:
                raise IntegrityError(f"Yahoo raw digest changed: {entity}")
            if entry["migration_action"] == "invalid_unavailable":
                self._identity_payloads(
                    entity=entity,
                    legacy_path=legacy_path,
                    raw_path=raw_path,
                )
                try:
                    self._normalize_entry(
                        entity=entity,
                        legacy_path=legacy_path,
                        raw_path=raw_path,
                    )
                except (MinimumDetailUnavailable, SourceDateUnavailable) as exc:
                    if entry.get("reason_code") != exc.reason_code:
                        raise IntegrityError(f"approved invalid reason changed: {entity}") from exc
                else:
                    raise IntegrityError(f"approved invalid entry became selectable: {entity}")
                continue
            legacy, _, normalized_bytes = self._normalize_entry(
                entity=entity,
                legacy_path=legacy_path,
                raw_path=raw_path,
            )
            if legacy.get("ticker") != entity or hashlib.sha256(normalized_bytes).hexdigest() != entry["normalized_sha256"]:
                raise IntegrityError(f"migration normalization changed: {entity}")

    def _failure_observation(self, *, entity: str, decided_at: str) -> dict[str, Any]:
        failure_detail_sha = hashlib.sha256(b"legacy StockAnalysis primary missing").hexdigest()
        descriptor = {
            "provider": "stockanalysis",
            "endpoint_family": "stockanalysis_etf_detail",
            "domain": "etf_detail",
            "entity": entity,
            "observed_at": decided_at,
            "reason_code": "legacy_primary_missing",
            "failure_detail_sha256": failure_detail_sha,
        }
        row = {
            "schema_version": "data-supply-observation/v1",
            **{key: descriptor[key] for key in ("provider", "endpoint_family", "domain", "entity")},
            "provider_path": f"data/stockanalysis/etfs/{entity}.json",
            "payload_sha256": canonical_sha256(descriptor),
            "provider_schema": "stockanalysis/v1",
            "source_as_of": None,
            "observed_at": decided_at,
            "validation_status": "invalid",
            "reason_code": descriptor["reason_code"],
            "observation_origin": "migration",
            "payload_available": False,
            "failure_detail_sha256": failure_detail_sha,
        }
        row["event_id"] = deterministic_event_id("observation", row)
        return row

    def _invalid_yahoo_observation(
        self,
        *,
        entry: Mapping[str, Any],
        decided_at: str,
    ) -> dict[str, Any]:
        entity = entry["entity"]
        reason_code = entry["reason_code"]
        failure_detail = (
            "historical Yahoo payload lacks minimum ETF detail"
            if reason_code == "migration_minimum_detail_missing"
            else "historical Yahoo payload has no provider observation date"
        )
        failure_detail_sha = hashlib.sha256(failure_detail.encode("utf-8")).hexdigest()
        descriptor = {
            "provider": "yahoo_finance",
            "endpoint_family": "yahoo_finance_etf_detail",
            "domain": "etf_detail",
            "entity": entity,
            "observed_at": decided_at,
            "reason_code": reason_code,
            "failure_detail_sha256": failure_detail_sha,
        }
        row = {
            "schema_version": "data-supply-observation/v1",
            **{key: descriptor[key] for key in ("provider", "endpoint_family", "domain", "entity")},
            "provider_path": entry["raw_path"],
            "payload_sha256": canonical_sha256(descriptor),
            "provider_schema": "yf-etf-detail/v1",
            "source_as_of": None,
            "observed_at": decided_at,
            "validation_status": "invalid",
            "reason_code": descriptor["reason_code"],
            "observation_origin": "migration",
            "payload_available": False,
            "failure_detail_sha256": failure_detail_sha,
        }
        row["event_id"] = deterministic_event_id("observation", row)
        return row

    def _migrate_invalid_unavailable(
        self,
        *,
        store: DataSupplyStateStore,
        entry: Mapping[str, Any],
        decided_at: str,
    ) -> str:
        entity = entry["entity"]
        primary_failure = self._failure_observation(entity=entity, decided_at=decided_at)
        yahoo_failure = self._invalid_yahoo_observation(entry=entry, decided_at=decided_at)
        store.record_observation(primary_failure)
        store.record_observation(yahoo_failure)
        active = store.read_active_domain("etf_detail")
        if (
            entity not in active["current"]
            and active["recovery"].get(entity, {}).get("last_transition") == "unavailable"
        ):
            return "unavailable"
        transaction_id = store.prepare_unavailable_transition(
            domain="etf_detail",
            entity=entity,
            evidence_observations=[primary_failure, yahoo_failure],
            expected_active_transaction_id=active["transaction_id"],
            reason_code=entry["reason_code"],
            decided_at=decided_at,
        )
        store.commit_prepared("etf_detail", transaction_id)
        return "unavailable"

    def _migrate_state(
        self,
        *,
        store: DataSupplyStateStore,
        entry: Mapping[str, Any],
        normalized: Mapping[str, Any],
        normalized_bytes: bytes,
        decided_at: str,
    ) -> str:
        entity = entry["entity"]
        active = store.read_active_domain("etf_detail")
        existing = active["current"].get(entity)
        if existing is not None and existing["payload_sha256"] == entry["normalized_sha256"]:
            object_path = self.state_root / entry["provider_object_path"]
            if object_path.is_file() and hashlib.sha256(object_path.read_bytes()).hexdigest() == entry["normalized_sha256"]:
                return existing["resolution_state"]
        if (
            existing is None
            and active["recovery"].get(entity, {}).get("last_transition") == "unavailable"
            and (self.state_root / entry["provider_object_path"]).is_file()
        ):
            return "unavailable"
        observation = {
            "schema_version": "data-supply-observation/v1",
            "provider": "yahoo_finance",
            "endpoint_family": "yahoo_finance_etf_detail",
            "domain": "etf_detail",
            "entity": entity,
            "provider_path": entry["normalized_path"],
            "payload_sha256": entry["normalized_sha256"],
            "provider_schema": "yf-etf-detail/v1",
            "source_as_of": normalized["source_as_of"],
            "observed_at": decided_at,
            "validation_status": "valid",
            "reason_code": "legacy_migration_valid",
            "observation_origin": "migration",
        }
        observation["event_id"] = deterministic_event_id("observation", observation)
        ref = store.store_provider_object(observation=observation, payload=normalized_bytes)
        store.record_observation(observation)
        primary_failure = self._failure_observation(entity=entity, decided_at=decided_at)
        store.record_observation(primary_failure)
        active = store.read_active_domain("etf_detail")

        age_seconds = int(
            (_parse_timestamp(decided_at, "decided_at") - _parse_timestamp(normalized["source_as_of"], "source_as_of")).total_seconds()
        )
        if age_seconds < 0:
            raise SchemaError(f"migration source stamp follows decision time: {entity}")
        if age_seconds <= ETF_DETAIL_FRESH_TTL_HOURS * 3600:
            selected = build_selection(
                observation,
                selected_at=decided_at,
                resolution_state="fresh_fallback",
                reason_code="legacy_migration_fallback_fresh",
                fallback_depth=1,
                payload_ref_kind="provider_object",
                payload_ref_path=ref["path"],
            )
            state = "fresh_fallback"
        elif age_seconds <= ETF_DETAIL_EMERGENCY_LKG_TTL_DAYS * 86400:
            latest_path = self.state_root / f"providers/yahoo_finance/etf_detail/lkg/{entity}/latest.json"
            expected_latest = _strict_json(latest_path)["sha256"] if latest_path.exists() else None
            lkg_ref = store.store_provider_lkg(
                provider="yahoo_finance",
                domain="etf_detail",
                entity=entity,
                payload=normalized_bytes,
                meaningful_transition=True,
                expected_latest_sha256=expected_latest,
            )
            selected = build_selection(
                observation,
                selected_at=decided_at,
                resolution_state="lkg_fallback",
                reason_code="legacy_migration_fallback_lkg",
                fallback_depth=2,
                payload_ref_kind="provider_lkg",
                payload_ref_path=lkg_ref["path"],
            )
            state = "lkg_fallback"
        else:
            transaction_id = store.prepare_unavailable_transition(
                domain="etf_detail",
                entity=entity,
                evidence_observations=[primary_failure, observation],
                expected_active_transaction_id=active["transaction_id"],
                reason_code="legacy_migration_expired",
                decided_at=decided_at,
            )
            store.commit_prepared("etf_detail", transaction_id)
            return "unavailable"

        next_current = dict(active["current"])
        next_current[entity] = selected
        next_recovery = dict(active["recovery"])
        transition = f"migration_{state}"
        next_recovery[entity] = {"consecutive_green": 0, "last_transition": transition}
        transaction_id = store.prepare_transition(
            domain="etf_detail",
            entity=entity,
            current=next_current,
            lkg=active["lkg"],
            recovery=next_recovery,
            candidate_observations=[observation],
            evidence_observations=[primary_failure],
            expected_active_transaction_id=active["transaction_id"],
            transition=transition,
            reason_code=selected["reason_code"],
            recovery_green_count=0,
            decided_at=decided_at,
        )
        store.commit_prepared("etf_detail", transaction_id)
        return state

    def apply(
        self,
        manifest: Mapping[str, Any],
        *,
        decided_at: str,
        delete_legacy: bool = False,
    ) -> dict[str, Any]:
        row = self._validate_manifest(manifest)
        _parse_timestamp(decided_at, "decided_at")
        self._preflight_sources(row, allow_missing=delete_legacy)
        migration_path = self.state_root / "domains/etf_detail/migration.json"
        _atomic_write(migration_path, canonical_json_bytes(row) + b"\n")
        store = DataSupplyStateStore(
            self.state_root,
            provider_truth_root=self.repo_root,
            defer_maintenance=True,
        )
        states = {"fresh_fallback": 0, "lkg_fallback": 0, "unavailable": 0}
        verified: list[str] = []
        for entry in row["entries"]:
            entity = entry["entity"]
            legacy_path = self._repo_path(entry["legacy_path"])
            raw_path = self._repo_path(entry["raw_path"])
            if entry["migration_action"] == "invalid_unavailable":
                evidence_path = self._repo_path(entry["evidence_path"])
                if legacy_path.exists():
                    evidence_bytes = legacy_path.read_bytes()
                    _atomic_write(evidence_path, evidence_bytes)
                else:
                    evidence_bytes = evidence_path.read_bytes()
                if hashlib.sha256(evidence_bytes).hexdigest() != entry["legacy_sha256"]:
                    raise IntegrityError(f"invalid migration evidence digest mismatch: {entity}")
                state = self._migrate_invalid_unavailable(
                    store=store,
                    entry=entry,
                    decided_at=decided_at,
                )
                states[state] += 1
                active = store.read_active_domain("etf_detail")
                if entity in active["current"] or active["recovery"].get(entity, {}).get("last_transition") != "unavailable":
                    raise IntegrityError(f"invalid unavailable state verification failed: {entity}")
                object_root = self.state_root / f"providers/yahoo_finance/etf_detail/objects/{entity}"
                if object_root.exists() and any(object_root.glob("*.json")):
                    raise IntegrityError(f"invalid migration produced a selectable provider object: {entity}")
                verified.append(entity)
                continue
            if legacy_path.exists():
                _, _, normalized_bytes = self._normalize_entry(
                    entity=entity,
                    legacy_path=legacy_path,
                    raw_path=raw_path,
                )
            else:
                normalized_path = self._repo_path(entry["normalized_path"])
                normalized_bytes = normalized_path.read_bytes()
            if hashlib.sha256(normalized_bytes).hexdigest() != entry["normalized_sha256"]:
                raise IntegrityError(f"normalized bytes do not match manifest: {entity}")
            normalized = json.loads(normalized_bytes.decode("utf-8"))
            normalized_path = self._repo_path(entry["normalized_path"])
            _atomic_write(normalized_path, normalized_bytes)
            state = self._migrate_state(
                store=store,
                entry=entry,
                normalized=normalized,
                normalized_bytes=normalized_bytes,
                decided_at=decided_at,
            )
            states[state] += 1
            object_path = self.state_root / entry["provider_object_path"]
            if object_path.read_bytes() != normalized_bytes:
                raise IntegrityError(f"provider object verification failed: {entity}")
            active = store.read_active_domain("etf_detail")
            if state == "unavailable":
                if entity in active["current"] or active["recovery"].get(entity, {}).get("last_transition") != "unavailable":
                    raise IntegrityError(f"unavailable state verification failed: {entity}")
            elif store.read_resolved_payload("etf_detail", entity) != normalized:
                raise IntegrityError(f"selected payload verification failed: {entity}")
            verified.append(entity)

        reconciled_pending = store.reconcile_committed_pending("etf_detail")
        maintenance = store.prune_domain("etf_detail")
        if maintenance["skipped"] is not None:
            raise IntegrityError("final migration maintenance did not complete")
        deleted = 0
        if delete_legacy:
            self._preflight_sources(row, allow_missing=True)
            for entry in row["entries"]:
                legacy_path = self._repo_path(entry["legacy_path"])
                if not legacy_path.exists():
                    continue
                if hashlib.sha256(legacy_path.read_bytes()).hexdigest() != entry["legacy_sha256"]:
                    raise IntegrityError(f"legacy source changed before delete: {entry['entity']}")
                legacy_path.unlink()
                deleted += 1
            _fsync_directory(self.repo_root / "data/stockanalysis/etfs")
            migration_path.unlink()
            _fsync_directory(migration_path.parent)
            maintenance = store.prune_domain("etf_detail")
        return {
            "migration_id": row["migration_id"],
            "manifest_sha256": hashlib.sha256(canonical_json_bytes(row) + b"\n").hexdigest(),
            "migrated": len(verified),
            "verified": len(verified),
            "states": states,
            "deleted_legacy": deleted,
            "deletion_held": not delete_legacy,
            "migration_manifest_path": migration_path.as_posix(),
            "maintenance": maintenance,
            "reconciled_pending": reconciled_pending,
        }


def main() -> int:
    parser = argparse.ArgumentParser()
    repo_default = Path(__file__).resolve().parents[1]
    parser.add_argument("--repo-root", default=str(repo_default))
    parser.add_argument("--state-root", default="data/admin/data-supply-state/v1")
    parser.add_argument("--expected-count", type=int, default=718)
    parser.add_argument("--created-at", required=True)
    parser.add_argument("--decided-at", required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--delete-legacy", action="store_true")
    parser.add_argument("--approved-manifest-sha")
    args = parser.parse_args()
    repo_root = Path(args.repo_root).expanduser().resolve()
    state_root = Path(args.state_root)
    if not state_root.is_absolute():
        state_root = repo_root / state_root
    migration = LegacyYahooMigration(repo_root, state_root)
    existing_manifest = state_root / "domains/etf_detail/migration.json"
    if existing_manifest.exists():
        manifest = _strict_json(existing_manifest)
    else:
        manifest = migration.plan(expected_count=args.expected_count, created_at=args.created_at)
    manifest_sha = hashlib.sha256(canonical_json_bytes(manifest) + b"\n").hexdigest()
    if args.delete_legacy and (
        not args.apply or args.approved_manifest_sha != manifest_sha
    ):
        raise SystemExit("--delete-legacy requires --apply and the exact --approved-manifest-sha")
    if args.apply:
        result = migration.apply(
            manifest,
            decided_at=args.decided_at,
            delete_legacy=args.delete_legacy,
        )
    else:
        result = {
            "migration_id": manifest["migration_id"],
            "manifest_sha256": manifest_sha,
            "planned": len(manifest["entries"]),
            "deletion_held": True,
        }
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
