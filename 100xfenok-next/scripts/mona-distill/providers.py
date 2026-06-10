from __future__ import annotations

import json
from typing import Any, Protocol


class Provider(Protocol):
    def call(self, payload: dict[str, Any]) -> str:
        ...


class MockProvider:
    """Scriptable provider for gate and rollback tests."""

    def __init__(self, mode: str = "valid") -> None:
        self.mode = mode

    def call(self, payload: dict[str, Any]) -> str:
        if self.mode == "malformed":
            return "{not-json"

        weak_notes = payload.get("weak_notes")
        first_note: dict[str, Any] = {}
        if isinstance(weak_notes, list) and weak_notes:
            maybe_note = weak_notes[0]
            if isinstance(maybe_note, dict):
                first_note = maybe_note

        expression = str(first_note.get("correct") or first_note.get("expression") or "I was stuck.")
        sessions = first_note.get("sessions")
        evidence_sessions = sessions if isinstance(sessions, list) and sessions else ["2026-06-09"]

        if self.mode == "fabricated":
            expression = "Fabricated phrase with no weak-note source."

        weak_patterns = [
            {
                "expression": expression,
                "evidence_sessions": evidence_sessions,
                "severity": "medium",
            }
        ]

        if self.mode == "drastic":
            weak_patterns = [
                {
                    "expression": f"new drastic pattern {index}",
                    "evidence_sessions": evidence_sessions,
                    "severity": "high",
                }
                for index in range(12)
            ]

        return json.dumps(
            {
                "learner-profile": {
                    "weak_patterns": weak_patterns,
                    "strengths": ["short answers", "good repetition"],
                    "progress": "uses corrected expressions faster",
                },
                "curriculum-adjust": {
                    "next_focus": "past tense drills in daily small talk",
                    "rationale": "repeated past-tense misses in recent sessions",
                },
            },
            ensure_ascii=True,
        )
