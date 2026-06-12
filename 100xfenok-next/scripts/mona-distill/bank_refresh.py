"""Ppalmo expression-bank refresher (D5, BACKLOG #314).

Two modes sharing one extraction core:
  --from-transcripts DIR   backfill from local transcript .txt files
  --channel-new            monthly: newest channel uploads -> transcripts -> extract

Zero-maintenance design: processed video ids live in _bank_state.json next to the
bank; every entry passes a schema/2-gate filter and en-dedupe before append.
LLM extraction rides the existing free chain adapters (gemini flash-lite first,
gpt-5.4-mini fallback); videos without transcripts fall back to Gemini video
analysis (does not touch YouTube transcript endpoints, so it survives IP blocks).
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterator

from chains import _ensure_aa_path, call_gemini_flash_lite, make_gpt_adapter, strip_code_fence
from distill_engine import read_json, write_json_atomic
from enrich import LLM_SLEEP_LADDER_S, add_entry_enrichment, backup_expression_bank, default_transcript_dir, read_transcript_text, utc_iso
from gates import apply_source_verification
from worker import default_root

CHANNEL_VIDEOS_URL = "https://www.youtube.com/channel/UCGDA1e6qQSAH0R9hoip9VrA/videos"
ALLOWED_THEMES = {"work", "family-friends", "selftalk-emotion", "out-shopping-dining", "work-advanced", "free"}
EXCLUDE_TITLE = re.compile(r"멤버십|members only", re.IGNORECASE)
TRANSCRIPT_SLEEP_S = 12.0
MAX_ENTRIES_PER_VIDEO = 8
BANK_CAP = 1200
THEME_TARGETS = {
    "family-friends": 150,
    "out-shopping-dining": 120,
    "work": 100,
    "selftalk-emotion": 250,
    "free": 250,
    "work-advanced": 80,
}
DONE_STATUSES = {"extracted", "zero-yield"}

EXTRACT_SYSTEM = "너는 영어회화 강의에서 학습 표현을 추출하는 분석기다. 출력은 JSON 배열 하나만."

EXTRACT_RULES = "\n".join([
    "규칙:",
    "1. 강사가 실제로 가르친 표현만. 원어민이 실제 회화에서 정말 자주 쓰는 표현만 채택 (교과서식/옛날 표현 제외).",
    "2. 초중급 학습자가 일상에서 재사용할 수 있는 짧은 표현 우선 (en은 12단어 이하).",
    f"3. 최대 {MAX_ENTRIES_PER_VIDEO}개. 좋은 게 없으면 빈 배열 [].",
    "4. theme은 다음 중 하나로 분류: work(회사·업무) | family-friends(가족·친구) | selftalk-emotion(혼잣말·감정) | out-shopping-dining(외출·쇼핑·식당) | work-advanced(업무 심화) | free(범용).",
    '5. 출력 스키마: [{"ko":"한국어 의미","en":"영어 표현","note":"발음/뉘앙스 힌트 한 줄(없으면 null)","theme":"...","register":"casual|neutral"}]',
])

EXTRACT_ENRICHED_RULES = "\n".join([
    "규칙:",
    "1. 강사가 실제로 가르친 표현만. 원어민이 실제 회화에서 정말 자주 쓰는 표현만 채택.",
    "2. 초중급 학습자가 일상에서 재사용할 수 있는 표현 우선 (en은 12단어 이하).",
    "3. 좋은 표현은 모두 추출한다. 테마별 cap이나 조기 중단 금지.",
    "4. theme은 다음 중 하나: work | family-friends | selftalk-emotion | out-shopping-dining | work-advanced | free.",
    "5. difficulty: 1=쉬운 일상/구체/<=6단어, 2=중간/<=10단어 또는 phrasal verb, 3=추상/idiom/business/어려운 문법. 애매하면 높게.",
    "6. variations는 정확히 2개, kind는 negation/past/question/subject 중 하나.",
    "7. difficulty 3이면 sibling은 더 쉬운 대체문장으로 반드시 제공.",
    '8. 출력 스키마: [{"ko":"...","en":"...","note":null,"theme":"...","register":"casual|neutral","difficulty":1,"pattern":"<=40 chars","variations":[{"kind":"question","ko":"...","en":"..."}],"sibling":{"ko":"...","en":"..."}|null}]',
])

TranscriptProvider = Callable[[str, str], str]


def extract_from_transcript(text: str) -> str:
    prompt = f"다음 한국어 영어회화 강의 자막에서 학습 표현을 추출해라.\n\n{EXTRACT_RULES}\n\n[자막]\n{text[:12000]}"
    try:
        return call_gemini_flash_lite(EXTRACT_SYSTEM, prompt)
    except Exception:
        return make_gpt_adapter("gpt-5.4-mini")(EXTRACT_SYSTEM, prompt)


def extract_from_video(video_id: str) -> str:
    """Gemini watches the video directly — fallback when transcripts are unavailable."""
    _ensure_aa_path()
    from _gemini_api import call_gemini

    payload = {
        "contents": [{"parts": [
            {"fileData": {"mimeType": "video/*", "fileUri": f"https://www.youtube.com/watch?v={video_id}"}},
            {"text": f"이 한국어 영어회화 강의에서 학습 표현을 추출해라.\n\n{EXTRACT_RULES}"},
        ]}],
        "generationConfig": {"responseMimeType": "application/json"},
    }
    result = call_gemini("gemini-3.1-flash-lite", payload)
    if not result.success or not result.text.strip():
        raise RuntimeError(f"gemini video: {result.error or 'empty'}")
    return result.text


def extract_enriched_from_transcript(text: str) -> str:
    prompt = f"다음 한국어 영어회화 강의 자막에서 학습 표현을 풀증류해라.\n\n{EXTRACT_ENRICHED_RULES}\n\n[자막]\n{text[:16000]}"
    errors: list[str] = []
    for name, adapter in [
        ("gemini-3.1-flash-lite", call_gemini_flash_lite),
        ("gpt-5.4-mini", make_gpt_adapter("gpt-5.4-mini")),
    ]:
        for sleep_s in (0.0, *LLM_SLEEP_LADDER_S):
            if sleep_s:
                time.sleep(sleep_s)
            try:
                return adapter(EXTRACT_SYSTEM, prompt)
            except Exception as exc:  # noqa: BLE001 - free-chain fallback ladder
                message = str(exc)
                errors.append(f"{name}: {message}")
                if "429" not in message and "rate" not in message.lower():
                    break
    raise RuntimeError(" | ".join(errors) or "enriched extraction chain exhausted")


def normalize_en(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def gate_entry(
    raw: Any,
    source_id: str,
    seen_en: set[str],
    enrich: bool = False,
    extracted_at: str | None = None,
    reject_stats: dict[str, int] | None = None,
) -> dict[str, Any] | None:
    """Schema + sanity gate for one candidate expression. Pure function."""
    if not isinstance(raw, dict):
        return None
    ko = str(raw.get("ko") or "").strip()
    en = str(raw.get("en") or "").strip()
    theme = str(raw.get("theme") or "").strip()
    register = raw.get("register") if raw.get("register") in ("casual", "neutral") else "neutral"
    note_raw = raw.get("note")
    note = note_raw.strip() if isinstance(note_raw, str) and note_raw.strip() else None
    if not ko or not en or len(ko) > 80 or len(en) > 120:
        return None
    if not re.search(r"[가-힣]", ko) or not re.search(r"[A-Za-z]", en):
        return None
    if len(en.split()) > 12:
        return None
    if theme not in ALLOWED_THEMES:
        theme = "free"
    key = normalize_en(en)
    if key in seen_en:
        return None
    entry = {
        "ko": ko,
        "en": en,
        "note": note[:60] if note else None,
        "theme": theme,
        "register": register,
        "source_id": source_id,
        "addedAt": extracted_at or datetime.now(timezone.utc).isoformat(),
    }
    if enrich:
        try:
            entry = add_entry_enrichment(entry, raw, grounded=True, now=extracted_at or utc_iso())
            entry["extractedAt"] = extracted_at or utc_iso()
        except ValueError:
            if reject_stats is not None:
                reject_stats["enrichment_rejected"] = reject_stats.get("enrichment_rejected", 0) + 1
            return None
    seen_en.add(key)
    return entry


def parse_entries(
    raw_text: str,
    source_id: str,
    seen_en: set[str],
    enrich: bool = False,
    max_entries: int | None = MAX_ENTRIES_PER_VIDEO,
    extracted_at: str | None = None,
    reject_stats: dict[str, int] | None = None,
) -> list[dict[str, Any]]:
    try:
        parsed = json.loads(strip_code_fence(raw_text))
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    window = parsed if max_entries is None else parsed[:max_entries]
    gated = (
        gate_entry(item, source_id, seen_en, enrich=enrich, extracted_at=extracted_at, reject_stats=reject_stats)
        for item in window
    )
    return [entry for entry in gated if entry]


def fetch_transcript_text(video_id: str) -> str:
    from youtube_transcript_api import YouTubeTranscriptApi

    transcript = YouTubeTranscriptApi().fetch(video_id, languages=["ko", "en"])
    return " ".join(snippet.text for snippet in transcript.snippets)


def list_new_channel_videos(limit: int) -> list[tuple[str, str]]:
    out = subprocess.run(
        ["yt-dlp", "--flat-playlist", "--playlist-items", f"1:{limit}",
         "--print", "%(id)s|%(title)s", CHANNEL_VIDEOS_URL],
        capture_output=True, text=True, timeout=120,
    )
    videos = []
    for line in out.stdout.splitlines():
        if "|" not in line:
            continue
        vid, title = line.split("|", 1)
        if not EXCLUDE_TITLE.search(title):
            videos.append((vid.strip(), title.strip()))
    return videos


def load_state(root: Path) -> dict[str, Any]:
    state = read_json(root / "_bank_state.json", {})
    return state if isinstance(state, dict) else {}


def distillate_dir(root: Path) -> Path:
    return root / "distillate"


def coverage_path(root: Path) -> Path:
    return distillate_dir(root) / "_coverage.json"


def load_coverage(root: Path) -> dict[str, Any]:
    coverage = read_json(coverage_path(root), {})
    if not isinstance(coverage, dict):
        coverage = {}
    coverage.setdefault("expressions", {})
    coverage.setdefault("teaching", {})
    return coverage


def write_coverage(root: Path, coverage: dict[str, Any]) -> None:
    coverage["updatedAt"] = utc_iso()
    write_json_atomic(coverage_path(root), coverage)


def append_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    if not records:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    if not path.exists():
        return records
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        parsed = json.loads(line)
        if isinstance(parsed, dict):
            records.append(parsed)
    return records


def list_transcript_sources(transcript_dir: Path) -> Iterator[tuple[str, str]]:
    for path in sorted(transcript_dir.glob("*.txt")):
        yield path.stem, read_transcript_text(path)


def read_source_transcript(transcript_dir: Path, source_id: Any, cache: dict[str, str | None]) -> str | None:
    if not isinstance(source_id, str) or not source_id.strip():
        return None
    if source_id not in cache:
        path = transcript_dir / f"{source_id}.txt"
        cache[source_id] = read_transcript_text(path) if path.exists() else None
    return cache[source_id]


def run_full_distillate(
    root: Path,
    transcript_dir: Path | None = None,
    provider: TranscriptProvider | None = None,
    limit: int | None = None,
    write: bool = False,
    sleep_s: float = 0.0,
) -> dict[str, Any]:
    """W2 Stage A: visit every transcript and append enriched records to full JSONL."""
    root = root.resolve()
    transcript_dir = transcript_dir or default_transcript_dir(root)
    coverage = load_coverage(root)
    lane = coverage.setdefault("expressions", {})
    report = {"visited": 0, "skipped": 0, "extracted": 0, "zero_yield": 0, "errors": 0, "enrichment_rejected": 0, "written": write}
    effective_limit = limit if limit and limit > 0 else None

    for index, (video_id, transcript) in enumerate(list_transcript_sources(transcript_dir)):
        if effective_limit is not None and index >= effective_limit:
            break
        current = lane.get(video_id)
        if isinstance(current, dict) and current.get("status") in DONE_STATUSES:
            report["skipped"] += 1
            continue
        report["visited"] += 1
        now = utc_iso()
        try:
            raw = provider(video_id, transcript) if provider else extract_enriched_from_transcript(transcript)
            seen_for_video: set[str] = set()
            reject_stats = {"enrichment_rejected": 0}
            entries = parse_entries(
                raw,
                video_id,
                seen_for_video,
                enrich=True,
                max_entries=None,
                extracted_at=now,
                reject_stats=reject_stats,
            )
            report["enrichment_rejected"] += reject_stats["enrichment_rejected"]
            for entry in entries:
                entry["source_id"] = video_id
                entry["extractedAt"] = now
            status = "extracted" if entries else "zero-yield"
            report["extracted" if entries else "zero_yield"] += 1
            if write:
                append_jsonl(distillate_dir(root) / "expressions-full.jsonl", entries)
                lane[video_id] = {"status": status, "count": len(entries), "rejected": reject_stats["enrichment_rejected"], "updatedAt": now}
                write_coverage(root, coverage)
            if sleep_s:
                time.sleep(sleep_s)
        except Exception as exc:  # noqa: BLE001 - coverage ledger records resumable failures
            report["errors"] += 1
            if write:
                lane[video_id] = {"status": "error", "count": 0, "error": str(exc), "updatedAt": now}
                write_coverage(root, coverage)
    return report


def _theme_counts(entries: list[dict[str, Any]]) -> dict[str, int]:
    counts = {theme: 0 for theme in THEME_TARGETS}
    for entry in entries:
        theme = entry.get("theme")
        if theme in counts:
            counts[str(theme)] += 1
    return counts


def curate_bank_from_distillate(
    root: Path,
    write_staging: bool = False,
    transcript_dir: Path | None = None,
) -> dict[str, Any]:
    """W2 Stage B: deterministic, LLM-free curation from full distillate into staging bank."""
    root = root.resolve()
    transcript_dir = transcript_dir or default_transcript_dir(root)
    base_path = root / "expression-bank.staging.json" if (root / "expression-bank.staging.json").exists() else root / "expression-bank.json"
    bank = read_json(base_path, {})
    existing = bank.get("entries", []) if isinstance(bank, dict) else []
    if not isinstance(existing, list):
        raise ValueError("expression-bank entries must be a list")
    transcript_cache: dict[str, str | None] = {}
    curated = [
        apply_source_verification(entry, read_source_transcript(transcript_dir, entry.get("source_id"), transcript_cache))
        for entry in existing
        if isinstance(entry, dict)
    ]
    seen_en = {normalize_en(str(entry.get("en", ""))) for entry in curated}
    counts = _theme_counts(curated)
    records = read_jsonl(distillate_dir(root) / "expressions-full.jsonl")
    records = [
        dict(record, verifiedInSource=True)
        for record in records
    ]
    records.sort(key=lambda item: (
        int(item.get("difficulty", 3)) if item.get("difficulty") in (1, 2, 3) else 3,
        int(item.get("word_count", 99)) if isinstance(item.get("word_count"), int) else 99,
        item.get("verifiedInSource") is not True,
        str(item.get("source_id") or ""),
        str(item.get("en") or ""),
    ))
    added = 0
    for record in records:
        if len(curated) >= BANK_CAP:
            break
        theme = record.get("theme")
        key = normalize_en(str(record.get("en", "")))
        if not key or key in seen_en or theme not in THEME_TARGETS:
            continue
        if counts[theme] >= THEME_TARGETS[theme]:
            continue
        curated.append(record)
        seen_en.add(key)
        counts[theme] += 1
        added += 1

    staged = {
        "updatedAt": utc_iso(),
        "source": bank.get("source", "ppalmo-distill-v1") if isinstance(bank, dict) else "ppalmo-distill-v1",
        "entries": curated[:BANK_CAP],
    }
    report = {"base": str(base_path), "records": len(records), "added": added, "bank_total": len(staged["entries"]), "written": write_staging}
    if write_staging:
        backup = backup_expression_bank(root)
        write_json_atomic(root / "expression-bank.staging.json", staged)
        report["backup"] = str(backup) if backup else None
    return report


def run(
    root: Path,
    sources: list[tuple[str, str | None]],
    use_video_fallback: bool,
    dry_run: bool,
    enrich: bool = False,
    write_staging: bool = False,
) -> dict[str, Any]:
    """sources: list of (video_id, transcript_text_or_None)."""
    bank_path = root / "expression-bank.json"
    bank = read_json(bank_path, {})
    entries = bank.get("entries", []) if isinstance(bank, dict) else []
    state = load_state(root)
    processed: list[str] = list(state.get("processed", []))
    seen_ids = set(processed) | {e.get("source_id") for e in entries if isinstance(e, dict)}
    seen_en = {normalize_en(str(e.get("en", ""))) for e in entries if isinstance(e, dict)}

    added, scanned, failed, enrichment_rejected = [], 0, 0, 0
    for video_id, transcript in sources:
        if video_id in seen_ids:
            continue
        scanned += 1
        try:
            if transcript is None:
                try:
                    transcript = fetch_transcript_text(video_id)
                    time.sleep(TRANSCRIPT_SLEEP_S)
                except Exception:
                    transcript = ""
            raw = (extract_enriched_from_transcript(transcript) if enrich else extract_from_transcript(transcript)) if transcript.strip() else (
                extract_from_video(video_id) if use_video_fallback else ""
            )
            reject_stats = {"enrichment_rejected": 0}
            new_entries = parse_entries(raw, video_id, seen_en, enrich=enrich, extracted_at=utc_iso(), reject_stats=reject_stats) if raw else []
            enrichment_rejected += reject_stats["enrichment_rejected"]
            added.extend(new_entries)
            processed.append(video_id)
        except Exception as exc:
            failed += 1
            print(f"[bank-refresh] {video_id} failed: {exc}", flush=True)

    report = {"scanned": scanned, "added": len(added), "failed": failed, "enrichment_rejected": enrichment_rejected, "bank_total": len(entries) + len(added)}
    if dry_run or not added:
        return report | {"dry_run": dry_run}

    merged = (entries + added)[:BANK_CAP]
    output_path = root / "expression-bank.staging.json" if write_staging else bank_path
    if write_staging:
        backup_expression_bank(root)
    write_json_atomic(output_path, {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "source": bank.get("source", "ppalmo-distill-v1") if isinstance(bank, dict) else "ppalmo-distill-v1",
        "entries": merged,
    })
    state_path = root / "_bank_state.staging.json" if write_staging else root / "_bank_state.json"
    write_json_atomic(state_path, {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "processed": processed[-2000:],
    })
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Refresh ppalmo expression bank.")
    parser.add_argument("--root", type=Path, default=default_root())
    parser.add_argument("--from-transcripts", type=Path, help="dir of transcript .txt files (backfill)")
    parser.add_argument("--channel-new", action="store_true", help="monthly: newest channel uploads")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--no-video-fallback", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--enrich", action="store_true", help="legacy backfill plus enrichment fields")
    parser.add_argument("--write-staging", action="store_true", help="write expression-bank.staging.json instead of live bank")
    parser.add_argument("--full-distillate", action="store_true", help="W2 Stage A: visit every transcript and append expressions-full.jsonl")
    parser.add_argument("--write-distillate", action="store_true", help="allow W2 Stage A writes to distillate JSONL and coverage")
    parser.add_argument("--curate-bank", action="store_true", help="W2 Stage B: deterministic curation from full distillate into staging bank")
    parser.add_argument("--sleep", type=float, default=0.0, help="optional delay between LLM transcript calls")
    args = parser.parse_args(argv)

    if args.full_distillate:
        transcript_dir = args.from_transcripts or default_transcript_dir(args.root)
        report = run_full_distillate(args.root.resolve(), transcript_dir=transcript_dir, limit=args.limit, write=args.write_distillate, sleep_s=args.sleep)
        print(json.dumps(report, ensure_ascii=False))
        return 0

    if args.curate_bank:
        report = curate_bank_from_distillate(
            args.root.resolve(),
            write_staging=args.write_staging,
            transcript_dir=args.from_transcripts or default_transcript_dir(args.root),
        )
        print(json.dumps(report, ensure_ascii=False))
        return 0

    if args.enrich and not args.write_staging and not args.dry_run:
        parser.error("--enrich writes require --write-staging or --dry-run")

    sources: list[tuple[str, str | None]] = []
    limit = args.limit if args.limit is not None else 30
    if args.from_transcripts:
        for f in sorted(args.from_transcripts.glob("*.txt"))[: limit or None]:
            sources.append((f.stem, f.read_text(encoding="utf-8")))
    elif args.channel_new:
        sources = [(vid, None) for vid, _title in list_new_channel_videos(limit)]
    else:
        parser.error("choose --from-transcripts DIR or --channel-new")

    report = run(args.root.resolve(), sources, not args.no_video_fallback, args.dry_run, enrich=args.enrich, write_staging=args.write_staging)
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
