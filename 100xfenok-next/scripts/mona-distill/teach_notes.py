"""W3 full-corpus teaching-method notes map/reduce.

Usage:
  python teach_notes.py --root data/mona-english --map --transcripts /path/to/transcripts
  python teach_notes.py --root data/mona-english --reduce --write-notes

Map writes append-only distillate/teaching-obs.jsonl and the teaching lane in
distillate/_coverage.json only when --write-map is supplied. Reduce renders a
human-readable ppalmo-teaching-notes.md and writes it only with --write-notes.
"""
from __future__ import annotations

import argparse
import json
import re
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Callable

from bank_refresh import append_jsonl, distillate_dir, list_transcript_sources, load_coverage, read_jsonl, write_coverage
from chains import call_gemini_flash_lite, make_gpt_adapter, strip_code_fence
from distill_engine import write_text_atomic
from enrich import LLM_SLEEP_LADDER_S, default_transcript_dir, utc_iso
from worker import default_root

TEACH_SYSTEM = "너는 영어회화 강사의 교수법을 관찰하는 분석기다. 출력은 JSON 객체 하나만."
TEACH_SECTIONS = ("correction_style", "nuance_framing", "drilling_habits", "encouragement_style", "contrast_patterns")
SECTION_TITLES = {
    "correction_style": "Correction Style",
    "nuance_framing": "Nuance Framing",
    "drilling_habits": "Repetition And Drilling",
    "encouragement_style": "Encouragement Style",
    "contrast_patterns": "Contrast Patterns",
}
CLUSTER_CHUNK_SIZE = 400
MIN_CLUSTERS_PER_SECTION = 5
MAX_CLUSTERS_PER_SECTION = 12
MAX_NOTE_LINES = 270
TeachProvider = Callable[[str, str], str]
ClusterProvider = Callable[[str, list[dict[str, Any]], bool], str]


def build_teach_prompt(video_id: str, transcript: str) -> str:
    schema = {
        "videoId": video_id,
        "observations": {
            section: ["short Korean observation with concrete teaching behavior"]
            for section in TEACH_SECTIONS
        },
    }
    return "\n".join(
        [
            "다음 빨모쌤 강의 transcript에서 교수법 관찰만 추출해라.",
            "표현 자체가 아니라 correction style, 느낌 설명, 반복 드릴, 격려, 유사표현 대비 방식을 본다.",
            "각 관찰은 짧은 한국어 문장. transcript에 근거가 없으면 빈 배열.",
            "출력은 JSON 객체 하나만.",
            "",
            "[schema]",
            json.dumps(schema, ensure_ascii=False, indent=2),
            "",
            "[transcript]",
            transcript[:16000],
        ]
    )


def call_teach_chain(video_id: str, transcript: str) -> str:
    prompt = build_teach_prompt(video_id, transcript)
    errors: list[str] = []
    for name, adapter in [
        ("gemini-3.1-flash-lite", call_gemini_flash_lite),
        ("gpt-5.4-mini", make_gpt_adapter("gpt-5.4-mini")),
    ]:
        for sleep_s in (0.0, *LLM_SLEEP_LADDER_S):
            if sleep_s:
                time.sleep(sleep_s)
            try:
                return adapter(TEACH_SYSTEM, prompt)
            except Exception as exc:  # noqa: BLE001 - free-chain fallback ladder
                message = str(exc)
                errors.append(f"{name}: {message}")
                if "429" not in message and "rate" not in message.lower():
                    break
    raise RuntimeError(" | ".join(errors) or f"{video_id}: teaching chain exhausted")


def build_cluster_prompt(section: str, items: list[dict[str, Any]], merge: bool = False) -> str:
    schema = {
        "clusters": [
            {
                "pattern": "한 줄 한국어 교수법 패턴",
                "video_count": 12,
                "example_video_ids": ["realVideoId1", "realVideoId2"],
            }
        ]
    }
    mode = "merge clustered patterns" if merge else "cluster exact-deduped observations"
    payload = [
        {
            "text": str(item.get("text") or ""),
            "video_count": int(item.get("video_count") or len(item.get("video_ids", []))),
            "video_ids": item.get("video_ids", []),
        }
        for item in items
    ]
    return "\n".join(
        [
            f"Task: {mode} for 빨모쌤 teaching-method section `{section}`.",
            "Group semantically equivalent teaching observations into method-level clusters.",
            "Do not sample alphabetically. Synthesize the recurring teaching behavior.",
            "Return 5-12 clusters when the input is large enough.",
            "Use only video ids present in the input. example_video_ids must be <=6 real ids.",
            "Output JSON only.",
            "",
            "[schema]",
            json.dumps(schema, ensure_ascii=False, indent=2),
            "",
            "[input]",
            json.dumps(payload, ensure_ascii=False, indent=2),
        ]
    )


def call_cluster_chain(section: str, items: list[dict[str, Any]], merge: bool = False) -> str:
    prompt = build_cluster_prompt(section, items, merge=merge)
    errors: list[str] = []
    for name, adapter in [
        ("gemini-3.1-flash-lite", call_gemini_flash_lite),
        ("gpt-5.4-mini", make_gpt_adapter("gpt-5.4-mini")),
    ]:
        for sleep_s in (0.0, *LLM_SLEEP_LADDER_S):
            if sleep_s:
                time.sleep(sleep_s)
            try:
                return adapter(TEACH_SYSTEM, prompt)
            except Exception as exc:  # noqa: BLE001 - free-chain fallback ladder
                message = str(exc)
                errors.append(f"{name}: {message}")
                if "429" not in message and "rate" not in message.lower():
                    break
    raise RuntimeError(" | ".join(errors) or f"{section}: clustering chain exhausted")


def _clean_observation(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = re.sub(r"\s+", " ", value.strip())
    return cleaned[:220] if cleaned else None


def parse_teaching_observation(raw_text: str, video_id: str, observed_at: str | None = None) -> dict[str, Any] | None:
    try:
        parsed = json.loads(strip_code_fence(raw_text))
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict):
        return None
    observations_raw = parsed.get("observations", parsed)
    if not isinstance(observations_raw, dict):
        return None
    observations: dict[str, list[str]] = {}
    total = 0
    for section in TEACH_SECTIONS:
        values = observations_raw.get(section, [])
        if not isinstance(values, list):
            values = [values]
        cleaned = [
            item
            for item in (_clean_observation(value) for value in values)
            if item
        ][:8]
        observations[section] = cleaned
        total += len(cleaned)
    if total == 0:
        return None
    return {
        "videoId": video_id,
        "observedAt": observed_at or utc_iso(),
        "observations": observations,
    }


def run_map(
    root: Path,
    transcript_dir: Path | None = None,
    provider: TeachProvider | None = None,
    limit: int | None = None,
    write: bool = False,
    sleep_s: float = 0.0,
) -> dict[str, Any]:
    root = root.resolve()
    transcript_dir = transcript_dir or default_transcript_dir(root)
    coverage = load_coverage(root)
    lane = coverage.setdefault("teaching", {})
    report = {"visited": 0, "skipped": 0, "observed": 0, "zero_yield": 0, "errors": 0, "written": write}

    for index, (video_id, transcript) in enumerate(list_transcript_sources(transcript_dir)):
        if limit is not None and index >= limit:
            break
        current = lane.get(video_id)
        if isinstance(current, dict) and current.get("status") in {"observed", "zero-yield"}:
            report["skipped"] += 1
            continue
        report["visited"] += 1
        now = utc_iso()
        try:
            raw = provider(video_id, transcript) if provider else call_teach_chain(video_id, transcript)
            record = parse_teaching_observation(raw, video_id, observed_at=now)
            status = "observed" if record else "zero-yield"
            report["observed" if record else "zero_yield"] += 1
            if write:
                if record:
                    append_jsonl(distillate_dir(root) / "teaching-obs.jsonl", [record])
                lane[video_id] = {"status": status, "count": 1 if record else 0, "updatedAt": now}
                write_coverage(root, coverage)
            if sleep_s:
                time.sleep(sleep_s)
        except Exception as exc:  # noqa: BLE001 - resumable lane records failures
            report["errors"] += 1
            if write:
                lane[video_id] = {"status": "error", "count": 0, "error": str(exc), "updatedAt": now}
                write_coverage(root, coverage)
    return report


def default_notes_path(root: Path) -> Path:
    resolved = root.resolve()
    mona_life_root = resolved.parents[1]
    return mona_life_root / "docs" / "english" / "ppalmo-teaching-notes.md"


def aggregate_observation_items(records: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    citations: dict[tuple[str, str], set[str]] = defaultdict(set)
    counts: Counter[tuple[str, str]] = Counter()
    for record in records:
        video_id = str(record.get("videoId") or "")
        observations = record.get("observations")
        if not video_id or not isinstance(observations, dict):
            continue
        for section in TEACH_SECTIONS:
            values = observations.get(section, [])
            if not isinstance(values, list):
                continue
            for value in values:
                cleaned = _clean_observation(value)
                if not cleaned:
                    continue
                key = (section, cleaned)
                counts[key] += 1
                citations[key].add(video_id)

    by_section: dict[str, list[dict[str, Any]]] = {section: [] for section in TEACH_SECTIONS}
    for (section, text), count in counts.items():
        refs = sorted(citations[(section, text)])
        by_section[section].append({
            "text": text,
            "exact_count": count,
            "video_count": len(refs),
            "video_ids": refs,
        })
    for section in TEACH_SECTIONS:
        by_section[section].sort(key=lambda item: (-int(item["video_count"]), str(item["text"])))
    return by_section


def _chunks(items: list[dict[str, Any]], size: int) -> list[list[dict[str, Any]]]:
    return [items[index:index + size] for index in range(0, len(items), size)]


def _allowed_video_ids(items: list[dict[str, Any]]) -> set[str]:
    allowed: set[str] = set()
    for item in items:
        video_ids = item.get("video_ids", [])
        if isinstance(video_ids, list):
            allowed.update(str(video_id) for video_id in video_ids if isinstance(video_id, str) and video_id)
    return allowed


def _parse_video_count(value: Any, fallback: int) -> int:
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return fallback


def parse_clusters(raw_text: str, allowed_video_ids: set[str]) -> list[dict[str, Any]]:
    try:
        parsed = json.loads(strip_code_fence(raw_text))
    except json.JSONDecodeError:
        return []
    clusters_raw = parsed.get("clusters", parsed) if isinstance(parsed, dict) else parsed
    if not isinstance(clusters_raw, list):
        return []

    clusters: list[dict[str, Any]] = []
    for raw in clusters_raw:
        if not isinstance(raw, dict):
            continue
        pattern = _clean_observation(raw.get("pattern"))
        ids_raw = raw.get("example_video_ids", [])
        if not pattern or not isinstance(ids_raw, list):
            continue
        ids = [str(video_id) for video_id in ids_raw if isinstance(video_id, str) and video_id]
        if not ids or any(video_id not in allowed_video_ids for video_id in ids):
            continue
        unique_ids = sorted(dict.fromkeys(ids))[:6]
        video_count = _parse_video_count(raw.get("video_count"), len(unique_ids))
        video_count = min(max(video_count, len(unique_ids)), max(len(allowed_video_ids), len(unique_ids)))
        clusters.append({
            "pattern": pattern,
            "video_count": video_count,
            "example_video_ids": unique_ids,
        })
    return clusters


def exact_fallback_clusters(items: list[dict[str, Any]], limit: int = MAX_CLUSTERS_PER_SECTION) -> list[dict[str, Any]]:
    clusters = []
    for item in items[:limit]:
        refs = item.get("video_ids", [])
        if not isinstance(refs, list):
            refs = []
        real_refs = [str(ref) for ref in refs if isinstance(ref, str) and ref]
        text = _clean_observation(item.get("text"))
        if not text or not real_refs:
            continue
        clusters.append({
            "pattern": text,
            "video_count": int(item.get("video_count") or len(real_refs)),
            "example_video_ids": real_refs[:6],
        })
    return clusters


def normalize_cluster_count(items: list[dict[str, Any]], clusters: list[dict[str, Any]]) -> list[dict[str, Any]]:
    clusters.sort(key=lambda item: (-int(item.get("video_count") or 0), str(item.get("pattern") or "")))
    if len(items) < MIN_CLUSTERS_PER_SECTION:
        return clusters[:MAX_CLUSTERS_PER_SECTION]

    seen = {str(cluster.get("pattern") or "").strip() for cluster in clusters}
    for fallback in exact_fallback_clusters(items):
        if len(clusters) >= MIN_CLUSTERS_PER_SECTION:
            break
        pattern = str(fallback.get("pattern") or "").strip()
        if pattern and pattern not in seen:
            clusters.append(fallback)
            seen.add(pattern)
    clusters.sort(key=lambda item: (-int(item.get("video_count") or 0), str(item.get("pattern") or "")))
    return clusters[:MAX_CLUSTERS_PER_SECTION]


def cluster_section(
    section: str,
    items: list[dict[str, Any]],
    cluster_provider: ClusterProvider | None = None,
) -> list[dict[str, Any]]:
    if not items:
        return []

    all_clusters: list[dict[str, Any]] = []
    chunks = _chunks(items, CLUSTER_CHUNK_SIZE)
    for chunk in chunks:
        raw = (
            cluster_provider(section, chunk, False)
            if cluster_provider
            else call_cluster_chain(section, chunk, merge=False)
        )
        all_clusters.extend(parse_clusters(raw, _allowed_video_ids(chunk)))

    if len(chunks) > 1 and all_clusters:
        merge_items = [
            {
                "text": cluster["pattern"],
                "video_count": cluster["video_count"],
                "video_ids": cluster["example_video_ids"],
            }
            for cluster in all_clusters
        ]
        raw = (
            cluster_provider(section, merge_items, True)
            if cluster_provider
            else call_cluster_chain(section, merge_items, merge=True)
        )
        merged = parse_clusters(raw, _allowed_video_ids(items))
        if merged:
            all_clusters = merged

    if not all_clusters:
        all_clusters = exact_fallback_clusters(items)
    return normalize_cluster_count(items, all_clusters)


def render_notes(
    records: list[dict[str, Any]],
    cluster_provider: ClusterProvider | None = None,
) -> str:
    by_section = aggregate_observation_items(records)
    lines = [
        "# Ppalmo Teaching Notes",
        "",
        f"- generated: {utc_iso()}",
        f"- source_videos: {len({record.get('videoId') for record in records if record.get('videoId')})}",
        "",
    ]
    for section in TEACH_SECTIONS:
        lines.append(f"## {SECTION_TITLES[section]}")
        clusters = cluster_section(section, by_section[section], cluster_provider=cluster_provider)
        if not clusters:
            lines.append("- No stable observation yet.")
        for cluster in clusters:
            ref_text = ", ".join(cluster["example_video_ids"][:6])
            lines.append(f"- ~{cluster['video_count']} videos: {cluster['pattern']} [{ref_text}]")
        lines.append("")
    return "\n".join(lines[:MAX_NOTE_LINES]).rstrip() + "\n"


def reduce_notes(
    root: Path,
    write: bool = False,
    output_path: Path | None = None,
    cluster_provider: ClusterProvider | None = None,
) -> dict[str, Any]:
    root = root.resolve()
    records = read_jsonl(distillate_dir(root) / "teaching-obs.jsonl")
    text = render_notes(records, cluster_provider=cluster_provider)
    target = output_path or default_notes_path(root)
    report = {"records": len(records), "output": str(target), "lines": len(text.splitlines()), "written": write}
    if write:
        write_text_atomic(target, text)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="W3 full-corpus ppalmo teaching notes map/reduce.")
    parser.add_argument("--root", type=Path, default=default_root())
    parser.add_argument("--transcripts", type=Path)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--sleep", type=float, default=0.0)
    parser.add_argument("--map", action="store_true")
    parser.add_argument("--write-map", action="store_true")
    parser.add_argument("--reduce", action="store_true")
    parser.add_argument("--write-notes", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    if args.map:
        report = run_map(args.root, transcript_dir=args.transcripts, limit=args.limit, write=args.write_map, sleep_s=args.sleep)
    elif args.reduce:
        report = reduce_notes(args.root, write=args.write_notes, output_path=args.output)
    else:
        parser.error("choose --map or --reduce")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
