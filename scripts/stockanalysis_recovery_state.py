#!/usr/bin/env python3
"""Bounded deterministic LKG/recovery state for StockAnalysis producer artifacts."""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
from typing import Any


STATE_SCHEMA = "stockanalysis-recovery-state/v1"
INDEX_SCHEMA = "stockanalysis-recovery-index/v1"
ATTEMPT_RETENTION = 14
ARTIFACT_KINDS = ("stock", "financial", "surface", "universe")
_ENTITY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_SURFACE_DATE_KEYS = {
    "as_of", "date", "event_date", "filing_date", "filingdate",
    "ipo_date", "priced_date", "trade_date", "updated", "week_of",
}

SYSTEMIC_FAILURE_MARKERS = {
    "authentication": (
        "http 401", "status 401", "unauthorized", "authentication failed",
        "http 403", "status 403", "forbidden", "cookie",
    ),
    "rate_limit": (
        "http 429", "status 429", "error 429", "too many requests",
        "rate limit", "rate-limit", "ratelimit",
    ),
    "decode": (
        "jsondecodeerror", "json decode", "failed to decode", "decode collapse",
        "decode error", "invalid json", "expecting value", "malformed json",
    ),
}


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _read_json(path: Path) -> dict | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, UnicodeDecodeError, OSError):
        return None
    return payload if isinstance(payload, dict) else None


def _atomic_write_bytes(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        tmp.write_bytes(payload)
        tmp.replace(path)
    finally:
        if tmp.exists():
            tmp.unlink()


def _atomic_write_json(path: Path, payload: dict) -> None:
    _atomic_write_bytes(
        path,
        (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
    )


def _iso_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if _DATE_RE.fullmatch(text):
        text = f"{text}T00:00:00+00:00"
    elif text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        try:
            parsed = datetime.strptime(text, "%b %d, %Y")
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _bounded_error(value: Any, limit: int = 240) -> str:
    return " ".join(str(value or "unknown error").split())[:limit]


def _validate_identity(kind: str, entity: str) -> None:
    if kind not in ARTIFACT_KINDS:
        raise ValueError(f"unsupported StockAnalysis recovery artifact kind: {kind}")
    if not isinstance(entity, str) or not _ENTITY_RE.fullmatch(entity):
        raise ValueError(f"invalid StockAnalysis recovery entity: {entity!r}")
    if kind in {"stock", "financial"} and entity != entity.upper():
        raise ValueError("StockAnalysis recovery tickers must be uppercase")
    if kind == "universe" and entity != "etf_universe":
        raise ValueError("StockAnalysis universe recovery entity must be etf_universe")


def _valid_payload(kind: str, entity: str, payload: dict | None) -> bool:
    if not isinstance(payload, dict) or payload.get("source") != "stockanalysis":
        return False
    if payload.get("schema_version") != "stockanalysis/v1":
        return False
    if kind == "stock":
        normalized = payload.get("normalized")
        return bool(
            payload.get("ticker") == entity
            and payload.get("asset_type") == "stock"
            and isinstance(normalized, dict)
            and isinstance(normalized.get("overview"), dict)
            and isinstance(normalized.get("quote"), dict)
            and isinstance(normalized.get("history"), list)
            and normalized["history"]
        )
    if kind == "financial":
        return bool(
            payload.get("ticker") == entity
            and payload.get("asset_type") == "stock"
            and isinstance(payload.get("statements"), dict)
            and payload["statements"]
        )
    if kind == "universe":
        records = payload.get("records")
        counts = payload.get("counts") if isinstance(payload.get("counts"), dict) else {}
        tickers = [
            str(row.get("ticker") or "").strip().upper()
            for row in records or []
            if isinstance(row, dict)
        ]
        return bool(
            entity == "etf_universe"
            and payload.get("asset_type") == "etf"
            and payload.get("endpoint") == "/etf/"
            and isinstance(records, list)
            and records
            and all(tickers)
            and tickers == sorted(set(tickers))
            and counts.get("records") == len(records)
            and isinstance(counts.get("pages"), int)
            and counts["pages"] > 0
        )
    return bool(
        payload.get("surface") == entity
        and isinstance(payload.get("counts"), dict)
        and isinstance(payload.get("format"), str)
    )


def _financial_source_as_of(payload: dict) -> str | None:
    dates = []
    statements = payload.get("statements") if isinstance(payload.get("statements"), dict) else {}
    for period_group in statements.values():
        if not isinstance(period_group, dict):
            continue
        for statement in period_group.values():
            if not isinstance(statement, dict):
                continue
            for value in statement.get("periods") or []:
                if isinstance(value, str) and _DATE_RE.fullmatch(value) and _iso_timestamp(value):
                    dates.append(value)
    return max(dates) if dates else None


def _stock_source_as_of(payload: dict) -> str | None:
    normalized = payload.get("normalized") if isinstance(payload.get("normalized"), dict) else {}
    quote = normalized.get("quote") if isinstance(normalized.get("quote"), dict) else {}
    candidates = [payload.get("source_as_of"), quote.get("td"), quote.get("etd")]
    for row in normalized.get("history") or []:
        if isinstance(row, dict):
            candidates.append(row.get("date") or row.get("t") or row.get("time"))
    parsed = [stamp for value in candidates if (stamp := _iso_timestamp(value)) is not None]
    return max(parsed).strftime("%Y-%m-%dT%H:%M:%SZ") if parsed else None


def _surface_source_as_of(payload: dict) -> str | None:
    candidates = [payload.get("source_as_of")]
    records = list(payload.get("records") or [])
    for table in payload.get("tables") or []:
        if isinstance(table, dict):
            records.extend(table.get("records") or [])
    for row in records:
        if not isinstance(row, dict):
            continue
        for key, value in row.items():
            if str(key).lower() in _SURFACE_DATE_KEYS:
                candidates.append(value)
    parsed = [stamp for value in candidates if (stamp := _iso_timestamp(value)) is not None]
    return max(parsed).strftime("%Y-%m-%dT%H:%M:%SZ") if parsed else None


def payload_source_fields(kind: str, payload: dict) -> dict[str, str | None]:
    source_as_of = payload.get("source_as_of") if isinstance(payload.get("source_as_of"), str) else None
    if kind == "stock":
        source_as_of = _stock_source_as_of(payload)
    elif kind == "financial":
        source_as_of = _financial_source_as_of(payload)
    elif kind == "surface":
        source_as_of = _surface_source_as_of(payload)
    return {
        "source_as_of": source_as_of,
        "fetched_at": payload.get("fetched_at") if isinstance(payload.get("fetched_at"), str) else None,
    }


def validate_controlled_failure_scope(
    controlled_tickers: set[str],
    selected_tickers: set[str],
    controlled_surfaces: set[str],
    selected_surfaces: set[str],
    *,
    event_name: str,
) -> None:
    if not controlled_tickers and not controlled_surfaces:
        return
    if event_name != "workflow_dispatch":
        raise ValueError("controlled StockAnalysis failures are restricted to workflow_dispatch")
    if not controlled_tickers.issubset(selected_tickers):
        raise ValueError("controlled_failure_tickers must be a subset of explicit --stocks")
    if not controlled_surfaces.issubset(selected_surfaces):
        raise ValueError("controlled_failure_surfaces must be a subset of explicit --surfaces")


class StockAnalysisRecoveryStateStore:
    """Track exact canonical bytes, one exact LKG, retry, and recovery provenance."""

    def __init__(self, root: Path, repo_root: Path):
        self.root = Path(root)
        self.repo_root = Path(repo_root)

    def canonical_path(self, kind: str, entity: str) -> Path:
        _validate_identity(kind, entity)
        if kind == "universe":
            return self.repo_root / "data" / "stockanalysis" / "etf_universe.json"
        directory = {"stock": "stocks", "financial": "financials", "surface": "surfaces"}[kind]
        return self.repo_root / "data" / "stockanalysis" / directory / f"{entity}.json"

    def _state_path(self, kind: str, entity: str) -> Path:
        _validate_identity(kind, entity)
        return self.root / "states" / kind / f"{entity}.json"

    def _lkg_path(self, kind: str, entity: str) -> Path:
        _validate_identity(kind, entity)
        return self.root / "lkg" / kind / f"{entity}.json"

    def _relative(self, path: Path) -> str:
        try:
            return path.relative_to(self.repo_root).as_posix()
        except ValueError as exc:
            raise ValueError("StockAnalysis recovery path escapes repository root") from exc

    def _load_state(self, kind: str, entity: str) -> dict:
        return _read_json(self._state_path(kind, entity)) or {
            "schema_version": STATE_SCHEMA,
            "artifact_kind": kind,
            "entity": entity,
            "attempts": [],
        }

    @staticmethod
    def _append_attempt(state: dict, attempt: dict) -> None:
        attempts = [row for row in state.get("attempts") or [] if isinstance(row, dict)]
        attempts.append(attempt)
        state["attempts"] = attempts[-ATTEMPT_RETENTION:]

    @staticmethod
    def _attempt(run: dict, outcome: str, *, error: str | None = None, controlled: bool = False) -> dict:
        row = {
            "run_id": str(run.get("run_id") or "local"),
            "run_attempt": int(run.get("run_attempt") or 1),
            "event_name": str(run.get("event_name") or "local"),
            "schedule": str(run.get("schedule") or ""),
            "natural": run.get("natural") is True,
            "observed_at": str(run.get("observed_at") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")),
            "outcome": outcome,
            "controlled": controlled,
        }
        if error is not None:
            row["error"] = _bounded_error(error)
        return row

    def _valid_bytes(self, kind: str, entity: str, path: Path) -> tuple[bytes, dict] | None:
        payload = _read_json(path)
        if not _valid_payload(kind, entity, payload):
            return None
        try:
            payload_bytes = path.read_bytes()
        except OSError:
            return None
        return payload_bytes, payload

    def _valid_advertised_lkg(self, kind: str, entity: str, state: dict) -> dict | None:
        lkg = state.get("lkg") if isinstance(state.get("lkg"), dict) else None
        if not lkg:
            return None
        expected_path = self._relative(self._lkg_path(kind, entity))
        if lkg.get("path") != expected_path:
            return None
        valid = self._valid_bytes(kind, entity, self._lkg_path(kind, entity))
        if not valid:
            return None
        payload_bytes, payload = valid
        if _sha256(payload_bytes) != lkg.get("payload_sha256"):
            return None
        return {**lkg, **payload_source_fields(kind, payload)}

    def bootstrap_existing(self, run: dict) -> int:
        changed = 0
        for kind in ARTIFACT_KINDS:
            if kind == "universe":
                paths = [self.canonical_path(kind, "etf_universe")]
            else:
                directory = self.canonical_path(
                    kind, "fixture" if kind == "surface" else "AAPL"
                ).parent
                paths = sorted(directory.glob("*.json"))
            for path in paths:
                entity = "etf_universe" if kind == "universe" else path.stem
                if not _ENTITY_RE.fullmatch(entity):
                    continue
                valid = self._valid_bytes(kind, entity, path)
                if not valid:
                    continue
                payload_bytes, payload = valid
                state = self._load_state(kind, entity)
                if state.get("retry") is True and state.get("resolution_state") in {"lkg_primary", "unavailable"}:
                    continue
                current = {
                    "path": self._relative(path),
                    "payload_sha256": _sha256(payload_bytes),
                    **payload_source_fields(kind, payload),
                }
                if state.get("resolution_state") == "fresh_primary" and state.get("current") == current:
                    continue
                state.update({
                    "schema_version": STATE_SCHEMA,
                    "artifact_kind": kind,
                    "entity": entity,
                    "resolution_state": "fresh_primary",
                    "retry": False,
                    "current": current,
                    "updated_at": str(run.get("observed_at") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")),
                })
                _atomic_write_json(self._state_path(kind, entity), state)
                changed += 1
        return changed

    def retry_entities(self, kind: str) -> set[str]:
        if kind not in ARTIFACT_KINDS:
            raise ValueError(f"unsupported StockAnalysis recovery artifact kind: {kind}")
        retry = set()
        for path in (self.root / "states" / kind).glob("*.json"):
            state = _read_json(path)
            if state and state.get("retry") is True:
                retry.add(path.stem)
        return retry

    def recovery_candidate_advances(self, kind: str, entity: str, payload: dict) -> bool:
        _validate_identity(kind, entity)
        if not _valid_payload(kind, entity, payload):
            raise ValueError(f"invalid StockAnalysis {kind} recovery candidate for {entity}")
        state = self._load_state(kind, entity)
        if state.get("retry") is not True or state.get("resolution_state") != "lkg_primary":
            return True
        prior = state.get("lkg") if isinstance(state.get("lkg"), dict) else {}
        candidate = payload_source_fields(kind, payload)
        before = _iso_timestamp(
            prior.get("source_as_of") or prior.get("fetched_at")
            if kind == "universe"
            else prior.get("source_as_of")
        )
        after = _iso_timestamp(
            candidate.get("source_as_of") or candidate.get("fetched_at")
            if kind == "universe"
            else candidate.get("source_as_of")
        )
        if before is None or after is None:
            return True
        return after > before

    def record_failure(
        self,
        kind: str,
        entity: str,
        error: str,
        run: dict,
        *,
        controlled: bool = False,
    ) -> dict:
        _validate_identity(kind, entity)
        state = self._load_state(kind, entity)
        prior_current = state.get("current") if isinstance(state.get("current"), dict) else None
        prior_lkg = self._valid_advertised_lkg(kind, entity, state)
        canonical = self._valid_bytes(kind, entity, self.canonical_path(kind, entity))
        lkg = prior_lkg
        if canonical:
            payload_bytes, payload = canonical
            lkg_path = self._lkg_path(kind, entity)
            _atomic_write_bytes(lkg_path, payload_bytes)
            lkg = {
                "path": self._relative(lkg_path),
                "payload_sha256": _sha256(payload_bytes),
                **payload_source_fields(kind, payload),
            }

        attempt = self._attempt(run, "failed", error=error, controlled=controlled)
        self._append_attempt(state, attempt)
        data_loss = prior_current is not None and lkg is None
        failure = {
            "run_id": attempt["run_id"],
            "run_attempt": attempt["run_attempt"],
            "observed_at": attempt["observed_at"],
            "error": attempt["error"],
            "controlled": controlled,
            "had_canonical_before_failure": prior_current is not None,
            "expected_payload_sha256": prior_current.get("payload_sha256") if prior_current else None,
            "data_loss": data_loss,
        }
        state.update({
            "schema_version": STATE_SCHEMA,
            "artifact_kind": kind,
            "entity": entity,
            "resolution_state": "lkg_primary" if lkg else "unavailable",
            "retry": True,
            "last_attempt": attempt,
            "latest_failure": failure,
            "updated_at": attempt["observed_at"],
        })
        if lkg:
            state["lkg"] = lkg
            state["current"] = dict(lkg)
        else:
            state.pop("lkg", None)
            state.pop("current", None)
        _atomic_write_json(self._state_path(kind, entity), state)
        return state

    def record_success(self, kind: str, entity: str, payload: dict, run: dict) -> dict:
        _validate_identity(kind, entity)
        if not self.recovery_candidate_advances(kind, entity, payload):
            raise ValueError(f"source did not advance beyond the retained LKG for {kind}:{entity}")
        canonical_path = self.canonical_path(kind, entity)
        valid = self._valid_bytes(kind, entity, canonical_path)
        if not valid:
            raise ValueError(f"written StockAnalysis {kind} payload is invalid for {entity}")
        payload_bytes, written_payload = valid
        if _sha256((json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")) != _sha256(payload_bytes):
            raise ValueError(f"written StockAnalysis {kind} payload differs from recovery candidate for {entity}")

        state = self._load_state(kind, entity)
        previous_state = state.get("resolution_state")
        latest_failure = state.get("latest_failure") if isinstance(state.get("latest_failure"), dict) else None
        previous_run_id = latest_failure.get("run_id") if latest_failure else None
        recovered = previous_state in {"lkg_primary", "unavailable"} and bool(previous_run_id)
        attempt = self._attempt(run, "recovered" if recovered else "fresh")
        self._append_attempt(state, attempt)
        state.update({
            "schema_version": STATE_SCHEMA,
            "artifact_kind": kind,
            "entity": entity,
            "resolution_state": "fresh_primary",
            "retry": False,
            "current": {
                "path": self._relative(canonical_path),
                "payload_sha256": _sha256(payload_bytes),
                **payload_source_fields(kind, written_payload),
            },
            "last_attempt": attempt,
            "updated_at": attempt["observed_at"],
        })
        if recovered:
            state["recovered_from_run_id"] = str(previous_run_id)
            state["recovered_at"] = attempt["observed_at"]
            state["last_recovered_failure"] = latest_failure
        state.pop("latest_failure", None)
        _atomic_write_json(self._state_path(kind, entity), state)
        return state

    def valid_retained_lkg(self, kind: str, entity: str, state: dict | None = None) -> bool:
        state = state if isinstance(state, dict) else self._load_state(kind, entity)
        current = state.get("current") if isinstance(state.get("current"), dict) else None
        lkg = self._valid_advertised_lkg(kind, entity, state)
        return bool(
            state.get("resolution_state") == "lkg_primary"
            and lkg
            and current == state.get("lkg")
            and current.get("payload_sha256") == lkg.get("payload_sha256")
        )

    def rebuild_index(self, run: dict) -> dict:
        counts = {"tracked": 0, "fresh": 0, "lkg": 0, "unavailable": 0, "retry": 0, "failed": 0, "recovered": 0}
        counts_by_kind = {
            kind: {"tracked": 0, "fresh": 0, "lkg": 0, "unavailable": 0, "retry": 0}
            for kind in ARTIFACT_KINDS
        }
        retry_artifacts = []
        degraded_details = []
        recovered_details = []
        current_errors = []
        current_successes = []
        run_id = str(run.get("run_id") or "local")
        run_attempt = int(run.get("run_attempt") or 1)

        for kind in ARTIFACT_KINDS:
            for path in sorted((self.root / "states" / kind).glob("*.json")):
                state = _read_json(path)
                if not state:
                    continue
                entity = str(state.get("entity") or path.stem)
                counts["tracked"] += 1
                counts_by_kind[kind]["tracked"] += 1
                resolution = state.get("resolution_state")
                if resolution == "fresh_primary":
                    counts["fresh"] += 1
                    counts_by_kind[kind]["fresh"] += 1
                elif resolution == "lkg_primary":
                    counts["lkg"] += 1
                    counts_by_kind[kind]["lkg"] += 1
                else:
                    counts["unavailable"] += 1
                    counts_by_kind[kind]["unavailable"] += 1
                if state.get("retry") is True:
                    counts["retry"] += 1
                    counts_by_kind[kind]["retry"] += 1
                    retry_artifacts.append({"artifact_kind": kind, "entity": entity})
                    failure = state.get("latest_failure") if isinstance(state.get("latest_failure"), dict) else {}
                    lkg = state.get("lkg") if isinstance(state.get("lkg"), dict) else {}
                    degraded_details.append({
                        "artifact_kind": kind,
                        "entity": entity,
                        "resolution_state": resolution,
                        "payload_sha256": lkg.get("payload_sha256"),
                        "source_as_of": lkg.get("source_as_of"),
                        "failure_run_id": failure.get("run_id"),
                        "failure_observed_at": failure.get("observed_at"),
                        "data_loss": failure.get("data_loss") is True,
                    })
                attempt = state.get("last_attempt") if isinstance(state.get("last_attempt"), dict) else {}
                if str(attempt.get("run_id")) != run_id or int(attempt.get("run_attempt") or 1) != run_attempt:
                    continue
                if attempt.get("outcome") == "failed":
                    counts["failed"] += 1
                    failure = state.get("latest_failure") if isinstance(state.get("latest_failure"), dict) else {}
                    current_errors.append({
                        "artifact_kind": kind,
                        "entity": entity,
                        "error": attempt.get("error"),
                        "controlled": attempt.get("controlled") is True,
                        "data_loss": failure.get("data_loss") is True,
                    })
                else:
                    current_successes.append({"artifact_kind": kind, "entity": entity, "outcome": attempt.get("outcome")})
                    if attempt.get("outcome") == "recovered":
                        counts["recovered"] += 1
                        recovered_details.append({
                            "artifact_kind": kind,
                            "entity": entity,
                            "payload_sha256": (state.get("current") or {}).get("payload_sha256"),
                            "source_as_of": (state.get("current") or {}).get("source_as_of"),
                            "recovered_from_run_id": state.get("recovered_from_run_id"),
                            "recovered_at": state.get("recovered_at"),
                        })

        degraded_tickers = sorted({row["entity"] for row in degraded_details if row["artifact_kind"] in {"stock", "financial"}})
        degraded_surfaces = sorted({row["entity"] for row in degraded_details if row["artifact_kind"] == "surface"})
        degraded_universes = sorted({row["entity"] for row in degraded_details if row["artifact_kind"] == "universe"})
        recovered_tickers = sorted({row["entity"] for row in recovered_details if row["artifact_kind"] in {"stock", "financial"}})
        recovered_surfaces = sorted({row["entity"] for row in recovered_details if row["artifact_kind"] == "surface"})
        recovered_universes = sorted({row["entity"] for row in recovered_details if row["artifact_kind"] == "universe"})
        index = {
            "schema_version": INDEX_SCHEMA,
            "generated_at": str(run.get("observed_at") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")),
            "counts": counts,
            "counts_by_kind": counts_by_kind,
            "retry_artifacts": retry_artifacts,
            "degraded_details": degraded_details,
            "degraded_tickers": degraded_tickers,
            "degraded_surfaces": degraded_surfaces,
            "degraded_universes": degraded_universes,
            "recovered_details": recovered_details,
            "recovered_tickers": recovered_tickers,
            "recovered_surfaces": recovered_surfaces,
            "recovered_universes": recovered_universes,
            "current_attempt": {
                "run_id": run_id,
                "run_attempt": run_attempt,
                "event_name": str(run.get("event_name") or "local"),
                "schedule": str(run.get("schedule") or ""),
                "natural": run.get("natural") is True,
                "attempted": len(current_errors) + len(current_successes),
                "successes": len(current_successes),
                "failed": len(current_errors),
                "recovered": len(recovered_details),
                "errors": current_errors,
                "success_rows": current_successes,
            },
        }
        _atomic_write_json(self.root / "index.json", index)
        return index

    def assess_current_attempt(self, index: dict) -> dict:
        attempt = index.get("current_attempt") if isinstance(index.get("current_attempt"), dict) else {}
        errors = [row for row in attempt.get("errors") or [] if isinstance(row, dict)]
        if not errors:
            return {"status": "ready", "exit_code": 0, "artifacts": [], "reasons": []}

        reasons = []
        texts = [str(row.get("error") or "").lower() for row in errors]
        auth_count = sum(any(marker in text for marker in SYSTEMIC_FAILURE_MARKERS["authentication"]) for text in texts)
        rate_count = sum(any(marker in text for marker in SYSTEMIC_FAILURE_MARKERS["rate_limit"]) for text in texts)
        decode_count = sum(any(marker in text for marker in SYSTEMIC_FAILURE_MARKERS["decode"]) for text in texts)
        if auth_count:
            reasons.append("StockAnalysis authentication failure")
        if rate_count >= 2:
            reasons.append(f"StockAnalysis 429 storm across {rate_count} artifacts")
        if decode_count >= 2:
            reasons.append(f"StockAnalysis decode collapse across {decode_count} artifacts")
        for row in errors:
            if row.get("data_loss") is True:
                reasons.append(f"{row.get('artifact_kind')}:{row.get('entity')} lost an existing canonical payload without valid LKG")

        artifacts = sorted(f"{row.get('artifact_kind')}:{row.get('entity')}" for row in errors)
        return {
            "status": "corrupt" if reasons else "degraded",
            "exit_code": 2 if reasons else 0,
            "artifacts": artifacts,
            "reasons": reasons,
        }


__all__ = [
    "StockAnalysisRecoveryStateStore",
    "payload_source_fields",
    "validate_controlled_failure_scope",
]
