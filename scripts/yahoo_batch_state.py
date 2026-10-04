#!/usr/bin/env python3
"""Bounded per-ticker state for the Yahoo quote/history acquisition lane."""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import re
from pathlib import Path


SYMBOL_RE = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,11}$")
NEW_LISTING_PENDING_DAYS = 31
ERROR_TEXT_LIMIT = 1000
ACTIVE_UNIVERSE_SCHEMA_VERSION = "yahoo-batch-active-universe/v1"
CORE_ETF_INDEX_FILENAME = "index-core-etf.json"
DEFAULT_INDEX_FILENAME = "index.json"
TERMINAL_RESOLUTION_STATE = "terminal_provider_unsupported"


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
    return "newly_discovered_no_history" if not isinstance(state.get("last_result"), dict) else None


def _epoch_iso(value) -> str | None:
    try:
        seconds = float(value)
        if seconds > 10_000_000_000:
            seconds /= 1000
        return datetime.fromtimestamp(seconds, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except (TypeError, ValueError, OverflowError, OSError):
        return None






def _contains_provider_value(candidate, provider) -> bool:
    if provider is None:
        return True
    if isinstance(provider, dict):
        return isinstance(candidate, dict) and all(
            key in candidate and _contains_provider_value(candidate[key], value)
            for key, value in provider.items()
            if value is not None
        )
    if isinstance(provider, list):
        return isinstance(candidate, list) and all(item in candidate for item in provider)
    return candidate == provider


def _derived_payload_source_fields(payload: dict) -> dict:
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    info = data.get("info") if isinstance(data.get("info"), dict) else {}
    quote = _epoch_iso(info.get("regularMarketTime"))
    history = data.get("history_1y") if isinstance(data.get("history_1y"), list) else []
    dates = sorted({
        str(row.get("date"))[:10]
        for row in history
        if isinstance(row, dict) and _iso_ms(str(row.get("date") or "")[:10]) is not None
    })
    history_as_of = dates[-1] if dates else None
    source_as_of = (
        history_as_of if history_as_of and (not quote or history_as_of <= quote[:10]) else quote
    )
    return {"quote_as_of": quote, "history_as_of": history_as_of, "source_as_of": source_as_of}


def _payload_source_fields(payload: dict) -> dict:
    return _derived_payload_source_fields(payload)


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
    source = _derived_payload_source_fields(payload)
    if any(
        key in payload and payload.get(key) != source.get(key)
        for key in ("quote_as_of", "history_as_of", "source_as_of")
    ):
        return False
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


def _result(run: dict, outcome: str, evidence: dict, *, error: str | None = None) -> dict:
    row = {
        "observed_at": str(run.get("observed_at") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")),
        "outcome": outcome,
        "attempts_used": int(evidence["attempts_used"]) if evidence.get("attempts_used") is not None else 1,
        "latency_ms": int(evidence.get("latency_ms") or 0),
        "failures": [{**item, "error": _bounded_error(item.get("error"))}
                     for item in list(evidence.get("failures") or [])[:6] if isinstance(item, dict)],
    }
    if error:
        row["error"] = _bounded_error(error)
    return row


class YahooBatchStateStore:
    """Keep one canonical pointer, one exact LKG and actual failures per ticker."""

    def __init__(self, root: Path, finance_dir: Path):
        self.root = Path(root)
        self.finance_dir = Path(finance_dir)
        self.ticker_dir = self.root / "tickers"
        self.lkg_dir = self.root / "lkg"
        self.active_universe_path = self.root / "active-universe.json"
        self._results: dict[str, dict] = {}

    def _state_path(self, ticker: str) -> Path:
        return self.ticker_dir / f"{ticker}.json"

    def _lkg_path(self, ticker: str) -> Path:
        return self.lkg_dir / f"{ticker}.json"

    def _load_state(self, ticker: str) -> dict:
        state = _read_json(self._state_path(ticker)) or {
            "schema_version": "yahoo-batch-quote-history-state/v1", "ticker": ticker,
        }
        legacy_result = state.pop("last_attempt", None)
        if "last_result" not in state and isinstance(legacy_result, dict):
            state["last_result"] = legacy_result
        for key in ("attempts", "provider_observation", "promotion_contract", "latest_promotion_deferral",
                    "recovered_from_run_id", "recovery_run_id", "recovery_run_attempt", "recovery_event_name", "last_recovered_failure"):
            state.pop(key, None)
        for key in ("last_result", "latest_failure", "pending", "terminal", "stale"):
            if isinstance(state.get(key), dict):
                state[key] = {k: v for k, v in state[key].items()
                              if k not in {"run_id", "run_attempt", "event_name", "natural", "schedule", "shard",
                                           "initial_run_id", "classified_run_id"}}
        return state

    def _load_active_universe(self) -> dict:
        payload = _read_json(self.active_universe_path)
        if (
            isinstance(payload, dict)
            and payload.get("schema_version") == ACTIVE_UNIVERSE_SCHEMA_VERSION
            and isinstance(payload.get("items"), dict)
        ):
            for item in payload["items"].values():
                if isinstance(item, dict):
                    item.pop("first_seen_run_id", None)
                    item.pop("last_seen_run_id", None)
            return payload
        return {"schema_version": ACTIVE_UNIVERSE_SCHEMA_VERSION, "items": {}}

    @staticmethod
    def _is_pending_acquisition(item: object) -> bool:
        return (
            isinstance(item, dict)
            and item.get("resolution_state") == "pending_acquisition"
            and item.get("coverage") is False
            and item.get("coverage_status") == "not_observed"
            and item.get("provider_reachability") == "not_attempted"
        )

    def _remove_pending_after_state(self, ticker: str) -> None:
        """Drop an inventory duplicate only after its per-ticker state is durable.

        A crash between these writes leaves a harmless duplicate; state-first index
        precedence keeps it out of pending counts until the next reconciliation.
        """
        inventory = self._load_active_universe()
        items = inventory["items"]
        if ticker not in items:
            return
        del items[ticker]
        inventory["generated_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        _write_json(self.active_universe_path, inventory)

    def reconcile_active_universe(
        self,
        active_universe: set[str],
        sources: dict[str, list[str]],
        run: dict,
    ) -> int:
        """Persist only active symbols that have never received a Yahoo observation."""
        inventory = self._load_active_universe()
        items = inventory["items"]
        observed_at = str(run.get("observed_at") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
        changed = 0
        for ticker in sorted(set(active_universe)):
            # Per-ticker observation/terminal state always wins over stale inventory.
            if _read_json(self._state_path(ticker)) is not None:
                if ticker in items:
                    del items[ticker]
                    changed += 1
                continue
            existing = items.get(ticker)
            discovered_from = sorted(set(sources.get(ticker, [])))
            if self._is_pending_acquisition(existing):
                prior_sources = existing.get("discovered_from") if isinstance(existing.get("discovered_from"), list) else []
                if not isinstance(existing.get("first_seen_from"), list):
                    existing["first_seen_from"] = sorted(set(prior_sources))
                    changed += 1
                merged_sources = sorted({*prior_sources, *discovered_from})
                if existing.get("discovered_from") != merged_sources:
                    existing["discovered_from"] = merged_sources
                    changed += 1
                if existing.get("last_seen_at") != observed_at:
                    existing["last_seen_at"] = observed_at
                    changed += 1
                continue
            items[ticker] = {
                "resolution_state": "pending_acquisition",
                "coverage": False,
                "coverage_status": "not_observed",
                "provider_reachability": "not_attempted",
                "discovered_from": discovered_from,
                "first_seen_from": discovered_from,
                "first_seen_at": observed_at,
                "last_seen_at": observed_at,
            }
            changed += 1
        if changed or not self.active_universe_path.exists():
            inventory["generated_at"] = observed_at
            _write_json(self.active_universe_path, inventory)
        return changed

    def pending_acquisition_tickers(self, active_universe: set[str]) -> set[str]:
        items = self._load_active_universe()["items"]
        return {
            ticker for ticker in set(active_universe)
            if _read_json(self._state_path(ticker)) is None and self._is_pending_acquisition(items.get(ticker))
        }

    def prospective_pending_acquisition_tickers(self, active_universe: set[str]) -> set[str]:
        """Resolve a first-run campaign without persisting its pending inventory."""
        return {
            ticker for ticker in set(active_universe)
            if _read_json(self._state_path(ticker)) is None
        }

    def load_terminal_evidence(self, artifact_path: Path) -> dict:
        path = Path(artifact_path)
        try:
            payload_bytes = path.read_bytes()
            payload = json.loads(payload_bytes)
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError(f"terminal evidence artifact is unreadable: {path}") from exc
        if (
            not isinstance(payload, dict)
            or payload.get("schema_version") != "fenok-s1-stock-public-promotion-dry-run/v0.1"
            or payload.get("dry_run") is not True
            or _iso_ms(payload.get("generated_at")) is None
            or not isinstance(payload.get("blocked_rows"), list)
        ):
            raise ValueError("terminal evidence artifact contract is invalid")
        tickers = {}
        for row in payload["blocked_rows"]:
            ticker = str(row.get("ticker") or "").strip().upper() if isinstance(row, dict) else ""
            policy = row.get("corporate_action_policy") if isinstance(row, dict) else None
            evidence = policy.get("evidence") if isinstance(policy, dict) else None
            if not ticker or not isinstance(evidence, list):
                continue
            terminal_rows = [
                item for item in evidence
                if isinstance(item, dict)
                and item.get("terminal") is True
                and str(item.get("symbol") or "").upper() == ticker
                and item.get("alias_target") is None
            ]
            if terminal_rows:
                tickers[ticker] = terminal_rows
        try:
            artifact_label = path.relative_to(self.root.parents[1]).as_posix()
        except ValueError:
            artifact_label = path.name
        return {
            "artifact_path": artifact_label,
            "artifact_sha256": _sha256(payload_bytes),
            "artifact_generated_at": payload["generated_at"],
            "tickers": tickers,
        }

    def transition_terminal_tickers(self, active_universe: set[str], terminal_evidence: dict, run: dict) -> int:
        if not isinstance(terminal_evidence, dict) or not isinstance(terminal_evidence.get("tickers"), dict):
            raise ValueError("terminal evidence contract is invalid")
        transitioned = 0
        for ticker in sorted(set(active_universe) & set(terminal_evidence["tickers"])):
            state = self._load_state(ticker)
            state.update({
                "schema_version": "yahoo-batch-quote-history-state/v1",
                "ticker": ticker,
                "resolution_state": TERMINAL_RESOLUTION_STATE,
                "retry": False,
                "terminal": {
                    "artifact_path": terminal_evidence.get("artifact_path"),
                    "evidence_sha256": terminal_evidence.get("artifact_sha256"),
                    "artifact_generated_at": terminal_evidence.get("artifact_generated_at"),
                    "evidence": terminal_evidence["tickers"][ticker],
                    "classified_at": str(run.get("observed_at") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")),
                },
                "updated_at": str(run.get("observed_at") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")),
            })
            state.pop("pending", None)
            state.pop("stale", None)
            _write_json(self._state_path(ticker), state)
            self._remove_pending_after_state(ticker)
            transitioned += 1
        return transitioned

    def _record_result(self, state: dict, row: dict) -> None:
        self._results[state["ticker"]] = dict(row)

    def retained_stockanalysis_etf_sources(
        self,
        excluded_tickers: set[str] | None = None,
        etf_universe_path: Path | None = None,
    ) -> dict[str, list[str]]:
        """Bind observed or pending ETFs to the current Yahoo catalogue.

        Canonical records retain their existing admission rules. A missing
        canonical is allowed only for an exact pending acquisition or failed
        retry also present in the current typed StockAnalysis ETF source.
        """
        catalogue_index = _read_json(self.root / DEFAULT_INDEX_FILENAME)
        catalogue_symbols = catalogue_index.get("catalogue_symbols") if catalogue_index else None
        if (
            not catalogue_index
            or catalogue_index.get("schema_version") != "yahoo-batch-quote-history-index/v1"
            or catalogue_index.get("active_universe_scope") != "all_sources"
            or not isinstance(catalogue_symbols, list)
            or not catalogue_symbols
            or any(not isinstance(ticker, str) or not ticker for ticker in catalogue_symbols)
            or len(catalogue_symbols) != len(set(catalogue_symbols))
        ):
            return {}
        catalogue = set(catalogue_symbols)
        excluded = set(excluded_tickers or set())
        sources = {}
        missing_canonical = set()
        for path in sorted(self.ticker_dir.glob("*.json")):
            ticker = path.stem
            if ticker not in catalogue or ticker in excluded:
                continue
            state = _read_json(path)
            if (
                not state
                or state.get("schema_version") != "yahoo-batch-quote-history-state/v1"
                or state.get("ticker") != ticker
                or state.get("resolution_state") not in {
                    "fresh_primary", "lkg_primary", "pending_history", "unavailable"
                }
                or not isinstance(state.get("discovered_from"), list)
                or "stockanalysis_etf" not in state["discovered_from"]
            ):
                continue
            canonical = self.finance_dir / f"{ticker}.json"
            if canonical.exists():
                if not _valid_canonical_payload(_read_json(canonical), ticker):
                    continue
                sources[ticker] = sorted({source for source in state["discovered_from"] if isinstance(source, str)})
                continue
            last_result = state.get("last_result")
            if (
                state.get("resolution_state") == "unavailable"
                and state.get("retry") is True
                and isinstance(last_result, dict)
                and last_result.get("outcome") == "failed"
                and state["discovered_from"] == ["stockanalysis_etf"]
            ):
                missing_canonical.add(ticker)

        # The index's pending details are display-capped. The owning inventory
        # carries every pending key and distinguishes it from an invalid state.
        for ticker, item in self._load_active_universe()["items"].items():
            if (
                isinstance(ticker, str)
                and SYMBOL_RE.fullmatch(ticker)
                and ticker in catalogue
                and ticker not in excluded
                and ticker not in sources
                and not self._state_path(ticker).exists()
                and not (self.finance_dir / f"{ticker}.json").exists()
                and self._is_pending_acquisition(item)
                and item.get("discovered_from") == ["stockanalysis_etf"]
            ):
                missing_canonical.add(ticker)

        if missing_canonical and etf_universe_path is not None:
            etf_universe = _read_json(Path(etf_universe_path))
            if (
                etf_universe
                and etf_universe.get("schema_version") == "stockanalysis/v1"
                and etf_universe.get("asset_type") == "etf"
                and isinstance(etf_universe.get("records"), list)
            ):
                for row in etf_universe["records"]:
                    if not isinstance(row, dict):
                        continue
                    ticker = row.get("ticker")
                    if (
                        isinstance(ticker, str)
                        and ticker in missing_canonical
                        and row.get("asset_type", "etf") == "etf"
                        and row.get("type", "etf") == "etf"
                    ):
                        sources[ticker] = ["stockanalysis_etf"]
        return sources

    def prospective_source_stale_tickers(
        self,
        tickers: set[str],
        source_age_business_days: dict[str, int | None],
        max_source_business_days: int,
    ) -> set[str]:
        """Preview the existing bootstrap transition without persisting it."""
        return {
            ticker for ticker in tickers
            if isinstance(source_age_business_days.get(ticker), int)
            and source_age_business_days[ticker] > max_source_business_days
            and (_read_json(self._state_path(ticker)) or {}).get("resolution_state") == "fresh_primary"
            and _valid_canonical_payload(_read_json(self.finance_dir / f"{ticker}.json"), ticker)
        }

    def retry_tickers_ordered(
        self,
        active_universe: set[str],
        terminal_tickers: set[str] | None = None,
        prospective_stale_tickers: set[str] | None = None,
    ) -> list[str]:
        active = set(active_universe)
        terminal = set(terminal_tickers or set())
        prospective_stale = set(prospective_stale_tickers or set())
        retry = []
        for ticker in sorted(active):
            state = _read_json(self._state_path(ticker))
            if (
                ticker not in terminal
                and state
                and state.get("resolution_state") != TERMINAL_RESOLUTION_STATE
                and (state.get("retry") is True or (
                    ticker in prospective_stale and state.get("resolution_state") == "fresh_primary"
                ))
            ):
                observed_at = str((state.get("last_result") or {}).get("observed_at") or "")
                retry.append((observed_at, ticker))
        return [ticker for _observed_at, ticker in sorted(retry)]

    def retry_tickers(self, active_universe: set[str]) -> set[str]:
        return set(self.retry_tickers_ordered(active_universe))

    def untracked_tickers(self, active_universe: set[str]) -> set[str]:
        return {
            ticker
            for ticker in set(active_universe)
            if _read_json(self._state_path(ticker)) is None
            and ticker not in self.pending_acquisition_tickers(active_universe)
        }

    def bootstrap_existing(
        self,
        active_universe: set[str],
        sources: dict[str, list[str]],
        run: dict,
        exclude_tickers: set[str] | None = None,
        source_age_business_days: dict[str, int | None] | None = None,
        max_source_business_days: int | None = None,
    ) -> int:
        active = set(active_universe)
        excluded = set(exclude_tickers or set())
        source_ages = source_age_business_days or {}
        changed = 0
        for canonical in sorted(self.finance_dir.glob("*.json")):
            ticker = canonical.stem
            if ticker == "_summary" or ticker not in active:
                continue
            payload = _read_json(canonical)
            if not _valid_canonical_payload(payload, ticker):
                continue
            enriched = {**payload, **_payload_source_fields(payload)}
            state_path = self._state_path(ticker)
            existing = _read_json(state_path)
            age = source_ages.get(ticker)
            source_stale = (
                isinstance(age, int)
                and isinstance(max_source_business_days, int)
                and age > max_source_business_days
            )
            if existing:
                if existing.get("resolution_state") == "fresh_primary" and source_stale:
                    self._record_source_stale_lkg(
                        ticker,
                        enriched,
                        run,
                        sources.get(ticker, []),
                        age_business_days=age,
                        max_business_days=max_source_business_days,
                    )
                    changed += 1
                continue
            if ticker in excluded:
                continue
            if source_stale:
                self._record_source_stale_lkg(
                    ticker,
                    enriched,
                    run,
                    sources.get(ticker, []),
                    age_business_days=age,
                    max_business_days=max_source_business_days,
                )
            else:
                self.record_skip(ticker, enriched, run, sources.get(ticker, []))
            changed += 1
        return changed

    def _record_source_stale_lkg(
        self,
        ticker: str,
        payload: dict,
        run: dict,
        discovered_from: list[str],
        *,
        age_business_days: int,
        max_business_days: int,
    ) -> dict:
        canonical = self.finance_dir / f"{ticker}.json"
        payload_bytes = canonical.read_bytes()
        lkg_path = self._lkg_path(ticker)
        _write_bytes(lkg_path, payload_bytes)
        source = _payload_source_fields(payload)
        observed_at = str(run.get("observed_at") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
        lkg = {
            "path": f"data/admin/yahoo-batch-quote-history/lkg/{ticker}.json",
            "payload_sha256": _sha256(payload_bytes),
            "fetched_at": payload.get("fetched_at"),
            **source,
        }
        state = self._load_state(ticker)
        state.update({
            "schema_version": "yahoo-batch-quote-history-state/v1",
            "ticker": ticker,
            "resolution_state": "lkg_primary",
            "retry": True,
            "current": dict(lkg),
            "lkg": lkg,
            "stale": {
                "reason": "source_age_exceeds_lane_bound",
                "source_as_of": source.get("source_as_of"),
                "age_business_days": age_business_days,
                "max_business_days": max_business_days,
                "classified_at": observed_at,
                "expected_resolution": "next_yahoo_acquisition",
                "message": (
                    f"{ticker} holds LKG because Yahoo source date {source.get('source_as_of') or 'unstamped'} "
                    f"is {age_business_days} business days old, beyond the {max_business_days}-day bound; "
                    "it will retry on the next Yahoo acquisition."
                ),
            },
            "discovered_from": sorted(set(discovered_from)),
            "updated_at": observed_at,
        })
        state.pop("pending", None)
        _write_json(self._state_path(ticker), state)
        self._remove_pending_after_state(ticker)
        return state



    def evaluate_recovery_candidate(
        self, ticker: str, payload: dict, provider_payload: dict,
        *, canonical_payload: dict | None = None,
    ) -> dict:
        """Validate actual acquired values and honest retained quote/history dates."""
        if not _valid_canonical_payload(provider_payload, ticker) or not _valid_canonical_payload(payload, ticker):
            raise ValueError(f"Yahoo candidate payload is invalid for {ticker}")
        if not _contains_provider_value(payload["data"], provider_payload["data"]):
            raise ValueError(f"Yahoo candidate disagrees with actual provider values for {ticker}")
        provider_source = _payload_source_fields(provider_payload)
        if isinstance(canonical_payload, dict):
            for key, before in _payload_source_fields(canonical_payload).items():
                after = _iso_ms(provider_source.get(key))
                if key in {"quote_as_of", "history_as_of"} and _iso_ms(before) is not None and after is not None and _iso_ms(before) > after:
                    raise ValueError(f"Yahoo provider source timestamp regresses for {ticker}: {key}")
        state = self._load_state(ticker)
        prior = state.get("lkg") if state.get("retry") is True else state.get("current")
        candidate_source = _payload_source_fields(payload)
        for key in ("quote_as_of", "history_as_of"):
            before = _iso_ms((prior or {}).get(key))
            after = _iso_ms(candidate_source.get(key))
            if after is not None and (before is None or after > before):
                if after != _iso_ms(provider_source.get(key)):
                    raise ValueError(f"Yahoo candidate source date is not supplied by its provider for {ticker}: {key}")
        if not self.recovery_candidate_advances(ticker, payload):
            raise ValueError(f"Yahoo candidate source date regresses or is invalid for {ticker}")
        return {"eligible": True, "reason": "ok"}

    def valid_current_canonical(self, ticker: str, state: dict | None = None) -> bool:
        state = state if isinstance(state, dict) else self._load_state(ticker)
        current = state.get("current") if isinstance(state.get("current"), dict) else {}
        if current.get("path") != f"data/yf/finance/{ticker}.json":
            return False
        path = self.finance_dir / f"{ticker}.json"
        try:
            payload_bytes = path.read_bytes()
            payload = json.loads(payload_bytes)
        except (FileNotFoundError, json.JSONDecodeError):
            return False
        source = _payload_source_fields(payload) if isinstance(payload, dict) else {}
        return (
            _valid_canonical_payload(payload, ticker)
            and current.get("payload_sha256") == _sha256(payload_bytes)
            and all(current.get(key) == source.get(key) for key in ("quote_as_of", "history_as_of", "source_as_of"))
        )

    def recovery_candidate_advances(self, ticker: str, payload: dict) -> bool:
        if not _valid_canonical_payload(payload, ticker):
            return False
        now_ms = datetime.now(timezone.utc).timestamp() * 1000
        if _iso_ms(payload.get("fetched_at")) > now_ms:
            return False
        state = self._load_state(ticker)
        prior = state.get("lkg") if state.get("retry") is True else state.get("current")
        source = _payload_source_fields(payload)
        for key in ("quote_as_of", "history_as_of"):
            before = _iso_ms((prior or {}).get(key))
            after = _iso_ms(source.get(key))
            if before is not None and (after is None or after < before):
                return False
        return True


    def record_success(
        self,
        ticker: str,
        payload: dict,
        run: dict,
        discovered_from: list[str],
        evidence: dict,
        *,
        expected_payload_sha256: str | None = None,
    ) -> dict:
        path = self.finance_dir / f"{ticker}.json"
        payload_bytes = path.read_bytes()
        state = self._load_state(ticker)
        canonical_payload = _read_json(path)
        actual_sha256 = _sha256(payload_bytes)
        if expected_payload_sha256 is not None and actual_sha256 != expected_payload_sha256:
            raise ValueError(f"promotion candidate payload is not bound to canonical bytes for {ticker}")
        if canonical_payload != payload:
            raise ValueError(f"promotion candidate payload is not bound to canonical bytes for {ticker}")
        if not _valid_canonical_payload(canonical_payload, ticker):
            raise ValueError(f"promotion candidate canonical payload is invalid for {ticker}")
        if not self.recovery_candidate_advances(ticker, payload):
            raise ValueError(f"Yahoo candidate source date regresses or is invalid for {ticker}")
        pending = state.get("pending")
        data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
        history = data.get("history_1y")
        has_history = isinstance(history, list) and len(history) > 0
        pending_reason = _pending_history_reason(payload, state, str(run.get("observed_at") or "")) if not has_history else None
        outcome = "fresh" if has_history else "pending_history" if pending_reason else "unavailable"
        attempt = _result(run, outcome, evidence)
        self._record_result(state, attempt)

        state.update({
            "schema_version": "yahoo-batch-quote-history-state/v1",
            "ticker": ticker,
            "resolution_state": "fresh_primary" if has_history else "pending_history" if pending_reason else "unavailable",
            "retry": not has_history,
            "current": {
                "path": f"data/yf/finance/{ticker}.json",
                "payload_sha256": actual_sha256,
                "fetched_at": canonical_payload.get("fetched_at"),
                **_payload_source_fields(canonical_payload),
            },
            "discovered_from": sorted(set(discovered_from)),
            "last_result": attempt,
            "updated_at": attempt["observed_at"],
        })

        if has_history:
            state.pop("pending", None)
            state.pop("latest_failure", None)
            state["failure_count"] = 0
        elif pending_reason:
            state["pending"] = {
                "missing": ["history"],
                "discovered_from": sorted(set(discovered_from)),
                "first_trade_date": payload.get("first_trade_date"),
                "first_seen_at": pending.get("first_seen_at") if isinstance(pending, dict) and pending.get("first_seen_at") else attempt["observed_at"],
                "expected_resolution": "next_yahoo_acquisition",
                "reason": pending_reason,
                "message": (
                    f"{ticker} is newly visible from {', '.join(sorted(set(discovered_from))) or 'the active universe'} "
                    "but Yahoo history is not available yet; it will retry and promote itself on the next Yahoo acquisition."
                ),
            }
        else:
            state.pop("pending", None)

        _write_json(self._state_path(ticker), state)
        self._remove_pending_after_state(ticker)
        return state

    def record_failure(
        self,
        ticker: str,
        error: str,
        run: dict,
        discovered_from: list[str],
        evidence: dict,
        *,
        failure_kind: str = "unexpected",
    ) -> dict:
        state = self._load_state(ticker)
        previously_advertised_data = (
            state.get("resolution_state") in {"fresh_primary", "lkg_primary", "pending_history"}
            or isinstance(state.get("current"), dict)
            or isinstance(state.get("lkg"), dict)
            or (isinstance(state.get("latest_failure"), dict)
                and state["latest_failure"].get("data_loss") is True)
        )
        attempt = _result(run, "failed", evidence, error=error)
        self._record_result(state, attempt)
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
        if _valid_canonical_payload(canonical_payload, ticker) and self.recovery_candidate_advances(ticker, canonical_payload):
            payload_bytes = canonical.read_bytes()
            _write_bytes(lkg_path, payload_bytes)
            source = _payload_source_fields(canonical_payload)
            lkg = {
                "path": f"data/admin/yahoo-batch-quote-history/lkg/{ticker}.json",
                "payload_sha256": _sha256(payload_bytes),
                "fetched_at": canonical_payload.get("fetched_at"),
                **source,
            }

        lkg_status = "retained" if lkg else "lost" if previously_advertised_data else "absent"
        data_loss = lkg_status == "lost"
        deferred_acquisition = failure_kind == "transient_provider_miss" and lkg_status == "absent"
        failure = {
            "observed_at": attempt["observed_at"],
            "error": _bounded_error(error),
            "attempts_used": attempt["attempts_used"],
            "failures": attempt["failures"],
            "failure_kind": failure_kind,
            "lkg_status": lkg_status,
            "data_loss": data_loss,
            "deferred_acquisition": deferred_acquisition,
        }
        state.update({
            "schema_version": "yahoo-batch-quote-history-state/v1",
            "ticker": ticker,
            "resolution_state": "lkg_primary" if lkg else "unavailable",
            "retry": True,
            "discovered_from": sorted(set(discovered_from)),
            "last_result": attempt,
            "latest_failure": failure,
            "failure_count": int(state.get("failure_count") or 0) + 1,
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
        self._remove_pending_after_state(ticker)
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
            attempt = _result(run, "skipped_retry_not_recovered", {"attempts_used": 0, "latency_ms": 0, "failures": []})
            self._record_result(state, attempt)
            state["last_result"] = attempt
            state["updated_at"] = attempt["observed_at"]
            _write_json(self._state_path(ticker), state)
            self._remove_pending_after_state(ticker)
            return state
        history = (payload.get("data") or {}).get("history_1y") if isinstance(payload.get("data"), dict) else None
        has_history = isinstance(history, list) and len(history) > 0
        attempt = _result(run, "skipped_fresh", {"attempts_used": 0, "latency_ms": 0, "failures": []})
        pending_reason = _pending_history_reason(payload, state, attempt["observed_at"]) if not has_history else None
        source = _payload_source_fields(payload)
        self._record_result(state, attempt)
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
            "last_result": attempt,
            "updated_at": attempt["observed_at"],
        })
        if pending_reason:
            state["pending"] = {
                "missing": ["history"],
                "discovered_from": sorted(set(discovered_from)),
                "first_trade_date": payload.get("first_trade_date"),
                "first_seen_at": attempt["observed_at"],
                "expected_resolution": "next_yahoo_acquisition",
                "reason": pending_reason,
            }
        else:
            state.pop("pending", None)
        _write_json(self._state_path(ticker), state)
        self._remove_pending_after_state(ticker)
        return state

    def rebuild_index(self, active_universe: set[str], run: dict, batch_failure: str | None = None) -> dict:
        active = set(active_universe)
        active_universe_scope = str(run.get("active_universe_scope") or "").strip() or None
        counts = {
            "active": len(active),
            "eligible": len(active),
            "untracked": 0,
            "pending_acquisition": 0,
            "fresh": 0,
            "lkg": 0,
            "pending_history": 0,
            "unavailable": 0,
            "terminal": 0,
            "retry": 0,
            "failed": 0,
            "stale": 0,
        }
        retry_symbols = []
        pending_symbols = []
        lkg_symbols = []
        pending_details = []
        pending_acquisition_details = []
        terminal_symbols = []
        lkg_details = []
        unavailable_details = []
        failures = []
        source_rows = []
        current_results = [{"ticker": ticker, **row} for ticker, row in self._results.items() if ticker in active]
        stale_groups = {}

        inventory_items = self._load_active_universe()["items"]
        for ticker in sorted(active):
            state = self._load_state(ticker) if self._state_path(ticker).exists() else None
            if not state:
                pending_item = inventory_items.get(ticker)
                if self._is_pending_acquisition(pending_item):
                    counts["pending_acquisition"] += 1
                    pending_acquisition_details.append({"symbol": ticker, **pending_item})
                else:
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
                stale = state.get("stale") if isinstance(state.get("stale"), dict) else {}
                if stale.get("reason") == "source_age_exceeds_lane_bound":
                    counts["stale"] += 1
                    group_key = (
                        str(stale.get("source_as_of") or lkg.get("source_as_of") or ""),
                        int(stale.get("age_business_days") or 0),
                        int(stale.get("max_business_days") or 0),
                        str(stale.get("expected_resolution") or "next_yahoo_acquisition"),
                    )
                    stale_groups.setdefault(group_key, []).append(ticker)
                lkg_details.append({
                    "symbol": ticker,
                    "payload_sha256": lkg.get("payload_sha256"),
                    "source_as_of": lkg.get("source_as_of"),
                    "failure_observed_at": failure.get("observed_at"),
                    "state_reason": stale.get("reason"),
                    "source_age_business_days": stale.get("age_business_days"),
                    "max_source_age_business_days": stale.get("max_business_days"),
                    "expected_resolution": stale.get("expected_resolution"),
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
                    "expected_resolution": pending.get("expected_resolution") or "next_yahoo_acquisition",
                    "reason": pending.get("reason") or "newly_discovered_no_history",
                })
            elif resolution == "unavailable":
                counts["unavailable"] += 1
                failure = state.get("latest_failure") if isinstance(state.get("latest_failure"), dict) else {}
                last_attempt = state.get("last_result") if isinstance(state.get("last_result"), dict) else {}
                evidence = failure or last_attempt
                unavailable_details.append({
                    "symbol": ticker,
                    "failure_observed_at": evidence.get("observed_at"),
                    "failure_kind": failure.get("failure_kind") or (
                        "history_unavailable" if last_attempt.get("outcome") == "unavailable" else "legacy_unclassified"
                    ),
                    "lkg_status": failure.get("lkg_status") or "absent",
                    "data_loss": failure.get("data_loss") is True,
                    "deferred_acquisition": failure.get("deferred_acquisition") is True,
                    "retry": state.get("retry") is True,
                    "expected_resolution": "next_yahoo_acquisition" if state.get("retry") is True else None,
                })
            elif resolution == TERMINAL_RESOLUTION_STATE:
                counts["terminal"] += 1
                terminal_symbols.append(ticker)
            if state.get("retry") is True and resolution != TERMINAL_RESOLUTION_STATE:
                counts["retry"] += 1
                retry_symbols.append(ticker)
            last_attempt = state.get("last_result")
            # A failed last attempt is a retry-pending failure only while the symbol
            # remains retry-capable. Terminal (provider-unsupported) classification is
            # an absorbing state: its pre-terminal failed last attempt must not inflate
            # counts.failed beyond the strict equation failed <= lkg + pending_history
            # + unavailable. latest_attempt/last_attempt evidence stays untouched.
            if (
                isinstance(last_attempt, dict)
                and last_attempt.get("outcome") == "failed"
                and resolution != TERMINAL_RESOLUTION_STATE
            ):
                counts["failed"] += 1
            current = state.get("current") if isinstance(state.get("current"), dict) else {}
            source_as_of = current.get("source_as_of")
            if source_as_of and resolution != TERMINAL_RESOLUTION_STATE:
                source_rows.append((str(source_as_of), ticker))
            latest_failure = state.get("latest_failure")
            if isinstance(latest_failure, dict) and resolution != TERMINAL_RESOLUTION_STATE:
                failures.append({"ticker": ticker, **latest_failure})
        attempted = len(current_results) + (1 if batch_failure else 0)
        succeeded = sum(row.get("outcome") in {"fresh", "pending_history", "unavailable"} for row in current_results)
        failed = sum(row.get("outcome") == "failed" for row in current_results) + (1 if batch_failure else 0)
        skipped = sum(row.get("outcome") in {"skipped_fresh", "skipped_retry_not_recovered"} for row in current_results)
        current_failure_times = {
            row["ticker"]: _iso_ms(row.get("observed_at")) or 0
            for row in current_results
            if row.get("outcome") == "failed" and row.get("ticker")
        }
        def failure_priority(row):
            symbol = row.get("symbol") or ""
            return (symbol not in current_failure_times, -current_failure_times.get(symbol, 0), symbol)

        prioritized_lkg_details = sorted(lkg_details, key=failure_priority)
        prioritized_unavailable_details = sorted(unavailable_details, key=failure_priority)
        oldest = min(source_rows) if source_rows else (None, None)
        latest_failure = max(failures, key=lambda row: str(row.get("observed_at") or "")) if failures else None
        if batch_failure:
            latest_failure = {
                "ticker": None,
                "observed_at": str(run.get("observed_at") or ""),
                "error": _bounded_error(batch_failure),
                "scope": "batch",
            }
        index = {
            "schema_version": "yahoo-batch-quote-history-index/v1",
            "generated_at": str(run.get("observed_at") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")),
            "lane_id": "yahoo_batch_quote_history",
            "active_universe_scope": active_universe_scope,
            "counts": counts,
            "catalogue_symbols": sorted(active),
            "oldest_source_as_of": oldest[0],
            "oldest_source_ticker": oldest[1],
            "retry_symbols": retry_symbols,
            "pending_symbols": pending_symbols[:20],
            "pending_acquisition_symbols": [row["symbol"] for row in pending_acquisition_details[:20]],
            "pending_acquisition_details": pending_acquisition_details[:20],
            "terminal_symbols": terminal_symbols[:20],
            "lkg_symbols": lkg_symbols[:20],
            "pending_details": pending_details[:20],
            "lkg_details": prioritized_lkg_details[:20],
            "unavailable_details": prioritized_unavailable_details[:20],
            "stale_groups": [
                {
                    "source_as_of": key[0] or None,
                    "source_age_business_days": key[1],
                    "max_source_age_business_days": key[2],
                    "expected_resolution": key[3],
                    "symbols": sorted(symbols),
                }
                for key, symbols in sorted(stale_groups.items())
            ],
            "latest_failure": latest_failure,
            "current_results": {
                "attempted": attempted,
                "successes": succeeded,
                "failed": failed,
                "skipped": skipped,
                "fetch_attempts": sum(int(row.get("attempts_used") or 0) for row in current_results) + (1 if batch_failure else 0),
                "errors": [
                    {"ticker": row["ticker"], "error": row.get("error"), "failures": row.get("failures") or []}
                    for row in current_results
                    if row.get("outcome") == "failed"
                ] + ([{"ticker": None, "error": _bounded_error(batch_failure), "scope": "batch"}] if batch_failure else []),
            },
            "message": (
                f"Yahoo quote/history: fresh={counts['fresh']}, lkg={counts['lkg']}, "
                f"pending_history={counts['pending_history']}, unavailable={counts['unavailable']}, "
                f"pending_acquisition={counts['pending_acquisition']}, terminal={counts['terminal']}, "
                f"catalogue={counts['active']}, eligible={counts['eligible']}, "
                f"retry={counts['retry']}, failed={counts['failed']}, source_stale={counts['stale']}. "
                "Pending history is a normal new-listing state and self-resolves on the next Yahoo acquisition."
            ),
        }
        index_filename = CORE_ETF_INDEX_FILENAME if active_universe_scope == "core_etf" else DEFAULT_INDEX_FILENAME
        _write_json(self.root / index_filename, index)
        return index
