#!/usr/bin/env python3
"""Fail-closed projection of the versioned data-supply policy registry."""

from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any, Mapping


REGISTRY_SCHEMA = "data-supply-policy-registry/v1"
REGISTRY_ENV = "DATA_SUPPLY_POLICY_REGISTRY_PATH"
DEFAULT_REGISTRY_PATH = Path(__file__).with_name("data_supply_policy_registry.v1.json")

_ENROLLED_DOMAINS = ("etf_detail", "stock_detail")
_KNOWN_PROVIDERS = frozenset({"stockanalysis", "yahoo_finance"})
_EXPECTED_PROVIDER_ORDER = ("stockanalysis", "yahoo_finance")
_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_IDENTIFIER = re.compile(r"^[A-Za-z0-9._-]+$")
_DOMAIN_KEYS = frozenset(
    {
        "resolution_scope",
        "providers",
        "fresh_ttl_hours",
        "emergency_lkg_ttl_days",
        "recovery_green_required",
        "allowed_consumers",
    }
)
_PROVIDER_KEYS = frozenset({"name", "endpoint_family", "schema"})


class PolicyRegistryError(RuntimeError):
    """The policy registry cannot be trusted or the consumer is unauthorized."""


def _fail(message: str, *, cause: Exception | None = None) -> None:
    error = PolicyRegistryError(f"data-supply-policy-registry: {message}")
    if cause is None:
        raise error
    raise error from cause


def _canonical_json_bytes(value: Any) -> bytes:
    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        _fail("policy is not canonical JSON", cause=exc)


def _strict_json_loads(payload: bytes) -> Any:
    def reject_constant(value: str) -> None:
        raise ValueError(f"non-finite JSON number: {value}")

    def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"duplicate JSON key: {key}")
            result[key] = value
        return result

    try:
        return json.loads(
            payload.decode("utf-8"),
            parse_constant=reject_constant,
            object_pairs_hook=unique_object,
        )
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        _fail("registry is not strict JSON", cause=exc)


def _require_exact_keys(record: Mapping[str, Any], expected: frozenset[str], label: str) -> None:
    actual = frozenset(record)
    if actual != expected:
        missing = sorted(expected - actual)
        unknown = sorted(actual - expected)
        detail = []
        if missing:
            detail.append(f"missing={','.join(missing)}")
        if unknown:
            detail.append(f"unknown={','.join(unknown)}")
        _fail(f"{label} keys are invalid ({'; '.join(detail)})")


def _identifier(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value or not _IDENTIFIER.fullmatch(value):
        _fail(f"{label} must be a safe non-empty identifier")
    return value


def _positive_int(value: Any, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        _fail(f"{label} must be a positive integer")
    return value


@dataclass(frozen=True)
class ProviderPolicy:
    name: str
    endpoint_family: str
    schema: str


@dataclass(frozen=True)
class DomainPolicy:
    domain: str
    providers: tuple[ProviderPolicy, ProviderPolicy]
    fresh_ttl_hours: int
    emergency_lkg_ttl_days: int
    recovery_green_required: int
    resolution_scope: str
    allowed_consumers: tuple[str, ...]
    policy_digest: str

    @property
    def primary(self) -> ProviderPolicy:
        return self.providers[0]

    @property
    def fallback(self) -> ProviderPolicy:
        return self.providers[1]

    @property
    def provider_names(self) -> tuple[str, str]:
        return tuple(provider.name for provider in self.providers)

    def provider(self, name: str) -> ProviderPolicy:
        for provider in self.providers:
            if provider.name == name:
                return provider
        raise KeyError(name)


@dataclass(frozen=True)
class PolicyRegistry:
    schema_version: str
    policy_digest: str
    domains: Mapping[str, DomainPolicy]


def _provider_policy(value: Any, *, domain: str, index: int) -> ProviderPolicy:
    if not isinstance(value, Mapping):
        _fail(f"{domain}.providers[{index}] must be an object")
    _require_exact_keys(value, _PROVIDER_KEYS, f"{domain}.providers[{index}]")
    name = _identifier(value["name"], f"{domain}.providers[{index}].name")
    if name not in _KNOWN_PROVIDERS:
        _fail(f"{domain}.providers[{index}] is unknown: {name}")
    endpoint_family = _identifier(
        value["endpoint_family"], f"{domain}.providers[{index}].endpoint_family"
    )
    schema = value["schema"]
    if not isinstance(schema, str) or not schema or len(schema) > 128:
        _fail(f"{domain}.providers[{index}].schema must be a non-empty label")
    return ProviderPolicy(name=name, endpoint_family=endpoint_family, schema=schema)


def _domain_policy(domain: str, value: Any, *, policy_digest: str) -> DomainPolicy:
    if not isinstance(value, Mapping):
        _fail(f"domain {domain} must be an object")
    _require_exact_keys(value, _DOMAIN_KEYS, f"domain {domain}")
    if value["resolution_scope"] != "domain_atomic":
        _fail(f"domain {domain} resolution_scope must be domain_atomic")
    raw_providers = value["providers"]
    if not isinstance(raw_providers, list) or len(raw_providers) != 2:
        _fail(f"domain {domain} must declare exactly two ordered providers")
    providers = tuple(
        _provider_policy(item, domain=domain, index=index)
        for index, item in enumerate(raw_providers)
    )
    provider_names = tuple(provider.name for provider in providers)
    if provider_names != _EXPECTED_PROVIDER_ORDER:
        _fail(f"domain {domain} provider order must preserve primary then fallback")
    raw_consumers = value["allowed_consumers"]
    if not isinstance(raw_consumers, list) or not raw_consumers:
        _fail(f"domain {domain} allowed_consumers must be a non-empty array")
    consumers = tuple(
        _identifier(consumer, f"domain {domain} allowed_consumers")
        for consumer in raw_consumers
    )
    if len(set(consumers)) != len(consumers):
        _fail(f"domain {domain} allowed_consumers contains duplicates")
    return DomainPolicy(
        domain=domain,
        providers=providers,  # type: ignore[arg-type]
        fresh_ttl_hours=_positive_int(value["fresh_ttl_hours"], f"domain {domain} fresh_ttl_hours"),
        emergency_lkg_ttl_days=_positive_int(
            value["emergency_lkg_ttl_days"], f"domain {domain} emergency_lkg_ttl_days"
        ),
        recovery_green_required=_positive_int(
            value["recovery_green_required"], f"domain {domain} recovery_green_required"
        ),
        resolution_scope="domain_atomic",
        allowed_consumers=consumers,
        policy_digest=policy_digest,
    )


def load_policy_registry(path: str | Path) -> PolicyRegistry:
    registry_path = Path(path)
    try:
        payload = registry_path.read_bytes()
    except OSError as exc:
        _fail(f"registry read failed: {registry_path}", cause=exc)
    raw = _strict_json_loads(payload)
    if not isinstance(raw, Mapping):
        _fail("registry root must be an object")
    _require_exact_keys(raw, frozenset({"schema_version", "policy_digest", "domains"}), "registry")
    if raw["schema_version"] != REGISTRY_SCHEMA:
        _fail("unsupported schema_version")
    digest = raw["policy_digest"]
    if not isinstance(digest, str) or not _HEX64.fullmatch(digest):
        _fail("policy_digest must be a lowercase SHA-256 digest")
    domains = raw["domains"]
    if not isinstance(domains, Mapping):
        _fail("domains must be an object")
    if tuple(domains) != _ENROLLED_DOMAINS:
        _fail("domains must contain only etf_detail and stock_detail in canonical order")
    policies = {
        domain: _domain_policy(domain, domains[domain], policy_digest=digest)
        for domain in _ENROLLED_DOMAINS
    }
    calculated = hashlib.sha256(
        _canonical_json_bytes({"schema_version": raw["schema_version"], "domains": domains})
    ).hexdigest()
    if digest != calculated:
        _fail("policy_digest does not match canonical policy content")
    return PolicyRegistry(
        schema_version=REGISTRY_SCHEMA,
        policy_digest=digest,
        domains=MappingProxyType(policies),
    )


_REGISTRY_PATH = Path(os.environ.get(REGISTRY_ENV, DEFAULT_REGISTRY_PATH))
_REGISTRY = load_policy_registry(_REGISTRY_PATH)


def get_domain_policy(domain: str, *, consumer_id: str) -> DomainPolicy:
    policy = _REGISTRY.domains[domain]
    if consumer_id not in policy.allowed_consumers:
        _fail(f"consumer {consumer_id!r} is not authorized for domain {domain}")
    return policy


def policy_registry_digest() -> str:
    return _REGISTRY.policy_digest


def registered_domains() -> tuple[str, ...]:
    return tuple(_REGISTRY.domains)


__all__ = [
    "DEFAULT_REGISTRY_PATH",
    "DomainPolicy",
    "PolicyRegistry",
    "PolicyRegistryError",
    "ProviderPolicy",
    "REGISTRY_ENV",
    "REGISTRY_SCHEMA",
    "get_domain_policy",
    "load_policy_registry",
    "policy_registry_digest",
    "registered_domains",
]
