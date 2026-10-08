"""briefing-morning/v1 conversion, index merge, and the git publish of data/briefing/** from the job worktree.

The job worktree is a dedicated sparse worktree of the 100xFenok repo (never the shared checkout).
A push to main under data/briefing/ triggers publish-briefing.yml, which copies the folder to R2.
"""
from __future__ import annotations

import logging
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

from .common import CFG, expand, read_json, write_json

log = logging.getLogger("briefing.publish")
R = CFG["repo"]

KEEP_PACK = ("session", "indices", "etfs", "bigtech", "sectors", "sectors_up", "rates", "breadth", "edge", "edge_week", "sources")
KEEP_STAT = ("close", "chg_pct", "streak", "record_date", "prev_date", "from_record_pct", "from_52w_high_pct", "ytd_pct",
             "vol_vs_20d", "spark20", "symbol", "name")
ARTICLE_FIELDS = ("headline", "thesis", "strip_extra", "fx", "story", "bigtech_take", "bigtech_notes", "scene", "movers",
                  "tonight", "yesterday_check", "briefs")
INTRADAY_KEEP = ("S&P 500", "미 10년물")
INTRADAY_FIELDS = ("open", "high", "high_time", "low", "low_time", "close", "points")


def worktree() -> Path:
    return expand(R["worktree"])


def to_briefing(article: dict, published_kst: str) -> dict:
    p = article["pack"]
    pack = {k: p[k] for k in KEEP_PACK if k in p}
    for k in ("indices", "etfs", "bigtech", "sectors"):
        if k in pack:
            pack[k] = {name: {f: v[f] for f in KEEP_STAT if f in v} for name, v in pack[k].items()}
    pack["intraday"] = {k: {f: v[f] for f in INTRADAY_FIELDS} for k, v in p.get("intraday", {}).items() if v and k in INTRADAY_KEEP}
    out = {"schema": "briefing-morning/v1", "product": "morning", "edition_date": article["edition_date"],
           "market_date": article["market_date"], "model": article.get("model"), "published_kst": published_kst}
    out.update({k: article[k] for k in ARTICLE_FIELDS if k in article})
    out["pack"] = pack
    return out


def index_entry(doc: dict, nbytes: int) -> dict:
    idx = doc["pack"]["indices"]
    e = doc["pack"].get("edge") or {}
    return {"product": "morning", "edition_date": doc["edition_date"], "market_date": doc["market_date"], "headline": doc["headline"],
            "thesis": doc["thesis"], "sp500_chg_pct": idx["S&P 500"]["chg_pct"], "nasdaq_chg_pct": idx.get("나스닥", {}).get("chg_pct"),
            "russell_chg_pct": idx.get("러셀2000", {}).get("chg_pct"),
            "edge": {"score": e.get("score"), "label": e.get("label")} if e else None,
            "path": f"morning/{doc['edition_date']}.json", "bytes": nbytes}


def merge_index(prev: dict | None, entries: list[dict]) -> dict:
    """Upsert entries by (edition_date, product); keep every other top-level key of the previous index."""
    prev = dict(prev or {})
    merged = {(x["edition_date"], x["product"]): x for x in prev.get("editions", [])}
    merged.update({(x["edition_date"], x["product"]): x for x in entries})
    eds = sorted(merged.values(), key=lambda x: (x["edition_date"], x["product"]))
    latest = dict(prev.get("latest") or {})
    for x in eds:
        latest[x["product"]] = max(latest.get(x["product"], ""), x["edition_date"])
    prev.update({"schema": prev.get("schema", "briefing-index/v1"), "latest": latest, "editions": eds,
                 "products": prev.get("products") or CFG["products"]})
    return prev


def write_outputs(root: Path, doc: dict) -> list[Path]:
    """Write morning/<date>.json and the merged index.json under `root` (= <repo>/data/briefing or a dry-run dir)."""
    f = root / "morning" / f"{doc['edition_date']}.json"
    write_json(f, doc, indent=None)
    idx_path = root / "index.json"
    write_json(idx_path, merge_index(read_json(idx_path), [index_entry(doc, f.stat().st_size)]))
    return [f, idx_path]


def git(*args: str, repo: Path | None = None, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(repo or worktree()), *args], capture_output=True, text=True, check=check, timeout=300)


def sync(repo: Path | None = None) -> str:
    """Move the job worktree to the remote tip (own worktree: forced detached checkout is safe)."""
    git("fetch", "-q", R["remote"], f"+refs/heads/{R['branch']}:refs/remotes/{R['remote']}/{R['branch']}", repo=repo)
    git("checkout", "-q", "--detach", "--force", f"{R['remote']}/{R['branch']}", repo=repo)
    return git("rev-parse", "HEAD", repo=repo).stdout.strip()


def commit_and_push(doc: dict, repo: Path | None = None) -> str:
    """Write, commit only data/briefing paths, push to main; regenerate on a fresh tip if the push is rejected."""
    repo = repo or worktree()
    msg = R["commit_message"].format(date=doc["edition_date"])
    last_err = ""
    for attempt in range(1, R["push_attempts"] + 1):
        base = sync(repo)
        paths = write_outputs(repo / R["data_dir"], doc)
        rel = [str(p.relative_to(repo)) for p in paths]
        git("add", "--", *rel, repo=repo)
        if not git("diff", "--cached", "--quiet", "--", *rel, repo=repo, check=False).returncode:
            log.info("data already on %s at %s; nothing to commit", R["branch"], base[:10])
            return base
        git("commit", "-q", "-m", msg, "--", *rel, repo=repo)
        sha = git("rev-parse", "HEAD", repo=repo).stdout.strip()
        push = git("push", "-q", R["remote"], f"HEAD:refs/heads/{R['branch']}", repo=repo, check=False)
        if push.returncode == 0:
            log.info("pushed %s on top of %s (attempt %d)", sha[:10], base[:10], attempt)
            return sha
        last_err = (push.stderr or push.stdout).strip()[-400:]
        log.warning("push rejected (attempt %d): %s", attempt, last_err)
    raise RuntimeError(f"push failed after {R['push_attempts']} attempts: {last_err}")


def data_url(date: str) -> str:
    s = CFG["site"]
    return s["base_url"] + s["data_path"].format(date=date)


def article_url(date: str) -> str:
    s = CFG["site"]
    return s["base_url"] + s["article_path"].format(date=date)


def wait_published(date: str, timeout: int | None = None, poll: int | None = None) -> dict:
    """Poll the public data URL until it returns 200 for this edition."""
    s = CFG["site"]
    timeout = s["publish_wait_seconds"] if timeout is None else timeout
    poll = poll or s["publish_poll_seconds"]
    t0, status = time.time(), None
    while True:
        try:
            req = urllib.request.Request(f"{data_url(date)}?t={int(time.time())}", headers={"User-Agent": CFG["sources"]["user_agent"]})
            with urllib.request.urlopen(req, timeout=20) as r:
                status = r.status
                body = r.read(400).decode("utf-8", "replace")
            if status == 200 and date in body:
                return {"ok": True, "status": status, "seconds": round(time.time() - t0)}
        except urllib.error.HTTPError as e:
            status = e.code
        except Exception as e:  # noqa: BLE001
            status = str(e)[:80]
        if time.time() - t0 + poll > timeout:
            return {"ok": False, "status": status, "seconds": round(time.time() - t0)}
        time.sleep(poll)
