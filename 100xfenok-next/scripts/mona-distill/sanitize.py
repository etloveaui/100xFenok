from __future__ import annotations

import re
from typing import Any


PROMPT_LIKE_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in [
        r"ignore (all )?(previous|prior)",
        r"system prompt",
        r"developer message",
        r"follow these instructions",
        r"obey this",
        r"reveal (the )?(secret|token|password)",
        r"run (this )?(command|tool)",
        r"rm -rf",
        r"curl .*\|",
    ]
]


def is_prompt_like(value: str) -> bool:
    return any(pattern.search(value) for pattern in PROMPT_LIKE_PATTERNS)


def sanitize_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = " ".join(value.strip().split())
    if not normalized or is_prompt_like(normalized):
        return None
    return normalized


def sanitize_profile(profile: dict[str, Any]) -> dict[str, Any]:
    patterns = []
    for item in profile.get("weak_patterns", []):
        if not isinstance(item, dict):
            continue
        expression = sanitize_text(item.get("expression"))
        if not expression:
            continue
        evidence = [
            value
            for value in item.get("evidence_sessions", [])
            if isinstance(value, str) and value.strip()
        ]
        severity = sanitize_text(item.get("severity")) or "medium"
        patterns.append(
            {
                "expression": expression,
                "evidence_sessions": evidence,
                "severity": severity,
            }
        )

    sanitized: dict[str, Any] = {"weak_patterns": patterns}
    for key in ["strengths", "progress"]:
        value = profile.get(key)
        if isinstance(value, list):
            sanitized[key] = [
                cleaned
                for cleaned in (sanitize_text(item) for item in value)
                if cleaned
            ]
        else:
            sanitized[key] = sanitize_text(value) or ([] if key == "strengths" else "")
    return sanitized
