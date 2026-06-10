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
from typing import Any

from chains import _ensure_aa_path, call_gemini_flash_lite, make_gpt_adapter, strip_code_fence
from distill_engine import read_json, write_json_atomic
from worker import default_root

CHANNEL_VIDEOS_URL = "https://www.youtube.com/channel/UCGDA1e6qQSAH0R9hoip9VrA/videos"
ALLOWED_THEMES = {"work", "family-friends", "selftalk-emotion", "out-shopping-dining", "work-advanced", "free"}
EXCLUDE_TITLE = re.compile(r"멤버십|members only", re.IGNORECASE)
TRANSCRIPT_SLEEP_S = 12.0
MAX_ENTRIES_PER_VIDEO = 8
BANK_CAP = 500

EXTRACT_SYSTEM = "너는 영어회화 강의에서 학습 표현을 추출하는 분석기다. 출력은 JSON 배열 하나만."

EXTRACT_RULES = "\n".join([
    "규칙:",
    "1. 강사가 실제로 가르친 표현만. 원어민이 실제 회화에서 정말 자주 쓰는 표현만 채택 (교과서식/옛날 표현 제외).",
    "2. 초중급 학습자가 일상에서 재사용할 수 있는 짧은 표현 우선 (en은 12단어 이하).",
    f"3. 최대 {MAX_ENTRIES_PER_VIDEO}개. 좋은 게 없으면 빈 배열 [].",
    "4. theme은 다음 중 하나로 분류: work(회사·업무) | family-friends(가족·친구) | selftalk-emotion(혼잣말·감정) | out-shopping-dining(외출·쇼핑·식당) | work-advanced(업무 심화) | free(범용).",
    '5. 출력 스키마: [{"ko":"한국어 의미","en":"영어 표현","note":"발음/뉘앙스 힌트 한 줄(없으면 null)","theme":"...","register":"casual|neutral"}]',
])


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


def normalize_en(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def gate_entry(raw: Any, source_id: str, seen_en: set[str]) -> dict[str, Any] | None:
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
    seen_en.add(key)
    return {
        "ko": ko,
        "en": en,
        "note": note[:60] if note else None,
        "theme": theme,
        "register": register,
        "source_id": source_id,
        "addedAt": datetime.now(timezone.utc).isoformat(),
    }


def parse_entries(raw_text: str, source_id: str, seen_en: set[str]) -> list[dict[str, Any]]:
    try:
        parsed = json.loads(strip_code_fence(raw_text))
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    gated = (gate_entry(item, source_id, seen_en) for item in parsed[:MAX_ENTRIES_PER_VIDEO])
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


def run(root: Path, sources: list[tuple[str, str | None]], use_video_fallback: bool, dry_run: bool) -> dict[str, Any]:
    """sources: list of (video_id, transcript_text_or_None)."""
    bank_path = root / "expression-bank.json"
    bank = read_json(bank_path, {})
    entries = bank.get("entries", []) if isinstance(bank, dict) else []
    state = load_state(root)
    processed: list[str] = list(state.get("processed", []))
    seen_ids = set(processed) | {e.get("source_id") for e in entries if isinstance(e, dict)}
    seen_en = {normalize_en(str(e.get("en", ""))) for e in entries if isinstance(e, dict)}

    added, scanned, failed = [], 0, 0
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
            raw = extract_from_transcript(transcript) if transcript.strip() else (
                extract_from_video(video_id) if use_video_fallback else ""
            )
            new_entries = parse_entries(raw, video_id, seen_en) if raw else []
            added.extend(new_entries)
            processed.append(video_id)
        except Exception as exc:
            failed += 1
            print(f"[bank-refresh] {video_id} failed: {exc}", flush=True)

    report = {"scanned": scanned, "added": len(added), "failed": failed, "bank_total": len(entries) + len(added)}
    if dry_run or not added:
        return report | {"dry_run": dry_run}

    merged = (entries + added)[:BANK_CAP]
    write_json_atomic(bank_path, {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "source": bank.get("source", "ppalmo-distill-v1") if isinstance(bank, dict) else "ppalmo-distill-v1",
        "entries": merged,
    })
    write_json_atomic(root / "_bank_state.json", {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "processed": processed[-2000:],
    })
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh ppalmo expression bank.")
    parser.add_argument("--root", type=Path, default=default_root())
    parser.add_argument("--from-transcripts", type=Path, help="dir of transcript .txt files (backfill)")
    parser.add_argument("--channel-new", action="store_true", help="monthly: newest channel uploads")
    parser.add_argument("--limit", type=int, default=30)
    parser.add_argument("--no-video-fallback", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    sources: list[tuple[str, str | None]] = []
    if args.from_transcripts:
        for f in sorted(args.from_transcripts.glob("*.txt"))[: args.limit or None]:
            sources.append((f.stem, f.read_text(encoding="utf-8")))
    elif args.channel_new:
        sources = [(vid, None) for vid, _title in list_new_channel_videos(args.limit)]
    else:
        parser.error("choose --from-transcripts DIR or --channel-new")

    report = run(args.root.resolve(), sources, not args.no_video_fallback, args.dry_run)
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
