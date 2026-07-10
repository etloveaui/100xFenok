#!/usr/bin/env python3
"""Frozen provider and TTL policies for enrolled data-supply domains."""

from __future__ import annotations

from dataclasses import dataclass


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


_COMMON = {
    "fresh_ttl_hours": 168,
    "emergency_lkg_ttl_days": 14,
    "recovery_green_required": 3,
}

_POLICIES = {
    "etf_detail": DomainPolicy(
        domain="etf_detail",
        providers=(
            ProviderPolicy("stockanalysis", "stockanalysis_etf_detail", "stockanalysis/v1"),
            ProviderPolicy("yahoo_finance", "yahoo_finance_etf_detail", "yf-etf-detail/v1"),
        ),
        **_COMMON,
    ),
    "stock_detail": DomainPolicy(
        domain="stock_detail",
        providers=(
            ProviderPolicy("stockanalysis", "stockanalysis_stock_detail", "stockanalysis/v1"),
            ProviderPolicy("yahoo_finance", "yahoo_finance_stock_detail", "yf-finance/v2"),
        ),
        **_COMMON,
    ),
}


def get_domain_policy(domain: str) -> DomainPolicy:
    return _POLICIES[domain]


__all__ = ["DomainPolicy", "ProviderPolicy", "get_domain_policy"]
