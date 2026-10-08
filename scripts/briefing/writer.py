"""Writer: prompt, output schema and the Claude Messages API call (Opus 5.5 first, Sonnet 5.5 on failure).

The model writes the article only. Every number it may use is in the AA briefs, the AA fact cards or
the computed market pack; code fills stats, KST times and the pack afterwards.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time

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
- A thesis, not a list. The headline names the tension of the session (for example what happened intraday versus how it closed), and one thesis sentence states what the session meant.
- The session as a story with real times. The MARKET PACK has 5-minute paths of the S&P 500, the Russell 2000 and the US 10-year yield (US Eastern Time). Use them to tell when the low and the turn happened and what moved with them. Give times in KST first with ET in parentheses, for example "새벽 0시 45분(현지 오전 11시 45분)". The user message states the KST - ET offset for the session and for the next session; use exactly those offsets.
- Context that only data gives: record closes, streaks, distance from records or 52-week highs, YTD, volume against the 20-day average, market breadth. Use it to say how unusual the day was.
- What the session did to the names most readers own: big tech and the index ETFs, and the effect of the won-dollar move. Mention leveraged ETFs in at most one clause, only when their move is notable.
- Memory: check what yesterday's brief flagged and say how it turned out.
- Tonight in KST: the scheduled US events of the next session.

Writing (Korean):
- Write like a skilled Korean financial journalist who explains the session to a smart friend: concrete, clear, a little conversational, never hyped.
- Paragraphs flow cause -> development -> close -> meaning, with connectives that carry logic (그런데, 그 결과, 다만, 덕분에, 반면). Vary sentence length. No bullet-like paragraphs.
- Explain a number's meaning the first time it appears; at most three numbers per sentence. Briefly explain jargon the first time.
- Write every sentence in the plain written news style that ends in "-다" (올랐다, 밀렸다, 보인다). Never use the polite "-습니다/-요" endings, in any field.
- No filler: "이번 기사에서는", "살펴보겠습니다", "주목된다", "귀추가 주목된다", "전반적으로", "한편".

Facts:
- Every number must come from TODAY'S BRIEF, YESTERDAY'S BRIEF, the FACT CARDS or the MARKET PACK. Interpretation is welcome; invented numbers, times, quotes or causes are not. Link a market move to an event only when the times in the MARKET PACK and the sources support it, and phrase it as timing ("~ 이후", "~와 함께"), not as proven causation, unless a source states the cause.
- Name the institution when a view comes from a fact card (e.g. 국제금융센터, 씨티, UBS).
- Keep conditions and uncertainty. Ignore broken leftover lines in the brief.

Fields:
- `headline` <= 32 characters. `thesis`: one sentence <= 70 characters.
- `strip_extra`: from the brief only: 달러인덱스, USD/KRW, VIX, WTI with `value` and `change` as written.
- `fx`: `usdkrw` (number) and `change_won` (number, negative when the won strengthened) with `basis` (what the change is measured against), from the fact cards or brief.
- `story`: `title` <= 30 characters; `chart_headline`: a conclusion <= 26 characters for the intraday S&P 500 / 10-year chart, true to the paths in the MARKET PACK; `paragraphs` 3-4 paragraphs, 600-900 Korean characters in total; `why`: exactly 2 sentences on why the session moved this way; `annotations`: 2-4 points for the intraday chart, each `series` ("S&P 500" or "미 10년물"), `time_et` "HH:MM" taken from the MARKET PACK, and `label` <= 18 characters.
- `bigtech_take`: 1-2 sentences on how the big tech names and the index ETFs fared, from the MARKET PACK `bigtech` and `etfs`, including the FX effect for won-based investors.
- `bigtech_notes`: 0-5 items `ticker` and `note` (<= 40 characters) only for big tech names whose move has a reason in the fact cards or briefs.
- `scene`: `title` <= 24 characters and `take` 2 sentences interpreting sector flow and, when the MARKET PACK has it, breadth. If breadth is missing, do not mention it.
- `movers`: 4-5 US-listed stocks with a reason from the fact cards or brief: `ticker`, Korean `name`, `reason` <= 55 characters. Do not invent tickers.
- `tonight`: 3-5 scheduled events for the next US session from the MARKET PACK calendar or the briefs: `kst` (e.g. "21:30"), `what`, `why` <= 40 characters. Economic events in the MARKET PACK already carry `kst`; convert other ET times with the next-session offset. Skip events without a time unless the brief dates them.
- `yesterday_check`: 2-3 items: `was` (what yesterday's brief said or flagged) and `now` (how it turned out).
- `briefs`: 3-4 other stories: `title` <= 30, `text` <= 80, `why` <= 40 characters.
"""


def system_prompt() -> str:
    return (SYSTEM + "\nOutput format: reply with exactly one JSON object that validates against this JSON Schema. "
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


def write(edition: str, session: str, today: str, prev: str, cards: list, pack: dict) -> tuple[dict, dict]:
    """Return (raw article, meta). Tries each configured model in order; raises WriterError when all fail."""
    client = anthropic.Anthropic(api_key=os.environ[W["api_key_env"]])
    system, user = system_prompt(), user_message(edition, session, today, prev, cards, pack)
    failures = []
    for attempt in W["attempts"]:
        try:
            raw, meta = _call(client, attempt, system, user, edition)
            meta["failures"] = failures
            return raw, meta
        except (WriterError, json.JSONDecodeError, anthropic.APIError) as e:
            log.warning("writer %s failed: %s", attempt["model"], str(e)[:300])
            failures.append({"model": attempt["model"], "error": str(e)[:300]})
    raise WriterError(f"all writer attempts failed: {failures}")
