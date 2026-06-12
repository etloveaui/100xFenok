"""W1 expression-bank enrichment for the D-track distill pilot.

Usage:
  python enrich.py --root data/mona-english --transcripts ../mona-life/data/english-raw/ppalmo/transcripts
  python enrich.py --root data/mona-english --write-staging

The command enriches existing bank entries additively and writes only
expression-bank.staging.json when --write-staging is supplied. It never swaps
the live bank; Claude-side gates perform the final live-file promotion.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from chains import call_gemini_flash_lite, make_gpt_adapter, strip_code_fence
from distill_engine import read_json, write_json_atomic
from gates import ORIGINAL_BANK_FIELDS, validate_enriched_entry, word_count
from worker import default_root

ENRICH_VERSION = 1
LLM_SLEEP_LADDER_S = (12.0, 60.0, 180.0)
ENRICH_SYSTEM = "너는 빨모쌤 영어회화 표현 은행을 보강하는 분석기다. 출력은 JSON 배열 하나만."
VARIATION_KINDS = ("negation", "past", "question", "subject")
COMMON_PATTERN_LIMIT = 40

EnrichProvider = Callable[[str, list[dict[str, Any]], str, bool], str]


def utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_en(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return re.sub(r"\s+", " ", value.strip().lower())


def default_raw_root(root: Path) -> Path:
    resolved = root.resolve()
    return resolved.parent / "english-raw" / "ppalmo"


def default_transcript_dir(root: Path) -> Path:
    return default_raw_root(root) / "transcripts"


def default_log_path(root: Path) -> Path:
    return default_raw_root(root) / "distill_pilot.log"


def read_transcript_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def append_log(root: Path, message: str) -> None:
    path = default_log_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(f"{utc_iso()} {message}\n")


def backup_expression_bank(root: Path, stamp: str = "20260613") -> Path | None:
    bank_path = root / "expression-bank.json"
    if not bank_path.exists():
        return None
    archive_dir = root / "_archive"
    target_dir = archive_dir if archive_dir.exists() else root
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"expression-bank.json.bak-{stamp}"
    if not target.exists():
        shutil.copy2(bank_path, target)
    return target


def expression_bank_input_path(root: Path) -> Path:
    staging = root / "expression-bank.staging.json"
    return staging if staging.exists() else root / "expression-bank.json"


def derive_pattern(en: str) -> str:
    cleaned = re.sub(r"\s+", " ", en.strip())
    replacements = [
        (r"\bI\b", "I"),
        (r"\byou\b", "you"),
        (r"\bwe\b", "we"),
        (r"\bhe\b|\bshe\b|\bthey\b", "~"),
    ]
    pattern = cleaned
    for source, repl in replacements:
        pattern = re.sub(source, repl, pattern, flags=re.IGNORECASE)
    return pattern[:COMMON_PATTERN_LIMIT].strip() or cleaned[:COMMON_PATTERN_LIMIT] or "daily expression"


def local_difficulty(entry: dict[str, Any]) -> int:
    en = str(entry.get("en") or "")
    count = word_count(en)
    theme = entry.get("theme")
    abstract_hint = re.search(r"\b(sense|demanding|traditional|ahead|slide|thorough|expect|supposed)\b", en, re.IGNORECASE)
    if theme == "work-advanced" or abstract_hint:
        return 3
    if count <= 6:
        return 1
    return 2 if count <= 10 else 3


def _clean_short_string(value: Any, max_length: int) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = re.sub(r"\s+", " ", value.strip())
    return cleaned[:max_length] if cleaned else None


def _coerce_variations(value: Any) -> list[dict[str, str]]:
    variations: list[dict[str, str]] = []
    if isinstance(value, list):
        for raw in value:
            if not isinstance(raw, dict):
                continue
            kind = raw.get("kind")
            ko = _clean_short_string(raw.get("ko"), 120)
            en = _clean_short_string(raw.get("en"), 160)
            if kind in VARIATION_KINDS and ko and en:
                variations.append({"kind": str(kind), "ko": ko, "en": en})
            if len(variations) == 2:
                break
    return variations[:2]


def add_entry_enrichment(
    entry: dict[str, Any],
    raw: dict[str, Any] | None,
    grounded: bool,
    now: str | None = None,
) -> dict[str, Any]:
    """Return a copy with additive enrichment fields; original fields are preserved."""
    if not isinstance(raw, dict):
        raise ValueError("enrich-schema: missing enrichment candidate")
    enriched = dict(entry)
    difficulty = raw.get("difficulty")
    difficulty = difficulty if difficulty in (1, 2, 3) else local_difficulty(entry)
    pattern = _clean_short_string(raw.get("pattern"), COMMON_PATTERN_LIMIT) or derive_pattern(str(entry.get("en") or ""))
    sibling_raw = raw.get("sibling")
    sibling = None
    if isinstance(sibling_raw, dict):
        ko = _clean_short_string(sibling_raw.get("ko"), 120)
        en = _clean_short_string(sibling_raw.get("en"), 160)
        if ko and en:
            sibling = {"ko": ko, "en": en}
    enriched.update(
        {
            "difficulty": difficulty,
            "word_count": word_count(entry.get("en")),
            "pattern": pattern,
            "variations": _coerce_variations(raw.get("variations")),
            "sibling": sibling,
            "grounded": grounded,
            "enrichedAt": now or utc_iso(),
            "enrichVersion": ENRICH_VERSION,
        }
    )
    gate = validate_enriched_entry(enriched)
    if not gate.ok:
        raise ValueError(gate.reason)
    for field in ORIGINAL_BANK_FIELDS:
        enriched[field] = entry.get(field)
    return enriched


def build_enrich_prompt(source_id: str, entries: list[dict[str, Any]], transcript: str, grounded: bool) -> str:
    payload = {
        "source_id": source_id,
        "grounded": grounded,
        "entries": [
            {field: entry.get(field) for field in ORIGINAL_BANK_FIELDS}
            for entry in entries
        ],
        "transcript_excerpt": transcript[:12000],
    }
    return "\n".join(
        [
            "아래 빨모쌤 강의 transcript와 기존 expression-bank 엔트리를 보고 enrichment 필드만 산출해라.",
            "절대 ko/en/note/theme/register/source_id를 바꾸지 마라.",
            "difficulty: 1 easy daily, 2 mid, 3 hard-abstract/business/idiom. 애매하면 더 어렵게 판정.",
            "word_count는 출력하지 않아도 된다. 로컬에서 계산한다.",
            "variations는 정확히 2개, 같은 known-word vocabulary로 만든다.",
            "difficulty 3이면 sibling은 반드시 더 쉬운 대체문장으로 제공한다.",
            "entries 배열의 모든 항목에 대해 반드시 enrichment를 산출한다. transcript에 없는 표현이어도 일반 지식으로 산출하라.",
            '출력: [{"en":"원문 en","difficulty":1|2|3,"pattern":"<=40 chars","variations":[{"kind":"negation|past|question|subject","ko":"...","en":"..."}],"sibling":{"ko":"...","en":"..."}|null}]',
            "",
            json.dumps(payload, ensure_ascii=False, indent=2),
        ]
    )


def call_enrich_chain(source_id: str, entries: list[dict[str, Any]], transcript: str, grounded: bool) -> str:
    prompt = build_enrich_prompt(source_id, entries, transcript, grounded)
    errors: list[str] = []
    for name, adapter in [
        ("gemini-3.1-flash-lite", call_gemini_flash_lite),
        ("gpt-5.4-mini", make_gpt_adapter("gpt-5.4-mini")),
    ]:
        for sleep_s in (0.0, *LLM_SLEEP_LADDER_S):
            if sleep_s:
                time.sleep(sleep_s)
            try:
                return adapter(ENRICH_SYSTEM, prompt)
            except Exception as exc:  # noqa: BLE001 - free-chain fallback ladder
                message = str(exc)
                errors.append(f"{name}: {message}")
                if "429" not in message and "rate" not in message.lower():
                    break
    raise RuntimeError(" | ".join(errors) or f"{source_id}: enrichment chain exhausted")


def parse_enrichment_response(raw_text: str) -> dict[str, dict[str, Any]]:
    try:
        parsed = json.loads(strip_code_fence(raw_text))
    except json.JSONDecodeError:
        return {}
    if isinstance(parsed, dict):
        parsed = parsed.get("entries", parsed.get("items", []))
    if not isinstance(parsed, list):
        return {}
    result: dict[str, dict[str, Any]] = {}
    for item in parsed:
        if not isinstance(item, dict):
            continue
        key = normalize_en(item.get("en"))
        if key:
            result[key] = item
    return result


def group_entries_by_source(entries: list[dict[str, Any]], force: bool = False) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        if entry.get("enrichVersion") == ENRICH_VERSION and not force:
            continue
        source_id = str(entry.get("source_id") or "").strip()
        if source_id:
            grouped[source_id].append(entry)
    return dict(grouped)


def enrich_bank(
    root: Path,
    transcript_dir: Path | None = None,
    provider: EnrichProvider | None = None,
    limit: int | None = None,
    force: bool = False,
) -> tuple[dict[str, Any], dict[str, Any]]:
    root = root.resolve()
    bank_path = expression_bank_input_path(root)
    bank = read_json(bank_path, {})
    entries = bank.get("entries", []) if isinstance(bank, dict) else []
    if not isinstance(entries, list):
        raise ValueError("expression-bank entries must be a list")
    transcript_dir = transcript_dir or default_transcript_dir(root)
    groups = group_entries_by_source(entries, force=force)
    source_ids = sorted(groups)[:limit or None]
    by_identity = {id(entry): entry for entry in entries if isinstance(entry, dict)}
    enriched_by_id: dict[int, dict[str, Any]] = {}
    failed: list[dict[str, str]] = []
    missing_by_source: dict[str, int] = defaultdict(int)
    invalid_enrichment: list[dict[str, str]] = []
    ungrounded_retries = 0
    now = utc_iso()

    for source_id in source_ids:
        group = groups[source_id]
        transcript_path = transcript_dir / f"{source_id}.txt"
        try:
            transcript = read_transcript_text(transcript_path)
            grounded = bool(transcript.strip())
            raw_text = provider(source_id, group, transcript, grounded) if provider else call_enrich_chain(source_id, group, transcript, grounded)
            candidates = parse_enrichment_response(raw_text)
            missing_entries: list[dict[str, Any]] = []
            for entry in group:
                raw = candidates.get(normalize_en(entry.get("en")))
                if raw is None:
                    missing_entries.append(entry)
                    continue
                try:
                    enriched_by_id[id(entry)] = add_entry_enrichment(entry, raw, grounded=grounded, now=now)
                except ValueError as exc:
                    missing_by_source[source_id] += 1
                    invalid_enrichment.append({
                        "source_id": source_id,
                        "en": str(entry.get("en") or ""),
                        "reason": str(exc),
                    })
            if missing_entries:
                ungrounded_retries += 1
                try:
                    retry_text = provider(source_id, missing_entries, "", False) if provider else call_enrich_chain(source_id, missing_entries, "", False)
                    retry_candidates = parse_enrichment_response(retry_text)
                    for entry in missing_entries:
                        raw = retry_candidates.get(normalize_en(entry.get("en")))
                        if raw is None:
                            missing_by_source[source_id] += 1
                            continue
                        try:
                            enriched_by_id[id(entry)] = add_entry_enrichment(entry, raw, grounded=False, now=now)
                        except ValueError as exc:
                            missing_by_source[source_id] += 1
                            invalid_enrichment.append({
                                "source_id": source_id,
                                "en": str(entry.get("en") or ""),
                                "reason": str(exc),
                            })
                except Exception as exc:  # noqa: BLE001 - retry failure should not discard first-pass enrichments
                    missing_by_source[source_id] += len(missing_entries)
                    failed.append({"source_id": source_id, "error": f"ungrounded retry: {exc}"})
                    append_log(root, f"W1 enrich retry error source_id={source_id} error={exc}")
        except Exception as exc:  # noqa: BLE001 - stage is resumable, report per-source failures
            failed.append({"source_id": source_id, "error": str(exc)})
            append_log(root, f"W1 enrich error source_id={source_id} error={exc}")

    enriched_entries = [
        enriched_by_id.get(id(entry), by_identity[id(entry)])
        for entry in entries
        if isinstance(entry, dict) and id(entry) in by_identity
    ]
    staged_bank = {
        "updatedAt": now,
        "source": bank.get("source", "ppalmo-distill-v1") if isinstance(bank, dict) else "ppalmo-distill-v1",
        "entries": enriched_entries,
    }
    report = {
        "sources_scanned": len(source_ids),
        "entries_total": len(enriched_entries),
        "entries_enriched": len(enriched_by_id),
        "ungrounded_retries": ungrounded_retries,
        "missing_enrichment_by_source": dict(sorted(missing_by_source.items())),
        "invalid_enrichment": invalid_enrichment[:20],
        "failed": failed,
        "input": str(bank_path),
        "staging": str(root / "expression-bank.staging.json"),
    }
    return staged_bank, report


def run(
    root: Path,
    transcript_dir: Path | None = None,
    provider: EnrichProvider | None = None,
    limit: int | None = None,
    write_staging: bool = False,
    force: bool = False,
) -> dict[str, Any]:
    staged_bank, report = enrich_bank(root, transcript_dir=transcript_dir, provider=provider, limit=limit, force=force)
    if write_staging:
        backup = backup_expression_bank(root)
        write_json_atomic(root / "expression-bank.staging.json", staged_bank)
        report["backup"] = str(backup) if backup else None
        report["written"] = True
    else:
        report["written"] = False
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="W1 enrich existing ppalmo expression bank into staging.")
    parser.add_argument("--root", type=Path, default=default_root())
    parser.add_argument("--transcripts", type=Path)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--write-staging", action="store_true", help="write expression-bank.staging.json; live bank is never swapped")
    args = parser.parse_args()
    report = run(
        args.root,
        transcript_dir=args.transcripts,
        limit=args.limit,
        write_staging=args.write_staging,
        force=args.force,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
