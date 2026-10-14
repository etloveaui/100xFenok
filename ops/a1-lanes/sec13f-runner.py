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
import time
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
INPUT_ROOTS = (
    "scripts", "100xfenok-next/src/lib", "100xfenok-next/scripts/cloud-data-plane", "data/sec-13f",
    "data/global-scouter/core", "data/yf/finance", "data/yf/quarter_closes.json",
    "data/edgar/company_tickers.json", STATUS_PATH,
)
SPARSE_ROOTS = (
    "scripts", "ops/a1-lanes", "100xfenok-next/src/lib", "100xfenok-next/scripts/cloud-data-plane",
    "data/sec-13f", "data/global-scouter/core", "data/yf", "data/edgar",
)
# A publication only advances the lane when its own payload or its heartbeat
# reached main. Everything else keeps the failure count alive.
SUCCESS_OUTCOMES = ("published", "retained")
# The existing push-race bound is unchanged; a busy writer is waited out inside
# the same bounded loop instead of failing the run on the first observation.
PUBLISH_RACE_ATTEMPTS = 3
WRITER_WAIT_SECONDS = 60
# One bounded recollection from the refreshed main is allowed per invocation,
# and only for the input race the fence reports.
REBUILD_LIMIT = 1


class RetryableInputRace(RuntimeError):
    """A data publication whose inputs changed while it was being collected."""


class PublicationDeferred(RuntimeError):
    """A writer stayed busy for the bounded wait; retain and report honestly."""


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


def prepare_attempt(args, candidate, base):
    git(args.repo, "worktree", "add", "--detach", "--no-checkout", str(candidate), base)
    git(candidate, "sparse-checkout", "set", "--cone", *SPARSE_ROOTS)
    git(candidate, "checkout", base)


def assert_writer_idle():
    """None when no known writer runs, otherwise the reason to keep waiting."""
    payload = json.loads(command([
        "gh", "api", "repos/etloveaui/100xFenok/actions/runs?status=in_progress&per_page=100",
    ], Path.cwd(), timeout=30))
    if len(payload.get("workflow_runs", [])) >= 100:
        return "Writer activity page is full; cannot prove an idle publication window"
    busy = [run["name"] for run in payload.get("workflow_runs", [])
            if any(name in run["name"].lower()
                   for name in ("stockanalysis", "stocks analyzer", "update manifest"))]
    if busy:
        return "Publication deferred while writers run: " + ", ".join(sorted(set(busy)))
    return None


def publish(candidate, base, paths, *, data_publication):
    """Merge only independent incoming changes; never overwrite a newer input.

    A data publication still stops when its inputs changed under it. A
    status-only update carries no collected payload, so it keeps the same
    optimistic push retry without the input fence.
    """
    git(candidate, "add", "--", *paths)
    if not git(candidate, "diff", "--cached", "--name-only"):
        return None
    git(candidate, "-c", "user.name=fenok-sec13f",
        "-c", "user.email=fenok-sec13f@local", "commit", "-m",
        "data: record scheduled SEC 13F collection", "--", *paths)
    generated = git(candidate, "rev-parse", "HEAD")
    for attempt in range(PUBLISH_RACE_ATTEMPTS):
        busy = assert_writer_idle()
        if busy is not None:
            if attempt + 1 < PUBLISH_RACE_ATTEMPTS:
                time.sleep(WRITER_WAIT_SECONDS)
                continue
            raise PublicationDeferred(busy)
        git(candidate, "fetch", "origin", "main")
        remote = git(candidate, "rev-parse", "origin/main")
        if data_publication and git(candidate, "diff", "--name-only", base, remote, "--", *INPUT_ROOTS):
            raise RetryableInputRace("13F inputs changed during collection; retry from the new main")
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
    raise PublicationFailed("13F publication lost three push races; retained for retry")


def publish_status_only(args, status, scratch):
    """Publish one heartbeat file on the current main tip.

    A status-only update carries no collected data, so unrelated input changes
    cannot block it, and it is committed on a fresh tip of main so no stale
    candidate tree travels with it. A newer report for this lane is never
    overwritten by an older attempt. Returns what happened: "published",
    "superseded" or "no_change".
    """
    scratch.parent.mkdir(parents=True, exist_ok=True)
    for _ in range(PUBLISH_RACE_ATTEMPTS):
        git(args.repo, "fetch", "origin", "main")
        remote = git(args.repo, "rev-parse", "origin/main")
        if status_is_newer(status_at(args.repo, remote), status):
            return "superseded"
        if not (scratch / ".git").exists():
            git(args.repo, "worktree", "add", "--detach", "--no-checkout", str(scratch), remote)
            git(scratch, "sparse-checkout", "set", "--cone", "ops/a1-lanes")
            git(scratch, "checkout", remote)
        else:
            git(scratch, "checkout", "--detach", remote)
        write_json(scratch / STATUS_PATH, status)
        git(scratch, "add", "--", STATUS_PATH)
        if not git(scratch, "diff", "--cached", "--name-only"):
            return "no_change"
        git(scratch, "-c", "user.name=fenok-sec13f",
            "-c", "user.email=fenok-sec13f@local", "commit", "-m",
            "ops: record scheduled SEC 13F lane status", "--", STATUS_PATH)
        proposed = git(scratch, "rev-parse", "HEAD")
        result = subprocess.run(["git", "push", "origin", f"{proposed}:refs/heads/main"],
                                cwd=scratch, text=True, capture_output=True, timeout=120)
        if result.returncode == 0:
            git(args.repo, "fetch", "origin", "main")
            git(args.repo, "merge-base", "--is-ancestor", proposed, "origin/main")
            return proposed
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
    args.repo = args.repo.resolve()
    args.converter_root = args.converter_root.resolve()
    args.state_root = args.state_root.resolve()
    if sys.platform != "linux":
        raise RuntimeError("This producer runs on the authorized A1 Linux host")
    # Untrusted preconditions stay outside the reporting path: without a clean
    # checkout bound to the product remote there is no evidence to report from.
    if git(args.repo, "status", "--porcelain"):
        raise RuntimeError("Collector checkout is dirty; preserve it and stop")
    if git(args.repo, "remote", "get-url", "origin") != "git@github-100xf-a1:etloveaui/100xFenok.git":
        raise RuntimeError("Collector is not bound to the existing A1 product remote")
    # The checkout is verified from here on, so its committed status and served
    # clock are the prior truth, and every remaining failure reports a status.
    reconciled = reconcile_state(
        read_json(args.repo / STATUS_PATH, {}),
        read_json(args.state_root / "last-run.json", {}),
    )
    served_clock = source_clock(args.repo / DATA_ROOT)
    started = datetime.now(timezone.utc)
    runtime = args.state_root / "runs" / started.strftime("%Y%m%dT%H%M%S.%fZ")
    attempt = 0
    published = None
    publication = "none"
    candidate = runtime / "candidate"
    outcome, error = "failed", None
    collected_clock = served_clock
    try:
        git(args.repo, "fetch", "origin", "main")
        git(args.repo, "merge-base", "--is-ancestor", "HEAD", "origin/main")
        git(args.repo, "merge", "--ff-only", "origin/main")
        base = git(args.repo, "rev-parse", "HEAD")
        served_clock = source_clock(args.repo / DATA_ROOT)
        reconciled = reconcile_state(reconciled, read_json(args.repo / STATUS_PATH, {}))
        while True:
            attempt_runtime = (runtime if attempt == 0
                               else runtime.with_name(f"{runtime.name}-r{attempt}"))
            attempt_runtime.mkdir(parents=True, exist_ok=True)
            candidate = attempt_runtime / "candidate"
            error = None
            try:
                prepare_attempt(args, candidate, base)
                outcome = collect(args, candidate, attempt_runtime)
            except Exception as exc:
                outcome, error = "failed", str(exc)
            # Only a data candidate is published here. Every status-only outcome
            # (retained, failure, deferral) goes through the one-path publisher
            # below, on a fresh main tip and without the writer gate.
            if error is not None or not args.publish or outcome != "candidate_ready":
                break
            collected_clock = source_clock(candidate / DATA_ROOT)
            write_json(candidate / STATUS_PATH, build_state(
                "published", None, collected_clock, served_clock, reconciled, attempt, _now(),
                args.publish, publication="with_data"))
            try:
                published = publish(candidate, base, [DATA_ROOT, STATUS_PATH],
                                    data_publication=True)
                outcome, publication = "published", "with_data"
                break
            except RetryableInputRace as exc:
                if attempt >= REBUILD_LIMIT:
                    outcome, error = "failed", str(exc)
                    break
                # The collected payload stays unpublished. One bounded recollection
                # runs from the refreshed main in its own attempt directory, and a
                # refresh failure is reported rather than escaping the handler.
                attempt += 1
                try:
                    git(args.repo, "fetch", "origin", "main")
                    git(args.repo, "merge", "--ff-only", "origin/main")
                    base = git(args.repo, "rev-parse", "HEAD")
                    served_clock = source_clock(args.repo / DATA_ROOT)
                except Exception as refresh_error:
                    outcome = "failed"
                    error = f"recollection refresh failed: {refresh_error}"
                    break
            except PublicationDeferred as exc:
                outcome, error = "deferred", str(exc)
                break
            except Exception as exc:
                outcome, error = "failed", str(exc)
                break
    except Exception as exc:
        outcome, error = "failed", str(exc)

    finished = _now()
    # The report this attempt hands to the status publisher already states that it
    # reached main; the value is only committed when that publication happens, and
    # a superseded or failed publication replaces it in the local record below.
    initial_publication = "with_data" if outcome == "published" else (
        "published" if args.publish else "none")
    state = build_state(outcome, error, collected_clock, served_clock, reconciled, attempt,
                        finished, args.publish, publication=initial_publication)
    # The local record is durable and is written before any heartbeat, so an
    # unpublished failure survives even when the status publication also fails.
    write_json(args.state_root / "last-run.json", state)
    status_error = None
    publication = initial_publication
    if args.publish and outcome != "published":
        try:
            publication = publish_status_only(args, state, args.state_root / "status-worktree")
        except Exception as exc:
            publication, status_error = "failed", str(exc)
        if publication != "published":
            state = build_state(outcome, error, collected_clock, served_clock, reconciled, attempt,
                                finished, args.publish, publication=publication)
            if status_error is not None:
                state["last_run"]["status_publication_error"] = status_error
            write_json(args.state_root / "last-run.json", state)
    if status_error is not None:
        print(json.dumps({"outcome": state["last_run"]["outcome"], "error": error,
                          "status_publication_error": status_error,
                          "candidate": str(candidate)}))
        return 1
    # A clean candidate is removable only when its revision is already on main.
    # Failed/unpublished output stays available; no reset, clean or forced removal.
    if candidate.exists():
        try:
            if not git(candidate, "status", "--porcelain"):
                ancestor = subprocess.run(
                    ["git", "merge-base", "--is-ancestor", "HEAD", "origin/main"], cwd=candidate)
                if ancestor.returncode == 0:
                    git(args.repo, "worktree", "remove", str(candidate))
        except Exception as cleanup_error:
            print(f"SEC 13F candidate cleanup skipped: {cleanup_error}", file=sys.stderr)
    print(json.dumps({"outcome": state["last_run"]["outcome"],
                      "source_as_of": state["last_run"]["source_as_of"],
                      "consecutive_failures": state["consecutive_failures"], "rebuilds": attempt,
                      "status_publication": publication, "published": published,
                      "candidate": str(candidate), "error": error}))
    return 1 if error else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"SEC 13F lane failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
