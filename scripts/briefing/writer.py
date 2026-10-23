"""Writer: prompt, output schema and the model call.

Attempts run in config order: Claude through AGY on account 1 and account 2 (already-paid Google quota),
then the Messages API on plan-credit key 1 and key 2 (Opus 5.5 first, Sonnet 5.5 on failure).

The model writes the article only. Every number it may use is in the AA briefs, the AA fact cards or
the computed market pack; code fills stats, KST times and the pack afterwards.
"""
from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

import anthropic
import jsonschema

from . import ledger
from .common import CFG, kst_minus_et_hours

log = logging.getLogger("briefing.writer")
W = CFG["writer"]


def s_obj(props: dict, required: list) -> dict:
    return {"type": "object", "properties": props, "required": required, "additionalProperties": False}


STR = {"type": "string"}
NUM = {"type": "number"}


def ARR(x: dict) -> dict:  # noqa: N802 - schema shorthand
    return {"type": "array", "items": x}


SCHEMA = s_obj({
    "headline": STR, "thesis": STR,
    "strip_extra": ARR(s_obj({"label": STR, "value": STR, "change": STR}, ["label", "value"])),
    "fx": s_obj({"usdkrw": NUM, "change_won": NUM, "basis": STR}, ["usdkrw", "change_won", "basis"]),
    "story": s_obj({"title": STR, "chart_headline": STR, "paragraphs": ARR(STR), "why": ARR(STR),
                    "annotations": ARR(s_obj({"series": STR, "time_et": STR, "label": STR}, ["series", "time_et", "label"]))},
                   ["title", "chart_headline", "paragraphs", "why", "annotations"]),
    "bigtech_take": STR, "bigtech_notes": ARR(s_obj({"ticker": STR, "note": STR}, ["ticker", "note"])),
    "scene": s_obj({"title": STR, "take": STR}, ["title", "take"]),
    "movers": ARR(s_obj({"ticker": STR, "name": STR, "reason": STR}, ["ticker", "name", "reason"])),
    "tonight": ARR(s_obj({"kst": STR, "what": STR, "why": STR}, ["kst", "what"])),
    "yesterday_check": ARR(s_obj({"was": STR, "now": STR}, ["was", "now"])),
    "briefs": ARR(s_obj({"title": STR, "text": STR, "why": STR}, ["title", "text"])),
}, ["headline", "thesis", "strip_extra", "fx", "story", "bigtech_take", "bigtech_notes", "scene", "movers", "tonight", "yesterday_check", "briefs"])

SYSTEM = """You are the lead writer of "100x 모닝 브리프", a Korean morning newsletter that reviews the US stock session that has just closed.

Readers: Korean individual investors in US stocks in general, including friends who are not 100x members. Most hold big tech names (애플, 마이크로소프트, 엔비디아, 알파벳, 아마존, 메타, 테슬라, 브로드컴) and index ETFs such as SPY and QQQ; some hold leveraged ETFs. They read on a phone between 7 and 9 a.m. KST, while the US after-hours session is still running. They want to know what happened overnight, why, and what to watch tonight.

What makes this worth opening every day:
- A reading, not a list. The headline says plainly what happened and how you read it; one thesis sentence gives that reading and the observation it rests on.
- The session as a story with real times. The MARKET PACK has 5-minute paths of the S&P 500, the Russell 2000 and the US 10-year yield (US Eastern Time). Use them to tell when the low and the turn happened and what moved with them. Give times in KST first with ET in parentheses, for example "새벽 0시 45분(현지 오전 11시 45분)". The user message states the KST - ET offset for the session and for the next session; use exactly those offsets.
- Context that only data gives: record closes, streaks, distance from records or 52-week highs, YTD, volume against the 20-day average, market breadth. Use it to say how unusual the day was.
- What the session did to the names most readers own: big tech and the index ETFs, and the effect of the won-dollar move. Mention leveraged ETFs in at most one clause, only when their move is notable.
- Memory: check what yesterday's brief flagged and say how it turned out.
- Tonight in KST: the scheduled US events of the next session.

Writing (Korean):
- Write like the human examples in the WRITING KIT below: a skilled Korean financial journalist, concrete and clear, never hyped, no metaphors.
- Paragraphs follow the session in time, cause -> development -> close, with connectives that carry logic (그런데, 그 결과, 다만, 덕분에, 반면). End a paragraph on its last fact or on a judgment that the facts before it support, never on a closing line about what the day "meant". The story still ends on one reading of this session: which force led it and which held it back, each tied to an observation in the paragraphs, weighed rather than listed side by side, and kept to this session (no claim about a recurring relationship or about the days ahead). Vary sentence length. No bullet-like paragraphs.
- Before you return, apply the WRITING KIT's deletion test to every sentence.
- Explain a number's meaning the first time it appears; at most three numbers per sentence. Briefly explain jargon the first time.
- Write every sentence in the plain written news style that ends in "-다" (올랐다, 밀렸다, 보인다). Never use the polite "-습니다/-요" endings, in any field.
- No filler: "이번 기사에서는", "살펴보겠습니다", "주목된다", "귀추가 주목된다", "전반적으로", "한편".

Facts:
- Every number must come from TODAY'S BRIEF, YESTERDAY'S BRIEF, the FACT CARDS or the MARKET PACK. Interpretation is welcome; invented numbers, times, quotes or causes are not. Link a market move to an event only when the times in the MARKET PACK and the sources support it, and phrase it as timing ("~ 이후", "~와 함께"), not as proven causation, unless a source states the cause.
- Name the institution when a view comes from a fact card (e.g. 국제금융센터, 씨티, UBS).
- A number supports only claims of its own kind. The MARKET PACK breadth counts (advancing/declining, new highs/lows) cover the stocks its source counts, not the S&P 500: say "Finviz가 집계한 NYSE·Nasdaq·AMEX 종목" when you use them, and never use them to explain why the index rose or how many sectors took part. What drove the index comes from the sector, big tech and mover data. The sector figures are sector ETFs (XLK, XLC and so on): call them 업종 ETF and do not present them as contributions to the index.
- Keep conditions and uncertainty. Ignore broken leftover lines in the brief.

Fields:
- `headline` <= 32 characters. `thesis`: one sentence <= 70 characters.
- `strip_extra`: from the brief only: 달러인덱스, USD/KRW, VIX, WTI with `value` and `change` as written.
- `fx`: `usdkrw` (number) and `change_won` (number, negative when the won strengthened) with `basis` (what the change is measured against), from the fact cards or brief.
- `story`: `title` <= 30 characters; `chart_headline`: a conclusion <= 26 characters for the intraday S&P 500 / 10-year chart, true to the paths in the MARKET PACK; `paragraphs` 3-4 paragraphs, 600-900 Korean characters in total; `why`: exactly 2 sentences on why the session moved this way; `annotations`: 2-4 points for the intraday chart, each `series` ("S&P 500" or "미 10년물"), `time_et` "HH:MM" taken from the MARKET PACK, and `label` <= 18 characters.
- `bigtech_take`: 1-2 sentences on how the big tech names and the index ETFs fared, from the MARKET PACK `bigtech` and `etfs`, including the FX effect for won-based investors.
- `bigtech_notes`: 0-5 items `ticker` and `note` (<= 40 characters) only for big tech names whose move has a reason in the fact cards or briefs.
- `scene`: `title` <= 24 characters and `take` 2 sentences: sector flow read from the sector data and, when the MARKET PACK has it, breadth as its own fact about the whole market. If breadth is missing, do not mention it.
- `movers`: 4-5 US-listed stocks with a reason from the fact cards or brief: `ticker`, Korean `name`, `reason` <= 55 characters. Do not invent tickers.
- `tonight`: 3-5 scheduled events for the next US session from the MARKET PACK calendar or the briefs: `kst` (e.g. "21:30"), `what`, `why` <= 40 characters. Economic events in the MARKET PACK already carry `kst`; convert other ET times with the next-session offset. Skip events without a time unless the brief dates them.
- `yesterday_check`: 2-3 items: `was` (what yesterday's brief said or flagged) and `now` (how it turned out).
- `briefs`: 3-4 other stories: `title` <= 30, `text` <= 80, `why` <= 40 characters.
"""


def writing_kit() -> str:
    """The writing kit shared with the AA Daily Digest (human examples, failing sentence types, deletion test). It lives
    in AA, outside this public repository, because it quotes other writers' text."""
    path = W.get("style_kit")
    if not path:
        return ""
    p = Path(CFG["aa"]["root"]).expanduser() / path
    try:
        return f"\n<writing_kit>\n{p.read_text(encoding='utf-8')}\n</writing_kit>\n"
    except OSError as e:
        log.warning("writing kit not readable, writing without it: %s", e)
        return ""


def system_prompt() -> str:
    return (SYSTEM + writing_kit() + "\nOutput format: reply with exactly one JSON object that validates against this JSON Schema. "
            "No markdown fences, no text before or after.\n" + json.dumps(SCHEMA, ensure_ascii=False, separators=(",", ":")))


def compact_cards(cards: list) -> list:
    keep = ("headline", "facts", "source_view", "institution", "source_name", "topic", "timing", "received_at")
    return [{k: c[k] for k in keep if c.get(k)} for c in cards]


def pack_for_prompt(pack: dict) -> dict:
    p = json.loads(json.dumps(pack))
    step = W["intraday_prompt_step"]
    for v in p.get("intraday", {}).values():
        if v:
            pts = v.pop("points")
            v["path_30min"] = [x for i, x in enumerate(pts) if i % step == 0] + [pts[-1]]
    p["movers"] = dict(list(p.get("movers", {}).items())[:W["prompt_movers_limit"]])
    for k in ("edge", "edge_week", "generated_at"):
        p.pop(k, None)
    return p


def user_message(edition: str, session: str, today: str, prev: str, cards: list, pack: dict) -> str:
    nxt = pack.get("calendar_next_session", {}).get("date", session)
    return (f"Edition {edition} KST. US session reviewed: {session}. "
            f"For this session KST = ET + {kst_minus_et_hours(session)} hours; "
            f"for the next US session ({nxt}) KST = ET + {kst_minus_et_hours(nxt)} hours.\n\n"
            f"<today_brief>\n{today}\n</today_brief>\n\n<yesterday_brief>\n{prev}\n</yesterday_brief>\n\n"
            f"<fact_cards>\n{json.dumps(compact_cards(cards), ensure_ascii=False)}\n</fact_cards>\n\n"
            f"<market_pack>\n{json.dumps(pack_for_prompt(pack), ensure_ascii=False)}\n</market_pack>")


class WriterError(RuntimeError):
    pass


def parse_reply(text: str) -> dict:
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    raw = json.loads(text)
    errs = [f"{list(e.path)}: {e.message[:120]}" for e in jsonschema.Draft202012Validator(SCHEMA).iter_errors(raw)]
    if errs:
        raise WriterError("schema: " + "; ".join(errs[:10]))
    return raw


def _call(client: anthropic.Anthropic, attempt: dict, system: str, user: str, edition: str) -> tuple[dict, dict]:
    model = attempt["model"]
    extra = {}
    ssf = W["server_side_fallback"]
    if model in ssf["models"]:
        extra = {"extra_headers": {"anthropic-beta": ssf["beta"]}, "extra_body": {"fallbacks": ssf["fallbacks"]}}
    t0 = time.time()
    with client.messages.stream(model=model, max_tokens=attempt["max_tokens"], system=system,
                                messages=[{"role": "user", "content": user}],
                                output_config={"effort": attempt["effort"]}, **extra) as stream:
        msg = stream.get_final_message()
    secs = round(time.time() - t0, 1)
    usage = msg.usage.model_dump()
    row = ledger.append(model, "morning_article", usage, edition, served_by=msg.model, seconds=secs,
                        stop_reason=msg.stop_reason, request_id=getattr(msg, "_request_id", None) or msg.id)
    meta = {"model": model, "served_by": msg.model, "id": msg.id, "seconds": secs, "stop_reason": msg.stop_reason,
            "input_tokens": usage.get("input_tokens"), "output_tokens": usage.get("output_tokens"), "usd": row["usd"]}
    if msg.stop_reason != "end_turn":
        raise WriterError(f"stop_reason={msg.stop_reason} details={getattr(msg, 'stop_details', None)}")
    meta["text"] = "".join(b.text for b in msg.content if b.type == "text")
    return parse_reply(meta["text"]), meta


AGY_BIN = Path.home() / ".local" / "bin" / "agy"


class AgyTimeout(WriterError):
    """AGY answered too slowly; the other AGY account is skipped so the edition still lands by 06:30."""
AGY_INLINE_MAX = 90_000  # Linux caps one argv string at 128 KiB; longer prompts go through a file


def _call_agy(attempt: dict, system: str, user: str, edition: str) -> tuple[dict, dict]:
    """One `agy -p` run. Account 2 keeps its login in its own HOME (see the `ad2` shell function)."""
    if not AGY_BIN.exists():
        raise WriterError(f"{AGY_BIN} missing")
    env = {k: v for k, v in os.environ.items() if k not in ("GEMINI_API_KEY", "GOOGLE_API_KEY")}
    if attempt["engine"] == "agy2":
        home = Path(os.environ.get("FENO_AGY2_HOME", str(Path.home() / ".gemini-2")))
        if not home.is_dir():
            raise WriterError(f"second AGY home {home} missing")
        env.update(HOME=str(home), FENO_AGY2_REAL_HOME=str(Path.home()))
    prompt = f"{system}\n\n{user}\n\nReturn only the JSON object. Do not create, edit or delete any file."
    timeout = attempt.get("timeout_s", 240)
    t0 = time.time()
    with tempfile.TemporaryDirectory(prefix="briefing-agy-") as work:
        if len(prompt) > AGY_INLINE_MAX:
            Path(work, "prompt.md").write_text(prompt, encoding="utf-8")
            prompt = "Read prompt.md in the current directory completely and do exactly what it asks."
        cmd = [str(AGY_BIN), "-p", prompt, "--model", attempt["model"], "--print-timeout", f"{timeout}s",
               "--dangerously-skip-permissions"]
        try:
            proc = subprocess.run(cmd, cwd=work, env=env, capture_output=True, text=True, timeout=timeout + 30)
        except subprocess.TimeoutExpired:
            raise AgyTimeout(f"{attempt['engine']} timed out after {timeout + 30} s") from None
    secs = round(time.time() - t0, 1)
    text = proc.stdout.strip()
    if proc.returncode != 0 and secs >= timeout - 5:
        raise AgyTimeout(f"{attempt['engine']} hit its {timeout} s print timeout")
    if proc.returncode != 0 or not text:
        raise WriterError(f"{attempt['engine']} exit {proc.returncode}: {(text or proc.stderr).strip()[:200]}")
    served = re.sub(r"-(low|medium|high)$", "", attempt["model"])
    ledger.append(f"{attempt['engine']}:{attempt['model']}", "morning_article", {}, edition, served_by=served,
                  seconds=secs, stop_reason="end_turn", request_id=None)
    meta = {"model": f"{attempt['engine']}:{attempt['model']}", "served_by": served, "id": None, "seconds": secs,
            "stop_reason": "end_turn", "input_tokens": None, "output_tokens": None, "usd": 0.0, "text": text}
    return parse_reply(text), meta


def _call_command(attempt: dict, system: str, user: str, edition: str) -> tuple[dict, dict]:
    """One local command that reads {"system", "user"} JSON on stdin and prints {"ok", "text", ...} JSON.

    On the owner's machines it is feno_llm's `feno_claude.py` (key order, expiry, failover and the credit
    ledger are feno_llm's). Anywhere else the command is missing, the attempt fails and the next one runs."""
    argv = [os.path.expanduser(a) for a in attempt["argv"]]
    if shutil.which(argv[0]) is None or not Path(argv[1]).is_file():
        raise WriterError(f"command {argv[:2]} missing")
    t0 = time.time()
    try:
        proc = subprocess.run(argv, input=json.dumps({"system": system, "user": user}), capture_output=True,
                              text=True, timeout=attempt.get("timeout_s", 900))
    except subprocess.TimeoutExpired:
        raise WriterError(f"command timed out after {attempt.get('timeout_s', 900)} s") from None
    secs = round(time.time() - t0, 1)
    try:
        out = json.loads(proc.stdout)
    except ValueError:
        raise WriterError(f"command exit {proc.returncode}: {proc.stderr.strip()[:200]}") from None
    if not out.get("ok"):
        err = out.get("error") or {}
        raise WriterError(f"command {err.get('code')}: {str(err.get('message'))[:200]}")
    if out.get("stop_reason") != "end_turn":
        raise WriterError(f"stop_reason={out.get('stop_reason')}")
    usage = out.get("usage") or {}
    row = ledger.append(attempt["model"], "morning_article", usage, edition, served_by=out.get("model"), seconds=secs,
                        stop_reason=out["stop_reason"], request_id=out.get("request_id"))
    meta = {"model": attempt["model"], "served_by": out.get("model"), "id": out.get("request_id"), "seconds": secs,
            "stop_reason": out["stop_reason"], "input_tokens": usage.get("input_tokens"),
            "output_tokens": usage.get("output_tokens"), "usd": row["usd"], "key_env": out.get("key_env"),
            "text": out["text"]}
    return parse_reply(out["text"]), meta


def write(edition: str, session: str, today: str, prev: str, cards: list, pack: dict) -> tuple[dict, dict]:
    """Return (raw article, meta). Tries each configured attempt in order; raises WriterError when all fail."""
    system, user = system_prompt(), user_message(edition, session, today, prev, cards, pack)
    clients: dict[str, anthropic.Anthropic] = {}
    failures = []
    agy_slow = False
    for attempt in W["attempts"]:
        engine = attempt.get("engine", "api")
        label = f"{engine}:{attempt['model']}"
        try:
            if engine in ("agy", "agy2"):
                if agy_slow:
                    raise WriterError("skipped: an earlier AGY attempt timed out")
                try:
                    raw, meta = _call_agy(attempt, system, user, edition)
                except AgyTimeout:
                    agy_slow = True
                    raise
            elif engine == "command":
                raw, meta = _call_command(attempt, system, user, edition)
            else:
                key_env = attempt.get("key_env", W["api_key_env"])
                if not os.environ.get(key_env):
                    raise WriterError(f"{key_env} not set")
                if key_env not in clients:
                    clients[key_env] = anthropic.Anthropic(api_key=os.environ[key_env])
                raw, meta = _call(clients[key_env], attempt, system, user, edition)
                meta["key_env"] = key_env
            meta["failures"] = failures
            return raw, meta
        except (WriterError, json.JSONDecodeError, anthropic.APIError) as e:
            log.warning("writer %s failed: %s", label, str(e)[:300])
            failures.append({"model": label, "error": str(e)[:300]})
    raise WriterError(f"all writer attempts failed: {failures}")
