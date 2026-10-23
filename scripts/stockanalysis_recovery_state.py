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
_EVENT_DATE_SURFACES = {
    "earnings_calendar", "ipos_calendar", "actions_recent", "actions_splits",
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


def failure_class(error: str | None) -> str:
    text = str(error or "").lower()
    if "provider_ticker_redirect:" in text:
        return "provider_ticker_redirect"
    if "svelte_contract_drift:" in text:
        return "provider_contract_drift"
    if "404" in text:
        return "provider_not_found"
    if "selected yahoo etf immutable source is invalid" in text:
        return "fallback_source_invalid"
    if "regress" in text or "loses canonical" in text:
        return "candidate_regression"
    if "invalid holding" in text:
        return "holdings_invalid"
    return "other"


def failure_counter(state: dict) -> tuple[int, bool]:
    count = state.get("failure_count")
    if isinstance(count, int) and not isinstance(count, bool) and count > 0:
        return count, state.get("failure_count_is_lower_bound") is True
    # Legacy rows predate the counter. The recorded failure proves at least one
    # attempt; do not invent the missing history or report it as zero failures.
    if state.get("retry") is True and state.get("latest_failure"):
        return 1, True
    return 0, False


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




def etf_display_daily_history(payload: dict) -> list | None:
    """Select a whole dated provider series; never splice adjusted and native prices."""
    normalized = payload.get("normalized") or {}
    selected = normalized.get("daily_history_selection")
    if selected is None:
        return (payload.get("raw", {}).get("history_periods") or {}).get("daily_1y")
    if not isinstance(selected, dict) or selected.get("provider") != "yahoo_finance":
        return None
    for archive in normalized.get("history_archive") or []:
        if (archive.get("provider") == "yahoo_finance"
                and archive.get("payload_sha256") == selected.get("payload_sha256")
                and _archive_record_dates(archive, payload.get("ticker"))):
            return json.loads(archive["source_payload"])["raw"]["yf"]["history_1y"]
    return None


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
    daily = etf_display_daily_history(payload) if normalized.get("daily_history_selection") else periods.get("daily_1y")
    history_dates = [stamp for row in daily if isinstance(row, dict)
                     if (stamp := _iso_timestamp(row.get("date") or row.get("t") or row.get("time"))) is not None] if isinstance(daily, list) else []
    history_stamp = max(history_dates) if history_dates else None
    if normalized.get("daily_history_selection") and history_stamp is None:
        return None
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
                # Match the producer's utc_iso representation of provider epochs.
                return stamp.replace(microsecond=0)
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


def _yahoo_priceless_row(rows: list, index: int) -> bool:
    """Yahoo history keeps two price-less rows on purpose (fetch-yf-finance
    compact_history): a distribution-only day anywhere, and the still-open
    session as the last row. Neither is a priced day; every other row needs a close."""
    row = rows[index]
    if not isinstance(row, dict) or set(row) != {"date", "Volume", "Dividends", "Stock Splits"}:
        return False
    values = [row[key] for key in ("Volume", "Dividends", "Stock Splits")]
    if not all(isinstance(value, (int, float)) and not isinstance(value, bool)
               and math.isfinite(value) and value >= 0 for value in values):
        return False
    volume, dividends, splits = values
    return ((volume == 0 and (dividends > 0 or splits > 0))
            or (index == len(rows) - 1 and volume > 0 and dividends == 0 and splits == 0))


def _etf_history_dates(rows: Any) -> tuple[datetime, datetime] | None:
    if not isinstance(rows, list) or not rows:
        return None
    dates = []
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            return None
        if _yahoo_priceless_row(rows, index):
            continue
        stamp = _iso_timestamp(row.get("date") or row.get("t") or row.get("time"))
        close = row.get("close", row.get("Close", row.get("c")))
        if stamp is None or not isinstance(close, (int, float)) or isinstance(close, bool) or not math.isfinite(close):
            return None
        dates.append(stamp)
    return (min(dates), max(dates)) if dates else None


def _etf_history_date_set(rows: Any) -> set[str] | None:
    if _etf_history_dates(rows) is None:
        return None
    dates = [str(row.get("date") or row.get("t") or row.get("time"))[:10]
             for index, row in enumerate(rows) if not _yahoo_priceless_row(rows, index)]
    return set(dates) if len(set(dates)) == len(dates) else None


OPTIONAL_ETF_HISTORY_PERIODS = frozenset({
    "weekly_1y",
    "monthly_1y",
    "weekly_3y",
    "monthly_3y",
    "monthly_5y",
})


def _aware_archive_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value or _DATE_RE.fullmatch(value):
        return None
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00" if value.endswith("Z") else value)
    except ValueError:
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo is not None and parsed.utcoffset() is not None else None


def _stockanalysis_archive_dates(archive: dict, ticker: str, prior_archives: list[dict]) -> set[str] | None:
    """Verify a native history projection against the prior canonical byte digest."""
    if (archive.get("archive_schema") != "stockanalysis-native-history/v1"
            or archive.get("price_basis") != "stockanalysis_native"
            or not isinstance(archive.get("source_payload"), str)
            or not isinstance(archive.get("payload_sha256"), str)
            or not re.fullmatch(r"[0-9a-f]{64}", archive["payload_sha256"])
            or not isinstance(archive.get("original_payload_sha256"), str)
            or not re.fullmatch(r"[0-9a-f]{64}", archive["original_payload_sha256"])):
        return None
    try:
        projection_bytes = archive["source_payload"].encode("utf-8")
        if (len(projection_bytes) > MAX_ETF_HISTORY_ARCHIVE_BYTES
                or _sha256(projection_bytes) != archive["payload_sha256"]):
            return None
        source = json.loads(projection_bytes)
        if (not isinstance(source, dict) or source.get("schema_version") != "stockanalysis/v1"
                or source.get("source") != "stockanalysis" or source.get("asset_type") != "etf"
                or source.get("source_provider") not in (None, "stockanalysis")
                or source.get("ticker") != ticker or source.get("source_as_of") != archive.get("source_as_of")
                or source.get("fetched_at") != archive.get("fetched_at")):
            return None
        if projection_bytes != (json.dumps(source, ensure_ascii=False, indent=2) + "\n").encode("utf-8"):
            return None
        source_stamp = _aware_archive_timestamp(source["source_as_of"])
        fetched_stamp = _aware_archive_timestamp(source["fetched_at"])
        if (source_stamp is None or fetched_stamp is None or source_stamp > fetched_stamp
                or fetched_stamp > datetime.now(timezone.utc)):
            return None
        normalized = source.get("normalized")
        raw = source.get("raw")
        if not isinstance(normalized, dict) or not isinstance(raw, dict):
            return None
        raw_periods = raw.get("history_periods")
        normalized_periods = normalized.get("history_periods")
        if not isinstance(raw_periods, dict) or not isinstance(normalized_periods, dict):
            return None
        if raw_periods.keys() != normalized_periods.keys():
            return None
        for period, rows in raw_periods.items():
            if not isinstance(period, str) or rows != normalized_periods[period]:
                return None
            if period in OPTIONAL_ETF_HISTORY_PERIODS and isinstance(rows, list) and not rows:
                continue
            period_bounds = _etf_history_dates(rows)
            period_days = _etf_history_date_set(rows)
            history_bound = fetched_stamp if issuer_holdings_snapshot(source) else source_stamp
            if period_bounds is None or period_days is None or period_bounds[1].date() > history_bound.date():
                return None
            for row in rows:
                if any(not isinstance(value, (int, float)) or isinstance(value, bool)
                       or not math.isfinite(value) or (key in {"o", "h", "l", "c", "a"} and value <= 0)
                       or (key == "v" and value < 0)
                       for key, value in row.items() if key not in {"t", "date", "time"}):
                    return None
        raw_daily = raw_periods.get("daily_1y")
        dates = _etf_history_dates(raw_daily)
        date_set = _etf_history_date_set(raw_daily)
        if dates is None or date_set is None:
            return None
        if (archive.get("history_first") != dates[0].date().isoformat()
                or archive.get("history_last") != dates[1].date().isoformat()):
            return None
        refs = archive.get("prior_archive_sha256")
        prior_by_digest = {item.get("payload_sha256"): item for item in prior_archives}
        if (not isinstance(refs, list) or len(refs) != len(set(refs))
                or any(ref not in prior_by_digest for ref in refs)):
            return None
        if refs:
            if normalized.get("history_archive") != refs:
                return None
            normalized["history_archive"] = [prior_by_digest[ref] for ref in refs]
        elif "history_archive" in normalized:
            return None
        original_bytes = (json.dumps(source, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        if _sha256(original_bytes) != archive["original_payload_sha256"]:
            return None
        if _etf_provider_source(source) != source_stamp:
            return None
        return date_set
    except (ValueError, TypeError, AttributeError, OverflowError, OSError, UnicodeError):
        return None


def legacy_yahoo_collection_clock(source: dict) -> bool:
    """Recognize retained v1 snapshots whose old source label was collection time.

    This permits archiving/replacement, never treating collection time as a
    fresh market observation. The original document remains unchanged.
    """
    if (source.get("schema_version") != "yf-etf-detail/v1"
            or source.get("source_provider") != "yahoo_finance"
            or source.get("source_as_of") != source.get("fetched_at")):
        return False
    data = (source.get("raw") or {}).get("yf") or {}
    info = data.get("info") or {}
    funds = data.get("funds_data") or {}
    if (str(info.get("symbol") or funds.get("symbol") or "").upper() != source.get("ticker")
            or str(info.get("quoteType") or funds.get("quote_type") or "").upper() not in {"ETF", "MUTUALFUND"}):
        return False
    days = _etf_history_date_set(data.get("history_1y"))
    fetched = _iso_timestamp(source.get("fetched_at"))
    return bool(days and fetched and max(days) <= fetched.date().isoformat())


def _archive_record_dates(archive: dict, ticker: str, prior_archives: list[dict] | None = None) -> set[str] | None:
    if archive.get("provider") == "stockanalysis":
        return _stockanalysis_archive_dates(archive, ticker, prior_archives or [])
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
        if archive.get("source_clock_basis") == "legacy_collection_time":
            if not legacy_yahoo_collection_clock(source):
                return None
        elif isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
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
    for index, archive in enumerate(archives):
        if not isinstance(archive, dict):
            return None
        dates = _archive_record_dates(archive, ticker, archives[:index])
        if dates is None:
            return None
        all_dates.update(dates)
    return all_dates


def archived_etf_history_periods(payload: dict, provider: str | None = None) -> dict[str, set[str]] | None:
    """Return verified dates by their original native period; Yahoo has only daily_1y."""
    normalized = payload.get("normalized") if isinstance(payload.get("normalized"), dict) else {}
    archives = normalized.get("history_archive")
    if archives is None:
        return {}
    ticker = payload.get("ticker")
    if not isinstance(archives, list) or not archives or not isinstance(ticker, str):
        return None
    periods: dict[str, set[str]] = {}
    for index, archive in enumerate(archives):
        if not isinstance(archive, dict):
            return None
        daily = _archive_record_dates(archive, ticker, archives[:index])
        if daily is None:
            return None
        if provider is not None and archive.get("provider") != provider:
            continue
        if archive.get("provider") == "yahoo_finance":
            periods.setdefault("daily_1y", set()).update(daily)
            continue
        source = json.loads(archive["source_payload"])
        raw_periods = source["raw"]["history_periods"]
        for period, rows in raw_periods.items():
            if period in OPTIONAL_ETF_HISTORY_PERIODS and isinstance(rows, list) and not rows:
                continue
            days = _etf_history_date_set(rows)
            if days is None:
                return None
            periods.setdefault(period, set()).update(days)
    return periods


def validate_etf_history_archive(payload: dict) -> bool:
    """Keep native period prices separate from bounded exact Yahoo records."""
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
    if any(normalized_periods.get(period) != rows for period, rows in raw_periods.items()):
        return False
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
    return all(_archive_record_dates(item, ticker, archives[:index]) is not None
               for index, item in enumerate(archives))


def _harbor_holdings_snapshot(payload: dict) -> datetime | None:
    """Recognize HBIL's existing verified issuer-HTML component without relabelling it."""
    if payload.get("ticker") != "HBIL" or payload.get("asset_type") != "etf":
        return None
    raw = payload.get("raw") or {}
    provenance = raw.get("official_holdings")
    component = raw.get("holdings")
    normalized = payload.get("normalized") or {}
    url = "https://www.harborcapital.com/etf/hbil/"
    contract = (payload.get("endpoint_contracts") or {}).get("holdings") or {}
    if (not isinstance(provenance, dict) or not isinstance(component, dict)
            or provenance.get("provider") != "harborcapital"
            or provenance.get("landing_page") != url
            or payload.get("holdings_source") != provenance
            or (payload.get("endpoints") or {}).get("holdings") != url
            or contract != {"format": "issuer_html", "contract": "verified_official_etf_holdings/v1",
                            "provider": "harborcapital"}
            or not re.fullmatch(r"[0-9a-f]{64}", str(provenance.get("page_sha256", "")))):
        return None
    rows = component.get("holdings")
    displayed = normalized.get("holdings")
    if (not isinstance(rows, list) or not rows or not isinstance(displayed, list)
            or len(rows) != len(displayed) or component.get("count") != len(rows)
            or normalized.get("holding_count") != len(rows)):
        return None
    for source, row in zip(rows, displayed):
        if (not isinstance(source, dict) or not isinstance(row, dict)
                or not source.get("n") or row.get("raw") != source
                or row.get("name") != source.get("n")
                or row.get("weight_pct") != source.get("as")
                or row.get("shares") != source.get("sh")
                or row.get("symbol") != source.get("s")
                or not isinstance(source.get("raw"), dict)
                or source["raw"].get("Company Name") != source.get("n")
                or isinstance(source.get("as"), bool)
                or not isinstance(source.get("as"), (int, float))
                or not math.isfinite(source["as"])):
            return None
    date = _iso_timestamp(component.get("date"))
    fetched = _iso_timestamp(payload.get("fetched_at"))
    if (date is None or fetched is None or date > fetched
            or date != _iso_timestamp(provenance.get("source_as_of"))
            or date != _iso_timestamp(normalized.get("holdings_updated"))):
        return None
    return date


def issuer_holdings_snapshot(payload: dict) -> datetime | None:
    """Validate the displayed issuer snapshot independently of position count."""
    if payload.get("ticker") == "HBIL":
        return _harbor_holdings_snapshot(payload)
    raw = payload.get("raw") or {}
    issuer = raw.get("official_issuer")
    normalized = payload.get("normalized") or {}
    if not isinstance(issuer, dict) or issuer.get("ticker") != payload.get("ticker"):
        return None
    ticker = payload.get("ticker")
    issuer_date = _iso_timestamp((issuer.get("field_dates") or {}).get("holdings"))
    expected = ({symbol: f"https://corgiinvest.com/{symbol.lower()}"
                 for symbol in ("ACHX", "ARMA", "AVGC", "IOSX", "KEYX", "ONDC", "LRNX",
                                "CIFC", "EO", "GMEC", "IONC", "MIC", "ORAC", "XQTM", "BRZX")}
                | {symbol: "https://www.innovatoretfs.com/etf/xt_holdings.csv"
                   for symbol in ("ACII", "BDEC", "BJUL", "BJUN", "BNOV", "BSTP", "EBUF", "EJAN",
                                  "EJUL", "IAPR", "PMAR", "PMAY", "PSTP", "QBUF", "RBUF", "TBJL",
                                  "AJAN", "AJUL", "BMAR", "IBUF", "IDEC", "IFEB", "IJAN", "IJUL",
                                  "IJUN", "IMAR", "IMAY", "INOV", "JAJL", "JULH", "JULJ", "KAUG",
                                  "KDEC", "KJAN", "KJUN", "KMAR", "KMAY", "KOCT", "KSEP", "LJUL",
                                  "NAUG", "NDEC", "NFEB", "NJAN", "NJUL", "UFEB", "UJAN", "USEP",
                                  "XDQQ", "XTJA", "XTJL", "XTOC", "ZAUG", "ZDEK", "ZFEB", "ZJAN",
                                  "ZJUL", "ZNOV", "ZOCT", "ZSEP")}
                | {"MWHS": "https://www.skylaretfs.com/mwhs",
                   "TBIL": "https://www.fminvest.com/api/v1/etfs/1/holdings",
                   "DWUS": "https://advisorshares.com/wp-content/uploads/csv/holdings/AdvisorShares_DWUS_Holdings_File.csv",
                   "HYTR": "https://counterpointfunds.com/etfdata/holdings.csv",
                   "BIL": "https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/holdings-daily-us-en-bil.xlsx",
                   "BILS": "https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/holdings-daily-us-en-bils.xlsx",
                   "IWMW": "https://www.ishares.com/us/products/336263/ishares-russell-2000-buywrite-etf/latest-holdings.csv",
                   "LQDW": "https://www.ishares.com/us/products/329120/ishares-investment-grade-corporate-bond-buywrite-strategy-etf/latest-holdings.csv",
                   "IBGM": "https://www.ishares.com/us/products/350032/ishares-ibonds-dec-2056-term-treasury-etf/latest-holdings.csv",
                   "XLBI": "https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/holdings-daily-us-en-xlbi.xlsx",
                   "XLCI": "https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/holdings-daily-us-en-xlci.xlsx",
                   "XLFI": "https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/holdings-daily-us-en-xlfi.xlsx",
                   "THYP": "https://api.primary.21shares.com/api/product_details/THYP",
                   # AllianzIM fund pages (dated portfolio state) and ProShares
                   # fund pages (dated holdings table). URLs must match the adapter
                   # source_url exactly.
                   **{symbol: f"https://www.allianzim.com/etfs/{symbol.lower()}/"
                      for symbol in ("JANT", "JANU", "JANW", "JNEU", "JULT", "JULU",
                                     "JULW", "MARU", "MAYU")},
                   "BITI": "https://www.proshares.com/our-etfs/leveraged-and-inverse/biti",
                   "EETH": "https://www.proshares.com/our-etfs/strategic/eeth",
                   "EUO": "https://www.proshares.com/our-etfs/leveraged-and-inverse/euo",
                   "SETH": "https://www.proshares.com/our-etfs/leveraged-and-Inverse/seth",
                   "SVXY": "https://www.proshares.com/our-etfs/strategic/svxy/",
                   "HXF": "https://mast-funds.com/wp-admin/admin-post.php?action=download_holdings_csv&ticker=HXF",
                   **{symbol: f"https://jdkfnvgkfwotjlyovbrk.supabase.co/functions/v1/fund-public-api?ticker={symbol}&view=all"
                      for symbol in ("FOTO", "DCAP")}})
    if ticker == "SPBC" and issuer_date is not None:
        expected["SPBC"] = ("https://www.simplify.us/sites/default/files/excel_holdings/"
                            f"{issuer_date:%Y_%m_%d}_Simplify_Portfolio_EOD_Tracker.xlsx")
    if ticker not in expected or issuer.get("source_url") != expected[ticker]:
        return None
    rows = issuer.get("holdings")
    snapshot = issuer.get("holdings_snapshot") or {}
    date = _iso_timestamp((issuer.get("field_dates") or {}).get("holdings"))
    fetched = _iso_timestamp(payload.get("fetched_at"))
    if (not isinstance(rows, list) or not rows or normalized.get("holdings") != rows
            or snapshot.get("full_published_snapshot") is not True
            or snapshot.get("identity") != ticker or snapshot.get("row_count") != len(rows)
            or _iso_timestamp(snapshot.get("snapshot_date")) != date
            or normalized.get("holding_count") != len(rows)
            or any(not isinstance(row, dict) or not row.get("name") for row in rows)
            or date is None or fetched is None or date > fetched
            or date != _iso_timestamp(normalized.get("holdings_updated"))):
        return None
    return date


def etf_holdings_snapshot(payload: dict) -> dict:
    normalized = payload.get("normalized") or {}
    return {"provider": (payload.get("holdings_source") or {}).get("provider") or payload.get("source"),
            "source_as_of": normalized.get("holdings_updated"),
            "holdings": normalized.get("holdings"), "holding_count": normalized.get("holding_count")}


def etf_detail_regression(candidate: dict, baseline: dict) -> str | None:
    """Compare displayed detail, independently of provider rank and fetch time."""
    old = baseline.get("normalized")
    new = candidate.get("normalized")
    if not isinstance(old, dict):
        return None
    if not isinstance(new, dict) or not isinstance(new.get("overview"), dict):
        return "normalized.overview"

    if candidate.get("source") == baseline.get("source") == "stockanalysis":
        old_chart = ((baseline.get("raw") or {}).get("overview") or {}).get("chart")
        new_chart = ((candidate.get("raw") or {}).get("overview") or {}).get("chart")
        old_rows = old_chart.get("data") if isinstance(old_chart, dict) else None
        new_rows = new_chart.get("data") if isinstance(new_chart, dict) else None
        # Intraday chart availability is independent of daily history and quote
        # freshness. An empty provider chart must not erase the complete detail.
        if isinstance(old_rows, list) and old_rows and (not isinstance(new_rows, list) or not new_rows):
            return "overview.chart"

    def present(value: Any) -> bool:
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return math.isfinite(value)
        if isinstance(value, str):
            return value.strip().lower() not in {"", "-", "—", "n/a", "none", "null", "nan"}
        return value is not None and value != "" and value != [] and value != {}

    def archived_component(field: str, value: Any) -> bool:
        archives = new.get("history_archive") or []
        if not isinstance(archives, list):
            return False
        for index, archive in enumerate(archives):
            if (not isinstance(archive, dict) or archive.get("provider") != "stockanalysis"
                    or _archive_record_dates(archive, candidate.get("ticker"), archives[:index]) is None):
                continue
            source = json.loads(archive["source_payload"])
            if (source.get("ticker") != baseline.get("ticker")
                    or source.get("source_as_of") != baseline.get("source_as_of")
                    or source.get("fetched_at") != baseline.get("fetched_at")):
                continue
            original = source.get("normalized") or {}
            if field.startswith("overview."):
                original = original.get("overview") or {}
                field_key = field.removeprefix("overview.")
            else:
                field_key = field
            if original.get(field_key) == value:
                return True
        return False

    old_overview = old.get("overview") if isinstance(old.get("overview"), dict) else {}
    for field in ("aum", "expenseRatio", "dividendYield", "inception", "sharesOut"):
        if present(old_overview.get(field)) and not present(new["overview"].get(field)):
            raw_overview = (candidate.get("raw") or {}).get("overview") or {}
            if (field in {"dividendYield", "sharesOut"} and candidate.get("source") == baseline.get("source") == "stockanalysis"
                    and field in raw_overview and raw_overview[field] is None
                    and archived_component(f"overview.{field}", old_overview[field])):
                continue
            return f"overview.{field}"
    old_holdings = old.get("holdings") if isinstance(old.get("holdings"), list) else []
    new_holdings = new.get("holdings") if isinstance(new.get("holdings"), list) else []
    def holding_rows(rows: list) -> int:
        return sum(isinstance(row, dict) and any(present(row.get(key)) for key in ("symbol", "ticker", "name")) for row in rows)

    def complete_native_holdings_date(payload: dict, rows: list) -> datetime | None:
        if (payload.get("source") != "stockanalysis" or payload.get("schema_version") != "stockanalysis/v1"
                or payload.get("asset_type") != "etf"):
            return None
        raw = payload.get("raw") if isinstance(payload.get("raw"), dict) else {}
        if raw.get("official_holdings") is not None:
            return None
        holdings = raw.get("holdings") if isinstance(raw.get("holdings"), dict) else {}
        raw_rows = holdings.get("holdings")
        count = holdings.get("count")
        normalized = payload.get("normalized") or {}
        normalized_count = normalized.get("holding_count")
        if (not isinstance(count, (int, float)) or isinstance(count, bool) or not math.isfinite(count)
                or not isinstance(normalized_count, (int, float)) or isinstance(normalized_count, bool)
                or not isinstance(raw_rows, list) or not rows
                or count != normalized_count or count != len(raw_rows)
                or count != len(rows) or count != holding_rows(rows)
                or any(not isinstance(original, dict) or row.get("raw") != original
                       or row.get("name") != (original.get("n") or original.get("name"))
                       or row.get("symbol") != (str(original.get("s") or original.get("symbol") or "")
                                                .strip().lstrip("$").upper() or None)
                       for row, original in zip(rows, raw_rows))):
            return None
        date = _iso_timestamp(holdings.get("date"))
        fetched = _iso_timestamp(payload.get("fetched_at"))
        if (date is None or date != _iso_timestamp(normalized.get("holdings_updated"))
                or fetched is None or date > fetched):
            return None
        return date

    issuer_date = issuer_holdings_snapshot(candidate)
    old_date = _iso_timestamp(old.get("holdings_updated"))
    preserved_issuer_transition = bool(
        issuer_date and (old_date is None or issuer_date >= old_date)
        and etf_holdings_snapshot(baseline) in (new.get("holdings_history") or []))
    new_native_date = complete_native_holdings_date(candidate, new_holdings)
    preserved_native_transition = bool(
        candidate.get("source") == baseline.get("source") == "stockanalysis"
        and candidate.get("ticker") == baseline.get("ticker")
        and new_native_date and old_date and new_native_date > old_date
        and etf_holdings_snapshot(baseline) in (new.get("holdings_history") or [])
        and archived_component("holdings", old_holdings)
        and archived_component("holding_count", old.get("holding_count")))
    if (old_holdings and holding_rows(new_holdings) < holding_rows(old_holdings)
            and not preserved_issuer_transition and not preserved_native_transition):
        old_date = complete_native_holdings_date(baseline, old_holdings)
        new_date = complete_native_holdings_date(candidate, new_holdings)
        # A later complete fund portfolio can contain fewer positions. Both
        # totals must come from the native provider, with every row retained;
        # a smaller sample or another provider's count cannot prove completeness.
        if (not isinstance(baseline.get("ticker"), str) or not baseline["ticker"]
                or candidate.get("ticker") != baseline["ticker"]
                or old_date is None or new_date is None or new_date <= old_date):
            return "holdings"
    primary_recovery = (candidate.get("source") == "stockanalysis"
                        and baseline.get("source_provider") == "yahoo_finance")
    # Primary recovery still preserves holdings, prices, financial essentials
    # and history. Yahoo-only allocation enrichments are optional for that
    # provider transition; they cannot make a one-holding fallback authoritative.
    surfaces = () if primary_recovery else ("countries", "sectors", "asset_allocation")
    for field in ("holding_count", "holdings_updated", *surfaces):
        if present(old.get(field)) and not present(new.get(field)):
            return field
    old_count, new_count = old.get("holding_count"), new.get("holding_count")
    if present(old_count):
        if (not isinstance(new_count, (int, float)) or isinstance(new_count, bool)
                or not math.isfinite(new_count) or new_count < len(new_holdings)):
            return "holding_count"
        # A provider's total fund count is not equivalent to another provider's
        # top-holdings sample count. Same-provider counts can honestly change.
        if (baseline.get("source") != candidate.get("source")
                and isinstance(old_count, (int, float)) and new_count < old_count
                and not preserved_issuer_transition):
            return "holding_count"
    old_quote = old.get("quote") if isinstance(old.get("quote"), dict) else {}
    new_quote = new.get("quote") if isinstance(new.get("quote"), dict) else {}
    old_price, new_price = old_quote.get("p"), new_quote.get("p")
    if isinstance(old_price, (int, float)) and not isinstance(old_price, bool) and math.isfinite(old_price) and old_price > 0:
        if (not isinstance(new_price, (int, float)) or isinstance(new_price, bool)
                or not math.isfinite(new_price) or new_price <= 0):
            return "quote"

    old_periods = dict(old.get("history_periods") or {})
    new_periods = dict(new.get("history_periods") or {})
    if old.get("history") and not old_periods.get("daily_1y"):
        old_periods["daily_1y"] = old["history"]
    if new.get("history") and not new_periods.get("daily_1y"):
        new_periods["daily_1y"] = new["history"]
    archive = archived_etf_history(candidate)
    previous_archive = archived_etf_history(baseline)
    if archive is None or previous_archive is None or not previous_archive <= archive:
        return "history_archive"
    same_native = candidate.get("source") == baseline.get("source") == "stockanalysis"
    provider = "stockanalysis" if same_native else None
    archived_periods = archived_etf_history_periods(candidate, provider)
    previous_periods = archived_etf_history_periods(baseline, provider)
    if (archived_periods is None or previous_periods is None
            or any(not days <= archived_periods.get(period, set())
                   for period, days in previous_periods.items())):
        return "history_archive"
    for period, rows in old_periods.items():
        old_dates = _etf_history_date_set(rows)
        if not old_dates:
            continue
        new_dates = _etf_history_date_set(new_periods.get(period))
        if not new_dates or max(new_dates) < max(old_dates):
            old_daily = _etf_history_date_set(old_periods.get("daily_1y"))
            new_daily = _etf_history_date_set(new_periods.get("daily_1y"))
            # A restarted native price series may not have a completed month
            # yet. Keep its old aggregates in the verified native archive;
            # missing/malformed periods and truncated daily windows still fail.
            if (same_native and candidate.get("ticker") == baseline.get("ticker")
                    and period in OPTIONAL_ETF_HISTORY_PERIODS
                    and new_periods.get(period) == []
                    and period not in ((candidate.get("raw") or {}).get("history_endpoint_errors") or {})
                    and old_daily and new_daily and min(new_daily) > max(old_daily)
                    and old_dates <= archived_periods.get(period, set())):
                continue
            return f"history_periods.{period}"
        # A rolling window may retire its oldest prefix as the tail advances;
        # an unchanged tail cannot excuse fewer dates or a missing interior.
        advance = _iso_timestamp(max(new_dates)) - _iso_timestamp(max(old_dates))
        floor = _iso_timestamp(min(old_dates)) + advance
        retained = {day for day in old_dates if _iso_timestamp(day) >= floor}
        available = new_dates | archived_periods.get(period, set())
        if not retained <= available:
            return f"history_periods.{period}"
    return None


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
    if payload.get("surface") in _EVENT_DATE_SURFACES:
        # Calendar and corporate-action dates describe events, not when their
        # provider measured the data. An unknown source date stays unknown.
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
                "retry", "current", "lkg", "updated_at", "latest_failure", "failure_count",
                "failure_count_is_lower_bound", "etf_lifecycle"}
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
            # Canonical refreshes can precede recovery-state publication. Rebind
            # a valid current file; retained retry LKG remains immutable.
            if (bound and state.get("retry") is not True
                    and prior.get("path") == self._relative(prior_path)
                    and _sha256(bound[0]) != prior.get("payload_sha256")):
                self.reconcile_current_payload_sha256(kind, entity)
                prior = self._load_state(kind, entity)["current"]
            if bound:
                canonical_before = _iso_timestamp(payload_source_fields(kind, bound[1]).get("source_as_of"))
                if (canonical_before is not None and (after is None or after < canonical_before)
                        and issuer_holdings_snapshot(payload) is None):
                    return False
            if (not bound or prior.get("path") != self._relative(prior_path)
                    or _sha256(bound[0]) != prior.get("payload_sha256")
                    or etf_detail_regression(payload, bound[1]) is not None):
                return False
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
        if kind == "surface" and entity in _EVENT_DATE_SURFACES and prior:
            # Older metadata derived the marker from event dates. Re-read
            # only its exact bound bytes when this surface is touched.
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
            "failure_count": failure_counter(state)[0] + 1,
            "failure_count_is_lower_bound": failure_counter(state)[1],
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
        state.pop("failure_count_is_lower_bound", None)
        if kind == "etf" and state.get("etf_lifecycle"):
            state["etf_lifecycle"].update(status="live", method="valid_provider_detail", attempts=[],
                                           returned_at=state["updated_at"])
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
        retry_groups = {}
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
                    category = failure_class(failure.get("error"))
                    retry_groups.setdefault(category, []).append({"artifact_kind": kind, "entity": entity})
                    degraded_details.append({"artifact_kind": kind, "entity": entity,
                        "resolution_state": resolution, "source_as_of": lkg.get("source_as_of"),
                        "failure_observed_at": failure.get("observed_at"), "error": failure.get("error"),
                        "failure_class": category,
                        "failure_count": failure_counter(state)[0],
                        "failure_count_is_lower_bound": failure_counter(state)[1],
                        "data_loss": failure.get("data_loss") is True})
        errors = [row for row in self._results.values() if "error" in row]
        by_kind = {}
        for kind in ARTIFACT_KINDS:
            results = [row for row in self._results.values() if row["artifact_kind"] == kind]
            if results:
                failed = sum("error" in row for row in results)
                by_kind[kind] = {"observed_at": run.get("observed_at"),
                    "attempted": len(results), "successes": len(results) - failed, "failed": failed}
        counts["failed"] = len(errors)
        index = {"schema_version": INDEX_SCHEMA,
            "generated_at": str(run.get("observed_at") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")),
            "counts": counts, "counts_by_kind": counts_by_kind, "retry_artifacts": retry_artifacts,
            "degraded_details": degraded_details,
            "retry_groups": retry_groups,
            "current_results": {"observed_at": run.get("observed_at") if self._results else None,
                "attempted": len(self._results), "successes": len(self._results) - len(errors),
                "failed": len(errors), "errors": errors, "by_kind": by_kind}}
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
