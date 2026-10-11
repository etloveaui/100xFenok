#!/usr/bin/env python3
"""A1 incremental SEC ingestion using the canonical CCH converter and 13F builders."""
import argparse
import calendar
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from datetime import datetime, timezone

STATUS_PATH = "ops/a1-lanes/sec_13f.json"
BUILDERS = (
    "build-13f-enrichment-backfill.mjs",
    "build-13f-integrity-indexes.mjs",
    "build-13f-trades.mjs",
    "build-13f-portfolio-views.mjs",
    "build-13f-factor-radar-v2.mjs",
    "build-guru-holders-index.mjs",
)
INPUT_ROOTS = (
    "scripts", "100xfenok-next/src/lib", "data/sec-13f",
    "data/global-scouter/core", "data/yf/finance", "data/yf/quarter_closes.json",
    "data/edgar/company_tickers.json", STATUS_PATH,
)
SPARSE_ROOTS = (
    "scripts", "ops/a1-lanes", "100xfenok-next/src/lib",
    "data/sec-13f", "data/global-scouter/core", "data/yf", "data/edgar",
)


def command(args, cwd, *, timeout=120, env=None, capture=True):
    result = subprocess.run(args, cwd=cwd, env=env, text=True,
                            capture_output=capture, timeout=timeout)
    if result.returncode:
        detail = ((result.stderr or "") + (result.stdout or ""))[-1500:]
        raise RuntimeError(f"{args[0]} exited {result.returncode}: {detail}")
    return result.stdout.strip() if capture else ""


def git(repo, *args):
    return command(["git", *args], repo)


def read_json(path, default=None):
    if not path.exists() and default is not None:
        return default
    return json.loads(path.read_text())


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".next")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(path)


def seed_tracker(output):
    """Only committed filings may establish already-processed identities."""
    filings = {}
    for path in sorted((output / "investors").glob("*.json")):
        investor = read_json(path)["investor"]
        for row in investor["filings"]:
            key = f"{path.stem}:{row['quarter']}:{row['filing_date']}"
            filings[key] = {
                "status": "complete",
                "holdings_count": row.get("holdings_count", len(row.get("holdings", []))),
                "reported_holdings_count": row.get("reported_holdings_count"),
                "filtered_out_count": row.get("filtered_out_count"),
                "metadata": {
                    "source_cik": row.get("source_cik", investor.get("cik")),
                    "accession_number": row.get("accession_number"),
                },
            }
    if not filings:
        raise RuntimeError("Committed 13F investor history is missing")
    return {"version": "3.0.0", "last_build": None, "last_full_build": None,
            "filings": filings, "stats": {"total_processed": 0, "total_skipped": 0}}


def source_clock(output):
    summary = read_json(output / "summary.json")
    quarter = max(summary["metadata"]["quarters_covered"])
    year, number = quarter.split("-Q")
    month = int(number) * 3
    date = f"{int(year):04}-{month:02}-{calendar.monthrange(int(year), month)[1]:02}"
    return quarter, date


def assert_writer_idle():
    payload = json.loads(command([
        "gh", "api", "repos/etloveaui/100xFenok/actions/runs?status=in_progress&per_page=100",
    ], Path.cwd(), timeout=30))
    if len(payload.get("workflow_runs", [])) >= 100:
        raise RuntimeError("Writer activity page is full; cannot prove an idle publication window")
    busy = [run["name"] for run in payload.get("workflow_runs", [])
            if any(name in run["name"].lower()
                   for name in ("stockanalysis", "stocks analyzer", "update manifest"))]
    if busy:
        raise RuntimeError("Publication deferred while writers run: " + ", ".join(sorted(set(busy))))


def publish(candidate, base, paths):
    """Merge only independent incoming changes; never overwrite a newer input."""
    git(candidate, "add", "--", *paths)
    if not git(candidate, "diff", "--cached", "--name-only"):
        return None
    git(candidate, "-c", "user.name=fenok-sec13f",
        "-c", "user.email=fenok-sec13f@local", "commit", "-m",
        "data: record scheduled SEC 13F collection", "--", *paths)
    generated = git(candidate, "rev-parse", "HEAD")
    for _ in range(3):
        assert_writer_idle()
        git(candidate, "fetch", "origin", "main")
        remote = git(candidate, "rev-parse", "origin/main")
        if git(candidate, "diff", "--name-only", base, remote, "--", *INPUT_ROOTS):
            raise RuntimeError("13F inputs changed during collection; retry from the new main")
        proposed = generated
        if remote != base:
            tree = git(candidate, "merge-tree", "--write-tree", generated, remote)
            proposed = git(candidate, "-c", "user.name=fenok-sec13f",
                           "-c", "user.email=fenok-sec13f@local", "commit-tree",
                           tree, "-p", remote, "-p", generated, "-m",
                           "Merge scheduled SEC 13F collection")
        result = subprocess.run(["git", "push", "origin", f"{proposed}:refs/heads/main"],
                                cwd=candidate, text=True, capture_output=True, timeout=120)
        if result.returncode == 0:
            git(candidate, "fetch", "origin", "main")
            git(candidate, "merge-base", "--is-ancestor", proposed, "origin/main")
            return proposed
    raise RuntimeError("13F publication lost three push races; retained for retry")


def collect(args, candidate, runtime):
    # Importing yaml explicitly prevents the converter's reduced fallback universe.
    import yaml
    configured = yaml.safe_load((args.converter_root / "config/investors.yaml").read_text())
    if not configured.get("investors"):
        raise RuntimeError("Canonical converter investor configuration is missing")
    output = runtime / "output"
    shutil.copytree(candidate / "data/sec-13f", output)
    tracker = seed_tracker(output)
    write_json(runtime / ".sec_cache/tracker.json", tracker)
    shutil.copy2(args.converter_root / "ticker_cache.json", runtime / "ticker_cache.json")
    env = dict(os.environ, SEC13F_OPENFIGI_API_KEY="")
    command([sys.executable, str(args.converter_root / "run.py"),
             "--incremental", "--quarters", "4", "--no-yahoo", "--backfill-mode", "full",
             "--output", str(output)], runtime, timeout=35 * 60, env=env, capture=False)
    summary = read_json(output / "summary.json")
    metadata = summary["metadata"]
    if metadata.get("publish_blocked") or metadata.get("partial_run") or metadata.get("investor_errors"):
        raise RuntimeError("Canonical converter reported a partial or blocked publication")
    if any(read_json(output / "unparsed_filings.json", {}).values()):
        raise RuntimeError("Canonical converter could not parse one or more fetched filings")
    updated = read_json(runtime / ".sec_cache/tracker.json")["filings"]
    if updated == tracker["filings"]:
        return "retained"
    # Converter diagnostics stay local. Only the existing canonical artifact set
    # enters the candidate, including private canonical rows with unchanged routing.
    for source in output.rglob("*.json"):
        relative = source.relative_to(output)
        if relative.parts[0] not in ("investors", "analytics") and relative.name not in (
                "summary.json", "by_ticker.json", "by_sector.json", "schema.json"):
            continue
        target = candidate / "data/sec-13f" / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    env["FENOK_FF_RAW_CACHE"] = str(args.state_root / "factor-cache")
    for builder in BUILDERS:
        command(["node", f"scripts/{builder}"], candidate, timeout=10 * 60, env=env, capture=False)
    return "candidate_ready"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, type=Path)
    parser.add_argument("--converter-root", required=True, type=Path)
    parser.add_argument("--state-root", required=True, type=Path)
    parser.add_argument("--publish", action="store_true")
    args = parser.parse_args()
    args.repo = args.repo.resolve()
    args.converter_root = args.converter_root.resolve()
    args.state_root = args.state_root.resolve()
    if sys.platform != "linux":
        raise RuntimeError("This producer runs on the authorized A1 Linux host")
    if git(args.repo, "status", "--porcelain"):
        raise RuntimeError("Collector checkout is dirty; preserve it and stop")
    if git(args.repo, "remote", "get-url", "origin") != "git@github-100xf-a1:etloveaui/100xFenok.git":
        raise RuntimeError("Collector is not bound to the existing A1 product remote")
    git(args.repo, "fetch", "origin", "main")
    git(args.repo, "merge-base", "--is-ancestor", "HEAD", "origin/main")
    git(args.repo, "merge", "--ff-only", "origin/main")
    started = datetime.now(timezone.utc)
    runtime = args.state_root / "runs" / started.strftime("%Y%m%dT%H%M%S.%fZ")
    runtime.mkdir(parents=True)
    candidate = runtime / "candidate"
    base = git(args.repo, "rev-parse", "HEAD")
    git(args.repo, "worktree", "add", "--detach", "--no-checkout", str(candidate), base)
    git(candidate, "sparse-checkout", "set", "--cone", *SPARSE_ROOTS)
    git(candidate, "checkout", base)
    prior = read_json(candidate / STATUS_PATH, {})
    served_clock = source_clock(candidate / "data/sec-13f")
    error = None
    try:
        outcome = collect(args, candidate, runtime)
    except Exception as exc:
        error = str(exc)
        outcome = "failed"
    finished = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    quarter, source_as_of = source_clock(candidate / "data/sec-13f") if error is None else served_clock
    state = {
        "schema_version": "a1-lane-status/v1", "lane_id": "sec_13f",
        "enabled": True, "push_enabled": args.publish, "updated_at": finished,
        "last_success_at": finished if error is None else prior.get("last_success_at"),
        "consecutive_failures": 0 if error is None else prior.get("consecutive_failures", 0) + 1,
        "cadence_hours": 24, "grace_hours": 12,
        "last_run": {"observed_at": finished,
                     "outcome": "published" if args.publish and outcome == "candidate_ready" else outcome,
                     "source_as_of": source_as_of, "source_quarter": quarter,
                     "reason": error or ("no_new_filings" if outcome == "retained" else "new_filings")},
    }
    write_json(args.state_root / "last-run.json", state)
    published = None
    if args.publish:
        write_json(candidate / STATUS_PATH, state)
        paths = [STATUS_PATH] if error or outcome == "retained" else ["data/sec-13f", STATUS_PATH]
        published = publish(candidate, base, paths)
    print(json.dumps({"outcome": outcome, "source_as_of": source_as_of,
                      "published": published, "candidate": str(candidate), "error": error}))
    # A clean candidate is removable only when its revision is already on main.
    # Failed/unpublished output stays available; no reset, clean or forced removal.
    if not git(candidate, "status", "--porcelain"):
        ancestor = subprocess.run(["git", "merge-base", "--is-ancestor", "HEAD", "origin/main"],
                                  cwd=candidate)
        if ancestor.returncode == 0:
            git(args.repo, "worktree", "remove", str(candidate))
    return 1 if error else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"SEC 13F lane failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
