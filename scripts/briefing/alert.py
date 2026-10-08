"""One-line failure alert for the morning job through AA's ops-alert route (Gateway class ops_alert -> main_ops).

At most one alert per edition and step: the alert state file records each send, and the Gateway delivery run id
`morning_article_alert:<date>:<step>` refuses a second delivery. A successful run sends nothing.
"""
from __future__ import annotations

import html
import logging
from pathlib import Path
from typing import Callable

from . import notify
from .common import CFG, now_kst, read_json, state_path, write_json

log = logging.getLogger("briefing.alert")
AL = CFG["alerts"]


def compose(edition: str, step: str, reason: str, log_path: str) -> str:
    e = html.escape
    label = AL["steps"].get(step, step)
    reason = " ".join(str(reason).split())[:200]
    return (f"<b>100x 모닝 브리프 실패</b> {e(edition)} · {e(label)}({e(step)}) · {e(reason)} · "
            f"로그 M4 <code>{e(log_path)}</code>")


def ops_send(content: str, run_id: str) -> dict:
    return notify.gateway_send(content, run_id, message_class=AL["message_class"], product_id="")


def short_path(p: Path | str) -> str:
    s, home = str(p), str(Path.home())
    return "~" + s[len(home):] if s.startswith(home) else s


def send_failure(edition: str, step: str, reason: str, log_path: Path | str,
                 sender: Callable[[str, str], dict] = ops_send, path: Path | None = None) -> dict:
    """Send the alert unless this edition+step already has one; never raises (the failure itself is already logged)."""
    path = path or state_path(CFG["state"]["alerts"])
    key = f"{edition}:{step}"
    sent = read_json(path, {}) or {}
    if (sent.get(key) or {}).get("status") in ("sent", "already_delivered"):
        return {**sent[key], "skipped": True}
    run_id = AL["delivery_run_id"].format(date=edition, step=step)
    try:
        res = sender(compose(edition, step, reason, short_path(log_path)), run_id)
    except Exception as e:  # noqa: BLE001
        res = {"status": "error", "errors": [f"{type(e).__name__}: {e}"[:300]]}
    status = res.get("status")
    status = {"success": "sent", "dedup_skipped": "already_delivered"}.get(status, status or "error")
    rec = {"status": status, "run_id": run_id, "at": now_kst().isoformat(timespec="seconds"),
           "reason": str(reason)[:300], "errors": res.get("errors")}
    sent = read_json(path, {}) or {}
    sent[key] = rec
    write_json(path, sent)
    (log.info if status in ("sent", "already_delivered") else log.error)("failure alert %s: %s", key, status)
    return rec
