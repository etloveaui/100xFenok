from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

ORIGINAL_BANK_FIELDS = ("ko", "en", "note", "theme", "register", "source_id")
ALLOWED_VARIATION_KINDS = {"negation", "past", "question", "subject"}
ALLOWED_THEMES = {"work", "family-friends", "selftalk-emotion", "out-shopping-dining", "work-advanced", "free"}
SOURCE_FRAGMENT_WORDS = 4


@dataclass(frozen=True)
class GateResult:
    ok: bool
    reason: str = ""


def normalize(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return re.sub(r"\s+", " ", value.strip().lower())


def word_count(value: Any) -> int:
    if not isinstance(value, str):
        return 0
    cleaned = re.sub(r"[^\w\s']", " ", value).strip()
    return len(cleaned.split()) if cleaned else 0


def source_match_tokens(value: Any) -> list[str]:
    if not isinstance(value, str):
        return []
    return re.findall(r"[a-z0-9']+", value.lower())


def source_match_fragments(value: Any, fragment_words: int = SOURCE_FRAGMENT_WORDS) -> list[str]:
    tokens = source_match_tokens(value)
    if not tokens:
        return []
    if len(tokens) <= fragment_words:
        return [" ".join(tokens)]
    return [
        " ".join(tokens[index:index + fragment_words])
        for index in range(len(tokens) - fragment_words + 1)
    ]


def is_verified_in_source(en: Any, transcript: Any, fragment_words: int = SOURCE_FRAGMENT_WORDS) -> bool:
    source = " ".join(source_match_tokens(transcript))
    if not source:
        return False
    return any(fragment in source for fragment in source_match_fragments(en, fragment_words=fragment_words))


def apply_source_verification(entry: dict[str, Any], transcript: str | None) -> dict[str, Any]:
    verified = dict(entry)
    if transcript is None:
        verified.pop("verifiedInSource", None)
        return verified
    verified["verifiedInSource"] = is_verified_in_source(verified.get("en"), transcript)
    return verified


def validate_enriched_entry(entry: Any) -> GateResult:
    if not isinstance(entry, dict):
        return GateResult(False, "enrich-schema: entry must be an object")
    for field in ORIGINAL_BANK_FIELDS:
        if field not in entry:
            return GateResult(False, f"enrich-schema: {field} missing")
    difficulty = entry.get("difficulty")
    if difficulty not in (1, 2, 3):
        return GateResult(False, "enrich-schema: difficulty must be 1/2/3")
    expected_word_count = word_count(entry.get("en"))
    if entry.get("word_count") != expected_word_count:
        return GateResult(False, "enrich-schema: word_count mismatch")
    pattern = entry.get("pattern")
    if not isinstance(pattern, str) or not pattern.strip() or len(pattern) > 40:
        return GateResult(False, "enrich-schema: pattern invalid")
    variations = entry.get("variations")
    if not isinstance(variations, list) or len(variations) != 2:
        return GateResult(False, "enrich-schema: variations must have length 2")
    for index, variation in enumerate(variations):
        if not isinstance(variation, dict):
            return GateResult(False, f"enrich-schema: variations[{index}] must be an object")
        if variation.get("kind") not in ALLOWED_VARIATION_KINDS:
            return GateResult(False, f"enrich-schema: variations[{index}].kind invalid")
        if not isinstance(variation.get("ko"), str) or not variation["ko"].strip():
            return GateResult(False, f"enrich-schema: variations[{index}].ko invalid")
        if not isinstance(variation.get("en"), str) or not variation["en"].strip():
            return GateResult(False, f"enrich-schema: variations[{index}].en invalid")
    sibling = entry.get("sibling")
    if sibling is not None:
        if not isinstance(sibling, dict):
            return GateResult(False, "enrich-schema: sibling must be object or null")
        if not isinstance(sibling.get("ko"), str) or not sibling["ko"].strip():
            return GateResult(False, "enrich-schema: sibling.ko invalid")
        if not isinstance(sibling.get("en"), str) or not sibling["en"].strip():
            return GateResult(False, "enrich-schema: sibling.en invalid")
        if normalize(sibling["en"]) == normalize(entry.get("en")):
            return GateResult(False, "enrich-schema: sibling.en must differ from en")
        if word_count(sibling["en"]) > 8:
            return GateResult(False, "enrich-schema: sibling.en must be 8 words or fewer")
    if difficulty == 3 and sibling is None:
        return GateResult(False, "enrich-schema: sibling required for difficulty 3")
    if not isinstance(entry.get("enrichedAt"), str) or not entry["enrichedAt"].strip():
        return GateResult(False, "enrich-schema: enrichedAt missing")
    if entry.get("enrichVersion") != 1:
        return GateResult(False, "enrich-schema: enrichVersion must be 1")
    if "grounded" in entry and not isinstance(entry.get("grounded"), bool):
        return GateResult(False, "enrich-schema: grounded must be boolean")
    return GateResult(True)


def validate_original_fields_immutable(original: dict[str, Any], enriched: dict[str, Any]) -> GateResult:
    for field in ORIGINAL_BANK_FIELDS:
        if enriched.get(field) != original.get(field):
            return GateResult(False, f"immutability: {field} changed")
    return GateResult(True)


def _bank_key(entry: dict[str, Any]) -> tuple[str, str]:
    return (str(entry.get("source_id") or ""), normalize(entry.get("en")))


def validate_enriched_bank(
    original_bank: dict[str, Any],
    candidate_bank: dict[str, Any],
    cap: int = 1200,
    theme_targets: dict[str, int] | None = None,
) -> GateResult:
    original_entries = original_bank.get("entries", []) if isinstance(original_bank, dict) else []
    candidate_entries = candidate_bank.get("entries", []) if isinstance(candidate_bank, dict) else []
    if not isinstance(original_entries, list) or not isinstance(candidate_entries, list):
        return GateResult(False, "bank-schema: entries must be lists")
    if len(candidate_entries) < len(original_entries):
        return GateResult(False, "bank-schema: original entries missing")
    if len(candidate_entries) > cap:
        return GateResult(False, "bank-schema: bank cap exceeded")

    candidate_by_key = {
        _bank_key(entry): entry
        for entry in candidate_entries
        if isinstance(entry, dict)
    }
    seen_en: set[str] = set()
    theme_counts = {theme: 0 for theme in ALLOWED_THEMES}
    for index, entry in enumerate(candidate_entries):
        if not isinstance(entry, dict):
            return GateResult(False, f"bank-schema: entries[{index}] must be an object")
        key = normalize(entry.get("en"))
        if not key:
            return GateResult(False, f"bank-schema: entries[{index}].en missing")
        if key in seen_en:
            return GateResult(False, f"bank-schema: duplicate en: {entry.get('en')}")
        seen_en.add(key)
        theme = entry.get("theme")
        if theme not in ALLOWED_THEMES:
            return GateResult(False, f"bank-schema: invalid theme: {theme}")
        theme_counts[str(theme)] += 1
        gate = validate_enriched_entry(entry)
        if not gate.ok:
            return GateResult(False, f"entries[{index}]: {gate.reason}")

    for index, original in enumerate(original_entries):
        if not isinstance(original, dict):
            return GateResult(False, f"original[{index}] must be an object")
        candidate = candidate_by_key.get(_bank_key(original))
        if candidate is None:
            return GateResult(False, f"immutability: original entry missing: {original.get('en')}")
        gate = validate_original_fields_immutable(original, candidate)
        if not gate.ok:
            return GateResult(False, f"original[{index}]: {gate.reason}")

    if theme_targets:
        for theme, target in theme_targets.items():
            if theme_counts.get(theme, 0) > target:
                return GateResult(False, f"balance: {theme} exceeds target {target}")
    return GateResult(True)


def validate_coverage_lane(
    coverage: dict[str, Any],
    transcript_ids: list[str],
    lane: str = "expressions",
    max_error_rate: float = 0.02,
) -> GateResult:
    lane_data = coverage.get(lane)
    if not isinstance(lane_data, dict):
        return GateResult(False, f"coverage: {lane} lane missing")
    if not transcript_ids:
        return GateResult(False, "coverage: transcript list is empty")
    allowed = {"extracted", "zero-yield", "error", "observed"}
    errors = 0
    for video_id in transcript_ids:
        item = lane_data.get(video_id)
        if not isinstance(item, dict):
            return GateResult(False, f"coverage: {lane}.{video_id} missing")
        status = item.get("status")
        if status not in allowed:
            return GateResult(False, f"coverage: {lane}.{video_id} status invalid")
        if status == "error":
            errors += 1
    error_rate = errors / len(transcript_ids)
    if error_rate >= max_error_rate:
        return GateResult(False, f"coverage: {lane} error rate {error_rate:.2%} >= {max_error_rate:.2%}")
    return GateResult(True)


def validate_distillate_records(records: list[dict[str, Any]]) -> GateResult:
    seen: set[tuple[str, str]] = set()
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            return GateResult(False, f"distillate[{index}]: record must be object")
        if not isinstance(record.get("source_id"), str) or not record["source_id"].strip():
            return GateResult(False, f"distillate[{index}]: source_id missing")
        if not isinstance(record.get("extractedAt"), str) or not record["extractedAt"].strip():
            return GateResult(False, f"distillate[{index}]: extractedAt missing")
        gate = validate_enriched_entry(record)
        if not gate.ok:
            return GateResult(False, f"distillate[{index}]: {gate.reason}")
        key = (record["source_id"], normalize(record.get("en")))
        if key in seen:
            return GateResult(False, f"distillate[{index}]: duplicate source/en")
        seen.add(key)
    return GateResult(True)


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
