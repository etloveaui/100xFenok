#!/usr/bin/env python3
"""Bounded per-ticker state for the Yahoo quote/history acquisition lane."""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path


ATTEMPT_RETENTION = 14
NEW_LISTING_PENDING_DAYS = 31
ERROR_TEXT_LIMIT = 1000


def _json_bytes(payload: dict) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def _read_json(path: Path) -> dict | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    try:
        tmp.write_bytes(_json_bytes(payload))
        tmp.replace(path)
    finally:
        if tmp.exists():
            tmp.unlink()


def _write_bytes(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    try:
        tmp.write_bytes(payload)
        tmp.replace(path)
    finally:
        if tmp.exists():
            tmp.unlink()


def _bounded_error(value) -> str:
    return str(value or "unknown error")[:ERROR_TEXT_LIMIT]


def _iso_ms(value) -> float | None:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.timestamp() * 1000


def _is_recent_listing(payload: dict, observed_at: str) -> bool:
    first_trade_ms = _iso_ms(payload.get("first_trade_date"))
    observed_ms = _iso_ms(observed_at)
    if first_trade_ms is None or observed_ms is None or first_trade_ms > observed_ms:
        return False
    return observed_ms - first_trade_ms <= NEW_LISTING_PENDING_DAYS * 86400000


def _pending_history_reason(payload: dict, state: dict, observed_at: str) -> str | None:
    if _is_recent_listing(payload, observed_at):
        return "recent_listing"
    pending = state.get("pending") if isinstance(state.get("pending"), dict) else {}
    first_seen_ms = _iso_ms(pending.get("first_seen_at"))
    observed_ms = _iso_ms(observed_at)
    if first_seen_ms is not None and observed_ms is not None:
        return "newly_discovered_no_history" if 0 <= observed_ms - first_seen_ms <= NEW_LISTING_PENDING_DAYS * 86400000 else None
    return "newly_discovered_no_history" if len(state.get("attempts") or []) == 0 else None


def _epoch_iso(value) -> str | None:
    try:
        seconds = float(value)
        if seconds > 10_000_000_000:
            seconds /= 1000
        return datetime.fromtimestamp(seconds, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def _payload_source_fields(payload: dict) -> dict:
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    info = data.get("info") if isinstance(data.get("info"), dict) else {}
    quote = payload.get("quote_as_of") or _epoch_iso(info.get("regularMarketTime"))
    history = data.get("history_1y") if isinstance(data.get("history_1y"), list) else []
    dates = sorted({
        str(row.get("date"))[:10]
        for row in history
        if isinstance(row, dict) and _iso_ms(str(row.get("date") or "")[:10]) is not None
    })
    history_as_of = payload.get("history_as_of") or (dates[-1] if dates else None)
    source_as_of = payload.get("source_as_of") or (
        history_as_of if history_as_of and (not quote or history_as_of <= quote[:10]) else quote
    )
    return {"quote_as_of": quote, "history_as_of": history_as_of, "source_as_of": source_as_of}


def _valid_canonical_payload(payload: dict | None, ticker: str) -> bool:
    if not isinstance(payload, dict):
        return False
    if payload.get("schema_version") != "yf-finance/v2" or payload.get("ticker") != ticker:
        return False
    fetched_ms = _iso_ms(payload.get("fetched_at"))
    if fetched_ms is None:
        return False
    data = payload.get("data")
    if not isinstance(data, dict) or not any(value is not None for value in data.values()):
        return False
    source = _payload_source_fields(payload)
    quote_ms = _iso_ms(source["quote_as_of"])
    history_ms = _iso_ms(source["history_as_of"])
    source_ms = _iso_ms(source["source_as_of"])
    if quote_ms is None and history_ms is None:
        return False
    if source_ms is None or (quote_ms is not None and quote_ms > fetched_ms):
        return False
    if history_ms is not None and history_ms > fetched_ms + 14 * 3600000:
        return False
    return True


def _attempt(run: dict, outcome: str, evidence: dict, *, error: str | None = None) -> dict:
    attempts_used = evidence.get("attempts_used")
    attempts_used = int(attempts_used) if attempts_used is not None else 1
    row = {
        "run_id": str(run.get("run_id") or "local"),
        "run_attempt": int(run.get("run_attempt") or 1),
        "event_name": str(run.get("event_name") or "local"),
        "schedule": str(run.get("schedule") or ""),
        "natural": bool(run.get("natural")),
        "shard": str(run.get("shard") or ""),
        "observed_at": str(run.get("observed_at") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")),
        "outcome": outcome,
        "attempts_used": attempts_used,
        "latency_ms": int(evidence.get("latency_ms") or 0),
        "failures": [
            {**item, "error": _bounded_error(item.get("error"))}
            for item in list(evidence.get("failures") or [])[:6]
            if isinstance(item, dict)
        ],
    }
    if error:
        row["error"] = _bounded_error(error)
    return row


class YahooBatchStateStore:
    """Keep one canonical pointer, one exact LKG, and fourteen attempts per ticker."""

    def __init__(self, root: Path, finance_dir: Path):
        self.root = Path(root)
        self.finance_dir = Path(finance_dir)
        self.ticker_dir = self.root / "tickers"
        self.lkg_dir = self.root / "lkg"

    def _state_path(self, ticker: str) -> Path:
        return self.ticker_dir / f"{ticker}.json"

    def _lkg_path(self, ticker: str) -> Path:
        return self.lkg_dir / f"{ticker}.json"

    def _load_state(self, ticker: str) -> dict:
        return _read_json(self._state_path(ticker)) or {
            "schema_version": "yahoo-batch-quote-history-state/v1",
            "ticker": ticker,
            "attempts": [],
        }

    @staticmethod
    def _append_attempt(state: dict, row: dict) -> None:
        attempts = [item for item in state.get("attempts") or [] if isinstance(item, dict)]
        attempts.append(row)
        state["attempts"] = attempts[-ATTEMPT_RETENTION:]

    def retry_tickers(self, active_universe: set[str]) -> set[str]:
        active = set(active_universe)
        retry = set()
        for ticker in active:
            state = _read_json(self._state_path(ticker))
            if state and state.get("retry") is True:
                retry.add(ticker)
        return retry

    def bootstrap_existing(
        self,
        active_universe: set[str],
        sources: dict[str, list[str]],
        run: dict,
        exclude_tickers: set[str] | None = None,
    ) -> int:
        active = set(active_universe)
        excluded = set(exclude_tickers or set())
        created = 0
        for canonical in sorted(self.finance_dir.glob("*.json")):
            ticker = canonical.stem
            if ticker == "_summary" or ticker not in active or ticker in excluded or self._state_path(ticker).exists():
                continue
            payload = _read_json(canonical)
            if not _valid_canonical_payload(payload, ticker):
                continue
            enriched = {**payload, **_payload_source_fields(payload)}
            self.record_skip(ticker, enriched, run, sources.get(ticker, []))
            created += 1
        return created

    def recovery_candidate_advances(self, ticker: str, payload: dict) -> bool:
        state = self._load_state(ticker)
        if state.get("retry") is not True or state.get("resolution_state") != "lkg_primary":
            return True
        prior = state.get("lkg") if isinstance(state.get("lkg"), dict) else {}
        comparable = 0
        for key in ("quote_as_of", "history_as_of"):
            before = _iso_ms(prior.get(key))
            after = _iso_ms(payload.get(key))
            if before is not None and after is not None:
                comparable += 1
                if after > before:
                    return True
        return comparable == 0

    def record_success(
        self,
        ticker: str,
        payload: dict,
        run: dict,
        discovered_from: list[str],
        evidence: dict,
    ) -> dict:
        path = self.finance_dir / f"{ticker}.json"
        payload_bytes = path.read_bytes()
        state = self._load_state(ticker)
        previous_state = state.get("resolution_state")
        previous_run_id = None
        latest_failure = state.get("latest_failure")
        pending = state.get("pending")
        if isinstance(latest_failure, dict):
            previous_run_id = latest_failure.get("run_id")
        elif isinstance(pending, dict):
            previous_run_id = pending.get("initial_run_id")

        data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
        history = data.get("history_1y")
        has_history = isinstance(history, list) and len(history) > 0
        pending_reason = _pending_history_reason(payload, state, str(run.get("observed_at") or "")) if not has_history else None
        outcome = "fresh" if has_history else "pending_history" if pending_reason else "unavailable"
        attempt = _attempt(run, outcome, evidence)
        self._append_attempt(state, attempt)

        state.update({
            "schema_version": "yahoo-batch-quote-history-state/v1",
            "ticker": ticker,
            "resolution_state": "fresh_primary" if has_history else "pending_history" if pending_reason else "unavailable",
            "retry": not has_history,
            "current": {
                "path": f"data/yf/finance/{ticker}.json",
                "payload_sha256": _sha256(payload_bytes),
                "fetched_at": payload.get("fetched_at"),
                "quote_as_of": payload.get("quote_as_of"),
                "history_as_of": payload.get("history_as_of"),
                "source_as_of": payload.get("source_as_of"),
            },
            "discovered_from": sorted(set(discovered_from)),
            "last_attempt": attempt,
            "updated_at": attempt["observed_at"],
        })

        if has_history:
            state.pop("pending", None)
            if previous_state in {"lkg_primary", "pending_history", "unavailable"} and previous_run_id:
                state["recovered_from_run_id"] = previous_run_id
                state["recovered_at"] = attempt["observed_at"]
                if isinstance(latest_failure, dict):
                    state["last_recovered_failure"] = latest_failure
            state.pop("latest_failure", None)
        elif pending_reason:
            initial_run_id = (
                pending.get("initial_run_id")
                if isinstance(pending, dict) and pending.get("initial_run_id")
                else attempt["run_id"]
            )
            state["pending"] = {
                "missing": ["history"],
                "discovered_from": sorted(set(discovered_from)),
                "first_trade_date": payload.get("first_trade_date"),
                "initial_run_id": initial_run_id,
                "first_seen_at": pending.get("first_seen_at") if isinstance(pending, dict) and pending.get("first_seen_at") else attempt["observed_at"],
                "expected_resolution": "next_natural_yahoo_run",
                "reason": pending_reason,
                "message": (
                    f"{ticker} is newly visible from {', '.join(sorted(set(discovered_from))) or 'the active universe'} "
                    "but Yahoo history is not available yet; it will retry and promote itself on a natural Yahoo run."
                ),
            }
        else:
            state.pop("pending", None)

        _write_json(self._state_path(ticker), state)
        return state

    def record_failure(
        self,
        ticker: str,
        error: str,
        run: dict,
        discovered_from: list[str],
        evidence: dict,
    ) -> dict:
        state = self._load_state(ticker)
        attempt = _attempt(run, "failed", evidence, error=error)
        self._append_attempt(state, attempt)
        canonical = self.finance_dir / f"{ticker}.json"
        lkg_path = self._lkg_path(ticker)

        lkg = None
        prior_lkg = state.get("lkg") if isinstance(state.get("lkg"), dict) else None
        prior_lkg_payload = _read_json(lkg_path)
        if prior_lkg and _valid_canonical_payload(prior_lkg_payload, ticker):
            prior_bytes = lkg_path.read_bytes()
            prior_hash = _sha256(prior_bytes)
            if prior_hash == prior_lkg.get("payload_sha256"):
                lkg = {
                    "path": f"data/admin/yahoo-batch-quote-history/lkg/{ticker}.json",
                    "payload_sha256": prior_hash,
                    "fetched_at": prior_lkg_payload.get("fetched_at"),
                    **_payload_source_fields(prior_lkg_payload),
                }
        canonical_payload = _read_json(canonical)
        if _valid_canonical_payload(canonical_payload, ticker):
            payload_bytes = canonical.read_bytes()
            _write_bytes(lkg_path, payload_bytes)
            source = _payload_source_fields(canonical_payload)
            lkg = {
                "path": f"data/admin/yahoo-batch-quote-history/lkg/{ticker}.json",
                "payload_sha256": _sha256(payload_bytes),
                "fetched_at": canonical_payload.get("fetched_at"),
                **source,
            }

        failure = {
            "run_id": attempt["run_id"],
            "run_attempt": attempt["run_attempt"],
            "observed_at": attempt["observed_at"],
            "error": _bounded_error(error),
            "attempts_used": attempt["attempts_used"],
            "failures": attempt["failures"],
        }
        state.update({
            "schema_version": "yahoo-batch-quote-history-state/v1",
            "ticker": ticker,
            "resolution_state": "lkg_primary" if lkg else "unavailable",
            "retry": True,
            "discovered_from": sorted(set(discovered_from)),
            "last_attempt": attempt,
            "latest_failure": failure,
            "updated_at": attempt["observed_at"],
        })
        if lkg:
            state["lkg"] = lkg
            state["current"] = dict(lkg)
        else:
            if lkg_path.exists():
                lkg_path.unlink()
            state.pop("lkg", None)
            state.pop("current", None)
        _write_json(self._state_path(ticker), state)
        return state

    def record_skip(
        self,
        ticker: str,
        payload: dict,
        run: dict,
        discovered_from: list[str],
    ) -> dict:
        path = self.finance_dir / f"{ticker}.json"
        payload_bytes = path.read_bytes()
        state = self._load_state(ticker)
        if state.get("retry") is True:
            attempt = _attempt(run, "skipped_retry_not_recovered", {"attempts_used": 0, "latency_ms": 0, "failures": []})
            self._append_attempt(state, attempt)
            state["last_attempt"] = attempt
            state["updated_at"] = attempt["observed_at"]
            _write_json(self._state_path(ticker), state)
            return state
        history = (payload.get("data") or {}).get("history_1y") if isinstance(payload.get("data"), dict) else None
        has_history = isinstance(history, list) and len(history) > 0
        attempt = _attempt(run, "skipped_fresh", {"attempts_used": 0, "latency_ms": 0, "failures": []})
        pending_reason = _pending_history_reason(payload, state, attempt["observed_at"]) if not has_history else None
        source = _payload_source_fields(payload)
        self._append_attempt(state, attempt)
        state.update({
            "schema_version": "yahoo-batch-quote-history-state/v1",
            "ticker": ticker,
            "resolution_state": "fresh_primary" if has_history else "pending_history" if pending_reason else "unavailable",
            "retry": not has_history,
            "current": {
                "path": f"data/yf/finance/{ticker}.json",
                "payload_sha256": _sha256(payload_bytes),
                "fetched_at": payload.get("fetched_at"),
                **source,
            },
            "discovered_from": sorted(set(discovered_from)),
            "last_attempt": attempt,
            "updated_at": attempt["observed_at"],
        })
        if pending_reason:
            state["pending"] = {
                "missing": ["history"],
                "discovered_from": sorted(set(discovered_from)),
                "first_trade_date": payload.get("first_trade_date"),
                "initial_run_id": attempt["run_id"],
                "first_seen_at": attempt["observed_at"],
                "expected_resolution": "next_natural_yahoo_run",
                "reason": pending_reason,
            }
        else:
            state.pop("pending", None)
        _write_json(self._state_path(ticker), state)
        return state

    def rebuild_index(self, active_universe: set[str], run: dict, batch_failure: str | None = None) -> dict:
        active = set(active_universe)
        counts = {
            "active": len(active),
            "untracked": 0,
            "fresh": 0,
            "lkg": 0,
            "pending_history": 0,
            "unavailable": 0,
            "retry": 0,
            "failed": 0,
        }
        retry_symbols = []
        pending_symbols = []
        lkg_symbols = []
        pending_details = []
        lkg_details = []
        failures = []
        source_rows = []
        current_attempts = []
        run_id = str(run.get("run_id") or "local")

        for ticker in sorted(active):
            state = _read_json(self._state_path(ticker))
            if not state:
                counts["untracked"] += 1
                continue
            resolution = state.get("resolution_state")
            if resolution == "fresh_primary":
                counts["fresh"] += 1
            elif resolution == "lkg_primary":
                counts["lkg"] += 1
                lkg_symbols.append(ticker)
                lkg = state.get("lkg") if isinstance(state.get("lkg"), dict) else {}
                failure = state.get("latest_failure") if isinstance(state.get("latest_failure"), dict) else {}
                lkg_details.append({
                    "symbol": ticker,
                    "payload_sha256": lkg.get("payload_sha256"),
                    "source_as_of": lkg.get("source_as_of"),
                    "failure_run_id": failure.get("run_id"),
                    "failure_observed_at": failure.get("observed_at"),
                })
            elif resolution == "pending_history":
                counts["pending_history"] += 1
                pending_symbols.append(ticker)
                pending = state.get("pending") if isinstance(state.get("pending"), dict) else {}
                pending_details.append({
                    "symbol": ticker,
                    "discovered_from": pending.get("discovered_from") or state.get("discovered_from") or [],
                    "missing": pending.get("missing") or ["history"],
                    "first_trade_date": pending.get("first_trade_date"),
                    "initial_run_id": pending.get("initial_run_id"),
                    "expected_resolution": pending.get("expected_resolution") or "next_natural_yahoo_run",
                    "reason": pending.get("reason") or "newly_discovered_no_history",
                })
            elif resolution == "unavailable":
                counts["unavailable"] += 1
            if state.get("retry") is True:
                counts["retry"] += 1
                retry_symbols.append(ticker)
            last_attempt = state.get("last_attempt")
            if isinstance(last_attempt, dict) and last_attempt.get("outcome") == "failed":
                counts["failed"] += 1
            current = state.get("current") if isinstance(state.get("current"), dict) else {}
            source_as_of = current.get("source_as_of")
            if source_as_of:
                source_rows.append((str(source_as_of), ticker))
            latest_failure = state.get("latest_failure")
            if isinstance(latest_failure, dict):
                failures.append({"ticker": ticker, **latest_failure})
            for attempt in state.get("attempts") or []:
                if (
                    isinstance(attempt, dict)
                    and str(attempt.get("run_id")) == run_id
                    and int(attempt.get("run_attempt") or 1) == int(run.get("run_attempt") or 1)
                ):
                    current_attempts.append({"ticker": ticker, **attempt})

        attempted = len(current_attempts) + (1 if batch_failure else 0)
        succeeded = sum(row.get("outcome") in {"fresh", "pending_history", "unavailable"} for row in current_attempts)
        failed = sum(row.get("outcome") == "failed" for row in current_attempts) + (1 if batch_failure else 0)
        skipped = sum(row.get("outcome") in {"skipped_fresh", "skipped_retry_not_recovered"} for row in current_attempts)
        oldest = min(source_rows) if source_rows else (None, None)
        latest_failure = max(failures, key=lambda row: str(row.get("observed_at") or "")) if failures else None
        if batch_failure:
            latest_failure = {
                "ticker": None,
                "run_id": run_id,
                "run_attempt": int(run.get("run_attempt") or 1),
                "observed_at": str(run.get("observed_at") or ""),
                "error": _bounded_error(batch_failure),
                "scope": "batch",
            }
        index = {
            "schema_version": "yahoo-batch-quote-history-index/v1",
            "generated_at": str(run.get("observed_at") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")),
            "lane_id": "yahoo_batch_quote_history",
            "counts": counts,
            "oldest_source_as_of": oldest[0],
            "oldest_source_ticker": oldest[1],
            "retry_symbols": retry_symbols,
            "pending_symbols": pending_symbols[:20],
            "lkg_symbols": lkg_symbols[:20],
            "pending_details": pending_details[:20],
            "lkg_details": lkg_details[:20],
            "latest_failure": latest_failure,
            "current_attempt": {
                "run_id": run_id,
                "run_attempt": int(run.get("run_attempt") or 1),
                "event_name": str(run.get("event_name") or "local"),
                "schedule": str(run.get("schedule") or ""),
                "natural": bool(run.get("natural")),
                "attempted": attempted,
                "successes": succeeded,
                "failed": failed,
                "skipped": skipped,
                "fetch_attempts": sum(int(row.get("attempts_used") or 0) for row in current_attempts) + (1 if batch_failure else 0),
                "errors": [
                    {"ticker": row["ticker"], "error": row.get("error"), "failures": row.get("failures") or []}
                    for row in current_attempts
                    if row.get("outcome") == "failed"
                ] + ([{"ticker": None, "error": _bounded_error(batch_failure), "scope": "batch"}] if batch_failure else []),
            },
            "message": (
                f"Yahoo quote/history: fresh={counts['fresh']}, lkg={counts['lkg']}, "
                f"pending_history={counts['pending_history']}, unavailable={counts['unavailable']}, "
                f"retry={counts['retry']}, failed={counts['failed']}. "
                "Pending history is a normal new-listing state and self-resolves on a natural Yahoo run."
            ),
        }
        _write_json(self.root / "index.json", index)
        return index
