from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from distill_engine import run_distill, write_json_atomic
from providers import MockProvider, Provider

SEOUL = ZoneInfo("Asia/Seoul")
STUDY_DAY_CUTOFF_HOUR = 4


def default_root() -> Path:
    next_root = Path(__file__).resolve().parents[2]
    data_dirname = os.environ.get("MONA_DATA_DIRNAME", "mona-english")
    return next_root / "data" / data_dirname


def canonical_study_date(now: datetime | None = None) -> str:
    """Mirror of TS getCanonicalMonaStudyDate: before 04:00 KST = previous day."""
    moment = now.astimezone(SEOUL) if now else datetime.now(SEOUL)
    if moment.hour < STUDY_DAY_CUTOFF_HOUR:
        moment -= timedelta(days=1)
    return moment.strftime("%Y-%m-%d")


def enqueue_pending(root: Path, date: str, mode: str = "interrupt", trigger: str = "saveStudySession") -> Path:
    pending = root / "_queue" / "pending.json"
    write_json_atomic(
        pending,
        {
            "date": date,
            "mode": mode,
            "trigger": trigger,
            "enqueuedAt": "test-or-manual",
        },
    )
    return pending


def resolve_provider(kind: str, mock_mode: str, job_mode: str) -> Provider:
    if kind == "chain":
        from chains import interrupt_chain, nightly_chain

        return nightly_chain() if job_mode == "nightly" else interrupt_chain()
    return MockProvider(mock_mode)


def drain_once(root: Path, provider_mode: str = "valid", provider_kind: str = "mock") -> dict[str, Any]:
    queue_dir = root / "_queue"
    pending = queue_dir / "pending.json"
    processing = queue_dir / "processing.json"
    if not pending.exists():
        return {"ok": True, "drained": False, "reason": "no pending job"}
    queue_dir.mkdir(parents=True, exist_ok=True)
    pending.replace(processing)
    try:
        job = json.loads(processing.read_text(encoding="utf-8"))
        if not isinstance(job, dict):
            raise ValueError("job must be an object")
        if job.get("mode") not in ("interrupt", "nightly"):
            raise ValueError(f"unsupported mode: {job.get('mode')}")  # unknown future modes fail safe
        provider = resolve_provider(provider_kind, provider_mode, str(job.get("mode")))
        result = run_distill(root, job, provider)
        return {"drained": True, **result}
    except Exception as exc:
        write_json_atomic(
            queue_dir / "last_error.json",
            {
                "ok": False,
                "reason": f"worker: {exc}",
            },
        )
        return {"ok": False, "soft_failed": True, "reason": f"worker: {exc}"}
    finally:
        try:
            processing.unlink()
        except FileNotFoundError:
            pass


def main() -> int:
    parser = argparse.ArgumentParser(description="Drain one Mona distill queue job.")
    parser.add_argument("--root", type=Path, default=default_root())
    parser.add_argument("--mock-mode", default="valid")
    parser.add_argument("--provider", choices=["mock", "chain"], default="mock")
    parser.add_argument(
        "--enqueue-nightly",
        action="store_true",
        help="Enqueue a nightly deep-distill job for the canonical study date before draining.",
    )
    args = parser.parse_args()
    if args.enqueue_nightly:
        enqueue_pending(args.root, canonical_study_date(), mode="nightly", trigger="launchd-nightly")
    result = drain_once(args.root, args.mock_mode, args.provider)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
