"""100x data watch: launchd com.fenok.100x-data-watch runs this on M4 every 30 minutes.

python watch.py [--dry-run] [--state-dir DIR] [--tag TEXT] [--now ISO]

It tells the owner when 100x data collection breaks or a watcher stops: one Korean line per state CHANGE through AA's
ops-alert route (briefing.alert.ops_send, Gateway class ops_alert). Workflow metadata and the active plane ledger use at
most 7 GitHub API calls:

  issues  open issues whose title ends with "alarm" (every alarm workflow titles its issue so; none sets a label)
  alarm   completion time of the newest successful `check` job of pipeline-failure-alarm.yml (the job that judges
          and writes the issue and promotes alarm state)
  clock   creation time of the newest workflow_dispatch run titled "external-clock/a1/v1 ..."
  ledger  active plane generated_at and the declared Update Manifest calendar on main

The first run records a baseline and sends nothing. A line the Gateway did not deliver is retried on the next run.
"""
from __future__ import annotations

import argparse
import copy
import datetime as dt
import hashlib
import html
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

HOME = Path.home()
for _base in (Path(__file__).resolve().parents[1], HOME / ".local/share/100x-briefing/repo/scripts"):
    if (_base / "briefing" / "alert.py").exists():
        sys.path.insert(0, str(_base))
        break
from briefing import alert  # noqa: E402 - the existing ops-alert sender
from briefing.common import read_json, write_json  # noqa: E402

API = "https://api.github.com/repos/etloveaui/100xFenok"
STATE_DIR = HOME / ".local/state/100x-data-watch"
SECRETS = HOME / ".secrets/all-keys.env"  # the file run_m4.sh reads; only GITHUB_TOKEN is taken and it is never printed
# name: (Korean noun, subject particle, bound in minutes, what is missing). Sources of the bounds:
#   alarm   2 x its cadence (cron '23 * * * *' plus the A1 clock slot :23); the age is that of the `check` job.
#   clock   3 x the longest gap between declared clock slots, 15 minutes (:49 -> :04, ops/a1-lanes/external-clock.mjs;
#           measured maximum 15.0 minutes over 80 marked runs on 2026-10-11).
#   ledger  two declared Update Manifest slots plus its one-hour execution allowance.
CHECKS = {
    "issues": ("경보 이슈 목록", "이", None, ""),
    "alarm": ("경보 워크플로", "가", 120, "성공 실행 없음"),
    "clock": ("A1 시계", "가", 45, "실행 없음"),
    "ledger": ("건강 원장", "이", None, "갱신 없음"),
}
UNREAD_MIN = 120  # a read that keeps failing this long is reported once (past the alarm bound nothing vouches for the alarm)
REASONS = {"failure_streak": "연속 실패", "missed_schedule_window": "실행 누락", "lost_schedule_slot": "예약 실행 유실",
           "a1_clock_stale": "A1 시계 멈춤", "data_stopped_two_generations": "데이터 정지",
           "health_record_stale": "건강 기록 멈춤",
           "serving_heartbeat_stale": "게시 갱신 기한 초과", "serving_source_stale": "원본 데이터 기한 초과",
           "stockanalysis_etf_detail:member_ratio_low": "StockAnalysis ETF 갱신 범위 부족",
           "yahoo_etf_fallback:member_ratio_low": "Yahoo ETF 갱신 범위 부족",
           "yahoo_batch_quote_history:member_ratio_low": "Yahoo 시세 이력 갱신 범위 부족"}
# "- <set>: member_ratio_low[, other reasons]; source ..." (a set that also stopped advancing lists both reasons).
MEMBER_LINE = re.compile(r"- ([a-z][a-z0-9_]*): ([a-z][a-z0-9_]*(?:, [a-z][a-z0-9_]*)*); source .+")
MEMBER_COUNT = re.compile(r"Members inside bound: (\d+)/(\d+)")
LEGACY_COUNT = re.compile(r"Members inside bound: \d+/\d+")
IMPROVE_MIN = 3  # an improvement is a line only after this many members came back (or at zero); any worsening is a line
DELIVERED = ("success", "dedup_skipped", "already_delivered")
MAX_CALLS = 7  # the Manifest calendar plus the existing six reads/probes
TOKEN: str | None = None
RATE = ""
CALLS = 0


def ts(s: str) -> dt.datetime:
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def iso(t: dt.datetime) -> str:
    return t.astimezone(dt.timezone.utc).isoformat(timespec="seconds")


def dur(minutes: int) -> str:
    if minutes < 120:
        return f"{minutes}분"
    return f"{minutes // 60}시간" + (f" {minutes % 60}분" if minutes % 60 else "")


def load_token() -> str | None:
    try:
        m = re.search(r"^(?:export )?GITHUB_TOKEN=[\"']?([^\"'\s]+)", SECRETS.read_text(encoding="utf-8"), re.M)
    except OSError:
        return None
    return m.group(1) if m else None


def gh(path: str, accept: str = "application/vnd.github+json", *, as_text=False):
    """One GitHub GET. A rejected token is dropped for the rest of the run: the repository is public."""
    global TOKEN, RATE, CALLS
    while True:
        CALLS += 1
        headers = {"Accept": accept, "User-Agent": "100x-data-watch", "X-GitHub-Api-Version": "2022-11-28"}
        if TOKEN:
            headers["Authorization"] = f"Bearer {TOKEN}"
        try:
            with urllib.request.urlopen(urllib.request.Request(API + path, headers=headers), timeout=20) as r:
                RATE = f"{r.headers.get('X-RateLimit-Remaining')}/{r.headers.get('X-RateLimit-Limit')}"
                return r.read().decode("utf-8") if as_text else json.load(r)
        except urllib.error.HTTPError as e:
            if e.code != 401 or not TOKEN:
                raise
            TOKEN = None


def read_issues() -> dict:
    rows = gh("/issues?state=open&per_page=100")
    if len(rows) >= 100:
        raise RuntimeError("open issue list may be incomplete (100 rows)")
    out = {}
    for r in rows:
        if "pull_request" in r or not r["title"].strip().lower().endswith("alarm"):
            continue
        inc, head, member_reason = {}, None, None
        details, legacy_aliases, counts = {}, {}, {}
        for line in (r.get("body") or "").splitlines():  # the alarm rewrites the body: "## <incident>" + "- Alarm reasons: a, b"
            if line.startswith("## "):
                member_reason = None
                head = re.sub(r"\s*\(`[^`]*`\)\s*$", "", line[3:].strip())
                inc.setdefault(head, [])
            elif line.startswith("- FAIL "):
                member_reason = None
                head = line.removeprefix("- FAIL ").strip()
                inc.setdefault(head, [])
            elif head and line.startswith("- Alarm reasons:"):
                inc[head] = sorted(set(inc[head]) | {x.strip() for x in line.split(":", 1)[1].split(",") if x.strip()})
            elif head == "Data health KPI" and (member := MEMBER_LINE.fullmatch(line)):
                member_reason = None
                if "member_ratio_low" in member[2].split(", "):
                    member_reason = f"{member[1]}:member_ratio_low"
                    inc[head] = sorted(set(inc[head]) | {member_reason})
            elif head and line.startswith("  - "):
                reason = line.strip().removeprefix("- ")
                if member_reason and (found := MEMBER_COUNT.fullmatch(reason)):
                    # Numeric evidence stays in the message, not its transition identity.
                    count = reason.split(":", 1)[1].strip()
                    details[member_reason] = f"{REASONS.get(member_reason, member_reason)} ({count})"
                    counts[member_reason] = [int(found[1]), int(found[2])]
                    legacy_aliases[reason] = member_reason
                    continue
                if "heartbeat limit" in reason:
                    reason = "serving_heartbeat_stale"
                elif "source" in reason.lower() and "old" in reason.lower():
                    reason = "serving_source_stale"
                inc[head] = sorted(set(inc[head]) | {reason})
        out[str(r["number"])] = {"title": r["title"], "url": r["html_url"], "incidents": inc,
                                 "reason_details": details, "legacy_reason_aliases": legacy_aliases,
                                 "member_counts": counts}
    return out


def read_alarm() -> dt.datetime:
    runs = gh("/actions/workflows/pipeline-failure-alarm.yml/runs?per_page=5")["workflow_runs"]
    probed = 0
    for r in runs:  # newest first; the call budget allows two probes (one after a rejected token)
        if CALLS >= MAX_CALLS:
            break
        probed += 1
        for job in gh(f"/actions/runs/{r['id']}/jobs")["jobs"]:
            if job["name"] == "check" and job.get("conclusion") == "success":
                return ts(job["completed_at"])
    raise RuntimeError(f"no successful check job in the {probed} newest alarm runs")


def read_clock() -> dt.datetime:
    runs = gh("/actions/runs?event=workflow_dispatch&per_page=50")["workflow_runs"]
    marked = [ts(r["created_at"]) for r in runs if (r.get("display_title") or "").startswith("external-clock/a1/v1")]
    # No marked run among the newest 50 dispatches: the newest marked run is older than every run listed.
    return max(marked) if marked else min(ts(r["created_at"]) for r in runs)


def ledger_deadline(generated: dt.datetime, workflow: str) -> dt.datetime:
    def field(raw, lower, upper):
        values = set()
        for token in raw.split(","):
            base, _, step = token.partition("/")
            stride = int(step or "1")
            if base == "*":
                first, last = lower, upper
            elif "-" in base:
                first, last = map(int, base.split("-"))
            else:
                first, last = int(base), upper if step else int(base)
            if stride < 1 or not lower <= first <= last <= upper:
                raise ValueError("invalid Manifest cron field")
            values.update(range(first, last + 1, stride))
        return values

    crons = re.findall(r"^\s*-\s*cron:\s*['\"]([^'\"]+)['\"]", workflow, re.M)
    calendars = []
    for cron in crons:
        parts = cron.split()
        if len(parts) != 5:
            raise ValueError("invalid Manifest cron")
        values = [field(raw, lo, hi) for raw, (lo, hi) in zip(parts, ((0, 59), (0, 23), (1, 31), (1, 12), (0, 7)))]
        values[4] = {day % 7 for day in values[4]}
        calendars.append((parts, values))
    if not calendars:
        raise ValueError("Manifest schedule is unavailable")
    cursor = generated.astimezone(dt.timezone.utc).replace(second=0, microsecond=0)
    slots = 0
    for _ in range(400 * 1440):
        cursor += dt.timedelta(minutes=1)
        for parts, (minutes, hours, days, months, weekdays) in calendars:
            dom, dow = cursor.day in days, (cursor.weekday() + 1) % 7 in weekdays
            day_ok = dom and dow if parts[2].startswith("*") or parts[4].startswith("*") else dom or dow
            if cursor.minute in minutes and cursor.hour in hours and cursor.month in months and day_ok:
                slots += 1
                if slots == 2:
                    return cursor + dt.timedelta(hours=1)
                break
    raise ValueError("two Manifest slots were not found")


def read_ledger() -> dt.datetime:
    request = urllib.request.Request("https://100xfenok.etloveaui.workers.dev/data/admin/fenok-data-health-kpi.json", headers={"User-Agent": "100x-data-watch/1"})
    with urllib.request.urlopen(request, timeout=20) as response:
        if not response.headers.get("x-data-plane-generation", "").startswith("platform-projections-"):
            raise ValueError("health ledger has no active plane generation")
        generated = ts(json.load(response)["generated_at"])
    workflow = gh("/contents/.github/workflows/update-manifest.yml?ref=main", "application/vnd.github.raw+json", as_text=True)
    deadline = ledger_deadline(generated, workflow)
    noun, particle, _, reason = CHECKS["ledger"]
    CHECKS["ledger"] = (noun, particle, int((deadline - generated).total_seconds() / 60), reason)
    return generated


READERS = {"issues": read_issues, "clock": read_clock, "ledger": read_ledger, "alarm": read_alarm}  # alarm last: it probes


def idents(incidents: dict, aliases: dict | None = None, current: dict | None = None) -> set:
    aliases = aliases or {}
    found = {(h, aliases.get(r, r)) for h, rs in incidents.items() for r in (rs or [""])}
    legacy = {(h, r) for h, r in found if LEGACY_COUNT.fullmatch(r)}
    if legacy:  # state written before counts left the identity: the sets it covered are already announced
        found -= legacy
        found |= {(h, r) for h, rs in (current or {}).items() for r in rs if r.endswith(":member_ratio_low")}
    return found


def count_update(old_counts: dict, new_counts: dict) -> list[tuple[str, str, list, list]]:
    """Same incident, new member count: (reason, 'improved'|'worsened', old, new). An improvement is a line only when it
    is material; a worsening always is. Counts are outside-bound members, so a smaller total with the same fresh set
    still reads as improved."""
    out = []
    for reason, new in sorted(new_counts.items()):
        old = old_counts.get(reason)
        if not old or old == new:
            continue
        before, after = old[1] - old[0], new[1] - new[0]
        if after > before:
            out.append((reason, "worsened", old, new))
        elif before - after >= IMPROVE_MIN or (after == 0 and before > 0):
            out.append((reason, "improved", old, new))
    return out


def summary(pairs: set, fallback: str, details: dict | None = None) -> str:
    details = details or {}
    by: dict[str, list[str]] = {}
    for h, r in sorted(pairs):
        by.setdefault(h, []).append(details.get(r, REASONS.get(r, r)))
    parts = [h + (f"({', '.join(x for x in rs if x)})" if any(rs) else "") for h, rs in by.items()]
    return (", ".join(parts[:2]) + (f" 외 {len(parts) - 2}건" if len(parts) > 2 else "")) or fallback


def run(a: argparse.Namespace) -> int:
    global TOKEN
    now = ts(a.now) if a.now else dt.datetime.now(dt.timezone.utc)
    sdir = Path(a.state_dir).expanduser() if a.state_dir else (STATE_DIR / "dry-run" if a.dry_run else STATE_DIR)
    prev = read_json(sdir / "state.json")
    baseline = not prev
    new = copy.deepcopy(prev) if prev else {"issues": {}, "checks": {}}
    TOKEN = load_token()
    auth = "token" if TOKEN else "anonymous"

    values, errors = {}, {}
    for name, reader in READERS.items():
        try:
            values[name] = reader()
        except Exception as ex:  # noqa: BLE001 - an unreadable source is a state of its own, never an all-clear
            errors[name] = f"{type(ex).__name__}: {ex}"[:200]
    if auth == "token" and not TOKEN:
        auth = "anonymous (token rejected)"

    events, live, e = [], {}, html.escape  # events: (key, line, apply-to-state); a state changes only once its line is delivered
    for name, (noun, josa, bound, what) in CHECKS.items():
        c = new["checks"].setdefault(name, {"level": "ok"})
        if name in errors:
            stamp = c.setdefault("unread_since", iso(now))
            mins = int((now - ts(stamp)).total_seconds() // 60)
            level = "unread" if mins > UNREAD_MIN else c["level"]
            line = f"100x 감시 불가: {noun} 확인 {dur(mins)}째 실패 ({e(errors[name])})"
        else:
            c.pop("unread_since", None)
            age = int((now - values[name]).total_seconds() // 60) if bound else None
            level = "stopped" if bound and age > bound else "ok"
            if bound:
                live[name] = {"age_min": age, "bound_min": bound, "ref": iso(values[name])}
            if level == "stopped":
                stamp, line = iso(values[name]), f"100x 감시 중단: {noun}{josa} {dur(age)}째 {what} (기준 {dur(bound)})"
            else:
                stamp, line = c.get("since", ""), f"100x 감시 재개: {noun} 정상" + (f" (최근 {dur(age)} 전)" if bound else "")
        live.setdefault(name, {})["level"] = level
        if level != c["level"]:
            if baseline:
                c.update(level=level, since=stamp)
            else:
                events.append((f"{name}:{level}:{stamp}", line,
                               lambda s, n=name, lv=level, st=stamp: s["checks"][n].update(level=lv, since=st)))

    if "issues" not in errors:
        cur = values["issues"]
        for num, it in cur.items():
            old, link = new["issues"].get(num), f'<a href="{e(it["url"])}">이슈 #{num}</a>'
            now_ids = idents(it["incidents"])
            added = now_ids - idents(old["incidents"], it.get("legacy_reason_aliases"), it["incidents"]) if old else set()
            put = lambda s, n=num, v=it: s["issues"].__setitem__(n, v)  # noqa: E731
            if old is None and not baseline:
                events.append((f"issue:{num}:opened", f"100x 데이터 경보 열림: {e(summary(now_ids, it['title'], it.get('reason_details')))} {link}", put))
            elif added:  # a new incident or a new reason; a growing streak alone is not a line (the alarm's own comment rule)
                digest = hashlib.sha1(json.dumps(sorted(now_ids)).encode()).hexdigest()[:10]
                events.append((f"issue:{num}:worsened:{digest}",
                               f"100x 데이터 경보 악화: {e(summary(added, it['title'], it.get('reason_details')))} 추가 {link}", put))
            else:
                # The announced count is the baseline: a change too small to announce stays out of the snapshot so it
                # can accumulate, and an announced one enters the snapshot only when its line is delivered.
                old_counts, now_counts = (old or {}).get("member_counts") or {}, it.get("member_counts") or {}
                ups = count_update(old_counts, now_counts) if old else []
                new["issues"][num] = {**it, "member_counts": {r: old_counts.get(r, c) for r, c in now_counts.items()}}
                for reason, direction, before, after in ups:
                    label = REASONS.get(reason, reason)
                    word = "개선" if direction == "improved" else "악화"
                    events.append((f"issue:{num}:count:{reason}:{before[0]}/{before[1]}>{after[0]}/{after[1]}",
                                   f"100x 데이터 경보 {word}: {e(label)} 범위 내 {before[0]}/{before[1]} → {after[0]}/{after[1]} {link}",
                                   lambda s, n=num, r=reason, c=after: s["issues"][n]["member_counts"].__setitem__(r, c)))
        for num, old in list(new["issues"].items()):
            if num not in cur:
                link = f'<a href="{e(old["url"])}">이슈 #{num}</a>'
                events.append((f"issue:{num}:closed",
                               f"100x 데이터 경보 복구: {e(summary(idents(old['incidents']), old['title']))} {link}",
                               lambda s, n=num: s["issues"].pop(n, None)))

    sent, failure = [], None
    for key, line, apply in events:
        line = f"{a.tag} {line}" if a.tag else line
        run_id = ("data_watch_test:" if a.tag else "data_watch:") + key
        if a.dry_run:
            print(f"DRY-RUN would send [{run_id}] {line}")
            res = {"status": "success"}
        else:
            try:
                res = alert.ops_send(line, run_id)
            except Exception as ex:  # noqa: BLE001
                res = {"status": "error", "errors": [f"{type(ex).__name__}: {ex}"[:300]]}
        if res.get("status") not in DELIVERED:
            failure = f"{run_id}: {res.get('status')} {res.get('errors') or res.get('reason') or ''}"[:400]
            break  # a flood wait or any delivery error: record it and stop; the change is retried on the next run
        apply(new)
        sent.append({"run_id": run_id, "status": res.get("status"), "line": line})

    new["updated_at"] = iso(now)
    write_json(sdir / "state.json", new)
    shown = values.get("issues", new["issues"])
    write_json(sdir / "status.json", {
        "time": iso(now), "open_incidents": [{"issue": int(n), **v} for n, v in sorted(shown.items())], "liveness": live,
        "errors": errors, "github": {"auth": auth, "rate": RATE, "calls": CALLS}, "sent": sent, "delivery_error": failure,
        "baseline": baseline, "dry_run": a.dry_run})
    ages = " ".join(f"{n}={live[n].get('age_min', '?')}m/{live[n]['level']}" for n in ("alarm", "clock", "ledger"))
    msg = (f"{iso(now)} issues={len(shown)} {ages} errors={sorted(errors) or '-'} auth={auth} "
           f"sent={len(sent)}/{len(events)}{' baseline' if baseline else ''}{' dry-run' if a.dry_run else ''}"
           + "".join(f"\n  sent {s['status']} {s['line']}" for s in sent) + (f"\n  DELIVERY ERROR {failure}" if failure else ""))
    log = sdir / "watch.log"
    with log.open("a", encoding="utf-8") as f:
        f.write(msg + "\n")
    if log.stat().st_size > 256_000:
        log.write_text("".join(log.read_text(encoding="utf-8").splitlines(True)[-1000:]), encoding="utf-8")
    if a.dry_run:
        print(msg)
    return 1 if failure else 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="print the lines instead of sending; state goes to <state>/dry-run")
    ap.add_argument("--state-dir", help="state folder (default ~/.local/state/100x-data-watch)")
    ap.add_argument("--tag", help="prefix for every line, for a staged proof (uses a separate Gateway run-id namespace)")
    ap.add_argument("--now", help="pretend this UTC time (dry run only)")
    a = ap.parse_args(argv)
    if a.now and not a.dry_run:
        ap.error("--now needs --dry-run")
    return run(a)


if __name__ == "__main__":
    sys.exit(main())
