#!/usr/bin/env python3
"""Fail-closed migration of the frozen stock-detail provider pairs into R2 state."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import tempfile
from pathlib import Path, PurePosixPath
from typing import Any, Callable, Mapping

from data_supply_policy import get_domain_policy
from data_supply_state import (
    DataSupplyStateStore,
    IntegrityError,
    SchemaError,
    build_selection,
    canonical_json_bytes,
    canonical_sha256,
    deterministic_event_id,
    validate_observation,
)
from data_supply_stock_detail import (
    FROZEN_STOCK_DETAIL_TICKERS,
    FROZEN_TICKER_SHA256,
    ValidatedStockDetail,
    record_stock_detail_success,
    validate_stock_detail_candidate,
)


DOMAIN = "stock_detail"
MIGRATION_SCHEMA = "data-supply-migration/v1"
APPROVED_PAIR_SHA256 = "9db610adf062366f020619443160540204b2ebc9f0b304b187aeafa966e7d994"
APPROVED_DELETE_SHA256 = "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
APPROVED_YAHOO_ONLY_COUNT = 1129
PROTECTED_INDEX_PATH = "data/computed/data-supply/etf-detail/index.json"
APPROVED_PROTECTED_SNAPSHOT = {
    "index_path": PROTECTED_INDEX_PATH,
    "index_file_sha256": "f97b770f971fe5690f5164a2f90633fdd832d710bbb3728451464d6d887940d3",
    "active_generation_manifest_sha256": "42c42a520ea40773def5c9e11286ccde92fa40d164235bb80dfd78b093ff69a2",
    "active_transaction_id": "89f1b0779d6471a2657a3cc2b40a0fa95ac92ce7129f947fad715639f3ec61fd",
    "index_sha256": "f00041ebd6276af7c0ad581b5d7f1081dc8adf6c95e48c78b65164b8833c9137",
    "membership_sha256": "6b30e5d314daae54f635ba46d4936c4ab228416599dcc35eba8638115fdeff32",
    "enrolled_count": 718,
}

_POLICY = get_domain_policy(DOMAIN)
_PRIMARY = _POLICY.primary.name
_FALLBACK = _POLICY.fallback.name
_EXPECTED_MANIFEST_KEYS = {
    "schema_version",
    "migration_id",
    "domain",
    "created_at",
    "expected_count",
    "ticker_sha256",
    "pair_sha256",
    "delete_sha256",
    "delete_candidates",
    "excluded_yahoo_only_count",
    "protected_snapshot",
    "payload_refs",
    "entries",
}


def _parse_timestamp(value: Any, field: str) -> dt.datetime:
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
        raise IntegrityError(f"{label} is not strict JSON") from exc
    if not isinstance(value, dict):
        raise IntegrityError(f"{label} root must be an object")
    return value


def _safe_relative_path(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value or "\\" in value or "\x00" in value:
        raise SchemaError(f"{field} must be repository-relative")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise SchemaError(f"{field} must be repository-relative")
    return path.as_posix()


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
        raise IntegrityError(f"{label} escapes its lexical root") from exc
    cursor = root
    for part in relative.parts:
        cursor = cursor / part
        if cursor.is_symlink():
            raise IntegrityError(f"{label} contains a symlink")


def _atomic_write_exact(path: Path, payload: bytes, *, immutable: bool = True) -> None:
    if path.exists():
        if path.is_symlink() or not path.is_file():
            raise IntegrityError(f"output path is unsafe: {path}")
        if path.read_bytes() == payload:
            return
        if immutable:
            raise IntegrityError(f"immutable output collision: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.parent.is_symlink():
        raise IntegrityError(f"output parent is unsafe: {path.parent}")
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


class StockDetailMigration:
    """Plan, verify, apply, and archive one exact frozen stock-detail cohort."""

    def __init__(
        self,
        repo_root: Path | str,
        state_root: Path | str,
        *,
        tickers: tuple[str, ...] = FROZEN_STOCK_DETAIL_TICKERS,
        failpoint_hook: Callable[[str], None] | None = None,
        protected_index_path: str | None = PROTECTED_INDEX_PATH,
        enforce_approved_digests: bool = True,
        enforce_protected_snapshot: bool | None = None,
        approved_protected_snapshot: Mapping[str, Any] | None = None,
    ):
        self.repo_root = Path(repo_root).expanduser().resolve()
        state = Path(state_root).expanduser()
        state_input = state if state.is_absolute() else self.repo_root / state
        self._state_root_lexical = Path(os.path.abspath(state_input))
        self.state_root = self._state_root_lexical.resolve(strict=False)
        self.tickers = tuple(sorted(tickers))
        if len(set(self.tickers)) != len(self.tickers) or not self.tickers:
            raise SchemaError("migration tickers must be a non-empty unique set")
        self._failpoint_hook = failpoint_hook or (lambda _point: None)
        self.protected_index_path = protected_index_path
        self.enforce_approved_digests = enforce_approved_digests
        self.enforce_protected_snapshot = (
            enforce_approved_digests
            if enforce_protected_snapshot is None
            else enforce_protected_snapshot
        )
        self.approved_protected_snapshot = dict(
            APPROVED_PROTECTED_SNAPSHOT
            if approved_protected_snapshot is None
            else approved_protected_snapshot
        )

    def _failpoint(self, point: str) -> None:
        self._failpoint_hook(point)

    def _repo_path(self, relative: str) -> Path:
        relative = _safe_relative_path(relative, "repository path")
        path = self.repo_root / relative
        cursor = self.repo_root
        for part in PurePosixPath(relative).parts:
            cursor = cursor / part
            if cursor.is_symlink():
                raise IntegrityError(f"repository path contains a symlink: {relative}")
        try:
            path.resolve(strict=False).relative_to(self.repo_root)
        except ValueError as exc:
            raise IntegrityError("repository path escapes the repository") from exc
        return path

    def _regular_source(self, relative: str) -> tuple[Path, bytes]:
        path = self._repo_path(relative)
        if not path.is_file() or path.is_symlink():
            raise IntegrityError(f"migration source is missing or unsafe: {relative}")
        return path, path.read_bytes()

    def _source_names(self) -> tuple[set[str], set[str]]:
        sa_root = self._repo_path("data/stockanalysis/stocks")
        yf_root = self._repo_path("data/yf/finance")
        if not sa_root.is_dir() or not yf_root.is_dir():
            raise IntegrityError("stock-detail provider roots are missing")
        if sa_root.is_symlink() or yf_root.is_symlink():
            raise IntegrityError("stock-detail provider roots must not be symlinks")
        def names(root: Path, label: str) -> set[str]:
            result = set()
            for path in root.glob("*.json"):
                if path.is_symlink() or not path.is_file():
                    raise IntegrityError(f"{label} root contains an unsafe JSON entry")
                result.add(path.stem)
            return result

        sa_names = names(sa_root, "StockAnalysis stock")
        yf_names = names(yf_root, "Yahoo finance")
        return sa_names, yf_names

    def _delete_candidates(self) -> list[str]:
        root = self._repo_path("data/stockanalysis/stocks")
        candidates = []
        for path in sorted(root.glob("*.json")):
            if path.is_symlink() or not path.is_file():
                raise IntegrityError("StockAnalysis stock root contains an unsafe entry")
            payload = _strict_json_bytes(path.read_bytes(), path.relative_to(self.repo_root).as_posix())
            if payload.get("source") == "yahoo_finance" or payload.get("source_provider") == "yahoo_finance":
                candidates.append(path.relative_to(self.repo_root).as_posix())
        return candidates

    def _excluded_yahoo_only_count(self, sa_names: set[str], yf_names: set[str]) -> int:
        index_path = self.repo_root / "data/computed/market_facts/index.json"
        if index_path.is_file() and not index_path.is_symlink():
            index = _strict_json_bytes(index_path.read_bytes(), "market_facts index")
            rows = index.get("rows")
            if isinstance(rows, list):
                return sum(
                    1
                    for row in rows
                    if isinstance(row, Mapping)
                    and row.get("asset_type") == "stock"
                    and isinstance(row.get("sources"), Mapping)
                    and row["sources"].get("yf") is True
                    and row["sources"].get("stockanalysis") is not True
                )
        return len(yf_names - sa_names)

    def _protected_snapshot(self) -> dict[str, Any] | None:
        if self.protected_index_path is None:
            return None
        relative = _safe_relative_path(self.protected_index_path, "protected index path")
        path, raw = self._regular_source(relative)
        index = _strict_json_bytes(raw, "protected ETF index")
        required = {
            "active_generation_manifest_sha256",
            "active_transaction_id",
            "index_sha256",
            "membership_sha256",
            "enrolled_count",
        }
        if required.difference(index):
            raise IntegrityError("protected ETF index is incomplete")
        for key in (
            "active_generation_manifest_sha256",
            "active_transaction_id",
            "index_sha256",
            "membership_sha256",
        ):
            if not isinstance(index[key], str) or len(index[key]) != 64:
                raise IntegrityError(f"protected ETF index {key} is malformed")
        if not isinstance(index["enrolled_count"], int) or isinstance(index["enrolled_count"], bool):
            raise IntegrityError("protected ETF enrolled_count is malformed")
        snapshot = {
            "index_path": path.relative_to(self.repo_root).as_posix(),
            "index_file_sha256": hashlib.sha256(raw).hexdigest(),
            "active_generation_manifest_sha256": index["active_generation_manifest_sha256"],
            "active_transaction_id": index["active_transaction_id"],
            "index_sha256": index["index_sha256"],
            "membership_sha256": index["membership_sha256"],
            "enrolled_count": index["enrolled_count"],
        }
        if self.enforce_protected_snapshot and snapshot != self.approved_protected_snapshot:
            raise IntegrityError("protected ETF snapshot differs from the cc-approved rebaseline")
        return snapshot

    def _validated_pair(
        self, ticker: str, *, observed_at: str
    ) -> tuple[ValidatedStockDetail, ValidatedStockDetail, dict[str, Any]]:
        sa_relative = f"data/stockanalysis/stocks/{ticker}.json"
        yf_relative = f"data/yf/finance/{ticker}.json"
        _, sa_bytes = self._regular_source(sa_relative)
        _, yf_bytes = self._regular_source(yf_relative)
        try:
            primary = validate_stock_detail_candidate(
                provider=_PRIMARY,
                entity=ticker,
                provider_path=sa_relative,
                payload_bytes=sa_bytes,
                observed_at=observed_at,
                provider_truth_root=self.repo_root,
            )
            fallback = validate_stock_detail_candidate(
                provider=_FALLBACK,
                entity=ticker,
                provider_path=yf_relative,
                payload_bytes=yf_bytes,
                observed_at=observed_at,
                provider_truth_root=self.repo_root,
            )
        except ValueError as exc:
            raise IntegrityError(f"stock-detail source validation failed: {ticker}") from exc
        pair = {
            "ticker": ticker,
            "stockanalysis_path": sa_relative,
            "stockanalysis_sha256": primary.payload_sha256,
            "yahoo_path": yf_relative,
            "yahoo_sha256": fallback.payload_sha256,
        }
        return primary, fallback, pair

    def _intended_selection(
        self,
        primary: ValidatedStockDetail,
        fallback: ValidatedStockDetail,
        *,
        decided_at: str,
    ) -> dict[str, Any]:
        decided = _parse_timestamp(decided_at, "decided_at")

        def age(candidate: ValidatedStockDetail) -> int:
            seconds = int((decided - _parse_timestamp(candidate.source_as_of, "source_as_of")).total_seconds())
            if seconds < 0:
                raise SchemaError("provider source time follows migration decision time")
            return seconds

        primary_age = age(primary)
        fallback_age = age(fallback)
        fresh_limit = _POLICY.fresh_ttl_hours * 3600
        lkg_limit = _POLICY.emergency_lkg_ttl_days * 86400
        if primary_age <= fresh_limit:
            selected, state = primary, "fresh_primary"
        elif fallback_age <= fresh_limit:
            selected, state = fallback, "fresh_fallback"
        elif primary_age <= lkg_limit:
            selected, state = primary, "lkg_primary"
        elif fallback_age <= lkg_limit:
            selected, state = fallback, "lkg_fallback"
        else:
            return {
                "provider": None,
                "resolution_state": "unavailable",
                "payload_sha256": None,
                "source_as_of": None,
            }
        return {
            "provider": selected.provider,
            "resolution_state": state,
            "payload_sha256": selected.payload_sha256,
            "source_as_of": selected.source_as_of,
        }

    def _entry(
        self,
        primary: ValidatedStockDetail,
        fallback: ValidatedStockDetail,
        pair: Mapping[str, Any],
        *,
        created_at: str,
    ) -> dict[str, Any]:
        intended = self._intended_selection(primary, fallback, decided_at=created_at)
        return {
            **dict(pair),
            "stockanalysis_validation": {
                "provider": primary.provider,
                "endpoint_family": primary.endpoint_family,
                "provider_schema": primary.provider_schema,
                "source_as_of": primary.source_as_of,
                "validation_status": "valid",
            },
            "yahoo_validation": {
                "provider": fallback.provider,
                "endpoint_family": fallback.endpoint_family,
                "provider_schema": fallback.provider_schema,
                "source_as_of": fallback.source_as_of,
                "validation_status": "valid",
            },
            "intended_selection": intended,
        }

    @staticmethod
    def _object_ref(candidate: ValidatedStockDetail) -> dict[str, str]:
        return {
            "path": (
                Path("providers")
                / candidate.provider
                / DOMAIN
                / "objects"
                / candidate.entity
                / f"{candidate.payload_sha256}.json"
            ).as_posix(),
            "sha256": candidate.payload_sha256,
        }

    def _assert_approved_defaults(
        self,
        *,
        expected_count: int,
        ticker_sha256: str,
        pair_sha256: str,
        delete_sha256: str,
    ) -> None:
        if not self.enforce_approved_digests or self.tickers != tuple(sorted(FROZEN_STOCK_DETAIL_TICKERS)):
            return
        if (
            expected_count != 49
            or ticker_sha256 != FROZEN_TICKER_SHA256
            or pair_sha256 != APPROVED_PAIR_SHA256
            or delete_sha256 != APPROVED_DELETE_SHA256
        ):
            raise IntegrityError("approved frozen stock-detail digests do not match")

    def plan(
        self,
        *,
        expected_count: int,
        expected_ticker_sha256: str,
        expected_pair_sha256: str,
        expected_delete_sha256: str,
        created_at: str,
    ) -> dict[str, Any]:
        _parse_timestamp(created_at, "created_at")
        if expected_count != len(self.tickers):
            raise IntegrityError(
                f"ticker count mismatch: expected={expected_count} actual={len(self.tickers)}"
            )
        ticker_sha = canonical_sha256(list(self.tickers))
        if ticker_sha != expected_ticker_sha256:
            raise IntegrityError("ticker digest mismatch")
        sa_names, yf_names = self._source_names()
        intersection = sa_names & yf_names
        if intersection != set(self.tickers):
            raise IntegrityError(
                f"dual-source intersection mismatch: expected={len(self.tickers)} actual={len(intersection)}"
            )
        entries = []
        pairs = []
        payload_refs = []
        for ticker in self.tickers:
            primary, fallback, pair = self._validated_pair(ticker, observed_at=created_at)
            pairs.append(pair)
            entries.append(self._entry(primary, fallback, pair, created_at=created_at))
            payload_refs.extend((self._object_ref(primary), self._object_ref(fallback)))
        pair_sha = canonical_sha256(pairs)
        if pair_sha != expected_pair_sha256:
            raise IntegrityError("pair digest mismatch")
        delete_candidates = self._delete_candidates()
        delete_sha = canonical_sha256(delete_candidates)
        if delete_sha != expected_delete_sha256 or delete_candidates:
            raise IntegrityError("non-empty or unapproved delete set blocks migration")
        self._assert_approved_defaults(
            expected_count=expected_count,
            ticker_sha256=ticker_sha,
            pair_sha256=pair_sha,
            delete_sha256=delete_sha,
        )
        excluded_yahoo_only_count = self._excluded_yahoo_only_count(sa_names, yf_names)
        if self.enforce_approved_digests and excluded_yahoo_only_count != APPROVED_YAHOO_ONLY_COUNT:
            raise IntegrityError("approved Yahoo-only legacy denominator changed")
        core = {
            "schema_version": MIGRATION_SCHEMA,
            "domain": DOMAIN,
            "created_at": created_at,
            "expected_count": expected_count,
            "ticker_sha256": ticker_sha,
            "pair_sha256": pair_sha,
            "delete_sha256": delete_sha,
            "delete_candidates": delete_candidates,
            "excluded_yahoo_only_count": excluded_yahoo_only_count,
            "protected_snapshot": self._protected_snapshot(),
            "payload_refs": payload_refs,
            "entries": entries,
        }
        return {**core, "migration_id": canonical_sha256(core)}

    def _validate_manifest_structure(self, manifest: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(manifest, Mapping):
            raise SchemaError("migration manifest must be an object")
        row = dict(manifest)
        if set(row) != _EXPECTED_MANIFEST_KEYS:
            raise SchemaError("migration manifest field set is invalid")
        if row["schema_version"] != MIGRATION_SCHEMA or row["domain"] != DOMAIN:
            raise SchemaError("migration manifest identity mismatch")
        if self.enforce_protected_snapshot and row["protected_snapshot"] != self.approved_protected_snapshot:
            raise IntegrityError("migration manifest protected snapshot mismatch")
        _parse_timestamp(row["created_at"], "created_at")
        if not isinstance(row["entries"], list) or not isinstance(row["payload_refs"], list):
            raise SchemaError("migration manifest arrays are malformed")
        if row["expected_count"] != len(row["entries"]) or row["expected_count"] != len(self.tickers):
            raise IntegrityError("migration manifest count mismatch")
        if row["delete_candidates"] != [] or row["delete_sha256"] != APPROVED_DELETE_SHA256:
            raise IntegrityError("migration manifest delete gate mismatch")
        if [entry.get("ticker") for entry in row["entries"] if isinstance(entry, Mapping)] != list(self.tickers):
            raise IntegrityError("migration manifest ticker order mismatch")
        pairs = []
        refs = []
        for entry in row["entries"]:
            if not isinstance(entry, Mapping):
                raise SchemaError("migration entry must be an object")
            pair = {
                "ticker": entry.get("ticker"),
                "stockanalysis_path": entry.get("stockanalysis_path"),
                "stockanalysis_sha256": entry.get("stockanalysis_sha256"),
                "yahoo_path": entry.get("yahoo_path"),
                "yahoo_sha256": entry.get("yahoo_sha256"),
            }
            ticker = pair["ticker"]
            if (
                pair["stockanalysis_path"] != f"data/stockanalysis/stocks/{ticker}.json"
                or pair["yahoo_path"] != f"data/yf/finance/{ticker}.json"
                or "stockanalysis/financials" in str(pair["stockanalysis_path"])
            ):
                raise IntegrityError("migration entry provider path mismatch")
            for key in ("stockanalysis_sha256", "yahoo_sha256"):
                value = pair[key]
                if not isinstance(value, str) or len(value) != 64:
                    raise SchemaError("migration entry digest is malformed")
            for validation_key, provider in (
                ("stockanalysis_validation", _PRIMARY),
                ("yahoo_validation", _FALLBACK),
            ):
                validation = entry.get(validation_key)
                if not isinstance(validation, Mapping) or validation.get("provider") != provider or validation.get("validation_status") != "valid":
                    raise IntegrityError("migration entry validation proof mismatch")
            intended = entry.get("intended_selection")
            if not isinstance(intended, Mapping) or intended.get("resolution_state") not in {
                "fresh_primary",
                "fresh_fallback",
                "lkg_primary",
                "lkg_fallback",
                "unavailable",
            }:
                raise IntegrityError("migration intended selection is invalid")
            pairs.append(pair)
            refs.extend(
                (
                    {
                        "path": f"providers/{_PRIMARY}/{DOMAIN}/objects/{ticker}/{pair['stockanalysis_sha256']}.json",
                        "sha256": pair["stockanalysis_sha256"],
                    },
                    {
                        "path": f"providers/{_FALLBACK}/{DOMAIN}/objects/{ticker}/{pair['yahoo_sha256']}.json",
                        "sha256": pair["yahoo_sha256"],
                    },
                )
            )
        if row["ticker_sha256"] != canonical_sha256(list(self.tickers)):
            raise IntegrityError("migration manifest ticker digest mismatch")
        if row["pair_sha256"] != canonical_sha256(pairs):
            raise IntegrityError("migration manifest pair digest mismatch")
        if row["payload_refs"] != refs or len(refs) != row["expected_count"] * 2:
            raise IntegrityError("migration manifest payload refs mismatch")
        core = {key: row[key] for key in row if key != "migration_id"}
        if row["migration_id"] != canonical_sha256(core):
            raise IntegrityError("migration manifest ID mismatch")
        self._assert_approved_defaults(
            expected_count=row["expected_count"],
            ticker_sha256=row["ticker_sha256"],
            pair_sha256=row["pair_sha256"],
            delete_sha256=row["delete_sha256"],
        )
        if self.enforce_approved_digests and row["excluded_yahoo_only_count"] != APPROVED_YAHOO_ONLY_COUNT:
            raise IntegrityError("migration manifest Yahoo-only denominator mismatch")
        return row

    def verify_plan(
        self,
        manifest: Mapping[str, Any],
        *,
        expected_count: int,
        require_delete_count: int,
    ) -> dict[str, Any]:
        row = self._validate_manifest_structure(manifest)
        if expected_count != row["expected_count"]:
            raise IntegrityError("verify-plan expected count mismatch")
        if require_delete_count != len(row["delete_candidates"]):
            raise IntegrityError("verify-plan delete count mismatch")
        rebuilt = self.plan(
            expected_count=row["expected_count"],
            expected_ticker_sha256=row["ticker_sha256"],
            expected_pair_sha256=row["pair_sha256"],
            expected_delete_sha256=row["delete_sha256"],
            created_at=row["created_at"],
        )
        if canonical_json_bytes(row) != canonical_json_bytes(rebuilt):
            raise IntegrityError("migration manifest differs from current validated sources")
        return row

    def load_manifest(self, path: Path | str) -> tuple[dict[str, Any], bytes]:
        path = Path(path)
        if not path.is_file() or path.is_symlink():
            raise IntegrityError("migration manifest path is missing or unsafe")
        raw = path.read_bytes()
        manifest = _strict_json_bytes(raw, "migration manifest")
        if raw != canonical_json_bytes(manifest):
            raise IntegrityError("migration manifest bytes are not canonical")
        return self._validate_manifest_structure(manifest), raw

    def write_manifest(self, manifest: Mapping[str, Any], output: Path | str) -> dict[str, Any]:
        row = self._validate_manifest_structure(manifest)
        payload = canonical_json_bytes(row)
        output_path = Path(output).expanduser()
        if not output_path.is_absolute():
            output_path = self.repo_root / output_path
        output_path = output_path.resolve(strict=False)
        try:
            output_path.relative_to(self.repo_root)
        except ValueError:
            pass
        else:
            raise IntegrityError("plan output must not write inside the repository")
        if not _inside_any(output_path, _temporary_roots()):
            raise IntegrityError("plan output must stay in runner temp")
        _atomic_write_exact(output_path, payload)
        return {
            "migration_id": row["migration_id"],
            "manifest_sha256": hashlib.sha256(payload).hexdigest(),
            "output": output_path.as_posix(),
        }

    def _write_state_pin(self, manifest: Mapping[str, Any]) -> None:
        path = self.state_root / "domains" / DOMAIN / "migration.json"
        _atomic_write_exact(path, canonical_json_bytes(dict(manifest)))

    def _validate_state_write_root(self) -> None:
        expected = self.repo_root / "data/admin/data-supply-state/v1"
        if self.state_root == expected.resolve(strict=False):
            _reject_symlink_components(self.repo_root, expected, "repository state root")
            return
        if _inside_any(self.state_root, _temporary_roots()):
            return
        raise IntegrityError("state writes are allowed only in the repository state root or runner temp")

    def _validate_state_internal_paths(
        self,
        manifest: Mapping[str, Any] | None = None,
        *,
        decided_at: str | None = None,
    ) -> None:
        paths = [
            self.state_root / "domains" / DOMAIN / "migration.json",
            self.state_root / "domains" / DOMAIN / "active.json",
            self.state_root / "domains" / DOMAIN / "generations",
            self.state_root / "history" / "observations",
            self.state_root / "history" / "resolutions",
            self.state_root / "providers" / _PRIMARY / DOMAIN / "objects",
            self.state_root / "providers" / _PRIMARY / DOMAIN / "pending",
            self.state_root / "providers" / _PRIMARY / DOMAIN / "lkg",
            self.state_root / "providers" / _FALLBACK / DOMAIN / "objects",
            self.state_root / "providers" / _FALLBACK / DOMAIN / "pending",
            self.state_root / "providers" / _FALLBACK / DOMAIN / "lkg",
        ]
        if decided_at is not None:
            day = _parse_timestamp(decided_at, "state destination time").date().isoformat()
            for category in ("observations", "resolutions"):
                paths.extend(
                    (
                        self.state_root / "history" / category / f"{day}.jsonl",
                        self.state_root / "history" / category / f".{day}.lock",
                    )
                )
        entries = manifest.get("entries", []) if isinstance(manifest, Mapping) else []
        entry_by_ticker = {
            entry.get("ticker"): entry
            for entry in entries
            if isinstance(entry, Mapping)
        }
        for ticker in self.tickers:
            entry = entry_by_ticker.get(ticker)
            for provider, digest_key in (
                (_PRIMARY, "stockanalysis_sha256"),
                (_FALLBACK, "yahoo_sha256"),
            ):
                object_root = self.state_root / "providers" / provider / DOMAIN / "objects" / ticker
                lkg_root = self.state_root / "providers" / provider / DOMAIN / "lkg" / ticker
                paths.extend(
                    (
                        object_root,
                        self.state_root / "providers" / provider / DOMAIN / "pending" / f"{ticker}.json",
                        self.state_root / "providers" / provider / DOMAIN / ".locks" / f"{ticker}.lock",
                        lkg_root,
                        lkg_root / "latest.json",
                        lkg_root / ".lock",
                        lkg_root / "objects",
                    )
                )
                if entry is not None and isinstance(entry.get(digest_key), str):
                    digest = entry[digest_key]
                    paths.extend(
                        (
                            object_root / f"{digest}.json",
                            lkg_root / "objects" / f"{digest}.json",
                        )
                    )
        for path in paths:
            _reject_symlink_components(self.state_root, path, "stock-detail state destination")

    def _candidate_from_entry(
        self, entry: Mapping[str, Any], *, observed_at: str
    ) -> tuple[ValidatedStockDetail, ValidatedStockDetail]:
        primary, fallback, pair = self._validated_pair(entry["ticker"], observed_at=observed_at)
        for key, value in pair.items():
            if entry.get(key) != value:
                raise IntegrityError(f"migration source changed before apply: {entry['ticker']}")
        return primary, fallback

    @staticmethod
    def _observation_for_candidate(
        candidate: ValidatedStockDetail,
        *,
        observed_at: str,
    ) -> dict[str, Any]:
        row = {
            "schema_version": "data-supply-observation/v1",
            "provider": candidate.provider,
            "endpoint_family": candidate.endpoint_family,
            "domain": DOMAIN,
            "entity": candidate.entity,
            "provider_path": candidate.provider_path,
            "payload_sha256": candidate.payload_sha256,
            "provider_schema": candidate.provider_schema,
            "source_as_of": candidate.source_as_of,
            "observed_at": observed_at,
            "validation_status": "valid",
            "reason_code": "contract_valid",
            "observation_origin": "migration",
        }
        row["event_id"] = deterministic_event_id("observation", row)
        return row

    def _expected_selection(
        self,
        entry: Mapping[str, Any],
        observation: Mapping[str, Any],
        *,
        decided_at: str,
    ) -> dict[str, Any]:
        intended = entry["intended_selection"]
        state = intended["resolution_state"]
        if state == "unavailable":
            raise SchemaError("unavailable state has no expected selection")
        primary_role = state.endswith("primary")
        if state.startswith("lkg_"):
            ref_kind = "provider_lkg"
            ref_path = (
                Path("providers")
                / observation["provider"]
                / DOMAIN
                / "lkg"
                / observation["entity"]
                / "objects"
                / f"{observation['payload_sha256']}.json"
            ).as_posix()
            fallback_depth = 1 if primary_role else 2
            reason_code = "migration_initial_lkg_primary" if primary_role else "migration_initial_lkg_fallback"
        else:
            ref_kind = "provider_object"
            ref_path = (
                Path("providers")
                / observation["provider"]
                / DOMAIN
                / "objects"
                / observation["entity"]
                / f"{observation['payload_sha256']}.json"
            ).as_posix()
            fallback_depth = 0 if primary_role else 1
            reason_code = "migration_primary_fresh" if primary_role else "migration_fallback_fresh"
        return build_selection(
            observation,
            selected_at=decided_at,
            resolution_state=state,
            reason_code=reason_code,
            fallback_depth=fallback_depth,
            payload_ref_kind=ref_kind,
            payload_ref_path=ref_path,
        )

    def _selected_matches(
        self,
        store: DataSupplyStateStore,
        active: Mapping[str, Any],
        entry: Mapping[str, Any],
        observations: tuple[Mapping[str, Any], Mapping[str, Any]],
        *,
        decided_at: str,
    ) -> bool:
        ticker = entry["ticker"]
        intended = entry["intended_selection"]
        if intended["resolution_state"] == "unavailable":
            unavailable = ticker not in active["current"] and active["recovery"].get(ticker) == {
                "consecutive_green": 0,
                "last_transition": "unavailable",
            }
            if not unavailable:
                return False
            for observation in observations:
                pending = (
                    self.state_root
                    / "providers"
                    / observation["provider"]
                    / DOMAIN
                    / "pending"
                    / f"{ticker}.json"
                )
                if pending.exists() or pending.is_symlink():
                    return False
            return True
        selected = active["current"].get(ticker)
        if not isinstance(selected, Mapping):
            return False
        observation = next(
            (row for row in observations if row.get("provider") == intended["provider"]),
            None,
        )
        if observation is None:
            return False
        expected = self._expected_selection(entry, observation, decided_at=decided_at)
        if dict(selected) != expected:
            return False
        store.read_resolved_payload(DOMAIN, ticker)
        return True

    def _store_lkg(
        self,
        store: DataSupplyStateStore,
        candidate: ValidatedStockDetail,
    ) -> dict[str, str]:
        latest_path = (
            self.state_root
            / "providers"
            / candidate.provider
            / DOMAIN
            / "lkg"
            / candidate.entity
            / "latest.json"
        )
        expected_latest = None
        if latest_path.exists():
            latest = _strict_json_bytes(latest_path.read_bytes(), "provider LKG latest")
            expected_latest = latest.get("sha256")
        return store.store_provider_lkg(
            provider=candidate.provider,
            domain=DOMAIN,
            entity=candidate.entity,
            payload=candidate.payload_bytes,
            meaningful_transition=True,
            expected_latest_sha256=expected_latest,
        )

    def _promote(
        self,
        *,
        store: DataSupplyStateStore,
        entry: Mapping[str, Any],
        observations: tuple[Mapping[str, Any], Mapping[str, Any]],
        candidates: tuple[ValidatedStockDetail, ValidatedStockDetail],
        decided_at: str,
    ) -> None:
        ticker = entry["ticker"]
        intended = entry["intended_selection"]
        active = store.read_active_domain(DOMAIN)
        if intended["resolution_state"] == "unavailable":
            transaction_id = store.prepare_unavailable_transition(
                domain=DOMAIN,
                entity=ticker,
                evidence_observations=list(observations),
                expected_active_transaction_id=active["transaction_id"],
                reason_code="migration_all_authorities_expired",
                decided_at=decided_at,
            )
            self._failpoint(f"after_prepare:{ticker}")
            store.commit_prepared(DOMAIN, transaction_id)
            return

        by_provider = {
            candidate.provider: (candidate, observation)
            for candidate, observation in zip(candidates, observations)
        }
        candidate, observation = by_provider[intended["provider"]]
        state = intended["resolution_state"]
        primary_role = state.endswith("primary")
        if state.startswith("lkg_"):
            ref = self._store_lkg(store, candidate)
            ref_kind = "provider_lkg"
            fallback_depth = 1 if primary_role else 2
            reason_code = "migration_initial_lkg_primary" if primary_role else "migration_initial_lkg_fallback"
        else:
            ref = self._object_ref(candidate)
            ref_kind = "provider_object"
            fallback_depth = 0 if primary_role else 1
            reason_code = "migration_primary_fresh" if primary_role else "migration_fallback_fresh"
        selected = build_selection(
            observation,
            selected_at=decided_at,
            resolution_state=state,
            reason_code=reason_code,
            fallback_depth=fallback_depth,
            payload_ref_kind=ref_kind,
            payload_ref_path=ref["path"],
        )
        prior = active["current"].get(ticker)
        next_current = dict(active["current"])
        next_current[ticker] = selected
        next_lkg = dict(active["lkg"])
        if prior is None:
            transition = "initial_lkg" if state.startswith("lkg_") else (
                "initial_primary" if primary_role else "initial_fallback"
            )
        elif prior["provider"] == selected["provider"] and state.startswith("fresh_"):
            transition = "primary_refresh" if primary_role else "fallback_refresh"
        else:
            preserved = store.preserve_current_as_provider_lkg(
                DOMAIN,
                ticker,
                expected_active_transaction_id=active["transaction_id"],
            )
            next_lkg[ticker] = preserved
            transition = "migration_provider_transition"
        next_recovery = dict(active["recovery"])
        next_recovery[ticker] = {"consecutive_green": 0, "last_transition": transition}
        evidence = [row for row in observations if row["event_id"] != observation["event_id"]]
        transaction_id = store.prepare_transition(
            domain=DOMAIN,
            entity=ticker,
            current=next_current,
            lkg=next_lkg,
            recovery=next_recovery,
            candidate_observations=[observation],
            evidence_observations=evidence,
            expected_active_transaction_id=active["transaction_id"],
            transition=transition,
            reason_code=reason_code,
            recovery_green_count=0,
            decided_at=decided_at,
        )
        self._failpoint(f"after_prepare:{ticker}")
        store.commit_prepared(DOMAIN, transaction_id)

    def apply(
        self,
        manifest: Mapping[str, Any],
        *,
        decided_at: str,
        no_delete: bool,
    ) -> dict[str, Any]:
        row = self.verify_plan(
            manifest,
            expected_count=len(self.tickers),
            require_delete_count=0,
        )
        _parse_timestamp(decided_at, "decided_at")
        if decided_at != row["created_at"]:
            raise IntegrityError("apply decision time must equal the gated manifest time")
        if no_delete is not True:
            raise IntegrityError("stock-detail migration requires --no-delete")

        preflight = {
            entry["ticker"]: self._candidate_from_entry(entry, observed_at=decided_at)
            for entry in row["entries"]
        }
        self._validate_state_write_root()
        self._validate_state_internal_paths(row, decided_at=decided_at)
        self._write_state_pin(row)
        first_primary = preflight[row["entries"][0]["ticker"]][0]
        cleanup_store = DataSupplyStateStore(
            self.state_root,
            provider_truth_root=self.repo_root,
            failpoint_hook=self._failpoint_hook,
            defer_maintenance=False,
        )
        record_stock_detail_success(
            store=cleanup_store,
            candidate=first_primary,
            observed_at=decided_at,
            origin="migration",
        )
        store = DataSupplyStateStore(
            self.state_root,
            provider_truth_root=self.repo_root,
            failpoint_hook=self._failpoint_hook,
            defer_maintenance=True,
        )
        store.recover_domain(DOMAIN)
        resumed = 0
        for entry in row["entries"]:
            ticker = entry["ticker"]
            primary, fallback = preflight[ticker]
            primary_observation = record_stock_detail_success(
                store=store,
                candidate=primary,
                observed_at=decided_at,
                origin="migration",
            )
            self._failpoint(f"after_observation:{_PRIMARY}")
            fallback_observation = record_stock_detail_success(
                store=store,
                candidate=fallback,
                observed_at=decided_at,
                origin="migration",
            )
            self._failpoint(f"after_observation:{_FALLBACK}")
            self._failpoint(f"after_all_observations:{ticker}")
            store.reconcile_committed_pending(DOMAIN)
            active = store.read_active_domain(DOMAIN)
            observations = (primary_observation, fallback_observation)
            if self._selected_matches(
                store,
                active,
                entry,
                observations,
                decided_at=decided_at,
            ):
                resumed += 1
                store.reconcile_committed_pending(DOMAIN)
                continue
            self._promote(
                store=store,
                entry=entry,
                observations=observations,
                candidates=(primary, fallback),
                decided_at=decided_at,
            )
            active = store.read_active_domain(DOMAIN)
            if not self._selected_matches(
                store,
                active,
                entry,
                observations,
                decided_at=decided_at,
            ):
                raise IntegrityError(f"entity promotion verification failed: {ticker}")
            self._failpoint(f"after_entity_commit:{ticker}")

        reconciled = store.reconcile_committed_pending(DOMAIN)
        maintenance = store.prune_domain(DOMAIN)
        if maintenance["skipped"] is not None:
            raise IntegrityError("migration maintenance failed closed")
        verified = self.verify_state(row, expected_count=len(self.tickers))
        return {
            "migration_id": row["migration_id"],
            "manifest_sha256": hashlib.sha256(canonical_json_bytes(row)).hexdigest(),
            "migrated": len(row["entries"]),
            "verified": verified["verified"],
            "resumed": resumed,
            "states": verified["states"],
            "deleted_provider_truth": 0,
            "reconciled_pending": reconciled,
            "maintenance": maintenance,
        }

    def _history_records(self, category: str, timestamp: str) -> dict[str, dict[str, Any]]:
        if category not in {"observations", "resolutions"}:
            raise ValueError("unsupported history category")
        day = _parse_timestamp(timestamp, f"{category} timestamp").date().isoformat()
        directory = self.state_root / "history" / category
        path = directory / f"{day}.jsonl"
        _reject_symlink_components(self.state_root, path, f"{category} history")
        if directory.is_symlink() or path.is_symlink() or not path.is_file():
            raise IntegrityError(f"{category} history is missing or unsafe")
        raw = path.read_bytes()
        if not raw or not raw.endswith(b"\n"):
            raise IntegrityError(f"{category} history has an incomplete tail")
        records: dict[str, dict[str, Any]] = {}
        kind = "observation" if category == "observations" else "resolution"
        for index, line in enumerate(raw.splitlines(), start=1):
            record = _strict_json_bytes(line, f"{category} history line {index}")
            event_id = record.get("event_id")
            if not isinstance(event_id, str) or len(event_id) != 64:
                raise IntegrityError(f"{category} history event ID is malformed")
            if deterministic_event_id(kind, record) != event_id:
                raise IntegrityError(f"{category} history event digest mismatch")
            if category == "observations":
                try:
                    validate_observation(record)
                except SchemaError as exc:
                    raise IntegrityError("observation history schema mismatch") from exc
            else:
                required = {
                    "schema_version",
                    "event_id",
                    "domain",
                    "entity",
                    "decided_at",
                    "candidate_event_ids",
                    "evidence_event_ids",
                    "previous_selection_digest",
                    "new_selection_digest",
                    "transition",
                    "reason_code",
                    "recovery_green_count",
                    "transaction_id",
                }
                if required.difference(record) or record.get("schema_version") != "data-supply-resolution-event/v1":
                    raise IntegrityError("resolution history schema mismatch")
                _parse_timestamp(record["decided_at"], "resolution decided_at")
                for field in ("previous_selection_digest", "new_selection_digest", "transaction_id"):
                    value = record.get(field)
                    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
                        raise IntegrityError(f"resolution history {field} is malformed")
                for field in ("candidate_event_ids", "evidence_event_ids"):
                    values = record.get(field)
                    if (
                        not isinstance(values, list)
                        or values != sorted(set(values))
                        or any(not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value) for value in values)
                    ):
                        raise IntegrityError(f"resolution history {field} is malformed")
                count = record.get("recovery_green_count")
                if not isinstance(count, int) or isinstance(count, bool) or count < 0:
                    raise IntegrityError("resolution history recovery count is malformed")
            if event_id in records:
                raise IntegrityError(f"{category} history contains a duplicate event")
            records[event_id] = record
        return records

    def _verify_history(
        self,
        manifest: Mapping[str, Any],
        expected_observations: Mapping[str, tuple[Mapping[str, Any], Mapping[str, Any]]],
        active: Mapping[str, Any],
    ) -> None:
        created_at = manifest["created_at"]
        observations = self._history_records("observations", created_at)
        resolutions = self._history_records("resolutions", created_at)
        transition_by_state = {
            "fresh_primary": {"initial_primary", "primary_refresh", "migration_provider_transition"},
            "fresh_fallback": {"initial_fallback", "fallback_refresh", "migration_provider_transition"},
            "lkg_primary": {"initial_lkg", "migration_provider_transition"},
            "lkg_fallback": {"initial_lkg", "migration_provider_transition"},
            "unavailable": {"unavailable"},
        }
        reason_by_state = {
            "fresh_primary": "migration_primary_fresh",
            "fresh_fallback": "migration_fallback_fresh",
            "lkg_primary": "migration_initial_lkg_primary",
            "lkg_fallback": "migration_initial_lkg_fallback",
            "unavailable": "migration_all_authorities_expired",
        }
        entry_by_ticker = {entry["ticker"]: entry for entry in manifest["entries"]}
        expected_ids_by_ticker = {}
        expected_candidate_ids = {}
        expected_evidence_ids = {}
        for entry in manifest["entries"]:
            ticker = entry["ticker"]
            expected_rows = expected_observations[ticker]
            expected_ids = {row["event_id"] for row in expected_rows}
            expected_ids_by_ticker[ticker] = expected_ids
            for expected in expected_rows:
                actual = observations.get(expected["event_id"])
                if actual is None or canonical_json_bytes(actual) != canonical_json_bytes(expected):
                    raise IntegrityError(f"migration observation history mismatch: {ticker}")
            intended = entry["intended_selection"]
            if intended["resolution_state"] == "unavailable":
                candidates = []
            else:
                candidates = sorted(
                    row["event_id"]
                    for row in expected_rows
                    if row["provider"] == intended["provider"]
                )
            expected_candidate_ids[ticker] = candidates
            expected_evidence_ids[ticker] = sorted(expected_ids - set(candidates))

        relevant_resolutions = [
            resolution
            for resolution in resolutions.values()
            if resolution.get("domain") == DOMAIN
            and resolution.get("decided_at") == created_at
        ]
        if (
            len(relevant_resolutions) != len(self.tickers)
            or [resolution.get("entity") for resolution in relevant_resolutions] != list(self.tickers)
        ):
            raise IntegrityError("migration resolution history count/order mismatch")
        previous_new_digest = None
        first_resolution = relevant_resolutions[0]
        empty_digest = canonical_sha256({})
        if first_resolution["transition"] in {
            "initial_primary",
            "initial_fallback",
            "initial_lkg",
            "unavailable",
        } and first_resolution["previous_selection_digest"] != empty_digest:
            raise IntegrityError("initial migration resolution does not start from empty current state")
        replay_current: dict[str, Any] | None = (
            {} if first_resolution["previous_selection_digest"] == empty_digest else None
        )
        transaction_ids = set()
        for resolution in relevant_resolutions:
            ticker = resolution["entity"]
            entry = entry_by_ticker.get(ticker)
            if entry is None:
                raise IntegrityError("migration resolution contains an out-of-cohort entity")
            state = entry["intended_selection"]["resolution_state"]
            if (
                resolution.get("transition") not in transition_by_state[state]
                or resolution.get("transition")
                != active["recovery"].get(ticker, {}).get("last_transition")
                or resolution.get("reason_code") != reason_by_state[state]
                or resolution.get("recovery_green_count") != 0
                or resolution.get("candidate_event_ids") != expected_candidate_ids[ticker]
                or resolution.get("evidence_event_ids") != expected_evidence_ids[ticker]
            ):
                raise IntegrityError(f"migration resolution content mismatch: {ticker}")
            transaction_id = resolution["transaction_id"]
            if transaction_id in transaction_ids:
                raise IntegrityError("migration resolutions reuse a transaction ID")
            transaction_ids.add(transaction_id)
            if previous_new_digest is not None and resolution["previous_selection_digest"] != previous_new_digest:
                raise IntegrityError("migration resolution digest chain is broken")
            if replay_current is not None:
                intended = entry["intended_selection"]
                if state == "unavailable":
                    replay_current.pop(ticker, None)
                else:
                    selected_observation = next(
                        row
                        for row in expected_observations[ticker]
                        if row["provider"] == intended["provider"]
                    )
                    replay_current[ticker] = self._expected_selection(
                        entry,
                        selected_observation,
                        decided_at=created_at,
                    )
                if resolution["new_selection_digest"] != canonical_sha256(replay_current):
                    raise IntegrityError(f"migration resolution selection digest mismatch: {ticker}")
            previous_new_digest = resolution["new_selection_digest"]
        if previous_new_digest != canonical_sha256(active["current"]):
            raise IntegrityError("migration resolution chain does not reach active current state")

        active_decision = active.get("active_decision")
        if not isinstance(active_decision, Mapping):
            raise IntegrityError("active state has no committed decision")
        active_resolutions = self._history_records(
            "resolutions",
            active_decision.get("decided_at"),
        )
        committed = active_resolutions.get(active_decision.get("event_id"))
        if committed is None or canonical_json_bytes(committed) != canonical_json_bytes(active_decision):
            raise IntegrityError("active decision is absent from resolution history")
        if canonical_json_bytes(relevant_resolutions[-1]) != canonical_json_bytes(active_decision):
            raise IntegrityError("final migration resolution is not the active committed decision")

    def _verify_lkg_latest(self, active: Mapping[str, Any]) -> None:
        selected_lkg = {
            ticker: selected
            for ticker, selected in active["current"].items()
            if selected["resolution_state"] in {"lkg_primary", "lkg_fallback"}
        }
        seen: set[str] = set()
        for provider in (_PRIMARY, _FALLBACK):
            root = self.state_root / "providers" / provider / DOMAIN / "lkg"
            if not root.exists():
                continue
            if root.is_symlink() or not root.is_dir():
                raise IntegrityError("provider LKG root is unsafe")
            _reject_symlink_components(self.state_root, root, "provider LKG root")
            for entity_dir in root.iterdir():
                if entity_dir.is_symlink() or not entity_dir.is_dir():
                    raise IntegrityError("provider LKG root contains an unsafe entry")
                entity = entity_dir.name
                if entity not in self.tickers:
                    raise IntegrityError("provider LKG contains an out-of-cohort entity")
                latest_path = entity_dir / "latest.json"
                _reject_symlink_components(self.state_root, latest_path, "provider LKG latest")
                if latest_path.is_symlink() or not latest_path.is_file():
                    raise IntegrityError("provider LKG latest pointer is missing or unsafe")
                latest = _strict_json_bytes(latest_path.read_bytes(), "provider LKG latest")
                sha = latest.get("sha256")
                expected_path = f"providers/{provider}/{DOMAIN}/lkg/{entity}/objects/{sha}.json"
                if (
                    latest.get("schema_version") != "data-supply-provider-lkg-pointer/v1"
                    or latest.get("provider") != provider
                    or latest.get("domain") != DOMAIN
                    or latest.get("entity") != entity
                    or not isinstance(sha, str)
                    or len(sha) != 64
                    or latest.get("path") != expected_path
                ):
                    raise IntegrityError("provider LKG latest pointer contract mismatch")
                object_path = self.state_root / expected_path
                _reject_symlink_components(self.state_root, object_path, "provider LKG latest object")
                if object_path.is_symlink() or not object_path.is_file():
                    raise IntegrityError("provider LKG latest object is missing or unsafe")
                object_bytes = object_path.read_bytes()
                if hashlib.sha256(object_bytes).hexdigest() != sha:
                    raise IntegrityError("provider LKG latest object digest mismatch")
                _strict_json_bytes(object_bytes, "provider LKG latest object")
                selected = selected_lkg.get(entity)
                if selected is not None and selected["provider"] == provider:
                    if selected["payload_ref"] != {
                        "kind": "provider_lkg",
                        "path": expected_path,
                        "sha256": sha,
                    }:
                        raise IntegrityError("selected LKG differs from provider latest")
                    seen.add(entity)
        if seen != set(selected_lkg):
            raise IntegrityError("selected LKG has no matching provider latest pointer")

    def verify_state(
        self,
        manifest: Mapping[str, Any],
        *,
        expected_count: int,
    ) -> dict[str, Any]:
        self._validate_state_write_root()
        self._validate_state_internal_paths()
        row = self.verify_plan(
            manifest,
            expected_count=expected_count,
            require_delete_count=0,
        )
        self._validate_state_internal_paths(row, decided_at=row["created_at"])
        if not self.state_root.is_dir():
            raise IntegrityError("stock-detail state root is missing")
        pin_path = self.state_root / "domains" / DOMAIN / "migration.json"
        _reject_symlink_components(self.state_root, pin_path, "stock-detail migration pin")
        if not pin_path.is_file() or pin_path.is_symlink() or pin_path.read_bytes() != canonical_json_bytes(row):
            raise IntegrityError("stock-detail migration pin differs from manifest")
        store = DataSupplyStateStore(self.state_root, provider_truth_root=self.repo_root)
        active = store.read_active_domain(DOMAIN)
        enrolled = set(active["recovery"])
        if (
            enrolled != set(self.tickers)
            or set(active["current"]) - enrolled
            or set(active["lkg"]) - enrolled
        ):
            raise IntegrityError("stock-detail state enrollment differs from manifest")
        states = {
            "fresh_primary": 0,
            "fresh_fallback": 0,
            "lkg_primary": 0,
            "lkg_fallback": 0,
            "unavailable": 0,
        }
        expected_observations: dict[
            str, tuple[Mapping[str, Any], Mapping[str, Any]]
        ] = {}
        for entry in row["entries"]:
            ticker = entry["ticker"]
            intended = entry["intended_selection"]
            state = intended["resolution_state"]
            states[state] += 1
            primary, fallback = self._candidate_from_entry(
                entry,
                observed_at=row["created_at"],
            )
            observations = (
                self._observation_for_candidate(primary, observed_at=row["created_at"]),
                self._observation_for_candidate(fallback, observed_at=row["created_at"]),
            )
            expected_observations[ticker] = observations
            if not self._selected_matches(
                store,
                active,
                entry,
                observations,
                decided_at=row["created_at"],
            ):
                raise IntegrityError(f"stock-detail state differs from manifest: {ticker}")
            recovery = active["recovery"].get(ticker)
            if not isinstance(recovery, Mapping) or recovery.get("consecutive_green") != 0:
                raise IntegrityError(f"stock-detail recovery state is invalid: {ticker}")
            allowed_transitions = {
                "fresh_primary": {"initial_primary", "primary_refresh", "migration_provider_transition"},
                "fresh_fallback": {"initial_fallback", "fallback_refresh", "migration_provider_transition"},
                "lkg_primary": {"initial_lkg", "migration_provider_transition"},
                "lkg_fallback": {"initial_lkg", "migration_provider_transition"},
                "unavailable": {"unavailable"},
            }
            if recovery.get("last_transition") not in allowed_transitions[state]:
                raise IntegrityError(f"stock-detail recovery transition is invalid: {ticker}")
            for provider, sha in (
                (_PRIMARY, entry["stockanalysis_sha256"]),
                (_FALLBACK, entry["yahoo_sha256"]),
            ):
                object_path = self.state_root / f"providers/{provider}/{DOMAIN}/objects/{ticker}/{sha}.json"
                _reject_symlink_components(self.state_root, object_path, "provider object")
                if object_path.is_symlink() or not object_path.is_file():
                    raise IntegrityError(f"provider object is missing or unsafe: {ticker}/{provider}")
                if hashlib.sha256(object_path.read_bytes()).hexdigest() != sha:
                    raise IntegrityError(f"provider object digest mismatch: {ticker}/{provider}")
                pending = self.state_root / f"providers/{provider}/{DOMAIN}/pending/{ticker}.json"
                _reject_symlink_components(self.state_root, pending, "provider pending pointer")
                if pending.exists() or pending.is_symlink():
                    raise IntegrityError(f"consumed pending pointer remains: {ticker}/{provider}")
        self._verify_lkg_latest(active)
        self._verify_history(row, expected_observations, active)
        return {
            "migration_id": row["migration_id"],
            "verified": len(row["entries"]),
            "states": states,
            "active_transaction_id": active["transaction_id"],
            "active_manifest_sha256": active.get("manifest_sha256"),
        }

    def archive(self, manifest_path: Path | str, output: Path | str) -> dict[str, Any]:
        manifest, raw = self.load_manifest(manifest_path)
        self.verify_plan(
            manifest,
            expected_count=len(self.tickers),
            require_delete_count=0,
        )
        output_path = Path(output).expanduser()
        if not output_path.is_absolute():
            output_path = self.repo_root / output_path
        archive_root = (self.repo_root / "data/yf/migration-evidence").resolve(strict=False)
        resolved_output = output_path.resolve(strict=False)
        _reject_symlink_components(
            self.repo_root,
            self.repo_root / "data/yf/migration-evidence",
            "migration archive root",
        )
        try:
            resolved_output.relative_to(archive_root)
        except ValueError as exc:
            raise IntegrityError("archive output must stay under data/yf/migration-evidence") from exc
        if resolved_output.parent != archive_root or not re.fullmatch(
            r"stock-detail-[A-Za-z0-9][A-Za-z0-9._-]*\.json",
            output_path.name,
        ):
            raise IntegrityError("archive output filename must be stock-detail-{migration_id}.json")
        _atomic_write_exact(output_path, raw)
        archived = output_path.read_bytes()
        if archived != raw:
            raise IntegrityError("archived migration manifest is not byte-identical")
        self.verify_plan(
            manifest,
            expected_count=len(self.tickers),
            require_delete_count=0,
        )
        return {
            "migration_id": manifest["migration_id"],
            "archive_sha256": hashlib.sha256(archived).hexdigest(),
            "archive_path": resolved_output.relative_to(self.repo_root).as_posix(),
            "bytes": len(archived),
        }


def _migration(args: argparse.Namespace) -> StockDetailMigration:
    repo_root = Path(args.repo_root).expanduser().resolve()
    state_root = Path(getattr(args, "state_root", "data/admin/data-supply-state/v1"))
    if not state_root.is_absolute():
        state_root = repo_root / state_root
    return StockDetailMigration(repo_root, state_root)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo-root",
        default=str(Path(__file__).resolve().parents[1]),
        help="nested 100xFenok repository root",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    plan_parser = subparsers.add_parser("plan")
    plan_parser.add_argument("--expected-count", type=int, required=True)
    plan_parser.add_argument("--expected-ticker-sha256", required=True)
    plan_parser.add_argument("--expected-pair-sha256", required=True)
    plan_parser.add_argument("--expected-delete-sha256", required=True)
    plan_parser.add_argument("--created-at", required=True)
    plan_parser.add_argument("--output", required=True)

    verify_parser = subparsers.add_parser("verify-plan")
    verify_parser.add_argument("--manifest", required=True)
    verify_parser.add_argument("--expected-count", type=int, required=True)
    verify_parser.add_argument("--require-delete-count", type=int, required=True)

    apply_parser = subparsers.add_parser("apply")
    apply_parser.add_argument("--manifest", required=True)
    apply_parser.add_argument("--decided-at", required=True)
    apply_parser.add_argument("--state-root", default="data/admin/data-supply-state/v1")
    apply_parser.add_argument("--no-delete", action="store_true")

    state_parser = subparsers.add_parser("verify-state")
    state_parser.add_argument("--manifest", required=True)
    state_parser.add_argument("--state-root", default="data/admin/data-supply-state/v1")
    state_parser.add_argument("--expected-count", type=int, required=True)

    archive_parser = subparsers.add_parser("archive")
    archive_parser.add_argument("--manifest", required=True)
    archive_parser.add_argument("--output", required=True)

    args = parser.parse_args()
    migration = _migration(args)
    if args.command == "plan":
        manifest = migration.plan(
            expected_count=args.expected_count,
            expected_ticker_sha256=args.expected_ticker_sha256,
            expected_pair_sha256=args.expected_pair_sha256,
            expected_delete_sha256=args.expected_delete_sha256,
            created_at=args.created_at,
        )
        result = migration.write_manifest(manifest, args.output)
    elif args.command == "verify-plan":
        manifest, raw = migration.load_manifest(args.manifest)
        migration.verify_plan(
            manifest,
            expected_count=args.expected_count,
            require_delete_count=args.require_delete_count,
        )
        result = {
            "migration_id": manifest["migration_id"],
            "manifest_sha256": hashlib.sha256(raw).hexdigest(),
            "verified": len(manifest["entries"]),
            "delete_count": len(manifest["delete_candidates"]),
        }
    elif args.command == "apply":
        manifest, _ = migration.load_manifest(args.manifest)
        result = migration.apply(manifest, decided_at=args.decided_at, no_delete=args.no_delete)
    elif args.command == "verify-state":
        manifest, _ = migration.load_manifest(args.manifest)
        result = migration.verify_state(manifest, expected_count=args.expected_count)
    else:
        result = migration.archive(args.manifest, args.output)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
