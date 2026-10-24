"""Deterministic replay of the saved October 23 index-strip gap; no model/network."""
import datetime as dt
import json
from pathlib import Path
import unittest
from unittest import mock

import pandas as pd

from briefing import market_pack as market


class IndexHistoryTests(unittest.TestCase):
    def setUp(self):
        self.saved = json.loads((Path(__file__).parent / "fixtures/2026-10-23-index-gap.json").read_text())
        day = dt.date.fromisoformat(self.saved["session"])
        self.dates = [day]
        # The saved Yahoo-derived spark had 20 rows but no October 21 bar.
        while len(self.dates) < 20:
            day = market.previous_trading_day(day)
            if day.isoformat() != self.saved["previous_session"]:
                self.dates.append(day)
        self.dates.reverse()

    def test_saved_october_23_recovers_all_six_indices(self):
        archives = {}
        expected = [-1.21, -2.60, -2.90, 0.02, 0.11, -6.72]
        with mock.patch.object(market, "archived_indices", return_value=self.saved["previous_indices"]) as read:
            for (name, quote), change in zip(self.saved["indices"].items(), expected):
                close = pd.Series(quote["spark20"], index=pd.to_datetime(self.dates))
                self.assertEqual(market.daily_stats(close, None, self.saved["session"])["chg_pct"], quote["chg_pct"])
                out = market.index_stats(close, quote["symbol"], self.saved["session"], archives)
                prior = self.saved["previous_indices"][name]["close"]
                self.assertEqual(out["chg_pct"], change, name)
                self.assertEqual(out["prev_date"], self.saved["previous_session"])
                self.assertEqual(out["spark20"], quote["spark20"][1:-1] + [prior, quote["close"]])
            read.assert_called_once_with(self.saved["previous_session"])

    def test_unrecoverable_prior_is_not_a_multiday_change_or_line(self):
        quote = self.saved["indices"]["S&P 500"]
        close = pd.Series(quote["spark20"], index=pd.to_datetime(self.dates))
        with mock.patch.object(market, "archived_indices", return_value={}):
            out = market.index_stats(close, quote["symbol"], self.saved["session"], {})
        self.assertEqual(out["close"], quote["close"])
        self.assertIsNone(out["chg_pct"])
        self.assertIsNone(out["prev_date"])
        self.assertEqual(out["spark20"], [])

    def test_complete_window_does_not_read_archive(self):
        dates = pd.to_datetime(["2026-10-20", "2026-10-21", "2026-10-22"])
        close = pd.Series([7712.57, 7757.17, 7663.43], index=dates)
        # Earlier missing history may shorten the spark but cannot corrupt the daily move.
        with mock.patch.object(market, "archived_indices", return_value={}) as read:
            out = market.index_stats(close, "^GSPC", "2026-10-22", {})
        self.assertNotIn(mock.call("2026-10-21"), read.call_args_list)
        self.assertEqual(out["chg_pct"], -1.21)
        self.assertEqual(out["spark20"], list(close))

    def test_archive_with_wrong_session_is_rejected(self):
        stale = json.dumps({"market_date": "2026-10-20", "pack": {"session": "2026-10-20", "indices": self.saved["previous_indices"]}})
        with mock.patch.object(market.Path, "exists", return_value=False), mock.patch.object(market, "http_get", return_value=stale):
            self.assertEqual(market.archived_indices("2026-10-21"), {})


if __name__ == "__main__":
    unittest.main()
