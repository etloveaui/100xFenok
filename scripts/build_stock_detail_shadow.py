#!/usr/bin/env python3
"""Build private stock-detail resolver diagnostics without changing market facts."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import tempfile
from pathlib import Path
from typing import Any, Callable, Mapping

from data_supply_state import (
    DataSupplyStateStore,
    IntegrityError,
    canonical_json_bytes,
    canonical_sha256,
    selection_age_status,
)
from data_supply_stock_detail import (
    FROZEN_STOCK_DETAIL_TICKERS,
    FROZEN_TICKER_SHA256,
    validate_stock_detail_candidate,
)
from migrate_data_supply_stock_detail import StockDetailMigration


DOMAIN = "stock_detail"
SHADOW_SCHEMA = "data-supply-stock-detail-shadow/v1"
COVERAGE_SCHEMA = "data-supply-stock-detail-coverage/v1"
STATE_KEYS = (
    "fresh_primary",
    "fresh_fallback",
    "lkg_primary",
    "lkg_fallback",
    "unavailable",
)
FACT_COMPARE_KEYS = ("value", "source", "as_of", "fetched_at")
APPROVED_YAHOO_ONLY_COUNT = 1129


class ShadowBuildError(RuntimeError):
    """The private shadow could not be proven from one stable state snapshot."""


def _strict_json_bytes(payload: bytes, label: str) -> dict[str, Any]:
    def reject_constant(token: str) -> None:
        raise ValueError(token)

    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"duplicate key: {key}")
            result[key] = value
        return result

    try:
        value = json.loads(
            payload.decode("utf-8"),
            parse_constant=reject_constant,
            object_pairs_hook=unique_object,
        )
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        raise ShadowBuildError(f"{label} is not strict JSON") from exc
    if not isinstance(value, dict):
        raise ShadowBuildError(f"{label} root must be an object")
    return value


def _fsync_directory(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _temporary_roots() -> set[Path]:
    roots = {
        Path(tempfile.gettempdir()),
        Path("/private/tmp"),
        Path("/tmp"),
        Path("/var/folders"),
    }
    env_tmp = os.environ.get("TMPDIR")
    if env_tmp:
        roots.add(Path(env_tmp))
    return {path.expanduser().resolve(strict=False) for path in roots}


def _inside_any(path: Path, roots: set[Path]) -> bool:
    resolved = path.expanduser().resolve(strict=False)
    return any(
        resolved == root.resolve(strict=False)
        or root.resolve(strict=False) in resolved.parents
        for root in roots
    )


def _reject_symlink_components(root: Path, path: Path, label: str) -> None:
    try:
        relative = path.relative_to(root)
    except ValueError as exc:
        raise ShadowBuildError(f"{label} escapes its lexical root") from exc
    cursor = root
    for part in relative.parts:
        cursor = cursor / part
        if cursor.is_symlink():
            raise ShadowBuildError(f"{label} contains a symlink")


def _atomic_replace(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and (path.is_symlink() or not path.is_file()):
        raise ShadowBuildError(f"shadow output is unsafe: {path}")
    if path.parent.is_symlink():
        raise ShadowBuildError(f"shadow output parent is unsafe: {path.parent}")
    fd, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        _fsync_directory(path.parent)
    finally:
        if temporary.exists():
            temporary.unlink()


def _load_market_facts_builder() -> Callable[..., dict[str, Any]]:
    path = Path(__file__).resolve().with_name("build-market-facts.py")
    spec = importlib.util.spec_from_file_location("stock_detail_shadow_market_facts", path)
    if spec is None or spec.loader is None:
        raise ShadowBuildError("cannot load market-facts projection helper")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.build_one


class StockDetailShadowBuilder:
    def __init__(
        self,
        *,
        repo_root: Path | str,
        state_root: Path | str,
        market_facts_root: Path | str,
        tickers: tuple[str, ...] = FROZEN_STOCK_DETAIL_TICKERS,
        failpoint_hook: Callable[[str], None] | None = None,
        market_facts_builder: Callable[..., dict[str, Any]] | None = None,
    ):
        self.repo_root = Path(repo_root).expanduser().resolve()
        state = Path(state_root).expanduser()
        market = Path(market_facts_root).expanduser()
        state_input = state if state.is_absolute() else self.repo_root / state
        market_input = market if market.is_absolute() else self.repo_root / market
        self._state_root_lexical = Path(os.path.abspath(state_input))
        self._market_facts_root_lexical = Path(os.path.abspath(market_input))
        self.state_root = self._state_root_lexical.resolve(strict=False)
        self.market_facts_root = self._market_facts_root_lexical.resolve(strict=False)
        self.tickers = tuple(sorted(tickers))
        if not self.tickers or len(set(self.tickers)) != len(self.tickers):
            raise ShadowBuildError("shadow tickers must be a non-empty unique set")
        self._failpoint_hook = failpoint_hook or (lambda _point: None)
        self._market_facts_builder = market_facts_builder
        expected_market = self.repo_root / "data/computed/market_facts"
        if self.market_facts_root != expected_market.resolve(strict=False):
            raise ShadowBuildError("market-facts root must use the repository canonical path")
        _reject_symlink_components(self.repo_root, expected_market, "market-facts root")
        expected_state = self.repo_root / "data/admin/data-supply-state/v1"
        if self.state_root == expected_state.resolve(strict=False):
            _reject_symlink_components(self.repo_root, expected_state, "repository state root")
        elif not _inside_any(self.state_root, _temporary_roots()):
            raise ShadowBuildError("state root must use the repository path or runner temp")

    def _failpoint(self, point: str) -> None:
        self._failpoint_hook(point)

    def _inside(self, root: Path, path: Path, label: str) -> Path:
        resolved = path.resolve(strict=False)
        try:
            resolved.relative_to(root)
        except ValueError as exc:
            raise ShadowBuildError(f"{label} escapes its allowed root") from exc
        return resolved

    def _regular_file(self, path: Path, *, root: Path, label: str) -> bytes:
        self._inside(root, path, label)
        cursor = root
        try:
            relative = path.relative_to(root)
        except ValueError as exc:
            raise ShadowBuildError(f"{label} escapes its allowed root") from exc
        for part in relative.parts:
            cursor = cursor / part
            if cursor.is_symlink():
                raise ShadowBuildError(f"{label} contains a symlink")
        if not path.is_file() or path.is_symlink():
            raise ShadowBuildError(f"{label} is missing or unsafe")
        return path.read_bytes()

    def _market_index(self) -> tuple[dict[str, Any], bytes]:
        if not self.market_facts_root.is_dir() or self.market_facts_root.is_symlink():
            raise ShadowBuildError("market-facts root is missing or unsafe")
        raw = self._regular_file(
            self.market_facts_root / "index.json",
            root=self.market_facts_root,
            label="market-facts index",
        )
        index = _strict_json_bytes(raw, "market-facts index")
        if index.get("schema_version") != "market-facts/v1" or not isinstance(index.get("rows"), list):
            raise ShadowBuildError("market-facts index contract mismatch")
        resolver = index.get("resolver")
        if not isinstance(resolver, Mapping) or not isinstance(resolver.get("field_source_policy"), Mapping):
            raise ShadowBuildError("market-facts field-source policy is missing")
        return index, raw

    def _market_tree_snapshot(self) -> tuple[str, dict[str, str]]:
        rows = []
        digests = {}
        for path in sorted(self.market_facts_root.rglob("*.json")):
            if path.is_symlink() or not path.is_file():
                raise ShadowBuildError("market-facts tree contains an unsafe entry")
            raw = self._regular_file(path, root=self.market_facts_root, label="market-facts artifact")
            relative = path.relative_to(self.market_facts_root).as_posix()
            sha = hashlib.sha256(raw).hexdigest()
            rows.append({"path": relative, "sha256": sha})
            digests[relative] = sha
        return canonical_sha256(rows), digests

    def _migration_pin_sha256(self) -> str:
        path = self.state_root / "domains" / DOMAIN / "migration.json"
        migration = StockDetailMigration(
            self.repo_root,
            self.state_root,
            tickers=self.tickers,
            enforce_approved_digests=(self.tickers == tuple(sorted(FROZEN_STOCK_DETAIL_TICKERS))),
        )
        try:
            manifest, raw = migration.load_manifest(path)
            migration.verify_state(manifest, expected_count=len(self.tickers))
        except Exception as exc:
            raise ShadowBuildError("stock-detail migration pin/state validation failed") from exc
        return hashlib.sha256(raw).hexdigest()

    def _selected_payload(
        self,
        store: DataSupplyStateStore,
        ticker: str,
        selected: Mapping[str, Any],
    ) -> tuple[dict[str, Any], bytes]:
        ref = selected.get("payload_ref")
        if not isinstance(ref, Mapping) or ref.get("kind") not in {"provider_object", "provider_lkg"}:
            raise ShadowBuildError(f"selected ref is invalid: {ticker}")
        relative = ref.get("path")
        if not isinstance(relative, str):
            raise ShadowBuildError(f"selected ref path is invalid: {ticker}")
        path = self.state_root / relative
        raw = self._regular_file(path, root=self.state_root, label=f"selected object {ticker}")
        if hashlib.sha256(raw).hexdigest() != selected.get("payload_sha256"):
            raise ShadowBuildError(f"selected object digest mismatch: {ticker}")
        try:
            resolved = store.read_resolved_payload(DOMAIN, ticker)
        except Exception as exc:
            raise ShadowBuildError(f"selected state validation failed: {ticker}") from exc
        payload = _strict_json_bytes(raw, f"selected object {ticker}")
        if canonical_json_bytes(payload) != canonical_json_bytes(resolved):
            raise ShadowBuildError(f"selected state/object mismatch: {ticker}")
        try:
            validated = validate_stock_detail_candidate(
                provider=selected["provider"],
                entity=ticker,
                provider_path=selected["provider_path"],
                payload_bytes=raw,
                observed_at=selected["observed_at"],
                expected_sha256=selected["payload_sha256"],
            )
        except (KeyError, ValueError) as exc:
            raise ShadowBuildError(f"selected payload contract mismatch: {ticker}") from exc
        for field in (
            "provider",
            "provider_schema",
            "entity",
            "provider_path",
            "source_as_of",
            "payload_sha256",
        ):
            if getattr(validated, field) != selected.get(field):
                raise ShadowBuildError(f"selected metadata differs from payload: {ticker}/{field}")
        state = selected.get("resolution_state")
        expected_provider = "stockanalysis" if state in {"fresh_primary", "lkg_primary"} else "yahoo_finance"
        expected_ref_kind = "provider_lkg" if state in {"lkg_primary", "lkg_fallback"} else "provider_object"
        expected_depth = {
            "fresh_primary": 0,
            "fresh_fallback": 1,
            "lkg_primary": 1,
            "lkg_fallback": 2,
        }.get(state)
        if (
            selected.get("provider") != expected_provider
            or ref.get("kind") != expected_ref_kind
            or selected.get("fallback_depth") != expected_depth
        ):
            raise ShadowBuildError(f"selected provider/state/ref semantics mismatch: {ticker}")
        return payload, raw

    @staticmethod
    def _fact_projection(value: Any) -> dict[str, Any] | None:
        if not isinstance(value, Mapping):
            return None
        return {key: value.get(key) for key in FACT_COMPARE_KEYS}

    def _field_diagnostics(
        self,
        current_facts: Mapping[str, Any],
        shadow_facts: Mapping[str, Any],
    ) -> dict[str, Any]:
        result = {}
        for field in sorted(set(current_facts) | set(shadow_facts)):
            current = self._fact_projection(current_facts.get(field))
            shadow = self._fact_projection(shadow_facts.get(field))
            if current is None:
                status = "missing_in_current"
            elif shadow is None:
                status = "missing_in_shadow"
            elif canonical_json_bytes(current) == canonical_json_bytes(shadow):
                status = "match"
            else:
                status = "different"
            result[field] = {
                "status": status,
                "current_source": current.get("source") if current else None,
                "shadow_source": shadow.get("source") if shadow else None,
                "current_value_sha256": canonical_sha256(current.get("value")) if current else None,
                "shadow_value_sha256": canonical_sha256(shadow.get("value")) if shadow else None,
                "current_as_of": current.get("as_of") if current else None,
                "shadow_as_of": shadow.get("as_of") if shadow else None,
                "current_fetched_at": current.get("fetched_at") if current else None,
                "shadow_fetched_at": shadow.get("fetched_at") if shadow else None,
            }
        return result

    def _project_selected(
        self,
        ticker: str,
        selected: Mapping[str, Any],
        payload: Mapping[str, Any],
    ) -> dict[str, Any]:
        builder = self._market_facts_builder or _load_market_facts_builder()
        self._market_facts_builder = builder
        authority = {
            "domain": DOMAIN,
            "provider": selected["provider"],
            "resolution_state": selected["resolution_state"],
            "shadow_only": True,
        }
        if selected["provider"] == "stockanalysis":
            projection = builder(
                ticker,
                None,
                payload,
                None,
                detail_source_path=f"stockanalysis/stocks/{ticker}.json",
                detail_authority=authority,
            )
        elif selected["provider"] == "yahoo_finance":
            projection = builder(
                ticker,
                payload,
                None,
                None,
                detail_authority=authority,
            )
        else:
            raise ShadowBuildError(f"selected provider is outside authority set: {ticker}")
        if not isinstance(projection, Mapping) or not isinstance(projection.get("facts"), Mapping):
            raise ShadowBuildError(f"provider-atomic projection is invalid: {ticker}")
        return dict(projection)

    def _current_market_fact(self, ticker: str) -> tuple[dict[str, Any], bytes]:
        raw = self._regular_file(
            self.market_facts_root / "tickers" / f"{ticker}.json",
            root=self.market_facts_root,
            label=f"market-facts ticker {ticker}",
        )
        payload = _strict_json_bytes(raw, f"market-facts ticker {ticker}")
        if (
            payload.get("schema_version") != "market-facts/v1"
            or payload.get("ticker") != ticker
            or payload.get("asset_type") != "stock"
            or not isinstance(payload.get("facts"), Mapping)
        ):
            raise ShadowBuildError(f"market-facts ticker contract mismatch: {ticker}")
        return payload, raw

    @staticmethod
    def _active_identity(active: Mapping[str, Any]) -> str:
        return canonical_sha256(
            {
                "transaction_id": active.get("transaction_id"),
                "manifest_sha256": active.get("manifest_sha256"),
                "current": active.get("current"),
                "lkg": active.get("lkg"),
                "recovery": active.get("recovery"),
                "decision": active.get("decision"),
                "active_decision": active.get("active_decision"),
                "retained_generation_ids": active.get("retained_generation_ids"),
            }
        )

    def _build(self, *, expected_count: int) -> tuple[dict[str, Any], dict[str, Any]]:
        if expected_count != len(self.tickers):
            raise ShadowBuildError(
                f"shadow enrollment count mismatch: expected={expected_count} actual={len(self.tickers)}"
            )
        membership_sha = canonical_sha256(list(self.tickers))
        if self.tickers == tuple(sorted(FROZEN_STOCK_DETAIL_TICKERS)) and membership_sha != FROZEN_TICKER_SHA256:
            raise ShadowBuildError("frozen stock-detail membership digest mismatch")
        if not self.state_root.is_dir() or self.state_root.is_symlink():
            raise ShadowBuildError("stock-detail state root is missing or unsafe")
        store = DataSupplyStateStore(self.state_root, provider_truth_root=self.repo_root)
        try:
            active_before = store.read_active_domain(DOMAIN)
        except Exception as exc:
            raise ShadowBuildError("active stock-detail state validation failed") from exc
        recovery_keys = set(active_before.get("recovery", {}))
        current_keys = set(active_before.get("current", {}))
        lkg_keys = set(active_before.get("lkg", {}))
        if (
            recovery_keys != set(self.tickers)
            or not current_keys.issubset(recovery_keys)
            or not lkg_keys.issubset(recovery_keys)
        ):
            raise ShadowBuildError("active stock-detail enrollment differs from the frozen cohort")
        market_index, market_index_raw = self._market_index()
        market_tree_before, market_files_before = self._market_tree_snapshot()
        _, market_index_after_tree = self._market_index()
        if market_index_after_tree != market_index_raw:
            raise ShadowBuildError("market-facts index changed during initial tree scan")
        market_rows = {
            row.get("ticker"): row
            for row in market_index["rows"]
            if isinstance(row, Mapping) and isinstance(row.get("ticker"), str)
        }
        if len(market_rows) != len(market_index["rows"]):
            raise ShadowBuildError("market-facts index contains duplicate or malformed ticker rows")
        dual_source = 0
        yahoo_only = 0
        for row in market_rows.values():
            sources = row.get("sources")
            if row.get("asset_type") != "stock" or not isinstance(sources, Mapping):
                continue
            if sources.get("yf") is True and sources.get("stockanalysis") is not True:
                yahoo_only += 1
        state_counts = {key: 0 for key in STATE_KEYS}
        diagnostics = {"fresh": 0, "stale": 0, "fallback": 0, "lkg": 0, "unavailable": 0}
        entries = {}
        for ticker in self.tickers:
            market_row = market_rows.get(ticker)
            sources = market_row.get("sources") if isinstance(market_row, Mapping) else None
            if not isinstance(sources, Mapping) or sources.get("yf") is not True or sources.get("stockanalysis") is not True:
                raise ShadowBuildError(f"enrolled ticker is not dual-source in market facts: {ticker}")
            dual_source += 1
            current_fact, current_raw = self._current_market_fact(ticker)
            market_relative = f"tickers/{ticker}.json"
            if hashlib.sha256(current_raw).hexdigest() != market_files_before.get(market_relative):
                raise ShadowBuildError(f"market-facts ticker changed after snapshot pin: {ticker}")
            file_sources = current_fact.get("sources")
            source_files = current_fact.get("source_files")
            if (
                not isinstance(file_sources, Mapping)
                or canonical_json_bytes(file_sources) != canonical_json_bytes(sources)
                or market_row.get("fact_count") != len(current_fact["facts"])
                or not isinstance(source_files, Mapping)
                or source_files.get("yf") != f"yf/finance/{ticker}.json"
                or source_files.get("stockanalysis") != f"stockanalysis/stocks/{ticker}.json"
            ):
                raise ShadowBuildError(f"market-facts ticker/index source contract mismatch: {ticker}")
            selected = active_before["current"].get(ticker)
            if selected is None:
                recovery = active_before["recovery"].get(ticker)
                if not isinstance(recovery, Mapping) or recovery.get("last_transition") != "unavailable":
                    raise ShadowBuildError(f"unselected ticker is not committed unavailable: {ticker}")
                state_counts["unavailable"] += 1
                diagnostics["unavailable"] += 1
                diagnostics["stale"] += 1
                fields = {
                    field: {
                        "status": "missing_in_shadow",
                        "current_source": self._fact_projection(value).get("source") if self._fact_projection(value) else None,
                        "shadow_source": None,
                        "current_value_sha256": canonical_sha256(self._fact_projection(value).get("value")) if self._fact_projection(value) else None,
                        "shadow_value_sha256": None,
                        "current_as_of": self._fact_projection(value).get("as_of") if self._fact_projection(value) else None,
                        "shadow_as_of": None,
                        "current_fetched_at": self._fact_projection(value).get("fetched_at") if self._fact_projection(value) else None,
                        "shadow_fetched_at": None,
                    }
                    for field, value in sorted(current_fact["facts"].items())
                }
                entries[ticker] = {
                    "ticker": ticker,
                    "resolution_state": "unavailable",
                    "selected_provider": None,
                    "payload_sha256": None,
                    "market_fact_sha256": hashlib.sha256(current_raw).hexdigest(),
                    "field_diagnostics": fields,
                    "field_status_counts": {
                        "match": 0,
                        "different": 0,
                        "missing_in_current": 0,
                        "missing_in_shadow": len(current_fact["facts"]),
                    },
                }
                continue
            if not isinstance(selected, Mapping) or selected.get("resolution_state") not in STATE_KEYS[:-1]:
                raise ShadowBuildError(f"selected state is invalid: {ticker}")
            state = selected["resolution_state"]
            state_counts[state] += 1
            age_status = selection_age_status(state, selected.get("age_seconds"), domain=DOMAIN)
            diagnostics[age_status] += 1
            if state.endswith("fallback"):
                diagnostics["fallback"] += 1
            if state.startswith("lkg_"):
                diagnostics["lkg"] += 1
            payload, _ = self._selected_payload(store, ticker, selected)
            projection = self._project_selected(ticker, selected, payload)
            fields = self._field_diagnostics(current_fact["facts"], projection["facts"])
            status_counts = {
                status: sum(1 for row in fields.values() if row["status"] == status)
                for status in ("match", "different", "missing_in_current", "missing_in_shadow")
            }
            entries[ticker] = {
                "ticker": ticker,
                "resolution_state": state,
                "age_status": age_status,
                "selected_provider": selected["provider"],
                "payload_sha256": selected["payload_sha256"],
                "source_as_of": selected["source_as_of"],
                "market_fact_sha256": hashlib.sha256(current_raw).hexdigest(),
                "field_diagnostics": fields,
                "field_status_counts": status_counts,
            }
        if dual_source != expected_count:
            raise ShadowBuildError("dual-source enrolled partition count mismatch")
        if self.tickers == tuple(sorted(FROZEN_STOCK_DETAIL_TICKERS)) and yahoo_only != APPROVED_YAHOO_ONLY_COUNT:
            raise ShadowBuildError("Yahoo-only legacy partition count changed")
        generation_decision = active_before.get("decision")
        generated_at = generation_decision.get("decided_at") if isinstance(generation_decision, Mapping) else None
        if not isinstance(generated_at, str):
            raise ShadowBuildError("active state has no deterministic decision time")
        field_policy = market_index["resolver"]["field_source_policy"]
        snapshot = {
            "active_transaction_id": active_before.get("transaction_id"),
            "active_generation_manifest_sha256": active_before.get("manifest_sha256"),
            "membership_sha256": membership_sha,
            "migration_pin_sha256": self._migration_pin_sha256(),
            "market_facts_index_sha256": hashlib.sha256(market_index_raw).hexdigest(),
            "market_facts_tree_sha256": market_tree_before,
            "field_source_policy_sha256": canonical_sha256(field_policy),
        }
        snapshot_sha = canonical_sha256(snapshot)
        shadow = {
            "schema_version": SHADOW_SCHEMA,
            "domain": DOMAIN,
            "generated_at": generated_at,
            "shadow_only": True,
            "snapshot": snapshot,
            "snapshot_sha256": snapshot_sha,
            "entry_count": len(entries),
            "entries": entries,
        }
        shadow_sha = hashlib.sha256(canonical_json_bytes(shadow)).hexdigest()
        coverage = {
            "schema_version": COVERAGE_SCHEMA,
            "domain": DOMAIN,
            "generated_at": generated_at,
            "shadow_only": True,
            "snapshot": snapshot,
            "snapshot_sha256": snapshot_sha,
            "shadow_sha256": shadow_sha,
            "partitions": {
                "dual_source_enrolled": dual_source,
                "yahoo_only_legacy_excluded": yahoo_only,
            },
            "resolution_state_counts": state_counts,
            "diagnostics": diagnostics,
            "product_readiness_mutated": False,
            "field_source_policy_mutated": False,
            "selected_market_facts_mutated": False,
        }
        self._failpoint("before_active_recheck")
        try:
            active_after = store.read_active_domain(DOMAIN)
        except Exception as exc:
            raise ShadowBuildError("active stock-detail state changed or became invalid") from exc
        if self._active_identity(active_after) != self._active_identity(active_before):
            raise ShadowBuildError("active stock-detail transaction changed during shadow build")
        market_tree_after, market_files_after = self._market_tree_snapshot()
        if market_tree_after != market_tree_before or market_files_after != market_files_before:
            raise ShadowBuildError("market-facts tree changed during shadow build")
        _, market_index_after = self._market_index()
        if market_index_after != market_index_raw:
            raise ShadowBuildError("market-facts index changed during shadow build")
        return shadow, coverage

    def build(self, *, expected_count: int) -> tuple[dict[str, Any], dict[str, Any]]:
        try:
            return self._build(expected_count=expected_count)
        except ShadowBuildError:
            raise
        except (IntegrityError, KeyError, OSError, TypeError, ValueError) as exc:
            raise ShadowBuildError(f"stock-detail shadow build failed: {exc}") from exc

    def _validate_output_paths(self, output: Path | str, coverage_output: Path | str) -> tuple[Path, Path]:
        expected_root = (self.state_root / "domains" / DOMAIN).resolve(strict=False)
        output_path = Path(output).expanduser()
        coverage_path = Path(coverage_output).expanduser()
        if not output_path.is_absolute():
            output_path = self.repo_root / output_path
        if not coverage_path.is_absolute():
            coverage_path = self.repo_root / coverage_path
        output_path = output_path.resolve(strict=False)
        coverage_path = coverage_path.resolve(strict=False)
        if (
            output_path != expected_root / "market_facts_shadow.json"
            or coverage_path != expected_root / "coverage.json"
        ):
            raise ShadowBuildError("shadow outputs must use the exact private allowlisted paths")
        for path in (output_path, coverage_path):
            cursor = self.state_root
            try:
                relative = path.relative_to(self.state_root)
            except ValueError as exc:
                raise ShadowBuildError("shadow output escapes state root") from exc
            for part in relative.parts[:-1]:
                cursor = cursor / part
                if cursor.exists() and cursor.is_symlink():
                    raise ShadowBuildError("shadow output path contains a symlink")
            if path.is_symlink() or (path.exists() and not path.is_file()):
                raise ShadowBuildError("shadow output target must be absent or a regular file")
        return output_path, coverage_path

    def write(
        self,
        *,
        expected_count: int,
        output: Path | str,
        coverage_output: Path | str,
    ) -> dict[str, Any]:
        output_path, coverage_path = self._validate_output_paths(output, coverage_output)
        shadow, coverage = self.build(expected_count=expected_count)
        shadow_bytes = canonical_json_bytes(shadow)
        coverage_bytes = canonical_json_bytes(coverage)
        _atomic_replace(output_path, shadow_bytes)
        self._failpoint("after_shadow_write")
        _atomic_replace(coverage_path, coverage_bytes)
        self._failpoint("after_coverage_write")
        self.validate_output_pair(output_path, coverage_path)

        def display_path(path: Path) -> str:
            try:
                return path.relative_to(self.repo_root).as_posix()
            except ValueError:
                return path.as_posix()

        return {
            "snapshot_sha256": shadow["snapshot_sha256"],
            "shadow_sha256": hashlib.sha256(shadow_bytes).hexdigest(),
            "coverage_sha256": hashlib.sha256(coverage_bytes).hexdigest(),
            "entries": shadow["entry_count"],
            "output": display_path(output_path),
            "coverage_output": display_path(coverage_path),
        }

    def validate_output_pair(self, output: Path | str, coverage_output: Path | str) -> dict[str, Any]:
        output_path, coverage_path = self._validate_output_paths(output, coverage_output)
        shadow_raw = self._regular_file(output_path, root=self.state_root, label="shadow report")
        coverage_raw = self._regular_file(coverage_path, root=self.state_root, label="shadow coverage")
        shadow = _strict_json_bytes(shadow_raw, "shadow report")
        coverage = _strict_json_bytes(coverage_raw, "shadow coverage")
        if shadow_raw != canonical_json_bytes(shadow) or coverage_raw != canonical_json_bytes(coverage):
            raise ShadowBuildError("shadow output bytes are not canonical")
        if shadow.get("schema_version") != SHADOW_SCHEMA or coverage.get("schema_version") != COVERAGE_SCHEMA:
            raise ShadowBuildError("shadow output schema mismatch")
        shadow_sha = hashlib.sha256(shadow_raw).hexdigest()
        snapshot = shadow.get("snapshot")
        if not isinstance(snapshot, Mapping) or shadow.get("snapshot_sha256") != canonical_sha256(snapshot):
            raise ShadowBuildError("shadow snapshot digest mismatch")
        entries = shadow.get("entries")
        if (
            shadow.get("domain") != DOMAIN
            or shadow.get("shadow_only") is not True
            or not isinstance(entries, Mapping)
            or set(entries) != set(self.tickers)
            or shadow.get("entry_count") != len(entries)
        ):
            raise ShadowBuildError("shadow report identity/count mismatch")
        derived_states = {key: 0 for key in STATE_KEYS}
        for ticker, entry in entries.items():
            if not isinstance(entry, Mapping) or entry.get("ticker") != ticker:
                raise ShadowBuildError("shadow entry identity mismatch")
            state = entry.get("resolution_state")
            if state not in derived_states:
                raise ShadowBuildError("shadow entry resolution state mismatch")
            derived_states[state] += 1
        partitions = coverage.get("partitions")
        if (
            coverage.get("domain") != DOMAIN
            or coverage.get("shadow_only") is not True
            or coverage.get("resolution_state_counts") != derived_states
            or not isinstance(partitions, Mapping)
            or partitions.get("dual_source_enrolled") != len(self.tickers)
        ):
            raise ShadowBuildError("shadow coverage identity/count mismatch")
        if (
            self.tickers == tuple(sorted(FROZEN_STOCK_DETAIL_TICKERS))
            and partitions.get("yahoo_only_legacy_excluded") != APPROVED_YAHOO_ONLY_COUNT
        ):
            raise ShadowBuildError("shadow coverage Yahoo-only denominator mismatch")
        if (
            coverage.get("shadow_sha256") != shadow_sha
            or coverage.get("snapshot_sha256") != shadow.get("snapshot_sha256")
            or coverage.get("snapshot") != shadow.get("snapshot")
        ):
            raise ShadowBuildError("shadow and coverage outputs are not one atomic logical snapshot")
        expected_shadow, expected_coverage = self.build(expected_count=len(self.tickers))
        if (
            shadow_raw != canonical_json_bytes(expected_shadow)
            or coverage_raw != canonical_json_bytes(expected_coverage)
        ):
            raise ShadowBuildError("shadow output pair differs from current validated evidence")
        return {
            "shadow_sha256": shadow_sha,
            "coverage_sha256": hashlib.sha256(coverage_raw).hexdigest(),
            "snapshot_sha256": shadow["snapshot_sha256"],
        }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo-root",
        default=str(Path(__file__).resolve().parents[1]),
        help="nested 100xFenok repository root",
    )
    parser.add_argument("--state-root", required=True)
    parser.add_argument("--market-facts-root", required=True)
    parser.add_argument("--expected-count", type=int, required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--coverage-output", required=True)
    args = parser.parse_args()
    repo_root = Path(args.repo_root).expanduser().resolve()
    builder = StockDetailShadowBuilder(
        repo_root=repo_root,
        state_root=args.state_root,
        market_facts_root=args.market_facts_root,
    )
    result = builder.write(
        expected_count=args.expected_count,
        output=args.output,
        coverage_output=args.coverage_output,
    )
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
