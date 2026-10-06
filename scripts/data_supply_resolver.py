#!/usr/bin/env python3
"""Deterministic authority and recovery resolver for enrolled data domains."""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
from pathlib import Path
from typing import Any, Mapping

from data_supply_policy import DomainPolicy, get_domain_policy
from stockanalysis_recovery_state import (
    archived_etf_history,
    etf_detail_regression,
    _etf_component_clocks,
    _etf_history_date_set,
    _etf_provider_source,
    _valid_payload,
    validate_etf_history_archive,
)
from data_supply_state import (
    DataSupplyStateStore,
    SchemaError,
    build_selection,
    deterministic_event_id,
    is_same_provider_refresh,
    restate_selection,
    validate_observation,
    _validate_selection,
)


POLICY_CONSUMER_ID = "scripts.data_supply_resolver"
_ETF_DETAIL_POLICY = get_domain_policy("etf_detail", consumer_id=POLICY_CONSUMER_ID)
PRIMARY_PROVIDER = _ETF_DETAIL_POLICY.primary.name
FALLBACK_PROVIDER = _ETF_DETAIL_POLICY.fallback.name


class NoFreshInitialCandidateError(SchemaError):
    """No current selection exists and honest provider evidence has no fresh candidate."""


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




def _semantically_same_selection(
    left: Mapping[str, Any] | None,
    right: Mapping[str, Any] | None,
) -> bool:
    """Compare authority decisions without the wall-clock selection stamp."""

    if left is None or right is None:
        return left is right
    left_semantic = dict(left)
    right_semantic = dict(right)
    for volatile in ("selected_at", "age_seconds"):
        left_semantic.pop(volatile, None)
        right_semantic.pop(volatile, None)
    return left_semantic == right_semantic


class DataSupplyResolver:
    def __init__(
        self,
        store: DataSupplyStateStore,
        *,
        reconcile_pending_on_noop: bool = True,
    ):
        self.store = store
        self.reconcile_pending_on_noop = reconcile_pending_on_noop
        self._committed_transaction_id: str | None = None


    def _eligible_selected_etf_fallback(self, row: Mapping[str, Any], prior: Mapping[str, Any] | None, decided: dt.datetime) -> bool:
        """Require provider evidence and preserve the currently served detail."""
        try:
            source, observed = _timestamp(row["source_as_of"]), _timestamp(row["observed_at"])
            if prior and (source < _timestamp(prior["source_as_of"]) or (
                    source == _timestamp(prior["source_as_of"]) and observed < _timestamp(prior["observed_at"]))):
                return False
            raw = (self.store.root / _provider_object_path(row)).read_bytes()
            payload = json.loads(raw)
            data = payload["raw"]["yf"]
            info, funds = data.get("info") or {}, data.get("funds_data") or {}
            normalized = payload["normalized"]
            if (not isinstance(normalized, dict) or not isinstance(normalized.get("overview"), dict)
                    or not isinstance(normalized.get("holdings"), list)
                    or not any((normalized["overview"], normalized["holdings"], normalized.get("quote"),
                                normalized.get("history"), normalized.get("asset_allocation"), normalized.get("sectors")))):
                return False
            value = info.get("regularMarketTime")
            if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
                seconds = value / 1000 if abs(value) >= 100_000_000_000 else value
                provider_source = dt.datetime.fromtimestamp(seconds, dt.timezone.utc).replace(microsecond=0)
            else:
                days = _etf_history_date_set(data.get("history_1y")) if data.get("history_1y") else set()
                provider_source = _timestamp(max(days) + "T00:00:00Z") if days else None
            if not (
                hashlib.sha256(raw).hexdigest() == row["payload_sha256"]
                and payload["schema_version"] == "yf-etf-detail/v1" and payload["ticker"] == row["entity"]
                and payload["asset_type"] == "etf" and payload["source_provider"] == "yahoo_finance"
                and payload.get("source") == "yahoo_finance" and payload.get("detail_status") == "yf_fallback"
                and str(info.get("symbol") or funds.get("symbol") or "").strip().upper() == row["entity"]
                and str(info.get("quoteType") or funds.get("quote_type") or "").upper() in {"ETF", "MUTUALFUND"}
                and provider_source == source == _timestamp(payload["source_as_of"])
                and observed == _timestamp(payload["fetched_at"]) and source <= observed <= decided
            ):
                return False
            truth_root = self.store.provider_truth_root
            if truth_root is not None and (prior is not None or (truth_root / row["provider_path"]).exists()):
                if row["provider_path"] != f"data/yf/etf-details/{row['entity']}.json":
                    return False
                canonical = (truth_root / row["provider_path"]).read_bytes()
                provider = json.loads((truth_root / f"data/yf/finance/{row['entity']}.json").read_bytes())
                if not (raw == canonical and provider["data"] == data
                        and provider["schema_version"] == "yf-finance/v2" and provider["ticker"] == row["entity"]
                        and provider["source"] == "yahoo_finance" and provider["profile"] == "etf"
                        and source == _timestamp(provider["source_as_of"])
                        and observed == _timestamp(provider["fetched_at"])):
                    return False
            if prior is not None and not self._preserves_etf_detail(row, prior):
                return False
            # Before first enrollment, the canonical primary is already served
            # by the static/shard readers and therefore is a preservation floor.
            if prior is None and truth_root is not None:
                primary_path = truth_root / f"data/stockanalysis/etfs/{row['entity']}.json"
                if primary_path.exists():
                    primary = json.loads(primary_path.read_bytes())
                    if _valid_payload("etf", row["entity"], primary) and etf_detail_regression(payload, primary):
                        return False
            return True
        except (OSError, ValueError, KeyError, TypeError, AttributeError, OverflowError, SchemaError):
            return False

    def _preserves_etf_detail(self, row: Mapping[str, Any], prior: Mapping[str, Any] | None) -> bool:
        try:
            candidate = (self.store.root / _provider_object_path(row)).read_bytes()
            payload = json.loads(candidate)
            if hashlib.sha256(candidate).hexdigest() != row["payload_sha256"]:
                return False
            if row["provider"] == PRIMARY_PROVIDER and (
                    not _valid_payload("etf", row["entity"], payload)
                    or payload.get("source_provider") not in (None, PRIMARY_PROVIDER)
                    or payload.get("source_as_of") != row["source_as_of"]
                    or payload.get("fetched_at") != row["observed_at"]
                    or _etf_provider_source(payload) != _timestamp(row["source_as_of"])
                    or not validate_etf_history_archive(payload)):
                return False
            if prior is None:
                return True
            _validate_selection(prior)
            ref = prior["payload_ref"]
            if ref["kind"] not in {"provider_object", "provider_lkg"}:
                return False
            previous = self.store._inside_root(self.store.root / ref["path"]).read_bytes()
            return (
                hashlib.sha256(previous).hexdigest() == prior["payload_sha256"]
                and etf_detail_regression(payload, json.loads(previous)) is None
            )
        except (OSError, ValueError, KeyError, TypeError, AttributeError, SchemaError):
            return False

    def _reject_etf_candidate(self, row: Mapping[str, Any], decided_at: str) -> dict[str, Any]:
        rejected = {**row, "validation_status": "invalid", "reason_code": "etf_detail_contract_regression",
                    "observation_origin": "rebuild", "validation_scope": "serving_detail",
                    "validated_at": decided_at, "source_observation_event_id": row["event_id"]}
        rejected.pop("event_id")
        rejected["event_id"] = deterministic_event_id("observation", rejected)
        self.store.record_observation(rejected)
        return rejected

    def _complete_etf_primary(self, row: Mapping[str, Any], decided: dt.datetime, prior: Mapping[str, Any]) -> bool:
        """Apply the complete ETF payload and honest provider date contract."""
        try:
            raw = (self.store.root / _provider_object_path(row)).read_bytes()
            payload = json.loads(raw)
            if not _valid_payload("etf", row["entity"], payload):
                return False
            normalized = payload["normalized"]
            source, fetched = _timestamp(row["source_as_of"]), _timestamp(row["observed_at"])
            if (
                hashlib.sha256(raw).hexdigest() != row["payload_sha256"]
                or (payload.get("detail_status") == "stockanalysis_partial"
                    and payload.get("partial_reason_codes") != ["holdings_countries_unavailable"])
                or payload.get("source_provider") not in (None, "stockanalysis")
                or not isinstance(normalized.get("holdings"), list) or not normalized["holdings"]
                or payload.get("source_as_of") != row["source_as_of"]
                or payload.get("fetched_at") != row["observed_at"]
                or source != _etf_provider_source(payload) or not source <= fetched <= decided
                or not validate_etf_history_archive(payload)
            ):
                return False
            # An already selected immutable object is the preservation floor.
            # Its current canonical provider files may have advanced independently.
            _validate_selection(prior)
            prior_ref = prior["payload_ref"]
            if prior_ref["kind"] not in {"provider_object", "provider_lkg"}:
                return False
            yahoo_bytes = self.store._inside_root(self.store.root / prior_ref["path"]).read_bytes()
            if hashlib.sha256(yahoo_bytes).hexdigest() != prior["payload_sha256"]:
                return False
            yahoo = json.loads(yahoo_bytes)
            prior_source, prior_fetched = _timestamp(prior["source_as_of"]), _timestamp(prior["observed_at"])
            if not prior_source <= prior_fetched <= decided or yahoo.get("ticker") != row["entity"]:
                return False
            yahoo_data = (yahoo.get("raw") or {}).get("yf") or {}
            if yahoo.get("schema_version") is not None:
                info, funds = yahoo_data.get("info") or {}, yahoo_data.get("funds_data") or {}
                value = info.get("regularMarketTime")
                if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
                    seconds = value / 1000 if abs(value) >= 100_000_000_000 else value
                    proven_source = dt.datetime.fromtimestamp(seconds, dt.timezone.utc).replace(microsecond=0)
                else:
                    days = _etf_history_date_set(yahoo_data.get("history_1y"))
                    proven_source = _timestamp(max(days) + "T00:00:00Z") if days else None
                if (yahoo.get("schema_version") != "yf-etf-detail/v1"
                        or yahoo.get("source_provider") != "yahoo_finance"
                        or str(info.get("symbol") or funds.get("symbol") or "").strip().upper() != row["entity"]
                        or str(info.get("quoteType") or funds.get("quote_type") or "").upper() not in {"ETF", "MUTUALFUND"}
                        or _timestamp(yahoo["source_as_of"]) != prior_source
                        or proven_source != prior_source
                        or _timestamp(yahoo["fetched_at"]) != prior_fetched):
                    return False
            elif set(yahoo) - {"ticker", "suffix"}:
                # Legacy metadata-only objects cannot provide unverified price history.
                return False
            yahoo_history = yahoo_data.get("history_1y")
            yahoo_days = _etf_history_date_set(yahoo_history) if yahoo_history is not None else set()
            if yahoo_days is None:
                return False
            native_periods = payload.get("raw", {}).get("history_periods") or {}
            native_history = native_periods.get("daily_1y")
            native_days = _etf_history_date_set(native_history) if native_history is not None else set()
            if native_days is None:
                return False
            # Historical archives preserve old dates; they cannot excuse a
            # regression of the currently displayed native daily-history tail.
            if yahoo_days and (not native_days or max(native_days) < max(yahoo_days)):
                return False
            archive_days = archived_etf_history(payload)
            if archive_days is None or not yahoo_days <= native_days | archive_days:
                return False
            clocks = _etf_component_clocks(payload)
            if clocks is None or "quote" not in clocks or "history" not in clocks:
                if source < _timestamp(prior["source_as_of"]):
                    return False
            else:
                # Yahoo's quote can be newer than issuer holdings. Compare like
                # components while the aggregate remains the oldest raw clock.
                if (clocks["quote"] < _timestamp(prior["source_as_of"])
                        or clocks["history"].date() < _timestamp(prior["source_as_of"]).date()):
                    return False
            truth_root = self.store.provider_truth_root
            if truth_root is not None and row["provider_path"] == f"data/stockanalysis/etfs/{row['entity']}.json":
                if raw != (truth_root / row["provider_path"]).read_bytes():
                    return False
            return self._preserves_etf_detail(row, prior)
        except (OSError, ValueError, KeyError, TypeError, AttributeError, OverflowError, SchemaError):
            return False


    def _commit_prepared(self, domain: str, transaction_id: str) -> dict[str, Any]:
        active = self.store.commit_prepared(domain, transaction_id)
        self._committed_transaction_id = transaction_id
        return active

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
        self._committed_transaction_id = None
        try:
            policy = get_domain_policy(domain, consumer_id=POLICY_CONSUMER_ID)
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
        if domain == "etf_detail" and any(_timestamp(row["observed_at"]) > decided for row in rows):
            raise SchemaError("evidence observation cannot follow the decision time")
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
            {"last_transition": "none"},
        )
        if domain == "etf_detail":
            if primary_fresh:
                primary_fresh = self._preserves_etf_detail(primary,
                    prior if prior is not None and prior["provider"] == primary_provider else None)
                if not primary_fresh:
                    rejected = self._reject_etf_candidate(primary, decided_at)
                    rows = [rejected if row["event_id"] == primary["event_id"] else row for row in rows]
                    primary = latest[primary_provider] = rejected
            if fallback_fresh:
                if prior is not None and prior["provider"] == fallback_provider and not primary_fresh:
                    source, observed = _timestamp(fallback["source_as_of"]), _timestamp(fallback["observed_at"])
                    prior_source = _timestamp(prior["source_as_of"])
                    if source < prior_source or (source == prior_source and observed < _timestamp(prior["observed_at"])):
                        # Delayed evidence cannot age a newer fresh selection
                        # into LKG or clear that candidate's pending pointer.
                        if self.reconcile_pending_on_noop:
                            self.store.reconcile_committed_pending(domain)
                        return active
                fallback_fresh = self._eligible_selected_etf_fallback(fallback, prior, decided)
                if not fallback_fresh:
                    rejected = self._reject_etf_candidate(fallback, decided_at)
                    rows = [rejected if row["event_id"] == fallback["event_id"] else row for row in rows]
                    fallback = latest[fallback_provider] = rejected
        selected: dict[str, Any] | None = None
        transition: str
        reason_code: str
        primary_complete = (domain != "etf_detail" or not primary_fresh or prior is None
            or prior["provider"] != fallback_provider
            or self._complete_etf_primary(primary, decided, prior))

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
                return self._commit_prepared(domain, transaction_id)
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
                decided_at=decided_at,
            )
            return self._commit_prepared(domain, transaction_id)

        if (
            domain == "etf_detail"
            and prior is None
            and not primary_fresh
            and not fallback_fresh
            and prior_recovery.get("last_transition") == "unavailable"
        ):
            # Known-unavailable hold: the store already removed this entity's
            # current selection after complete negative evidence and an expired
            # emergency LKG (prepare_unavailable_transition). While every
            # provider stays stale that outcome is held unchanged and honestly,
            # with the same complete-evidence guard as the LKG/unavailable path.
            # Any fresh candidate below still takes the normal initial path, so
            # recovery precedence is untouched. Without this branch the cycle
            # after a committed removal raised an initial-selection fault and
            # killed the whole ETF publication (runs 33825689997, 33936218442).
            if set(latest) != set(policy.provider_names):
                raise SchemaError("LKG/unavailable resolution requires complete provider evidence")
            # Mirror the store's evidence time checks from
            # prepare_unavailable_transition: a hold must not accept evidence
            # the store itself would reject. _fresh treats a future source time
            # as merely not fresh, so it is re-checked here explicitly.
            for row in rows:
                if _timestamp(row["observed_at"]) > decided:
                    raise SchemaError("evidence observation cannot follow the decision time")
            for row in latest.values():
                if row["validation_status"] == "invalid":
                    continue
                if _timestamp(row["source_as_of"]) > decided:
                    raise SchemaError("provider evidence source time follows the decision")
            if self.reconcile_pending_on_noop:
                self.store.reconcile_committed_pending(domain)
            return active

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
                # Future evidence remains an aborting schema fault, rather than
                # being isolated as an ordinary stale/invalid initial refusal.
                for row in rows:
                    if _timestamp(row["observed_at"]) > decided:
                        raise SchemaError("evidence observation cannot follow the decision time")
                    if row["validation_status"] == "valid" and _timestamp(row["source_as_of"]) > decided:
                        raise SchemaError("provider evidence source time follows the decision")
                raise NoFreshInitialCandidateError("no fresh provider candidate exists for initial selection")
        elif primary_fresh and not primary_complete:
            # A dated partial primary cannot replace a retained complete selection.
            # It is still available evidence, so do not declare all providers absent.
            if fallback_fresh and self._eligible_selected_etf_fallback(fallback, prior, decided):
                selected = self._selection(fallback, decided_at=decided_at, primary=False)
                transition = "fallback_refresh"
                reason_code = "primary_unavailable_fallback_valid"
            else:
                selected = prior
                transition = "fallback_hold"
                reason_code = "primary_candidate_incomplete"
        elif primary_fresh:
            selected = self._selection(primary, decided_at=decided_at, primary=True)
            transition = "fallback_to_primary" if prior["provider"] == fallback_provider else "primary_refresh"
            reason_code = "primary_valid"
        elif fallback_fresh:
            selected = self._selection(fallback, decided_at=decided_at, primary=False)
            transition = "fallback_refresh" if prior["provider"] == fallback_provider else "primary_to_fallback"
            reason_code = "primary_unavailable_fallback_valid"
        else:
            raise SchemaError("no fresh provider candidate exists; LKG/unavailable path required")

        if (
            _semantically_same_selection(prior, selected)
        ):
            if self.reconcile_pending_on_noop:
                self.store.reconcile_committed_pending(domain)
            return active

        if (
            prior is not None
            and prior["provider"] == selected["provider"]
            and not _semantically_same_selection(prior, selected)
        ):
            prior_source = _timestamp(prior["source_as_of"])
            selected_source = _timestamp(selected["source_as_of"])
            prior_observed = _timestamp(prior["observed_at"])
            selected_observed = _timestamp(selected["observed_at"])
            if selected_source < prior_source or (
                selected_source == prior_source and selected_observed < prior_observed
            ):
                if self.reconcile_pending_on_noop:
                    self.store.reconcile_committed_pending(domain)
                return active

        next_current = dict(active["current"])
        next_current[entity] = selected
        next_lkg = dict(active["lkg"])
        if (
            domain == "etf_detail"
            and prior is None
            and prior_recovery.get("last_transition") == "unavailable"
        ):
            # Recovery from a known-unavailable state is an initial selection
            # again. The removal transition kept the expired selection in the
            # LKG map only as audit for the unavailable period; carrying it into
            # the initial selection trips the store's "initial selection cannot
            # inject an LKG" invariant and would kill the lane on the very run
            # that recovers the entity. The lineage stays in resolution history.
            next_lkg.pop(entity, None)
        changed = prior != selected
        if changed and prior is not None and not is_same_provider_refresh(
            prior, selected, transition
        ):
            next_lkg[entity] = self.store.preserve_current_as_provider_lkg(
                domain,
                entity,
                expected_active_transaction_id=active_id,
            )
        next_recovery = dict(active["recovery"])
        # Keep the actual transition marker used for unavailable-state recovery.
        next_recovery[entity] = {"last_transition": transition}

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
            decided_at=decided_at,
        )
        return self._commit_prepared(domain, transaction_id)

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

    def resolve_etf_detail_with_outcome(
        self,
        *,
        entity: str,
        observations: list[Mapping[str, Any]],
        decided_at: str,
    ) -> tuple[dict[str, Any], bool]:
        active = self.resolve_etf_detail(
            entity=entity,
            observations=observations,
            decided_at=decided_at,
        )
        return active, self._committed_transaction_id == active["transaction_id"]


__all__ = ["DataSupplyResolver", "FALLBACK_PROVIDER", "NoFreshInitialCandidateError", "PRIMARY_PROVIDER"]
