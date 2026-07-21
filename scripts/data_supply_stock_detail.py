#!/usr/bin/env python3
"""Fail-closed stock-detail validation and enrolled observation publication."""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

from data_supply_policy import get_domain_policy
from data_supply_state import (
    DataSupplyStateStore,
    canonical_sha256,
    deterministic_event_id,
)


FROZEN_STOCK_DETAIL_TICKERS = (
    "AAPL", "ABBV", "AMAT", "AMD", "AMZN", "ARM", "ASML", "AVGO", "BAC",
    "BRK.A", "BRK.B", "CAT", "CBOE", "CCEP", "COST", "CSCO", "CVX", "DOC",
    "FDXF", "FISV", "GE", "GOOG", "GOOGL", "INTC", "JNJ", "JPM", "KO", "L",
    "LLY", "LRCX", "MA", "META", "MRSH", "MS", "MSFT", "MU", "NFLX", "NVDA",
    "ORCL", "PG", "PLTR", "PSKY", "STRC", "TSLA", "TSM", "UNH", "V", "WMT",
    "XOM",
)
FROZEN_TICKER_SHA256 = "da4e5ec74ea0d741d529a627f2ea2f5507213787c5fa5395081e17566544e09f"

_ENROLLED = frozenset(FROZEN_STOCK_DETAIL_TICKERS)
_TICKER = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,11}$")
POLICY_CONSUMER_ID = "scripts.data_supply_stock_detail"
_POLICY = get_domain_policy("stock_detail", consumer_id=POLICY_CONSUMER_ID)

if canonical_sha256(list(FROZEN_STOCK_DETAIL_TICKERS)) != FROZEN_TICKER_SHA256:
    raise RuntimeError("frozen stock-detail ticker digest mismatch")


class StockDetailValidationError(ValueError):
    def __init__(self, reason_code: str, detail: str):
        super().__init__(detail)
        self.reason_code = reason_code
        self.detail = detail


@dataclass(frozen=True)
class ValidatedStockDetail:
    provider: str
    endpoint_family: str
    provider_schema: str
    entity: str
    provider_path: str
    source_as_of: str
    payload_sha256: str
    payload_bytes: bytes


def _fail(reason_code: str, detail: str):
    raise StockDetailValidationError(reason_code, detail)


def yahoo_provider_symbol(entity: str) -> str:
    """Return Yahoo's alias only for single-letter class-share suffixes."""
    head, separator, tail = entity.rpartition(".")
    if separator and head and tail.isalpha() and len(tail) == 1 and not head[-1].isdigit():
        return f"{head}-{tail}"
    return entity


def _strict_json_bytes(payload_bytes: bytes) -> dict[str, Any]:
    if not isinstance(payload_bytes, bytes):
        _fail("payload_invalid", "stock-detail payload must be exact bytes")

    def reject_constant(value: str):
        _fail("payload_invalid", f"non-finite JSON constant is forbidden: {value}")

    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                _fail("payload_invalid", f"duplicate JSON key is forbidden: {key}")
            result[key] = value
        return result

    try:
        payload = json.loads(
            payload_bytes.decode("utf-8"),
            parse_constant=reject_constant,
            object_pairs_hook=unique_object,
        )
    except StockDetailValidationError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        _fail("payload_invalid", f"stock-detail payload is not strict JSON: {exc}")
    if not isinstance(payload, dict):
        _fail("payload_invalid", "stock-detail payload root must be an object")
    return payload


def _timestamp(value: Any, label: str) -> dt.datetime:
    if not isinstance(value, str) or not value:
        _fail("time_invalid", f"{label} is missing")
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        parsed = dt.datetime.fromisoformat(normalized)
    except ValueError:
        _fail("time_invalid", f"{label} is malformed")
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        _fail("time_invalid", f"{label} must be timezone-aware")
    return parsed.astimezone(dt.timezone.utc)


def _source_timestamp_from_epoch(value: Any) -> str | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    seconds = float(value) / 1000 if abs(float(value)) >= 100_000_000_000 else float(value)
    try:
        parsed = dt.datetime.fromtimestamp(seconds, dt.timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None
    return parsed.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _source_timestamp_from_date(value: Any) -> str | None:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return None
    try:
        parsed = dt.date.fromisoformat(value)
    except ValueError:
        return None
    return f"{parsed.isoformat()}T00:00:00Z"


def _latest_history_source_timestamp(rows: Any, *date_keys: str) -> str | None:
    if not isinstance(rows, list):
        return None
    dates = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        for key in date_keys:
            stamp = _source_timestamp_from_date(row.get(key))
            if stamp:
                dates.append(stamp)
                break
    return max(dates) if dates else None


def _stockanalysis_source_as_of(payload: dict[str, Any]) -> str | None:
    raw = payload.get("raw") if isinstance(payload.get("raw"), dict) else {}
    normalized = payload.get("normalized") if isinstance(payload.get("normalized"), dict) else {}
    for quote in (raw.get("quote"), normalized.get("quote")):
        if not isinstance(quote, dict):
            continue
        timestamp = _source_timestamp_from_epoch(quote.get("ts"))
        source_date = _source_timestamp_from_date(quote.get("td"))
        if timestamp and (not source_date or timestamp[:10] == source_date[:10]):
            return timestamp
        if source_date:
            return source_date
    history_periods = normalized.get("history_periods") if isinstance(normalized.get("history_periods"), dict) else {}
    return (
        _latest_history_source_timestamp(history_periods.get("daily_1y"), "date", "t")
        or _latest_history_source_timestamp(normalized.get("history"), "date", "t")
    )


def _yahoo_source_as_of(payload: dict[str, Any]) -> str | None:
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    info = data.get("info") if isinstance(data.get("info"), dict) else {}
    return (
        _source_timestamp_from_epoch(info.get("regularMarketTime"))
        or _latest_history_source_timestamp(data.get("history_1y"), "date")
    )


def _finite_number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        _fail("quote_invalid", f"{label} must be a finite number")
    return float(value)


def _positive_number(value: Any, label: str) -> float:
    number = _finite_number(value, label)
    if number <= 0:
        _fail("quote_invalid", f"{label} must be positive")
    return number


def _validate_entity(entity: str) -> None:
    if not isinstance(entity, str) or not _TICKER.fullmatch(entity) or entity != entity.upper():
        _fail("identity_mismatch", "entity must be a literal uppercase ticker")


def _expected_path(provider: str, entity: str) -> str:
    if provider == _POLICY.primary.name:
        return f"data/stockanalysis/stocks/{entity}.json"
    if provider == _POLICY.fallback.name:
        return f"data/yf/finance/{entity}.json"
    _fail("provider_invalid", "provider is outside the stock-detail authority set")


def _validate_provider_path(
    provider: str,
    entity: str,
    provider_path: str,
    provider_truth_root: Path | None,
) -> None:
    if provider_path != _expected_path(provider, entity):
        _fail("path_invalid", "provider path does not match provider/entity ownership")
    path = PurePosixPath(provider_path)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        _fail("path_invalid", "provider path must be safe and repository-relative")
    if provider_truth_root is None:
        return
    root = Path(provider_truth_root)
    if not root.exists() or root.is_symlink():
        _fail("path_invalid", "provider truth root must be an existing non-symlink directory")
    current = root
    for part in path.parts:
        current = current / part
        if current.is_symlink():
            _fail("path_invalid", "provider path contains a symlink")
        if current.exists() and current.resolve() != root.resolve() and root.resolve() not in current.resolve().parents:
            _fail("path_invalid", "provider path escapes provider truth root")


def _validate_stockanalysis(entity: str, payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != _POLICY.primary.schema:
        _fail("schema_invalid", "StockAnalysis stock-detail schema mismatch")
    if (
        payload.get("source") != "stockanalysis"
        or payload.get("asset_type") != "stock"
        or payload.get("ticker") != entity
    ):
        _fail("identity_mismatch", "StockAnalysis stock-detail identity mismatch")
    normalized = payload.get("normalized")
    if not isinstance(normalized, dict):
        _fail("schema_invalid", "StockAnalysis normalized payload is missing")
    overview = normalized.get("overview")
    quote = normalized.get("quote")
    history = normalized.get("history")
    if not isinstance(overview, dict) or not overview:
        _fail("schema_invalid", "StockAnalysis overview is missing")
    if not isinstance(quote, dict):
        _fail("quote_invalid", "StockAnalysis quote is missing")
    if quote.get("symbol") != entity or quote.get("uid") != entity:
        _fail("identity_mismatch", "StockAnalysis quote identity mismatch")
    _positive_number(quote.get("p"), "StockAnalysis current price")
    _positive_number(quote.get("cl"), "StockAnalysis previous close")
    if not isinstance(history, list) or not history or any(not isinstance(row, dict) for row in history):
        _fail("schema_invalid", "StockAnalysis history is missing")
    for row in history:
        if not isinstance(row.get("t"), str) or not row["t"]:
            _fail("schema_invalid", "StockAnalysis history date is missing")
        _positive_number(row.get("c"), "StockAnalysis history close")


def _validate_yahoo(entity: str, payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != _POLICY.fallback.schema:
        _fail("schema_invalid", "Yahoo stock-detail schema mismatch")
    if payload.get("ticker") != entity:
        _fail("identity_mismatch", "Yahoo stock-detail wrapper identity mismatch")
    data = payload.get("data")
    info = data.get("info") if isinstance(data, dict) else None
    history = data.get("history_1y") if isinstance(data, dict) else None
    if not isinstance(info, dict) or info.get("quoteType") != "EQUITY":
        _fail("asset_type_invalid", "Yahoo stock-detail quoteType must be EQUITY")
    if info.get("symbol") is not None and info.get("symbol") not in {entity, yahoo_provider_symbol(entity)}:
        _fail("identity_mismatch", "Yahoo stock-detail quote identity mismatch")
    current = info.get("currentPrice", info.get("regularMarketPrice"))
    previous = info.get("previousClose", info.get("regularMarketPreviousClose"))
    _positive_number(current, "Yahoo current price")
    _positive_number(previous, "Yahoo previous close")
    if not isinstance(history, list) or not history or any(not isinstance(row, dict) for row in history):
        _fail("schema_invalid", "Yahoo history_1y is missing")
    for row in history:
        if not isinstance(row.get("date"), str) or not row["date"]:
            _fail("schema_invalid", "Yahoo history date is missing")
        _positive_number(row.get("Close"), "Yahoo history close")


def is_enrolled_stock_detail(entity: str) -> bool:
    return entity in _ENROLLED


def validate_stock_detail_candidate(
    *,
    provider: str,
    entity: str,
    provider_path: str,
    payload_bytes: bytes,
    observed_at: str,
    expected_sha256: str | None = None,
    provider_truth_root: Path | None = None,
) -> ValidatedStockDetail:
    _validate_entity(entity)
    if not is_enrolled_stock_detail(entity):
        _fail("not_enrolled", "entity is outside the frozen stock-detail cohort")
    _validate_provider_path(provider, entity, provider_path, provider_truth_root)
    try:
        provider_policy = _POLICY.provider(provider)
    except KeyError:
        _fail("provider_invalid", "provider is outside the stock-detail authority set")
    payload_sha256 = hashlib.sha256(payload_bytes).hexdigest()
    if expected_sha256 is not None and payload_sha256 != expected_sha256:
        _fail("digest_mismatch", "stock-detail payload digest mismatch")
    payload = _strict_json_bytes(payload_bytes)
    source_as_of = (
        _stockanalysis_source_as_of(payload)
        if provider == _POLICY.primary.name
        else _yahoo_source_as_of(payload)
    )
    source_time = _timestamp(source_as_of, "source_as_of")
    observed_time = _timestamp(observed_at, "observed_at")
    if source_time > observed_time:
        _fail("time_invalid", "source_as_of cannot follow observed_at")
    if provider == _POLICY.primary.name:
        _validate_stockanalysis(entity, payload)
    else:
        _validate_yahoo(entity, payload)
    return ValidatedStockDetail(
        provider=provider,
        endpoint_family=provider_policy.endpoint_family,
        provider_schema=provider_policy.schema,
        entity=entity,
        provider_path=provider_path,
        source_as_of=source_as_of,
        payload_sha256=payload_sha256,
        payload_bytes=payload_bytes,
    )


def _encoded_origin(origin: str) -> tuple[str, dict[str, str]]:
    if origin == "manual":
        return "rebuild", {"collection_origin": "manual"}
    if origin == "natural":
        _fail("origin_invalid", "natural stock-detail observations require a separately gated lane")
    if origin not in {"cache", "rebuild", "migration"}:
        _fail("origin_invalid", "unsupported stock-detail observation origin")
    return origin, {}


def record_stock_detail_success(
    *,
    store: DataSupplyStateStore,
    candidate: ValidatedStockDetail,
    observed_at: str,
    origin: str = "manual",
    rollback_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    verified = validate_stock_detail_candidate(
        provider=candidate.provider,
        entity=candidate.entity,
        provider_path=candidate.provider_path,
        payload_bytes=candidate.payload_bytes,
        observed_at=observed_at,
        expected_sha256=candidate.payload_sha256,
    )
    if verified != candidate:
        _fail("candidate_forged", "validated stock-detail candidate metadata mismatch")
    encoded_origin, extension = _encoded_origin(origin)
    row = {
        "schema_version": "data-supply-observation/v1",
        "provider": candidate.provider,
        "endpoint_family": candidate.endpoint_family,
        "domain": "stock_detail",
        "entity": candidate.entity,
        "provider_path": candidate.provider_path,
        "payload_sha256": candidate.payload_sha256,
        "provider_schema": candidate.provider_schema,
        "source_as_of": candidate.source_as_of,
        "observed_at": observed_at,
        "validation_status": "valid",
        "reason_code": "contract_valid",
        "observation_origin": encoded_origin,
        **extension,
    }
    row["event_id"] = deterministic_event_id("observation", row)
    store.store_provider_object(
        observation=row,
        payload=candidate.payload_bytes,
        rollback_context=rollback_context,
    )
    store.record_observation(row)
    return row


def record_stock_detail_failure(
    *,
    store: DataSupplyStateStore,
    provider: str,
    entity: str,
    provider_path: str,
    observed_at: str,
    reason_code: str,
    failure_detail: str,
    origin: str = "manual",
) -> dict[str, Any]:
    _validate_entity(entity)
    if not is_enrolled_stock_detail(entity):
        _fail("not_enrolled", "entity is outside the frozen stock-detail cohort")
    _validate_provider_path(provider, entity, provider_path, None)
    try:
        provider_policy = _POLICY.provider(provider)
    except KeyError:
        _fail("provider_invalid", "provider is outside the stock-detail authority set")
    _timestamp(observed_at, "observed_at")
    encoded_origin, extension = _encoded_origin(origin)
    detail_sha256 = hashlib.sha256(failure_detail.encode("utf-8")).hexdigest()
    descriptor = {
        "provider": provider,
        "endpoint_family": provider_policy.endpoint_family,
        "domain": "stock_detail",
        "entity": entity,
        "observed_at": observed_at,
        "reason_code": reason_code,
        "failure_detail_sha256": detail_sha256,
    }
    row = {
        "schema_version": "data-supply-observation/v1",
        "provider": provider,
        "endpoint_family": provider_policy.endpoint_family,
        "domain": "stock_detail",
        "entity": entity,
        "provider_path": provider_path,
        "payload_sha256": canonical_sha256(descriptor),
        "provider_schema": provider_policy.schema,
        "source_as_of": None,
        "observed_at": observed_at,
        "validation_status": "invalid",
        "reason_code": reason_code,
        "observation_origin": encoded_origin,
        "payload_available": False,
        "failure_detail_sha256": detail_sha256,
        **extension,
    }
    row["event_id"] = deterministic_event_id("observation", row)
    store.record_observation(row)
    return row


__all__ = [
    "FROZEN_STOCK_DETAIL_TICKERS",
    "FROZEN_TICKER_SHA256",
    "StockDetailValidationError",
    "ValidatedStockDetail",
    "is_enrolled_stock_detail",
    "record_stock_detail_failure",
    "record_stock_detail_success",
    "validate_stock_detail_candidate",
]
