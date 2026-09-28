#!/usr/bin/env python3
"""Deterministic test suite for scripts/estimate_archive.py (#380).

Contract under test: DESIGN #380 (docs/agent-work/20260810_DESIGN_380_estimate_archive.md)
plus the module docstring. Everything runs in temp dirs: the archive root is always a
temp dir, the canonical finance dir is only ever READ, and no repo path is written.

Style: plain python3 asserts + a main() that runs every case and exits 0 on success
(like scripts/test_fetch_stockanalysis_fixtures.py, but assertion-based). Run from
source/100xFenok:

    python3 scripts/test-estimate-archive.py
"""

from __future__ import annotations

import io
import json
import sys
import tempfile
import traceback
from copy import deepcopy
from pathlib import Path

# Repo python convention: sys.path.insert(0, "scripts"); resolved from __file__ so
# the suite is cwd-agnostic (equivalent to "scripts" when run from source/100xFenok).
SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))
import estimate_archive  # noqa: E402  (deliberate: import after sys.path insert)

DAY = "2026-08-10"
NOW_ISO = f"{DAY}T05:00:00Z"  # fixed; no wall clock anywhere in this suite


# --------------------------------------------------------------------------
# fixtures
# --------------------------------------------------------------------------
def make_block(**overrides) -> dict:
    """A canonical 7-field Yahoo analyst-estimate block (all ESTIMATE_FIELDS present)."""
    block = {
        "earnings_estimate": {
            "avg": 6.29, "low": 5.90, "high": 6.70,
            "yearAgoEps": 5.61, "numberOfAnalysts": 45,
        },
        "revenue_estimate": {
            "avg": 391000000000, "low": 380000000000, "high": 400000000000,
            "yearAgoRevenue": 383000000000, "numberOfAnalysts": 44,
        },
        "eps_trend": {
            "current": 6.29, "7daysAgo": 6.30, "30daysAgo": 6.30,
            "60daysAgo": 6.10, "90daysAgo": 6.00,
        },
        "eps_revisions": {
            "upLast7days": 1, "upLast30days": 5,
            "downLast30days": 1, "downLast90days": 2,
        },
        "growth_estimates": {
            "growth": 0.12, "nextYear": 0.10, "next5Years": 0.11, "nextQuarter": 0.08,
        },
        "analyst_price_targets": {
            "low": 150.0, "high": 260.0, "mean": 210.5, "median": 215.0,
            "numberOfAnalysts": 45,
        },
        "recommendations_summary": {
            "strongBuy": 24, "buy": 11, "hold": 5, "sell": 1, "strongSell": 0,
        },
    }
    block.update(overrides)
    return block


def with_nested(block: dict, field: str, subkey: str, value) -> dict:
    """Deep copy of `block` with block[field][subkey] set to `value` (a real change)."""
    copy = deepcopy(block)
    copy[field][subkey] = value
    return copy


def make_payload(ticker: str, fetched_at=None, block: dict | None = None) -> dict:
    """A canonical `data/yf/finance/{TICKER}.json`-shaped payload.

    `fetched_at=None` omits the key entirely (so `payload.get("fetched_at")` is None).
    """
    payload = {"ticker": ticker, "data": block if block is not None else make_block()}
    if fetched_at is not None:
        payload["fetched_at"] = fetched_at
    return payload


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def outcome_flags(outcome: dict) -> tuple[bool, bool, bool]:
    return outcome["appended"], outcome["skipped"], outcome["failure"]


# --------------------------------------------------------------------------
# required cases (1..10) + CLI smoke (11)
# --------------------------------------------------------------------------
def test_1_change_only_append_then_unchanged_skip() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "archive"
        archive = estimate_archive.EstimateArchive(root, now_iso=NOW_ISO)
        payload = make_payload("AAPL", fetched_at="2026-08-10T01:00:00Z")

        first = archive.archive_if_changed("AAPL", payload)
        assert first == {"appended": True, "skipped": False, "failure": False, "reason": None}, first

        second = archive.archive_if_changed("AAPL", payload)
        assert outcome_flags(second) == (False, True, False), second
        assert second["reason"] == "unchanged", second

        shard = read_json(root / f"{DAY}.json")
        assert len(shard) == 1, shard
        assert shard[0]["ticker"] == "AAPL"
        assert shard[0]["block_hash"] == estimate_archive.block_hash(payload["data"])


def test_2_real_change_appends_new_entry_with_distinct_receipts() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "archive"
        archive = estimate_archive.EstimateArchive(root, now_iso=NOW_ISO)
        base = make_payload("MSFT", fetched_at="2026-08-10T01:00:00Z")
        changed = make_payload(
            "MSFT",
            fetched_at="2026-08-10T02:00:00Z",
            block=with_nested(make_block(), "recommendations_summary", "strongBuy", 25),
        )

        assert archive.archive_if_changed("MSFT", base)["appended"]
        assert archive.archive_if_changed("MSFT", changed)["appended"]

        shard = read_json(root / f"{DAY}.json")
        assert len(shard) == 2, shard
        assert [e["receipt_at"] for e in shard] == [
            "2026-08-10T01:00:00Z", "2026-08-10T02:00:00Z",
        ]
        assert shard[0]["block_hash"] != shard[1]["block_hash"]
        assert shard[1]["block_hash"] == estimate_archive.block_hash(changed["data"])
        assert shard[1]["estimates"]["recommendations_summary"]["strongBuy"] == 25


def test_3_same_day_dedupe_keeps_exactly_one_new_entry() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "archive"
        archive = estimate_archive.EstimateArchive(root, now_iso=NOW_ISO)
        base = make_payload("NVDA", fetched_at="2026-08-10T01:00:00Z")
        changed = make_payload(
            "NVDA",
            fetched_at="2026-08-10T02:00:00Z",
            block=with_nested(make_block(), "analyst_price_targets", "mean", 999.0),
        )

        assert archive.archive_if_changed("NVDA", base)["appended"]
        assert archive.archive_if_changed("NVDA", changed)["appended"]

        third = archive.archive_if_changed("NVDA", changed)  # re-archive the changed payload
        assert outcome_flags(third) == (False, True, False), third
        assert third["reason"] == "unchanged", third  # equals the NEWEST entry (last_entry_for)

        reverted = archive.archive_if_changed("NVDA", base)  # revert to the day's first hash
        assert outcome_flags(reverted) == (False, True, False), reverted
        assert reverted["reason"] == "same_day_duplicate", reverted  # same-day hash already present

        shard = read_json(root / f"{DAY}.json")
        assert len(shard) == 2, shard  # one original + exactly one new entry
        assert [e["block_hash"] for e in shard] == [
            estimate_archive.block_hash(base["data"]),
            estimate_archive.block_hash(changed["data"]),
        ]


def test_4_receipt_time_resolution() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "archive"
        archive = estimate_archive.EstimateArchive(root, now_iso=NOW_ISO)

        # no explicit receipt_at -> payload["fetched_at"]
        assert archive.archive_if_changed("T1", make_payload("T1", fetched_at="2026-07-01T03:00:00Z"))["appended"]
        # no fetched_at -> FAIL-CLOSED failure (no now_iso fabrication, design contract)
        missing = archive.archive_if_changed("T2", make_payload("T2"))
        assert outcome_flags(missing) == (False, False, True), missing
        assert missing["reason"] == "invalid_receipt_time", missing
        # unparseable fetched_at -> FAIL-CLOSED failure
        bad = archive.archive_if_changed("T3", make_payload("T3", fetched_at="not-a-date"))
        assert outcome_flags(bad) == (False, False, True), bad
        assert bad["reason"] == "invalid_receipt_time", bad
        # explicit receipt_at wins over payload fetched_at (and must be parseable)
        assert archive.archive_if_changed(
            "T4", make_payload("T4", fetched_at="2026-07-01T03:00:00Z"), receipt_at="2026-06-01T00:00:00Z"
        )["appended"]
        # explicit unparseable receipt_at -> failure
        bad2 = archive.archive_if_changed("T5", make_payload("T5"), receipt_at="nope")
        assert outcome_flags(bad2) == (False, False, True), bad2

        shard = read_json(root / f"{DAY}.json")
        by_ticker = {e["ticker"]: e["receipt_at"] for e in shard}
        assert by_ticker == {
            "T1": "2026-07-01T03:00:00Z",
            "T4": "2026-06-01T00:00:00Z",
        }, by_ticker
        assert (root / "2026-08-10.json").exists() is False or len(shard) == 2


def test_4b_malformed_shard_fails_closed_without_overwrite() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "archive"
        archive = estimate_archive.EstimateArchive(root, now_iso=NOW_ISO)
        assert archive.archive_if_changed("OK1", make_payload("OK1", fetched_at="2026-08-10T01:00:00Z"))["appended"]
        shard_path = root / f"{DAY}.json"
        original = shard_path.read_text(encoding="utf-8")
        shard_path.write_text("{corrupted", encoding="utf-8")  # malformed shard
        out = archive.archive_if_changed("OK2", make_payload("OK2", fetched_at="2026-08-10T02:00:00Z"))
        assert outcome_flags(out) == (False, False, True), out
        assert out["reason"] == "malformed_shard", out
        assert shard_path.read_text(encoding="utf-8") == "{corrupted", "malformed shard must NOT be overwritten"


def test_4c_malformed_summary_never_blocks() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "archive"
        archive = estimate_archive.EstimateArchive(root, now_iso=NOW_ISO)
        archive.archive_if_changed("OK1", make_payload("OK1", fetched_at="2026-08-10T01:00:00Z"))
        root.mkdir(parents=True, exist_ok=True)
        (root / "_summary.json").write_text("[not,a,dict", encoding="utf-8")  # malformed summary
        out = archive.archive_if_changed("OK2", make_payload("OK2", fetched_at="2026-08-10T02:00:00Z"))
        assert out["appended"] is True, out  # summary corruption must not block appends
        shard = read_json(root / f"{DAY}.json")
        assert [e["ticker"] for e in shard] == ["OK1", "OK2"]


def test_5_no_estimate_payload_skipped_and_nothing_written() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "archive"
        archive = estimate_archive.EstimateArchive(root, now_iso=NOW_ISO)
        etf_payload = {
            "ticker": "SPY", "fetched_at": "2026-08-10T01:00:00Z",
            "data": {"regularMarketPrice": 612.3, "quoteType": "ETF", "marketCap": 590000000000},
        }
        no_data_payload = {"ticker": "XYZ", "fetched_at": "2026-08-10T01:00:00Z"}

        for payload in (etf_payload, no_data_payload):
            outcome = archive.archive_if_changed(payload["ticker"], payload)
            assert outcome == {
                "appended": False, "skipped": True, "failure": False, "reason": "no_estimate_fields",
            }, outcome

        assert not (root / f"{DAY}.json").exists(), "no shard may be created for estimate-less payloads"
        # the skips are still counted in the day summary (contract: counters accumulate)
        summary = read_json(root / "_summary.json")
        assert summary[DAY] == {"tickers": 0, "appended": 0, "skipped": 2, "failures": 0}, summary


def test_6_non_blocking_failure_when_archive_root_is_blocked() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        blocked = tmp_path / "blocked-root"
        blocked.write_bytes(b"i am a file, not a directory")  # mkdir must fail here

        archive = estimate_archive.EstimateArchive(blocked, now_iso=NOW_ISO)
        payload = make_payload("AAPL", fetched_at="2026-08-10T01:00:00Z")
        outcome = archive.archive_if_changed("AAPL", payload)  # must NOT raise
        assert outcome_flags(outcome) == (False, False, True), outcome
        assert isinstance(outcome["reason"], str) and "File exists" in outcome["reason"], outcome
        assert blocked.read_bytes() == b"i am a file, not a directory", "blocked path must stay untouched"

        # the caller can continue on a healthy root
        good = estimate_archive.EstimateArchive(tmp_path / "good-root", now_iso=NOW_ISO)
        assert good.archive_if_changed("AAPL", payload)["appended"] is True
        assert (tmp_path / "good-root" / f"{DAY}.json").is_file()


def test_7_per_day_summary_counters_accumulate() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "archive"
        archive = estimate_archive.EstimateArchive(root, now_iso=NOW_ISO)
        base = make_payload("AAPL", fetched_at="2026-08-10T01:00:00Z")

        assert archive.archive_if_changed("AAPL", base)["appended"]
        assert archive.archive_if_changed("AAPL", base)["reason"] == "unchanged"
        etf = {"ticker": "SPY", "fetched_at": "2026-08-10T01:00:00Z", "data": {"quoteType": "ETF"}}
        assert archive.archive_if_changed("SPY", etf)["reason"] == "no_estimate_fields"

        # block the shard write deterministically: a directory at the atomic-write
        # temp path (`<shard>.json.tmp`) makes tmp.write_bytes fail with
        # IsADirectoryError while _summary.json and the shard file stay writable.
        (root / f"{DAY}.json.tmp").mkdir()
        changed = make_payload(
            "AAPL",
            fetched_at="2026-08-10T02:00:00Z",
            block=with_nested(make_block(), "earnings_estimate", "avg", 9.99),
        )
        failed = archive.archive_if_changed("AAPL", changed)
        assert outcome_flags(failed) == (False, False, True), failed
        assert "Is a directory" in failed["reason"], failed
        (root / f"{DAY}.json.tmp").rmdir()

        assert archive.archive_if_changed("AAPL", changed)["appended"]

        summary = read_json(root / "_summary.json")
        assert summary[DAY] == {"tickers": 2, "appended": 2, "skipped": 2, "failures": 1}, summary

        # a different archive day gets its own counter bucket; day 1 stays intact
        next_day = estimate_archive.EstimateArchive(root, now_iso="2026-08-11T05:00:00Z")
        assert next_day.archive_if_changed("MSFT", make_payload("MSFT", fetched_at="2026-08-11T01:00:00Z"))["appended"]
        summary = read_json(root / "_summary.json")
        assert summary["2026-08-11"] == {"tickers": 1, "appended": 1, "skipped": 0, "failures": 0}, summary
        assert summary[DAY] == {"tickers": 2, "appended": 2, "skipped": 2, "failures": 1}, summary


def test_8_seed_backfill_shards_by_fetched_at_and_dedupes_by_hash() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        finance = tmp_path / "finance"
        finance.mkdir()

        block_x = make_block()
        block_y = make_block(revenue_estimate={
            "avg": 12000000000, "low": 11000000000, "high": 13000000000, "yearAgoRevenue": 10000000000,
        })
        payloads = {
            "AAA.json": make_payload("AAA", fetched_at="2026-07-01T03:00:00Z", block=block_x),
            "BBB.json": make_payload("BBB", fetched_at="2026-07-15T09:30:00Z", block=block_y),
            # ETF-style file: no analyst-estimate fields
            "CET.json": {"ticker": "CET", "fetched_at": "2026-07-10T00:00:00Z",
                         "data": {"quoteType": "ETF", "marketCap": 1}},
            # covered file with a missing fetched_at -> counted failure, fail-closed
            "DDD.json": make_payload("DDD", block=make_block()),
            # same ticker + same block, different day -> deduped by hash
            "AAA-copy.json": make_payload("AAA", fetched_at="2026-08-01T00:00:00Z", block=block_x),
        }
        paths = []
        for name, payload in payloads.items():
            path = finance / name
            path.write_text(json.dumps(payload), encoding="utf-8")
            paths.append(path)

        archive = estimate_archive.EstimateArchive(tmp_path / "archive", now_iso=NOW_ISO)
        first = archive.seed(paths)
        assert first == {"seeded": 2, "skipped": 1, "failures": 1, "no_fields": 1}, first

        july1 = read_json(tmp_path / "archive" / "2026-07-01.json")
        assert len(july1) == 1, july1
        entry = july1[0]
        assert entry["ticker"] == "AAA"
        assert entry["receipt_at"] == "2026-07-01T03:00:00Z"  # == the file's fetched_at
        assert entry["block_hash"] == estimate_archive.block_hash(block_x)
        assert entry["estimates"] == block_x

        july15 = read_json(tmp_path / "archive" / "2026-07-15.json")
        assert [e["ticker"] for e in july15] == ["BBB"]
        assert july15[0]["receipt_at"] == "2026-07-15T09:30:00Z"

        assert not (tmp_path / "archive" / "2026-08-01.json").exists(), \
            "hash-deduped file must not create a shard"
        summary = read_json(tmp_path / "archive" / "_summary.json")
        assert summary["2026-07-01"]["appended"] == 1 and summary["2026-07-15"]["appended"] == 1, summary
        assert summary["2026-07-01"]["tickers"] == 1, summary

        second = archive.seed(paths)  # re-running must not duplicate
        assert second == {"seeded": 0, "skipped": 3, "failures": 1, "no_fields": 1}, second
        assert len(read_json(tmp_path / "archive" / "2026-07-01.json")) == 1
        assert len(read_json(tmp_path / "archive" / "2026-07-15.json")) == 1
        summary2 = read_json(tmp_path / "archive" / "_summary.json")
        assert summary2["2026-07-01"]["appended"] == 1, summary2  # idempotent re-run does not double-count


def test_9_last_entry_for_returns_newest_day_entry() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "archive"
        p1 = make_payload("AAPL", fetched_at="2026-08-10T01:00:00Z")
        p2 = make_payload(
            "AAPL",
            fetched_at="2026-08-11T01:00:00Z",
            block=with_nested(make_block(), "analyst_price_targets", "mean", 222.0),
        )
        day1 = estimate_archive.EstimateArchive(root, now_iso="2026-08-10T05:00:00Z")
        day2 = estimate_archive.EstimateArchive(root, now_iso="2026-08-11T05:00:00Z")
        assert day1.archive_if_changed("AAPL", p1)["appended"]
        assert day2.archive_if_changed("AAPL", p2)["appended"]

        probe = estimate_archive.EstimateArchive(root, now_iso="2026-08-12T05:00:00Z")
        last = probe.last_entry_for("AAPL")
        assert last is not None
        assert last["receipt_at"] == "2026-08-11T01:00:00Z", last
        assert last["block_hash"] == estimate_archive.block_hash(p2["data"])
        assert last["block_hash"] != estimate_archive.block_hash(p1["data"])
        assert probe.last_entry_for("MISSING") is None

        # each day's shard holds exactly its own entry
        shard1 = read_json(root / "2026-08-10.json")
        shard2 = read_json(root / "2026-08-11.json")
        assert len(shard1) == 1 and len(shard2) == 1
        assert shard1[0]["receipt_at"] == "2026-08-10T01:00:00Z"
        assert shard2[0]["receipt_at"] == "2026-08-11T01:00:00Z"


def test_10_canonical_finance_files_stay_byte_identical() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        finance = tmp_path / "finance"
        finance.mkdir()
        payloads = {
            "AAA.json": make_payload("AAA", fetched_at="2026-07-01T03:00:00Z"),
            "BBB.json": make_payload(
                "BBB",
                fetched_at="2026-07-15T09:30:00Z",
                block=make_block(eps_trend={"current": 6.2, "7daysAgo": 6.1, "30daysAgo": 6.1,
                                            "60daysAgo": 6.0, "90daysAgo": 5.9}),
            ),
        }
        for name, payload in payloads.items():
            (finance / name).write_text(json.dumps(payload), encoding="utf-8")

        def snapshot(directory: Path) -> dict:
            return {p.name: p.read_bytes() for p in sorted(directory.iterdir())}

        before = snapshot(finance)
        archive = estimate_archive.EstimateArchive(tmp_path / "archive", now_iso=NOW_ISO)
        for name, payload in payloads.items():  # archive (append + skip paths)
            archive.archive_if_changed(payload["ticker"], payload)
            archive.archive_if_changed(payload["ticker"], payload)  # unchanged skip
        archive.seed([finance / name for name in payloads])  # backfill read path
        assert snapshot(finance) == before, \
            "canonical finance files must be byte-identical after archive operations"


def test_11_cli_seed_smoke_and_usage_exit_code() -> None:
    # static check: default archive root points at the repo data root (pure function)
    default = estimate_archive.default_archive_root()
    assert default.name == "estimates-archive" and str(default).endswith("data/yf/estimates-archive")
    assert default.is_absolute(), "default archive root must be an absolute repo path"

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        finance = tmp_path / "finance"
        finance.mkdir()
        (finance / "AAA.json").write_text(
            json.dumps(make_payload("AAA", fetched_at="2026-07-01T03:00:00Z")), encoding="utf-8"
        )
        archive_root = tmp_path / "archive"
        out = io.StringIO()
        saved = sys.stdout, sys.stderr
        try:
            sys.stdout, sys.stderr = out, out
            code = estimate_archive.main(["--seed", str(finance), "--archive-root", str(archive_root)])
        finally:
            sys.stdout, sys.stderr = saved
        assert code == 0, code
        report = json.loads(out.getvalue())
        assert report["seeded"] == 1 and report["files"] == 1 and report["failures"] == 0, report
        assert (archive_root / "2026-07-01.json").is_file()

        assert estimate_archive.main([]) == 2  # usage error, returns before any path work


def test_12_initial_all_null_estimate_block_skipped_without_shard_entry() -> None:
    """Efficiency defect (#380 follow-up): an all-null 7-field block with NO prior
    archived entry must NOT be archived (ETF-style payloads carry the fields as
    null, and the first observation of such a ticker is noise, not an estimate).
    A later real block must still be archived as the ticker's first observation."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "archive"
        archive = estimate_archive.EstimateArchive(root, now_iso=NOW_ISO)
        null_block = {key: None for key in estimate_archive.ESTIMATE_FIELDS}
        payload = make_payload("SPY", fetched_at="2026-08-10T01:00:00Z", block=null_block)

        outcome = archive.archive_if_changed("SPY", payload)
        assert outcome == {
            "appended": False, "skipped": True, "failure": False, "reason": "no_estimate_values",
        }, outcome
        assert not (root / f"{DAY}.json").exists(), \
            "an all-null initial observation must not create a shard"

        # a subsequent real block is still the FIRST observation (must append)
        real = make_payload("SPY", fetched_at="2026-08-10T02:00:00Z")
        assert archive.archive_if_changed("SPY", real)["appended"] is True
        shard = read_json(root / f"{DAY}.json")
        assert len(shard) == 1, shard
        assert shard[0]["block_hash"] == estimate_archive.block_hash(real["data"])


def test_13_valued_to_all_null_transition_appends_disappearance_event() -> None:
    """A ticker that previously archived a valued block must archive a later
    all-null block: that is a meaningful disappearance event, not noise."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "archive"
        archive = estimate_archive.EstimateArchive(root, now_iso=NOW_ISO)
        valued = make_payload("MSFT", fetched_at="2026-08-10T01:00:00Z")
        null_block = {key: None for key in estimate_archive.ESTIMATE_FIELDS}
        vanished = make_payload("MSFT", fetched_at="2026-08-11T01:00:00Z", block=null_block)

        assert archive.archive_if_changed("MSFT", valued)["appended"]
        day2 = estimate_archive.EstimateArchive(root, now_iso="2026-08-11T05:00:00Z")
        outcome = day2.archive_if_changed("MSFT", vanished)
        assert outcome["appended"] is True, outcome
        assert outcome["reason"] is None, outcome

        shard = read_json(root / "2026-08-11.json")
        assert len(shard) == 1, shard
        assert shard[0]["block_hash"] == estimate_archive.block_hash(null_block)
        assert shard[0]["estimates"] == null_block

        # repeating the all-null block is an unchanged skip (hash already archived)
        again = day2.archive_if_changed("MSFT", vanished)
        assert again["reason"] == "unchanged", again
        assert len(read_json(root / "2026-08-11.json")) == 1


def test_14_seed_skips_initial_all_null_files_and_still_seeds_valued() -> None:
    """Seed applies the same rule: an all-null estimate file with no prior entry
    is not a covered file and must not create shard rows."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        finance = tmp_path / "finance"
        finance.mkdir()
        null_block = {key: None for key in estimate_archive.ESTIMATE_FIELDS}
        paths = [
            finance / "AAA.json",  # valued -> seeded
            finance / "BBB.json",  # all-null initial -> skipped
        ]
        paths[0].write_text(
            json.dumps(make_payload("AAA", fetched_at="2026-07-01T03:00:00Z")), encoding="utf-8"
        )
        paths[1].write_text(
            json.dumps(make_payload("BBB", fetched_at="2026-07-10T00:00:00Z", block=null_block)),
            encoding="utf-8",
        )

        archive = estimate_archive.EstimateArchive(tmp_path / "archive", now_iso=NOW_ISO)
        counts = archive.seed(paths)
        assert counts == {"seeded": 1, "skipped": 1, "failures": 0, "no_fields": 0}, counts
        assert (tmp_path / "archive" / "2026-07-01.json").is_file()
        assert not (tmp_path / "archive" / "2026-07-10.json").exists(), \
            "an all-null initial file must not create a shard"


# --------------------------------------------------------------------------
# known-issue probe (does NOT gate the exit code; reproduced bug, see report)
# --------------------------------------------------------------------------
def probe_last_entry_after_same_day_double_change() -> None:
    """Probe (finding): `last_entry_for` must return the most RECENT entry.

    The module docstring says "Most recent archived entry ... newest first", and the
    design says "append only when the hash differs from that ticker's last archived
    entry". After two same-day appends for one ticker (shard [A, B]), last_entry_for
    scans the newest shard and returns the FIRST match — the OLDEST same-day entry A.
    A next-day reversion to block A is then misjudged as "unchanged" and never
    archived, even though the true last entry is B.
    """
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "archive"
        block_a = make_block()
        block_b = with_nested(make_block(), "earnings_estimate", "avg", 9.99)
        day1 = estimate_archive.EstimateArchive(root, now_iso="2026-08-10T05:00:00Z")
        assert day1.archive_if_changed(
            "AAPL", make_payload("AAPL", fetched_at="2026-08-10T01:00:00Z", block=block_a)
        )["appended"]
        assert day1.archive_if_changed(
            "AAPL", make_payload("AAPL", fetched_at="2026-08-10T02:00:00Z", block=block_b)
        )["appended"]

        probe = estimate_archive.EstimateArchive(root, now_iso="2026-08-10T05:00:00Z")
        assert probe.last_entry_for("AAPL")["block_hash"] == estimate_archive.block_hash(block_b), \
            "last_entry_for must return the newest same-day entry, got the oldest"

        day2 = estimate_archive.EstimateArchive(root, now_iso="2026-08-11T05:00:00Z")
        revert = day2.archive_if_changed(
            "AAPL", make_payload("AAPL", fetched_at="2026-08-11T01:00:00Z", block=block_a)
        )
        assert revert["appended"] is True, \
            f"next-day reversion to the morning block must be archived (got reason={revert['reason']!r})"


# --------------------------------------------------------------------------
# runner
# --------------------------------------------------------------------------
CASES = [
    ("1 change-only append then unchanged skip", test_1_change_only_append_then_unchanged_skip),
    ("2 real change appends new entry with distinct receipts", test_2_real_change_appends_new_entry_with_distinct_receipts),
    ("3 same-day dedupe keeps exactly one new entry", test_3_same_day_dedupe_keeps_exactly_one_new_entry),
    ("4 receipt time resolution (fail-closed: fetched_at / explicit / invalid)", test_4_receipt_time_resolution),
    ("4b malformed shard fails closed without overwrite", test_4b_malformed_shard_fails_closed_without_overwrite),
    ("4c malformed summary never blocks", test_4c_malformed_summary_never_blocks),
    ("5 no-estimate payload skipped, no shard written", test_5_no_estimate_payload_skipped_and_nothing_written),
    ("6 non-blocking failure when archive root is blocked", test_6_non_blocking_failure_when_archive_root_is_blocked),
    ("7 per-day summary counters accumulate", test_7_per_day_summary_counters_accumulate),
    ("8 seed backfill shards by fetched_at and dedupes by hash", test_8_seed_backfill_shards_by_fetched_at_and_dedupes_by_hash),
    ("9 last_entry_for returns newest-day entry", test_9_last_entry_for_returns_newest_day_entry),
    ("10 canonical finance files stay byte-identical", test_10_canonical_finance_files_stay_byte_identical),
    ("11 CLI --seed smoke and usage exit code", test_11_cli_seed_smoke_and_usage_exit_code),
    ("12 initial all-null block skipped, no shard row", test_12_initial_all_null_estimate_block_skipped_without_shard_entry),
    ("13 valued -> all-null transition appends disappearance event", test_13_valued_to_all_null_transition_appends_disappearance_event),
    ("14 seed skips initial all-null files", test_14_seed_skips_initial_all_null_files_and_still_seeds_valued),
]

PROBES = [
    ("last_entry_for must return newest entry after same-day double change", probe_last_entry_after_same_day_double_change),
]


def main() -> int:
    failed = []
    for name, fn in CASES:
        try:
            fn()
            print(f"ok - {name}")
        except Exception as exc:
            failed.append(name)
            print(f"FAIL - {name}: {exc!r}")
            traceback.print_exc()
    total, passed = len(CASES), len(CASES) - len(failed)

    probe_results = []
    for name, fn in PROBES:
        try:
            fn()
            probe_results.append((name, "passed"))
        except Exception as exc:
            probe_results.append((name, f"reproduced: {exc!r}"))
            traceback.print_exc()

    if failed:
        print(f"estimate-archive tests: {passed}/{total} passed (FAILED: {', '.join(failed)})", file=sys.stderr)
        return 1
    print(f"estimate-archive tests: {passed}/{total} passed (temp-dir only, no repo writes)")
    for name, status in probe_results:
        print(f"probe - {name}: {status}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
