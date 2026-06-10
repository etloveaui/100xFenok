from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class GateResult:
    ok: bool
    reason: str = ""


def normalize(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return re.sub(r"\s+", " ", value.strip().lower())


def validate_profile_schema(profile: Any) -> GateResult:
    if not isinstance(profile, dict):
        return GateResult(False, "schema: learner-profile must be an object")
    patterns = profile.get("weak_patterns")
    if not isinstance(patterns, list):
        return GateResult(False, "schema: weak_patterns must be a list")
    for index, item in enumerate(patterns):
        if not isinstance(item, dict):
            return GateResult(False, f"schema: weak_patterns[{index}] must be an object")
        if not isinstance(item.get("expression"), str) or not item["expression"].strip():
            return GateResult(False, f"schema: weak_patterns[{index}].expression missing")
        evidence = item.get("evidence_sessions")
        if not isinstance(evidence, list) or not all(isinstance(value, str) for value in evidence):
            return GateResult(False, f"schema: weak_patterns[{index}].evidence_sessions invalid")
        if not isinstance(item.get("severity"), str) or not item["severity"].strip():
            return GateResult(False, f"schema: weak_patterns[{index}].severity missing")
    if "strengths" not in profile or "progress" not in profile:
        return GateResult(False, "schema: strengths/progress required")
    return GateResult(True)


def delta_guard(profile: dict[str, Any], previous_profile: dict[str, Any] | None) -> GateResult:
    if not previous_profile:
        return GateResult(True)
    previous_patterns = previous_profile.get("weak_patterns", [])
    current_patterns = profile.get("weak_patterns", [])
    if not isinstance(previous_patterns, list) or not previous_patterns:
        return GateResult(True)
    if not isinstance(current_patterns, list):
        return GateResult(False, "delta: current weak_patterns invalid")

    if len(current_patterns) > max(10, len(previous_patterns) * 3):
        return GateResult(False, "delta: weak pattern count changed too much")

    previous_expr = {
        normalize(item.get("expression"))
        for item in previous_patterns
        if isinstance(item, dict)
    }
    current_expr = {
        normalize(item.get("expression"))
        for item in current_patterns
        if isinstance(item, dict)
    }
    previous_expr.discard("")
    current_expr.discard("")
    if len(previous_expr) >= 2 and len(current_expr) >= 2 and previous_expr.isdisjoint(current_expr):
        return GateResult(False, "delta: weak pattern set replaced wholesale")
    return GateResult(True)


def _weak_note_sources(weak_notes: list[dict[str, Any]]) -> tuple[dict[str, set[str]], set[str]]:
    source_sessions: dict[str, set[str]] = {}
    all_sessions: set[str] = set()
    for note in weak_notes:
        raw_sessions = note.get("sessions", [])
        sessions = {value for value in raw_sessions if isinstance(value, str)}
        if isinstance(note.get("lastSeen"), str):
            sessions.add(note["lastSeen"])
        all_sessions.update(sessions)
        for key in ["correct", "expression", "ko"]:
            source = normalize(note.get(key))
            if source:
                source_sessions.setdefault(source, set()).update(sessions)
    return source_sessions, all_sessions


def groundedness_gate(profile: dict[str, Any], weak_notes: list[dict[str, Any]]) -> GateResult:
    source_sessions, all_sessions = _weak_note_sources(weak_notes)
    if not source_sessions and profile.get("weak_patterns"):
        return GateResult(False, "groundedness: no weak notes for weak_patterns")

    for index, pattern in enumerate(profile.get("weak_patterns", [])):
        expression = normalize(pattern.get("expression"))
        if expression not in source_sessions:
            return GateResult(False, f"groundedness: weak_patterns[{index}] not backed by weak-notes")
        evidence = {
            value
            for value in pattern.get("evidence_sessions", [])
            if isinstance(value, str)
        }
        if not evidence:
            return GateResult(False, f"groundedness: weak_patterns[{index}] has no evidence")
        allowed = source_sessions[expression] or all_sessions
        if allowed and not evidence.issubset(allowed):
            return GateResult(False, f"groundedness: weak_patterns[{index}] evidence not in inputs")
    return GateResult(True)


def run_gates(
    profile: dict[str, Any],
    previous_profile: dict[str, Any] | None,
    weak_notes: list[dict[str, Any]],
) -> GateResult:
    for gate in [
        validate_profile_schema(profile),
        delta_guard(profile, previous_profile),
        groundedness_gate(profile, weak_notes),
    ]:
        if not gate.ok:
            return gate
    return GateResult(True)
