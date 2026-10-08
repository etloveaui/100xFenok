"""Unit tests for the briefing job (no network). Run from scripts/: python -m unittest discover -s briefing/tests -t ."""
from __future__ import annotations

import datetime as dt
import unittest

from briefing import edge, notify, publish, validate
from briefing.common import et_to_kst, kst_minus_et_hours
from briefing.market_pack import is_us_trading_day, next_trading_day, session_for_edition


class ClockTests(unittest.TestCase):
    def test_et_to_kst_across_dst_end(self):
        # US daylight saving time ends 2026-11-01: EDT (KST-13) before, EST (KST-14) after.
        self.assertEqual(et_to_kst("2026-10-30", "09:30"), "22:30")
        self.assertEqual(et_to_kst("2026-10-30", "16:00"), "05:00")
        self.assertEqual(et_to_kst("2026-11-02", "09:30"), "23:30")
        self.assertEqual(et_to_kst("2026-11-02", "16:00"), "06:00")
        self.assertEqual(et_to_kst("2026-11-02", "8:30"), "22:30")
        self.assertEqual(kst_minus_et_hours("2026-10-30"), 13)
        self.assertEqual(kst_minus_et_hours("2026-11-01"), 14)
        self.assertEqual(kst_minus_et_hours("2026-11-02"), 14)

    def test_sessions_and_holidays(self):
        d = dt.date.fromisoformat
        self.assertEqual(session_for_edition(d("2026-10-08")), d("2026-10-07"))
        self.assertEqual(session_for_edition(d("2026-10-31")), d("2026-10-30"))  # Saturday edition reviews Friday
        self.assertEqual(session_for_edition(d("2026-11-03")), d("2026-11-02"))
        self.assertIsNone(session_for_edition(d("2026-11-27")))  # Thanksgiving 2026-11-26
        self.assertIsNone(session_for_edition(d("2026-10-11")))  # Sunday edition: Saturday has no session
        for holiday in ("2026-01-01", "2026-04-03", "2026-07-03", "2026-12-25", "2027-01-01", "2027-03-26"):
            self.assertFalse(is_us_trading_day(d(holiday)), holiday)
        self.assertTrue(is_us_trading_day(d("2026-11-27")))
        self.assertEqual(next_trading_day(d("2026-10-30")), d("2026-11-02"))


SEC = {"MU": "MICRON TECHNOLOGY INC", "PLXS": "PLEXUS CORP", "CAT": "CATERPILLAR INC", "PFE": "PFIZER INC"}


class TickerTests(unittest.TestCase):
    def test_unknown_ticker_blanked(self):
        raw = {"movers": [{"ticker": "WEBL", "name": "x", "reason": "r"}, {"ticker": "MU", "name": "마이크론", "reason": "r"}]}
        self.assertEqual(validate.validate_tickers(raw, SEC), ["WEBL"])
        self.assertEqual(raw["movers"][0]["ticker"], "")

    def test_grounding_by_ticker_or_company_name(self):
        corpus = "Penguin Solutions rose. Micron Technology raised guidance. CAT (-5.75%)"
        raw = {"movers": [{"ticker": t, "name": "", "reason": ""} for t in ("PLXS", "MU", "CAT", "PFE")]}
        self.assertEqual(validate.ground_tickers(raw, corpus, SEC), ["PLXS", "PFE"])
        self.assertEqual([m["ticker"] for m in raw["movers"]], ["", "MU", "CAT", ""])


class NumberTests(unittest.TestCase):
    PACK = {"session": "2026-10-07", "breadth": {"advancing": 1590, "declining": 3786},
            "indices": {"S&P 500": {"close": 7801.77, "chg_pct": -0.22}},
            "intraday": {"S&P 500": {"points": [["10:45", 7765.83], ["13:20", 7790.1]]}}}

    def test_korean_units(self):
        self.assertEqual(validate.parse_korean("48만6,532"), (486532.0, 1.0))
        self.assertEqual(validate.parse_korean("8.9만"), (89000.0, 1000.0))
        v, r = validate.parse_korean("1조2,000억")
        self.assertEqual((v, r), (1.2e12, 1e8))

    def test_number_check_forms(self):
        texts = ["S&P 500 7765.83, 신규 실업수당 486,532건, 미결제약정 89,123계약, 10년물 5.357%, 낙폭 0.22%, USD/KRW 1,338.40"]
        article = {
            "a": "밤 11시 45분(현지 오전 10시 45분) 7,765까지 밀렸다",  # rounded intraday value + KST/ET times
            "b": "청구 건수는 48만6,532건이었다",  # Korean unit form, exact
            "c": "약정은 8.9만 계약",  # Korean unit form, rounded
            "d": "하락 종목이 상승의 2.4배였다",  # computed ratio from the pack (3786 / 1590)
            "e": "낙폭은 0.2%대, 10년물 5.36%",  # truncated / rounded
            "fx": {"usdkrw": 1339.46, "change_won": 1.06, "basis": "전일 1,338.40원 대비"},  # computed in the same object
            "f": "S&P 500은 7,800선 아래",  # round figure
            "g": "출처에 없는 9,431",
        }
        texts.append("1339.46")
        rep = validate.number_check(article, texts, self.PACK)
        self.assertEqual(rep["unmatched"], 1, rep)
        self.assertEqual(rep["unmatched_items"][0][0], "9,431")
        self.assertGreaterEqual(rep["korean_unit"], 2)
        self.assertGreaterEqual(rep["derived"], 2)

    def test_calendar_k_forms(self):
        rep = validate.number_check({"a": "신규 실업수당 청구(예상 20만건, 이전 19.7만건)"}, ["consensus 200K previous 197K"], self.PACK)
        self.assertEqual((rep["korean_unit"], rep["unmatched"], rep["derived"]), (2, 0, 0), rep)

    def test_style_warning(self):
        self.assertTrue(validate.style_warnings({"x": "주가가 올랐습니다."}))
        self.assertFalse(validate.style_warnings({"x": "주가가 올랐다."}))


def doc(date: str, score: int = 50) -> dict:
    return {"schema": "briefing-morning/v1", "product": "morning", "edition_date": date, "market_date": date, "headline": f"h{date}",
            "thesis": "t", "story": {"why": ["이유 하나다.", "이유 둘이다."]},
            "pack": {"indices": {"S&P 500": {"chg_pct": 0.5}, "나스닥": {"chg_pct": 0.7}}, "edge": {"score": score, "label": "중립"}}}


class IndexTests(unittest.TestCase):
    def test_merge_upserts_and_keeps_other_keys(self):
        prev = {"schema": "briefing-index/v1", "products": [{"id": "morning"}], "note": "keep",
                "latest": {"morning": "2026-10-07"},
                "editions": [publish.index_entry(doc("2026-10-07"), 10), publish.index_entry(doc("2026-10-06"), 10)]}
        new = publish.index_entry(doc("2026-10-08", 40), 20)
        idx = publish.merge_index(prev, [new])
        self.assertEqual([e["edition_date"] for e in idx["editions"]], ["2026-10-06", "2026-10-07", "2026-10-08"])
        self.assertEqual(idx["latest"]["morning"], "2026-10-08")
        self.assertEqual(idx["note"], "keep")
        self.assertEqual(idx["products"], [{"id": "morning"}])
        again = publish.merge_index(idx, [publish.index_entry(doc("2026-10-08", 41), 21)])
        self.assertEqual(len(again["editions"]), 3)
        self.assertEqual(again["editions"][-1]["edge"]["score"], 41)

    def test_merge_from_empty_uses_config_products(self):
        idx = publish.merge_index(None, [publish.index_entry(doc("2026-10-08"), 1)])
        self.assertEqual(idx["schema"], "briefing-index/v1")
        self.assertTrue(any(p["id"] == "morning" for p in idx["products"]))

    def test_edge_history(self):
        prev = publish.merge_index(None, [publish.index_entry(doc(f"2026-10-0{i}", 40 + i), 1) for i in range(1, 8)])
        e, week = edge.with_history({"session": "2026-10-08", "score": 60, "label": "중립"}, prev)
        self.assertEqual(e["prev_score"], 47)
        self.assertEqual(e["prev_session"], "2026-10-07")
        self.assertEqual(len(week), 7)
        self.assertEqual(week[-1]["session"], "2026-10-08")


class NotifyTests(unittest.TestCase):
    def test_send_once_per_date(self):
        calls, saved = [], []

        def sender(content, run_id):
            calls.append(run_id)
            return {"status": "success", "sent": 1, "total": 1}

        state: dict = {}
        d = doc("2026-10-08")
        notify.send_once(d, state, lambda s: saved.append(dict(s)), sender)
        second = notify.send_once(d, state, lambda s: saved.append(dict(s)), sender)
        self.assertEqual(calls, ["morning_article:2026-10-08"])
        self.assertTrue(second["skipped"])
        self.assertEqual(state["notify"]["status"], "sent")

    def test_gateway_refusal_counts_as_delivered(self):
        state = {"notify": {"status": "sending"}}
        out = notify.send_once(doc("2026-10-08"), state, lambda s: None, lambda c, r: {"status": "already_delivered"})
        self.assertEqual(out["status"], "already_delivered")

    def test_failed_send_raises_and_records(self):
        state: dict = {}
        with self.assertRaises(RuntimeError):
            notify.send_once(doc("2026-10-08"), state, lambda s: None, lambda c, r: {"status": "error", "errors": ["x"]})
        self.assertEqual(state["notify"]["status"], "error")

    def test_message_has_headline_thesis_two_lines_and_link(self):
        msg = notify.compose(doc("2026-10-08"))
        self.assertIn("<b>h2026-10-08</b>", msg)
        self.assertIn("https://100xfenok.etloveaui.workers.dev/brief/morning/2026-10-08/", msg)
        self.assertEqual(msg.count("• "), 2)


if __name__ == "__main__":
    unittest.main()
