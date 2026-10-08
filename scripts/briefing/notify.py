"""Telegram link for a published edition, through the AA Publication Gateway (read-only use of AA code).

AA's `scripts/publication/cli_send.py` has no flag for a delivery run id, so this module runs the same
`publication.Gateway.send` that the CLI calls, under AA's own interpreter, with
`--class publication --product-id morning_brief` semantics and the deterministic run id
`morning_article:<date>`. The Gateway refuses a run id that already has a delivery, and the job's state
file records the send, so a date is never sent twice.
"""
from __future__ import annotations

import html
import json
import subprocess
from typing import Callable

from .common import CFG, expand, now_kst
from .publish import article_url

A = CFG["aa"]

DRIVER = r"""
import json, sys
from pathlib import Path
root = Path(sys.argv[1])
sys.path.insert(0, str(root / "scripts"))
from publication import Gateway
content = sys.stdin.read()
try:
    res = Gateway(project_root=root).send(content, message_class=sys.argv[3], product_id=sys.argv[2] or None,
                                           parse_mode="HTML", delivery_run_id=sys.argv[4])
except RuntimeError as e:
    res = {"status": "already_delivered" if "blocking delivery state" in str(e) else "error", "errors": [str(e)[:300]]}
print("GATEWAY_RESULT " + json.dumps(res, ensure_ascii=False, default=str))
"""


def compose(doc: dict) -> str:
    e = html.escape
    lines = [f"<b>{e(doc['headline'])}</b>", "", e(doc["thesis"])]
    why = [w for w in doc.get("story", {}).get("why", []) if w][:2]
    if why:
        lines += [""] + [f"• {e(w)}" for w in why]
    url = article_url(doc["edition_date"])
    lines += ["", f'<a href="{e(url)}">모닝 브리프 {e(doc["edition_date"])} 읽기</a>']
    return "\n".join(lines)


def gateway_send(content: str, run_id: str, message_class: str | None = None, product_id: str | None = None) -> dict:
    """One Gateway.send under AA's interpreter. Defaults: the edition link (class publication, product morning_brief)."""
    root = expand(A["root"])
    cls = message_class or A["message_class"]
    pid = A["product_id"] if product_id is None else product_id
    p = subprocess.run([str(expand(A["python"])), "-c", DRIVER, str(root), pid, cls, run_id],
                       input=content, capture_output=True, text=True, cwd=root, timeout=300)
    line = next((x for x in reversed(p.stdout.splitlines()) if x.startswith("GATEWAY_RESULT ")), "")
    if not line:
        return {"status": "error", "errors": [f"rc={p.returncode} {(p.stderr or p.stdout)[-300:]}"]}
    return json.loads(line[len("GATEWAY_RESULT "):])


def send_once(doc: dict, state: dict, save: Callable[[dict], None], sender: Callable[[str, str], dict] = gateway_send) -> dict:
    """Send the edition link unless the state already records a send; persist the outcome."""
    prev = state.get("notify") or {}
    if prev.get("status") in ("sent", "already_delivered"):
        return {**prev, "skipped": True}
    run_id = A["delivery_run_id"].format(date=doc["edition_date"])
    state["notify"] = {"status": "sending", "run_id": run_id, "at": now_kst().isoformat(timespec="seconds")}
    save(state)
    res = sender(compose(doc), run_id)
    status = res.get("status")
    if status == "dedup_skipped":  # the Gateway saw identical content already delivered
        status = "already_delivered"
    ok = status in ("success", "already_delivered")
    state["notify"] = {"status": "sent" if status == "success" else (status or "error"), "run_id": run_id,
                       "at": now_kst().isoformat(timespec="seconds"), "result": {k: res.get(k) for k in ("status", "sent", "total", "errors", "run_id")}}
    save(state)
    if not ok:
        raise RuntimeError(f"telegram send failed: {res}")
    return state["notify"]
