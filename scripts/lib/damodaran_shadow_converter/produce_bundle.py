#!/usr/bin/env python3
"""Run the vendored CCH converter once and bundle its six payloads for parity."""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from run import (  # noqa: E402
    convert_erp,
    convert_histimpl,
    convert_industries,
    convert_industry_metrics,
    convert_industry_metrics_regions,
    convert_ratings,
)


DATASETS = (
    ("industries.json", convert_industries),
    ("historical_erp.json", convert_histimpl),
    ("credit_ratings.json", convert_ratings),
    ("erp.json", convert_erp),
    ("industry_metrics.json", convert_industry_metrics),
    ("industry_metrics_regions.json", convert_industry_metrics_regions),
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class RequestRecorder:
    """Apply a small inter-request delay and retain response provenance."""

    def __init__(self, delay_seconds: float) -> None:
        self.delay_seconds = delay_seconds
        self.current_file: str | None = None
        self.last_request_at = 0.0
        self.rows: dict[str, list[dict[str, Any]]] = {}
        self._original_get = requests.get

    def get(self, url: str, *args: Any, **kwargs: Any):
        elapsed = time.monotonic() - self.last_request_at
        if self.last_request_at and elapsed < self.delay_seconds:
            time.sleep(self.delay_seconds - elapsed)

        headers = dict(kwargs.pop("headers", {}) or {})
        headers.setdefault("User-Agent", "100xFenok-Damodaran-Shadow/1.0")
        response = self._original_get(url, *args, headers=headers, **kwargs)
        self.last_request_at = time.monotonic()

        if self.current_file is not None:
            self.rows.setdefault(self.current_file, []).append(
                {
                    "url": str(response.url),
                    "status": response.status_code,
                    "etag": response.headers.get("ETag"),
                    "last_modified": response.headers.get("Last-Modified"),
                    "content_length": len(response.content),
                    "fetched_at": utc_now(),
                }
            )
        return response


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--bundle", required=True, type=Path)
    parser.add_argument("--delay-seconds", type=float, default=0.25)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    recorder = RequestRecorder(max(0.0, args.delay_seconds))
    requests.get = recorder.get

    errors: dict[str, str] = {}
    payloads: dict[str, Any] = {}

    for file_name, converter in DATASETS:
        recorder.current_file = file_name
        try:
            converter(args.output_dir)
            output_path = args.output_dir / file_name
            payloads[file_name] = json.loads(output_path.read_text(encoding="utf-8"))
        except Exception as exc:  # keep the one-run report honest and complete
            errors[file_name] = f"{type(exc).__name__}: {exc}"

    bundle = {
        "schema_version": "damodaran-shadow-producer-bundle/v1",
        "fetched_at": utc_now(),
        "conditional_get": {
            "used": False,
            "reason": "no durable raw-source cache exists; a 304 response could not be reparsed",
        },
        "payloads": payloads,
        "sources": recorder.rows,
        "errors": errors,
    }
    args.bundle.write_text(
        json.dumps(bundle, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
