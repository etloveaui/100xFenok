#!/usr/bin/env python3
"""Point-in-time analyst-estimate archive (#380, DESIGN_380_estimate_archive.md).

Sibling of `data/yf/finance/{TICKER}.json`: every fetch run may append the
7-field analyst-estimate block to a date shard `data/yf/estimates-archive/YYYY-MM-DD.json`
ONLY when the block changed since the ticker's last archived entry.

Contract (ratified 2026-08-10 by owner):
- Change-only append, dedupe within the same day.
- `receipt_at` = the fetch receipt time (payload `fetched_at`; fallback: caller clock).
- Archive failures NEVER fail the canonical lane: caught inside, counted, logged.
- Canonical files are never modified here.
- One-time backfill seed: existing covered files are archived with their own
  `fetched_at` as the receipt time (their eps_trend 7/30/60/90-day values then
  preserve ~one quarter of history).

Language: python (the canonical producer `fetch-yf-finance.py` is python).
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

ESTIMATE_FIELDS = (
    "earnings_estimate",
    "revenue_estimate",
    "eps_trend",
    "eps_revisions",
    "growth_estimates",
    "analyst_price_targets",
    "recommendations_summary",
)

ARCHIVE_DIR_NAME = "estimates-archive"
SUMMARY_FILE_NAME = "_summary.json"


def stable_dumps(value) -> str:
    """Canonical serialization shared by hashing and shard records."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def estimate_block(payload) -> dict | None:
    """Extract the 7-field estimate block from a finance payload's `data` sub-object."""
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        return None
    block = {key: data[key] for key in ESTIMATE_FIELDS if key in data}
    return block if block else None


def block_hash(block: dict) -> str:
    return hashlib.sha256(stable_dumps(block).encode("utf-8")).hexdigest()


def _all_values_null(block: dict) -> bool:
    """True when the block exists syntactically but carries no usable value."""
    return bool(block) and all(value is None for value in block.values())


def _atomic_write_bytes(path: Path, payload_bytes: bytes) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(payload_bytes)
    os.replace(tmp, path)


def _read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _parse_iso(value) -> bool:
    """True only for a parseable ISO-8601 UTC timestamp (design: fail-closed on receipt truth)."""
    if not isinstance(value, str) or not value:
        return False
    try:
        from datetime import datetime

        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


class EstimateArchive:
    """Change-only, date-sharded, non-blocking estimate archive."""

    def __init__(self, archive_root, *, now_iso=None):
        self.archive_root = Path(archive_root)
        self.now_iso = now_iso or _utc_now_iso()
        self.day = self.now_iso[:10]
        self.summary_path = self.archive_root / SUMMARY_FILE_NAME

    # -- shard helpers -------------------------------------------------------
    def _shard_path(self, day: str) -> Path:
        return self.archive_root / f"{day}.json"

    def _read_shard(self, day: str):
        """Return (entries, ok). Malformed shard JSON is NOT silently treated as empty."""
        path = self._shard_path(day)
        if not path.exists():
            return [], True
        try:
            entries = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return [], False
        return (entries if isinstance(entries, list) else []), isinstance(entries, list)

    def _shard_days_desc(self) -> list[str]:
        if not self.archive_root.is_dir():
            return []
        return sorted(
            (p.stem for p in self.archive_root.glob("*.json") if p.stem[:4].isdigit()),
            reverse=True,
        )

    def last_entry_for(self, ticker: str):
        """Most recent archived entry for the ticker across shards, newest first."""
        for day in self._shard_days_desc():
            entries, ok = self._read_shard(day)
            if not ok:
                continue
            for entry in reversed(entries):
                if entry.get("ticker") == ticker:
                    return entry
        return None

    # -- summary -------------------------------------------------------------
    def _bump_summary(self, appended: int, skipped: int, failures: int) -> None:
        try:
            summary = _read_json(self.summary_path)
            if not isinstance(summary, dict):
                summary = {}
            day_counts = summary.setdefault(self.day, {"tickers": 0, "appended": 0, "skipped": 0, "failures": 0})
            day_counts["appended"] += appended
            day_counts["skipped"] += skipped
            day_counts["failures"] += failures
            if appended:
                day_counts["tickers"] += appended
            self.archive_root.mkdir(parents=True, exist_ok=True)
            _atomic_write_bytes(self.summary_path, stable_dumps(summary).encode("utf-8"))
        except Exception as exc:  # summary bookkeeping must never block or raise
            print(f"estimate-archive: summary write failed (non-blocking): {exc}", file=sys.stderr)

    # -- core ----------------------------------------------------------------
    def archive_if_changed(self, ticker: str, payload, *, receipt_at: str | None = None) -> dict:
        """Append the estimate block for one ticker if it changed. NEVER raises."""
        outcome = {"appended": False, "skipped": False, "failure": False, "reason": None}
        try:
            block = estimate_block(payload)
            if block is None:
                outcome["skipped"] = True
                outcome["reason"] = "no_estimate_fields"
                self._bump_summary(appended=0, skipped=1, failures=0)
                return outcome
            entry_hash = block_hash(block)
            prior = self.last_entry_for(ticker)
            if prior is not None and prior.get("block_hash") == entry_hash:
                outcome["skipped"] = True
                outcome["reason"] = "unchanged"
                self._bump_summary(appended=0, skipped=1, failures=0)
                return outcome
            if _all_values_null(block) and prior is None:
                # Efficiency guard: an initial all-null observation (ETF-style
                # payloads carry the 7 fields as null) is not a point-in-time
                # estimate and must not create a shard row. A valued -> all-null
                # transition is a disappearance event and still appends
                # (prior is not None, so this branch is not taken).
                outcome["skipped"] = True
                outcome["reason"] = "no_estimate_values"
                self._bump_summary(appended=0, skipped=1, failures=0)
                return outcome
            if receipt_at is None:
                receipt_at = payload.get("fetched_at")
            if not _parse_iso(receipt_at):
                outcome["failure"] = True
                outcome["reason"] = "invalid_receipt_time"
                self._bump_summary(appended=0, skipped=0, failures=1)
                return outcome
            entry = {
                "ticker": ticker,
                "receipt_at": receipt_at,
                "block_hash": entry_hash,
                "estimates": block,
            }
            shard, shard_ok = self._read_shard(self.day)
            if not shard_ok:
                outcome["failure"] = True
                outcome["reason"] = "malformed_shard"
                self._bump_summary(appended=0, skipped=0, failures=1)
                return outcome
            if any(e.get("ticker") == ticker and e.get("block_hash") == entry_hash for e in shard):
                outcome["skipped"] = True
                outcome["reason"] = "same_day_duplicate"
                self._bump_summary(appended=0, skipped=1, failures=0)
                return outcome
            shard.append(entry)
            self.archive_root.mkdir(parents=True, exist_ok=True)
            _atomic_write_bytes(self._shard_path(self.day), stable_dumps(shard).encode("utf-8"))
            outcome["appended"] = True
            self._bump_summary(appended=1, skipped=0, failures=0)
            return outcome
        except Exception as exc:  # non-blocking by contract
            outcome["failure"] = True
            outcome["reason"] = str(exc)
            self._bump_summary(appended=0, skipped=0, failures=1)
            print(f"estimate-archive: {ticker} archive failed (non-blocking): {exc}", file=sys.stderr)
            return outcome

    def seed(self, files) -> dict:
        """One-time backfill: archive every covered file with its own fetched_at.

        A file is skipped when a same-hash entry already exists (dedupe).
        """
        counts = {"seeded": 0, "skipped": 0, "failures": 0, "no_fields": 0}
        per_day = {}
        for path in files:
            payload = _read_json(Path(path))
            if payload is None:
                counts["failures"] += 1
                continue
            block = estimate_block(payload)
            if block is None:
                counts["no_fields"] += 1
                continue
            receipt_at = payload.get("fetched_at")
            if not _parse_iso(receipt_at):
                counts["failures"] += 1
                continue
            ticker = payload.get("ticker")
            if not isinstance(ticker, str):
                counts["failures"] += 1
                continue
            entry_hash = block_hash(block)
            prior = self.last_entry_for(ticker)
            if prior is not None and prior.get("block_hash") == entry_hash:
                counts["skipped"] += 1
                continue
            if _all_values_null(block) and prior is None:
                # Same efficiency guard as archive_if_changed: an all-null
                # estimate file with no prior entry is not a covered file.
                counts["skipped"] += 1
                continue
            shard, shard_ok = self._read_shard(receipt_at[:10])
            if not shard_ok:
                counts["failures"] += 1
                continue
            if any(e.get("ticker") == ticker and e.get("block_hash") == entry_hash for e in shard):
                counts["skipped"] += 1
                continue
            shard.append({
                "ticker": ticker,
                "receipt_at": receipt_at,
                "block_hash": entry_hash,
                "estimates": block,
            })
            self.archive_root.mkdir(parents=True, exist_ok=True)
            _atomic_write_bytes(self._shard_path(receipt_at[:10]), stable_dumps(shard).encode("utf-8"))
            counts["seeded"] += 1
            day = receipt_at[:10]
            per_day[day] = per_day.get(day, 0) + 1
        if per_day:
            summary = _read_json(self.summary_path) or {}
            for day, added in per_day.items():
                day_counts = summary.setdefault(day, {"tickers": 0, "appended": 0, "skipped": 0, "failures": 0})
                day_counts["tickers"] += added
                day_counts["appended"] += added
        else:
            # All-skip seed (idempotent re-run): reconcile a missing summary
            # from the shards that already exist.
            summary = _read_json(self.summary_path) or {}
            for day in self._shard_days_desc():
                if day in summary:
                    continue
                shard, shard_ok = self._read_shard(day)
                if not shard_ok or not shard:
                    continue
                tickers = {e.get("ticker") for e in shard if e.get("ticker")}
                summary[day] = {"tickers": len(tickers), "appended": len(tickers), "skipped": 0, "failures": 0}
        try:
            self.archive_root.mkdir(parents=True, exist_ok=True)
            _atomic_write_bytes(self.summary_path, stable_dumps(summary).encode("utf-8"))
        except OSError as exc:
            print(f"estimate-archive: summary write failed: {exc}", file=sys.stderr)
        return counts


def _utc_now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def default_archive_root(repo_root=None) -> Path:
    root = Path(repo_root or Path(__file__).resolve().parent.parent)
    return root / "data" / "yf" / ARCHIVE_DIR_NAME


def main(argv=None) -> int:
    """CLI: python estimate_archive.py --seed <finance-dir> [--archive-root <root>]

    Seeds the archive from existing canonical files (one-time backfill).
    """
    argv = argv if argv is not None else sys.argv[1:]
    if "--seed" not in argv:
        print("usage: estimate_archive.py --seed <data/yf/finance dir> [--archive-root <root>]", file=sys.stderr)
        return 2
    try:
        finance_dir = Path(argv[argv.index("--seed") + 1])
    except IndexError:
        print("missing finance dir", file=sys.stderr)
        return 2
    archive_root = default_archive_root()
    if "--archive-root" in argv:
        archive_root = Path(argv[argv.index("--archive-root") + 1])
    files = sorted(finance_dir.glob("*.json"))
    archive = EstimateArchive(archive_root)
    counts = archive.seed(files)
    print(json.dumps({"archive_root": str(archive_root), "files": len(files), **counts}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
