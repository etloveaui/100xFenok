from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from gates import run_gates
from providers import Provider
from sanitize import sanitize_profile, sanitize_text


def utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def read_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return fallback
    except json.JSONDecodeError:
        return fallback


def write_json_atomic(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def write_text_atomic(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(value, encoding="utf-8")
    tmp.replace(path)


def list_recent_sessions(root: Path, limit: int = 14) -> list[dict[str, Any]]:
    session_dir = root / "sessions"
    sessions = []
    for path in sorted(session_dir.glob("*.json")):
        data = read_json(path, None)
        if isinstance(data, dict):
            sessions.append(data)
    sessions.sort(key=lambda item: str(item.get("date", "")))
    return sessions[-limit:]


def weak_notes_from_store(root: Path) -> list[dict[str, Any]]:
    store = read_json(root / "weak-notes.json", {})
    notes = store.get("notes", []) if isinstance(store, dict) else []
    return [note for note in notes if isinstance(note, dict)]


def assemble_input(root: Path) -> dict[str, Any]:
    return {
        "best3": read_json(root / "best3.json", {}),
        "weak_notes": weak_notes_from_store(root),
        "sessions": list_recent_sessions(root),
        "curriculum_live": read_json(root / "curriculum-live.json", {}),
        "previous_profile": read_json(root / "profile" / "learner-profile.json", None),
    }


def extract_outputs(
    provider_raw: str,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None, str | None]:
    """Parse provider JSON into (learner_profile, curriculum_adjust, error)."""
    try:
        parsed = json.loads(provider_raw)
    except json.JSONDecodeError as exc:
        return None, None, f"schema: provider returned malformed JSON: {exc.msg}"
    if not isinstance(parsed, dict):
        return None, None, "schema: provider JSON must be an object"
    profile = parsed.get("learner-profile", parsed.get("learner_profile"))
    if not isinstance(profile, dict):
        return None, None, "schema: learner-profile missing"
    curriculum = parsed.get("curriculum-adjust", parsed.get("curriculum_adjust"))
    curriculum = curriculum if isinstance(curriculum, dict) else None
    return profile, curriculum, None


def write_alert(root: Path, job: dict[str, Any], reason: str) -> None:
    write_json_atomic(
        root / "_queue" / "last_error.json",
        {
            "ok": False,
            "reason": reason,
            "date": job.get("date"),
            "mode": job.get("mode"),
            "trigger": job.get("trigger"),
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        },
    )


def backup_previous(root: Path, previous_path: Path) -> Path | None:
    if not previous_path.exists():
        return None
    version_dir = root / "profile" / "_versions"
    version_dir.mkdir(parents=True, exist_ok=True)
    target = version_dir / f"learner-profile.{utc_stamp()}.json"
    shutil.copy2(previous_path, target)
    return target


def render_markdown(profile: dict[str, Any], date: str | None) -> str:
    lines = [
        "# Learner Profile",
        "",
        f"- updated: {datetime.now(timezone.utc).isoformat()}",
        f"- source_date: {date or 'unknown'}",
        "",
        "## Weak Patterns",
    ]
    for item in profile.get("weak_patterns", []):
        evidence = ", ".join(item.get("evidence_sessions", []))
        lines.append(f"- {item.get('expression')} ({item.get('severity')}; {evidence})")
    lines.extend(["", "## Strengths"])
    strengths = profile.get("strengths", [])
    if isinstance(strengths, list):
        lines.extend(f"- {item}" for item in strengths)
    elif strengths:
        lines.append(f"- {strengths}")
    lines.extend(["", "## Progress", str(profile.get("progress", "")), ""])
    return "\n".join(lines)


def write_curriculum(root: Path, curriculum: dict[str, Any]) -> str | None:
    """Sanitize and persist nightly curriculum-adjust; returns path or None."""
    next_focus = sanitize_text(curriculum.get("next_focus"))
    if not next_focus:
        return None
    target = root / "curriculum-live.json"
    if target.exists():
        version_dir = root / "profile" / "_versions"
        version_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(target, version_dir / f"curriculum-live.{utc_stamp()}.json")
    write_json_atomic(
        target,
        {
            "next_focus": next_focus,
            "rationale": sanitize_text(curriculum.get("rationale")) or "",
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        },
    )
    return str(target)


def run_distill(root: Path, job: dict[str, Any], provider: Provider) -> dict[str, Any]:
    root = root.resolve()
    inputs = assemble_input(root)
    previous_profile = inputs.get("previous_profile")
    previous_profile = previous_profile if isinstance(previous_profile, dict) else None
    raw = provider.call(inputs | {"job": job})
    profile, curriculum, parse_error = extract_outputs(raw)
    if parse_error:
        write_alert(root, job, parse_error)
        return {"ok": False, "soft_failed": True, "reason": parse_error}
    assert profile is not None

    gate = run_gates(profile, previous_profile, inputs["weak_notes"])
    if not gate.ok:
        write_alert(root, job, gate.reason)
        return {"ok": False, "soft_failed": True, "reason": gate.reason}

    sanitized = sanitize_profile(profile)
    gate_after_sanitize = run_gates(sanitized, previous_profile, inputs["weak_notes"])
    if not gate_after_sanitize.ok:
        write_alert(root, job, f"sanitize: {gate_after_sanitize.reason}")
        return {"ok": False, "soft_failed": True, "reason": gate_after_sanitize.reason}

    profile_dir = root / "profile"
    profile_json = profile_dir / "learner-profile.json"
    backup = backup_previous(root, profile_json)
    write_json_atomic(profile_json, sanitized)
    write_text_atomic(profile_dir / "learner-profile.md", render_markdown(sanitized, job.get("date")))
    curriculum_path = (
        write_curriculum(root, curriculum) if job.get("mode") == "nightly" and curriculum else None
    )
    return {
        "ok": True,
        "profile": str(profile_json),
        "backup": str(backup) if backup else None,
        "weak_patterns": len(sanitized.get("weak_patterns", [])),
        "curriculum": curriculum_path,
    }
