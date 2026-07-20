"""Fail-closed 13F value normalization and CCH-compatible weight filtering."""

from __future__ import annotations

from copy import deepcopy
from decimal import Decimal, ROUND_HALF_UP
from typing import Any


class NormalizationError(ValueError):
    pass


def normalize_values(
    rows: list[dict[str, Any]],
    *,
    unit: str,
    evidence: str,
    confidence: float,
) -> list[dict[str, Any]]:
    if unit not in {"dollars", "thousands"}:
        raise NormalizationError("unit must be resolved as dollars or thousands")
    if not evidence or not isinstance(confidence, (int, float)) or confidence < 0.5 or confidence > 1:
        raise NormalizationError("unit evidence and confidence are required")
    multiplier = 1 if unit == "dollars" else 1000
    normalized = []
    for index, source in enumerate(rows):
        value = source.get("value")
        shares = source.get("shares")
        if not isinstance(value, (int, float)) or value < 0:
            raise NormalizationError(f"row {index}: invalid value")
        if not isinstance(shares, (int, float)) or shares < 0:
            raise NormalizationError(f"row {index}: invalid shares")
        row = deepcopy(source)
        row["value"] = value * multiplier
        row["unit"] = unit
        row["unit_evidence"] = evidence
        row["unit_confidence"] = confidence
        normalized.append(row)
    return normalized


def apply_weight_filter(rows: list[dict[str, Any]], *, threshold: float = 0.001) -> list[dict[str, Any]]:
    total = sum(row.get("value", 0) for row in rows)
    if not isinstance(total, (int, float)) or total <= 0:
        raise NormalizationError("filing total value must be positive")
    kept = []
    for row in rows:
        weight = Decimal(str(row["value"] / total)).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
        if weight >= Decimal(str(threshold)):
            output = deepcopy(row)
            output["weight"] = float(weight)
            kept.append(output)
    return kept
