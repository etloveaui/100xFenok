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
LANE_ID = "sec_13f"
DATA_ROOT = "data/sec-13f"
BUILDERS = (
    "build-13f-enrichment-backfill.mjs",
    "build-13f-integrity-indexes.mjs",
    "build-13f-trades.mjs",
    "build-13f-portfolio-views.mjs",
    "build-13f-factor-radar-v2.mjs",
    "build-guru-holders-index.mjs",
)
SUCCESS_OUTCOMES = ("published", "retained")
PUBLISH_RACE_ATTEMPTS = 3


class PublicationFailed(RuntimeError):
    """The bounded push retries were exhausted."""


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
    """Only the active generation may establish already-processed identities."""
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
        raise RuntimeError("Active 13F investor history is missing")
    return {"version": "3.0.0", "last_build": None, "last_full_build": None,
            "filings": filings, "stats": {"total_processed": 0, "total_skipped": 0}}


def source_clock(output):
    summary = read_json(output / "summary.json")
    quarter = max(summary["metadata"]["quarters_covered"])
    year, number = quarter.split("-Q")
    month = int(number) * 3
    date = f"{int(year):04}-{month:02}-{calendar.monthrange(int(year), month)[1]:02}"
    return quarter, date


def parse_stamp(value):
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def reconcile_state(*states):
    """The newest report for this lane wins; another lane's file is ignored.

    The published status can lag behind the local one after unpublished
    attempts, so the failure count is derived from whichever is newer instead
    of restarting at one from a stale remote zero.
    """
    usable = [state for state in states
              if isinstance(state, dict) and state.get("lane_id") == LANE_ID
              and parse_stamp(state.get("updated_at")) is not None]
    if not usable:
        return {}
    return max(usable, key=lambda state: parse_stamp(state["updated_at"]))


def next_failure_count(reconciled):
    last = (reconciled.get("last_run") or {}).get("outcome")
    if last in SUCCESS_OUTCOMES:
        return 1
    value = reconciled.get("consecutive_failures")
    return value + 1 if isinstance(value, int) and value >= 0 else 1


def status_at(repo, revision):
    """The lane status carried by a revision, or {} when it cannot be read."""
    try:
        return json.loads(git(repo, "show", f"{revision}:{STATUS_PATH}"))
    except Exception:
        return {}


def status_is_newer(served, proposed):
    """True when main already carries a newer report for this lane."""
    if not isinstance(served, dict) or served.get("lane_id") != proposed.get("lane_id"):
        return False
    served_at = parse_stamp(served.get("updated_at"))
    proposed_at = parse_stamp(proposed.get("updated_at"))
    if served_at is None:
        return False
    return proposed_at is None or served_at > proposed_at


def build_state(outcome, error, collected_clock, served_clock, reconciled, rebuilds,
                finished, push_enabled, publication="none"):
    """Status for one attempt: only a real publication advances the lane.

    publication records what actually happened to this report: "with_data" (it
    travelled in the data commit), "published", "no_change", "superseded"
    (main already carried a newer report for this lane), "failed", or "none"
    when publication is disabled. A report that never reached main cannot read
    as a fresh success.
    """
    if error is not None and outcome in SUCCESS_OUTCOMES:
        outcome = "failed"
    reached_main = publication in ("with_data", "published", "no_change")
    success = error is None and outcome in SUCCESS_OUTCOMES and reached_main
    published_data = success and outcome == "published"
    quarter, source_as_of = collected_clock if published_data else served_clock
    reason = error
    if reason is None:
        reason = {"retained": "no_new_filings", "published": "new_filings",
                  "deferred": "publication_deferred"}.get(outcome, outcome)
        if publication == "superseded":
            reason = "main already carries a newer lane report"
        elif publication == "failed":
            reason = "lane status publication failed"
    return {
        "schema_version": "a1-lane-status/v1", "lane_id": LANE_ID,
        "enabled": True, "push_enabled": push_enabled,
        "updated_at": finished,
        "last_success_at": finished if success else reconciled.get("last_success_at"),
        "consecutive_failures": 0 if success else next_failure_count(reconciled),
        "cadence_hours": 24, "grace_hours": 12,
        "last_run": {"observed_at": finished, "outcome": outcome,
                     "source_as_of": source_as_of, "source_quarter": quarter,
                     "reason": reason, "rebuilds": rebuilds,
                     "status_publication": publication, "published": reached_main},
    }


def publish_status_only(args, status, scratch):
    """Publish the existing heartbeat with a temporary index, never a worktree."""
    scratch.parent.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, GIT_INDEX_FILE=str(scratch))
    for _ in range(PUBLISH_RACE_ATTEMPTS):
        git(args.repo, "fetch", "origin", "main")
        remote = git(args.repo, "rev-parse", "origin/main")
        if status_is_newer(status_at(args.repo, remote), status):
            return "superseded"
        command(["git", "read-tree", remote], args.repo, env=env)
        body = json.dumps(status, ensure_ascii=False, indent=2) + "\n"
        blob = subprocess.run(["git", "hash-object", "-w", "--stdin"], cwd=args.repo,
                              input=body, text=True, capture_output=True, check=True).stdout.strip()
        command(["git", "update-index", "--add", "--cacheinfo", "100644", blob, STATUS_PATH],
                args.repo, env=env)
        tree = command(["git", "write-tree"], args.repo, env=env)
        if tree == git(args.repo, "rev-parse", f"{remote}^{{tree}}"):
            return "no_change"
        proposed = git(args.repo, "-c", "user.name=fenok-sec13f",
                       "-c", "user.email=fenok-sec13f@local", "commit-tree", tree,
                       "-p", remote, "-m", "ops: record scheduled SEC 13F lane status")
        result = subprocess.run(["git", "push", "origin", f"{proposed}:refs/heads/main"],
                                cwd=args.repo, text=True, capture_output=True, timeout=120)
        if result.returncode == 0:
            return "published"
    raise PublicationFailed("13F status publication lost three push races")


def collect(args, candidate, runtime):
    # Importing yaml explicitly prevents the converter's reduced fallback universe.
    import yaml
    configured = yaml.safe_load((args.converter_root / "config/investors.yaml").read_text())
    if not configured.get("investors"):
        raise RuntimeError("Canonical converter investor configuration is missing")
    output = runtime / "output"
    shutil.copytree(candidate / DATA_ROOT, output)
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
        target = candidate / DATA_ROOT / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    env["FENOK_FF_RAW_CACHE"] = str(args.state_root / "factor-cache")
    for builder in BUILDERS:
        command(["node", f"scripts/{builder}"], candidate, timeout=10 * 60, env=env, capture=False)
    return "candidate_ready"


def _now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, type=Path)
    parser.add_argument("--converter-root", required=True, type=Path)
    parser.add_argument("--state-root", required=True, type=Path)
    parser.add_argument("--publish", action="store_true")
    args = parser.parse_args()
    args.repo, args.converter_root, args.state_root = (
        value.resolve() for value in (args.repo, args.converter_root, args.state_root))
    if sys.platform != "linux":
        raise RuntimeError("This producer runs on the authorized A1 Linux host")
    if git(args.repo, "status", "--porcelain"):
        raise RuntimeError("Collector checkout is dirty; preserve it and stop")
    if git(args.repo, "remote", "get-url", "origin") != "git@github-100xf-a1:etloveaui/100xFenok.git":
        raise RuntimeError("Collector is not bound to the existing A1 product remote")
    # The collector owns this checkout and is serialized by the service flock.
    # Provider files are ignored runtime inputs after the generation cutover.
    git(args.repo, "fetch", "origin", "main")
    git(args.repo, "merge", "--ff-only", "origin/main")
    runtime = args.state_root / "runs" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    runtime.mkdir(parents=True)
    env = dict(os.environ, RUNNER_TEMP=str(runtime))
    reconciled = reconcile_state(read_json(args.repo / STATUS_PATH, {}),
                                 read_json(args.state_root / "last-run.json", {}))
    outcome, error, generation = "failed", None, None
    served_clock = (None, None)
    collected_clock = served_clock
    try:
        basis = json.loads(command(["node", "scripts/materialize-cloud-data-plane-family.mjs",
                                    "--hydrate-sec-13f"], args.repo, env=env, timeout=15 * 60))
        served_clock = source_clock(args.repo / DATA_ROOT)
        collected_clock = served_clock
        for flag in ("--hydrate-global-scouter-build", "--hydrate-scouter-derived", "--hydrate-yahoo-analytics"):
            command(["node", "scripts/materialize-cloud-data-plane-family.mjs", flag],
                    args.repo, env=env, timeout=15 * 60)
        outcome = collect(args, args.repo, runtime)
        collected_clock = source_clock(args.repo / DATA_ROOT)
        if outcome == "candidate_ready" and args.publish:
            publish_env = dict(env,
                PUBLISH_EXPECTED_ACTIVE_GENERATION_ID=basis["generation_id"],
                PUBLISH_EXPECTED_ACTIVE_MANIFEST_SHA256=basis["manifest_sha256"])
            result = json.loads(command(["node", "scripts/publish-cloud-data-generation.mjs",
                                        "--family=sec-13f", "--json"], args.repo,
                                       env=publish_env, timeout=15 * 60))
            if result.get("result") not in ("published", "resumed"):
                raise RuntimeError(f"13F generation was not promoted: {result.get('result')}")
            generation = result.get("generation_id")
            outcome = "published"
        elif outcome == "retained":
            generation = basis["generation_id"]
    except Exception as exc:
        outcome, error = "failed", str(exc)
    finished = _now()
    state = build_state(outcome, error, collected_clock, served_clock, reconciled, 0,
                        finished, args.publish, publication="published" if args.publish else "none")
    state["last_run"]["generation_id"] = generation
    write_json(args.state_root / "last-run.json", state)
    if args.publish:
        try:
            publication = publish_status_only(args, state, runtime / "status.index")
            state["last_run"]["status_publication"] = publication
            state["last_run"]["published"] = publication in ("published", "no_change")
        except Exception as exc:
            state["last_run"]["status_publication"] = "failed"
            state["last_run"]["published"] = False
            state["last_run"]["status_publication_error"] = str(exc)
            write_json(args.state_root / "last-run.json", state)
            print(json.dumps(state["last_run"]))
            return 1
        write_json(args.state_root / "last-run.json", state)
    # Failures retain the converter candidate. A successfully promoted/retained
    # generation is the retained-good copy; only this run's scratch is removed.
    if error is None and outcome in SUCCESS_OUTCOMES and args.publish:
        shutil.rmtree(runtime)
    print(json.dumps(state["last_run"]))
    return 0 if error is None and outcome in (*SUCCESS_OUTCOMES, "candidate_ready") else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"SEC 13F lane failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
