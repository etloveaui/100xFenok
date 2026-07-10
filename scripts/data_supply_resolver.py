#!/usr/bin/env python3
"""Deterministic authority and recovery resolver for enrolled data domains."""

from __future__ import annotations

import datetime as dt
from pathlib import Path
from typing import Any, Mapping

from data_supply_policy import DomainPolicy, get_domain_policy
from data_supply_state import (
    DataSupplyStateStore,
    SchemaError,
    build_selection,
    restate_selection,
    validate_observation,
)


_ETF_DETAIL_POLICY = get_domain_policy("etf_detail")
PRIMARY_PROVIDER = _ETF_DETAIL_POLICY.primary.name
FALLBACK_PROVIDER = _ETF_DETAIL_POLICY.fallback.name
PRIMARY_RECOVERY_REQUIRED = _ETF_DETAIL_POLICY.recovery_green_required


def _timestamp(value: str) -> dt.datetime:
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        parsed = dt.datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise SchemaError("resolver timestamp is malformed") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise SchemaError("resolver timestamp must include a timezone")
    return parsed.astimezone(dt.timezone.utc)


def _fresh(row: Mapping[str, Any], decided: dt.datetime, policy: DomainPolicy) -> bool:
    if row["validation_status"] != "valid":
        return False
    age = int((decided - _timestamp(row["source_as_of"])).total_seconds())
    return 0 <= age <= policy.fresh_ttl_hours * 3600


def _provider_object_path(row: Mapping[str, Any]) -> str:
    return (
        Path("providers")
        / row["provider"]
        / row["domain"]
        / "objects"
        / row["entity"]
        / f"{row['payload_sha256']}.json"
    ).as_posix()


class DataSupplyResolver:
    def __init__(self, store: DataSupplyStateStore):
        self.store = store

    def _selection(
        self,
        row: Mapping[str, Any],
        *,
        decided_at: str,
        primary: bool,
    ) -> dict[str, Any]:
        return build_selection(
            row,
            selected_at=decided_at,
            resolution_state="fresh_primary" if primary else "fresh_fallback",
            reason_code="primary_valid" if primary else "primary_unavailable_fallback_valid",
            fallback_depth=0 if primary else 1,
            payload_ref_kind="provider_object",
            payload_ref_path=_provider_object_path(row),
        )

    def resolve(
        self,
        *,
        domain: str,
        entity: str,
        observations: list[Mapping[str, Any]],
        decided_at: str,
    ) -> dict[str, Any]:
        try:
            policy = get_domain_policy(domain)
        except KeyError as exc:
            raise SchemaError("resolver domain is not configured") from exc
        primary_provider = policy.primary.name
        fallback_provider = policy.fallback.name
        decided = _timestamp(decided_at)
        rows = [validate_observation(row) for row in observations]
        if not rows:
            raise SchemaError("resolver requires at least one observation")
        if any(row["domain"] != domain or row["entity"] != entity for row in rows):
            raise SchemaError("resolver observation identity mismatch")
        latest: dict[str, dict[str, Any]] = {}
        for row in rows:
            if row["provider"] not in policy.provider_names:
                raise SchemaError("resolver observation provider is outside authority set")
            provider_policy = policy.provider(row["provider"])
            if (
                row["endpoint_family"] != provider_policy.endpoint_family
                or row["provider_schema"] != provider_policy.schema
            ):
                raise SchemaError("resolver observation provider contract mismatch")
            previous = latest.get(row["provider"])
            if previous is None or _timestamp(row["observed_at"]) > _timestamp(previous["observed_at"]):
                latest[row["provider"]] = row

        primary = latest.get(primary_provider)
        fallback = latest.get(fallback_provider)
        primary_fresh = primary is not None and _fresh(primary, decided, policy)
        fallback_fresh = fallback is not None and _fresh(fallback, decided, policy)
        active = self.store.read_active_domain(domain)
        active_id = active["transaction_id"]
        prior = active["current"].get(entity)
        prior_recovery = active["recovery"].get(
            entity,
            {"consecutive_green": 0, "last_transition": "none"},
        )
        recovery_count = prior_recovery["consecutive_green"]
        last_primary_event_id = prior_recovery.get("last_primary_event_id")
        selected: dict[str, Any] | None = None
        transition: str
        reason_code: str
        next_recovery_count = 0
        next_primary_event_id = last_primary_event_id

        if prior is not None and not primary_fresh and not fallback_fresh:
            if set(latest) != set(policy.provider_names):
                raise SchemaError("LKG/unavailable resolution requires complete provider evidence")
            lkg_age = int((decided - _timestamp(prior["source_as_of"])).total_seconds())
            if lkg_age < 0:
                raise SchemaError("current source time follows resolver time")
            if lkg_age > policy.emergency_lkg_ttl_days * 86400:
                transaction_id = self.store.prepare_unavailable_transition(
                    domain=domain,
                    entity=entity,
                    evidence_observations=rows,
                    expected_active_transaction_id=active_id,
                    reason_code="all_authorities_exhausted",
                    decided_at=decided_at,
                )
                return self.store.commit_prepared(domain, transaction_id)
            preserved = self.store.preserve_current_as_provider_lkg(
                domain,
                entity,
                expected_active_transaction_id=active_id,
            )
            lkg_state = "lkg_primary" if prior["provider"] == primary_provider else "lkg_fallback"
            selected_lkg = restate_selection(
                preserved,
                selected_at=decided_at,
                resolution_state=lkg_state,
                reason_code="providers_unavailable_lkg_valid",
                fallback_depth=1 if lkg_state == "lkg_primary" else 2,
            )
            next_current = dict(active["current"])
            next_current[entity] = selected_lkg
            next_lkg = dict(active["lkg"])
            next_lkg[entity] = preserved
            next_recovery = dict(active["recovery"])
            next_recovery[entity] = {
                "consecutive_green": 0,
                "last_transition": "providers_to_lkg",
            }
            transaction_id = self.store.prepare_transition(
                domain=domain,
                entity=entity,
                current=next_current,
                lkg=next_lkg,
                recovery=next_recovery,
                candidate_observations=[],
                evidence_observations=rows,
                expected_active_transaction_id=active_id,
                transition="providers_to_lkg",
                reason_code="providers_unavailable_lkg_valid",
                recovery_green_count=0,
                decided_at=decided_at,
            )
            return self.store.commit_prepared(domain, transaction_id)

        if prior is None:
            if primary_fresh:
                selected = self._selection(primary, decided_at=decided_at, primary=True)
                transition = "initial_primary"
                reason_code = "primary_valid"
            elif fallback_fresh:
                selected = self._selection(fallback, decided_at=decided_at, primary=False)
                transition = "initial_fallback"
                reason_code = "primary_unavailable_fallback_valid"
            else:
                raise SchemaError("no fresh provider candidate exists for initial selection")
        elif prior["provider"] == fallback_provider:
            if primary_fresh:
                is_new_natural = (
                    primary.get("observation_origin") == "natural"
                    and primary["event_id"] != last_primary_event_id
                )
                next_recovery_count = recovery_count + 1 if is_new_natural else recovery_count
                next_primary_event_id = primary["event_id"] if is_new_natural else last_primary_event_id
                if next_recovery_count >= policy.recovery_green_required:
                    selected = self._selection(primary, decided_at=decided_at, primary=True)
                    transition = "fallback_to_primary"
                    reason_code = "primary_recovered_three_natural"
                else:
                    selected = prior
                    transition = "primary_recovery_observation" if is_new_natural else "primary_recovery_ignored"
                    reason_code = "primary_recovery_pending" if is_new_natural else "non_natural_recovery_ignored"
            elif fallback_fresh:
                selected = self._selection(fallback, decided_at=decided_at, primary=False)
                transition = "fallback_refresh" if selected != prior else "fallback_hold"
                reason_code = "primary_unavailable_fallback_valid"
                next_recovery_count = 0
                next_primary_event_id = None
            else:
                raise SchemaError("no fresh provider candidate exists; LKG/unavailable path required")
        else:
            if primary_fresh:
                selected = self._selection(primary, decided_at=decided_at, primary=True)
                transition = "primary_refresh" if selected != prior else "primary_hold"
                reason_code = "primary_valid"
            elif fallback_fresh:
                selected = self._selection(fallback, decided_at=decided_at, primary=False)
                transition = "primary_to_fallback"
                reason_code = "primary_unavailable_fallback_valid"
            else:
                raise SchemaError("no fresh provider candidate exists; LKG/unavailable path required")

        next_current = dict(active["current"])
        next_current[entity] = selected
        next_lkg = dict(active["lkg"])
        changed = prior != selected
        same_provider_refresh = (
            prior is not None
            and selected["provider"] == prior["provider"]
            and transition in {"primary_refresh", "fallback_refresh"}
        )
        if changed and prior is not None and not same_provider_refresh:
            next_lkg[entity] = self.store.preserve_current_as_provider_lkg(
                domain,
                entity,
                expected_active_transaction_id=active_id,
            )
        next_recovery = dict(active["recovery"])
        recovery_record = {
            "consecutive_green": next_recovery_count,
            "last_transition": transition,
        }
        if next_primary_event_id is not None:
            recovery_record["last_primary_event_id"] = next_primary_event_id
        next_recovery[entity] = recovery_record

        selected_event_id = selected.get("candidate_event_id") if changed else None
        candidates = [
            row
            for row in rows
            if row["validation_status"] == "valid"
            and (row["event_id"] == selected_event_id or prior == selected or row is primary)
        ]
        if changed and selected_event_id is not None and all(
            row["event_id"] != selected_event_id for row in candidates
        ):
            raise SchemaError("selected provider observation is absent from resolver inputs")
        candidate_ids = {row["event_id"] for row in candidates}
        evidence = [row for row in rows if row["event_id"] not in candidate_ids]
        transaction_id = self.store.prepare_transition(
            domain=domain,
            entity=entity,
            current=next_current,
            lkg=next_lkg,
            recovery=next_recovery,
            candidate_observations=candidates,
            evidence_observations=evidence,
            expected_active_transaction_id=active_id,
            transition=transition,
            reason_code=reason_code,
            recovery_green_count=next_recovery_count,
            decided_at=decided_at,
        )
        return self.store.commit_prepared(domain, transaction_id)

    def resolve_etf_detail(
        self,
        *,
        entity: str,
        observations: list[Mapping[str, Any]],
        decided_at: str,
    ) -> dict[str, Any]:
        return self.resolve(
            domain="etf_detail",
            entity=entity,
            observations=observations,
            decided_at=decided_at,
        )


__all__ = ["DataSupplyResolver", "FALLBACK_PROVIDER", "PRIMARY_PROVIDER"]
