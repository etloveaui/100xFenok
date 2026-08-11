#!/usr/bin/env python3
"""Resolve ETF-detail provider candidates already recorded by an acquire artifact."""

from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path, PurePosixPath
import re
from typing import Any, Iterable, Mapping

from data_supply_resolver import DataSupplyResolver
from data_supply_state import (
    ConcurrencyError,
    DataSupplyStateStore,
    IntegrityError,
    SchemaError,
    canonical_sha256,
    deterministic_event_id,
    validate_observation,
)


DOMAIN = "etf_detail"
DEFAULT_STATE_ROOT = Path("data/admin/data-supply-state/v1")
PENDING_ARTIFACT_PATH = re.compile(
    r"^data/admin/data-supply-state/v1/providers/[^/]+/etf_detail/pending/"
    r"(?P<entity>[A-Z0-9][A-Z0-9._-]*)\.json$"
)
LEGACY_YAHOO_ENDPOINT_FAMILY = "yahoo_etf_detail"
CANONICAL_YAHOO_ENDPOINT_FAMILY = "yahoo_finance_etf_detail"


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _timestamp_key(value: str) -> dt.datetime:
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    parsed = dt.datetime.fromisoformat(normalized)
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise SchemaError("ETF resolver observation timestamp lacks a timezone")
    return parsed.astimezone(dt.timezone.utc)


def artifact_entities(path: Path | str) -> list[str]:
    """Return only ETF entities whose pending pointers changed in this artifact."""

    manifest_path = Path(path)
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SchemaError("ETF resolver artifact manifest is unreadable") from exc
    paths = manifest.get("paths") if isinstance(manifest, Mapping) else None
    if not isinstance(paths, list) or not all(isinstance(item, str) for item in paths):
        raise SchemaError("ETF resolver artifact manifest paths are invalid")
    entities: set[str] = set()
    for raw in paths:
        normalized = PurePosixPath(raw)
        if normalized.is_absolute() or ".." in normalized.parts or normalized.as_posix() != raw:
            raise SchemaError("ETF resolver artifact path is unsafe")
        match = PENDING_ARTIFACT_PATH.fullmatch(raw)
        if match:
            entities.add(match.group("entity"))
    return sorted(entities)


def latest_recorded_observations(
    state_root: Path | str,
    entities: Iterable[str],
) -> dict[str, list[dict[str, Any]]]:
    """Load latest provider evidence from append-only observation history."""

    root = Path(state_root)
    wanted = set(entities)
    latest: dict[tuple[str, str], dict[str, Any]] = {}
    history_root = root / "history" / "observations"
    for history_path in sorted(history_root.glob("*.jsonl")):
        try:
            lines = history_path.read_bytes().splitlines()
        except OSError as exc:
            raise IntegrityError("ETF resolver observation history is unreadable") from exc
        for line_number, line in enumerate(lines, start=1):
            try:
                raw = json.loads(line.decode("utf-8"))
                row = validate_observation(raw, allow_legacy_failure_source_as_of=True)
            except (UnicodeDecodeError, json.JSONDecodeError, SchemaError) as exc:
                raise IntegrityError(
                    f"ETF resolver observation history is corrupt at {history_path.name}:{line_number}"
                ) from exc
            if row["domain"] != DOMAIN or row["entity"] not in wanted:
                continue
            key = (row["entity"], row["provider"])
            previous = latest.get(key)
            candidate_order = (
                _timestamp_key(row["observed_at"]),
                row["endpoint_family"] != LEGACY_YAHOO_ENDPOINT_FAMILY,
                row["event_id"],
            )
            previous_order = (
                (
                    _timestamp_key(previous["observed_at"]),
                    previous["endpoint_family"] != LEGACY_YAHOO_ENDPOINT_FAMILY,
                    previous["event_id"],
                )
                if previous is not None
                else None
            )
            if previous_order is None or candidate_order > previous_order:
                latest[key] = row
    return {
        entity: [latest[key] for key in sorted(latest) if key[0] == entity]
        for entity in sorted(wanted)
    }


def _canonicalize_legacy_yahoo_observation(
    store: DataSupplyStateStore,
    observation: Mapping[str, Any],
) -> dict[str, Any]:
    row = dict(observation)
    if not (
        row["provider"] == "yahoo_finance"
        and row["domain"] == DOMAIN
        and row["endpoint_family"] == LEGACY_YAHOO_ENDPOINT_FAMILY
    ):
        return row
    source_event_id = row["event_id"]
    row["endpoint_family"] = CANONICAL_YAHOO_ENDPOINT_FAMILY
    row["observation_origin"] = "migration"
    row["source_observation_event_id"] = source_event_id
    row["compatibility_migration"] = "yahoo_etf_detail_to_yahoo_finance_etf_detail"
    if row["validation_status"] == "invalid" and row.get("payload_available") is False:
        if row["source_as_of"] is not None:
            row["legacy_source_as_of"] = row["source_as_of"]
            row["source_as_of"] = None
        descriptor = {
            "provider": row["provider"],
            "endpoint_family": row["endpoint_family"],
            "domain": row["domain"],
            "entity": row["entity"],
            "observed_at": row["observed_at"],
            "reason_code": row["reason_code"],
            "failure_detail_sha256": row["failure_detail_sha256"],
        }
        row["payload_sha256"] = canonical_sha256(descriptor)
    row.pop("event_id", None)
    row["event_id"] = deterministic_event_id("observation", row)
    migrated = validate_observation(row)
    if migrated["validation_status"] == "valid":
        object_path = (
            store.root
            / "providers"
            / migrated["provider"]
            / migrated["domain"]
            / "objects"
            / migrated["entity"]
            / f"{migrated['payload_sha256']}.json"
        )
        try:
            payload = object_path.read_bytes()
        except OSError as exc:
            raise IntegrityError("legacy Yahoo observation provider object is missing") from exc
        store.store_provider_object(observation=migrated, payload=payload)
    store.record_observation(migrated)
    return migrated


def _canonical_latest_observations(
    store: DataSupplyStateStore,
    latest_rows: Mapping[str, list[dict[str, Any]]],
    entity: str,
) -> list[dict[str, Any]]:
    rows = latest_rows.get(entity, [])
    if not rows:
        raise SchemaError(f"ETF resolver has no recorded observations for {entity}")
    return [_canonicalize_legacy_yahoo_observation(store, row) for row in rows]


def resolve_with_single_retry(
    store: DataSupplyStateStore,
    *,
    entity: str,
    decided_at: str,
    latest_rows: dict[str, list[dict[str, Any]]],
    reconcile_pending_on_noop: bool = True,
) -> tuple[dict[str, Any], bool]:
    """Re-read and recompute exactly once after a compare-and-swap loss."""

    for attempt in range(2):
        if attempt > 0:
            latest_rows[entity] = latest_recorded_observations(
                store.root, [entity]
            ).get(entity, [])
        observations = _canonical_latest_observations(store, latest_rows, entity)
        resolver = DataSupplyResolver(
            store,
            reconcile_pending_on_noop=reconcile_pending_on_noop,
        )
        try:
            return resolver.resolve_etf_detail_with_outcome(
                entity=entity,
                observations=observations,
                decided_at=decided_at,
            )
        except ConcurrencyError:
            if attempt == 1:
                raise
    raise AssertionError("unreachable")


def resolve_entities(
    store: DataSupplyStateStore,
    *,
    entities: Iterable[str],
    decided_at: str,
    reconcile_pending_on_noop: bool = True,
) -> dict[str, Any]:
    requested = sorted(set(entities))
    if not requested:
        return {"domain": DOMAIN, "decided_at": decided_at, "results": []}
    latest_rows = latest_recorded_observations(store.root, requested)
    results: list[dict[str, Any]] = []
    for entity in requested:
        active, committed = resolve_with_single_retry(
            store,
            entity=entity,
            decided_at=decided_at,
            latest_rows=latest_rows,
            reconcile_pending_on_noop=reconcile_pending_on_noop,
        )
        selected = active["current"].get(entity)
        if selected is None:
            raise SchemaError(f"ETF resolver did not produce a current selection for {entity}")
        results.append(
            {
                "entity": entity,
                "provider": selected["provider"],
                "resolution_state": selected["resolution_state"],
                "source_as_of": selected["source_as_of"],
                "transaction_id": active["transaction_id"],
                "committed": committed,
            }
        )
    return {"domain": DOMAIN, "decided_at": decided_at, "results": results}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state-root", default=DEFAULT_STATE_ROOT.as_posix())
    parser.add_argument("--artifact-manifest", required=True)
    parser.add_argument("--decided-at", default=None)
    args = parser.parse_args()
    entities = artifact_entities(args.artifact_manifest)
    decided_at = args.decided_at or utc_now()
    if not entities:
        print(
            json.dumps(
                {"domain": DOMAIN, "decided_at": decided_at, "results": []},
                ensure_ascii=False,
                sort_keys=True,
            )
        )
        return
    store = DataSupplyStateStore(args.state_root, defer_maintenance=True)
    # Deferred-maintenance contract: reconcile before and after the entity loop,
    # then prune exactly once after a fully successful run.
    store.recover_domain(DOMAIN)
    store.reconcile_committed_pending(DOMAIN)
    result = resolve_entities(
        store,
        entities=entities,
        decided_at=decided_at,
        reconcile_pending_on_noop=False,
    )
    store.reconcile_committed_pending(DOMAIN)
    maintenance = store.prune_domain(DOMAIN)
    if maintenance["skipped"] is not None:
        raise IntegrityError("ETF resolver maintenance did not complete")
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
