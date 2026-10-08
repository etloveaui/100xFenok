"""Daily orchestrator for the 100x Morning Brief article.

python -m briefing.run_morning [--edition YYYY-MM-DD] [--dry-run] [--no-wait] [--force] [--index PATH]

Live run: wait for the AA morning brief -> market pack -> 시장 체력 -> writer (Opus 5.5, Sonnet 5.5 on failure)
-> gates -> commit data/briefing/** from the job worktree and push -> wait for the public data URL
-> Telegram link once per date. A failure writes the log and the edition state file and sends nothing.
--dry-run: no commit, no push, no Telegram; outputs go to ~/.local/state/100x-briefing/runs/<date>-dry/.
"""
from __future__ import annotations

import argparse
import hashlib
import copy
import datetime as dt
import json
import logging
import re
import sys
import time
from pathlib import Path

from . import edge, market_pack, notify, publish, stats, validate, writer
from .common import CFG, KST, et_to_kst, expand, now_kst, read_json, state_path, write_json

log = logging.getLogger("briefing")
A = CFG["aa"]


def setup_logging(run_dir: Path) -> None:
    run_dir.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    for h in (logging.StreamHandler(sys.stderr), logging.FileHandler(run_dir / "run.log", encoding="utf-8")):
        h.setFormatter(fmt)
        root.addHandler(h)


def aa_root() -> Path:
    return expand(A["root"])


def find_inputs(ymd: str) -> tuple[Path | None, Path | None]:
    root = aa_root()
    brief = root / A["brief"].format(ymd=ymd)
    cards = sorted(root.glob(A["fact_cards_glob"].format(ymd=ymd)))
    ok_brief = brief if brief.exists() and brief.stat().st_size >= A["min_brief_bytes"] else None
    return ok_brief, (cards[-1] if cards else None)


def wait_inputs(edition: dt.date, no_wait: bool) -> tuple[Path, Path]:
    """Poll every `poll_seconds` until the canonical brief and the fact cards for the edition exist."""
    rd = CFG["readiness"]
    h, m = (int(x) for x in rd["deadline_kst"].split(":"))
    deadline = dt.datetime.combine(edition, dt.time(h, m), tzinfo=KST)
    ymd = edition.strftime("%Y%m%d")
    while True:
        brief, cards = find_inputs(ymd)
        if brief and cards:
            return brief, cards
        if no_wait or now_kst() + dt.timedelta(seconds=rd["poll_seconds"]) > deadline:
            raise RuntimeError(f"AA morning brief not ready by {rd['deadline_kst']} KST (brief={bool(brief)}, fact_cards={bool(cards)})")
        log.info("waiting for AA brief %s (brief=%s cards=%s)", ymd, bool(brief), bool(cards))
        time.sleep(rd["poll_seconds"])


def previous_brief(ymd: str) -> Path | None:
    cands = []
    for p in aa_root().glob(A["brief_glob"]):
        m = re.search(r"(\d{8})\.md$", p.name)
        if m and m.group(1) < ymd and p.stat().st_size > 0:
            cands.append((m.group(1), p))
    return max(cands)[1] if cands else None


def aa_prompt(ymd: str) -> Path | None:
    c = sorted(aa_root().glob(A["prompt_glob"].format(ymd=ymd)))
    return c[-1] if c else None


def generate(edition: str, session: str, index: dict | None, fg_history: Path, run_dir: Path, latest_session: bool) -> tuple[dict, dict]:
    ymd = edition.replace("-", "")
    brief_p, cards_p = find_inputs(ymd)
    prev_p = previous_brief(ymd)
    today = brief_p.read_text(encoding="utf-8")
    prev = prev_p.read_text(encoding="utf-8") if prev_p else ""
    cards = json.loads(cards_p.read_text(encoding="utf-8"))
    inputs = {"brief": str(brief_p), "prev_brief": str(prev_p) if prev_p else None, "fact_cards": str(cards_p)}
    log.info("inputs %s", inputs)

    sec = validate.load_sec_tickers()
    t0 = time.time()
    pack = market_pack.build_pack(session, today, cards, set(sec), breadth=latest_session)
    log.info("market pack %.0fs %s", time.time() - t0, json.dumps(market_pack.summary(pack), ensure_ascii=False))

    fg, fg_src = edge.fear_greed(aa_prompt(ymd), fg_history, session)
    e = edge.compute(session, fg, fg_src, {k: v["chg_pct"] for k, v in pack["sectors"].items()}, (pack.get("rates") or {}).get("us10y"))
    pack["edge"], pack["edge_week"] = edge.with_history(e, index)
    log.info("시장 체력 %s %s (F&G %s from %s)", pack["edge"]["score"], pack["edge"]["label"], fg, fg_src)
    write_json(run_dir / "pack.json", pack)

    raw, meta = writer.write(edition, session, today, prev, cards, pack)
    (run_dir / "writer.raw.json").write_text(meta.pop("text"), encoding="utf-8")
    log.info("writer %s", json.dumps({k: v for k, v in meta.items()}, ensure_ascii=False))

    checked = copy.deepcopy(raw)
    corpus_texts = [today, prev, json.dumps(writer.compact_cards(cards), ensure_ascii=False), json.dumps(writer.pack_for_prompt(pack), ensure_ascii=False)]
    numbers = validate.number_check(checked, corpus_texts, pack)
    dropped = validate.validate_tickers(raw, sec) + validate.ground_tickers(raw, today + prev + corpus_texts[2], sec)
    style = validate.style_warnings(raw)

    fetched = stats.attach(raw, pack, session)
    for an in raw["story"]["annotations"]:
        if re.fullmatch(r"\d{1,2}:\d{2}", an.get("time_et", "")):
            an["time_kst"] = et_to_kst(session, an["time_et"])
    raw["story"]["annotations"] = [a for a in raw["story"]["annotations"] if a.get("time_kst")]
    fx = raw["fx"]
    base = fx["usdkrw"] - fx["change_won"]
    fx["change_pct"] = round(fx["change_won"] / base * 100, 2) if base else None
    raw.update({"product": "morning_brief", "edition_date": edition, "market_date": session, "model": meta["served_by"], "pack": pack})

    doc = publish.to_briefing(raw, now_kst().strftime("%H:%M"))
    errors = validate.briefing_errors(doc)
    report = {"edition": edition, "session": session, "inputs": inputs, "writer": meta, "tickers_dropped": dropped,
              "stats_fetched": fetched, "numbers": numbers, "style_warnings": style, "briefing_errors": errors,
              "edge": {k: pack["edge"].get(k) for k in ("score", "label", "fear_greed", "fear_greed_source", "prev_score")}}
    write_json(run_dir / "report.json", report)
    log.info("validator %s", json.dumps({"errors": errors, "tickers_dropped": dropped, "style_warnings": len(style),
                                         **{k: v for k, v in numbers.items() if not k.endswith("_items")}}, ensure_ascii=False))
    if errors:
        raise RuntimeError(f"briefing-morning/v1 gate failed: {errors[:5]}")
    return doc, report


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--edition", help="KST edition date YYYY-MM-DD (default: today KST)")
    ap.add_argument("--dry-run", action="store_true", help="no commit, push or Telegram")
    ap.add_argument("--no-wait", action="store_true", help="fail at once if the AA brief is not there")
    ap.add_argument("--force", action="store_true", help="regenerate even if the state says the edition is done")
    ap.add_argument("--index", help="dry run: index.json to merge into (default: the job worktree's)")
    a = ap.parse_args(argv)

    edition_d = dt.date.fromisoformat(a.edition) if a.edition else now_kst().date()
    edition = edition_d.isoformat()
    run_dir = state_path(CFG["state"]["runs"], edition + ("-dry" if a.dry_run else ""), "x").parent
    setup_logging(run_dir)
    state_file = state_path(CFG["state"]["editions"], f"{edition}.json")
    state = {} if a.dry_run else (read_json(state_file, {}) or {})

    def save(s: dict) -> None:
        if not a.dry_run:
            s["updated"] = now_kst().isoformat(timespec="seconds")
            write_json(state_file, s)

    if state.get("status") == "done" and not a.force:
        log.info("edition %s already done (%s); nothing to do", edition, state.get("publish", {}).get("sha", "")[:10])
        return 0
    session_d = market_pack.session_for_edition(edition_d)
    if not session_d:
        log.info("edition %s: %s was not a US trading day; no article", edition, edition_d - dt.timedelta(days=1))
        state.update({"edition": edition, "status": "skipped", "reason": "no US session"})
        save(state)
        return 0
    session = session_d.isoformat()
    state.update({"edition": edition, "session": session, "status": "running", "error": None})
    save(state)
    t_start = time.time()
    try:
        repo = publish.worktree()
        if not a.dry_run:
            log.info("job worktree %s at %s", repo, publish.sync(repo)[:10])
        latest_session = edition == now_kst().date().isoformat()
        resumed = state.get("publish", {}).get("status") == "pushed" and not a.force
        doc_path = repo / CFG["repo"]["data_dir"] / "morning" / f"{edition}.json"
        if resumed and doc_path.exists():
            doc = read_json(doc_path)
            log.info("resuming after an earlier push (%s)", state["publish"].get("sha", "")[:10])
        else:
            if not a.dry_run:
                wait_inputs(edition_d, a.no_wait)
            elif not all(find_inputs(edition.replace("-", ""))):
                raise RuntimeError("AA brief or fact cards missing for the dry run")
            index = read_json(Path(a.index)) if a.index else read_json(repo / CFG["repo"]["data_dir"] / "index.json")
            doc, report = generate(edition, session, index, repo / CFG["repo"]["fear_greed"], run_dir, latest_session)
            state["writer"] = {k: report["writer"].get(k) for k in ("model", "served_by", "usd", "seconds", "failures")}
        if a.dry_run:
            out_root = run_dir / "briefing"
            if a.index:
                write_json(out_root / "index.json", read_json(Path(a.index)))
            elif (repo / CFG["repo"]["data_dir"] / "index.json").exists():
                write_json(out_root / "index.json", read_json(repo / CFG["repo"]["data_dir"] / "index.json"))
            paths = publish.write_outputs(out_root, doc)
            (run_dir / "message.html").write_text(notify.compose(doc), encoding="utf-8")
            log.info("dry run done in %.0fs: %s", time.time() - t_start, [str(p) for p in paths])
            return 0
        if not resumed:
            sha = publish.commit_and_push(doc, repo)
            state["publish"] = {"status": "pushed", "sha": sha, "at": now_kst().isoformat(timespec="seconds")}
            save(state)
        pushed = repo / CFG["repo"]["data_dir"] / "morning" / f"{edition}.json"
        expect = hashlib.sha256(pushed.read_bytes()).hexdigest() if pushed.exists() else None
        live = publish.wait_published(edition, expect_sha=expect)
        state["publish"]["live"] = live
        save(state)
        if not live["ok"]:
            raise RuntimeError(f"{publish.data_url(edition)} not 200 after {live['seconds']}s (last status {live['status']})")
        notify.send_once(doc, state, save)
        state.update({"status": "done", "seconds": round(time.time() - t_start)})
        save(state)
        log.info("edition %s done in %.0fs", edition, time.time() - t_start)
        return 0
    except Exception as e:  # noqa: BLE001 - failure notice goes to the log and the state file only
        log.exception("edition %s failed", edition)
        state.update({"status": "failed", "error": f"{type(e).__name__}: {str(e)[:500]}", "seconds": round(time.time() - t_start)})
        save(state)
        return 1


if __name__ == "__main__":
    sys.exit(main())
