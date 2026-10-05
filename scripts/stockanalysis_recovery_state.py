#!/usr/bin/env python3
"""Bounded deterministic LKG/recovery state for StockAnalysis producer artifacts."""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
from typing import Any


STATE_SCHEMA = "stockanalysis-recovery-state/v1"
INDEX_SCHEMA = "stockanalysis-recovery-index/v1"
ARTIFACT_KINDS = ("stock", "financial", "etf", "surface", "universe")
_ENTITY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_SURFACE_DATE_KEYS = {
    "as_of", "date", "event_date", "filing_date", "filingdate",
    "ipo_date", "priced_date", "trade_date", "updated", "week_of",
}
MAX_ETF_HISTORY_ARCHIVE_BYTES = 2_000_000

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


class StockAnalysisRecoveryStateError(RuntimeError):
    """Fail-closed reconciliation error for an expected recovery state."""


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




def _etf_component_clocks(payload: dict) -> dict[str, datetime] | None:
    """Read independent official-holdings, raw quote and raw daily-history clocks."""
    raw = payload.get("raw") if isinstance(payload.get("raw"), dict) else {}
    official = raw.get("official_holdings") if isinstance(raw.get("official_holdings"), dict) else None
    endpoints = payload.get("endpoints") if isinstance(payload.get("endpoints"), dict) else {}
    requested = endpoints.get("history_periods") if isinstance(endpoints.get("history_periods"), dict) else {}
    normalized = payload.get("normalized") if isinstance(payload.get("normalized"), dict) else {}
    native_holdings = raw.get("holdings") if isinstance(raw.get("holdings"), dict) else {}
    holdings = _iso_timestamp(official.get("source_as_of")) if official else _iso_timestamp(
        native_holdings.get("date") or normalized.get("holdings_updated"))
    fetched = _iso_timestamp(payload.get("fetched_at"))
    if fetched is None or (official and holdings is None):
        return None
    clocks = {"holdings": holdings} if holdings is not None else {}
    quote = raw.get("quote") if isinstance(raw.get("quote"), dict) else {}
    quote_day = _iso_timestamp(quote.get("td"))
    value = quote.get("ts")
    quote_stamp = None
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
        try:
            parsed = datetime.fromtimestamp(value / 1000 if abs(value) >= 100_000_000_000 else value, timezone.utc)
            if quote_day is None or parsed.date() == quote_day.date():
                quote_stamp = parsed
        except (ValueError, OverflowError, OSError):
            pass
    quote_stamp = quote_stamp or quote_day
    if endpoints.get("quote") and quote_stamp is None:
        return None
    if quote_stamp is not None:
        clocks["quote"] = quote_stamp
    normalized = payload.get("normalized") if isinstance(payload.get("normalized"), dict) else {}
    periods = (raw.get("history_periods") if isinstance(raw.get("history_periods"), dict)
               else normalized.get("history_periods") if isinstance(normalized.get("history_periods"), dict) else {})
    daily = periods.get("daily_1y")
    history_dates = [stamp for row in daily if isinstance(row, dict)
                     if (stamp := _iso_timestamp(row.get("date") or row.get("t") or row.get("time"))) is not None] if isinstance(daily, list) else []
    history_stamp = max(history_dates) if history_dates else None
    if requested.get("daily_1y") and history_stamp is None:
        return None
    if history_stamp is not None:
        clocks["history"] = history_stamp
    return clocks if all(stamp <= fetched for stamp in clocks.values()) else None


def _etf_provider_source(payload: dict) -> datetime | None:
    raw = payload.get("raw") if isinstance(payload.get("raw"), dict) else {}
    normalized = payload.get("normalized") if isinstance(payload.get("normalized"), dict) else {}
    official_holdings = raw.get("official_holdings") if isinstance(raw.get("official_holdings"), dict) else None
    if official_holdings:
        # A mixed-source detail is only as fresh as its oldest required surface.
        # The retained normalized Yahoo series cannot substitute for raw provider evidence.
        clocks = _etf_component_clocks(payload)
        return min(clocks.values()).replace(microsecond=0) if clocks else None
    for quote in (raw.get("quote"), normalized.get("quote")):
        if not isinstance(quote, dict):
            continue
        day = _iso_timestamp(quote.get("td"))
        value = quote.get("ts")
        if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
            try:
                stamp = datetime.fromtimestamp(value / 1000 if abs(value) >= 100_000_000_000 else value, timezone.utc)
            except (ValueError, OverflowError, OSError):
                stamp = None
            if stamp is not None and (day is None or stamp.date() == day.date()):
                return stamp
        if day is not None:
            return day
    holdings = raw.get("holdings") if isinstance(raw.get("holdings"), dict) else {}
    for value in (holdings.get("date"), normalized.get("holdings_updated")):
        stamp = _iso_timestamp(value)
        if stamp is not None:
            return stamp
    periods = normalized.get("history_periods") if isinstance(normalized.get("history_periods"), dict) else {}
    dates = [
        stamp for rows in (normalized.get("history"), periods.get("daily_1y"))
        if isinstance(rows, list) for row in rows if isinstance(row, dict)
        if (stamp := _iso_timestamp(row.get("date") or row.get("t") or row.get("time"))) is not None
    ]
    return max(dates) if dates else None


def _etf_history_dates(rows: Any) -> tuple[datetime, datetime] | None:
    if not isinstance(rows, list) or not rows:
        return None
    dates = []
    for row in rows:
        if not isinstance(row, dict):
            return None
        stamp = _iso_timestamp(row.get("date") or row.get("t") or row.get("time"))
        close = row.get("close", row.get("Close", row.get("c")))
        if stamp is None or not isinstance(close, (int, float)) or isinstance(close, bool) or not math.isfinite(close):
            return None
        dates.append(stamp)
    return min(dates), max(dates)


def _etf_history_date_set(rows: Any) -> set[str] | None:
    if _etf_history_dates(rows) is None:
        return None
    dates = [str(row.get("date") or row.get("t") or row.get("time"))[:10] for row in rows]
    return set(dates) if len(set(dates)) == len(dates) else None


def _archive_record_dates(archive: dict, ticker: str) -> set[str] | None:
    if (archive.get("provider") != "yahoo_finance" or archive.get("price_basis") != "yahoo_adjusted"
            or not isinstance(archive.get("payload_sha256"), str)
            or not re.fullmatch(r"[0-9a-f]{64}", archive["payload_sha256"])
            or not isinstance(archive.get("source_payload"), str)):
        return None
    try:
        object_bytes = archive["source_payload"].encode("utf-8")
        if len(object_bytes) > MAX_ETF_HISTORY_ARCHIVE_BYTES or _sha256(object_bytes) != archive["payload_sha256"]:
            return None
        source = json.loads(archive["source_payload"])
        if not isinstance(source, dict) or source.get("schema_version") != "yf-etf-detail/v1":
            return None
        if (source.get("ticker") != ticker or source.get("source_provider") != "yahoo_finance"
                or source.get("source_as_of") != archive.get("source_as_of")
                or source.get("fetched_at") != archive.get("fetched_at")):
            return None
        data = (source.get("raw") or {}).get("yf")
        if not isinstance(data, dict):
            return None
        info = data.get("info") or {}
        funds = data.get("funds_data") or {}
        if (str(info.get("symbol") or funds.get("symbol") or "").strip().upper() != ticker
                or str(info.get("quoteType") or funds.get("quote_type") or "").upper() not in {"ETF", "MUTUALFUND"}):
            return None
        yahoo_series = data.get("history_1y")
        dates = _etf_history_dates(yahoo_series)
        date_set = _etf_history_date_set(yahoo_series)
        if dates is None or date_set is None:
            return None
        source_stamp, fetched_stamp = _iso_timestamp(source.get("source_as_of")), _iso_timestamp(source.get("fetched_at"))
        if source_stamp is None or fetched_stamp is None or source_stamp > fetched_stamp:
            return None
        value = info.get("regularMarketTime")
        if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
            quote_stamp = datetime.fromtimestamp(value / 1000 if abs(value) >= 100_000_000_000 else value, timezone.utc)
            if quote_stamp.replace(microsecond=0) != source_stamp.replace(microsecond=0):
                return None
        elif dates[1].date() != source_stamp.date():
            return None
        if (archive.get("history_first") != dates[0].date().isoformat()
                or archive.get("history_last") != dates[1].date().isoformat()):
            return None
        return date_set
    except (ValueError, TypeError, AttributeError, OverflowError, OSError):
        return None


def archived_etf_history(payload: dict) -> set[str] | None:
    """Return archived historical dates without mixing provider price rows."""
    normalized = payload.get("normalized") if isinstance(payload.get("normalized"), dict) else {}
    archives = normalized.get("history_archive")
    if archives is None:
        return set()
    ticker = payload.get("ticker")
    if not isinstance(archives, list) or not archives or not isinstance(ticker, str):
        return None
    all_dates = set()
    for archive in archives:
        if not isinstance(archive, dict):
            return None
        dates = _archive_record_dates(archive, ticker)
        if dates is None:
            return None
        all_dates.update(dates)
    return all_dates


def validate_etf_history_archive(payload: dict) -> bool:
    """Keep native daily prices separate from bounded exact Yahoo records."""
    normalized = payload.get("normalized") if isinstance(payload.get("normalized"), dict) else {}
    raw = payload.get("raw") if isinstance(payload.get("raw"), dict) else {}
    normalized_periods = normalized.get("history_periods") if isinstance(normalized.get("history_periods"), dict) else {}
    raw_periods = raw.get("history_periods") if isinstance(raw.get("history_periods"), dict) else {}
    archives = normalized.get("history_archive")
    if ((raw_periods.get("daily_1y") is not None or archives is not None)
            and normalized_periods.get("daily_1y") != raw_periods.get("daily_1y")):
        return False
    if archives is None:
        return True
    ticker = payload.get("ticker")
    if (not isinstance(ticker, str) or not _ENTITY_RE.fullmatch(ticker) or ticker != ticker.upper()
            or not isinstance(archives, list) or not archives or any(not isinstance(item, dict) for item in archives)):
        return False
    digests = [item.get("payload_sha256") for item in archives]
    if any(not isinstance(value, str) for value in digests) or len(set(digests)) != len(digests):
        return False
    if sum(len(item.get("source_payload", "").encode("utf-8")) for item in archives
           if isinstance(item.get("source_payload"), str)) > 8_000_000:
        return False
    return all(_archive_record_dates(item, ticker) is not None for item in archives)


def _validate_identity(kind: str, entity: str) -> None:
    if kind not in ARTIFACT_KINDS:
        raise ValueError(f"unsupported StockAnalysis recovery artifact kind: {kind}")
    if not isinstance(entity, str) or not _ENTITY_RE.fullmatch(entity):
        raise ValueError(f"invalid StockAnalysis recovery entity: {entity!r}")
    if kind in {"stock", "financial", "etf"} and entity != entity.upper():
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
    if kind == "etf":
        normalized = payload.get("normalized")
        return bool(
            payload.get("ticker") == entity
            and payload.get("asset_type") == "etf"
            and isinstance(normalized, dict)
            and isinstance(normalized.get("overview"), dict)
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
    if payload.get("surface") in {"earnings_calendar", "ipos_calendar"}:
        # Scheduled event dates describe the calendar, not when its provider
        # measured the data. An unknown aggregate source date stays unknown.
        source = _iso_timestamp(payload.get("source_as_of"))
        return source.strftime("%Y-%m-%dT%H:%M:%SZ") if source else None
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




class StockAnalysisRecoveryStateStore:
    """Track exact canonical bytes, one exact LKG and retryable failures."""

    def __init__(self, root: Path, repo_root: Path):
        self.root = Path(root)
        self.repo_root = Path(repo_root)
        self._results: dict[tuple[str, str], dict] = {}

    def canonical_path(self, kind: str, entity: str) -> Path:
        _validate_identity(kind, entity)
        if kind == "universe":
            return self.repo_root / "data" / "stockanalysis" / "etf_universe.json"
        directory = {
            "stock": "stocks",
            "financial": "financials",
            "etf": "etfs",
            "surface": "surfaces",
        }[kind]
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
        existing = _read_json(self._state_path(kind, entity)) or {}
        # Slim only an entity being touched; existing payload files stay intact.
        keys = {"schema_version", "artifact_kind", "entity", "resolution_state",
                "retry", "current", "lkg", "updated_at", "latest_failure", "failure_count"}
        state = {key: value for key, value in existing.items() if key in keys}
        failure = state.get("latest_failure")
        if isinstance(failure, dict):
            state["latest_failure"] = {key: value for key, value in failure.items()
                if key in {"observed_at", "error", "had_canonical_before_failure",
                           "expected_payload_sha256", "data_loss"}}
        return state

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
            # ETF details have a much larger corpus than the bounded recovery
            # lanes. Their state is created only by an explicit source failure,
            # then retried from that bounded state set.
            if kind == "etf":
                continue
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

    def has_pending_recovery(self, kind: str, entity: str) -> bool:
        _validate_identity(kind, entity)
        state = _read_json(self._state_path(kind, entity))
        return bool(state and state.get("retry") is True)

    def is_tracked(self, kind: str, entity: str) -> bool:
        _validate_identity(kind, entity)
        return self._state_path(kind, entity).is_file()

    def reconcile_current_payload_sha256(self, kind: str, entity: str) -> bool:
        """Align a fresh current digest with canonical raw bytes."""
        _validate_identity(kind, entity)
        state_path = self._state_path(kind, entity)
        if not state_path.is_file():
            raise StockAnalysisRecoveryStateError(
                f"missing recovery state for {kind}:{entity}: {state_path}"
            )
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise StockAnalysisRecoveryStateError(
                f"malformed recovery state for {kind}:{entity}: {state_path}"
            ) from exc
        except OSError as exc:
            raise StockAnalysisRecoveryStateError(
                f"recovery state is unreadable for {kind}:{entity}: {state_path}"
            ) from exc
        if not isinstance(state, dict):
            raise StockAnalysisRecoveryStateError(
                f"malformed recovery state for {kind}:{entity}: {state_path}"
            )
        current = state.get("current")
        if not isinstance(current, dict):
            raise StockAnalysisRecoveryStateError(
                f"recovery state current is missing or malformed for {kind}:{entity}: {state_path}"
            )
        if state.get("retry") is True and state.get("resolution_state") == "lkg_primary":
            if not self.valid_retained_lkg(kind, entity, state):
                raise StockAnalysisRecoveryStateError(
                    f"degraded recovery state lost retained LKG binding for {kind}:{entity}: {state_path}"
                )
            return False
        canonical_path = self.canonical_path(kind, entity)
        try:
            payload_bytes = canonical_path.read_bytes()
        except OSError as exc:
            raise StockAnalysisRecoveryStateError(
                f"canonical payload is unreadable for {kind}:{entity}: {canonical_path}"
            ) from exc
        payload_sha256 = _sha256(payload_bytes)
        if current.get("payload_sha256") == payload_sha256:
            return False
        state["current"] = {**current, "payload_sha256": payload_sha256}
        _atomic_write_json(self._state_path(kind, entity), state)
        return True

    def recovery_candidate_advances(self, kind: str, entity: str, payload: dict) -> bool:
        """Admit a valid source date without making execution identity a condition."""
        _validate_identity(kind, entity)
        if not _valid_payload(kind, entity, payload):
            raise ValueError(f"invalid StockAnalysis {kind} candidate for {entity}")
        candidate = payload_source_fields(kind, payload)
        after = _iso_timestamp(candidate.get("source_as_of"))
        fetched = _iso_timestamp(candidate.get("fetched_at"))
        now = datetime.now(timezone.utc)
        if (after is not None and after > now) or (fetched is not None and fetched > now):
            return False
        if after is not None and fetched is not None and after > fetched:
            return False
        state = self._load_state(kind, entity)
        prior = state.get("lkg") if state.get("retry") is True else state.get("current")
        before = _iso_timestamp((prior or {}).get("source_as_of"))
        if kind == "etf" and prior:
            prior_path = self._lkg_path(kind, entity) if state.get("retry") is True else self.canonical_path(kind, entity)
            bound = self._valid_bytes(kind, entity, prior_path)
            new_clocks = _etf_component_clocks(payload)
            old_official = bool(bound and isinstance(bound[1].get("raw"), dict)
                                and isinstance(bound[1]["raw"].get("official_holdings"), dict))
            if new_clocks or old_official:
                if not (bound and prior.get("path") == self._relative(prior_path)
                        and _sha256(bound[0]) == prior.get("payload_sha256")):
                    return False
                old_clocks = _etf_component_clocks(bound[1])
                # A prior aggregate alone cannot prove which component advanced.
                if old_clocks:
                    if (new_clocks is None
                            or (old_official and not {"quote", "history"} <= old_clocks.keys())
                            or not old_clocks.keys() <= new_clocks.keys()
                            or any(new_clocks[key] < old_clocks[key] for key in old_clocks)):
                        return False
                    return True
                if old_official:
                    return False
        if kind == "surface" and entity in {"earnings_calendar", "ipos_calendar"} and prior:
            # Older metadata derived the marker from scheduled events. Re-read
            # only its exact bound bytes when this calendar is touched.
            prior_path = self._lkg_path(kind, entity) if state.get("retry") is True else self.canonical_path(kind, entity)
            bound = self._valid_bytes(kind, entity, prior_path)
            if (bound and prior.get("path") == self._relative(prior_path)
                    and _sha256(bound[0]) == prior.get("payload_sha256")):
                before = _iso_timestamp(payload_source_fields(kind, bound[1])["source_as_of"])
        # Unknown provider dates remain unknown; acquisition time is not freshness.
        return before is None or (after is not None and after >= before)

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
        if canonical and self.recovery_candidate_advances(kind, entity, canonical[1]):
            payload_bytes, payload = canonical
            lkg_path = self._lkg_path(kind, entity)
            _atomic_write_bytes(lkg_path, payload_bytes)
            lkg = {
                "path": self._relative(lkg_path),
                "payload_sha256": _sha256(payload_bytes),
                **payload_source_fields(kind, payload),
            }

        observed_at = str(run.get("observed_at") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
        canonical_current = lkg if canonical else prior_current
        data_loss = canonical_current is not None and lkg is None
        failure = {
            "observed_at": observed_at,
            "error": _bounded_error(error),
            "had_canonical_before_failure": canonical_current is not None,
            "expected_payload_sha256": canonical_current.get("payload_sha256") if canonical_current else None,
            "data_loss": data_loss,
        }
        state.update({
            "schema_version": STATE_SCHEMA, "artifact_kind": kind, "entity": entity,
            "resolution_state": "lkg_primary" if lkg else "unavailable", "retry": True,
            "latest_failure": failure, "updated_at": observed_at,
            "failure_count": int(state.get("failure_count") or 0) + 1,
        })
        self._results[(kind, entity)] = {"artifact_kind": kind, "entity": entity,
            "error": failure["error"], "data_loss": data_loss}
        if lkg:
            state["lkg"] = lkg
            state["current"] = dict(lkg)
        else:
            state.pop("lkg", None)
            state.pop("current", None)
        _atomic_write_json(self._state_path(kind, entity), state)
        return state


    def record_success(self, kind: str, entity: str, payload: dict, run: dict,
                       *, prevalidated_etf: bool = False) -> dict:
        _validate_identity(kind, entity)
        state = self._load_state(kind, entity)
        if prevalidated_etf and kind != "etf":
            raise ValueError("prevalidated ETF write flag is ETF-only")
        if not prevalidated_etf and not self.recovery_candidate_advances(kind, entity, payload):
            raise ValueError(f"candidate source date regresses or is invalid for {kind}:{entity}")
        canonical_path = self.canonical_path(kind, entity)
        valid = self._valid_bytes(kind, entity, canonical_path)
        if not valid:
            raise ValueError(f"written StockAnalysis {kind} payload is invalid for {entity}")
        payload_bytes, written_payload = valid
        if _sha256((json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")) != _sha256(payload_bytes):
            raise ValueError(f"written StockAnalysis {kind} payload differs from recovery candidate for {entity}")

        state.update({
            "schema_version": STATE_SCHEMA, "artifact_kind": kind, "entity": entity,
            "resolution_state": "fresh_primary", "retry": False,
            "current": {"path": self._relative(canonical_path),
                "payload_sha256": _sha256(payload_bytes), **payload_source_fields(kind, written_payload)},
            "updated_at": str(run.get("observed_at") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")),
            "failure_count": 0,
        })
        state.pop("latest_failure", None)
        self._results[(kind, entity)] = {"artifact_kind": kind, "entity": entity}
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
        counts = {"tracked": 0, "fresh": 0, "lkg": 0, "unavailable": 0, "retry": 0}
        counts_by_kind = {kind: dict(counts) for kind in ARTIFACT_KINDS}
        retry_artifacts = []
        degraded_details = []
        for kind in ARTIFACT_KINDS:
            for path in sorted((self.root / "states" / kind).glob("*.json")):
                state = _read_json(path)
                if not state:
                    continue
                entity = str(state.get("entity") or path.stem)
                resolution = state.get("resolution_state")
                key = {"fresh_primary": "fresh", "lkg_primary": "lkg"}.get(resolution, "unavailable")
                for bucket in (counts, counts_by_kind[kind]):
                    bucket["tracked"] += 1
                    bucket[key] += 1
                if state.get("retry") is True:
                    counts["retry"] += 1
                    counts_by_kind[kind]["retry"] += 1
                    retry_artifacts.append({"artifact_kind": kind, "entity": entity})
                    failure, lkg = state.get("latest_failure") or {}, state.get("lkg") or {}
                    degraded_details.append({"artifact_kind": kind, "entity": entity,
                        "resolution_state": resolution, "source_as_of": lkg.get("source_as_of"),
                        "failure_observed_at": failure.get("observed_at"), "error": failure.get("error"),
                        "failure_count": state.get("failure_count", 0), "data_loss": failure.get("data_loss") is True})
        errors = [row for row in self._results.values() if "error" in row]
        counts["failed"] = len(errors)
        index = {"schema_version": INDEX_SCHEMA,
            "generated_at": str(run.get("observed_at") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")),
            "counts": counts, "counts_by_kind": counts_by_kind, "retry_artifacts": retry_artifacts,
            "degraded_details": degraded_details,
            "current_results": {"failed": len(errors), "errors": errors}}
        for suffix, kinds in (("tickers", {"stock", "financial"}), ("etfs", {"etf"}),
                              ("surfaces", {"surface"}), ("universes", {"universe"})):
            index[f"degraded_{suffix}"] = sorted({row["entity"] for row in degraded_details if row["artifact_kind"] in kinds})
        _atomic_write_json(self.root / "index.json", index)
        return index

    def assess_current_attempt(self, index: dict) -> dict:
        attempt = index.get("current_results") if isinstance(index.get("current_results"), dict) else {}
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
]
