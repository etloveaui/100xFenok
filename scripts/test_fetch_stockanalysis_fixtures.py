#!/usr/bin/env python3
"""Fixture smoke checks for StockAnalysis fetcher parser contracts."""

from __future__ import annotations

import hashlib
import csv
import html
import importlib.util
import io
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
from argparse import Namespace


ROOT = Path(__file__).resolve().parents[1]
FETCHER_PATH = ROOT / "scripts" / "fetch-stockanalysis.py"
FIXTURE_DIR = ROOT / "scripts" / "fixtures" / "stockanalysis"


def weekday_rows(start: str, count: int) -> list[dict]:
    cursor = datetime.fromisoformat(f"{start}T00:00:00+00:00")
    rows = []
    while len(rows) < count:
        if cursor.weekday() < 5:
            rows.append({"t": cursor.date().isoformat(), "c": 100 + len(rows)})
        cursor += timedelta(days=1)
    return rows


def sampled_weekday_rows(start: str, end: str, count: int) -> list[dict]:
    cursor = datetime.fromisoformat(f"{start}T00:00:00+00:00")
    end_dt = datetime.fromisoformat(f"{end}T00:00:00+00:00")
    dates = []
    while cursor <= end_dt:
        if cursor.weekday() < 5:
            dates.append(cursor.date().isoformat())
        cursor += timedelta(days=1)
    if count >= len(dates):
        selected = dates
    else:
        selected = [dates[round(index * (len(dates) - 1) / (count - 1))] for index in range(count)]
    return [{"t": value, "c": 100 + index} for index, value in enumerate(selected)]


def load_fetcher_module():
    spec = importlib.util.spec_from_file_location("stockanalysis_fetcher", FETCHER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load fetcher module from {FETCHER_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class StockanalysisFetcherFixtureTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.fetcher = load_fetcher_module()

    def test_ishares_term_tips_official_holdings_exact_fund_schema_and_country(self) -> None:
        urls = {
            "IBIC": "https://www.ishares.com/us/products/333118/ishares-ibonds-oct-2026-term-tips-etf/latest-holdings.csv",
            "IBIH": "https://www.ishares.com/us/products/333121/ishares-ibonds-oct-2031-term-tips-etf/latest-holdings.csv",
            "IBIJ": "https://www.ishares.com/us/products/333076/ishares-ibonds-oct-2033-term-tips-etf/latest-holdings.csv",
            "IBIK": "https://www.ishares.com/us/products/337462/ishares-ibonds-oct-2034-term-tips-etf/latest-holdings.csv",
            "IBIM": "https://www.ishares.com/us/products/350034/ishares-ibonds-oct-2036-term-tips-etf/latest-holdings.csv",
        }
        years = {"IBIC": 2026, "IBIH": 2031, "IBIJ": 2033, "IBIK": 2034, "IBIM": 2036}
        header = ["Name", "Sector", "Asset Class", "Market Value", "Weight (%)",
                  "Notional Value", "Par Value", "CUSIP", "ISIN", "SEDOL", "Location",
                  "Exchange", "Currency", "Duration", "YTM (%)", "FX Rate", "Maturity",
                  "Coupon (%)", "Mod. Duration", "Yield to Call (%)", "Yield to Worst (%)",
                  "Real Duration", "Real YTM (%)", "Market Currency", "Accrual Date", "Effective Date"]
        holdings = {
            "IBIC": [("TREASURY (CPI) NOTE", "Fixed Income", "91282CDC2", "98.56"),
                     ("USD CASH", "Cash", "-", "1.19"),
                     ("BLK CSH FND TREASURY SL AGENCY", "Money Market", "066922477", "0.25")],
            "IBIH": [("TREASURY (CPI) NOTE", "Fixed Income", "91282CQP9", "36.60"),
                     ("TREASURY (CPI) NOTE", "Fixed Income", "91282CBF7", "31.72"),
                     ("TREASURY (CPI) NOTE", "Fixed Income", "91282CCM1", "31.66"),
                     ("BLK CSH FND TREASURY SL AGENCY", "Money Market", "066922477", "0.01"),
                     ("USD CASH", "Cash", "-", "0.00")],
            "IBIJ": [("TREASURY (CPI) NOTE", "Fixed Income", "91282CGK1", "50.20"),
                     ("TREASURY (CPI) NOTE", "Fixed Income", "91282CHP9", "49.77"),
                     ("USD CASH", "Cash", "-", "0.03"),
                     ("BLK CSH FND TREASURY SL AGENCY", "Money Market", "066922477", "0.00")],
            "IBIK": [("TREASURY (CPI) NOTE", "Fixed Income", "91282CLE9", "51.10"),
                     ("TREASURY (CPI) NOTE", "Fixed Income", "91282CJY8", "48.89"),
                     ("USD CASH", "Cash", "-", "0.01")],
            "IBIM": [("TREASURY (CPI) NOTE", "Fixed Income", "91282AAA1", "50.00"),
                     ("TREASURY (CPI) NOTE", "Fixed Income", "91282BBB2", "50.00")],
        }

        def document(ticker, *, positions=None, date="Oct 01, 2026", add_price=None):
            columns = header.copy()
            if add_price if add_price is not None else ticker != "IBIM":
                columns.insert(columns.index("Location"), "Price")
            out = io.StringIO()
            writer = csv.writer(out)
            writer.writerow([f"iShares® iBonds® Oct {years[ticker]} Term TIPS ETF"])
            writer.writerow(["Fund Holdings as of", date])
            writer.writerow([])
            writer.writerow(columns)
            for name, asset_class, cusip, weight in positions or holdings[ticker]:
                row = dict.fromkeys(columns, "-")
                row.update({"Name": name, "Sector": "Treasury" if asset_class == "Fixed Income" else "Cash and/or Derivatives",
                            "Asset Class": asset_class, "Weight (%)": weight, "CUSIP": cusip,
                            "Location": "United States", "Currency": "USD", "Market Currency": "USD"})
                if asset_class == "Cash" and float(weight) < 0:
                    row.update({key: "-1,000.00" for key in
                                ("Market Value", "Notional Value", "Par Value")})
                if "Price" in row:
                    row["Price"] = "99.96"
                writer.writerow([row[column] for column in columns])
            return out.getvalue()

        class FixedDateTime(datetime):
            @classmethod
            def now(cls, tz=None):
                return datetime(2026, 10, 5, tzinfo=tz or timezone.utc)

        def fetch(ticker, csv_text, *, redirect=None):
            class Response(io.BytesIO):
                status = 200

                def geturl(self):
                    return redirect or urls[ticker]

            def urlopen(request, timeout):
                self.assertEqual(request.full_url, urls[ticker])
                return Response(csv_text.encode("utf-8"))

            with patch.object(self.fetcher, "datetime", FixedDateTime), \
                    patch.object(self.fetcher.urllib.request, "urlopen", side_effect=urlopen):
                return self.fetcher.fetch_official_etf_holdings(ticker, 1)

        for ticker in urls:
            with self.subTest(ticker=ticker):
                source, data, provenance = fetch(ticker, document(ticker))
                self.assertEqual(source, urls[ticker])
                self.assertEqual((data["date"], data["count"]), ("2026-10-01", len(holdings[ticker])))
                self.assertEqual(provenance["provider"], "ishares")
                self.assertEqual(provenance["country_coverage"], "issuer_csv_location")
                self.assertEqual(data["countries"][0]["country"], "United States")
                self.assertAlmostEqual(sum(item["as"] for item in data["holdings"]),
                                       sum(float(item[3]) for item in holdings[ticker]))
                if ticker != "IBIM":
                    cash = next(item for item in data["holdings"] if item["n"] == "USD CASH")
                    self.assertIsNone(cash["cusip"])
                    self.assertEqual(cash["raw"]["CUSIP"], "-")
                    self.assertIn("Price", data["holdings"][0]["raw"])
                else:
                    self.assertNotIn("Price", data["holdings"][0]["raw"])

        for ticker in ("IBIC", "IBIH", "IBIJ", "IBIK"):
            valid = document(ticker)
            signed_positions = [(name, kind, cusip, "-0.50" if kind == "Cash" else weight)
                                for name, kind, cusip, weight in holdings[ticker]]
            signed = document(ticker, positions=signed_positions, date="Oct 02, 2026")
            with self.subTest(ticker=ticker, case="verified negative USD cash"):
                _, data, provenance = fetch(ticker, signed)
                self.assertEqual(next(row for row in data["holdings"] if row["n"] == "USD CASH")["as"], -0.5)
                self.assertAlmostEqual(data["countries"][0]["weight"], provenance["weight_sum_pct"])
            for replacement in ("1,000.00", "0", "NaN", "Infinity", "-"):
                with self.subTest(ticker=ticker, case="cash amount sign or value", value=replacement), self.assertRaises(ValueError):
                    fetch(ticker, signed.replace('"-1,000.00"', replacement, 1))
            with self.subTest(ticker=ticker, case="negative noncash"), self.assertRaises(ValueError):
                fetch(ticker, document(ticker, positions=[
                    (name, kind, cusip, "-0.50" if index == 0 else weight)
                    for index, (name, kind, cusip, weight) in enumerate(holdings[ticker])]))
            with self.subTest(ticker=ticker, case="unverified negative cash identity"), self.assertRaises(ValueError):
                fetch(ticker, signed.replace("USD CASH", "OTHER CASH", 1))
            with self.subTest(ticker=ticker, case="wrong fund"), self.assertRaises(ValueError):
                fetch(ticker, valid.replace(str(years[ticker]), "2099", 1))
            with self.subTest(ticker=ticker, case="missing Price"), self.assertRaises(ValueError):
                fetch(ticker, document(ticker, add_price=False))
            with self.subTest(ticker=ticker, case="wrong location"), self.assertRaises(ValueError):
                fetch(ticker, valid.replace("United States", "Canada", 1))
            with self.subTest(ticker=ticker, case="bad cash identity"), self.assertRaises(ValueError):
                fetch(ticker, valid.replace("USD CASH", "OTHER CASH", 1))
            with self.subTest(ticker=ticker, case="bad noncash CUSIP"), self.assertRaises(ValueError):
                fetch(ticker, valid.replace(holdings[ticker][0][2], "-", 1))
            with self.subTest(ticker=ticker, case="future date"), self.assertRaises(ValueError):
                fetch(ticker, document(ticker, date="Oct 06, 2026"))
            with self.subTest(ticker=ticker, case="stale date"), self.assertRaises(ValueError):
                fetch(ticker, document(ticker, date="Sep 25, 2026"))
            with self.subTest(ticker=ticker, case="redirect"), self.assertRaises(ValueError):
                fetch(ticker, valid, redirect="https://example.com/holdings.csv")
        ibic_no_treasury = [(name, "Money Market" if kind == "Fixed Income" else kind, cusip, weight)
                            for name, kind, cusip, weight in holdings["IBIC"]]
        with self.assertRaises(ValueError):
            fetch("IBIC", document("IBIC", positions=ibic_no_treasury))
        ibij_one_treasury = [(name, "Money Market" if index == 0 else kind, cusip, weight)
                             for index, (name, kind, cusip, weight) in enumerate(holdings["IBIJ"])]
        with self.assertRaises(ValueError):
            fetch("IBIJ", document("IBIJ", positions=ibij_one_treasury))
        ibim_cash = [*holdings["IBIM"], ("USD CASH", "Cash", "-", "0.00")]
        with self.assertRaises(ValueError):
            fetch("IBIM", document("IBIM", positions=ibim_cash))
        for ticker in ("IBIZ", "UNVERIFIED"):
            with self.assertRaisesRegex(ValueError, "no verified official holdings fallback"):
                self.fetcher.fetch_official_etf_holdings(ticker, 1)

    def test_hbil_official_html_reconciles_signed_net_assets_and_rejects_bad_rows(self) -> None:
        page_url = "https://www.harborcapital.com/etf/hbil/"
        header = ["Company Name", "Category Name", "Cusip", "Shares", "Maturity Date",
                  "Coupon Rate (%)", "Market Value ($000's)", "% of Net Assets"]
        rows = [
            ["TREASURY BILL", "FIXED INCOME", "912797SU2", "5,540,500", "11/27/2026", "--", "5,506", "100.1"],
            ["TREASURY BILL", "FIXED INCOME", "912797VJ3", "5,540,300", "12/31/2026", "0.0", "5,485", "99.7"],
            ["Total", "--", "--", "--", "--", "--", "10,992", "199.8"],
            ["Cash and Other Assets Less Liabilities", "--", "--", "--", "--", "--", "--", "-99.8"],
            ["Total Net Assets", "--", "--", "--", "--", "--", "--", "100.0"],
        ]

        def page(date="10/01/2026", *, rows_input=rows, title="ETFs | Harbor Short Term Treasury ETF (HBIL) | Harbor Capital"):
            header_html = "".join(
                f'<div role="row"><div role="columnheader"><span>{html.escape(value)}</span></div></div>'
                for value in header
            )
            body_html = "".join(
                "".join(f"<div><span>{html.escape(value)}</span></div>" for value in row)
                for row in rows_input
            )
            return (f'<title>{title}</title><link rel="canonical" href="{page_url}" />'
                    '<p>HBIL</p><p>41151J570</p><p>NYSE Arca</p>'
                    '<div id="panel-FullHoldings-performance-content" role="region">'
                    f'<h2>As of <!-- -->{date}</h2>'
                    '<div aria-label="Data table" role="table">'
                    f'{header_html}{body_html}</div></div>'
                    '<h3 id="panel-SectorAllocation-performance-title">Sector Allocation</h3>')

        class FixedDateTime(datetime):
            @classmethod
            def now(cls, tz=None):
                return datetime(2026, 10, 4, tzinfo=tz or timezone.utc)

        def fetch(page_text, *, redirect=None):
            class Response(io.BytesIO):
                status = 200

                def geturl(self):
                    return redirect or page_url

            with patch.object(self.fetcher, "datetime", FixedDateTime), \
                    patch.object(self.fetcher.urllib.request, "urlopen",
                                 side_effect=lambda request, timeout: Response(page_text.encode())):
                return self.fetcher.fetch_official_etf_holdings("HBIL", 1)

        page_text = page()
        url, data, provenance = fetch(page_text)
        self.assertEqual(url, page_url)
        self.assertEqual((data["date"], data["count"]), ("2026-10-01", 3))
        self.assertEqual([row["cusip"] for row in data["holdings"][:-1]], ["912797SU2", "912797VJ3"])
        self.assertEqual([row["as"] for row in data["holdings"]], [100.1, 99.7, -99.8])
        self.assertTrue(all(row["s"] is None for row in data["holdings"]))
        self.assertAlmostEqual(sum(row["as"] for row in data["holdings"]), 100.0)
        self.assertEqual([row["weight_pct"] for row in self.fetcher.normalize_holdings(data["holdings"])],
                         [100.1, 99.7, -99.8])
        self.assertEqual(provenance["accounting"], {
            "gross_weight_pct": 199.8, "cash_weight_pct": -99.8, "net_assets_weight_pct": 100.0,
        })
        self.assertEqual(provenance["page_sha256"], hashlib.sha256(page_text.encode()).hexdigest())
        self.assertNotIn("csv_url", provenance)

        zero_cash = [rows[0][:-1] + ["50.1"], rows[1][:-1] + ["49.9"],
                     rows[2][:-1] + ["100.0"], rows[3][:-1] + ["0.0"], rows[4]]
        _, zero_data, _ = fetch(page(rows_input=zero_cash))
        self.assertEqual(self.fetcher.normalize_holdings(zero_data["holdings"])[-1]["weight_pct"], 0.0)
        tiny = rows[0][:2] + ["912797ZZ1", "1000", *rows[0][4:6], "1", "0.0"]
        tiny_rows = [*rows[:2], tiny, rows[2][:6] + ["10,993", "199.8"], *rows[3:]]
        _, tiny_data, _ = fetch(page(rows_input=tiny_rows))
        self.assertEqual(self.fetcher.normalize_holdings(tiny_data["holdings"])[2]["weight_pct"], 0.0)
        rounded_zero = tiny[:3] + ["100", *tiny[4:6], "0", "0.0"]
        _, rounded_data, _ = fetch(page(rows_input=[*rows[:2], rounded_zero, *rows[2:]]))
        self.assertEqual(self.fetcher.normalize_holdings(rounded_data["holdings"])[2]["weight_pct"], 0.0)

        cases = {
            "wrong fund": page(title="Other ETF"),
            "wrong CUSIP": page_text.replace("<p>41151J570</p>", "<p>000000000</p>"),
            "future date": page(date="10/05/2026"),
            "stale date": page(date="09/26/2026"),
            "missing Treasury": page(rows_input=rows[1:]),
            "negative Treasury weight": page(rows_input=[rows[0][:-1] + ["-100.1"], *rows[1:]]),
            "duplicate Treasury": page(rows_input=[rows[0], rows[1][:2] + [rows[0][2]] + rows[1][3:], *rows[2:]]),
            "positive liability offset": page(rows_input=[*rows[:3], rows[3][:-1] + ["99.8"], rows[4]]),
            "malformed liability weight": page(rows_input=[*rows[:3], rows[3][:-1] + ["nan"], rows[4]]),
            "wrong net assets": page(rows_input=[*rows[:4], rows[4][:-1] + ["120.0"]]),
            "offset and net agree but net is not 100": page(rows_input=[*rows[:3], rows[3][:-1] + ["-95.8"], rows[4][:-1] + ["104.0"]]),
            "row weights disagree with values": page(rows_input=[rows[0][:-1] + ["199.7"], rows[1][:-1] + ["0.1"], *rows[2:]]),
            "nonfinite shares": page(rows_input=[rows[0][:3] + ["9" * 400] + rows[0][4:], *rows[1:]]),
            "nonfinite market and total": page(rows_input=[rows[0][:6] + ["9" * 400, rows[0][7]], rows[1], rows[2][:6] + ["9" * 400, rows[2][7]], *rows[3:]]),
            "missing accounting row": page(rows_input=rows[:-1]),
        }
        for label, page_input in cases.items():
            with self.subTest(label=label), self.assertRaises(ValueError):
                fetch(page_input)
        with self.assertRaisesRegex(ValueError, "redirect"):
            fetch(page_text, redirect="https://www.harborcapital.com/etf/other/")

    def test_abxb_official_holdings_require_complete_dated_page_csv_parity(self) -> None:
        csv_text = (
            "Ticker,CUSIP,Security Description,Shares,Market Value,% of Net Assets\n"
            "VGSH,92206C102,Vanguard Short-Term Treasury ETF,5755,\"$330,826.18\",17.78%\n"
            "VCSH,92206C409,Vanguard Short-Term Corporate Bond ETF,4238,\"$326,876.94\",17.56%\n"
            "SGOV,46436E718,iShares 0-3 Month Treasury Bond ETF,3199,\"$321,211.59\",17.26%\n"
            "VTIP,922020805,Vanguard Short-Term Inflation-Protected Securities ETF,6600,\"$319,506.00\",17.17%\n"
            "EMLC,92189H300,VanEck J. P. Morgan EM Local Currency Bond ETF,7480,\"$183,484.40\",9.86%\n"
            "BKLN,46138G508,Invesco Senior Loan ETF,8928,\"$182,666.88\",9.82%\n"
            "FLOT,46429B655,iShares Floating Rate Bond ETF,3584,\"$182,282.24\",9.79%\n"
            "Cash&Other,Cash&Other,Cash & Other,7579,\"$7,578.75\",0.41%\n"
            "8AMMF0JA0,8AMMF0JA0,US BANK MMDA - USBGFS 9 09/01/2037,6141,\"$6,141.25\",0.33%\n"
        )
        page_url = "https://abacusfcf.com/abxb/"
        csv_url = "https://abacusfcf.com/wp-content/uploads/DailyUploads/ABXB_allHoldings.csv"

        def page(table_csv=csv_text, date="10/02/2026", *, second_date=None,
                 title="Abacus Flexible Bond Leaders ETF (ABXB) | Abacus FCF",
                 link="/wp-content/uploads/DailyUploads/ABXB_allHoldings.csv"):
            rows = list(csv.reader(io.StringIO(table_csv)))
            header = "".join(f"<th>{html.escape(value.upper())}</th>" for value in rows[0])
            body = "".join("<tr>" + "".join(f"<td>{html.escape(value)}</td>" for value in row)
                           + "</tr>" for row in rows[1:])
            return (f'<title>{title}</title><link rel="canonical" href="{page_url}" />'
                    '<table><tr><td>TICKER:</td><td>ABXB</td></tr>'
                    '<tr><td>CUSIP:</td><td>89628W609</td></tr></table>'
                    f'<h2>Top 10 Holdings <span>(as of {date})</span></h2>'
                    f'<h2>Top 10 Holdings <span>(as of {second_date or date})</span></h2>'
                    f'<a href="{link}">DOWNLOAD FULL HOLDINGS</a>'
                    '<a href="/wp-content/uploads/2026/09/ABXB_allHoldings.csv">Old link</a>'
                    f'<table><thead><tr>{header}</tr></thead><tbody>{body}</tbody></table>')

        class FixedDateTime(datetime):
            @classmethod
            def now(cls, tz=None):
                return datetime(2026, 10, 4, tzinfo=tz or timezone.utc)

        def fetch(page_text, csv_data, *, redirect=None):
            class Response(io.BytesIO):
                status = 200

                def __init__(self, data, final_url):
                    super().__init__(data)
                    self.final_url = final_url

                def geturl(self):
                    return self.final_url

            def urlopen(request, timeout):
                url = request.full_url
                if url == page_url:
                    return Response(page_text.encode(), redirect or page_url)
                if url == csv_url:
                    return Response(csv_data.encode(), redirect or csv_url)
                raise AssertionError(f"unexpected URL: {url}")

            with patch.object(self.fetcher, "datetime", FixedDateTime), \
                    patch.object(self.fetcher.urllib.request, "urlopen", side_effect=urlopen):
                return self.fetcher.fetch_official_etf_holdings("ABXB", 1)

        page_text = page()
        url, data, provenance = fetch(page_text, csv_text)
        self.assertEqual(url, csv_url)
        self.assertEqual((data["date"], data["count"]), ("2026-10-02", 9))
        self.assertEqual(round(sum(row["as"] for row in data["holdings"]), 2), 99.98)
        self.assertEqual([row["s"] for row in data["holdings"][-2:]], [None, None])
        self.assertNotIn("cusip", data["holdings"][-2])
        self.assertEqual(data["holdings"][-1]["cusip"], "8AMMF0JA0")
        self.assertNotIn("countries", data)
        self.assertEqual(provenance["page_sha256"], hashlib.sha256(page_text.encode()).hexdigest())
        self.assertEqual(provenance["csv_sha256"], hashlib.sha256(csv_text.encode()).hexdigest())
        self.assertEqual(provenance["source_as_of"], data["date"])

        # A complete issuer change remains eligible: the MMDA is gone and its
        # weight moves to a security, while every page and CSV row still agrees.
        changed_csv = csv_text.replace("17.78%", "18.11%", 1).rsplit("\n8AMMF0JA0,", 1)[0] + "\n"
        _, changed_data, _ = fetch(page(changed_csv), changed_csv)
        self.assertEqual(changed_data["count"], 8)
        self.assertEqual(round(sum(row["as"] for row in changed_data["holdings"]), 2), 99.98)
        self.assertIsNone(changed_data["holdings"][-1]["s"])

        cases = {
            "wrong fund": (page(title="Other ETF"), csv_text, None),
            "missing observed link": (page(link="/other.csv"), csv_text, None),
            "conflicting dates": (page(second_date="10/01/2026"), csv_text, None),
            "malformed second date": (page(second_date="updated yesterday"), csv_text, None),
            "stale date": (page(date="09/26/2026"), csv_text, None),
            "future date": (page(date="10/05/2026"), csv_text, None),
            "page CSV drift": (page_text, csv_text.replace("$330,826.18", "$330,826.19"), None),
            "missing CSV row": (page_text, csv_text.rsplit("8AMMF0JA0,", 1)[0], None),
            "wrong CSV header": (page_text, csv_text.replace("Ticker,CUSIP", "Symbol,CUSIP", 1), None),
            "redirect": (page_text, csv_text, "https://abacusfcf.com/changed"),
        }
        duplicate = csv_text.replace("VCSH,92206C409", "VGSH,92206C102")
        cases["duplicate holding"] = (page(duplicate), duplicate, None)
        negative_shares = csv_text.replace("VGSH,92206C102,Vanguard Short-Term Treasury ETF,5755,",
                                           "VGSH,92206C102,Vanguard Short-Term Treasury ETF,-1,")
        cases["negative shares"] = (page(negative_shares), negative_shares, None)
        nonfinite_weight = csv_text.replace("17.78%", "nan%")
        cases["nonfinite weight"] = (page(nonfinite_weight), nonfinite_weight, None)
        wrong_cusip = csv_text.replace("VGSH,92206C102", "VGSH,123")
        cases["invalid CUSIP"] = (page(wrong_cusip), wrong_cusip, None)
        wrong_mmda = csv_text.replace("US BANK MMDA - USBGFS 9 09/01/2037", "Other instrument")
        cases["MMDA cannot become a ticker"] = (page(wrong_mmda), wrong_mmda, None)
        unknown_mmda = csv_text.replace(
            "8AMMF0JA0,8AMMF0JA0,US BANK MMDA - USBGFS 9 09/01/2037",
            "MMDA,123456789,Other MMDA deposit",
        )
        cases["unknown MMDA cannot become a ticker"] = (page(unknown_mmda), unknown_mmda, None)
        wrong_total = csv_text.replace("17.78%", "1.78%")
        cases["incomplete total"] = (page(wrong_total), wrong_total, None)
        for label, (page_input, csv_input, redirect) in cases.items():
            with self.subTest(label=label), self.assertRaises(ValueError):
                fetch(page_input, csv_input, redirect=redirect)


    def test_scheduled_etf_retry_fairly_includes_selected_fallback_debt_with_primary_canonical(self):
        class Store:
            @staticmethod
            def retry_entities(kind):
                return {"AAA"} if kind == "etf" else set()

        selected = {"current": {"SLON": {"provider": "yahoo_finance"}, "PRIMARY": {"provider": "stockanalysis"}},
                    "recovery": {"SLON": {"last_transition": "initial_fallback"}}}
        latest = {"AAA": {"observed_at": "2026-07-15T23:00:00Z"},
                  "SLON": {"observed_at": "2026-07-14T23:00:00Z"}}
        result = self.fetcher.select_natural_recovery_targets(
            Store(), {"etf"}, [], [], stock_limit=0, selected_etf_state=selected, primary_observations=latest)
        self.assertEqual(result[2], ["SLON"])
        latest["SLON"]["observed_at"] = "2026-07-16T23:00:00Z"
        result = self.fetcher.select_natural_recovery_targets(
            Store(), {"etf"}, [], [], stock_limit=0, selected_etf_state=selected, primary_observations=latest)
        self.assertEqual(result[2], ["AAA"])
        result = self.fetcher.select_natural_recovery_targets(
            Store(), {"stock"}, [], [], stock_limit=0, selected_etf_state=selected, primary_observations=latest)
        self.assertEqual(result[2], [])

    def test_live_manual_etf_result_carries_bound_observation_and_recovers_producer_only(self):
        stamp = "2026-07-15T23:00:00Z"
        payload = {"schema_version": "stockanalysis/v1", "source": "stockanalysis", "asset_type": "etf",
                   "ticker": "VYMI", "source_as_of": "2026-07-15T00:00:00Z", "fetched_at": stamp,
                   "normalized": {"overview": {"aum": 1}, "holdings": [{"ticker": "AAPL", "weight": 1}]},
                   "raw": {"quote": {"td": "2026-07-15"}}}
        environment = {"GITHUB_ACTIONS": "true", "GITHUB_RUN_ID": "901", "GITHUB_RUN_ATTEMPT": "1",
                       "GITHUB_EVENT_NAME": "workflow_dispatch"}
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            out = root / "data/stockanalysis"
            state_root = root / "data/admin/data-supply-state/v1"
            canonical = out / "etfs/VYMI.json"
            self.fetcher.write_json(canonical, {**payload, "source_as_of": "2026-07-14T00:00:00Z"})
            store = self.fetcher.StockAnalysisRecoveryStateStore(root / "data/admin/stockanalysis-recovery", root)
            store.record_failure("etf", "VYMI", "HTTP 503", {"run_id": "failure", "run_attempt": 1,
                                 "event_name": "workflow_dispatch", "observed_at": stamp})
            with patch.dict(os.environ, environment, clear=True), \
                 patch.object(self.fetcher, "OUT_DIR", out), \
                 patch.object(self.fetcher, "STORAGE_ROOT", root), \
                 patch.object(self.fetcher, "DATA_SUPPLY_STATE_ROOT", state_root), \
                 patch.object(self.fetcher, "fetch_etf", return_value=payload), \
                 patch.object(self.fetcher, "now_iso", return_value=stamp):
                result = self.fetcher.run_one("etf", "VYMI", 1, False, collection_origin="manual",
                    recovery_store=store, recovery_run={"run_id": "901", "run_attempt": 1,
                    "event_name": "workflow_dispatch", "natural": False, "observed_at": stamp})
            self.assertEqual(result["status"], "ok")
            self.assertEqual(json.loads(canonical.read_text())["source_as_of"], "2026-07-15T00:00:00Z")
            rows = [json.loads(line) for path in (state_root / "history/observations").glob("*.jsonl")
                    for line in path.read_text().splitlines()]
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["observation_origin"], "rebuild")
            self.assertEqual(rows[0]["collection_origin"], "manual")
            self.assertEqual(rows[0]["payload_sha256"], hashlib.sha256(canonical.read_bytes()).hexdigest())
            producer = json.loads((store.root / "states/etf/VYMI.json").read_text())
            self.assertFalse(producer["retry"])

    def test_etf_live_fetch_does_not_overwrite_newer_canonical_or_future_provider_date(self):
        stamp = "2026-07-15T23:00:00Z"
        payload = {"schema_version": "stockanalysis/v1", "source": "stockanalysis", "asset_type": "etf",
                   "ticker": "VYMI", "source_as_of": "2026-07-15T00:00:00Z", "fetched_at": stamp,
                   "normalized": {"overview": {"aum": 1}, "holdings": [{"ticker": "AAPL", "weight": 1}]},
                   "raw": {"quote": {"td": "2026-07-15"}}}
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "data/stockanalysis"
            canonical = out / "etfs/VYMI.json"
            self.fetcher.write_json(canonical, {**payload, "source_as_of": "2026-07-16T00:00:00Z"})
            before = canonical.read_bytes()
            with patch.object(self.fetcher, "OUT_DIR", out), \
                 patch.object(self.fetcher, "STORAGE_ROOT", Path(tmp)), \
                 patch.object(self.fetcher, "DATA_SUPPLY_STATE_ROOT", Path(tmp) / "data/admin/data-supply-state/v1"), \
                 patch.object(self.fetcher, "now_iso", return_value=stamp):
                for candidate in (payload, {**payload, "source_as_of": "2026-07-16T00:00:00Z",
                                          "raw": {"quote": {"td": "2026-07-16"}}}):
                    with patch.object(self.fetcher, "fetch_etf", return_value=candidate):
                        result = self.fetcher.run_one("etf", "VYMI", 1, False, collection_origin="manual")
                    self.assertEqual(result["status"], "error")
                    self.assertEqual(canonical.read_bytes(), before)

    def partial_primary_selected_yahoo_case(self, *, yahoo_source="2026-09-25T20:00:00Z",
                                           returned_error=False, pending=False, floor=None,
                                           foreign=False, fail_detail_write=False, enabled=True,
                                           primary_kind="fresh", remote=True, run_attempt=1, unbound=False,
                                           event_name="workflow_dispatch", cached=False, metadata_error=False):
        from data_supply_resolver import DataSupplyResolver
        from resolve_etf_detail_candidates import resolve_entities
        stamp = "2026-09-28T10:00:00Z"
        old_epoch = int(datetime(2026, 7, 8, 20, tzinfo=timezone.utc).timestamp())
        source_epoch = int(datetime.fromisoformat(yahoo_source.replace("Z", "+00:00")).timestamp())
        data = {"info": {"symbol": "SLON", "quoteType": "ETF", "currentPrice": 25,
                         "regularMarketTime": source_epoch}, "history_1y": []}
        primary = {"schema_version": "stockanalysis/v1", "source": "stockanalysis", "asset_type": "etf",
                   "ticker": "SLON", "source_as_of": "2026-09-25T20:00:00Z", "fetched_at": stamp,
                   "detail_status": "stockanalysis_partial",
                   "partial_reason_codes": ["holdings_surface_fallback_overview", "holdings_countries_unavailable"],
                   "normalized": {"overview": {"aum": 1}, "holdings": [{"symbol": "MSFT", "weight_pct": 1}]},
                   "raw": {"quote": {"td": "2026-09-25", "ts": int(datetime(2026, 9, 25, 20, tzinfo=timezone.utc).timestamp())}}}
        if primary_kind == "stale":
            primary["source_as_of"] = "2026-07-01T00:00:00Z"
            primary["raw"] = {"quote": {"td": "2026-07-01"}}
        elif primary_kind == "dateless":
            primary["source_as_of"] = None
            primary["source_as_of_reason"] = "provider publishes no dated detail"
            primary["raw"] = {}

        engine = self.fetcher.load_yf_finance_module()
        class YahooModule:
            decorate_finance_payload = staticmethod(engine.decorate_finance_payload)
            preserve_history_coverage = staticmethod(engine.preserve_history_coverage)
            validate_source_progression = staticmethod(engine.validate_source_progression)
            @staticmethod
            def fetch_with_retry(*_args, **_kwargs):
                return (None if returned_error else data, 1, "provider unavailable" if returned_error else None,
                        {"attempts_used": 1, "latency_ms": 1, "cached": cached})

        original_outputs = self.fetcher.current_candidate_outputs()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fetcher.install_candidate_outputs(self.fetcher.CandidateOutputs.from_root(root))
            try:
                old_provider = self.fetcher.build_yf_payload("SLON", {"info": {"symbol": "SLON", "quoteType": "ETF",
                    "regularMarketTime": old_epoch, "currentPrice": 24}, "history_1y": []}, "2026-07-09T00:00:00Z")
                old_detail = self.fetcher.yahoo_etf_payload("SLON", old_provider)
                raw_path = self.fetcher.YF_OUT_DIR / "SLON.json"
                detail_path = self.fetcher.YF_ETF_DETAIL_OUT_DIR / "SLON.json"
                self.fetcher.write_json(raw_path, old_provider)
                self.fetcher.write_json(detail_path, old_detail)
                row = self.fetcher.record_etf_detail_observation(provider="yahoo_finance",
                    endpoint_family="yahoo_finance_etf_detail", ticker="SLON", provider_path="data/yf/etf-details/SLON.json",
                    payload_path=detail_path, provider_schema="yf-etf-detail/v1", source_as_of=old_detail["source_as_of"],
                    observed_at=old_provider["fetched_at"], validation_status="valid", reason_code="contract_valid", collection_origin="manual")
                store = self.fetcher.data_supply_store(provider_truth_root=root)
                DataSupplyResolver(store).resolve(domain="etf_detail", entity="SLON", observations=[row],
                                                  decided_at="2026-07-09T00:01:00Z")
                if pending:
                    self.fetcher.run_yahoo_etf_fallback_controlled_failure(
                        "SLON", {"event_name": "workflow_dispatch", "observed_at": stamp})
                if floor is not None:
                    newer = {"info": {"symbol": "SLON", "quoteType": "ETF", "currentPrice": 26,
                             "regularMarketTime": int(datetime.fromisoformat(floor.replace("Z", "+00:00")).timestamp())}}
                    self.fetcher.write_json(raw_path, self.fetcher.build_yf_payload("SLON", newer, stamp))
                if foreign:
                    self.fetcher.write_json(detail_path, {**old_detail, "ticker": "FOREIGN"})
                before = (raw_path.read_bytes(), detail_path.read_bytes())
                original_replace = os.replace
                original_observation = self.fetcher.record_etf_detail_observation

                def record_observation(**kwargs):
                    if metadata_error and kwargs.get("provider") == "yahoo_finance":
                        raise RuntimeError("injected observation persistence failure")
                    return original_observation(**kwargs)

                def replace(source, target):
                    if fail_detail_write and Path(target) == detail_path:
                        raise OSError("injected detail publication failure")
                    return original_replace(source, target)

                with patch.dict(os.environ, {"GITHUB_ACTIONS": "true" if remote else "false",
                                           "GITHUB_RUN_ID": "" if unbound else "901", "GITHUB_RUN_ATTEMPT": str(run_attempt),
                                           "GITHUB_EVENT_NAME": event_name}), \
                     patch.object(self.fetcher, "now_iso", return_value=stamp), \
                     patch.object(self.fetcher, "fetch_etf", return_value=primary), \
                     patch.object(self.fetcher, "load_yf_finance_module", return_value=YahooModule), \
                     patch.object(self.fetcher.os, "replace", side_effect=replace), \
                     patch.object(self.fetcher, "record_etf_detail_observation", side_effect=record_observation):
                    result = self.fetcher.run_one("etf", "SLON", 1, False, yf_fallback=enabled,
                        collection_origin="natural" if event_name == "schedule" else "manual",
                        recovery_run={"run_id": "901", "run_attempt": run_attempt, "event_name": event_name, "observed_at": stamp})
                resolved = resolve_entities(store, entities=["SLON"], decided_at="2026-09-28T10:01:00Z")
                active = store.read_active_domain("etf_detail")
                history = [json.loads(line) for path in (store.root / "history/observations").glob("*.jsonl")
                           for line in path.read_text().splitlines()]
                return {"result": result, "resolved": resolved, "active": active, "history": history,
                        "before": before, "after": (raw_path.read_bytes(), detail_path.read_bytes()),
                        "adapter_state": json.loads((root / "data/admin/yahoo_etf_fallback/index.json").read_text()) if pending else None,
                        "primary": json.loads((self.fetcher.OUT_DIR / "etfs/SLON.json").read_text())}
            finally:
                self.fetcher.install_candidate_outputs(original_outputs)

    def test_partial_primary_real_fetch_path_refreshes_selected_yahoo_with_bound_manual_observation(self):
        case = self.partial_primary_selected_yahoo_case()
        self.assertEqual(case["result"]["fallback_refresh_status"], "ok")
        self.assertEqual(case["resolved"]["results"][0]["provider"], "yahoo_finance")
        self.assertEqual(case["active"]["current"]["SLON"]["source_as_of"], "2026-09-25T20:00:00Z")
        self.assertEqual(case["primary"]["detail_status"], "stockanalysis_partial")
        self.assertEqual(case["primary"]["partial_reason_codes"], ["holdings_surface_fallback_overview", "holdings_countries_unavailable"])
        yahoo = max((row for row in case["history"] if row["provider"] == "yahoo_finance"),
                    key=lambda row: datetime.fromisoformat(row["observed_at"].replace("Z", "+00:00")))
        self.assertEqual(yahoo["observation_origin"], "rebuild")
        self.assertEqual(yahoo["collection_origin"], "manual")
        self.assertEqual(yahoo["payload_sha256"], hashlib.sha256(case["after"][1]).hexdigest())

    def test_partial_primary_selected_yahoo_keeps_original_bytes_when_refresh_is_unsafe_or_fails(self):
        cases = ({"yahoo_source": "2026-09-28T20:00:00Z"}, {"yahoo_source": "2026-07-07T20:00:00Z"},
                 {"floor": "2026-09-26T20:00:00Z"}, {"foreign": True}, {"returned_error": True},
                 {"fail_detail_write": True}, {"enabled": False})
        for kwargs in cases:
            with self.subTest(kwargs=kwargs):
                case = self.partial_primary_selected_yahoo_case(**kwargs)
                self.assertEqual(case["after"], case["before"])
                self.assertEqual(case["active"]["current"]["SLON"]["source_as_of"], "2026-07-08T20:00:00Z")
                self.assertEqual(case["primary"]["detail_status"], "stockanalysis_partial")


    def test_pending_yahoo_retry_accepts_valid_manual_acquisition_through_existing_publisher(self):
        case = self.partial_primary_selected_yahoo_case(pending=True, remote=False, run_attempt=2)
        self.assertEqual(case["result"]["fallback_refresh_status"], "ok")
        self.assertEqual(case["active"]["current"]["SLON"]["provider"], "yahoo_finance")
        self.assertEqual(case["active"]["current"]["SLON"]["source_as_of"], "2026-09-25T20:00:00Z")

    def test_committed_adapter_pair_survives_downstream_observation_failure(self):
        case = self.partial_primary_selected_yahoo_case(pending=True, metadata_error=True)
        self.assertEqual(case["result"]["fallback_refresh_status"], "failed")
        self.assertIn("injected observation persistence failure", case["result"]["fallback_refresh_error"])
        provider, detail = (json.loads(raw) for raw in case["after"])
        self.assertEqual(detail["source_as_of"], "2026-09-25T20:00:00Z")
        self.assertEqual(detail["raw"]["yf"], provider["data"])
        item = case["adapter_state"]["items"][self.fetcher.yahoo_etf_fallback_key("SLON")]
        self.assertFalse(item["retry"])
        self.assertEqual(item["current"]["payload_sha256"], hashlib.sha256(case["after"][1]).hexdigest())
        self.assertEqual(item["current"]["source_as_of"], detail["source_as_of"])
        self.assertEqual(case["adapter_state"]["retry_set"], [])

    def test_real_fetch_path_refreshes_yahoo_when_partial_primary_is_stale_or_dateless(self):
        for kind in ("stale", "dateless"):
            with self.subTest(kind=kind):
                case = self.partial_primary_selected_yahoo_case(primary_kind=kind)
                self.assertEqual(case["result"]["fallback_refresh_status"], "ok")
                self.assertEqual(case["active"]["current"]["SLON"]["provider"], "yahoo_finance")
                self.assertEqual(case["active"]["current"]["SLON"]["source_as_of"], "2026-09-25T20:00:00Z")
                self.assertEqual(case["primary"]["detail_status"], "stockanalysis_partial")

    def test_scheduled_partial_primary_refreshes_yahoo_without_natural_recovery_credit(self):
        case = self.partial_primary_selected_yahoo_case(event_name="schedule")
        self.assertEqual(case["result"]["fallback_refresh_status"], "ok")
        self.assertEqual(case["active"]["current"]["SLON"]["provider"], "yahoo_finance")
        self.assertEqual(case["active"]["current"]["SLON"]["source_as_of"], "2026-09-25T20:00:00Z")

    def complete_primary_preservation_case(self, *, enabled=True, fallback_error=False,
                                           new_complete=False, old_partial=False, fallback_source="2026-09-25T20:00:00Z",
                                           remote=True, run_attempt=1, no_current=False, cached=False,
                                           primary_source="2026-09-25T20:00:00Z", old_source="2026-09-24T20:00:00Z"):
        from data_supply_resolver import DataSupplyResolver
        from resolve_etf_detail_candidates import resolve_entities
        stamp = "2026-09-28T10:00:00Z"
        old_fetched = (datetime.fromisoformat(old_source.replace("Z", "+00:00")) + timedelta(hours=1)).isoformat().replace("+00:00", "Z")
        source = primary_source
        old = {"schema_version": "stockanalysis/v1", "source": "stockanalysis", "asset_type": "etf", "ticker": "AFK",
               "source_as_of": old_source, "fetched_at": old_fetched,
               "normalized": {"overview": {"aum": 100}, "holdings": [{"symbol": "OLD", "weight_pct": 10}],
                              "countries": [{"name": "South Africa", "weight_pct": 90}]},
               "raw": {"quote": {"td": old_source[:10], "ts": int(datetime.fromisoformat(old_source.replace("Z", "+00:00")).timestamp())}}}
        if old_partial:
            old["detail_status"] = "stockanalysis_partial"
            old["partial_reason_codes"] = ["holdings_countries_unavailable"]
            old["normalized"]["countries"] = None
        candidate = {"schema_version": "stockanalysis/v1", "source": "stockanalysis", "asset_type": "etf", "ticker": "AFK",
                     "source_as_of": source, "fetched_at": stamp,
                     "normalized": {"overview": {"aum": 110}, "holdings": [{"symbol": "NEW", "weight_pct": 5}], "countries": []},
                     "raw": {"quote": {"td": source[:10], "ts": int(datetime.fromisoformat(source.replace("Z", "+00:00")).timestamp())}}}
        if new_complete:
            candidate["normalized"]["countries"] = [{"name": "South Africa", "weight_pct": 85}]
        else:
            candidate["detail_status"] = "stockanalysis_partial"
            candidate["partial_reason_codes"] = ["holdings_surface_fallback_overview", "holdings_countries_unavailable"]
        data = {"info": {"symbol": "AFK", "quoteType": "ETF", "currentPrice": 31,
                         "regularMarketTime": int(datetime.fromisoformat(fallback_source.replace("Z", "+00:00")).timestamp())},
                "history_1y": [{"date": "2026-09-25", "close": 31}]}
        yahoo_calls = []
        engine = self.fetcher.load_yf_finance_module()
        class YahooModule:
            decorate_finance_payload = staticmethod(engine.decorate_finance_payload)
            @staticmethod
            def fetch_with_retry(*_args, **_kwargs):
                yahoo_calls.append("AFK")
                return (None if fallback_error else data, 1, "provider unavailable" if fallback_error else None,
                        {"attempts_used": 1, "latency_ms": 1, "cached": cached})

        original_outputs = self.fetcher.current_candidate_outputs()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fetcher.install_candidate_outputs(self.fetcher.CandidateOutputs.from_root(root))
            try:
                canonical = self.fetcher.OUT_DIR / "etfs/AFK.json"
                store = self.fetcher.data_supply_store(provider_truth_root=root)
                before = None
                if not no_current:
                    self.fetcher.write_json(canonical, old)
                    before = canonical.read_bytes()
                    old_row = self.fetcher.record_etf_detail_observation(provider="stockanalysis", endpoint_family="stockanalysis_etf_detail",
                        ticker="AFK", provider_path="data/stockanalysis/etfs/AFK.json", payload_path=canonical,
                        provider_schema="stockanalysis/v1", source_as_of=old_source, observed_at=old["fetched_at"],
                        validation_status="valid", reason_code="contract_valid", collection_origin="manual")
                    initial_decision = (datetime.fromisoformat(old_fetched.replace("Z", "+00:00")) + timedelta(minutes=1)).isoformat().replace("+00:00", "Z")
                    DataSupplyResolver(store).resolve_etf_detail(entity="AFK", observations=[old_row], decided_at=initial_decision)
                with patch.object(self.fetcher, "now_iso", return_value="2026-09-24T21:02:00Z"):
                    self.fetcher.record_etf_detail_failure_observation(provider="yahoo_finance", endpoint_family="yahoo_finance_etf_detail",
                        ticker="AFK", provider_path="data/yf/etf-details/AFK.json", provider_schema="yf-etf-detail/v1",
                        reason_code="source_date_unavailable", failure_detail="no dated fallback", collection_origin="manual")
                with patch.dict(os.environ, {"GITHUB_ACTIONS": "true" if remote else "false", "GITHUB_RUN_ID": "950", "GITHUB_RUN_ATTEMPT": str(run_attempt),
                                            "GITHUB_EVENT_NAME": "workflow_dispatch"}), \
                     patch.object(self.fetcher, "now_iso", return_value=stamp), \
                     patch.object(self.fetcher, "fetch_etf", return_value=candidate), \
                     patch.object(self.fetcher, "load_yf_finance_module", return_value=YahooModule), \
                     patch.object(self.fetcher, "list_yahoo_etf_fallback_retry_targets", return_value=[]):
                    result = self.fetcher.run_one("etf", "AFK", 1, False, yf_fallback=enabled, collection_origin="manual",
                        recovery_run={"run_id": "950", "run_attempt": run_attempt, "event_name": "workflow_dispatch", "observed_at": stamp})
                resolved = resolve_entities(store, entities=["AFK"], decided_at="2026-09-28T10:01:00Z")
                active = store.read_active_domain("etf_detail")
                history = [json.loads(line) for file in (store.root / "history/observations").glob("*.jsonl") for line in file.read_text().splitlines()]
                diagnostic = next((row for row in history if row["reason_code"] == "partial_primary_complete_preserved"), None)
                candidate_raw = (root / diagnostic["provider_path"]).read_bytes() if diagnostic else None
                lkg = active["lkg"].get("AFK")
                lkg_payload = json.loads((store.root / lkg["payload_ref"]["path"]).read_bytes()) if lkg else None
                return {"result": result, "resolved": resolved, "active": active, "history": history, "old": old,
                        "before": before, "after": canonical.read_bytes() if canonical.exists() else None, "candidate": candidate, "candidate_raw": candidate_raw,
                        "yahoo_calls": yahoo_calls, "yahoo_published": (self.fetcher.YF_OUT_DIR / "AFK.json").exists() or (self.fetcher.YF_ETF_DETAIL_OUT_DIR / "AFK.json").exists(),
                        "diagnostic": diagnostic, "lkg_payload": lkg_payload,
                        "selected_payload": store.read_resolved_payload("etf_detail", "AFK") if "AFK" in active["current"] else None}
            finally:
                self.fetcher.install_candidate_outputs(original_outputs)

    def test_complete_primary_partial_response_preserves_full_bytes_and_rejects_poorer_yahoo(self):
        case = self.complete_primary_preservation_case()
        self.assertEqual(case["after"], case["before"])
        self.assertFalse(case["result"]["canonical_write"])
        self.assertEqual(case["result"]["provider_response"], "HTTP 200 partial contract valid")
        self.assertEqual(case["result"]["fallback_refresh_status"], "ok")
        self.assertEqual(case["active"]["current"]["AFK"]["provider"], "stockanalysis")
        self.assertEqual(case["active"]["current"]["AFK"]["resolution_state"], "lkg_primary")
        self.assertEqual(case["active"]["current"]["AFK"]["source_as_of"], case["old"]["source_as_of"])
        self.assertEqual(case["lkg_payload"], case["old"])
        self.assertEqual(json.loads(case["candidate_raw"]), case["candidate"])
        self.assertEqual(case["diagnostic"]["validation_status"], "invalid")
        self.assertEqual(case["diagnostic"]["source_as_of"], "2026-09-25T20:00:00Z")
        self.assertNotIn("payload_available", case["diagnostic"])
        yahoo = [row for row in case["history"] if row["provider"] == "yahoo_finance" and row["validation_status"] == "valid"][-1]
        self.assertEqual(yahoo["observation_origin"], "rebuild")

    def test_complete_primary_partial_response_without_valid_fallback_preserves_full_snapshot_and_diagnostic(self):
        for kwargs in ({"enabled": False}, {"fallback_error": True},
                       {"fallback_source": "2026-09-23T20:00:00Z"}, {"fallback_source": "2026-09-28T20:00:00Z"}):
            with self.subTest(kwargs=kwargs):
                case = self.complete_primary_preservation_case(**kwargs)
                self.assertEqual(case["after"], case["before"])
                self.assertEqual(json.loads(case["candidate_raw"]), case["candidate"])
                self.assertEqual(case["active"]["current"]["AFK"]["resolution_state"], "lkg_primary")
                self.assertEqual(case["active"]["current"]["AFK"]["source_as_of"], case["old"]["source_as_of"])
                self.assertEqual(case["selected_payload"], case["old"])
                self.assertEqual(case["lkg_payload"], case["old"])

    def test_complete_primary_accepts_genuine_complete_refresh_and_disabled_partial_refresh_is_unchanged(self):
        for kwargs in ({"new_complete": True}, {"old_partial": True, "enabled": False}):
            with self.subTest(kwargs=kwargs):
                case = self.complete_primary_preservation_case(**kwargs)
                self.assertEqual(json.loads(case["after"]), case["candidate"])
                self.assertTrue(case["result"]["canonical_write"])
                self.assertIsNone(case["diagnostic"])
                self.assertEqual(case["active"]["current"]["AFK"]["provider"], "stockanalysis")
                self.assertEqual(case["selected_payload"], case["candidate"])

    def test_preserved_partial_candidate_leaves_no_private_path_in_public_index_row(self):
        case = self.complete_primary_preservation_case()
        result = case["result"]
        self.assertEqual(result["status"], "partial_observed_complete_primary_preserved")
        self.assertIsNone(result["candidate_path"])
        self.assertIs(result["partial_candidate_preserved"], True)
        self.assertTrue(case["diagnostic"]["provider_path"].startswith("data/admin/data-supply-state/v1/partial_candidates/AFK/"))
        index_text = self.fetcher.json_payload_bytes({"results": [result]}).decode("utf-8")
        self.assertNotIn("data/admin/", index_text)
        self.assertNotIn("admin/data-supply-state/", index_text)

    def test_preserved_partial_actual_bytes_stay_inside_existing_private_public_sync_boundary(self):
        import subprocess
        case = self.complete_primary_preservation_case()
        relative = case["diagnostic"]["provider_path"]
        self.assertTrue(relative.startswith("data/admin/data-supply-state/v1/partial_candidates/AFK/"))
        self.assertEqual(json.loads(case["candidate_raw"]), case["candidate"])
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            private = root / relative
            private.parent.mkdir(parents=True)
            private.write_bytes(case["candidate_raw"])
            marker = root / "data/public-marker.json"
            marker.write_text('{"public":true}')
            public = root / "public/data"
            script = (
                "import { pathToFileURL } from 'node:url'; "
                "const { syncPublicData } = await import(pathToFileURL(process.argv[2]).href); "
                "syncPublicData({sourceRoot:process.argv[3],destinationRoot:process.argv[4]});"
            )
            subprocess.run(["node", "--input-type=module", "-e", script, "fixture-driver",
                            str(ROOT / "100xfenok-next/scripts/sync-public-data.mjs"), str(root / "data"), str(public)],
                           check=True, capture_output=True, text=True)
            self.assertEqual((public / "public-marker.json").read_bytes(), marker.read_bytes())
            self.assertFalse((public / relative.removeprefix("data/")).exists())
            self.assertFalse(any(path.read_bytes() == case["candidate_raw"] for path in public.rglob("*.json")))
            self.assertEqual(private.read_bytes(), case["candidate_raw"])

    def test_existing_partial_primary_keeps_valid_observation_when_yahoo_is_poorer(self):
        case = self.complete_primary_preservation_case(old_partial=True)
        self.assertEqual(json.loads(case["after"]), case["candidate"])
        self.assertEqual(case["result"]["fallback_refresh_status"], "ok")
        self.assertEqual(case["active"]["current"]["AFK"]["provider"], "stockanalysis")
        self.assertEqual(case["active"]["current"]["AFK"]["source_as_of"], "2026-09-25T20:00:00Z")
        self.assertIsNone(case["lkg_payload"])
        primary = [row for row in case["history"] if row["provider"] == "stockanalysis"][-1]
        self.assertEqual(primary["validation_status"], "valid")
        self.assertEqual(primary["reason_code"], "contract_valid")
        self.assertEqual(primary["source_as_of"], case["candidate"]["source_as_of"])
        self.assertEqual(primary["collection_origin"], "manual")
        self.assertEqual(primary["observation_origin"], "rebuild")
        self.assertNotIn("payload_available", primary)
        yahoo = [row for row in case["history"] if row["provider"] == "yahoo_finance" and row["validation_status"] == "valid"][-1]
        self.assertEqual(yahoo["collection_origin"], "manual")

    def test_initial_partial_primary_remains_selected_when_yahoo_loses_holdings(self):
        case = self.complete_primary_preservation_case(no_current=True)
        self.assertIsNone(case["before"])
        self.assertEqual(json.loads(case["after"]), case["candidate"])
        self.assertEqual(case["active"]["current"]["AFK"]["provider"], "stockanalysis")
        self.assertEqual(case["active"]["current"]["AFK"]["source_as_of"], "2026-09-25T20:00:00Z")
        yahoo = [row for row in case["history"] if row["provider"] == "yahoo_finance" and row["validation_status"] == "valid"][-1]
        self.assertEqual(yahoo["observation_origin"], "rebuild")

    def test_existing_partial_primary_rejects_unbound_yahoo_and_checks_primary_floor_before_fetch(self):
        for kwargs in ({"fallback_error": True},):
            with self.subTest(kwargs=kwargs):
                case = self.complete_primary_preservation_case(old_partial=True, **kwargs)
                self.assertEqual(case["active"]["current"]["AFK"]["provider"], "stockanalysis")
                self.assertEqual(case["selected_payload"], case["candidate"])
                self.assertFalse(any(row["provider"] == "yahoo_finance" and row["validation_status"] == "valid"
                                     for row in case["history"]))
        case = self.complete_primary_preservation_case(old_partial=True, primary_source="2026-09-23T20:00:00Z")
        self.assertEqual(case["after"], case["before"])
        self.assertEqual(case["yahoo_calls"], [])
        self.assertFalse(any(row["provider"] == "yahoo_finance" and row["validation_status"] == "valid"
                             for row in case["history"]))

    def test_stale_bound_yahoo_cannot_disqualify_fresh_partial_primary_or_publish_false_freshness(self):
        for kwargs in ({"old_partial": True, "old_source": "2026-08-11T20:00:00Z"}, {"no_current": True}):
            with self.subTest(kwargs=kwargs):
                case = self.complete_primary_preservation_case(fallback_source="2026-09-10T20:00:00Z", **kwargs)
                self.assertEqual(case["result"]["fallback_refresh_status"], "failed")
                self.assertFalse(case["yahoo_published"])
                self.assertEqual(json.loads(case["after"]), case["candidate"])
                self.assertEqual(case["active"]["current"]["AFK"]["provider"], "stockanalysis")
                self.assertEqual(case["active"]["current"]["AFK"]["source_as_of"], "2026-09-25T20:00:00Z")
                self.assertEqual(case["selected_payload"], case["candidate"])
                primary = max((row for row in case["history"] if row["provider"] == "stockanalysis"), key=lambda row: row["observed_at"])
                self.assertEqual(primary["validation_status"], "valid")
                self.assertEqual(primary["collection_origin"], "manual")
                self.assertFalse(any(row["provider"] == "yahoo_finance" and row["validation_status"] == "valid"
                                     for row in case["history"]))
        case = self.complete_primary_preservation_case(old_source="2026-08-11T20:00:00Z", fallback_source="2026-09-10T20:00:00Z")
        self.assertEqual(case["after"], case["before"])
        self.assertEqual(json.loads(case["candidate_raw"]), case["candidate"])
        self.assertEqual(case["result"]["fallback_refresh_status"], "failed")
        self.assertFalse(case["yahoo_published"])
        self.assertFalse(any(row["provider"] == "yahoo_finance" and row["validation_status"] == "valid"
                             for row in case["history"]))

    def test_public_etf_detail_mirror_is_retired(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            original_out, original_public = self.fetcher.OUT_DIR, self.fetcher.PUBLIC_DIR
            self.fetcher.OUT_DIR = root / "data" / "stockanalysis"
            self.fetcher.PUBLIC_DIR = root / "public" / "data" / "stockanalysis"
            try:
                with self.assertRaisesRegex(ValueError, "mirroring is retired"):
                    self.fetcher.write_payload(
                        "etfs/SPY.json",
                        {"schema_version": "stockanalysis/v1", "ticker": "SPY", "asset_type": "etf"},
                        mirror_public=True,
                    )
                self.assertFalse((self.fetcher.OUT_DIR / "etfs/SPY.json").exists())
                self.assertFalse((self.fetcher.PUBLIC_DIR / "etfs/SPY.json").exists())
            finally:
                self.fetcher.OUT_DIR, self.fetcher.PUBLIC_DIR = original_out, original_public

    def test_default_cli_writes_canonical_only_never_public_mirror(self) -> None:
        original_argv = sys.argv
        original_dirs = self.fetcher.OUT_DIR, self.fetcher.PUBLIC_DIR
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fetcher.OUT_DIR = root / "data" / "stockanalysis"
            self.fetcher.PUBLIC_DIR = root / "public" / "stockanalysis"
            sys.argv = [
                "fetch-stockanalysis.py",
                "--coverage-only",
                "--stocks-only",
                "--event-name",
                "workflow_dispatch",
            ]
            try:
                self.fetcher.main()
            finally:
                self.fetcher.OUT_DIR, self.fetcher.PUBLIC_DIR = original_dirs
                sys.argv = original_argv
            self.assertTrue(
                (root / "data" / "stockanalysis" / "coverage" / "etf_detail.json").is_file(),
                "default CLI run must write the canonical coverage proof",
            )
            self.assertFalse(
                (root / "public").exists(),
                "default CLI run must never create the public mirror",
            )




    def test_etf_universe_payload_keeps_provider_date_unstamped(self) -> None:
        original_fetch = self.fetcher.fetch_text_response
        original_parse = self.fetcher.parse_etf_universe_page
        original_enrich = self.fetcher.enrich_etf_records
        original_now = self.fetcher.now_iso
        self.fetcher.fetch_text_response = lambda _path, _timeout: ("<html></html>", 200)
        self.fetcher.parse_etf_universe_page = lambda _html, page: [
            {"ticker": "SPY", "name": "SPY ETF", "source_page": page}
        ]
        self.fetcher.enrich_etf_records = lambda rows: rows
        self.fetcher.now_iso = lambda: "2026-08-09T00:15:00Z"
        try:
            payload = self.fetcher.fetch_etf_universe(max_pages=1, timeout=1, sleep=0)
        finally:
            self.fetcher.fetch_text_response = original_fetch
            self.fetcher.parse_etf_universe_page = original_parse
            self.fetcher.enrich_etf_records = original_enrich
            self.fetcher.now_iso = original_now

        self.assertIsNone(payload["source_as_of"])
        self.assertEqual(
            payload["source_as_of_reason"],
            self.fetcher.STOCKANALYSIS_ETF_UNIVERSE_SOURCE_AS_OF_REASON,
        )
        self.assertEqual(payload["generated_at"], payload["fetched_at"])

    def test_manual_etf_preflight_accepts_uncapped_maintenance_without_writes(self) -> None:
        too_many = ",".join(f"E{index:03d}" for index in range(101))
        for flags in (
            ["--etfs", too_many],
            ["--etfs", "SPY", "--limit-etfs", "101"],
            ["--incremental-etf-backfill", "--incremental-etf-limit", "101"],
            ["--reconcile-missing-etf-details", "--incremental-etf-limit", "0"],
            ["--universe-backfill", "--limit-etfs", "0"],
        ):
            with self.subTest(flags=flags), \
                 patch.object(sys, "argv", ["fetch-stockanalysis.py", "--event-name", "workflow_dispatch",
                                             "--preflight-only", *flags]), \
                 patch.object(self.fetcher, "fetch_etf") as network, \
                 patch.object(self.fetcher, "write_payload") as writer:
                self.fetcher.main()
                network.assert_not_called()
                writer.assert_not_called()

    def test_candidate_root_rejects_repo_and_symlink_and_routes_all_outputs_outside_checkout(self) -> None:
        saved = self.fetcher.current_candidate_outputs()
        try:
            with self.assertRaisesRegex(ValueError, "repository"):
                self.fetcher.configure_candidate_outputs(ROOT)
            with self.assertRaisesRegex(ValueError, "repository"):
                self.fetcher.configure_candidate_outputs(ROOT.parent)
            with tempfile.TemporaryDirectory() as tmp:
                external = Path(tmp) / "candidate"
                external.mkdir()
                link = Path(tmp) / "candidate-link"
                link.symlink_to(external, target_is_directory=True)
                with self.assertRaisesRegex(ValueError, "symlink"):
                    self.fetcher.configure_candidate_outputs(link)
                outputs = self.fetcher.configure_candidate_outputs(external)
                for path in outputs.all_output_paths():
                    self.assertTrue(path.is_relative_to(external.resolve()))
                    self.assertFalse(path.is_relative_to(ROOT.resolve()))
        finally:
            self.fetcher.install_candidate_outputs(saved)

    def test_candidate_data_supply_store_defers_pruning_and_has_no_direct_bypasses(self) -> None:
        saved_outputs = self.fetcher.current_candidate_outputs()
        original_store = self.fetcher.DataSupplyStateStore
        calls = []

        class CapturingStore:
            def __init__(self, *args, **kwargs):
                calls.append((args, kwargs))

        self.fetcher.DataSupplyStateStore = CapturingStore
        try:
            self.fetcher.data_supply_store(provider_truth_root=ROOT)
            self.assertFalse(calls[-1][1]["defer_maintenance"])
            with tempfile.TemporaryDirectory() as tmp:
                candidate = Path(tmp) / "candidate"
                candidate.mkdir()
                self.fetcher.configure_candidate_outputs(candidate)
                self.fetcher.data_supply_store(provider_truth_root=candidate)
                self.assertTrue(calls[-1][1]["defer_maintenance"])
        finally:
            self.fetcher.DataSupplyStateStore = original_store
            self.fetcher.install_candidate_outputs(saved_outputs)

        source = FETCHER_PATH.read_text(encoding="utf-8")
        self.assertEqual(source.count("DataSupplyStateStore("), 1)

    def test_invalid_etf_worker_count_fails_before_canary_or_candidate_mutation(self) -> None:
        original_canary = self.fetcher.run_endpoint_canary
        original_argv = sys.argv
        saved = self.fetcher.current_candidate_outputs()
        calls = []
        with tempfile.TemporaryDirectory() as tmp:
            candidate = Path(tmp) / "candidate"
            candidate.mkdir()
            sentinel = candidate / "sentinel.txt"
            sentinel.write_text("unchanged\n")
            before = {p.relative_to(candidate): p.read_bytes() for p in candidate.rglob("*") if p.is_file()}
            self.fetcher.run_endpoint_canary = lambda *_args: calls.append("canary")
            sys.argv = [
                "fetch-stockanalysis.py",
                "--candidate-root", str(candidate),
                "--no-public-mirror",
                "--event-name", "workflow_dispatch",
                "--endpoint-canary",
                "--etfs", "SPY", "--etf-workers", "0",
            ]
            try:
                for invalid in ("0", "5", "-1"):
                    sys.argv[-1] = invalid
                    with self.subTest(invalid=invalid):
                        with self.assertRaisesRegex(SystemExit, "between 1 and 4"):
                            self.fetcher.main()
            finally:
                self.fetcher.run_endpoint_canary = original_canary
                sys.argv = original_argv
                self.fetcher.install_candidate_outputs(saved)
            after = {p.relative_to(candidate): p.read_bytes() for p in candidate.rglob("*") if p.is_file()}
        self.assertEqual(calls, [])
        self.assertEqual(after, before)

    def test_acquire_subprocess_never_mutates_checkout_on_success_failure_or_signal(self) -> None:
        def checkout_snapshot() -> tuple[bytes, bytes]:
            status = subprocess.check_output(
                ["git", "status", "--porcelain=v1", "-z", "--untracked-files=all"],
                cwd=ROOT,
            )
            diff = subprocess.check_output(
                ["git", "diff", "--binary", "--no-ext-diff", "HEAD", "--"],
                cwd=ROOT,
            )
            return status, diff

        env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
        before = checkout_snapshot()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            success_candidate = root / "success-candidate"
            success_candidate.mkdir()
            success = subprocess.run(
                [
                    sys.executable,
                    str(FETCHER_PATH),
                    "--candidate-root", str(success_candidate),
                    "--no-public-mirror",
                    "--coverage-only",
                    "--stocks-only",
                    "--event-name", "workflow_dispatch",
                ],
                cwd=ROOT,
                env=env,
                capture_output=True,
                text=True,
            )
            self.assertEqual(success.returncode, 0, success.stderr)
            self.assertTrue((success_candidate / "data/stockanalysis/coverage/etf_detail.json").is_file())

            failure_candidate = root / "failure-candidate"
            failure_candidate.mkdir()
            failure = subprocess.run(
                [
                    sys.executable,
                    str(FETCHER_PATH),
                    "--candidate-root", str(failure_candidate),
                    "--no-public-mirror",
                    "--event-name", "workflow_dispatch",
                    "--etfs", "SPY", "--etf-workers", "0",
                ],
                cwd=ROOT,
                env=env,
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(failure.returncode, 0)
            self.assertIn("--etf-workers must be between 1 and 4", failure.stderr)
            self.assertEqual(list(failure_candidate.iterdir()), [])

            signal_candidate = root / "signal-candidate"
            signal_candidate.mkdir()
            wrapper = f"""
import importlib.util
import sys
import time
spec = importlib.util.spec_from_file_location('stockanalysis_signal_fixture', {str(FETCHER_PATH)!r})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
def blocked_canary(*_args, **_kwargs):
    print('SIGNAL_FIXTURE_READY', flush=True)
    time.sleep(60)
module.run_endpoint_canary = blocked_canary
sys.argv = [
    'fetch-stockanalysis.py', '--candidate-root', {str(signal_candidate)!r},
    '--no-public-mirror', '--event-name', 'workflow_dispatch',
    '--endpoint-canary', '--stocks-only',
]
module.main()
"""
            process = subprocess.Popen(
                [sys.executable, "-c", wrapper],
                cwd=ROOT,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            try:
                self.assertEqual(process.stdout.readline().strip(), "SIGNAL_FIXTURE_READY")
                process.terminate()
                process.wait(timeout=5)
                self.assertNotEqual(process.returncode, 0)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait(timeout=5)
                if process.stdout is not None:
                    process.stdout.close()
                if process.stderr is not None:
                    process.stderr.close()

        self.assertEqual(checkout_snapshot(), before)






    def test_surface_unexpected_exception_after_success_emits_failure_observation(self) -> None:
        original_fetch = self.fetcher.fetch_table_surface_response
        original_run = self.fetcher.subprocess.run
        original_dirs = self.fetcher.OUT_DIR, self.fetcher.PUBLIC_DIR
        calls = []

        def fake_run(args, **kwargs):
            calls.append((args, kwargs))
            return subprocess.CompletedProcess(args, 0)

        def fake_fetch(name, _definition, _timeout):
            if name == "ipos_recent":
                return ({
                    "schema_version": "stockanalysis/v1",
                    "source": "stockanalysis",
                    "surface": name,
                    "format": "html_table",
                    "counts": {"tables": 1, "rows": 1},
                }, 200)
            raise TypeError("controlled uncaught schema branch")

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            recovery_store = self.fetcher.StockAnalysisRecoveryStateStore(
                root / "data" / "admin" / "stockanalysis-recovery", root
            )
            recovery_run = {
                "run_id": "surface-unexpected",
                "run_attempt": 1,
                "event_name": "workflow_dispatch",
                "observed_at": "2026-07-15T08:00:00Z",
            }
            self.fetcher.fetch_table_surface_response = fake_fetch
            self.fetcher.subprocess.run = fake_run
            self.fetcher.OUT_DIR = root / "data" / "stockanalysis"
            self.fetcher.PUBLIC_DIR = root / "public" / "stockanalysis"
            try:
                summary = self.fetcher.fetch_surfaces(
                    ["ipos_recent", "ipos_statistics"], 1, 0, False,
                    recovery_store=recovery_store,
                    recovery_run=recovery_run,
                )
                unexpected_state = json.loads(
                    (recovery_store.root / "states" / "surface" / "ipos_statistics.json").read_text()
                )
            finally:
                self.fetcher.fetch_table_surface_response = original_fetch
                self.fetcher.subprocess.run = original_run
                self.fetcher.OUT_DIR, self.fetcher.PUBLIC_DIR = original_dirs

        self.assertEqual(summary["counts"]["ok"], 1)
        self.assertEqual(summary["counts"]["failed"], 1)
        self.assertTrue(unexpected_state["retry"])
        self.assertIn("TypeError: controlled uncaught schema branch", unexpected_state["latest_failure"]["error"])

    def test_endpoint_canary_failure_emits_non_ready_r4_producer_failure(self) -> None:
        original_canary = self.fetcher.run_endpoint_canary
        original_write = self.fetcher.write_payload
        original_run = self.fetcher.subprocess.run
        original_argv = sys.argv
        calls = []

        def fake_run(args, **kwargs):
            calls.append((args, kwargs))
            return subprocess.CompletedProcess(args, 0)

        self.fetcher.run_endpoint_canary = lambda *_args, **_kwargs: {
            "status": "blocked",
            "counts": {"ready": 0, "probes": 1, "blocked": 1},
        }
        self.fetcher.write_payload = lambda *_args, **_kwargs: None
        self.fetcher.subprocess.run = fake_run
        sys.argv = [
            "fetch-stockanalysis.py",
            "--endpoint-canary",
            "--stocks-only",
        ]
        try:
            with self.assertRaises(SystemExit) as caught:
                self.fetcher.main()
        finally:
            self.fetcher.run_endpoint_canary = original_canary
            self.fetcher.write_payload = original_write
            self.fetcher.subprocess.run = original_run
            sys.argv = original_argv

        self.assertEqual(caught.exception.code, 3)

    def test_svelte_devalue_surface_fixture(self) -> None:
        payload = json.loads((FIXTURE_DIR / "new_etfs__data.fixture.json").read_text(encoding="utf-8"))
        decoded = self.fetcher.extract_svelte_node(payload, ("data",))

        self.assertEqual(decoded["data"][0]["s"], "AAA")
        self.assertEqual(decoded["data"][1]["n"], "Beta Balance ETF")
        self.assertEqual(decoded["dataPoints"], ["s", "n", "as"])

    def test_etf_detail_svelte_contract_fixtures_and_provenance(self) -> None:
        overview = json.loads((FIXTURE_DIR / "etf_overview__data.fixture.json").read_text())
        holdings = json.loads((FIXTURE_DIR / "etf_holdings__data.fixture.json").read_text())
        od = self.fetcher.validate_svelte_detail_contract(overview, "overview")
        hd = self.fetcher.validate_svelte_detail_contract(holdings, "holdings")
        self.assertEqual(od["holdingsTable"]["holdings"][0]["s"], "AAPL")
        self.assertEqual(hd["holdings"][0]["s"], "AAPL")
        self.assertEqual(hd["countries"][0]["country"], "United States")

        sparse = json.loads((FIXTURE_DIR / "etf_holdings__data.fixture.json").read_text())
        sparse["nodes"][-1]["data"][0]["sectors"] = -1
        sparse["nodes"][-1]["data"][0]["countries"] = -1
        sparse_decoded = self.fetcher.validate_svelte_detail_contract(sparse, "holdings")
        self.assertIsNone(sparse_decoded["sectors"])
        self.assertIsNone(sparse_decoded["countries"])

        sparse_overview = json.loads((FIXTURE_DIR / "etf_overview__data.fixture.json").read_text())
        sparse_overview["nodes"][-1]["data"][0]["holdings"] = -1
        sparse_overview["nodes"][-1]["data"][0]["holdingsTable"] = -1
        sparse_overview["nodes"][-1]["data"][0]["inception"] = -1
        sparse_overview_decoded = self.fetcher.validate_svelte_detail_contract(sparse_overview, "overview")
        self.assertIsNone(sparse_overview_decoded["holdings"])
        self.assertIsNone(sparse_overview_decoded["holdingsTable"])
        self.assertIsNone(sparse_overview_decoded["inception"])

    def test_empty_holdings_node_requires_explicit_overview_unavailable_profile(self) -> None:
        empty_holdings = {
            "nodes": [
                {"data": [{"info": 1}, {"type": 2, "ticker": 3}, "etf", "NEW"]},
            ]
        }
        original_fetch_json = self.fetcher.fetch_json
        try:
            self.fetcher.fetch_json = lambda _path, _timeout: empty_holdings
            with self.assertRaisesRegex(ValueError, "missing_required"):
                self.fetcher.fetch_svelte_detail("NEW", "holdings", 1)
            path, decoded = self.fetcher.fetch_svelte_detail(
                "NEW", "holdings", 1, allow_unavailable=True
            )
        finally:
            self.fetcher.fetch_json = original_fetch_json
        self.assertEqual(path, "/etf/new/holdings/__data.json")
        self.assertEqual(decoded, {})
        self.assertTrue(self.fetcher.overview_declares_holdings_unavailable({
            "holdings": 0, "holdingsTable": {"count": 0, "holdings": [], "updated": "Oct 31, 2025"},
        }))
        self.assertFalse(self.fetcher.overview_declares_holdings_unavailable({
            "holdings": 4, "holdingsTable": None,
        }))
        self.assertFalse(self.fetcher.overview_declares_holdings_unavailable({
            "holdings": 0, "holdingsTable": {"count": 0, "holdings": [{"s": "AAA"}]},
        }))

    def test_sparse_holdings_contract_accepts_provider_partial_metadata(self) -> None:
        sparse = json.loads((FIXTURE_DIR / "etf_holdings__data.fixture.json").read_text())
        for key in ("count", "countries", "date"):
            sparse["nodes"][-1]["data"][0].pop(key)

        decoded = self.fetcher.validate_svelte_detail_contract(sparse, "holdings")

        self.assertIsInstance(decoded["holdings"], list)
        self.assertIsInstance(decoded["sectors"], list)
        self.assertNotIn("count", decoded)
        self.assertNotIn("countries", decoded)
        self.assertNotIn("date", decoded)

    def test_initial_detail_reconcile_emits_honest_stockanalysis_partial(self) -> None:
        original_fetch_svelte = self.fetcher.fetch_svelte_detail
        original_fetch_json = self.fetcher.fetch_json
        original_fetch_history = self.fetcher.fetch_etf_history_periods
        history_called = False

        def fake_fetch_svelte(ticker: str, surface: str, _timeout: int, **_kwargs):
            if surface == "overview":
                return f"/etf/{ticker.lower()}/__data.json", {
                    "holdings": 2,
                    "holdingsTable": None,
                    "inception": "Jan 1, 2024",
                }
            return f"/etf/{ticker.lower()}/holdings/__data.json", {
                "holdings": [{"s": "GLD", "n": "SPDR Gold Shares", "w": 100}],
                "sectors": [],
            }

        def fake_fetch_json(_path: str, _timeout: int) -> dict:
            self.fail("initial reconcile must not fetch quote or history endpoints")

        def fake_fetch_history(_ticker: str, _timeout: int):
            nonlocal history_called
            history_called = True
            return {}, {}, {}

        self.fetcher.fetch_svelte_detail = fake_fetch_svelte
        self.fetcher.fetch_json = fake_fetch_json
        self.fetcher.fetch_etf_history_periods = fake_fetch_history
        try:
            payload = self.fetcher.fetch_etf(
                "AAAU",
                1,
                include_history=False,
                include_quote=False,
                allow_partial_holdings=True,
            )
        finally:
            self.fetcher.fetch_svelte_detail = original_fetch_svelte
            self.fetcher.fetch_json = original_fetch_json
            self.fetcher.fetch_etf_history_periods = original_fetch_history

        self.assertFalse(history_called)
        self.assertEqual(payload["detail_status"], "stockanalysis_partial")
        self.assertIn("history_deferred_initial_reconcile", payload["partial_reason_codes"])
        self.assertIn("quote_deferred_initial_reconcile", payload["partial_reason_codes"])
        self.assertIn("holdings_count_unavailable", payload["partial_reason_codes"])
        self.assertIn("holdings_date_unavailable", payload["partial_reason_codes"])
        self.assertIn("holdings_countries_unavailable", payload["partial_reason_codes"])
        self.assertEqual(payload["normalized"]["holding_count"], 1)
        self.assertIsNone(payload["source_as_of"])
        self.assertEqual(
            payload["source_as_of_reason"],
            "provider detail response carries no market or holdings observation date",
        )

    def test_reconcile_rejects_available_overview_when_holdings_surface_omits_holdings(self) -> None:
        original_fetch_svelte = self.fetcher.fetch_svelte_detail

        def fake_fetch_svelte(ticker: str, surface: str, _timeout: int, **_kwargs):
            if surface == "overview":
                return f"/etf/{ticker.lower()}/__data.json", {
                    "holdings": 12,
                    "holdingsTable": {"count": 12},
                    "inception": "Jan 1, 2026",
                }
            raise ValueError(
                "svelte_contract_drift:holdings:missing_required:holdings"
            )

        self.fetcher.fetch_svelte_detail = fake_fetch_svelte
        try:
            with self.assertRaisesRegex(ValueError, "missing_required:holdings"):
                self.fetcher.fetch_etf("AAOX", 1, include_history=False)
            with self.assertRaisesRegex(ValueError, "missing_required:holdings"):
                self.fetcher.fetch_etf(
                    "AAOX",
                    1,
                    include_history=False,
                    include_quote=False,
                    allow_partial_holdings=True,
                )
        finally:
            self.fetcher.fetch_svelte_detail = original_fetch_svelte

    def test_reconcile_uses_provider_overview_holdings_updated_as_source_date(self) -> None:
        original_fetch_svelte = self.fetcher.fetch_svelte_detail

        def fake_fetch_svelte(ticker: str, surface: str, _timeout: int, **_kwargs):
            if surface == "overview":
                return f"/etf/{ticker.lower()}/__data.json", {
                    "holdings": None,
                    "holdingsTable": {"updated": "Jul 10, 2026"},
                    "inception": "Jan 1, 2026",
                }
            raise ValueError(
                "svelte_contract_drift:holdings:missing_required:holdings"
            )

        self.fetcher.fetch_svelte_detail = fake_fetch_svelte
        try:
            payload = self.fetcher.fetch_etf(
                "AAOX",
                1,
                include_history=False,
                include_quote=False,
                allow_partial_holdings=True,
            )
        finally:
            self.fetcher.fetch_svelte_detail = original_fetch_svelte

        self.assertEqual(payload["source_as_of"], "2026-07-10T00:00:00Z")
        self.assertNotIn("source_as_of_reason", payload)
        self.fetcher.validate_stockanalysis_etf_payload("AAOX", payload)

    def test_etf_history_expected_400_is_recorded_as_unavailable_not_schema_drift(self) -> None:
        original_fetch_json = self.fetcher.fetch_json
        try:
            def fake_fetch_json(path: str, _timeout: int) -> dict:
                if "period=Daily" in path:
                    raise urllib.error.HTTPError(path, 400, "not indexed", {}, None)
                return {"status": 200, "data": []}
            self.fetcher.fetch_json = fake_fetch_json
            paths, periods, errors = self.fetcher.fetch_etf_history_periods("NEW", 1)
        finally:
            self.fetcher.fetch_json = original_fetch_json

        self.assertEqual(periods["daily_1y"], [])
        self.assertEqual(errors["daily_1y"]["reason_code"], "http_400")
        self.assertEqual(errors["daily_1y"]["path"], paths["daily_1y"])
        self.assertEqual(periods["monthly_1y"], [])

    def test_etf_detail_svelte_contract_fails_closed(self) -> None:
        for payload in ({}, {"nodes": []}, {"nodes": [{"data": [[{"x": 1}]]}]}):
            with self.assertRaises(ValueError):
                self.fetcher.validate_svelte_detail_contract(payload, "overview")

        wrong_type = json.loads((FIXTURE_DIR / "etf_holdings__data.fixture.json").read_text())
        wrong_type["nodes"][-1]["data"][1] = "two"
        with self.assertRaisesRegex(ValueError, "invalid_type:count"):
            self.fetcher.validate_svelte_detail_contract(wrong_type, "holdings")

    def test_holdings_contract_drift_records_bounded_shape_signature_without_values(self) -> None:
        unique_nodes = [
            {"data": [{f"key_{index:02d}": 1}, f"provider-value-{index:02d}"]}
            for index in range(18)
        ]
        payload = {"nodes": [*unique_nodes, unique_nodes[0]]}

        with self.assertRaises(ValueError) as caught:
            self.fetcher.validate_svelte_detail_contract(payload, "holdings")

        self.assertEqual(
            str(caught.exception),
            "svelte_contract_drift:holdings:missing_required:holdings",
        )
        signature = caught.exception.failure_signature
        self.assertEqual(signature["schema_version"], "svelte-contract-failure-signature/v1")
        self.assertEqual(signature["surface"], "holdings")
        self.assertEqual(signature["decoded_candidate_count"], 19)
        self.assertEqual(signature["unique_candidate_key_set_count"], 18)
        self.assertEqual(
            signature["candidate_key_sets"],
            [[f"key_{index:02d}"] for index in range(16)],
        )
        self.assertTrue(signature["candidate_key_sets_truncated"])
        self.assertEqual(
            signature["required_key_value_types"],
            {"holdings": ["missing"]},
        )
        serialized = json.dumps(signature, sort_keys=True)
        self.assertNotIn("provider-value", serialized)
        with self.assertRaises(ValueError) as empty:
            self.fetcher.validate_svelte_detail_contract({"nodes": []}, "holdings")
        self.assertEqual(
            empty.exception.failure_signature["required_key_value_types"],
            {"holdings": ["missing"]},
        )

        original_fetch_etf = self.fetcher.fetch_etf
        saved_outputs = self.fetcher.current_candidate_outputs()
        self.fetcher.fetch_etf = lambda _ticker, _timeout, **_kwargs: (_ for _ in ()).throw(
            caught.exception
        )
        try:
            with tempfile.TemporaryDirectory() as tmp:
                candidate = Path(tmp) / "candidate"
                candidate.mkdir()
                outputs = self.fetcher.configure_candidate_outputs(candidate)
                result = self.fetcher.run_one(
                    "etf",
                    "SHAPE",
                    timeout=1,
                    mirror_public=False,
                    yf_fallback=False,
                )
                history_files = list(
                    (outputs.data_supply_state / "history" / "observations").glob("*.jsonl")
                )
                observations = [
                    json.loads(line)
                    for line in history_files[0].read_text(encoding="utf-8").splitlines()
                ]
        finally:
            self.fetcher.fetch_etf = original_fetch_etf
            self.fetcher.install_candidate_outputs(saved_outputs)

        self.assertEqual(result["status"], "error")
        self.assertEqual(
            result["error"],
            "ValueError: svelte_contract_drift:holdings:missing_required:holdings",
        )
        self.assertEqual(len(observations), 1)
        self.assertEqual(observations[0]["failure_signature"], signature)

    def test_etf_detail_paths_use_lowercase_svelte_routes(self) -> None:
        overview = json.loads((FIXTURE_DIR / "etf_overview__data.fixture.json").read_text())
        holdings = json.loads((FIXTURE_DIR / "etf_holdings__data.fixture.json").read_text())
        calls = []
        original_fetch_json = self.fetcher.fetch_json
        try:
            def fake_fetch_json(path: str, _timeout: int) -> dict:
                calls.append(path)
                if path == "/etf/vymi/__data.json":
                    return overview
                if path == "/etf/vymi/holdings/__data.json":
                    return holdings
                raise AssertionError(f"unexpected endpoint: {path}")

            self.fetcher.fetch_json = fake_fetch_json
            overview_path, _ = self.fetcher.fetch_svelte_detail("VYMI", "overview", 1)
            holdings_path, _ = self.fetcher.fetch_svelte_detail("VYMI", "holdings", 1)
        finally:
            self.fetcher.fetch_json = original_fetch_json

        self.assertEqual(overview_path, "/etf/vymi/__data.json")
        self.assertEqual(holdings_path, "/etf/vymi/holdings/__data.json")
        self.assertFalse(any("/api/symbol/e/" in path for path in calls))

    def test_endpoint_canary_covers_current_detail_quote_and_history_contracts(self) -> None:
        overview = json.loads((FIXTURE_DIR / "etf_overview__data.fixture.json").read_text())
        holdings = json.loads((FIXTURE_DIR / "etf_holdings__data.fixture.json").read_text())
        calls = []
        original_fetch_json = self.fetcher.fetch_json
        try:
            def fake_fetch_json(path: str, _timeout: int) -> dict:
                calls.append(path)
                if path.endswith("/holdings/__data.json"):
                    return holdings
                if path.endswith("/__data.json"):
                    return overview
                if "/api/quotes/e/" in path:
                    return {"status": 200, "data": {"p": 100.0, "pd": 99.0}}
                if "/history?" in path:
                    return {"status": 200, "data": [{"t": "2026-07-10", "c": 100.0}]}
                raise AssertionError(path)

            self.fetcher.fetch_json = fake_fetch_json
            payload = self.fetcher.run_endpoint_canary(1, ("VYMI",))
        finally:
            self.fetcher.fetch_json = original_fetch_json

        self.assertEqual(payload["status"], "ready")
        self.assertEqual(payload["counts"], {"probes": 4, "ready": 4, "blocked": 0})
        self.assertEqual({row["surface"] for row in payload["results"]}, {
            "overview", "holdings", "quote", "history_daily_1y",
        })
        self.assertFalse(any("/api/symbol/e/VYMI/overview" in path for path in calls))
        self.assertFalse(any("/api/symbol/e/VYMI/holdings" in path for path in calls))

    def test_endpoint_canary_reports_http_and_schema_drift_reason_codes(self) -> None:
        holdings = json.loads((FIXTURE_DIR / "etf_holdings__data.fixture.json").read_text())
        original_fetch_json = self.fetcher.fetch_json
        try:
            def fake_fetch_json(path: str, _timeout: int) -> dict:
                if path.endswith("/holdings/__data.json"):
                    return holdings
                if path.endswith("/__data.json"):
                    return {"nodes": []}
                if "/api/quotes/e/" in path:
                    raise urllib.error.HTTPError(path, 404, "missing", {}, None)
                return {"status": 200, "data": []}

            self.fetcher.fetch_json = fake_fetch_json
            payload = self.fetcher.run_endpoint_canary(1, ("VYMI",))
        finally:
            self.fetcher.fetch_json = original_fetch_json

        reasons = {row["surface"]: row["reason_code"] for row in payload["results"]}
        self.assertEqual(payload["status"], "blocked")
        self.assertEqual(reasons["overview"], "schema_drift")
        self.assertEqual(reasons["quote"], "http_404")
        self.assertEqual(reasons["history_daily_1y"], "schema_drift")

    def test_etf_universe_html_fixture(self) -> None:
        html = (FIXTURE_DIR / "etf_universe.fixture.html").read_text(encoding="utf-8")
        rows = self.fetcher.parse_etf_universe_page(html, page=3)

        self.assertEqual([row["ticker"] for row in rows], ["SPY", "TQQQ"])
        self.assertEqual(rows[0]["name"], "SPDR S&P 500 ETF Trust")
        self.assertEqual(rows[0]["aum"], 601_200_000_000.0)
        self.assertEqual(rows[1]["source_page"], 3)

    def test_etf_universe_record_count_uses_payload_and_file_fallback(self) -> None:
        self.assertEqual(self.fetcher.etf_universe_record_count({"counts": {"records": 7}, "records": []}), 7)
        self.assertEqual(self.fetcher.etf_universe_record_count({"records": [{"ticker": "AAA"}, {"ticker": "BBB"}]}), 2)

        original_out_dir = self.fetcher.OUT_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp) / "stockanalysis"
                self.fetcher.OUT_DIR = out_dir
                out_dir.mkdir(parents=True)
                (out_dir / "etf_universe.json").write_text(
                    json.dumps({"counts": {"records": 3}, "records": [{"ticker": "AAA"}]}),
                    encoding="utf-8",
                )

                self.assertEqual(self.fetcher.etf_universe_record_count(None), 3)
        finally:
            self.fetcher.OUT_DIR = original_out_dir

    def test_etf_universe_refuses_truncated_pagination(self) -> None:
        original_fetch_text = self.fetcher.fetch_text
        original_parse = self.fetcher.parse_etf_universe_page
        try:
            self.fetcher.fetch_text = lambda _path, _timeout: (
                '<link rel="next" href="https://stockanalysis.com/etf/?page=2">'
            )
            self.fetcher.parse_etf_universe_page = lambda _html, page: [
                {"ticker": "AAA", "name": "Alpha ETF", "source_page": page}
            ]
            with self.assertRaisesRegex(RuntimeError, "refusing to publish a truncated discovery"):
                self.fetcher.fetch_etf_universe(max_pages=1, timeout=1, sleep=0)
            with self.assertRaisesRegex(ValueError, "at least 1"):
                self.fetcher.fetch_etf_universe(max_pages=0, timeout=1, sleep=0)
        finally:
            self.fetcher.fetch_text = original_fetch_text
            self.fetcher.parse_etf_universe_page = original_parse

    def test_universe_transient_failure_retains_lkg_and_recovers_with_provenance(self) -> None:
        original_fetch = self.fetcher.fetch_etf_universe
        original_dirs = (
            self.fetcher.OUT_DIR,
            self.fetcher.PUBLIC_DIR,
            self.fetcher.STOCKANALYSIS_RECOVERY_ROOT,
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fetcher.OUT_DIR = root / "data" / "stockanalysis"
            self.fetcher.PUBLIC_DIR = root / "public" / "stockanalysis"
            self.fetcher.STOCKANALYSIS_RECOVERY_ROOT = (
                root / "data" / "admin" / "stockanalysis-recovery"
            )
            canonical = self.fetcher.OUT_DIR / "etf_universe.json"
            lkg_payload = {
                "schema_version": "stockanalysis/v1",
                "source": "stockanalysis",
                "asset_type": "etf",
                "generated_at": "2026-07-15T07:00:00Z",
                "source_as_of": None,
                "source_as_of_reason": "provider publishes no aggregate source date",
                "fetched_at": "2026-07-15T07:00:00Z",
                "endpoint": "/etf/",
                "counts": {"records": 1, "pages": 1},
                "warnings": [],
                "pages": [{"page": 1, "path": "/etf/", "record_count": 1}],
                "records": [{"ticker": "AAA", "name": "AAA ETF", "source_page": 1}],
            }
            self.fetcher.write_json(canonical, lkg_payload)
            expected_lkg = canonical.read_bytes()
            store = self.fetcher.StockAnalysisRecoveryStateStore(
                self.fetcher.STOCKANALYSIS_RECOVERY_ROOT, root
            )
            bootstrap = {
                "run_id": "bootstrap",
                "run_attempt": 1,
                "event_name": "local",
                "observed_at": "2026-07-15T07:00:00Z",
            }
            failed_run = {
                "run_id": "universe-failed",
                "run_attempt": 1,
                "event_name": "schedule",
                "natural": True,
                "observed_at": "2026-07-15T08:00:00Z",
            }
            recovered_run = {
                "run_id": "universe-recovered",
                "run_attempt": 1,
                "event_name": "schedule",
                "natural": True,
                "observed_at": "2026-07-15T08:05:00Z",
            }
            store.bootstrap_existing(bootstrap)
            try:
                self.fetcher.fetch_etf_universe = lambda *_args, **_kwargs: (_ for _ in ()).throw(
                    TimeoutError("transient universe timeout")
                )
                failed = self.fetcher.fetch_etf_universe_with_recovery(
                    100,
                    1,
                    0,
                    False,
                    recovery_store=store,
                    recovery_run=failed_run,
                )
                self.assertIsNone(failed)
                self.assertEqual(canonical.read_bytes(), expected_lkg)
                self.assertEqual(
                    (
                        store.root
                        / "lkg"
                        / "universe"
                        / "etf_universe.json"
                    ).read_bytes(),
                    expected_lkg,
                )
                failed_index = store.rebuild_index(failed_run)
                self.assertEqual(
                    store.assess_current_attempt(failed_index)["status"], "degraded"
                )

                advanced = {
                    **lkg_payload,
                    "generated_at": "2026-07-15T08:05:00Z",
                    "fetched_at": "2026-07-15T08:05:00Z",
                    "counts": {"records": 2, "pages": 1},
                    "pages": [{"page": 1, "path": "/etf/", "record_count": 2}],
                    "records": [
                        {"ticker": "AAA", "name": "AAA ETF", "source_page": 1},
                        {"ticker": "BBB", "name": "BBB ETF", "source_page": 1},
                    ],
                }
                self.fetcher.fetch_etf_universe = lambda *_args, **_kwargs: advanced
                recovered = self.fetcher.fetch_etf_universe_with_recovery(
                    100,
                    1,
                    0,
                    False,
                    recovery_store=store,
                    recovery_run=recovered_run,
                )
            finally:
                self.fetcher.fetch_etf_universe = original_fetch
                (
                    self.fetcher.OUT_DIR,
                    self.fetcher.PUBLIC_DIR,
                    self.fetcher.STOCKANALYSIS_RECOVERY_ROOT,
                ) = original_dirs

            self.assertEqual(recovered, advanced)
            state = json.loads(
                (store.root / "states" / "universe" / "etf_universe.json").read_text()
            )
            self.assertEqual(state["resolution_state"], "fresh_primary")
            self.assertFalse(state["retry"])

    def test_universe_controlled_failure_retains_lkg_before_fetch_then_recovers(self) -> None:
        original_fetch = self.fetcher.fetch_etf_universe
        original_dirs = (
            self.fetcher.OUT_DIR,
            self.fetcher.PUBLIC_DIR,
            self.fetcher.STOCKANALYSIS_RECOVERY_ROOT,
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fetcher.OUT_DIR = root / "data" / "stockanalysis"
            self.fetcher.PUBLIC_DIR = root / "public" / "stockanalysis"
            self.fetcher.STOCKANALYSIS_RECOVERY_ROOT = (
                root / "data" / "admin" / "stockanalysis-recovery"
            )
            canonical = self.fetcher.OUT_DIR / "etf_universe.json"
            lkg_payload = {
                "schema_version": "stockanalysis/v1",
                "source": "stockanalysis",
                "asset_type": "etf",
                "generated_at": "2026-07-16T07:00:00Z",
                "source_as_of": None,
                "source_as_of_reason": "provider publishes no aggregate source date",
                "fetched_at": "2026-07-16T07:00:00Z",
                "endpoint": "/etf/",
                "counts": {"records": 1, "pages": 1},
                "warnings": [],
                "pages": [{"page": 1, "path": "/etf/", "record_count": 1}],
                "records": [{"ticker": "AAA", "name": "AAA ETF", "source_page": 1}],
            }
            self.fetcher.write_json(canonical, lkg_payload)
            expected_lkg = canonical.read_bytes()
            store = self.fetcher.StockAnalysisRecoveryStateStore(
                self.fetcher.STOCKANALYSIS_RECOVERY_ROOT, root
            )
            bootstrap = {
                "run_id": "bootstrap",
                "run_attempt": 1,
                "event_name": "local",
                "observed_at": "2026-07-16T07:00:00Z",
            }
            chaos_run = {
                "run_id": "universe-chaos",
                "run_attempt": 1,
                "event_name": "workflow_dispatch",
                "natural": False,
                "observed_at": "2026-07-16T08:00:00Z",
            }
            recovered_run = {
                "run_id": "universe-recovered",
                "run_attempt": 1,
                "event_name": "schedule",
                "natural": True,
                "observed_at": "2026-07-16T08:05:00Z",
            }
            store.bootstrap_existing(bootstrap)
            try:
                def _fail_if_called(*_args, **_kwargs):
                    raise AssertionError(
                        "controlled failure must raise before fetch_etf_universe runs"
                    )

                self.fetcher.fetch_etf_universe = _fail_if_called
                failed = self.fetcher.fetch_etf_universe_with_recovery(
                    100,
                    1,
                    0,
                    False,
                    recovery_store=store,
                    recovery_run=chaos_run,
                    controlled_failure=True,
                )
                self.assertIsNone(failed)
                # LKG retained; the on-disk canonical payload was never overwritten.
                self.assertEqual(canonical.read_bytes(), expected_lkg)
                self.assertEqual(
                    (
                        store.root / "lkg" / "universe" / "etf_universe.json"
                    ).read_bytes(),
                    expected_lkg,
                )
                chaos_state = json.loads(
                    (store.root / "states" / "universe" / "etf_universe.json").read_text()
                )
                self.assertEqual(chaos_state["resolution_state"], "lkg_primary")
                self.assertTrue(chaos_state["retry"])
                self.assertIn("controlled failure", chaos_state["latest_failure"]["error"])
                self.assertIn(
                    "controlled failure injection for universe:etf_universe",
                    chaos_state["latest_failure"]["error"],
                )
                failed_index = store.rebuild_index(chaos_run)
                self.assertEqual(
                    store.assess_current_attempt(failed_index)["status"], "degraded"
                )

                advanced = {
                    **lkg_payload,
                    "generated_at": "2026-07-16T08:05:00Z",
                    "fetched_at": "2026-07-16T08:05:00Z",
                    "counts": {"records": 2, "pages": 1},
                    "pages": [{"page": 1, "path": "/etf/", "record_count": 2}],
                    "records": [
                        {"ticker": "AAA", "name": "AAA ETF", "source_page": 1},
                        {"ticker": "BBB", "name": "BBB ETF", "source_page": 1},
                    ],
                }
                self.fetcher.fetch_etf_universe = lambda *_args, **_kwargs: advanced
                recovered = self.fetcher.fetch_etf_universe_with_recovery(
                    100,
                    1,
                    0,
                    False,
                    recovery_store=store,
                    recovery_run=recovered_run,
                )
            finally:
                self.fetcher.fetch_etf_universe = original_fetch
                (
                    self.fetcher.OUT_DIR,
                    self.fetcher.PUBLIC_DIR,
                    self.fetcher.STOCKANALYSIS_RECOVERY_ROOT,
                ) = original_dirs

            self.assertEqual(recovered, advanced)
            state = json.loads(
                (store.root / "states" / "universe" / "etf_universe.json").read_text()
            )
            self.assertEqual(state["resolution_state"], "fresh_primary")
            self.assertFalse(state["retry"])

    def test_controlled_failure_surfaces_token_routes_universe_chaos(self) -> None:
        surfaces, universe = self.fetcher.split_controlled_failure_surfaces(
            "etf_universe,actions_recent", "core"
        )
        self.assertEqual(surfaces, {"actions_recent"})
        self.assertTrue(universe)

        surfaces_only, universe_only = self.fetcher.split_controlled_failure_surfaces(
            "etf_universe", "core"
        )
        self.assertEqual(surfaces_only, set())
        self.assertTrue(universe_only)

        real_surfaces, no_universe = self.fetcher.split_controlled_failure_surfaces(
            "actions_recent", "core"
        )
        self.assertEqual(real_surfaces, {"actions_recent"})
        self.assertFalse(no_universe)

        empty_surfaces, empty_universe = self.fetcher.split_controlled_failure_surfaces(
            "", "core"
        )
        self.assertEqual(empty_surfaces, set())
        self.assertFalse(empty_universe)


    def test_etf_detail_controlled_failure_token_is_dispatch_only_single_and_explicit(self) -> None:
        surfaces, universe, etf_details, yahoo_etfs = self.fetcher.split_controlled_failure_targets(
            "etf_detail:tqqq,yahoo_etf_fallback:soxl", "core"
        )
        self.assertEqual(surfaces, set())
        self.assertFalse(universe)
        self.assertEqual(etf_details, {"TQQQ"})
        self.assertEqual(yahoo_etfs, {"SOXL"})

        self.fetcher.validate_controlled_etf_detail_failure_scope(
            {"TQQQ"},
            {"TQQQ"},
            event_name="workflow_dispatch",
            controlled_stocks=set(),
            controlled_surfaces=set(),
            controlled_universe=False,
        )
        cases = [
            ({"TQQQ"}, {"TQQQ"}, "schedule", set(), set(), False, "workflow_dispatch"),
            ({"TQQQ", "SOXL"}, {"TQQQ", "SOXL"}, "workflow_dispatch", set(), set(), False, "exactly one"),
            ({"TQQQ"}, {"SOXL"}, "workflow_dispatch", set(), set(), False, "explicit --etfs"),
            ({"TQQQ"}, {"TQQQ"}, "workflow_dispatch", set(), {"actions_recent"}, False, "minimal scope"),
            ({"TQQQ"}, {"TQQQ"}, "workflow_dispatch", {"AAPL"}, set(), False, "minimal scope"),
            ({"TQQQ"}, {"TQQQ"}, "workflow_dispatch", set(), set(), True, "minimal scope"),
        ]
        for targets, explicit_etfs, event_name, stocks, controlled_surfaces, universe, message in cases:
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                self.fetcher.validate_controlled_etf_detail_failure_scope(
                    targets,
                    explicit_etfs,
                    event_name=event_name,
                    controlled_stocks=stocks,
                    controlled_surfaces=controlled_surfaces,
                    controlled_universe=universe,
                )

    def test_yahoo_etf_fallback_controlled_token_is_separate_dispatch_only_and_exact(self) -> None:
        surfaces, universe, etf_details, yahoo_etfs = self.fetcher.split_controlled_failure_targets(
            "yahoo_etf_fallback:tqqq", "core"
        )
        self.assertEqual(surfaces, set())
        self.assertFalse(universe)
        self.assertEqual(etf_details, set())
        self.assertEqual(yahoo_etfs, {"TQQQ"})

        self.fetcher.validate_controlled_yahoo_etf_fallback_scope(
            {"TQQQ"},
            {"TQQQ"},
            event_name="workflow_dispatch",
            controlled_stocks=set(),
            controlled_surfaces=set(),
            controlled_universe=False,
            controlled_stockanalysis_etfs=set(),
        )
        cases = [
            ({"TQQQ"}, {"TQQQ"}, "schedule", set(), set(), False, set(), "workflow_dispatch"),
            ({"TQQQ", "SOXL"}, {"TQQQ", "SOXL"}, "workflow_dispatch", set(), set(), False, set(), "exactly one"),
            ({"TQQQ"}, {"TQQQ", "SOXL"}, "workflow_dispatch", set(), set(), False, set(), "exactly one explicit"),
            ({"TQQQ"}, {"SOXL"}, "workflow_dispatch", set(), set(), False, set(), "exactly one explicit"),
            ({"TQQQ"}, {"TQQQ"}, "workflow_dispatch", {"AAPL"}, set(), False, set(), "minimal scope"),
            ({"TQQQ"}, {"TQQQ"}, "workflow_dispatch", set(), {"actions_recent"}, False, set(), "minimal scope"),
            ({"TQQQ"}, {"TQQQ"}, "workflow_dispatch", set(), set(), True, set(), "minimal scope"),
            ({"TQQQ"}, {"TQQQ"}, "workflow_dispatch", set(), set(), False, {"TQQQ"}, "minimal scope"),
        ]
        for targets, explicit, event, stocks, surfaces, universe, primary_etfs, message in cases:
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                self.fetcher.validate_controlled_yahoo_etf_fallback_scope(
                    targets,
                    explicit,
                    event_name=event,
                    controlled_stocks=stocks,
                    controlled_surfaces=surfaces,
                    controlled_universe=universe,
                    controlled_stockanalysis_etfs=primary_etfs,
                )

    def test_yahoo_etf_fallback_controlled_failure_retains_exact_lkg_without_providers(self) -> None:
        original_outputs = self.fetcher.current_candidate_outputs()
        original_fetch_etf = self.fetcher.fetch_etf
        original_loader = self.fetcher.load_yf_finance_module
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fetcher.install_candidate_outputs(
                self.fetcher.CandidateOutputs.from_root(root)
            )
            epoch = int(datetime(2026, 7, 27, 15, 15, 5, tzinfo=timezone.utc).timestamp())
            provider = self.fetcher.build_yf_payload(
                "TQQQ",
                {
                    "info": {
                        "symbol": "TQQQ",
                        "quoteType": "ETF",
                        "currentPrice": 100.0,
                        "previousClose": 99.0,
                        "regularMarketTime": epoch,
                    },
                    "history_1y": [],
                },
                "2026-07-27T15:16:00Z",
            )
            canonical = self.fetcher.yahoo_etf_payload("TQQQ", provider)
            canonical_path = self.fetcher.YF_ETF_DETAIL_OUT_DIR / "TQQQ.json"
            self.fetcher.write_json(canonical_path, canonical)
            before = canonical_path.read_bytes()

            def unexpected_provider(*_args, **_kwargs):
                self.fail("controlled Yahoo fallback failure must not call a provider")

            self.fetcher.fetch_etf = unexpected_provider
            self.fetcher.load_yf_finance_module = unexpected_provider
            try:
                result = self.fetcher.run_yahoo_etf_fallback_controlled_failure(
                    "TQQQ",
                    {
                        "run_id": "yahoo-chaos",
                        "run_attempt": 1,
                        "event_name": "workflow_dispatch",
                        "observed_at": "2026-07-28T00:00:00Z",
                    },
                )
            finally:
                self.fetcher.fetch_etf = original_fetch_etf
                self.fetcher.load_yf_finance_module = original_loader
                self.fetcher.install_candidate_outputs(original_outputs)

            key = self.fetcher.yahoo_etf_fallback_key("TQQQ")
            lkg_path = root / "data/admin/yahoo_etf_fallback/lkg" / f"{key}.json"
            state_path = root / "data/admin/yahoo_etf_fallback/index.json"
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(result["status"], "controlled_failure_retained_lkg")
            self.assertEqual(canonical_path.read_bytes(), before)
            self.assertEqual(lkg_path.read_bytes(), before)
            self.assertEqual(state["lane_id"], "yahoo_etf_fallback")
            self.assertEqual(len(state["retry_set"]), 1)
            self.assertFalse((root / "data/admin/stockanalysis-recovery").exists())
            self.assertFalse((root / "data/yf/finance/TQQQ.json").exists())

    def natural_yahoo_recovery_case(self, outcome="success"):
        from data_supply_resolver import DataSupplyResolver
        from resolve_etf_detail_candidates import resolve_entities
        original_outputs = self.fetcher.current_candidate_outputs()
        original_invoke = self.fetcher.invoke_yahoo_etf_fallback_adapter
        stamp = "2026-07-28T16:00:00Z"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fetcher.install_candidate_outputs(self.fetcher.CandidateOutputs.from_root(root))
            try:
                old_epoch = int(datetime(2026, 7, 25, 15, 15, 5, tzinfo=timezone.utc).timestamp())
                old_provider = self.fetcher.build_yf_payload("TQQQ", {"info": {"symbol": "TQQQ", "quoteType": "ETF",
                    "currentPrice": 100.0, "previousClose": 99.0, "regularMarketTime": old_epoch}, "history_1y": []},
                    "2026-07-25T15:16:00Z")
                old_canonical = self.fetcher.yahoo_etf_payload("TQQQ", old_provider)
                canonical_path = self.fetcher.YF_ETF_DETAIL_OUT_DIR / "TQQQ.json"
                provider_path = self.fetcher.YF_OUT_DIR / "TQQQ.json"
                self.fetcher.write_json(canonical_path, old_canonical)
                self.fetcher.write_json(provider_path, old_provider)
                before = canonical_path.read_bytes()
                provider_before = provider_path.read_bytes()
                old_row = self.fetcher.record_etf_detail_observation(provider="yahoo_finance", endpoint_family="yahoo_finance_etf_detail",
                    ticker="TQQQ", provider_path="data/yf/etf-details/TQQQ.json", payload_path=canonical_path,
                    provider_schema="yf-etf-detail/v1", source_as_of=old_canonical["source_as_of"],
                    observed_at=old_provider["fetched_at"], validation_status="valid", reason_code="contract_valid", collection_origin="manual")
                store = self.fetcher.data_supply_store(provider_truth_root=root)
                DataSupplyResolver(store).resolve_etf_detail(entity="TQQQ", observations=[old_row], decided_at="2026-07-25T15:17:00Z")
                self.fetcher.run_yahoo_etf_fallback_controlled_failure("TQQQ", {"run_id": "yahoo-chaos", "run_attempt": 1,
                    "event_name": "workflow_dispatch", "observed_at": "2026-07-28T00:00:00Z"})
                self.assertEqual(self.fetcher.list_yahoo_etf_fallback_retry_targets(), ["TQQQ"])
                new_epoch = old_epoch if outcome == "deferred" else int(datetime(2026, 7, 26, 15, 15, 5, tzinfo=timezone.utc).timestamp())
                completed_at = stamp
                if outcome == "clock_advance":
                    new_epoch = int(datetime(2026, 7, 28, 16, 0, 5, tzinfo=timezone.utc).timestamp())
                    completed_at = "2026-07-28T16:00:10Z"

                engine = self.fetcher.load_yf_finance_module()
                class FakeYahooModule:
                    decorate_finance_payload = staticmethod(engine.decorate_finance_payload)
                    @staticmethod
                    def fetch_with_retry(*_args, **_kwargs):
                        return (None if outcome == "failed" else {"info": {"symbol": "TQQQ", "quoteType": "ETF",
                            "currentPrice": 101.0, "previousClose": 100.0, "regularMarketTime": new_epoch}, "history_1y": []},
                            7, "provider unavailable" if outcome == "failed" else None,
                            {"attempts_used": 1, "latency_ms": 7, "failures": [], "cached": outcome == "cached"})

                observed_prewrite = []
                def inspect_then_invoke(action, **kwargs):
                    if action == "promote":
                        observed_prewrite.append((canonical_path.read_bytes(), provider_path.read_bytes()))
                    return original_invoke(action, **kwargs)

                run_attempt = 2 if outcome == "rerun" else 1
                error = None
                result = None
                with patch.dict(os.environ, {"GITHUB_ACTIONS": "false" if outcome == "local" else "true", "GITHUB_RUN_ID": "902",
                    "GITHUB_RUN_ATTEMPT": str(run_attempt), "GITHUB_EVENT_NAME": "schedule"}), \
                     patch.object(self.fetcher, "now_iso", return_value=completed_at), \
                     patch.object(self.fetcher, "load_yf_finance_module", return_value=FakeYahooModule), \
                     patch.object(self.fetcher, "fetch_etf", side_effect=AssertionError("Yahoo recovery must bypass primary")), \
                     patch.object(self.fetcher, "invoke_yahoo_etf_fallback_adapter", side_effect=inspect_then_invoke):
                    self.fetcher.record_etf_detail_failure_observation(provider="stockanalysis", endpoint_family="stockanalysis_etf_detail",
                        ticker="TQQQ", provider_path="data/stockanalysis/etfs/TQQQ.json", provider_schema="stockanalysis/v1",
                        reason_code="transport_failure", failure_detail="provider unavailable", collection_origin="natural")
                    try:
                        result = self.fetcher.run_yahoo_etf_fallback_recovery("TQQQ", False, {"run_id": "902", "run_attempt": run_attempt,
                            "event_name": "schedule", "observed_at": stamp})
                    except RuntimeError as exc:
                        error = str(exc)
                resolve_entities(store, entities=["TQQQ"], decided_at="2026-07-28T16:01:00Z")
                history = [json.loads(line) for file in (store.root / "history/observations").glob("*.jsonl") for line in file.read_text().splitlines()]
                state = json.loads((root / "data/admin/yahoo_etf_fallback/index.json").read_text())
                return {"result": result, "error": error, "before": before, "after": canonical_path.read_bytes(),
                        "provider_bytes": provider_path.read_bytes() if provider_path.exists() else None,
                        "provider_before": provider_before,
                        "history": history, "state": state, "active": store.read_active_domain("etf_detail"),
                        "observed_prewrite": observed_prewrite}
            finally:
                self.fetcher.install_candidate_outputs(original_outputs)

    def test_yahoo_etf_fallback_natural_retry_collects_before_adapter_and_bypasses_primary(self) -> None:
        case = self.natural_yahoo_recovery_case()
        self.assertEqual(case["observed_prewrite"], [(case["before"], case["provider_before"])])
        self.assertEqual(case["result"]["status"], "recovered")
        self.assertNotEqual(case["after"], case["before"])
        self.assertEqual(case["state"]["retry_set"], [])
        yahoo = [row for row in case["history"] if row["provider"] == "yahoo_finance"][-1]
        selected = case["active"]["current"]["TQQQ"]
        self.assertEqual(selected["source_as_of"], "2026-07-26T15:15:05Z")
        self.assertEqual(selected["payload_sha256"], hashlib.sha256(case["after"]).hexdigest())


    def test_yahoo_retry_uses_acquisition_completion_clock_for_new_quote(self):
        case = self.natural_yahoo_recovery_case("clock_advance")
        self.assertIsNone(case["error"])
        self.assertEqual(case["result"]["status"], "recovered")
        payload = json.loads(case["after"])
        self.assertEqual(payload["source_as_of"], "2026-07-28T16:00:05Z")
        self.assertEqual(payload["fetched_at"], "2026-07-28T16:00:10Z")
        self.assertEqual(case["state"]["retry_set"], [])

    def test_etf_detail_controlled_failure_preflight_rejects_schedule(self) -> None:
        completed = subprocess.run(
            [
                sys.executable,
                str(FETCHER_PATH),
                "--etfs",
                "TQQQ",
                "--controlled-failure-surfaces",
                "etf_detail:TQQQ",
                "--event-name",
                "schedule",
                "--preflight-only",
                "--no-public-mirror",
            ],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("workflow_dispatch", completed.stderr)

    def test_etf_detail_controlled_failure_uses_detail_observation_path_without_fetching(self) -> None:
        original_fetch = self.fetcher.fetch_etf
        original_fallback = self.fetcher.fetch_yahoo_etf_fallback
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            original_dirs = (
                self.fetcher.OUT_DIR,
                self.fetcher.PUBLIC_DIR,
                self.fetcher.DATA_SUPPLY_STATE_ROOT,
            )
            self.fetcher.OUT_DIR = root / "data" / "stockanalysis"
            self.fetcher.PUBLIC_DIR = root / "public" / "stockanalysis"
            self.fetcher.DATA_SUPPLY_STATE_ROOT = root / "data" / "admin" / "data-supply-state" / "v1"
            truth = self.fetcher.OUT_DIR / "etfs" / "TQQQ.json"
            lkg_payload = {
                "schema_version": "stockanalysis/v1",
                "source": "stockanalysis",
                "asset_type": "etf",
                "ticker": "TQQQ",
                "source_as_of": "2026-07-15T20:00:00Z",
                "fetched_at": "2026-07-15T21:00:00Z",
                "normalized": {"overview": {"aum": 1}},
            }
            self.fetcher.write_json(truth, lkg_payload)
            expected_bytes = truth.read_bytes()
            store = self.fetcher.StockAnalysisRecoveryStateStore(
                root / "data" / "admin" / "stockanalysis-recovery", root
            )
            chaos = {
                "run_id": "etf-chaos",
                "run_attempt": 1,
                "event_name": "workflow_dispatch",
                "natural": False,
                "observed_at": "2026-07-16T08:00:00Z",
            }

            def unexpected_fetch(*_args, **_kwargs):
                self.fail("controlled ETF detail failure must not call the provider")

            self.fetcher.fetch_etf = unexpected_fetch
            self.fetcher.fetch_yahoo_etf_fallback = (
                lambda _ticker, _mirror, collection_origin="natural": {
                    "schema_version": "yf-etf-detail/v1",
                    "source": "yahoo_finance",
                }
            )
            try:
                result = self.fetcher.run_one(
                    "etf",
                    "TQQQ",
                    1,
                    False,
                    yf_fallback=True,
                    controlled_etf_detail_failure=True,
                    collection_origin="manual",
                    recovery_store=store,
                    recovery_run=chaos,
                )
            finally:
                self.fetcher.fetch_etf = original_fetch
                self.fetcher.fetch_yahoo_etf_fallback = original_fallback
                (
                    self.fetcher.OUT_DIR,
                    self.fetcher.PUBLIC_DIR,
                    self.fetcher.DATA_SUPPLY_STATE_ROOT,
                ) = original_dirs

            observation = json.loads(
                next((root / "data" / "admin" / "data-supply-state" / "v1" / "history" / "observations").glob("*.jsonl")).read_text(encoding="utf-8")
            )
            state = json.loads(
                (store.root / "states" / "etf" / "TQQQ.json").read_text(encoding="utf-8")
            )
            self.assertEqual(truth.read_bytes(), expected_bytes)
            self.assertEqual(observation["domain"], "etf_detail")
            self.assertEqual(observation["entity"], "TQQQ")
            self.assertEqual(observation["validation_status"], "invalid")
            self.assertEqual(observation["reason_code"], "fetch_failed")
            self.assertEqual(observation["observation_origin"], "rebuild")
            self.assertEqual(observation["collection_origin"], "manual")
            self.assertEqual(result["status"], "fallback_observed_primary_preserved")
            self.assertEqual(result["selected_provider"], "stockanalysis")
            self.assertFalse(result["canonical_write"])
            self.assertIsNone(result["error"])
            self.assertTrue(state["retry"])
            self.assertIn("controlled failure", state["latest_failure"]["error"])
            self.assertIn("controlled failure", state["latest_failure"]["error"])
            self.assertEqual(
                (store.root / "lkg" / "etf" / "TQQQ.json").read_bytes(), expected_bytes
            )
            self.assertIn(
                "controlled failure injection for etf_detail:TQQQ",
                result["stockanalysis_error"],
            )

    def test_etf_natural_missing_source_stamp_defers_without_overwriting_lkg_or_failure(self) -> None:
        original_fetch = self.fetcher.fetch_etf
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            original_dirs = (
                self.fetcher.OUT_DIR,
                self.fetcher.PUBLIC_DIR,
                self.fetcher.DATA_SUPPLY_STATE_ROOT,
            )
            self.fetcher.OUT_DIR = root / "data" / "stockanalysis"
            self.fetcher.PUBLIC_DIR = root / "public" / "stockanalysis"
            self.fetcher.DATA_SUPPLY_STATE_ROOT = root / "data" / "admin" / "data-supply-state" / "v1"
            canonical = self.fetcher.OUT_DIR / "etfs" / "TQQQ.json"
            canonical.parent.mkdir(parents=True)
            retained = {
                "schema_version": "stockanalysis/v1",
                "source": "stockanalysis",
                "asset_type": "etf",
                "ticker": "TQQQ",
                "source_as_of": "2026-07-15T20:00:00Z",
                "fetched_at": "2026-07-15T21:00:00Z",
                "normalized": {"overview": {"aum": 1}},
            }
            self.fetcher.write_json(canonical, retained)
            retained_bytes = canonical.read_bytes()
            store = self.fetcher.StockAnalysisRecoveryStateStore(
                root / "data" / "admin" / "stockanalysis-recovery", root
            )
            store.record_failure(
                "etf",
                "TQQQ",
                "controlled failure injection",
                {
                    "run_id": "etf-chaos",
                    "run_attempt": 1,
                    "event_name": "workflow_dispatch",
                    "natural": False,
                    "observed_at": "2026-07-16T08:00:00Z",
                },
                controlled=True,
            )
            self.fetcher.fetch_etf = lambda *_args, **_kwargs: {
                "schema_version": "stockanalysis/v1",
                "source": "stockanalysis",
                "asset_type": "etf",
                "ticker": "TQQQ",
                "detail_status": "stockanalysis_partial",
                "partial_reason_codes": ["holdings_surface_omits_holdings"],
                "source_as_of": None,
                "source_as_of_reason": "provider detail response carries no market observation date",
                "fetched_at": "2026-07-16T23:00:00Z",
                "normalized": {"overview": {"aum": 2}},
            }
            try:
                result = self.fetcher.run_one(
                    "etf",
                    "TQQQ",
                    1,
                    False,
                    recovery_store=store,
                    recovery_run={
                        "run_id": "etf-natural-1",
                        "run_attempt": 1,
                        "event_name": "schedule",
                        "natural": True,
                        "observed_at": "2026-07-16T23:00:00Z",
                    },
                )
            finally:
                self.fetcher.fetch_etf = original_fetch
                (
                    self.fetcher.OUT_DIR,
                    self.fetcher.PUBLIC_DIR,
                    self.fetcher.DATA_SUPPLY_STATE_ROOT,
                ) = original_dirs

            state = json.loads((store.root / "states" / "etf" / "TQQQ.json").read_text())
            self.assertEqual(result["status"], "error")
            self.assertIsNotNone(result["error"])
            self.assertIsNone(result["path"])
            self.assertEqual(canonical.read_bytes(), retained_bytes)
            self.assertTrue(state["retry"])
            self.assertIn("source date", state["latest_failure"]["error"])

    def test_etf_success_without_pending_recovery_does_not_create_recovery_state(self) -> None:
        original_fetch = self.fetcher.fetch_etf
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            original_dirs = (
                self.fetcher.OUT_DIR,
                self.fetcher.PUBLIC_DIR,
                self.fetcher.DATA_SUPPLY_STATE_ROOT,
            )
            self.fetcher.OUT_DIR = root / "data" / "stockanalysis"
            self.fetcher.PUBLIC_DIR = root / "public" / "stockanalysis"
            self.fetcher.DATA_SUPPLY_STATE_ROOT = root / "data" / "admin" / "data-supply-state" / "v1"
            store = self.fetcher.StockAnalysisRecoveryStateStore(
                root / "data" / "admin" / "stockanalysis-recovery", root
            )
            self.fetcher.fetch_etf = lambda *_args, **_kwargs: {
                "schema_version": "stockanalysis/v1",
                "source": "stockanalysis",
                "asset_type": "etf",
                "ticker": "TQQQ",
                "detail_status": "stockanalysis_partial",
                "partial_reason_codes": ["holdings_surface_omits_holdings"],
                "source_as_of": None,
                "source_as_of_reason": "provider detail response carries no market observation date",
                "fetched_at": "2026-07-16T23:00:00Z",
                "normalized": {"overview": {"aum": 2}},
            }
            try:
                result = self.fetcher.run_one(
                    "etf",
                    "TQQQ",
                    1,
                    False,
                    recovery_store=store,
                    recovery_run={
                        "run_id": "normal-etf",
                        "run_attempt": 1,
                        "event_name": "schedule",
                        "natural": True,
                        "observed_at": "2026-07-16T23:00:00Z",
                    },
                )
            finally:
                self.fetcher.fetch_etf = original_fetch
                (
                    self.fetcher.OUT_DIR,
                    self.fetcher.PUBLIC_DIR,
                    self.fetcher.DATA_SUPPLY_STATE_ROOT,
                ) = original_dirs

            self.assertEqual(result["status"], "ok")
            self.assertTrue(result["canonical_write"])
            self.assertFalse((store.root / "states" / "etf" / "TQQQ.json").exists())


    def test_workflow_dispatch_inputs_stay_within_github_limit(self) -> None:
        workflow = (
            ROOT / ".github" / "workflows" / "fetch-stockanalysis.yml"
        ).read_text(encoding="utf-8")
        lines = workflow.splitlines()
        start = next(i for i, ln in enumerate(lines) if ln.strip() == "inputs:")
        inputs: list[str] = []
        for ln in lines[start + 1:]:
            if not ln.strip():
                continue
            indent = len(ln) - len(ln.lstrip(" "))
            if indent <= 4:
                break
            if indent == 6 and ln.rstrip().endswith(":"):
                inputs.append(ln.strip().rstrip(":"))
        self.assertLessEqual(
            len(inputs),
            25,
            f"workflow_dispatch defines {len(inputs)} inputs; GitHub hard-limits to 25: {inputs}",
        )
        self.assertNotIn("controlled_failure_universe", inputs)

    def test_weekly_workflow_uses_fixed_complete_discovery_ceiling(self) -> None:
        workflow = (ROOT / ".github" / "workflows" / "fetch-stockanalysis.yml").read_text(encoding="utf-8")
        self.assertIn("20 23 * * 0", workflow)
        self.assertIn('INPUT_MAX_UNIVERSE_PAGES="100"', workflow)
        self.assertNotIn("STOCKANALYSIS_WEEKLY_MAX_UNIVERSE_PAGES", workflow)

    def test_discovery_growth_delta_planner_stays_bounded_and_outside_source_writer(self) -> None:
        fixture = json.loads((FIXTURE_DIR / "core_basket_discovery_growth.fixture.json").read_text(encoding="utf-8"))
        planner = ROOT / "scripts" / "plan-stockanalysis-core-basket-delta.mjs"
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            basket_path = tmp_path / "basket.json"
            fetched_path = tmp_path / "fetched.txt"
            delta_path = tmp_path / "delta.txt"
            basket_path.write_text(
                json.dumps({"daily_refresh_universe": {"tickers": fixture["selected_tickers"]}}),
                encoding="utf-8",
            )
            fetched_path.write_text("\n".join(fixture["fetched_tickers"]) + "\n", encoding="utf-8")

            result = subprocess.run(
                [
                    "node",
                    str(planner),
                    "--basket",
                    str(basket_path),
                    "--fetched",
                    str(fetched_path),
                    "--output",
                    str(delta_path),
                    "--limit",
                    "40",
                    "--json",
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            plan = json.loads(result.stdout)
            self.assertEqual(plan["delta_tickers"], fixture["expected_delta_tickers"])
            self.assertEqual(delta_path.read_text(encoding="utf-8").splitlines(), fixture["expected_delta_tickers"])

            basket_path.write_text(
                json.dumps({"daily_refresh_universe": {"tickers": [f"NEW{i:02d}" for i in range(40)]}}),
                encoding="utf-8",
            )
            fetched_path.write_text("", encoding="utf-8")
            at_limit = subprocess.run(
                [
                    "node",
                    str(planner),
                    "--basket",
                    str(basket_path),
                    "--fetched",
                    str(fetched_path),
                    "--output",
                    str(delta_path),
                    "--limit",
                    "40",
                    "--json",
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            self.assertEqual(json.loads(at_limit.stdout)["delta_count"], 40)

            basket_path.write_text(
                json.dumps({"daily_refresh_universe": {"tickers": [f"NEW{i:02d}" for i in range(41)]}}),
                encoding="utf-8",
            )
            fetched_path.write_text("", encoding="utf-8")
            overflow = subprocess.run(
                [
                    "node",
                    str(planner),
                    "--basket",
                    str(basket_path),
                    "--fetched",
                    str(fetched_path),
                    "--output",
                    str(delta_path),
                    "--limit",
                    "40",
                    "--json",
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(overflow.returncode, 0)
            self.assertIn("delta 41 exceeds limit 40", overflow.stderr)

        workflow = (ROOT / ".github" / "workflows" / "fetch-stockanalysis.yml").read_text(encoding="utf-8")
        self.assertNotIn("Fetch discovered Core Daily Basket delta once", workflow)
        self.assertNotIn("plan-stockanalysis-core-basket-delta.mjs", workflow)

        primary_step = workflow.split("- name: Run StockAnalysis fetch", 1)[1]
        primary_step = primary_step.split("- name: Refresh history-gap plan after live backfill", 1)[0]
        self.assertIn('ARGS="$ARGS --fail-on-error"', primary_step)

        manifest = (ROOT / ".github" / "workflows" / "update-manifest.yml").read_text(encoding="utf-8")
        runner = (ROOT / "scripts" / "update-manifest-projections.sh").read_text(encoding="utf-8")
        self.assertNotIn("node scripts/build-fenok-etf-core-daily-basket.mjs --check", manifest)
        self.assertIn("node scripts/build-fenok-etf-core-daily-basket.mjs --check", runner)

    def test_central_writer_refreshes_daily1y_report_before_coverage_builder(self) -> None:
        workflow = (ROOT / ".github" / "workflows" / "fenok-edge-krx-daily.yml").read_text(encoding="utf-8")
        report_command = "npm --prefix 100xfenok-next run build:history-gap-daily1y"
        coverage_command = "node scripts/build-fenok-edge-coverage-index.mjs"
        self.assertNotIn(report_command, workflow)
        self.assertNotIn(coverage_command, workflow)

        manifest = (ROOT / ".github" / "workflows" / "update-manifest.yml").read_text(encoding="utf-8")
        runner = (ROOT / "scripts" / "update-manifest-projections.sh").read_text(encoding="utf-8")
        self.assertNotIn(report_command, manifest)
        self.assertNotIn(coverage_command, manifest)
        self.assertEqual(runner.count(report_command), 1)
        self.assertEqual(runner.count(coverage_command), 1)
        self.assertLess(runner.index(report_command), runner.index(coverage_command))


    def test_plane_success_gates_projection_without_cutting_over_projection_authority(self) -> None:
        fetch_workflow = (ROOT / ".github" / "workflows" / "fetch-stockanalysis.yml").read_text(
            encoding="utf-8"
        )
        self.assertNotIn("--field etf_cloud_generation=true", fetch_workflow)
        self.assertIn("needs.publish-stockanalysis-etf-plane.result == 'skipped'", fetch_workflow)

        update_workflow = (ROOT / ".github" / "workflows" / "update-manifest.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn("etf_cloud_generation:", update_workflow)
        self.assertIn("default: 'false'", update_workflow.split("etf_cloud_generation:", 1)[1].split("rebuild_slickcharts:", 1)[0])
        self.assertIn("github.event.inputs.etf_cloud_generation == 'true'", update_workflow)
        self.assertIn(
            "node scripts/materialize-cloud-data-plane-family.mjs",
            update_workflow,
        )
        self.assertNotIn(
            "materialize-cloud-data-plane-family.mjs",
            update_workflow.split("          for attempt in 1 2 3; do", 1)[1],
            "the retry loop must reuse the same external snapshot, never re-materialize",
        )

    def test_generic_html_table_fixture(self) -> None:
        html = (FIXTURE_DIR / "generic_table.fixture.html").read_text(encoding="utf-8")
        tables = self.fetcher.parse_html_tables(html)

        self.assertEqual(len(tables), 1)
        self.assertEqual(tables[0]["headers"], ["Symbol", "Company Name", "% Change"])
        self.assertEqual(tables[0]["records"][0]["symbol"], "NVDA")
        self.assertEqual(tables[0]["records"][0]["symbol_href"], "https://stockanalysis.com/stocks/nvda/")
        self.assertEqual(tables[0]["records"][0]["pct_change"], "2.5%")

    def test_surface_name_dedupe_and_validation(self) -> None:
        names = self.fetcher.parse_surface_names("new_etfs,new_etfs,earnings_calendar", "core")
        self.assertEqual(names, ["new_etfs", "earnings_calendar"])

        with self.assertRaises(SystemExit):
            self.fetcher.parse_surface_names("missing_surface", "core")

    def test_collection_date_rejects_future_and_malformed_values(self) -> None:
        self.assertEqual(self.fetcher.collection_date("2026-07-09T01:00:00Z"), "2026-07-09")
        self.assertIsNone(self.fetcher.collection_date("2026-02-31T00:00:00Z"))
        self.assertIsNone(self.fetcher.collection_date("2026-07-09junk"))
        self.assertIsNone(self.fetcher.collection_date("2099-01-01T00:00:00Z"))

    def test_surface_stamp_map_uses_consumer_ownership_and_rejects_unproven_prior_stamps(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp) / "stockanalysis"
                self.fetcher.OUT_DIR = out_dir
                (out_dir / "surfaces").mkdir(parents=True)
                consumers = {
                    "surfaces": [
                        {"surface": "event_a", "consumers": [{"route": "/market/events"}]},
                        {"surface": "event_b", "consumers": [{"route": "/market/events"}]},
                        {"surface": "sector_a", "consumers": [{"route": "/sectors"}]},
                        {"surface": "etf_a", "consumers": [{"route": "/etfs"}]},
                    ]
                }
                (out_dir / "surface_consumers.json").write_text(json.dumps(consumers), encoding="utf-8")
                for name, stamp in {"event_a": "2026-07-09T01:00:00Z", "event_b": "2026-07-08T01:00:00Z", "sector_a": "2026-07-07T01:00:00Z", "etf_a": "2026-07-06T01:00:00Z"}.items():
                    (out_dir / "surfaces" / f"{name}.json").write_text(
                        json.dumps({"source_as_of": stamp, "fetched_at": "2026-07-12T00:00:00Z"}),
                        encoding="utf-8",
                    )
                ok_rows = [{"surface": name, "status": "ok", "error": None} for name in ("event_a", "event_b", "sector_a", "etf_a")]
                stamps = self.fetcher.build_surface_stamp_map([row["surface"] for row in ok_rows], ok_rows, None)
                self.assertEqual(stamps, {"market_events": "2026-07-08", "sectors": "2026-07-07", "etf_center": "2026-07-06"})

                duplicated_results = [*ok_rows, ok_rows[0]]
                duplicated = self.fetcher.build_surface_stamp_map(
                    [row["surface"] for row in duplicated_results], duplicated_results, None
                )
                self.assertIsNone(duplicated["market_events"], "duplicate result rows fail the affected domain closed")

                prior = {"source_as_of": {"market_events": "2026-06-30", "sectors": "2026-06-29", "etf_center": "2026-06-28"}}
                partial = self.fetcher.build_surface_stamp_map(["event_a"], [ok_rows[0]], prior)
                self.assertEqual(
                    partial,
                    {"market_events": None, "sectors": None, "etf_center": None},
                    "partial domains do not inherit legacy stamps without provider evidence",
                )

                failed_rows = [*ok_rows]
                failed_rows[1] = {"surface": "event_b", "status": "error", "error": "fixture"}
                failed = self.fetcher.build_surface_stamp_map([row["surface"] for row in failed_rows], failed_rows, prior)
                self.assertIsNone(failed["market_events"], "known full-domain failure clears the domain stamp")

                malformed_consumers = json.loads(json.dumps(consumers))
                malformed_consumers["surfaces"][0]["consumers"] = [{}]
                (out_dir / "surface_consumers.json").write_text(json.dumps(malformed_consumers), encoding="utf-8")
                self.assertEqual(
                    self.fetcher.build_surface_stamp_map([], [], prior),
                    {"market_events": None, "sectors": None, "etf_center": None},
                    "malformed ownership fails every domain closed",
                )

                consumers["surfaces"].append({"surface": "event_a", "consumers": [{"route": "/market/events"}]})
                (out_dir / "surface_consumers.json").write_text(json.dumps(consumers), encoding="utf-8")
                self.assertEqual(
                    self.fetcher.build_surface_stamp_map([], [], prior),
                    {"market_events": None, "sectors": None, "etf_center": None},
                    "duplicate ownership fails every domain closed",
                )
        finally:
            self.fetcher.OUT_DIR = original_out_dir

    def test_etf_classification_preserves_collection_stamp(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_public_dir = self.fetcher.PUBLIC_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp:
                self.fetcher.OUT_DIR = Path(tmp) / "data"
                self.fetcher.PUBLIC_DIR = Path(tmp) / "public"
                self.fetcher.OUT_DIR.mkdir(parents=True)
                payload = {"source_as_of": "2026-07-08", "records": [{"ticker": "AAA", "name": "AAA ETF"}], "counts": {}}
                (self.fetcher.OUT_DIR / "etf_universe.json").write_text(json.dumps(payload), encoding="utf-8")
                self.fetcher.classify_existing_etf_catalog("etf_universe.json", mirror_public=False)
                classified = json.loads((self.fetcher.OUT_DIR / "etf_universe.json").read_text(encoding="utf-8"))
                self.assertEqual(classified["source_as_of"], "2026-07-08")
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.PUBLIC_DIR = original_public_dir

    def test_etf_classification_reconciles_recovery_hash_without_advancing_lineage(self) -> None:
        original_dirs = (
            self.fetcher.OUT_DIR,
            self.fetcher.PUBLIC_DIR,
            self.fetcher.STOCKANALYSIS_RECOVERY_ROOT,
        )
        original_now = self.fetcher.now_iso
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fetcher.OUT_DIR = root / "data" / "stockanalysis"
            self.fetcher.PUBLIC_DIR = root / "public" / "data" / "stockanalysis"
            self.fetcher.STOCKANALYSIS_RECOVERY_ROOT = (
                root / "data" / "admin" / "stockanalysis-recovery"
            )
            payload = {
                "schema_version": "stockanalysis/v1",
                "source": "stockanalysis",
                "asset_type": "etf",
                "generated_at": "2026-08-19T07:00:00Z",
                "source_as_of": None,
                "source_as_of_reason": "provider publishes no aggregate source date",
                "fetched_at": "2026-08-19T07:00:00Z",
                "endpoint": "/etf/",
                "counts": {"records": 1, "pages": 1},
                "warnings": [],
                "pages": [{"page": 1, "path": "/etf/", "record_count": 1}],
                "records": [{"ticker": "AAA", "name": "AAA ETF", "source_page": 1}],
            }
            canonical = self.fetcher.OUT_DIR / "etf_universe.json"
            self.fetcher.write_json(canonical, payload)
            store = self.fetcher.StockAnalysisRecoveryStateStore(
                self.fetcher.STOCKANALYSIS_RECOVERY_ROOT, root
            )
            bootstrap_run = {
                "run_id": "bootstrap",
                "run_attempt": 1,
                "event_name": "schedule",
                "natural": True,
                "observed_at": "2026-08-19T07:00:00Z",
            }
            store.bootstrap_existing(bootstrap_run)
            store.record_failure(
                "universe",
                "etf_universe",
                "transient failure before recovery",
                {
                    "run_id": "universe-failed",
                    "run_attempt": 1,
                    "event_name": "schedule",
                    "natural": True,
                    "observed_at": "2026-08-19T07:30:00Z",
                },
            )
            lkg_path = store.root / "lkg" / "universe" / "etf_universe.json"
            lkg_bytes = lkg_path.read_bytes()
            advanced = {
                **payload,
                "generated_at": "2026-08-19T08:00:00Z",
                "fetched_at": "2026-08-19T08:00:00Z",
                "counts": {"records": 2, "pages": 1},
                "pages": [{"page": 1, "path": "/etf/", "record_count": 2}],
                "records": [
                    {"ticker": "AAA", "name": "AAA ETF", "source_page": 1},
                    {"ticker": "BBB", "name": "BBB ETF", "source_page": 1},
                ],
            }
            self.fetcher.write_json(canonical, advanced)
            store.record_success(
                "universe",
                "etf_universe",
                advanced,
                {
                    "run_id": "universe-recovered",
                    "run_attempt": 1,
                    "event_name": "schedule",
                    "natural": True,
                    "observed_at": "2026-08-19T08:05:00Z",
                },
            )
            state_path = store.root / "states" / "universe" / "etf_universe.json"
            before = json.loads(state_path.read_text(encoding="utf-8"))
            stale_sha = before["current"]["payload_sha256"]
            self.fetcher.now_iso = lambda: "2026-08-20T07:00:00Z"
            original_argv = sys.argv
            sys.argv = [
                "fetch-stockanalysis.py",
                "--classify-etf-catalogs",
                "--event-name",
                "schedule",
            ]
            try:
                self.fetcher.main()
            finally:
                sys.argv = original_argv
                (
                    self.fetcher.OUT_DIR,
                    self.fetcher.PUBLIC_DIR,
                    self.fetcher.STOCKANALYSIS_RECOVERY_ROOT,
                    self.fetcher.now_iso,
                ) = (*original_dirs, original_now)

            canonical_bytes = canonical.read_bytes()
            after = json.loads(state_path.read_text(encoding="utf-8"))
            expected = json.loads(json.dumps(before))
            expected["current"]["payload_sha256"] = hashlib.sha256(canonical_bytes).hexdigest()
            self.assertFalse((root / "public").exists())
            self.assertNotEqual(stale_sha, expected["current"]["payload_sha256"])
            self.assertEqual(after, expected)
            self.assertEqual(lkg_path.read_bytes(), lkg_bytes)
            self.assertEqual(after["lkg"], before["lkg"])

    def test_parse_history_periods_dedupe_and_validation(self) -> None:
        periods = self.fetcher.parse_history_periods("monthly_3y,monthly_3y,monthly_5y")
        self.assertEqual(periods, ("monthly_3y", "monthly_5y"))

        with self.assertRaises(SystemExit):
            self.fetcher.parse_history_periods("monthly_99y")

    def test_workflow_history_gaps_only_passes_yahoo_fallback(self) -> None:
        workflow = (ROOT / ".github" / "workflows" / "fetch-stockanalysis.yml").read_text(encoding="utf-8")
        marker = 'elif [ "${INPUT_HISTORY_GAPS_ONLY:-false}" = "true" ]; then'
        branch = workflow.split(marker, 1)[1].split("else", 1)[0]

        self.assertIn("--history-gaps-only", branch)
        self.assertIn("--yf-etf-fallback", branch)

    def test_select_base_etfs_uses_default_focus_set_without_incremental_only(self) -> None:
        etfs = self.fetcher.select_base_etfs(
            [],
            stocks_only=False,
            universe_backfill=False,
            incremental_etf_backfill=True,
            incremental_etf_only=False,
        )

        self.assertIn("SPY", etfs)
        self.assertIn("QQQ", etfs)

    def test_select_base_etfs_incremental_only_skips_default_focus_set(self) -> None:
        etfs = self.fetcher.select_base_etfs(
            [],
            stocks_only=False,
            universe_backfill=False,
            incremental_etf_backfill=True,
            incremental_etf_only=True,
        )

        self.assertEqual(etfs, [])

    def test_select_base_etfs_incremental_only_keeps_explicit_etfs(self) -> None:
        etfs = self.fetcher.select_base_etfs(
            ["AAA", "BBB"],
            stocks_only=False,
            universe_backfill=False,
            incremental_etf_backfill=True,
            incremental_etf_only=True,
        )

        self.assertEqual(etfs, ["AAA", "BBB"])

    def test_financial_statement_fixture_contract(self) -> None:
        payload = json.loads((FIXTURE_DIR / "aapl_income_annual__data.fixture.json").read_text(encoding="utf-8"))
        decoded = self.fetcher.extract_financial_node(payload)
        normalized = self.fetcher.normalize_financial_statement("AAPL", "income", decoded)

        self.fetcher.validate_financial_statement(normalized)
        self.assertEqual(normalized["ticker"], "AAPL")
        self.assertEqual(normalized["period"], "annual")
        self.assertGreaterEqual(normalized["field_count"], 20)
        self.assertGreaterEqual(len(normalized["periods"]), 3)
        self.assertTrue(all(len(row["values"]) == len(normalized["periods"]) for row in normalized["rows"]))

    def test_devalue_negative_special_values_decode_as_none(self) -> None:
        decoded = self.fetcher.decode_svelte_data([
            {"value": -6, "ref": 1},
            "ok",
        ])

        self.assertIsNone(decoded["value"])
        self.assertEqual(decoded["ref"], "ok")

    def test_financial_rows_are_padded_to_period_count(self) -> None:
        normalized = self.fetcher.normalize_financial_statement(
            "GOOGL",
            "ratios",
            {
                "statement": "ratios",
                "period": "quarterly",
                "financialData": {
                    "datekey": ["2026-03-31", "2025-12-31", "2025-09-30"],
                    "assetturnover": [0.82, 0.81],
                },
                "map": [
                    {"id": "assetturnover", "title": "Asset Turnover", "format": "ratio"},
                ],
            },
        )

        self.assertEqual(normalized["rows"][0]["values"], [0.82, 0.81, None])

    def test_financial_statement_floor_blocks_empty_payloads(self) -> None:
        with self.assertRaises(ValueError):
            self.fetcher.validate_financial_statement(
                {
                    "ticker": "EMPTY",
                    "statement": "income",
                    "period": "annual",
                    "periods": ["2025-12-31"],
                    "rows": [],
                    "field_count": 0,
                }
            )

    def test_bank_ratio_profile_uses_statement_specific_floor(self) -> None:
        periods = ["2025-12-31", "2024-12-31", "2023-12-31", "2022-12-31", "2021-12-31", "2020-12-31"]
        fields = ["marketcap", "pe", "pb", "roe", "dividendyield"] + [
            f"ratio_{index}" for index in range(10)
        ]
        rows = [
            {"field": field, "values": [float(index + 1)] * len(periods)}
            for index, field in enumerate(fields)
        ]
        self.fetcher.validate_financial_statement(
            {
                "ticker": "JPM",
                "statement": "ratios",
                "period": "annual",
                "periods": periods,
                "rows": rows,
                "field_count": len(rows),
            }
        )
        short_periods = periods[:2]
        with self.assertRaisesRegex(ValueError, r"ratios annual periods=2"):
            self.fetcher.validate_financial_statement(
                {
                    "ticker": "JPM",
                    "statement": "ratios",
                    "period": "annual",
                    "periods": short_periods,
                    "rows": [
                        {"field": field, "values": [1.0] * len(short_periods)}
                        for field in fields
                    ],
                    "field_count": len(rows),
                }
            )
        with self.assertRaisesRegex(ValueError, r"ratios annual rows=14 min=15"):
            self.fetcher.validate_financial_statement(
                {
                    "ticker": "JPM",
                    "statement": "ratios",
                    "period": "annual",
                    "periods": periods,
                    "rows": rows[:-1],
                    "field_count": len(rows) - 1,
                }
            )

        null_rows = [
            {"field": field, "values": [None] * len(periods)}
            for field in fields
        ]
        with self.assertRaisesRegex(ValueError, "no finite observations"):
            self.fetcher.validate_financial_statement(
                {
                    "ticker": "JPM",
                    "statement": "ratios",
                    "period": "annual",
                    "periods": periods,
                    "rows": null_rows,
                    "field_count": len(null_rows),
                }
            )

        missing_required = [row for row in rows if row["field"] != "roe"]
        with self.assertRaisesRegex(ValueError, "missing required fields.*roe"):
            self.fetcher.validate_financial_statement(
                {
                    "ticker": "JPM",
                    "statement": "ratios",
                    "period": "annual",
                    "periods": periods,
                    "rows": missing_required + [
                        {"field": "ratio_extra", "values": [1.0] * len(periods)}
                    ],
                    "field_count": len(rows),
                }
            )

    def test_non_payer_profile_accepts_missing_dividend_yield_with_reason(self) -> None:
        periods = [
            "2025-12-31",
            "2024-12-31",
            "2023-12-31",
            "2022-12-31",
            "2021-12-31",
            "2020-12-31",
        ]
        fields = ["marketcap", "pe", "pb", "roe"] + [
            f"ratio_{index}" for index in range(11)
        ]
        statement = {
            "ticker": "AMZN",
            "statement": "ratios",
            "period": "annual",
            "periods": periods,
            "rows": [
                {"field": field, "values": [float(index + 1)] * len(periods)}
                for index, field in enumerate(fields)
            ],
            "field_count": len(fields),
        }

        self.fetcher.validate_financial_statement(
            statement,
            issuer_profile={"dividend": "n/a"},
        )

        self.assertEqual(
            statement["validation"],
            {
                "accepted_missing_fields": [
                    {
                        "field": "dividendyield",
                        "reason": "provider_overview_declares_no_dividend",
                    }
                ],
                "issuer_dividend_profile": {
                    "classification": "non_payer",
                    "reason": "provider_overview_declares_no_dividend",
                },
            },
        )

    def test_payer_or_unknown_profile_still_requires_dividend_yield(self) -> None:
        periods = [
            "2025-12-31",
            "2024-12-31",
            "2023-12-31",
            "2022-12-31",
            "2021-12-31",
            "2020-12-31",
        ]
        fields = ["marketcap", "pe", "pb", "roe"] + [
            f"ratio_{index}" for index in range(11)
        ]

        def statement() -> dict:
            return {
                "ticker": "JPM",
                "statement": "ratios",
                "period": "annual",
                "periods": periods,
                "rows": [
                    {"field": field, "values": [float(index + 1)] * len(periods)}
                    for index, field in enumerate(fields)
                ],
                "field_count": len(fields),
            }

        with self.assertRaisesRegex(ValueError, "missing required fields.*dividendyield"):
            self.fetcher.validate_financial_statement(
                statement(),
                issuer_profile={"dividend": "$6.00 (1.65%)"},
            )
        with self.assertRaisesRegex(ValueError, "missing required fields.*dividendyield"):
            self.fetcher.validate_financial_statement(statement())

    def test_stock_payload_reuses_prefetched_overview(self) -> None:
        overview = {
            "marketCap": "2.8T",
            "dividend": "n/a",
        }
        calls = []

        def fake_fetch_json(path: str, _timeout: int) -> dict:
            calls.append(path)
            if path == "/api/symbol/s/AMZN/history?range=1Y&period=Monthly":
                return {"data": [{"t": "2026-08-14", "c": 200.0}]}
            if path == "/api/quotes/s/AMZN":
                return {"data": {"symbol": "AMZN", "uid": "AMZN", "p": 200.0, "td": "2026-08-14"}}
            raise AssertionError(f"unexpected endpoint: {path}")

        original_fetch_json = self.fetcher.fetch_json
        self.fetcher.fetch_json = fake_fetch_json
        try:
            payload = self.fetcher.fetch_stock("AMZN", timeout=1, overview=overview)
        finally:
            self.fetcher.fetch_json = original_fetch_json

        self.assertNotIn("/stocks/amzn/__data.json", calls)
        self.assertEqual(payload["normalized"]["overview"]["dividend"], "n/a")

    def test_stock_payload_links_financials_summary_when_supplied(self) -> None:
        financials = {
            "fetched_at": "2026-06-18T00:00:00Z",
            "role": "financial statement cross-check candidate; not valuation SSOT",
            "summary": {"annual": {"income": {"field_count": 30, "period_count": 5}}},
        }
        original_fetch_json = self.fetcher.fetch_json
        self.fetcher.fetch_json = lambda path, _timeout: (
            {"nodes": [{"data": [{"overview": 1}, {"marketCap": 2}, "4T"]}]}
            if path == "/stocks/aapl/__data.json"
            else {"status": 200, "data": {}}
        )
        try:
            stock_payload = self.fetcher.fetch_stock("AAPL", timeout=1, financials=financials)
        finally:
            self.fetcher.fetch_json = original_fetch_json

        self.assertEqual(stock_payload["financials_path"], "financials/AAPL.json")
        self.assertEqual(stock_payload["normalized"]["financials"]["path"], "financials/AAPL.json")
        self.assertEqual(stock_payload["normalized"]["financials"]["summary"], financials["summary"])

    def test_stock_overview_uses_official_svelte_page_while_quote_and_history_stay_api_backed(self) -> None:
        overview_payload = {
            "nodes": [
                {
                    "data": [
                        {"overview": 1},
                        {
                            "marketCap": 2,
                            "revenue": 3,
                            "netIncome": 4,
                            "sharesOut": 5,
                            "eps": 6,
                            "peRatio": 7,
                            "forwardPE": 8,
                            "dividend": 9,
                            "beta": 10,
                            "analysts": 11,
                            "target": 12,
                            "earningsDate": 13,
                        },
                        "4.0T",
                        "400B",
                        "100B",
                        "15B",
                        "7.5",
                        "30",
                        "28",
                        "$1.00 (0.4%)",
                        "1.1",
                        "Buy",
                        "300 (+5%)",
                        "Jul 30, 2026",
                    ]
                }
            ]
        }
        calls = []

        def fake_fetch_json(path: str, _timeout: int) -> dict:
            calls.append(path)
            if path == "/stocks/aapl/__data.json":
                return overview_payload
            if path == "/api/symbol/s/AAPL/history?range=1Y&period=Monthly":
                return {"data": [{"t": "2026-07-17", "c": 210}]}
            if path == "/api/quotes/s/AAPL":
                return {"data": {"symbol": "AAPL", "uid": "AAPL", "p": 210, "td": "2026-07-17"}}
            raise AssertionError(f"unexpected endpoint: {path}")

        original_fetch_json = self.fetcher.fetch_json
        self.fetcher.fetch_json = fake_fetch_json
        try:
            payload = self.fetcher.fetch_stock("AAPL", timeout=1)
        finally:
            self.fetcher.fetch_json = original_fetch_json

        self.assertEqual(
            calls,
            [
                "/stocks/aapl/__data.json",
                "/api/symbol/s/AAPL/history?range=1Y&period=Monthly",
                "/api/quotes/s/AAPL",
            ],
        )
        self.assertEqual(payload["normalized"]["overview"]["marketCap"], "4.0T")
        self.assertEqual(payload["normalized"]["quote"]["p"], 210)
        self.assertEqual(payload["normalized"]["history"][0]["c"], 210)

    def test_stock_financial_pair_validation_rejects_missing_or_torn_pair(self) -> None:
        financials = {
            "schema_version": "stockanalysis/v1",
            "source": "stockanalysis",
            "asset_type": "stock",
            "ticker": "AAPL",
            "fetched_at": "2026-07-18T00:00:00Z",
            "statements": {"annual": {"income": {"rows": [{}]}}},
        }
        stock = {
            "schema_version": "stockanalysis/v1",
            "source": "stockanalysis",
            "asset_type": "stock",
            "ticker": "AAPL",
            "fetched_at": "2026-07-18T00:02:00Z",
            "financials_path": "financials/AAPL.json",
            "normalized": {
                "overview": {"marketCap": "4T"},
                "financials": {
                    "path": "financials/AAPL.json",
                    "fetched_at": "2026-07-18T00:00:00Z",
                },
            },
        }
        self.fetcher.validate_stock_financial_pair("AAPL", stock, financials)

        torn = json.loads(json.dumps(stock))
        torn["normalized"]["financials"]["fetched_at"] = "2026-07-17T00:00:00Z"
        with self.assertRaisesRegex(ValueError, "fetched_at mismatch"):
            self.fetcher.validate_stock_financial_pair("AAPL", torn, financials)

        with self.assertRaisesRegex(ValueError, "financial candidate is required"):
            self.fetcher.validate_stock_financial_pair("AAPL", stock, None)

    def test_required_pair_publishes_financial_first_and_defers_recovery_success(self) -> None:
        events = []

        class RecoveryStore:
            @staticmethod
            def record_success(kind: str, ticker: str, _payload: dict, _run: dict) -> None:
                events.append(("success", kind, ticker))

        stock = {"ticker": "AAPL"}
        financials = {"ticker": "AAPL"}
        original_write = self.fetcher.write_payload

        def failing_second_write(path: str, _payload: dict, _mirror: bool) -> None:
            events.append(("write", path))
            if path == "stocks/AAPL.json":
                raise OSError("stock write failed")

        self.fetcher.write_payload = failing_second_write
        try:
            with self.assertRaisesRegex(OSError, "stock write failed"):
                self.fetcher.publish_stock_financial_pair(
                    "AAPL",
                    stock,
                    financials,
                    False,
                    RecoveryStore(),
                    {"run_id": "scheduled"},
                )
        finally:
            self.fetcher.write_payload = original_write

        self.assertEqual(
            events,
            [
                ("write", "financials/AAPL.json"),
                ("write", "stocks/AAPL.json"),
            ],
        )

    def test_natural_recovery_selection_is_lane_scoped_and_bounded(self) -> None:
        class FakeStore:
            @staticmethod
            def retry_entities(kind: str) -> set[str]:
                return {
                    "stock": {"AMD", "AMZN", "META", "MSFT", "NVDA"},
                    "financial": {"AAPL", "NVDA"},
                    "etf": {"TQQQ", "SOXL"},
                    "surface": {"actions_recent"},
                    "universe": {"etf_universe"},
                }[kind]

        stocks, financials, retry_etfs, surfaces, retry_universe = self.fetcher.select_natural_recovery_targets(
            FakeStore(),
            {"stock", "financial"},
            ["AAPL", "MSFT"],
            [],
            stock_limit=3,
            selected_etf_state={}, primary_observations={},
        )
        self.assertEqual(stocks, ["AAPL", "MSFT", "AMD"])
        self.assertEqual(financials, {"AAPL"})
        self.assertEqual(retry_etfs, [])
        self.assertEqual(surfaces, [])
        self.assertFalse(retry_universe)

        stocks, financials, retry_etfs, surfaces, retry_universe = self.fetcher.select_natural_recovery_targets(
            FakeStore(),
            {"etf", "surface", "universe"},
            [],
            ["market_gainers"],
            stock_limit=3,
            selected_etf_state={}, primary_observations={},
        )
        self.assertEqual(stocks, [])
        self.assertEqual(financials, set())
        self.assertEqual(retry_etfs, ["SOXL"])
        self.assertEqual(surfaces, ["actions_recent", "market_gainers"])
        self.assertTrue(retry_universe)

        with self.assertRaisesRegex(ValueError, "unknown natural recovery kind"):
            self.fetcher.parse_natural_recovery_kinds("stock,unknown")

    def test_etf_payload_includes_classification_candidate(self) -> None:
        def fake_fetch_svelte_detail(
            _ticker: str,
            surface: str,
            _timeout: int,
            *,
            allow_unavailable: bool = False,
        ) -> tuple[str, dict]:
            self.assertEqual(allow_unavailable, surface == "holdings")
            if surface == "overview":
                return "/etf/nvdl/__data.json", {
                    "description": (
                        "The fund provides 2x leveraged exposure, less fees and expenses, "
                        "to the daily price movement for shares of NVIDIA Corporation stock."
                    ),
                    "aum": "$1.0B",
                    "holdings": 0,
                    "holdingsTable": {"count": 0, "holdings": []},
                    "inception": "Jan 1, 2023",
                    "performance": {"tr1m": 12.3, "trYTD": 45.6},
                }
            return "/etf/nvdl/holdings/__data.json", {
                "holdings": [],
                "count": 0,
                "date": "Jun 30, 2026",
                "sectors": [],
                "countries": [],
            }

        def fake_fetch_json(path: str, _timeout: int) -> dict:
            if "history?range=1Y&period=Daily" in path:
                return {"status": 200, "data": [{"t": "2026-06-18", "c": 101.0}]}
            if "history?range=1Y&period=Weekly" in path:
                return {"status": 200, "data": [{"t": "2026-06-15", "c": 100.0}]}
            if "history?range=1Y&period=Monthly" in path:
                return {"status": 200, "data": [{"t": "2026-06-01", "c": 99.0}]}
            if "history?range=3Y&period=Weekly" in path:
                return {"status": 200, "data": [{"t": "2026-06-08", "c": 98.0}]}
            if "history?range=3Y&period=Monthly" in path:
                return {"status": 200, "data": [{"t": "2026-06-01", "c": 97.0}]}
            if "history?range=5Y&period=Monthly" in path:
                return {"status": 200, "data": [{"t": "2026-06-01", "c": 96.0}]}
            return {"status": 200, "data": {}}

        original_fetch_json = self.fetcher.fetch_json
        original_fetch_svelte_detail = self.fetcher.fetch_svelte_detail
        self.fetcher.fetch_json = fake_fetch_json
        self.fetcher.fetch_svelte_detail = fake_fetch_svelte_detail
        try:
            payload = self.fetcher.fetch_etf("NVDL", timeout=1)
        finally:
            self.fetcher.fetch_json = original_fetch_json
            self.fetcher.fetch_svelte_detail = original_fetch_svelte_detail

        classification = payload["normalized"]["classification"]
        self.assertTrue(classification["is_leveraged"])
        self.assertEqual(classification["leverage_factor"], 2.0)
        self.assertTrue(classification["is_single_stock"])
        self.assertEqual(classification["underlying"], "NVIDIA Corporation")
        self.assertEqual(payload["normalized"]["performance"]["trYTD"], 45.6)
        self.assertEqual(payload["normalized"]["history"][0]["c"], 99.0)
        self.assertEqual(payload["normalized"]["history_periods"]["daily_1y"][0]["c"], 101.0)
        self.assertEqual(payload["normalized"]["history_periods"]["weekly_1y"][0]["c"], 100.0)
        self.assertEqual(payload["normalized"]["history_periods"]["monthly_1y"][0]["c"], 99.0)
        self.assertEqual(payload["normalized"]["history_periods"]["weekly_3y"][0]["c"], 98.0)
        self.assertEqual(payload["normalized"]["history_periods"]["monthly_3y"][0]["c"], 97.0)
        self.assertEqual(payload["normalized"]["history_periods"]["monthly_5y"][0]["c"], 96.0)
        self.assertIn("monthly_3y", payload["endpoints"]["history_periods"])
        self.assertIn("monthly_5y", payload["endpoints"]["history_periods"])
        self.assertEqual(payload["endpoints"]["overview"], "/etf/nvdl/__data.json")
        self.assertEqual(payload["endpoint_contracts"]["overview"]["decoder"], "svelte_devalue_node/v1")

    def test_etf_catalog_enrichment_promotes_detail_metrics(self) -> None:
        detail_index = {
            "VOO": {
                "source": "stockanalysis",
                "ticker": "VOO",
                "normalized": {
                    "overview": {
                        "expenseRatio": "0.03%",
                        "dividendYield": "1.04%",
                        "sharesOut": "2.36B",
                        "inception": "Sep 7, 2010",
                        "provider_page": "vanguard",
                        "etf_website": "https://investor.vanguard.com/investment-products/etfs/profile/voo",
                    },
                    "holdings": [],
                    "classification": {
                        "is_leveraged": False,
                        "leverage_factor": None,
                        "is_inverse": False,
                        "is_single_stock": False,
                        "underlying": None,
                        "source": "stockanalysis.overview.description",
                        "confidence": "high",
                    },
                },
                "raw": {
                    "overview": {
                        "performance": {
                            "tr1m": 1.069,
                            "trYTD": 9.851,
                            "tr1y": 26.503,
                        }
                    }
                },
            }
        }

        enriched = self.fetcher.enrich_etf_records(
            [{"ticker": "VOO", "name": "Vanguard S&P 500 ETF", "category": "Equity"}],
            detail_index,
        )[0]

        self.assertEqual(enriched["expenseRatio"], "0.03%")
        self.assertEqual(enriched["expense_ratio"], 0.03)
        self.assertEqual(enriched["dividend_yield"], 1.04)
        self.assertEqual(enriched["inceptionDate"], "Sep 7, 2010")
        self.assertEqual(enriched["performance"]["tr1y"], 26.503)
        self.assertFalse(enriched["classification"]["is_leveraged"])
        self.assertEqual(enriched["classification"]["confidence"], "high")
        counts = self.fetcher.etf_detail_enrichment_counts([enriched])
        self.assertEqual(counts["expense_ratio"], 1)
        self.assertEqual(counts["performance"], 1)

    def test_etf_catalog_classification_keeps_detail_primary_and_row_fallback(self) -> None:
        detail_index = {
            "PLAIN": {
                "normalized": {
                    "classification": {
                        "is_leveraged": False,
                        "leverage_factor": None,
                        "is_inverse": False,
                        "is_single_stock": False,
                        "underlying": None,
                        "source": "stockanalysis.overview.description",
                        "confidence": "high",
                    }
                }
            },
            "ADIU": {
                "normalized": {
                    "classification": {
                        "is_leveraged": False,
                        "leverage_factor": None,
                        "is_inverse": False,
                        "is_single_stock": False,
                        "underlying": None,
                        "source": "stockanalysis.overview.description",
                        "confidence": "high",
                    }
                }
            },
            "LOWFALSE": {
                "normalized": {
                    "classification": {
                        "is_leveraged": False,
                        "leverage_factor": None,
                        "is_inverse": False,
                        "is_single_stock": False,
                        "underlying": None,
                        "source": "stockanalysis.etf_list.name",
                        "confidence": "low",
                    }
                }
            },
        }

        enriched = self.fetcher.enrich_etf_records(
            [
                {"ticker": "PLAIN", "name": "Plain Vanilla ETF", "category": "Equity"},
                {"ticker": "ADIU", "name": "Leverage Shares 2X Long ADI Daily ETF", "category": "Equity"},
                {"ticker": "ROWONLY", "name": "Leverage Shares 2X Long ADI Daily ETF", "category": "Equity"},
                {"ticker": "LOWFALSE", "name": "Leverage Shares 2X Long ADI Daily ETF", "category": "Equity"},
            ],
            detail_index,
        )

        self.assertIn("classification", enriched[0])
        self.assertFalse(enriched[0]["classification"]["is_leveraged"])
        self.assertEqual(enriched[0]["classification"]["confidence"], "high")
        self.assertFalse(enriched[1]["classification"]["is_leveraged"])
        self.assertEqual(enriched[1]["classification"]["confidence"], "high")
        self.assertTrue(enriched[2]["classification"]["is_leveraged"])
        self.assertEqual(enriched[2]["classification"]["leverage_factor"], 2.0)
        self.assertTrue(enriched[2]["classification"]["is_single_stock"])
        self.assertTrue(enriched[3]["classification"]["is_leveraged"])
        self.assertEqual(enriched[3]["classification"]["leverage_factor"], 2.0)
        self.assertTrue(enriched[3]["classification"]["is_single_stock"])

        counts = self.fetcher.etf_classification_counts(enriched)
        self.assertEqual(counts["classified"], 4)
        self.assertEqual(counts["coverage_pct"], 100.0)
        self.assertEqual(counts["leveraged"], 2)

    def test_incremental_etf_backfill_selects_missing_fallback_and_stale(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp) / "stockanalysis"
            self.fetcher.OUT_DIR = out_dir
            (out_dir / "surfaces").mkdir(parents=True)
            (out_dir / "etfs").mkdir(parents=True)
            (out_dir / "surfaces" / "new_etfs.json").write_text(
                json.dumps(
                    {
                        "records": [
                            {"s": "ADIU", "n": "Leverage Shares 2X Long ADI Daily ETF"},
                            {"s": "FNG", "n": "FNG ETF"},
                        ]
                    }
                ),
                encoding="utf-8",
            )
            (out_dir / "etfs" / "FNG.json").write_text(
                json.dumps(
                    {
                        "source": "yahoo_finance",
                        "source_provider": "yahoo_finance",
                        "detail_status": "yf_fallback",
                        "fetched_at": "2026-06-18T00:00:00Z",
                    }
                ),
                encoding="utf-8",
            )
            (out_dir / "etfs" / "OLD.json").write_text(
                json.dumps(
                    {
                        "source": "stockanalysis",
                        "asset_type": "etf",
                        "fetched_at": "2020-01-01T00:00:00Z",
                    }
                ),
                encoding="utf-8",
            )

            # Initial missing-detail reconciliation deliberately defers these
            # surfaces. A recent collection must not hide their unfinished work.
            for ticker, reasons in (
                ("DFQ", ["quote_deferred_initial_reconcile"]),
                ("DFH", ["history_deferred_initial_reconcile"]),
                ("CNT", ["holdings_countries_unavailable"]),
            ):
                (out_dir / "etfs" / f"{ticker}.json").write_text(json.dumps({
                    "source": "stockanalysis", "asset_type": "etf",
                    "detail_status": "stockanalysis_partial",
                    "fetched_at": datetime.now(timezone.utc).isoformat(),
                    "source_as_of": datetime.now(timezone.utc).isoformat(),
                    "partial_reason_codes": reasons,
                }), encoding="utf-8")

            summary = self.fetcher.incremental_etf_backfill_candidates(
                universe_payload={"records": [{"ticker": ticker} for ticker in ("OLD", "DFQ", "DFH", "CNT")]},
                limit=10,
                max_age_hours=1,
                exclude=set(),
            )
        self.fetcher.OUT_DIR = original_out_dir

        selected = {row["ticker"]: row["reason"] for row in summary["selected"]}
        self.assertEqual(selected["ADIU"], "missing")
        self.assertEqual(selected["FNG"], "fallback_retry")
        self.assertEqual(selected["OLD"], "stale")
        self.assertEqual(selected["DFQ"], "deferred_detail")
        self.assertEqual(selected["DFH"], "deferred_detail")
        self.assertNotIn("CNT", selected)
        self.assertEqual(summary["counts"]["deferred_detail"], 2)
        self.assertEqual(summary["counts"]["selected"], 5)

    def test_natural_general_incremental_priority_rotates_tail_and_records_evidence(self) -> None:
        now_dt = datetime(2026, 10, 6, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "data/stockanalysis"
            out.joinpath("etfs").mkdir(parents=True)
            out.joinpath("surfaces").mkdir()
            tail = [f"STALE{i:02d}" for i in range(60)]
            universe = {"records": [{"ticker": ticker} for ticker in ("NEW", "MISSING", "DATELESS", "PENDING", "HOT", "FRESH", *tail)]}
            pending = {"entries": {"PENDING": {"consecutive_failures": 1, "last_attempt_utc": "2026-10-05T00:00:00Z"}}}
            with patch.object(self.fetcher, "OUT_DIR", out), \
                 patch.object(self.fetcher, "latest_stockanalysis_etf_detail_observations", return_value={}):
                self.fetcher.write_json(out / "surfaces/new_etfs.json", {"records": [{"ticker": "NEW"}]})
                for ticker in ("DATELESS", "HOT", "FRESH", *tail):
                    source = None if ticker == "DATELESS" else "2026-06-01T00:00:00Z" if ticker in tail else "2026-10-05T00:00:00Z"
                    self.fetcher.write_json(out / "etfs" / f"{ticker}.json", {
                        "schema_version": "stockanalysis/v1", "source": "stockanalysis", "asset_type": "etf",
                        "ticker": ticker, "source_as_of": source, "fetched_at": now_dt.isoformat(),
                        "normalized": {"overview": {"aum": 100_000_000_000 if ticker == "HOT" else 1}},
                    })
                options = dict(universe_payload=universe, limit=40, max_age_hours=720,
                               pending_ledger=pending, now_dt=now_dt, natural_general_priority=True,
                               selected_etf_state={})
                first = self.fetcher.incremental_etf_backfill_candidates(**options)
                repeated = self.fetcher.incremental_etf_backfill_candidates(**options)
                self.assertEqual(first["selected"], repeated["selected"])
                selected = first["selected"]
                self.assertEqual(len(selected), 40)
                self.assertEqual(len({row["ticker"] for row in selected}), 40)
                self.assertEqual([row["ticker"] for row in selected[:3]], ["NEW", "MISSING", "DATELESS"])
                self.assertTrue(all(row["selection_bucket"] == "oldest_stale" for row in selected[3:-1]))
                self.assertEqual(selected[-1]["ticker"], "PENDING")
                self.assertFalse({"HOT", "FRESH"} & {row["ticker"] for row in selected})
                # A successful HTTP response that still carries old source data
                # becomes retry debt, allowing untouched stale names to run next.
                self.fetcher.write_json(out / self.fetcher.PENDING_LEDGER_REL_PATH, pending)
                results = [{"ticker": row["ticker"], "asset_type": "etf", "provider": "stockanalysis", "status": "ok",
                            "error": "HTTP Error 404" if row["reason"] == "missing" else None} for row in selected]
                updated = self.fetcher.update_pending_ledger(results, selected, 7, 3, False, now_dt=now_dt)
                self.assertEqual(updated["entries"]["DATELESS"]["failure_class"], "source_date_non_advance")
                next_day = self.fetcher.incremental_etf_backfill_candidates(
                    **{**options, "pending_ledger": updated, "now_dt": now_dt + timedelta(days=1)})
                first_stale = {row["ticker"] for row in selected if row["ticker"] in tail}
                next_stale = {row["ticker"] for row in next_day["selected"] if row["ticker"] in tail}
                self.assertEqual(first_stale | next_stale, set(tail))
                self.assertTrue(set(tail) - first_stale <= next_stale)
                self.assertEqual(first["priority_selector"]["quota_policy"]["priority_order"],
                                 ["new_listings", "missing", "oldest_stale", "pending_retry", "high_impact", "fresh"])
                self.assertEqual(first["priority_selector"]["selected_counts"]["total"], 40)

    def test_source_date_non_advance_uses_existing_bounded_cooldown(self) -> None:
        now_dt = datetime(2026, 10, 6, tzinfo=timezone.utc)
        row = {"ticker": "OLD", "reason": "stale", "max_age_hours": 720}
        result = {"ticker": "OLD", "asset_type": "etf", "provider": "stockanalysis", "status": "ok", "error": None}
        with tempfile.TemporaryDirectory() as tmp, patch.object(self.fetcher, "OUT_DIR", Path(tmp)):
            self.fetcher.write_json(Path(tmp) / "etfs/OLD.json", {
                "source": "stockanalysis", "source_as_of": "2026-06-01T00:00:00Z", "fetched_at": "2026-10-06T00:00:00Z",
            })
            for day in range(3):
                ledger = self.fetcher.update_pending_ledger([result], [row], 7, 3, False, now_dt=now_dt + timedelta(days=day))
            entry = ledger["entries"]["OLD"]
            self.assertEqual(entry["consecutive_failures"], 3)
            self.assertTrue(self.fetcher.pending_entry_in_cooldown(entry, now_dt + timedelta(days=3), 7, 3))
            self.assertFalse(self.fetcher.pending_entry_in_cooldown(entry, now_dt + timedelta(days=10), 7, 3))

    def test_natural_general_priority_uses_selected_serving_source_floor(self) -> None:
        now_dt = datetime(2026, 10, 6, 9, 4, 40, tzinfo=timezone.utc)
        fresh = "2026-10-05T20:00:00Z"
        old = "2026-06-01T00:00:00Z"
        canonical_dates = dict.fromkeys((
            "ARLU", "CANONOLD", "INVALID", "FALLBACK", "DATELESS", "UNAVAILABLE",
            "ENROLLED", "FRESH", "UNENROLLED", "PROVDATE", "FUTURE", "CORE",
        ), fresh)
        canonical_dates.update({"ARLU": "2026-09-30T14:53:36Z", "CANONOLD": "2026-05-01T00:00:00Z",
                                "PROVDATE": None})
        current = {ticker: {
            "source_as_of": fresh, "observed_at": now_dt.isoformat(),
            "provider": "stockanalysis", "resolution_state": "fresh_primary",
        } for ticker in canonical_dates if ticker not in {"UNAVAILABLE", "ENROLLED", "UNENROLLED"}}
        current["ARLU"].update({"source_as_of": "2026-06-29T23:06:46Z",
                                "provider": "yahoo_finance", "resolution_state": "lkg_fallback"})
        current["INVALID"]["source_as_of"] = "2026-06-20T00:00:00Z"
        current["FALLBACK"]["source_as_of"] = "2026-06-15T00:00:00Z"
        current["DATELESS"]["source_as_of"] = None
        current["FUTURE"]["source_as_of"] = "2026-10-07T00:00:00Z"
        current["CORE"]["source_as_of"] = old
        selected_state = {
            "current": current,
            "recovery": {"UNAVAILABLE": {"last_transition": "unavailable"},
                         "ENROLLED": {"last_transition": "legacy_migration"}},
            "lkg": {ticker: {"source_as_of": old} for ticker in ("FRESH", "UNENROLLED", "UNAVAILABLE")},
        }
        before_state = json.dumps(selected_state, sort_keys=True)
        # These enrolled names must remain candidates even outside all catalogs.
        universe = {"records": [{"ticker": ticker} for ticker in canonical_dates
                                if ticker not in {"DATELESS", "UNAVAILABLE", "ENROLLED"}]}
        with tempfile.TemporaryDirectory() as tmp, patch.object(self.fetcher, "OUT_DIR", Path(tmp)), \
             patch.object(self.fetcher, "latest_stockanalysis_etf_detail_observations", return_value={
                 "INVALID": {"validation_status": "invalid", "reason_code": "quality_regression"},
             }), patch.object(self.fetcher, "data_supply_store") as supply_store:
            supply_store.return_value.read_active_domain.return_value = selected_state
            for ticker, stamp in canonical_dates.items():
                self.fetcher.write_json(Path(tmp) / "etfs" / f"{ticker}.json", {
                    "source": "yahoo_finance" if ticker == "FALLBACK" else "stockanalysis",
                    "ticker": ticker, "asset_type": "etf", "source_as_of": stamp,
                    "fetched_at": now_dt.isoformat(), "normalized": {"overview": {"aum": 1}},
                })
            before_files = {path.name: path.read_bytes() for path in Path(tmp).joinpath("etfs").glob("*.json")}
            summary = self.fetcher.incremental_etf_backfill_candidates(
                universe, 40, 720, exclude={"CORE"}, pending_ledger={"entries": {}},
                now_dt=now_dt, natural_general_priority=True)
            supply_store.return_value.read_active_domain.assert_called_once_with("etf_detail")
            self.assertEqual(before_files, {path.name: path.read_bytes()
                                           for path in Path(tmp).joinpath("etfs").glob("*.json")})
        rows = {row["ticker"]: row for row in summary["selected"]}
        self.assertEqual(len(rows), len(canonical_dates) - 1)
        self.assertNotIn("CORE", rows)
        arlu = rows["ARLU"]
        expected_age = (now_dt - datetime(2026, 6, 29, 23, 6, 46, tzinfo=timezone.utc)).total_seconds() / 3600
        self.assertEqual(arlu["age_hours"], round(expected_age, 2))
        self.assertEqual(arlu["serving_source_as_of"], "2026-06-29T23:06:46Z")
        self.assertEqual(arlu["serving_resolution_state"], "lkg_fallback")
        self.assertEqual(arlu["reason"], "stale")
        self.assertEqual([row["ticker"] for row in summary["selected"]
                          if row["selection_bucket"] == "oldest_stale"],
                         ["CANONOLD", "FALLBACK", "INVALID", "ARLU"])
        self.assertEqual(rows["INVALID"]["reason"], "invalid")
        self.assertEqual(rows["FALLBACK"]["reason"], "fallback_retry")
        for ticker in ("DATELESS", "UNAVAILABLE", "ENROLLED", "PROVDATE"):
            self.assertEqual(rows[ticker]["selection_bucket"], "missing", ticker)
            self.assertTrue(rows[ticker]["source_date_missing"], ticker)
            self.assertTrue(rows[ticker]["source_freshness_debt"], ticker)
        self.assertEqual(rows["UNAVAILABLE"]["serving_resolution_state"], "unavailable")
        self.assertIsNone(rows["ENROLLED"]["serving_resolution_state"])
        for ticker in ("FRESH", "UNENROLLED"):
            self.assertEqual(rows[ticker]["selection_bucket"], "fresh", ticker)
            self.assertFalse(rows[ticker]["source_freshness_debt"], ticker)
        self.assertEqual(rows["FUTURE"]["reason"], "invalid")
        self.assertEqual(rows["FUTURE"]["selection_bucket"], "pending_retry")
        self.assertEqual(json.dumps(selected_state, sort_keys=True), before_state)

    def test_natural_serving_debt_preserves_cooldown_and_post_collection_clock(self) -> None:
        now_dt = datetime(2026, 10, 6, tzinfo=timezone.utc)
        tickers = ("OLD", "RETRY", "COOL", "ABSENT", "SHORT")
        selected_state = {"current": {ticker: {
            "source_as_of": "2026-06-01T00:00:00Z", "resolution_state": "lkg_fallback",
        } for ticker in tickers}}
        ledger = {"entries": {
            "RETRY": {"consecutive_failures": 1, "last_attempt_utc": "2026-10-04T00:00:00Z"},
            "COOL": {"consecutive_failures": 3, "next_attempt_after_utc": "2026-10-13T00:00:00Z"},
            "ABSENT": {"availability_status": "provider_absent", "next_probe_after_utc": "2026-10-13T00:00:00Z"},
            "SHORT": {"failure_class": "successful_short_history", "next_attempt_after_utc": "2026-10-13T00:00:00Z"},
        }}
        with tempfile.TemporaryDirectory() as tmp, patch.object(self.fetcher, "OUT_DIR", Path(tmp)), \
             patch.object(self.fetcher, "latest_stockanalysis_etf_detail_observations", return_value={
                 "OLD": {"validation_status": "invalid", "reason_code": "quality_regression"},
             }):
            for ticker in tickers:
                self.fetcher.write_json(Path(tmp) / "etfs" / f"{ticker}.json", {
                    "source": "stockanalysis", "source_as_of": "2026-10-05T00:00:00Z",
                    "fetched_at": now_dt.isoformat(), "normalized": {"overview": {"aum": 1}},
                })
            self.fetcher.write_json(Path(tmp) / self.fetcher.PENDING_LEDGER_REL_PATH, ledger)
            options = dict(universe_payload={"records": [{"ticker": ticker} for ticker in tickers]},
                           limit=40, max_age_hours=720, natural_general_priority=True,
                           selected_etf_state=selected_state)
            initial = self.fetcher.incremental_etf_backfill_candidates(**options, pending_ledger=ledger, now_dt=now_dt)
            rows = {row["ticker"]: row for row in initial["selected"]}
            self.assertEqual(set(rows), {"OLD", "RETRY"})
            self.assertEqual(rows["OLD"]["selection_bucket"], "oldest_stale")
            self.assertEqual(rows["RETRY"]["selection_bucket"], "pending_retry")
            self.assertEqual({row["ticker"] for row in initial["cooldown"]}, {"COOL", "ABSENT", "SHORT"})
            result = {"ticker": "OLD", "asset_type": "etf", "provider": "stockanalysis", "status": "ok", "error": None}
            # Publication follows acquisition. An old selected row must not turn
            # a newly collected, fresh provider source into a false failure.
            ledger = self.fetcher.update_pending_ledger([result], initial["selected"], 7, 3, False, now_dt=now_dt)
            self.assertNotIn("OLD", ledger["entries"])
            self.fetcher.write_json(Path(tmp) / "etfs/OLD.json", {
                "source": "stockanalysis", "source_as_of": "2026-06-01T00:00:00Z",
                "fetched_at": now_dt.isoformat(), "normalized": {"overview": {"aum": 1}},
            })
            for day in range(3):
                stamp = now_dt + timedelta(days=day)
                summary = self.fetcher.incremental_etf_backfill_candidates(**options, pending_ledger=ledger, now_dt=stamp)
                old_row = next(row for row in summary["selected"] if row["ticker"] == "OLD")
                self.assertEqual(old_row["reason"], "invalid")
                self.assertTrue(old_row["source_freshness_debt"])
                ledger = self.fetcher.update_pending_ledger([result], summary["selected"], 7, 3, False, now_dt=stamp)
            self.assertEqual(ledger["entries"]["OLD"]["failure_class"], "source_date_non_advance")
            self.assertEqual(ledger["entries"]["OLD"]["consecutive_failures"], 3)
            after = self.fetcher.incremental_etf_backfill_candidates(
                **options, pending_ledger=ledger, now_dt=now_dt + timedelta(days=3))
            self.assertNotIn("OLD", {row["ticker"] for row in after["selected"]})
            self.assertIn("OLD", {row["ticker"] for row in after["cooldown"]})

    def test_selected_serving_floor_does_not_change_manual_or_history_selection(self) -> None:
        now_dt = datetime(2026, 10, 6, tzinfo=timezone.utc)
        selected_state = {"current": {"ARLU": {"source_as_of": "2026-06-29T23:06:46Z"}},
                          "recovery": {"UNAVAILABLE": {"last_transition": "unavailable"}}}
        with tempfile.TemporaryDirectory() as tmp, patch.object(self.fetcher, "OUT_DIR", Path(tmp)), \
             patch.object(self.fetcher, "latest_stockanalysis_etf_detail_observations", return_value={}), \
             patch.object(self.fetcher, "data_supply_store") as supply_store:
            self.fetcher.write_json(Path(tmp) / "etfs/ARLU.json", {
                "source": "stockanalysis", "source_as_of": "2026-09-30T14:53:36Z",
                "fetched_at": now_dt.isoformat(), "normalized": {"overview": {"aum": 1}},
            })
            options = dict(universe_payload={"records": [{"ticker": "ARLU"}]}, limit=40, max_age_hours=720,
                           pending_ledger={"entries": {}}, now_dt=now_dt, selected_etf_state=selected_state)
            manual = self.fetcher.incremental_etf_backfill_candidates(**options)
            self.assertEqual(manual["selected"], [])
            history_options = {**options, "required_history_periods": ("weekly_3y",), "history_gaps_only": True}
            history = self.fetcher.incremental_etf_backfill_candidates(**history_options)
            baseline = self.fetcher.incremental_etf_backfill_candidates(**{**history_options, "selected_etf_state": {}})
            self.assertEqual(history["selected"], baseline["selected"])
            self.assertEqual([row["ticker"] for row in history["selected"]], ["ARLU"])
            self.assertEqual(history["selected"][0]["reason"], "history_gap")
            self.assertNotIn("serving_source_as_of", history["selected"][0])
            supply_store.assert_not_called()

    def test_natural_pending_retries_do_not_starve_behind_stale_backlog(self) -> None:
        now_dt = datetime(2026, 10, 6, tzinfo=timezone.utc)
        stale = [f"OLD{i:03d}" for i in range(160)]
        retry = [f"RETRY{i:02d}" for i in range(20)]
        universe = {"records": [{"ticker": ticker} for ticker in (*stale, *retry)]}
        ledger = {"entries": {ticker: {
            "consecutive_failures": 3, "last_attempt_utc": "2026-09-28T00:00:00Z",
            "next_attempt_after_utc": "2026-10-05T00:00:00Z",
        } for ticker in retry}}
        attempted = set()
        with tempfile.TemporaryDirectory() as tmp, patch.object(self.fetcher, "OUT_DIR", Path(tmp)), \
             patch.object(self.fetcher, "latest_stockanalysis_etf_detail_observations", return_value={}):
            for ticker in stale:
                self.fetcher.write_json(Path(tmp) / "etfs" / f"{ticker}.json", {
                    "source": "stockanalysis", "asset_type": "etf", "ticker": ticker,
                    "source_as_of": "2026-06-01T00:00:00Z", "fetched_at": "2026-06-02T00:00:00Z",
                    "normalized": {"overview": {"aum": 1}},
                })
            self.fetcher.write_json(Path(tmp) / self.fetcher.PENDING_LEDGER_REL_PATH, ledger)
            for day in range(2):
                stamp = now_dt + timedelta(days=day)
                result = self.fetcher.incremental_etf_backfill_candidates(
                    universe, 40, 720, pending_ledger=ledger, now_dt=stamp, natural_general_priority=True,
                    selected_etf_state={})
                self.assertGreater(result["priority_selector"]["eligible_counts"]["oldest_stale"], 40)
                self.assertEqual(result["priority_selector"]["selected_counts"]["pending_retry"], 10)
                selected = result["selected"]
                self.assertEqual(len(selected), 40)
                self.assertEqual(len({row["ticker"] for row in selected}), 40)
                attempted.update(row["ticker"] for row in selected if row["ticker"] in retry)
                for row in selected:
                    if row["ticker"] in stale:
                        path = Path(tmp) / "etfs" / f"{row['ticker']}.json"
                        payload = self.fetcher.read_json(path)
                        payload.update({"source_as_of": stamp.isoformat(), "fetched_at": stamp.isoformat()})
                        self.fetcher.write_json(path, payload)
                outcomes = [{"ticker": row["ticker"], "asset_type": "etf", "provider": "stockanalysis",
                             "status": "error" if row["ticker"] in retry else "ok",
                             "error": "HTTP Error 500" if row["ticker"] in retry else None} for row in selected]
                ledger = self.fetcher.update_pending_ledger(outcomes, selected, 7, 3, False, now_dt=stamp)
            self.assertEqual(attempted, set(retry))

    def test_incremental_etf_backfill_retries_latest_invalid_primary_observation(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_state_root = self.fetcher.DATA_SUPPLY_STATE_ROOT
        try:
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                out_dir = root / "data" / "stockanalysis"
                state_root = root / "data" / "admin" / "data-supply-state" / "v1"
                self.fetcher.OUT_DIR = out_dir
                self.fetcher.DATA_SUPPLY_STATE_ROOT = state_root
                (out_dir / "surfaces").mkdir(parents=True)
                (out_dir / "etfs").mkdir(parents=True)
                (out_dir / "surfaces" / "new_etfs.json").write_text(
                    json.dumps({"records": [{"s": "TQQQ", "n": "ProShares UltraPro QQQ"}]}),
                    encoding="utf-8",
                )
                (out_dir / "etfs" / "TQQQ.json").write_text(
                    json.dumps(
                        {
                            "source": "stockanalysis",
                            "source_provider": "stockanalysis",
                            "detail_status": "stockanalysis",
                            "fetched_at": datetime.now(timezone.utc).isoformat(),
                        }
                    ),
                    encoding="utf-8",
                )
                history_root = state_root / "history" / "observations"
                history_root.mkdir(parents=True)
                (history_root / "2026-07-27.jsonl").write_text(
                    json.dumps(
                        {
                            "provider": "stockanalysis",
                            "domain": "etf_detail",
                            "entity": "TQQQ",
                            "observed_at": "2026-07-27T15:15:04Z",
                            "validation_status": "invalid",
                            "reason_code": "fetch_failed",
                        }
                    )
                    + "\n",
                    encoding="utf-8",
                )

                summary = self.fetcher.incremental_etf_backfill_candidates(
                    universe_payload={"records": []},
                    limit=10,
                    max_age_hours=720,
                    exclude=set(),
                )
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.DATA_SUPPLY_STATE_ROOT = original_state_root

        self.assertEqual(
            [(row["ticker"], row["reason"]) for row in summary["selected"]],
            [("TQQQ", "invalid")],
        )
        self.assertEqual(summary["counts"]["invalid"], 1)

    def test_incremental_etf_backfill_prioritizes_missing_universe_before_fallback_retry(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp) / "stockanalysis"
            self.fetcher.OUT_DIR = out_dir
            (out_dir / "surfaces").mkdir(parents=True)
            (out_dir / "etfs").mkdir(parents=True)
            (out_dir / "surfaces" / "new_etfs.json").write_text(
                json.dumps(
                    {
                        "records": [
                            {"s": "ADIU", "n": "Leverage Shares 2X Long ADI Daily ETF"},
                            {"s": "FNG", "n": "FNG ETF"},
                        ]
                    }
                ),
                encoding="utf-8",
            )
            (out_dir / "etfs" / "FNG.json").write_text(
                json.dumps(
                    {
                        "source": "yahoo_finance",
                        "source_provider": "yahoo_finance",
                        "detail_status": "yf_fallback",
                        "fetched_at": "2026-06-18T00:00:00Z",
                    }
                ),
                encoding="utf-8",
            )

            summary = self.fetcher.incremental_etf_backfill_candidates(
                universe_payload={"records": [{"ticker": "BETA"}]},
                limit=2,
                max_age_hours=720,
                exclude=set(),
            )
        self.fetcher.OUT_DIR = original_out_dir

        self.assertEqual([row["ticker"] for row in summary["selected"]], ["ADIU", "BETA"])
        self.assertEqual([row["reason"] for row in summary["selected"]], ["missing", "missing"])

    def test_incremental_etf_backfill_includes_screener_only_missing(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp) / "stockanalysis"
                self.fetcher.OUT_DIR = out_dir
                (out_dir / "surfaces").mkdir(parents=True)
                (out_dir / "etfs").mkdir(parents=True)
                (out_dir / "surfaces" / "etf_screener.json").write_text(
                    json.dumps({"records": [{"s": "AMJB", "n": "ALERIAN MLP INDEX ETNS"}]}),
                    encoding="utf-8",
                )

                summary = self.fetcher.incremental_etf_backfill_candidates(
                    universe_payload={"records": []},
                    limit=10,
                    max_age_hours=720,
                    exclude=set(),
                )
        finally:
            self.fetcher.OUT_DIR = original_out_dir

        self.assertEqual([row["ticker"] for row in summary["selected"]], ["AMJB"])
        self.assertEqual(summary["selected"][0]["source"], "etf_screener")
        self.assertEqual(summary["selected"][0]["reason"], "missing")
        self.assertEqual(summary["counts"]["missing"], 1)

    def test_incremental_etf_backfill_history_gaps_only_selects_existing_primary_gaps(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp) / "stockanalysis"
                self.fetcher.OUT_DIR = out_dir
                (out_dir / "surfaces").mkdir(parents=True)
                (out_dir / "etfs").mkdir(parents=True)
                (out_dir / "etfs" / "AAA.json").write_text(
                    json.dumps(
                        {
                            "source": "stockanalysis",
                            "asset_type": "etf",
                            "fetched_at": "2026-06-18T00:00:00Z",
                            "normalized": {
                                "overview": {
                                    "inception": "Jan 1, 2020",
                                },
                                "history_periods": {
                                    "monthly_1y": [{"t": "2026-06-01", "c": 100}],
                                    "monthly_3y": [],
                                }
                            },
                        }
                    ),
                    encoding="utf-8",
                )
                (out_dir / "etfs" / "BBB.json").write_text(
                    json.dumps(
                        {
                            "source": "stockanalysis",
                            "asset_type": "etf",
                            "fetched_at": "2026-06-18T00:00:00Z",
                            "normalized": {
                                "history_periods": {
                                    "monthly_3y": [{"t": "2026-06-01", "c": 100}],
                                    "monthly_5y": [{"t": "2026-06-01", "c": 90}],
                                }
                            },
                        }
                    ),
                    encoding="utf-8",
                )
                (out_dir / "etfs" / "RECENT.json").write_text(
                    json.dumps(
                        {
                            "source": "stockanalysis",
                            "asset_type": "etf",
                            "fetched_at": "2026-06-18T00:00:00Z",
                            "normalized": {
                                "overview": {
                                    "inception": "Jun 12, 2026",
                                },
                                "history_periods": {},
                            },
                        }
                    ),
                    encoding="utf-8",
                )
                (out_dir / "etfs" / "YF.json").write_text(
                    json.dumps(
                        {
                            "source": "yahoo_finance",
                            "source_provider": "yahoo_finance",
                            "detail_status": "yf_fallback",
                            "fetched_at": "2026-06-18T00:00:00Z",
                        }
                    ),
                    encoding="utf-8",
                )

                summary = self.fetcher.incremental_etf_backfill_candidates(
                    universe_payload={"records": [{"ticker": "AAA"}, {"ticker": "BBB"}, {"ticker": "CCC"}, {"ticker": "RECENT"}, {"ticker": "YF"}]},
                    limit=10,
                    max_age_hours=720,
                    exclude=set(),
                    now_dt=datetime(2026, 6, 18, tzinfo=timezone.utc),
                    required_history_periods=("monthly_3y", "monthly_5y"),
                    history_gaps_only=True,
                )
        finally:
            self.fetcher.OUT_DIR = original_out_dir

        self.assertEqual([row["ticker"] for row in summary["selected"]], ["AAA"])
        self.assertEqual(summary["selected"][0]["reason"], "history_gap")
        self.assertEqual(summary["selected"][0]["missing_history_periods"], ["monthly_3y", "monthly_5y"])
        self.assertEqual(summary["counts"]["history_gap"], 1)
        self.assertEqual(summary["counts"]["inception_limited_history_gap"], 1)
        self.assertEqual(summary["counts"]["total_history_gap"], 2)
        self.assertEqual([row["ticker"] for row in summary["inception_limited"]], ["RECENT"])
        self.assertEqual(summary["inception_limited"][0]["inception_date"], "2026-06-12")
        self.assertEqual(summary["inception_limited"][0]["inception_limited_history_periods"], ["monthly_3y", "monthly_5y"])
        self.assertEqual(summary["counts"]["missing"], 0)
        self.assertEqual(summary["counts"]["fallback_retry"], 0)

    def test_daily_1y_series_evidence_boundaries(self) -> None:
        rows_20 = weekday_rows("2026-06-22", 20)
        at_age_10 = datetime(2026, 7, 31, tzinfo=timezone.utc)
        at_age_11 = datetime(2026, 8, 3, tzinfo=timezone.utc)
        evidence = self.fetcher.daily_1y_series_evidence(rows_20, at_age_10)
        self.assertEqual(evidence["valid_unique_date_count"], 20)
        self.assertEqual(evidence["density"], 1.0)
        self.assertEqual(evidence["latest_business_day_age"], 10)
        self.assertTrue(evidence["eligible"])
        self.assertFalse(self.fetcher.daily_1y_series_evidence(rows_20, at_age_11)["gates"]["latest_business_day_age"])
        self.assertFalse(
            self.fetcher.daily_1y_series_evidence(rows_20[:19], at_age_10)["gates"]["min_rows"]
        )

        weekdays_25 = weekday_rows("2026-06-01", 25)
        exact_density = weekdays_25[:10] + weekdays_25[15:]
        below_density = exact_density[:-1]
        exact = self.fetcher.daily_1y_series_evidence(exact_density, datetime(2026, 7, 6, tzinfo=timezone.utc))
        below = self.fetcher.daily_1y_series_evidence(below_density, datetime(2026, 7, 6, tzinfo=timezone.utc))
        self.assertEqual(exact["density"], 0.8)
        self.assertTrue(exact["gates"]["density"])
        self.assertFalse(below["gates"]["density"])

        gap_15 = [{"t": "2026-06-01"}, {"t": "2026-06-16"}]
        gap_16 = [{"t": "2026-06-01"}, {"t": "2026-06-17"}]
        self.assertTrue(
            self.fetcher.daily_1y_series_evidence(gap_15, datetime(2026, 6, 17, tzinfo=timezone.utc))["gates"]["max_internal_gap"]
        )
        self.assertFalse(
            self.fetcher.daily_1y_series_evidence(gap_16, datetime(2026, 6, 17, tzinfo=timezone.utc))["gates"]["max_internal_gap"]
        )

    def test_daily_1y_history_classification_is_fail_closed_and_provenanced(self) -> None:
        now_dt = datetime(2026, 7, 12, tzinfo=timezone.utc)
        recent_rows = weekday_rows("2026-05-04", 45)

        def payload(rows: list[dict], inception: str | None = None) -> dict:
            overview = {"inception": inception} if inception else {}
            return {
                "source": "stockanalysis",
                "asset_type": "etf",
                "normalized": {
                    "overview": overview,
                    "history_periods": {"daily_1y": rows},
                },
            }

        unconfirmed = self.fetcher.history_gap_classification(
            payload(recent_rows),
            ("daily_1y",),
            now_dt,
        )
        self.assertEqual(unconfirmed["fetchable_missing_history_periods"], ["daily_1y"])
        self.assertEqual(unconfirmed["daily_1y_classification_reason"], "unconfirmed_short_history")
        self.assertIsNone(unconfirmed["effective_history_start_date"])
        pending_once = self.fetcher.history_gap_classification(
            payload(recent_rows),
            ("daily_1y",),
            now_dt,
            pending_entry={
                "stable_observation_count": 1,
                "short_history_evidence": {"earliest_date": "2026-05-04"},
            },
        )
        self.assertEqual(pending_once["fetchable_missing_history_periods"], ["daily_1y"])

        stable = self.fetcher.history_gap_classification(
            payload(recent_rows),
            ("daily_1y",),
            now_dt,
            pending_entry={
                "stable_observation_count": 2,
                "short_history_evidence": {"earliest_date": "2026-05-04"},
            },
        )
        self.assertEqual(stable["inception_limited_history_periods"], ["daily_1y"])
        self.assertEqual(stable["daily_1y_classification_reason"], "inception_limited_observation_derived")
        self.assertEqual(stable["effective_history_start_date"], "2026-05-04")
        self.assertEqual(stable["effective_history_start_source"], "daily_1y_stable_observation_start")
        self.assertIsNone(stable["declared_inception_date"])

        yf_confirmed = self.fetcher.history_gap_classification(
            payload(recent_rows),
            ("daily_1y",),
            now_dt,
            yf_rows=weekday_rows("2026-05-01", 41),
        )
        self.assertEqual(yf_confirmed["inception_limited_history_periods"], ["daily_1y"])
        self.assertEqual(yf_confirmed["effective_history_start_source"], "daily_1y_cross_provider_start")

        declared = self.fetcher.history_gap_classification(
            payload(recent_rows, "May 1, 2026"),
            ("daily_1y",),
            now_dt,
        )
        self.assertEqual(declared["inception_limited_history_periods"], ["daily_1y"])
        self.assertEqual(declared["daily_1y_classification_reason"], "inception_limited_declared")
        self.assertEqual(declared["declared_inception_date"], "2026-05-01")

        provider_limited = self.fetcher.history_gap_classification(
            payload(recent_rows, "Jan 1, 2020"),
            ("daily_1y",),
            now_dt,
            pending_entry={
                "stable_observation_count": 2,
                "short_history_evidence": {"earliest_date": "2026-05-04"},
            },
        )
        self.assertEqual(provider_limited["terminal_limited_history_periods"], ["daily_1y"])
        self.assertEqual(provider_limited["daily_1y_classification_reason"], "provider_history_start_limited")
        self.assertEqual(provider_limited["declared_inception_date"], "2020-01-01")
        self.assertEqual(provider_limited["effective_history_start_date"], "2026-05-04")

        yf_full = weekday_rows("2025-08-01", 200)
        truncated = self.fetcher.history_gap_classification(
            payload(recent_rows),
            ("daily_1y",),
            now_dt,
            yf_rows=yf_full,
            pending_entry={"stable_observation_count": 3},
        )
        self.assertTrue(truncated["provider_truncated_suspected"])
        self.assertEqual(truncated["fetchable_missing_history_periods"], ["daily_1y"])
        self.assertEqual(truncated["daily_1y_classification_reason"], "provider_truncated_suspected")

        sparse_rows = sampled_weekday_rows("2025-07-08", "2026-07-08", 190)
        sparse = self.fetcher.history_gap_classification(
            payload(sparse_rows, "May 19, 2023"),
            ("daily_1y",),
            now_dt,
            pending_entry={"stable_observation_count": 3},
        )
        self.assertEqual(sparse["fetchable_missing_history_periods"], ["daily_1y"])
        self.assertEqual(sparse["daily_1y_classification_reason"], "full_span_sparse_history")

        duplicate_200 = self.fetcher.history_gap_classification(
            payload([{"t": "2026-06-01"}] * 200),
            ("daily_1y",),
            now_dt,
        )
        self.assertEqual(duplicate_200["fetchable_missing_history_periods"], ["daily_1y"])
        self.assertEqual(duplicate_200["history_period_row_counts"]["daily_1y"], 1)

        mismatched_pending = self.fetcher.history_gap_classification(
            payload(recent_rows),
            ("daily_1y",),
            now_dt,
            pending_entry={
                "stable_observation_count": 2,
                "short_history_evidence": {"earliest_date": "2026-06-01"},
            },
        )
        self.assertEqual(mismatched_pending["fetchable_missing_history_periods"], ["daily_1y"])
        self.assertFalse(mismatched_pending["stable_observation_confirmed"])

        future_declared = self.fetcher.history_gap_classification(
            payload(recent_rows, "Aug 1, 2026"),
            ("daily_1y",),
            now_dt,
            yf_rows=weekday_rows("2026-05-01", 41),
        )
        self.assertEqual(future_declared["inception_limited_history_periods"], ["daily_1y"])
        self.assertTrue(future_declared["declared_inception_invalid_future"])
        self.assertFalse(future_declared["declared_inception_valid"])

        rolling_rows = weekday_rows("2026-06-03", 25)
        rolling = self.fetcher.history_gap_classification(
            payload(rolling_rows),
            ("daily_1y",),
            now_dt,
            pending_entry={
                "stable_observation_count": 2,
                "confirmed_history_start_date": "2026-05-04",
                "short_history_evidence": {"earliest_date": "2026-06-03"},
            },
        )
        self.assertEqual(rolling["inception_limited_history_periods"], ["daily_1y"])
        self.assertEqual(rolling["effective_history_start_date"], "2026-05-04")

        boundary_rows = weekday_rows("2026-06-01", 25)
        boundary_364 = self.fetcher.history_gap_classification(
            payload(boundary_rows),
            ("daily_1y",),
            now_dt,
            pending_entry={
                "stable_observation_count": 2,
                "confirmed_history_start_date": "2025-07-13",
            },
        )
        boundary_365 = self.fetcher.history_gap_classification(
            payload(boundary_rows),
            ("daily_1y",),
            now_dt,
            pending_entry={
                "stable_observation_count": 2,
                "confirmed_history_start_date": "2025-07-12",
            },
        )
        self.assertEqual(boundary_364["inception_limited_history_periods"], ["daily_1y"])
        self.assertEqual(boundary_365["fetchable_missing_history_periods"], ["daily_1y"])

    def test_incremental_etf_backfill_daily1y_uses_exact_fetchable_plan(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_inputs = self.fetcher.REPOSITORY_INPUTS
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp) / "stockanalysis"
                self.fetcher.OUT_DIR = out_dir
                (out_dir / "surfaces").mkdir(parents=True)
                (out_dir / "etfs").mkdir(parents=True)
                (out_dir.parent / "admin").mkdir(parents=True)
                (out_dir / "etfs" / "PLANSHORT.json").write_text(
                    json.dumps(
                        {
                            "source": "stockanalysis",
                            "asset_type": "etf",
                            "fetched_at": "2026-06-18T00:00:00Z",
                            "normalized": {
                                "history_periods": {
                                    "daily_1y": [{"t": "2026-06-01", "c": 100}],
                                },
                            },
                        }
                    ),
                    encoding="utf-8",
                )
                (out_dir / "etfs" / "OFFPLAN.json").write_text(
                    json.dumps(
                        {
                            "source": "stockanalysis",
                            "asset_type": "etf",
                            "fetched_at": "2026-06-18T00:00:00Z",
                            "normalized": {"history_periods": {"daily_1y": []}},
                        }
                    ),
                    encoding="utf-8",
                )
                (out_dir / "etfs" / "YF.json").write_text(
                    json.dumps(
                        {
                            "source": "yahoo_finance",
                            "source_provider": "yahoo_finance",
                            "detail_status": "yf_fallback",
                            "fetched_at": "2026-06-18T00:00:00Z",
                        }
                    ),
                    encoding="utf-8",
                )
                (out_dir.parent / "admin" / "fenok-edge-etf-daily1y-fetchable-plan.json").write_text(
                    json.dumps(
                        {
                            "schema_version": "fenok-edge-etf-daily1y-fetchable-plan/v0.1",
                            "tickers": ["PLANMISS", "PLANSHORT"],
                            "rows": [
                                {"ticker": "PLANMISS", "actual_rows": 0, "missing_file": True},
                                {
                                    "ticker": "PLANSHORT",
                                    "actual_rows": 1,
                                    "fetchable_missing": ["daily_1y"],
                                    "inception_limited_missing": [],
                                },
                            ],
                        }
                    ),
                    encoding="utf-8",
                )
                self.fetcher.REPOSITORY_INPUTS = self.fetcher.RepositoryInputs(
                    root=original_inputs.root,
                    scripts=original_inputs.scripts,
                    core_daily_basket=original_inputs.core_daily_basket,
                    daily_1y_fetchable_plan=out_dir.parent / "admin" / "fenok-edge-etf-daily1y-fetchable-plan.json",
                )
                summary = self.fetcher.incremental_etf_backfill_candidates(
                    universe_payload={
                        "records": [
                            {"ticker": "PLANMISS"},
                            {"ticker": "PLANSHORT"},
                            {"ticker": "OFFPLAN"},
                            {"ticker": "YF"},
                        ]
                    },
                    limit=10,
                    max_age_hours=720,
                    exclude=set(),
                    required_history_periods=("daily_1y",),
                    history_gaps_only=True,
                )
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.REPOSITORY_INPUTS = original_inputs

        self.assertEqual([row["ticker"] for row in summary["selected"]], ["PLANMISS", "PLANSHORT"])
        self.assertTrue(summary["selected"][0]["missing_file"])
        self.assertEqual(summary["selected"][1]["daily_1y_actual_rows"], 1)
        self.assertEqual(summary["selected"][1]["daily_1y_min_rows"], 200)
        self.assertEqual(summary["counts"]["selected"], 2)
        self.assertEqual(summary["counts"]["history_gap"], 2)
        self.assertEqual(summary["counts"]["daily_1y_missing_file"], 1)
        self.assertEqual(summary["counts"]["daily_1y_short_rows"], 1)
        self.assertEqual(summary["counts"]["missing"], 0)
        self.assertEqual(summary["counts"]["fallback_retry"], 0)

    def test_incremental_etf_backfill_daily1y_applies_offset_before_cooldown(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_inputs = self.fetcher.REPOSITORY_INPUTS
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp) / "stockanalysis"
                self.fetcher.OUT_DIR = out_dir
                (out_dir.parent / "admin").mkdir(parents=True)
                plan_rows = [
                    {"ticker": "PLAN001", "actual_rows": 1, "fetchable_missing": ["daily_1y"]},
                    {"ticker": "PLAN002", "actual_rows": 2, "fetchable_missing": ["daily_1y"]},
                    {"ticker": "PLAN003", "actual_rows": 3, "fetchable_missing": ["daily_1y"]},
                    {"ticker": "PLAN004", "actual_rows": 4, "fetchable_missing": ["daily_1y"]},
                ]
                (out_dir.parent / "admin" / "fenok-edge-etf-daily1y-fetchable-plan.json").write_text(
                    json.dumps(
                        {
                            "schema_version": "fenok-edge-etf-daily1y-fetchable-plan/v0.1",
                            "tickers": [row["ticker"] for row in plan_rows],
                            "rows": plan_rows,
                        }
                    ),
                    encoding="utf-8",
                )
                self.fetcher.REPOSITORY_INPUTS = self.fetcher.RepositoryInputs(
                    root=original_inputs.root,
                    scripts=original_inputs.scripts,
                    core_daily_basket=original_inputs.core_daily_basket,
                    daily_1y_fetchable_plan=out_dir.parent / "admin" / "fenok-edge-etf-daily1y-fetchable-plan.json",
                )
                (out_dir / "backfill").mkdir(parents=True)
                (out_dir / "backfill" / "pending_ledger.json").write_text(
                    json.dumps(
                        {
                            "entries": {
                                "PLAN001": {
                                    "ticker": "PLAN001",
                                    "consecutive_failures": 3,
                                    "next_attempt_after_utc": "2026-07-20T00:00:00Z",
                                    "failure_reason": "HTTP Error 404: Not Found",
                                }
                            }
                        }
                    ),
                    encoding="utf-8",
                )

                summary = self.fetcher.incremental_etf_backfill_candidates(
                    universe_payload={"records": []},
                    limit=2,
                    max_age_hours=720,
                    offset=2,
                    exclude=set(),
                    now_dt=self.fetcher.parse_iso_timestamp("2026-07-12T00:00:00Z"),
                    required_history_periods=("daily_1y",),
                    history_gaps_only=True,
                )
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.REPOSITORY_INPUTS = original_inputs

        self.assertEqual([row["ticker"] for row in summary["selected"]], ["PLAN003", "PLAN004"])
        self.assertEqual(summary["policy"]["offset"], 2)
        self.assertEqual(summary["counts"]["offset_skipped"], 2)
        self.assertEqual(summary["counts"]["scheduled_plan_rows"], 2)
        self.assertEqual(summary["counts"]["cooldown_skipped"], 0)
        self.assertEqual(summary["counts"]["selected"], 2)

    def test_incremental_etf_backfill_plan_payload_is_separate_from_run_proof(self) -> None:
        summary = {
            "counts": {
                "selected": 2,
                "candidates": 9,
                "history_gap": 9,
                "inception_limited_history_gap": 3,
                "total_history_gap": 12,
                "cooldown_skipped": 1,
            },
            "selected": [
                {"ticker": "AAA", "reason": "history_gap"},
                {"ticker": "BBB", "reason": "history_gap"},
            ],
        }

        payload = self.fetcher.build_incremental_etf_backfill_plan(
            ["AAA", "BBB"],
            summary,
            ("monthly_3y", "monthly_5y"),
            history_gaps_only=True,
        )

        self.assertEqual(payload["operation"], "incremental_etf_backfill_plan")
        self.assertEqual(payload["mode"], "history_gaps_only")
        self.assertEqual(payload["required_history_periods"], ["monthly_3y", "monthly_5y"])
        self.assertEqual(payload["counts"]["etfs_planned"], 2)
        self.assertEqual(payload["counts"]["incremental_selected"], 2)
        self.assertEqual(payload["counts"]["incremental_candidates"], 9)
        self.assertEqual(payload["counts"]["history_gap"], 9)
        self.assertEqual(payload["counts"]["inception_limited_history_gap"], 3)
        self.assertEqual(payload["counts"]["total_history_gap"], 12)
        self.assertEqual(payload["policy"]["network"], "none")
        self.assertIn("incremental_latest.json", payload["policy"]["execution_proof"])

    def test_write_incremental_plan_mirrors_without_latest_run_artifact(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_public_dir = self.fetcher.PUBLIC_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp:
                tmp_path = Path(tmp)
                self.fetcher.OUT_DIR = tmp_path / "stockanalysis"
                self.fetcher.PUBLIC_DIR = tmp_path / "public" / "stockanalysis"
                payload = self.fetcher.build_incremental_etf_backfill_plan(
                    ["AAA"],
                    {"counts": {"selected": 1, "candidates": 1, "history_gap": 1, "cooldown_skipped": 0}, "selected": []},
                    ("monthly_3y", "monthly_5y"),
                    history_gaps_only=True,
                )

                self.fetcher.write_payload(self.fetcher.INCREMENTAL_PLAN_REL_PATH, payload, mirror_public=True)

                source_path = self.fetcher.OUT_DIR / "backfill" / "incremental_plan_latest.json"
                public_path = self.fetcher.PUBLIC_DIR / "backfill" / "incremental_plan_latest.json"
                self.assertTrue(source_path.exists())
                self.assertTrue(public_path.exists())
                self.assertFalse((self.fetcher.OUT_DIR / "backfill" / "incremental_latest.json").exists())
                self.assertEqual(json.loads(source_path.read_text(encoding="utf-8")), json.loads(public_path.read_text(encoding="utf-8")))
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.PUBLIC_DIR = original_public_dir

    def test_non_daily_profile_cannot_overwrite_canonical_incremental_plan(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_public_dir = self.fetcher.PUBLIC_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp:
                tmp_path = Path(tmp)
                self.fetcher.OUT_DIR = tmp_path / "stockanalysis"
                self.fetcher.PUBLIC_DIR = tmp_path / "public" / "stockanalysis"
                canonical = {
                    "generated_at": "canonical-plan",
                    "required_history_periods": ["daily_1y"],
                    "etfs": ["AAA"],
                }
                candidate = {
                    "generated_at": "non-default-plan",
                    "required_history_periods": ["monthly_3y", "monthly_5y"],
                    "etfs": ["BBB"],
                }
                self.fetcher.write_payload(self.fetcher.INCREMENTAL_PLAN_REL_PATH, canonical, mirror_public=True)

                wrote = self.fetcher.write_canonical_incremental_plan(
                    candidate,
                    ("monthly_3y", "monthly_5y"),
                    history_gaps_only=True,
                    mirror_public=True,
                )

                source_path = self.fetcher.OUT_DIR / self.fetcher.INCREMENTAL_PLAN_REL_PATH
                public_path = self.fetcher.PUBLIC_DIR / self.fetcher.INCREMENTAL_PLAN_REL_PATH
                self.assertFalse(wrote)
                self.assertEqual(json.loads(source_path.read_text(encoding="utf-8")), canonical)
                self.assertEqual(json.loads(public_path.read_text(encoding="utf-8")), canonical)

                next_canonical = {
                    "generated_at": "next-canonical-plan",
                    "required_history_periods": ["daily_1y"],
                    "etfs": ["CCC"],
                }
                wrote = self.fetcher.write_canonical_incremental_plan(
                    next_canonical,
                    ("daily_1y",),
                    history_gaps_only=True,
                    mirror_public=True,
                )
                self.assertTrue(wrote)
                self.assertEqual(json.loads(source_path.read_text(encoding="utf-8")), next_canonical)
                self.assertEqual(json.loads(public_path.read_text(encoding="utf-8")), next_canonical)
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.PUBLIC_DIR = original_public_dir

    def test_incremental_etf_backfill_skips_pending_ledger_cooldown(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp) / "stockanalysis"
                self.fetcher.OUT_DIR = out_dir
                (out_dir / "surfaces").mkdir(parents=True)
                (out_dir / "etfs").mkdir(parents=True)
                (out_dir / "backfill").mkdir(parents=True)
                (out_dir / "backfill" / "pending_ledger.json").write_text(
                    json.dumps(
                        {
                            "entries": {
                                "BETA": {
                                    "ticker": "BETA",
                                    "last_attempt_utc": "2026-06-18T00:00:00Z",
                                    "failure_reason": "HTTPError: HTTP Error 404: Not Found",
                                    "consecutive_failures": 3,
                                    "next_attempt_after_utc": "2026-06-25T00:00:00Z",
                                }
                            }
                        }
                    ),
                    encoding="utf-8",
                )

                summary = self.fetcher.incremental_etf_backfill_candidates(
                    universe_payload={"records": [{"ticker": "BETA"}, {"ticker": "GAMMA"}]},
                    limit=10,
                    max_age_hours=720,
                    exclude=set(),
                    now_dt=self.fetcher.parse_iso_timestamp("2026-06-18T12:00:00Z"),
                )
        finally:
            self.fetcher.OUT_DIR = original_out_dir

        self.assertEqual([row["ticker"] for row in summary["selected"]], ["GAMMA"])
        self.assertEqual(summary["counts"]["cooldown_skipped"], 1)
        self.assertEqual(summary["cooldown"][0]["ticker"], "BETA")

    def test_incremental_etf_backfill_allows_expired_pending_ledger(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp) / "stockanalysis"
                self.fetcher.OUT_DIR = out_dir
                (out_dir / "surfaces").mkdir(parents=True)
                (out_dir / "etfs").mkdir(parents=True)
                (out_dir / "backfill").mkdir(parents=True)
                (out_dir / "backfill" / "pending_ledger.json").write_text(
                    json.dumps(
                        {
                            "entries": {
                                "BETA": {
                                    "ticker": "BETA",
                                    "last_attempt_utc": "2026-06-01T00:00:00Z",
                                    "failure_reason": "HTTPError: HTTP Error 404: Not Found",
                                    "consecutive_failures": 3,
                                    "next_attempt_after_utc": "2026-06-08T00:00:00Z",
                                }
                            }
                        }
                    ),
                    encoding="utf-8",
                )

                summary = self.fetcher.incremental_etf_backfill_candidates(
                    universe_payload={"records": [{"ticker": "BETA"}]},
                    limit=10,
                    max_age_hours=720,
                    exclude=set(),
                    now_dt=self.fetcher.parse_iso_timestamp("2026-06-18T12:00:00Z"),
                )
        finally:
            self.fetcher.OUT_DIR = original_out_dir

        self.assertEqual([row["ticker"] for row in summary["selected"]], ["BETA"])
        self.assertEqual(summary["counts"]["cooldown_skipped"], 0)

    def test_etf_detail_coverage_uses_union_candidate_universe(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp) / "stockanalysis"
                self.fetcher.OUT_DIR = out_dir
                (out_dir / "surfaces").mkdir(parents=True)
                (out_dir / "etfs").mkdir(parents=True)
                (out_dir / "backfill").mkdir(parents=True)
                (out_dir / "etf_universe.json").write_text(
                    json.dumps({"records": [{"ticker": "AAA"}, {"ticker": "BBB"}]}),
                    encoding="utf-8",
                )
                (out_dir / "surfaces" / "etf_screener.json").write_text(
                    json.dumps({"records": [{"s": "BBB"}, {"s": "CCC"}]}),
                    encoding="utf-8",
                )
                (out_dir / "surfaces" / "new_etfs.json").write_text(
                    json.dumps({"records": [{"s": "DDD"}]}),
                    encoding="utf-8",
                )
                (out_dir / "backfill" / "pending_ledger.json").write_text(
                    json.dumps(
                        {
                            "entries": {
                                "DDD": {
                                    "ticker": "DDD",
                                    "consecutive_failures": 3,
                                    "next_attempt_after_utc": "2099-01-01T00:00:00Z",
                                    "failure_reason": "ValueError: Yahoo fallback quoteType is not ETF/MUTUALFUND: EQUITY",
                                }
                            }
                        }
                    ),
                    encoding="utf-8",
                )
                (out_dir / "etfs" / "AAA.json").write_text(
                    json.dumps({
                        "source": "stockanalysis", "asset_type": "etf",
                        "source_as_of": "2026-09-26", "fetched_at": "2026-09-27T01:00:00Z",
                    }),
                    encoding="utf-8",
                )
                (out_dir / "etfs" / "CCC.json").write_text(
                    json.dumps({
                        "source": "yahoo_finance", "detail_status": "yf_fallback",
                        "source_as_of": None, "fetched_at": "2026-09-27T02:00:00Z",
                    }),
                    encoding="utf-8",
                )

                coverage = self.fetcher.build_etf_detail_coverage()
        finally:
            self.fetcher.OUT_DIR = original_out_dir

        self.assertEqual(coverage["counts"]["candidate_total"], 4)
        self.assertEqual(coverage["counts"]["covered_detail_files"], 2)
        self.assertEqual(coverage["counts"]["missing_detail_files"], 2)
        self.assertEqual(coverage["counts"]["source_breakdown"]["etf_universe"], 2)
        self.assertEqual(coverage["counts"]["source_breakdown"]["etf_screener"], 2)
        self.assertEqual(coverage["counts"]["source_breakdown"]["new_etfs"], 1)
        self.assertEqual(coverage["counts"]["yahoo_fallback_files"], 1)
        self.assertEqual(coverage["counts"]["pending_tracked_missing"], 1)
        self.assertEqual(coverage["missing_reason_summary"], {"external_quote_type_mismatch": 1, "untracked": 1})
        self.assertEqual(coverage["missing_status_summary"], {"retry_cooldown": 1, "untracked": 1})
        self.assertEqual(coverage["missing_reason_samples"]["external_quote_type_mismatch"], ["DDD"])
        self.assertEqual(coverage["missing_reason_samples"]["untracked"], ["BBB"])
        self.assertEqual(coverage["missing_tickers"], ["BBB", "DDD"])
        self.assertEqual(coverage["source_date_summary"], {
            "total_members": 4,
            "newest_source_date": "2026-09-27",
            "oldest_source_date": "2026-09-26",
            "oldest_source_member": "AAA",
            "source_date_histogram": [
                {"date": None, "basis": None, "count": 2},
                {"date": "2026-09-26", "basis": "source", "count": 1},
                {"date": "2026-09-27", "basis": "collected", "count": 1},
            ],
        })

    def test_incremental_etf_backfill_prioritizes_unattempted_missing_before_prior_failures(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp) / "stockanalysis"
                self.fetcher.OUT_DIR = out_dir
                (out_dir / "surfaces").mkdir(parents=True)
                (out_dir / "etfs").mkdir(parents=True)
                (out_dir / "backfill").mkdir(parents=True)
                (out_dir / "backfill" / "pending_ledger.json").write_text(
                    json.dumps(
                        {
                            "entries": {
                                "ADIU": {
                                    "ticker": "ADIU",
                                    "last_attempt_utc": "2026-06-18T00:00:00Z",
                                    "failure_reason": "HTTPError: HTTP Error 404: Not Found",
                                    "consecutive_failures": 1,
                                }
                            }
                        }
                    ),
                    encoding="utf-8",
                )
                (out_dir / "surfaces" / "new_etfs.json").write_text(
                    json.dumps({"records": [{"s": "ADIU"}, {"s": "BETA"}]}),
                    encoding="utf-8",
                )

                summary = self.fetcher.incremental_etf_backfill_candidates(
                    universe_payload={"records": [{"ticker": "GAMMA"}]},
                    limit=3,
                    max_age_hours=720,
                    exclude=set(),
                    now_dt=self.fetcher.parse_iso_timestamp("2026-06-18T12:00:00Z"),
                )
        finally:
            self.fetcher.OUT_DIR = original_out_dir

        self.assertEqual([row["ticker"] for row in summary["selected"]], ["BETA", "GAMMA", "ADIU"])
        self.assertEqual([row["prior_failures"] for row in summary["selected"]], [0, 0, 1])
        self.assertEqual(summary["counts"]["prior_failed_candidates"], 1)

    def test_pending_ledger_updates_expected_missing_and_clears_on_success(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_public_dir = self.fetcher.PUBLIC_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp) / "stockanalysis"
                public_dir = Path(tmp) / "public" / "stockanalysis"
                self.fetcher.OUT_DIR = out_dir
                self.fetcher.PUBLIC_DIR = public_dir
                selected = [{"ticker": "BETA"}]
                first = self.fetcher.update_pending_ledger(
                    results=[
                        {
                            "ticker": "BETA",
                            "asset_type": "etf",
                            "status": "error",
                            "provider": "yahoo_finance",
                            "error": "HTTPError: HTTP Error 404: Not Found",
                            "fallback_error": "RuntimeError: Yahoo fallback returned no data",
                        }
                    ],
                    selected_rows=selected,
                    cooldown_days=7,
                    failure_threshold=1,
                    mirror_public=False,
                )
                self.assertEqual(first["counts"]["tracked"], 1)
                self.assertEqual(first["counts"]["cooldown"], 1)
                self.assertEqual(first["entries"]["BETA"]["consecutive_failures"], 1)

                second = self.fetcher.update_pending_ledger(
                    results=[
                        {
                            "ticker": "BETA",
                            "asset_type": "etf",
                            "status": "ok",
                            "provider": "stockanalysis",
                            "error": None,
                        }
                    ],
                    selected_rows=selected,
                    cooldown_days=7,
                    failure_threshold=1,
                    mirror_public=False,
                )
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.PUBLIC_DIR = original_public_dir

        self.assertEqual(second["counts"]["tracked"], 0)
        self.assertEqual(second["cleared"], ["BETA"])

    def test_provider_absence_is_degraded_coverage_state_not_fetch_failure(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_public_dir = self.fetcher.PUBLIC_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp) / "stockanalysis"
                self.fetcher.OUT_DIR = out_dir
                self.fetcher.PUBLIC_DIR = Path(tmp) / "public" / "stockanalysis"
                (out_dir / "surfaces").mkdir(parents=True)
                (out_dir / "backfill").mkdir(parents=True)
                (out_dir / "etf_universe.json").write_text(
                    json.dumps({"records": [{"ticker": "ABSENT"}]}),
                    encoding="utf-8",
                )
                ledger = self.fetcher.update_pending_ledger(
                    results=[{
                        "ticker": "ABSENT",
                        "asset_type": "etf",
                        "status": "provider_coverage_gap",
                        "provider": "stockanalysis",
                        "provider_availability_status": "absent",
                        "provider_availability_reason": "provider_coverage_gap",
                        "provider_response": "HTTP 404",
                        "stockanalysis_error": "HTTPError: HTTP Error 404: Not Found",
                        "error": None,
                    }],
                    selected_rows=[{"ticker": "ABSENT"}],
                    cooldown_days=7,
                    failure_threshold=1,
                    mirror_public=False,
                    now_dt=self.fetcher.parse_iso_timestamp("2026-07-14T00:00:00Z"),
                )
                coverage = self.fetcher.build_etf_detail_coverage()
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.PUBLIC_DIR = original_public_dir

        entry = ledger["entries"]["ABSENT"]
        self.assertEqual(entry["availability_status"], "provider_absent")
        self.assertEqual(entry["availability_reason"], "provider_coverage_gap")
        self.assertEqual(entry["provider_response"], "HTTP 404")
        self.assertEqual(entry["consecutive_failures"], 0)
        self.assertEqual(ledger["counts"]["provider_coverage_gaps"], 1)
        self.assertEqual(coverage["missing_reason_summary"], {"provider_coverage_gap": 1})
        self.assertEqual(coverage["missing_availability_summary"], {"provider_absent": 1})
        self.assertEqual(coverage["provider_absent_tickers"], ["ABSENT"])

    def test_missing_detail_reconcile_summary_counts_every_selected_response(self) -> None:
        summary = self.fetcher.build_missing_detail_reconcile_summary(
            initial_missing=["FETCH", "ABSENT", "BROKEN"],
            selected=["FETCH", "ABSENT", "BROKEN"],
            results=[
                {
                    "ticker": "FETCH",
                    "asset_type": "etf",
                    "status": "ok",
                    "provider": "stockanalysis",
                    "path": "etfs/FETCH.json",
                    "provider_availability_status": "available",
                    "provider_availability_reason": "provider_detail_contract_valid",
                    "provider_response": "HTTP 200 contract valid",
                    "error": None,
                },
                {
                    "ticker": "ABSENT",
                    "asset_type": "etf",
                    "status": "provider_coverage_gap",
                    "provider": "stockanalysis",
                    "path": None,
                    "provider_availability_status": "absent",
                    "provider_availability_reason": "provider_coverage_gap",
                    "provider_response": "HTTP 404",
                    "error": None,
                },
                {
                    "ticker": "BROKEN",
                    "asset_type": "etf",
                    "status": "error",
                    "provider": None,
                    "path": None,
                    "provider_availability_status": None,
                    "error": "HTTP Error 500",
                },
            ],
            coverage={"counts": {"missing_detail_files": 2}},
        )

        self.assertEqual(summary["counts"]["initial_missing"], 3)
        self.assertEqual(summary["counts"]["selected"], 3)
        self.assertEqual(summary["counts"]["fetchable_fetched"], 1)
        self.assertEqual(summary["counts"]["provider_absent"], 1)
        self.assertEqual(summary["counts"]["unresolved"], 1)
        self.assertEqual(summary["counts"]["remaining_missing"], 2)
        self.assertEqual(summary["provider_absent_tickers"], ["ABSENT"])
        self.assertEqual(summary["unresolved_tickers"], ["BROKEN"])
        self.assertEqual(summary["exit_assessment"]["status"], "degraded")
        self.assertNotIn("fail the run", summary["method"])

    def test_reconcile_mode_commits_partial_success_and_names_unresolved(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_public_dir = self.fetcher.PUBLIC_DIR
        original_state_root = self.fetcher.DATA_SUPPLY_STATE_ROOT
        original_recovery_root = self.fetcher.STOCKANALYSIS_RECOVERY_ROOT
        original_run_one = self.fetcher.run_one
        original_argv = sys.argv
        original_stdout = sys.stdout
        try:
            with tempfile.TemporaryDirectory() as tmp:
                temp_root = Path(tmp)
                out_dir = temp_root / "data" / "stockanalysis"
                self.fetcher.OUT_DIR = out_dir
                self.fetcher.PUBLIC_DIR = temp_root / "public" / "stockanalysis"
                self.fetcher.DATA_SUPPLY_STATE_ROOT = temp_root / "data" / "admin" / "data-supply-state" / "v1"
                self.fetcher.STOCKANALYSIS_RECOVERY_ROOT = (
                    temp_root / "data" / "admin" / "stockanalysis-recovery"
                )
                (out_dir / "etf_universe.json").parent.mkdir(parents=True)
                (out_dir / "etf_universe.json").write_text(
                    json.dumps({
                        "records": [
                            {"ticker": "FETCH"},
                            {"ticker": "ABSENT"},
                            {"ticker": "BROKEN"},
                        ]
                    }),
                    encoding="utf-8",
                )

                def fake_run_one(kind: str, ticker: str, *_args, **kwargs) -> dict:
                    self.assertEqual(kind, "etf")
                    self.assertFalse(kwargs["include_etf_history"])
                    self.assertFalse(kwargs["yf_fallback"])
                    if ticker == "FETCH":
                        detail_path = out_dir / "etfs" / "FETCH.json"
                        detail_path.parent.mkdir(parents=True, exist_ok=True)
                        detail_path.write_text(
                            json.dumps({"source": "stockanalysis", "asset_type": "etf", "ticker": ticker}),
                            encoding="utf-8",
                        )
                        return {
                            "ticker": ticker,
                            "asset_type": "etf",
                            "status": "ok",
                            "provider": "stockanalysis",
                            "path": "etfs/FETCH.json",
                            "provider_availability_status": "available",
                            "provider_availability_reason": "provider_detail_contract_valid",
                            "provider_response": "HTTP 200 contract valid",
                            "latency_ms": 1,
                            "error": None,
                        }
                    if ticker == "ABSENT":
                        return {
                            "ticker": ticker,
                            "asset_type": "etf",
                            "status": "provider_coverage_gap",
                            "provider": "stockanalysis",
                            "path": None,
                            "stockanalysis_error": "HTTPError: HTTP Error 404: Not Found",
                            "provider_availability_status": "absent",
                            "provider_availability_reason": "provider_coverage_gap",
                            "provider_response": "HTTP 404",
                            "latency_ms": 1,
                            "error": None,
                        }
                    return {
                        "ticker": ticker,
                        "asset_type": "etf",
                        "status": "error",
                        "provider": None,
                        "path": None,
                        "latency_ms": 1,
                        "error": "TimeoutError: transient timeout",
                    }

                self.fetcher.run_one = fake_run_one
                sys.argv = [
                    "fetch-stockanalysis.py",
                    "--reconcile-missing-etf-details",
                    "--etfs",
                    "FETCH,ABSENT,BROKEN",
                    "--incremental-etf-limit",
                    "0",
                    "--sleep",
                    "0",
                    "--no-public-mirror",
                ]
                sys.stdout = io.StringIO()
                self.fetcher.main()
                output = sys.stdout.getvalue()
                reconcile = json.loads(
                    (out_dir / self.fetcher.MISSING_DETAIL_RECONCILE_REL_PATH).read_text()
                )
                coverage = json.loads((out_dir / "coverage" / "etf_detail.json").read_text())
                index = json.loads((out_dir / "index.json").read_text())
                fetched_detail = json.loads((out_dir / "etfs" / "FETCH.json").read_text())
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.PUBLIC_DIR = original_public_dir
            self.fetcher.DATA_SUPPLY_STATE_ROOT = original_state_root
            self.fetcher.STOCKANALYSIS_RECOVERY_ROOT = original_recovery_root
            self.fetcher.run_one = original_run_one
            sys.argv = original_argv
            sys.stdout = original_stdout

        self.assertEqual(reconcile["counts"]["initial_missing"], 3)
        self.assertEqual(reconcile["counts"]["fetchable_fetched"], 1)
        self.assertEqual(reconcile["counts"]["provider_absent"], 1)
        self.assertEqual(reconcile["counts"]["unresolved"], 1)
        self.assertEqual(reconcile["counts"]["remaining_missing"], 2)
        self.assertEqual(reconcile["selected_tickers"], ["FETCH", "ABSENT", "BROKEN"])
        self.assertEqual(reconcile["unresolved_tickers"], ["BROKEN"])
        self.assertEqual(reconcile["exit_assessment"]["status"], "degraded")
        self.assertEqual(reconcile["exit_assessment"]["exit_code"], 0)
        self.assertIn("[degraded] StockAnalysis ETF detail reconcile deferred: BROKEN", output)
        self.assertEqual(fetched_detail["ticker"], "FETCH")
        self.assertEqual(coverage["provider_absent_tickers"], ["ABSENT"])
        self.assertEqual(index["counts"]["etfs_requested"], 3)
        self.assertEqual(index["counts"]["ok"], 2)
        self.assertEqual(index["counts"]["failed"], 1)
        self.assertEqual(index["counts"]["hard_failed"], 1)

    def test_reconcile_workflow_forwards_explicit_etf_targets(self) -> None:
        workflow = (ROOT / ".github" / "workflows" / "fetch-stockanalysis.yml").read_text(
            encoding="utf-8"
        )
        reconcile_start = workflow.index(
            'if [ "${INPUT_RECONCILE_MISSING_ETF_DETAILS:-false}" = "true" ]; then'
        )
        history_plan_start = workflow.index(
            'elif [ "${INPUT_HISTORY_GAP_PLAN:-false}" = "true" ]; then',
            reconcile_start,
        )
        reconcile_block = workflow[reconcile_start:history_plan_start]
        self.assertIn(
            'if [ -n "$INPUT_ETFS" ]; then ARGS="$ARGS --etfs $INPUT_ETFS"; fi',
            reconcile_block,
        )

    def test_reconcile_exit_assessment_rejects_true_corruption(self) -> None:
        summary = self.fetcher.build_missing_detail_reconcile_summary(
            initial_missing=["AUTH1", "AUTH2"],
            selected=["AUTH1", "AUTH2"],
            results=[
                {
                    "ticker": ticker,
                    "asset_type": "etf",
                    "status": "error",
                    "provider": None,
                    "path": None,
                    "provider_availability_status": None,
                    "error": "HTTP Error 401: Unauthorized",
                }
                for ticker in ("AUTH1", "AUTH2")
            ],
            coverage={"counts": {"missing_detail_files": 2}},
        )

        self.assertEqual(summary["exit_assessment"]["status"], "corrupt")
        self.assertEqual(summary["exit_assessment"]["exit_code"], 2)
        self.assertIn("no selected ticker resolved", summary["exit_assessment"]["reasons"])
        self.assertTrue(
            any("authentication" in reason for reason in summary["exit_assessment"]["reasons"])
        )

    def test_reconcile_exit_assessment_rejects_systemic_and_regressive_batches(self) -> None:
        cases = (
            ("rate_limit", "HTTP Error 429: Too Many Requests", "429 storm"),
            ("decode", "JSONDecodeError: invalid JSON", "decode collapse"),
        )
        for label, error, expected_reason in cases:
            with self.subTest(label=label):
                summary = self.fetcher.build_missing_detail_reconcile_summary(
                    initial_missing=["FETCH", "FAIL1", "FAIL2"],
                    selected=["FETCH", "FAIL1", "FAIL2"],
                    results=[
                        {
                            "ticker": "FETCH",
                            "asset_type": "etf",
                            "status": "ok",
                            "provider": "stockanalysis",
                            "path": "etfs/FETCH.json",
                            "provider_availability_status": "available",
                            "error": None,
                        },
                        *(
                            {
                                "ticker": ticker,
                                "asset_type": "etf",
                                "status": "error",
                                "provider": None,
                                "path": None,
                                "provider_availability_status": None,
                                "error": error,
                            }
                            for ticker in ("FAIL1", "FAIL2")
                        ),
                    ],
                    coverage={"counts": {"missing_detail_files": 2}},
                )
                self.assertEqual(summary["exit_assessment"]["status"], "corrupt")
                self.assertEqual(summary["exit_assessment"]["exit_code"], 2)
                self.assertTrue(
                    any(
                        expected_reason in reason
                        for reason in summary["exit_assessment"]["reasons"]
                    )
                )

        regressed = self.fetcher.build_missing_detail_reconcile_summary(
            initial_missing=["FETCH", "BROKEN"],
            selected=["FETCH", "BROKEN"],
            results=[
                {
                    "ticker": "FETCH",
                    "asset_type": "etf",
                    "status": "ok",
                    "provider": "stockanalysis",
                    "path": "etfs/FETCH.json",
                    "provider_availability_status": "available",
                    "error": None,
                },
                {
                    "ticker": "BROKEN",
                    "asset_type": "etf",
                    "status": "error",
                    "provider": None,
                    "path": None,
                    "provider_availability_status": None,
                    "error": "TimeoutError: transient timeout",
                },
            ],
            coverage={"counts": {"missing_detail_files": 3}},
        )
        self.assertEqual(regressed["exit_assessment"]["status"], "corrupt")
        self.assertIn(
            "canonical detail coverage regressed during reconcile",
            regressed["exit_assessment"]["reasons"],
        )

    def test_successful_short_primary_cools_stably_then_complete_success_clears(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_public_dir = self.fetcher.PUBLIC_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp) / "stockanalysis"
                self.fetcher.OUT_DIR = out_dir
                self.fetcher.PUBLIC_DIR = Path(tmp) / "public" / "stockanalysis"
                (out_dir / "etfs").mkdir(parents=True)
                pre_rows = weekday_rows("2026-05-29", 30)
                post_rows = weekday_rows("2026-05-29", 31)
                first_now = self.fetcher.parse_iso_timestamp("2026-07-11T02:00:00Z")
                selected = [{
                    "ticker": "SHORT",
                    "missing_history_periods": ["daily_1y"],
                    "fetchable_missing_history_periods": ["daily_1y"],
                    "daily_1y_min_rows": 200,
                    "pre_fetch_daily_1y_evidence": self.fetcher.daily_1y_series_evidence(pre_rows, first_now),
                    "pre_fetch_payload_fetched_at": "2026-07-10T00:00:00Z",
                }]
                (out_dir / "etfs" / "SHORT.json").write_text(
                    json.dumps({
                        "source": "stockanalysis",
                        "asset_type": "etf",
                        "fetched_at": "2026-07-11T01:00:00Z",
                        "normalized": {"history_periods": {"daily_1y": post_rows}},
                    }),
                    encoding="utf-8",
                )
                first = self.fetcher.update_pending_ledger(
                    results=[{
                        "ticker": "SHORT",
                        "asset_type": "etf",
                        "status": "ok",
                        "provider": "stockanalysis",
                        "error": None,
                    }],
                    selected_rows=selected,
                    cooldown_days=7,
                    failure_threshold=99,
                    mirror_public=False,
                    now_dt=first_now,
                )
                first_entry = first["entries"]["SHORT"]
                self.assertEqual(first_entry["failure_class"], "successful_short_history")
                self.assertEqual(first_entry["consecutive_failures"], 0)
                self.assertEqual(first_entry["stable_observation_count"], 2)
                self.assertTrue(
                    self.fetcher.pending_entry_in_cooldown(
                        first_entry,
                        first_now + timedelta(days=1),
                        cooldown_days=7,
                        failure_threshold=0,
                    )
                )

                within_24h_rows = post_rows
                within_24h_now = self.fetcher.parse_iso_timestamp("2026-07-11T13:00:00Z")
                (out_dir / "etfs" / "SHORT.json").write_text(
                    json.dumps({
                        "source": "stockanalysis",
                        "asset_type": "etf",
                        "fetched_at": "2026-07-11T12:00:00Z",
                        "normalized": {"history_periods": {"daily_1y": within_24h_rows}},
                    }),
                    encoding="utf-8",
                )
                second = self.fetcher.update_pending_ledger(
                    results=[{
                        "ticker": "SHORT",
                        "asset_type": "etf",
                        "status": "ok",
                        "provider": "stockanalysis",
                        "error": None,
                    }],
                    selected_rows=[{
                        "ticker": "SHORT",
                        "missing_history_periods": ["daily_1y"],
                        "pre_fetch_daily_1y_evidence": first_entry["short_history_evidence"],
                        "pre_fetch_payload_fetched_at": "2026-07-11T01:00:00Z",
                    }],
                    cooldown_days=7,
                    failure_threshold=99,
                    mirror_public=False,
                    now_dt=within_24h_now,
                )
                self.assertEqual(second["entries"]["SHORT"]["stable_observation_count"], 2)

                complete_rows = weekday_rows("2025-09-01", 200)
                (out_dir / "etfs" / "SHORT.json").write_text(
                    json.dumps({
                        "source": "stockanalysis",
                        "asset_type": "etf",
                        "fetched_at": "2026-07-12T14:00:00Z",
                        "normalized": {"history_periods": {"daily_1y": complete_rows}},
                    }),
                    encoding="utf-8",
                )
                third = self.fetcher.update_pending_ledger(
                    results=[{
                        "ticker": "SHORT",
                        "asset_type": "etf",
                        "status": "ok",
                        "provider": "stockanalysis",
                        "error": None,
                    }],
                    selected_rows=[{
                        "ticker": "SHORT",
                        "missing_history_periods": ["daily_1y"],
                    }],
                    cooldown_days=7,
                    failure_threshold=99,
                    mirror_public=False,
                    now_dt=self.fetcher.parse_iso_timestamp("2026-07-12T15:00:00Z"),
                )
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.PUBLIC_DIR = original_public_dir

        self.assertEqual(third["counts"]["tracked"], 0)
        self.assertEqual(third["cleared"], ["SHORT"])

    def test_ineligible_successful_short_series_keep_48h_retry_path(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_public_dir = self.fetcher.PUBLIC_DIR
        now_dt = self.fetcher.parse_iso_timestamp("2026-07-12T00:00:00Z")
        cases = {
            "TINY": weekday_rows("2026-06-29", 10),
            "STALE": weekday_rows("2026-04-01", 25),
            "SPARSE": sampled_weekday_rows("2025-07-08", "2026-07-08", 190),
        }
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp) / "stockanalysis"
                self.fetcher.OUT_DIR = out_dir
                self.fetcher.PUBLIC_DIR = Path(tmp) / "public" / "stockanalysis"
                (out_dir / "etfs").mkdir(parents=True)
                for ticker, rows in cases.items():
                    evidence = self.fetcher.daily_1y_series_evidence(rows, now_dt)
                    self.assertFalse(evidence["eligible"])
                    (out_dir / "etfs" / f"{ticker}.json").write_text(
                        json.dumps({
                            "source": "stockanalysis",
                            "asset_type": "etf",
                            "fetched_at": "2026-07-11T23:00:00Z",
                            "normalized": {"history_periods": {"daily_1y": rows}},
                        }),
                        encoding="utf-8",
                    )
                ledger = self.fetcher.update_pending_ledger(
                    results=[{
                        "ticker": ticker,
                        "asset_type": "etf",
                        "status": "ok",
                        "provider": "stockanalysis",
                        "error": None,
                    } for ticker in cases],
                    selected_rows=[{
                        "ticker": ticker,
                        "missing_history_periods": ["daily_1y"],
                        "daily_1y_min_rows": 200,
                    } for ticker in cases],
                    cooldown_days=7,
                    failure_threshold=99,
                    mirror_public=False,
                    now_dt=now_dt,
                )
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.PUBLIC_DIR = original_public_dir

        self.assertEqual(ledger["entries"], {})
        self.assertEqual(ledger["counts"]["cooldown"], 0)

    def test_hard_failures_rotate_all_missing_candidates_without_starvation(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_public_dir = self.fetcher.PUBLIC_DIR
        now_dt = self.fetcher.parse_iso_timestamp("2026-07-12T00:00:00Z")
        tickers = [f"ETF{index:02d}" for index in range(31)]
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp) / "stockanalysis"
                self.fetcher.OUT_DIR = out_dir
                self.fetcher.PUBLIC_DIR = Path(tmp) / "public" / "stockanalysis"
                (out_dir / "surfaces").mkdir(parents=True)
                (out_dir / "etfs").mkdir(parents=True)
                (out_dir / "backfill").mkdir(parents=True)
                (out_dir / "surfaces" / "new_etfs.json").write_text(
                    json.dumps({"records": [{"s": ticker} for ticker in tickers]}),
                    encoding="utf-8",
                )

                attempted = []
                for _ in range(4):
                    summary = self.fetcher.incremental_etf_backfill_candidates(
                        universe_payload={"records": []},
                        limit=8,
                        max_age_hours=720,
                        exclude=set(),
                        cooldown_days=7,
                        cooldown_failure_threshold=99,
                        now_dt=now_dt,
                    )
                    selected = summary["selected"]
                    attempted.extend(row["ticker"] for row in selected)
                    ledger = self.fetcher.update_pending_ledger(
                        results=[
                            {
                                "ticker": row["ticker"],
                                "asset_type": "etf",
                                "status": "error",
                                "provider": "stockanalysis",
                                "error": "HTTP Error 500: transient upstream failure",
                            }
                            for row in selected
                        ],
                        selected_rows=selected,
                        cooldown_days=7,
                        failure_threshold=99,
                        mirror_public=False,
                        now_dt=now_dt,
                    )
                    for row in selected:
                        self.assertEqual(ledger["entries"][row["ticker"]]["failure_class"], "hard_error")
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.PUBLIC_DIR = original_public_dir

        self.assertEqual(len(attempted), 32)
        self.assertEqual(len(set(attempted)), 31)
        self.assertEqual(sorted(set(attempted)), tickers)

    def test_yahoo_candidate_success_keeps_missing_primary_in_retry_ledger(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_public_dir = self.fetcher.PUBLIC_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp:
                self.fetcher.OUT_DIR = Path(tmp) / "stockanalysis"
                self.fetcher.PUBLIC_DIR = Path(tmp) / "public" / "stockanalysis"
                summary = self.fetcher.update_pending_ledger(
                    results=[
                        {
                            "ticker": "ADIU",
                            "asset_type": "etf",
                            "status": "fallback_candidate_ok",
                            "provider": "yahoo_finance",
                            "stockanalysis_error": "URLError: HTTP Error 404: Not Found",
                            "error": None,
                        }
                    ],
                    selected_rows=[{"ticker": "ADIU"}],
                    cooldown_days=7,
                    failure_threshold=1,
                    mirror_public=False,
                )
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.PUBLIC_DIR = original_public_dir

        self.assertEqual(summary["counts"]["tracked"], 1)
        self.assertEqual(summary["entries"]["ADIU"]["last_provider"], "yahoo_finance")

    def test_etf_404_uses_yahoo_fallback_when_enabled(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_fetch_etf = self.fetcher.fetch_etf
        original_fallback = self.fetcher.fetch_yahoo_etf_fallback
        original_write_payload = self.fetcher.write_payload
        original_state_root = self.fetcher.DATA_SUPPLY_STATE_ROOT
        writes = []

        def fake_fetch_etf(_ticker: str, _timeout: int, **_kwargs) -> dict:
            raise urllib.error.URLError("HTTP Error 404: Not Found")

        def fake_fallback(
            ticker: str,
            _mirror_public: bool,
            collection_origin: str = "natural",
        ) -> dict:
            return {
                "schema_version": self.fetcher.SCHEMA_VERSION,
                "source": "yahoo_finance",
                "source_provider": "yahoo_finance",
                "detail_status": "yf_fallback",
                "asset_type": "etf",
                "ticker": ticker,
                "fetched_at": "2026-06-18T00:00:00Z",
                "normalized": {"quote": {"p": 14.5, "ex": "yahoo_finance"}},
            }

        def fake_write_payload(rel_path: str, payload: dict, _mirror_public: bool) -> None:
            writes.append((rel_path, payload))

        self.fetcher.fetch_etf = fake_fetch_etf
        self.fetcher.fetch_yahoo_etf_fallback = fake_fallback
        self.fetcher.write_payload = fake_write_payload
        try:
            with tempfile.TemporaryDirectory() as tmp:
                temp_root = Path(tmp)
                self.fetcher.OUT_DIR = temp_root / "data" / "stockanalysis"
                self.fetcher.DATA_SUPPLY_STATE_ROOT = temp_root / "data-supply-state" / "v1"
                result = self.fetcher.run_one("etf", "ADIU", timeout=1, mirror_public=False, yf_fallback=True)
                history_files = list((self.fetcher.DATA_SUPPLY_STATE_ROOT / "history" / "observations").glob("*.jsonl"))
                observations = [json.loads(line) for line in history_files[0].read_text(encoding="utf-8").splitlines()]
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.fetch_etf = original_fetch_etf
            self.fetcher.fetch_yahoo_etf_fallback = original_fallback
            self.fetcher.write_payload = original_write_payload
            self.fetcher.DATA_SUPPLY_STATE_ROOT = original_state_root

        self.assertEqual(result["status"], "fallback_candidate_ok")
        self.assertEqual(result["provider"], "yahoo_finance")
        self.assertIn("HTTP Error 404", result["stockanalysis_error"])
        self.assertEqual(result["candidate_path"], "data/yf/etf-details/ADIU.json")
        self.assertIsNone(result["selected_provider"])
        self.assertFalse(result["canonical_write"])
        self.assertEqual(writes, [])
        self.assertEqual(len(observations), 1)
        self.assertEqual(observations[0]["provider"], "stockanalysis")
        self.assertEqual(observations[0]["validation_status"], "invalid")
        self.assertEqual(observations[0]["reason_code"], "provider_coverage_gap")
        self.assertEqual(observations[0]["availability_status"], "provider_absent")
        self.assertEqual(observations[0]["provider_response"], "HTTP 404")

    def test_etf_404_without_fallback_is_degraded_provider_gap(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_fetch_etf = self.fetcher.fetch_etf
        original_state_root = self.fetcher.DATA_SUPPLY_STATE_ROOT

        def fake_fetch_etf(_ticker: str, _timeout: int, **_kwargs) -> dict:
            raise urllib.error.URLError("HTTP Error 404: Not Found")

        self.fetcher.fetch_etf = fake_fetch_etf
        try:
            with tempfile.TemporaryDirectory() as tmp:
                temp_root = Path(tmp)
                self.fetcher.OUT_DIR = temp_root / "data" / "stockanalysis"
                self.fetcher.DATA_SUPPLY_STATE_ROOT = temp_root / "data-supply-state" / "v1"
                result = self.fetcher.run_one(
                    "etf",
                    "ABSENT",
                    timeout=1,
                    mirror_public=False,
                    yf_fallback=False,
                    include_etf_history=False,
                )
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.fetch_etf = original_fetch_etf
            self.fetcher.DATA_SUPPLY_STATE_ROOT = original_state_root

        self.assertEqual(result["status"], "provider_coverage_gap")
        self.assertEqual(result["provider"], "stockanalysis")
        self.assertIsNone(result["error"])
        self.assertEqual(result["provider_availability_status"], "absent")
        self.assertEqual(result["provider_availability_reason"], "provider_coverage_gap")
        self.assertEqual(result["provider_response"], "HTTP 404")

    def test_schema_and_network_primary_failures_still_materialize_yahoo_candidate(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_fetch_etf = self.fetcher.fetch_etf
        original_loader = self.fetcher.load_yf_finance_module
        original_yf_out_dir = self.fetcher.YF_OUT_DIR
        original_yf_detail_out_dir = self.fetcher.YF_ETF_DETAIL_OUT_DIR
        original_state_root = self.fetcher.DATA_SUPPLY_STATE_ROOT

        engine = original_loader()
        class FakeYahooModule:
            decorate_finance_payload = staticmethod(engine.decorate_finance_payload)
            @staticmethod
            def fetch_with_retry(_ticker: str, profile: str = "etf", retries: int = 1, backoffs: tuple = (3,), include_evidence: bool = False):
                result = ({
                    "info": {
                        "symbol": "VYMI",
                        "quoteType": "ETF",
                        "currentPrice": 70.0,
                        "previousClose": 69.5,
                        "regularMarketTime": 1783641600,
                    },
                    "funds_data": {"top_holdings": []},
                    "history_1y": [],
                }, 10, None)
                return (*result, {"attempts_used": 1, "latency_ms": 10, "failures": []}) if include_evidence else result

        try:
            for label, failure in (
                ("schema", ValueError("schema drift")),
                ("network", urllib.error.URLError("timed out")),
            ):
                with self.subTest(label=label), tempfile.TemporaryDirectory() as tmp:
                    temp_root = Path(tmp)
                    self.fetcher.OUT_DIR = temp_root / "data" / "stockanalysis"
                    self.fetcher.YF_OUT_DIR = temp_root / "data" / "yf" / "finance"
                    self.fetcher.YF_ETF_DETAIL_OUT_DIR = temp_root / "data" / "yf" / "etf-details"
                    self.fetcher.DATA_SUPPLY_STATE_ROOT = temp_root / "data" / "admin" / "data-supply-state" / "v1"
                    self.fetcher.fetch_etf = lambda _ticker, _timeout, exc=failure, **_kwargs: (_ for _ in ()).throw(exc)
                    self.fetcher.load_yf_finance_module = lambda: FakeYahooModule
                    result = self.fetcher.run_one("etf", "VYMI", 1, False, yf_fallback=True)
                    candidate_exists = (self.fetcher.YF_ETF_DETAIL_OUT_DIR / "VYMI.json").exists()
                    history_files = list((self.fetcher.DATA_SUPPLY_STATE_ROOT / "history" / "observations").glob("*.jsonl"))
                    observations = [json.loads(line) for line in history_files[0].read_text(encoding="utf-8").splitlines()]
                    self.assertEqual(result["status"], "fallback_candidate_ok")
                    self.assertTrue(candidate_exists)
                    self.assertEqual(
                        [(row["provider"], row["validation_status"]) for row in observations],
                        [("stockanalysis", "invalid"), ("yahoo_finance", "valid")],
                    )
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.fetch_etf = original_fetch_etf
            self.fetcher.load_yf_finance_module = original_loader
            self.fetcher.YF_OUT_DIR = original_yf_out_dir
            self.fetcher.YF_ETF_DETAIL_OUT_DIR = original_yf_detail_out_dir
            self.fetcher.DATA_SUPPLY_STATE_ROOT = original_state_root

    def test_stockanalysis_success_writes_only_primary_truth_and_observation(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_public_dir = self.fetcher.PUBLIC_DIR
        original_yf_out_dir = self.fetcher.YF_OUT_DIR
        original_yf_detail_out_dir = self.fetcher.YF_ETF_DETAIL_OUT_DIR
        original_state_root = self.fetcher.DATA_SUPPLY_STATE_ROOT
        original_fetch_etf = self.fetcher.fetch_etf
        try:
            with tempfile.TemporaryDirectory() as tmp:
                temp_root = Path(tmp)
                self.fetcher.OUT_DIR = temp_root / "data" / "stockanalysis"
                self.fetcher.PUBLIC_DIR = temp_root / "public" / "data" / "stockanalysis"
                self.fetcher.YF_OUT_DIR = temp_root / "data" / "yf" / "finance"
                self.fetcher.YF_ETF_DETAIL_OUT_DIR = temp_root / "data" / "yf" / "etf-details"
                self.fetcher.DATA_SUPPLY_STATE_ROOT = temp_root / "data" / "admin" / "data-supply-state" / "v1"
                self.fetcher.fetch_etf = lambda ticker, _timeout, **_kwargs: {
                    "schema_version": self.fetcher.SCHEMA_VERSION,
                    "source": "stockanalysis",
                    "asset_type": "etf",
                    "ticker": ticker,
                    "source_as_of": "2026-07-10T00:00:00Z",
                    "fetched_at": "2026-07-10T00:00:00Z",
                    "normalized": {"overview": {"aum": 1}},
                    "raw": {"quote": {"td": "2026-07-10", "ts": 1783641600}},
                }
                result = self.fetcher.run_one("etf", "VYMI", 1, False, yf_fallback=True)
                primary_exists = (self.fetcher.OUT_DIR / "etfs" / "VYMI.json").exists()
                raw_yf_exists = (self.fetcher.YF_OUT_DIR / "VYMI.json").exists()
                normalized_yf_exists = (self.fetcher.YF_ETF_DETAIL_OUT_DIR / "VYMI.json").exists()
                history_files = list((self.fetcher.DATA_SUPPLY_STATE_ROOT / "history" / "observations").glob("*.jsonl"))
                observations = [json.loads(line) for line in history_files[0].read_text(encoding="utf-8").splitlines()]
                pending = json.loads(
                    (
                        self.fetcher.DATA_SUPPLY_STATE_ROOT
                        / "providers/stockanalysis/etf_detail/pending/VYMI.json"
                    ).read_text(encoding="utf-8")
                )
                provider_object_bytes = (self.fetcher.DATA_SUPPLY_STATE_ROOT / pending["path"]).read_bytes()
                primary_bytes = (self.fetcher.OUT_DIR / "etfs" / "VYMI.json").read_bytes()
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.PUBLIC_DIR = original_public_dir
            self.fetcher.YF_OUT_DIR = original_yf_out_dir
            self.fetcher.YF_ETF_DETAIL_OUT_DIR = original_yf_detail_out_dir
            self.fetcher.DATA_SUPPLY_STATE_ROOT = original_state_root
            self.fetcher.fetch_etf = original_fetch_etf

        self.assertEqual(result["status"], "ok")
        self.assertTrue(result["canonical_write"])
        self.assertTrue(primary_exists)
        self.assertFalse(raw_yf_exists)
        self.assertFalse(normalized_yf_exists)
        self.assertEqual(observations[0]["provider"], "stockanalysis")
        self.assertEqual(observations[0]["validation_status"], "valid")
        self.assertEqual(observations[0]["observation_origin"], "natural")
        self.assertEqual(provider_object_bytes, primary_bytes)
        self.assertEqual(pending["observation_event_id"], observations[0]["event_id"])

    def test_undated_stockanalysis_partial_is_written_as_degraded_not_valid_state(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_public_dir = self.fetcher.PUBLIC_DIR
        original_state_root = self.fetcher.DATA_SUPPLY_STATE_ROOT
        original_fetch_etf = self.fetcher.fetch_etf
        try:
            with tempfile.TemporaryDirectory() as tmp:
                temp_root = Path(tmp)
                self.fetcher.OUT_DIR = temp_root / "data" / "stockanalysis"
                self.fetcher.PUBLIC_DIR = temp_root / "public" / "stockanalysis"
                self.fetcher.DATA_SUPPLY_STATE_ROOT = (
                    temp_root / "data" / "admin" / "data-supply-state" / "v1"
                )
                self.fetcher.fetch_etf = lambda ticker, _timeout, **_kwargs: {
                    "schema_version": self.fetcher.SCHEMA_VERSION,
                    "source": "stockanalysis",
                    "asset_type": "etf",
                    "ticker": ticker,
                    "detail_status": "stockanalysis_partial",
                    "partial_reason_codes": ["holdings_surface_omits_holdings"],
                    "source_as_of": None,
                    "source_as_of_reason": (
                        "provider detail response carries no market or holdings observation date"
                    ),
                    "fetched_at": "2026-07-14T00:00:00Z",
                    "normalized": {"overview": {"aum": 1}},
                }
                result = self.fetcher.run_one(
                    "etf",
                    "AAOX",
                    1,
                    False,
                    include_etf_history=False,
                )
                observations_path = next(
                    (
                        self.fetcher.DATA_SUPPLY_STATE_ROOT
                        / "history"
                        / "observations"
                    ).glob("*.jsonl")
                )
                observations = [
                    json.loads(line)
                    for line in observations_path.read_text(encoding="utf-8").splitlines()
                ]
                payload = json.loads(
                    (self.fetcher.OUT_DIR / "etfs" / "AAOX.json").read_text(
                        encoding="utf-8"
                    )
                )
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.PUBLIC_DIR = original_public_dir
            self.fetcher.DATA_SUPPLY_STATE_ROOT = original_state_root
            self.fetcher.fetch_etf = original_fetch_etf

        self.assertEqual(result["status"], "ok")
        self.assertEqual(
            result["provider_availability_reason"],
            "provider_partial_detail_contract_valid",
        )
        self.assertIsNone(payload["source_as_of"])
        self.assertEqual(observations[0]["validation_status"], "invalid")
        self.assertEqual(
            observations[0]["reason_code"],
            "partial_source_date_unavailable",
        )
        self.assertIsNone(observations[0]["source_as_of"])

    def test_stockanalysis_self_asserted_source_date_without_provider_evidence_is_invalid(self) -> None:
        payload = {
            "schema_version": self.fetcher.SCHEMA_VERSION,
            "source": "stockanalysis",
            "asset_type": "etf",
            "ticker": "VYMI",
            "source_as_of": "2026-07-10T00:00:00Z",
            "fetched_at": "2026-07-10T00:00:00Z",
            "normalized": {"overview": {"aum": 1}},
        }
        with self.assertRaisesRegex(ValueError, "provider source date is unavailable"):
            self.fetcher.validate_stockanalysis_etf_payload("VYMI", payload)

        payload["raw"] = {"quote": {"td": "2026-07-09", "ts": 1783555200}}
        with self.assertRaisesRegex(ValueError, "disagrees with provider evidence"):
            self.fetcher.validate_stockanalysis_etf_payload("VYMI", payload)

    def test_stockanalysis_partial_accepts_null_with_reason_but_rejects_fabricated_date(self) -> None:
        payload = {
            "schema_version": self.fetcher.SCHEMA_VERSION,
            "source": "stockanalysis",
            "asset_type": "etf",
            "ticker": "AAOX",
            "detail_status": "stockanalysis_partial",
            "partial_reason_codes": ["holdings_surface_omits_holdings"],
            "source_as_of": None,
            "source_as_of_reason": (
                "provider detail response carries no market or holdings observation date"
            ),
            "fetched_at": "2026-07-14T00:00:00Z",
            "normalized": {"overview": {"aum": 1}},
        }

        self.fetcher.validate_stockanalysis_etf_payload("AAOX", payload)

        payload["source_as_of"] = "2026-07-14T00:00:00Z"
        with self.assertRaisesRegex(ValueError, "provider source date is unavailable"):
            self.fetcher.validate_stockanalysis_etf_payload("AAOX", payload)

    def test_stockanalysis_path_rejects_cross_provider_payload(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_fetch_etf = self.fetcher.fetch_etf
        original_state_root = self.fetcher.DATA_SUPPLY_STATE_ROOT
        try:
            with tempfile.TemporaryDirectory() as tmp:
                self.fetcher.OUT_DIR = Path(tmp) / "data" / "stockanalysis"
                self.fetcher.DATA_SUPPLY_STATE_ROOT = Path(tmp) / "data" / "admin" / "data-supply-state" / "v1"
                self.fetcher.fetch_etf = lambda ticker, _timeout, **_kwargs: {
                    "schema_version": "yf-etf-detail/v1",
                    "source": "yahoo_finance",
                    "source_provider": "yahoo_finance",
                    "asset_type": "etf",
                    "ticker": ticker,
                    "fetched_at": "2026-07-10T00:00:00Z",
                }
                result = self.fetcher.run_one("etf", "VYMI", 1, False, yf_fallback=False)
                primary_exists = (self.fetcher.OUT_DIR / "etfs" / "VYMI.json").exists()
                history_files = list((self.fetcher.DATA_SUPPLY_STATE_ROOT / "history" / "observations").glob("*.jsonl"))
                observations = [json.loads(line) for line in history_files[0].read_text(encoding="utf-8").splitlines()]
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.fetch_etf = original_fetch_etf
            self.fetcher.DATA_SUPPLY_STATE_ROOT = original_state_root

        self.assertEqual(result["status"], "error")
        self.assertIn("schema mismatch", result["error"])
        self.assertFalse(primary_exists)
        self.assertEqual(observations[0]["validation_status"], "invalid")
        self.assertEqual(observations[0]["reason_code"], "schema_invalid")

    def test_malformed_primary_stamp_preserves_existing_primary_bytes(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_fetch_etf = self.fetcher.fetch_etf
        original_state_root = self.fetcher.DATA_SUPPLY_STATE_ROOT
        try:
            with tempfile.TemporaryDirectory() as tmp:
                temp_root = Path(tmp)
                self.fetcher.OUT_DIR = temp_root / "data" / "stockanalysis"
                self.fetcher.DATA_SUPPLY_STATE_ROOT = temp_root / "data" / "admin" / "data-supply-state" / "v1"
                detail_path = self.fetcher.OUT_DIR / "etfs" / "VYMI.json"
                detail_path.parent.mkdir(parents=True)
                original_bytes = b'{"source":"stockanalysis","ticker":"VYMI","fetched_at":"2026-07-09T00:00:00Z"}\n'
                detail_path.write_bytes(original_bytes)
                self.fetcher.fetch_etf = lambda ticker, _timeout, **_kwargs: {
                    "schema_version": self.fetcher.SCHEMA_VERSION,
                    "source": "stockanalysis",
                    "asset_type": "etf",
                    "ticker": ticker,
                    "source_as_of": "not-a-timeZ",
                    "fetched_at": "2026-07-10T00:00:00Z",
                    "normalized": {"overview": {"aum": 1}},
                    "raw": {"quote": {"td": "2026-07-10", "ts": 1783641600}},
                }
                result = self.fetcher.run_one("etf", "VYMI", 1, False, yf_fallback=False)
                after_bytes = detail_path.read_bytes()
                history_files = list((self.fetcher.DATA_SUPPLY_STATE_ROOT / "history" / "observations").glob("*.jsonl"))
                observations = [json.loads(line) for line in history_files[0].read_text(encoding="utf-8").splitlines()]
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.fetch_etf = original_fetch_etf
            self.fetcher.DATA_SUPPLY_STATE_ROOT = original_state_root

        self.assertEqual(result["status"], "error")
        self.assertIn("malformed", result["error"])
        self.assertEqual(after_bytes, original_bytes)
        self.assertEqual(observations[0]["reason_code"], "schema_invalid")

    def test_yahoo_fallback_never_overwrites_existing_stockanalysis_detail(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_fetch_etf = self.fetcher.fetch_etf
        original_loader = self.fetcher.load_yf_finance_module
        original_yf_out_dir = self.fetcher.YF_OUT_DIR
        original_yf_detail_out_dir = self.fetcher.YF_ETF_DETAIL_OUT_DIR
        original_state_root = self.fetcher.DATA_SUPPLY_STATE_ROOT

        engine = original_loader()
        class FakeYahooModule:
            decorate_finance_payload = staticmethod(engine.decorate_finance_payload)
            @staticmethod
            def fetch_with_retry(_ticker: str, profile: str = "etf", retries: int = 1, backoffs: tuple = (3,), include_evidence: bool = False):
                result = ({
                    "info": {
                        "symbol": "VYMI",
                        "quoteType": "ETF",
                        "currentPrice": 70.0,
                        "previousClose": 69.5,
                        "regularMarketTime": 1783641600,
                    },
                    "funds_data": {"top_holdings": []},
                    "history_1y": [],
                }, 10, None)
                return (*result, {"attempts_used": 1, "latency_ms": 10, "failures": []}) if include_evidence else result

        try:
            with tempfile.TemporaryDirectory() as tmp:
                temp_root = Path(tmp)
                self.fetcher.OUT_DIR = temp_root / "data" / "stockanalysis"
                self.fetcher.YF_OUT_DIR = temp_root / "data" / "yf" / "finance"
                self.fetcher.YF_ETF_DETAIL_OUT_DIR = temp_root / "data" / "yf" / "etf-details"
                self.fetcher.DATA_SUPPLY_STATE_ROOT = temp_root / "data" / "admin" / "data-supply-state" / "v1"
                detail_dir = self.fetcher.OUT_DIR / "etfs"
                detail_dir.mkdir(parents=True)
                canonical_bytes = b'{\n  "source": "stockanalysis",\n  "ticker": "VYMI",\n  "fetched_at": "2026-07-09T00:00:00Z"\n}\n'
                detail_path = detail_dir / "VYMI.json"
                detail_path.write_bytes(canonical_bytes)

                self.fetcher.fetch_etf = lambda _ticker, _timeout, **_kwargs: (_ for _ in ()).throw(
                    urllib.error.URLError("HTTP Error 404: Not Found")
                )
                self.fetcher.load_yf_finance_module = lambda: FakeYahooModule

                result = self.fetcher.run_one("etf", "VYMI", 1, False, yf_fallback=True)
                after_bytes = detail_path.read_bytes()
                raw_path = self.fetcher.YF_OUT_DIR / "VYMI.json"
                candidate_path = self.fetcher.YF_ETF_DETAIL_OUT_DIR / "VYMI.json"
                history_path = (
                    self.fetcher.DATA_SUPPLY_STATE_ROOT
                    / "history"
                    / "observations"
                    / f"{datetime.now(timezone.utc).date().isoformat()}.jsonl"
                )
                observations = [json.loads(line) for line in history_path.read_text(encoding="utf-8").splitlines()]
                yahoo_pending = json.loads(
                    (
                        self.fetcher.DATA_SUPPLY_STATE_ROOT
                        / "providers/yahoo_finance/etf_detail/pending/VYMI.json"
                    ).read_text(encoding="utf-8")
                )
                yahoo_object_bytes = (self.fetcher.DATA_SUPPLY_STATE_ROOT / yahoo_pending["path"]).read_bytes()
                candidate_bytes = candidate_path.read_bytes()
                raw_exists = raw_path.exists()
                candidate_exists = candidate_path.exists()
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.fetch_etf = original_fetch_etf
            self.fetcher.load_yf_finance_module = original_loader
            self.fetcher.YF_OUT_DIR = original_yf_out_dir
            self.fetcher.YF_ETF_DETAIL_OUT_DIR = original_yf_detail_out_dir
            self.fetcher.DATA_SUPPLY_STATE_ROOT = original_state_root

        self.assertEqual(result["status"], "fallback_observed_primary_preserved")
        self.assertEqual(result["selected_provider"], "stockanalysis")
        self.assertFalse(result["canonical_write"])
        self.assertEqual(after_bytes, canonical_bytes)
        self.assertTrue(raw_exists)
        self.assertTrue(candidate_exists)
        self.assertEqual(
            [(row["provider"], row["validation_status"]) for row in observations],
            [("stockanalysis", "invalid"), ("yahoo_finance", "valid")],
        )
        self.assertEqual(observations[1]["provider_path"], "data/yf/etf-details/VYMI.json")
        self.assertEqual(observations[1]["observation_origin"], "natural")
        self.assertEqual(yahoo_object_bytes, candidate_bytes)
        self.assertEqual(yahoo_pending["observation_event_id"], observations[1]["event_id"])

    def test_yahoo_etf_payload_normalizes_source_tags_quote_and_fund_profile(self) -> None:
        payload = self.fetcher.yahoo_etf_payload(
            "BSJY",
            {
                "ticker": "BSJY",
                "fetched_at": "2026-06-19T07:30:51Z",
                "data": {
                    "info": {
                        "symbol": "BSJY",
                        "quoteType": "ETF",
                        "longName": "Invesco BulletShares 2034 High Yield Corporate Bond ETF",
                        "currentPrice": 25.07,
                        "previousClose": 25.205,
                        "regularMarketTime": 1781767851,
                        "navPrice": 20.21,
                        "netExpenseRatio": 0.42,
                        "fundFamily": "Invesco",
                        "category": "High Yield Bond",
                        "legalType": "Exchange Traded Fund",
                    },
                    "funds_data": {
                        "quote_type": "ETF",
                        "description": "The fund tracks a high-yield corporate bond index.",
                        "fund_overview": {
                            "family": "Invesco",
                            "categoryName": "High Yield Bond",
                            "legalType": "Exchange Traded Fund",
                        },
                        "top_holdings": [
                            {"_index": "CASH", "Name": "Cash", "Holding Percent": 0.125},
                        ],
                        "asset_classes": {"bondPosition": 0.875, "cashPosition": 0.125},
                        "sector_weightings": {"financial_services": 0.25},
                    },
                    "history_1y": [{"date": "2026-06-18", "close": 25.07}],
                },
            },
        )

        self.assertEqual(payload["source"], "yahoo_finance")
        self.assertEqual(payload["schema_version"], "yf-etf-detail/v1")
        self.assertEqual(payload["source_as_of"], "2026-06-18T07:30:51Z")
        self.assertNotEqual(payload["source_as_of"], payload["fetched_at"])
        self.assertEqual(payload["source_provider"], "yahoo_finance")
        self.assertEqual(payload["detail_status"], "yf_fallback")
        self.assertEqual(payload["normalized"]["quote"]["ex"], "yahoo_finance")
        self.assertAlmostEqual(payload["normalized"]["quote"]["c"], -0.135)
        self.assertEqual(payload["normalized"]["overview"]["provider_page"], "Invesco")
        self.assertEqual(payload["normalized"]["holdings"][0]["weight_pct"], 12.5)
        self.assertEqual(payload["normalized"]["asset_allocation"]["bondPosition"], 0.875)
        self.assertEqual(payload["normalized"]["history"][0]["close"], 25.07)
        self.assertEqual(payload["normalized"]["history_periods"]["daily_1y"][0]["close"], 25.07)

    def test_yahoo_etf_payload_rejects_non_fund_quote_type(self) -> None:
        with self.assertRaises(ValueError):
            self.fetcher.yahoo_etf_payload(
                "ADIU",
                {
                    "ticker": "ADIU",
                    "fetched_at": "2026-06-18T07:30:51Z",
                    "data": {
                        "info": {"symbol": "ADIU", "quoteType": "EQUITY", "currentPrice": 14.5},
                    },
                },
            )

    def test_yahoo_etf_payload_rejects_missing_type_and_symbol_mismatch(self) -> None:
        with self.assertRaisesRegex(ValueError, "quoteType"):
            self.fetcher.yahoo_etf_payload(
                "ADIU",
                {"ticker": "ADIU", "fetched_at": "2026-06-18T00:00:00Z", "data": {"info": {"symbol": "ADIU"}}},
            )
        with self.assertRaisesRegex(ValueError, "symbol mismatch"):
            self.fetcher.yahoo_etf_payload(
                "ADIU",
                {
                    "ticker": "ADIU",
                    "fetched_at": "2026-06-18T00:00:00Z",
                    "data": {"info": {"symbol": "WRONG", "quoteType": "ETF"}},
                },
            )
        with self.assertRaisesRegex(ValueError, "minimum ETF detail"):
            self.fetcher.yahoo_etf_payload(
                "ADIU",
                {
                    "ticker": "ADIU",
                    "fetched_at": "2026-06-18T00:00:00Z",
                    "data": {"info": {"symbol": "ADIU", "quoteType": "ETF"}},
                },
            )
        with self.assertRaisesRegex(ValueError, "asset_classes"):
            self.fetcher.yahoo_etf_payload(
                "ADIU",
                {
                    "ticker": "ADIU",
                    "fetched_at": "2026-06-18T00:00:00Z",
                    "data": {
                        "info": {"symbol": "ADIU", "quoteType": "ETF", "currentPrice": 10},
                        "funds_data": {"asset_classes": ["malformed"]},
                    },
                },
            )
        with self.assertRaisesRegex(ValueError, "history rows"):
            self.fetcher.yahoo_etf_payload(
                "ADIU",
                {
                    "ticker": "ADIU",
                    "fetched_at": "2026-06-18T00:00:00Z",
                    "data": {
                        "info": {"symbol": "ADIU", "quoteType": "ETF", "currentPrice": 10},
                        "history_1y": ["malformed"],
                    },
                },
            )

    def test_yahoo_pair_promotes_genuine_daily_finance_and_refuses_false_canonical(self) -> None:
        ticker = "IAUM"
        now = datetime.now(timezone.utc).replace(microsecond=0)
        old_quote = now - timedelta(days=2)
        new_quote = now - timedelta(days=1)
        old_dates = [(now - timedelta(days=3)).date().isoformat(), old_quote.date().isoformat()]
        new_dates = [*old_dates, new_quote.date().isoformat()]

        def data(quote, dates):
            return {"info": {"symbol": ticker, "quoteType": "ETF", "currentPrice": 10.0,
                             "regularMarketTime": int(quote.timestamp())},
                    "history_1y": [{"date": day, "close": 10.0} for day in dates]}

        engine = self.fetcher.load_yf_finance_module()
        old_data = data(old_quote, old_dates)
        old_fetched = (old_quote + timedelta(hours=1)).isoformat().replace("+00:00", "Z")
        existing = engine.decorate_finance_payload(ticker, "daily", old_fetched, old_data)
        existing.pop("first_trade_date", None)  # The engine serializer omits null fields.
        self.assertNotIn("source", existing)
        self.assertEqual(existing["source_as_of"], old_quote.date().isoformat())
        candidate_provider = self.fetcher.build_yf_payload(
            ticker, data(new_quote, new_dates), now.isoformat().replace("+00:00", "Z")
        )
        candidate_detail = self.fetcher.yahoo_etf_payload(ticker, candidate_provider)
        old_detail = self.fetcher.yahoo_etf_payload(
            ticker, self.fetcher.build_yf_payload(ticker, old_data, old_fetched)
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with patch.object(self.fetcher, "YF_OUT_DIR", root / "data/yf/finance"), \
                    patch.object(self.fetcher, "YF_ETF_DETAIL_OUT_DIR", root / "data/yf/etf-details"), \
                    patch.object(self.fetcher, "YF_PUBLIC_DIR", root / "public/data/yf/finance"):
                finance = self.fetcher.YF_OUT_DIR / f"{ticker}.json"
                detail = self.fetcher.YF_ETF_DETAIL_OUT_DIR / f"{ticker}.json"
                public = self.fetcher.YF_PUBLIC_DIR / f"{ticker}.json"
                paths = (finance, detail, public)
                for path in paths:
                    path.parent.mkdir(parents=True, exist_ok=True)

                def seed(finance_payload=existing, detail_payload=old_detail):
                    finance.write_bytes(self.fetcher.json_payload_bytes(finance_payload))
                    detail.write_bytes(self.fetcher.json_payload_bytes(detail_payload))
                    public.write_bytes(finance.read_bytes())
                    return [path.read_bytes() for path in paths]

                seed()
                self.fetcher.publish_yahoo_etf_fallback_pair(
                    ticker, candidate_provider, candidate_detail, mirror_public=True
                )
                self.assertEqual(json.loads(finance.read_bytes()), candidate_provider)
                self.assertEqual(json.loads(detail.read_bytes()), candidate_detail)
                self.assertEqual(public.read_bytes(), finance.read_bytes())

                cases = {
                    "wrong source": {**existing, "source": "other"},
                    "wrong schema": {**existing, "schema_version": "yf-finance/v1"},
                    "unsupported profile": {**existing, "profile": "other"},
                    "core snapshot": {**existing, "profile": "core"},
                    "full snapshot": {**existing, "profile": "full"},
                    "wrong symbol": {**existing, "data": data(old_quote, old_dates) | {
                        "info": {**old_data["info"], "symbol": "WRONG"}}},
                    "wrong kind": {**existing, "data": data(old_quote, old_dates) | {
                        "info": {**old_data["info"], "quoteType": "EQUITY"}}},
                    "false quote": {**existing, "quote_as_of": "2026-01-01T00:00:00Z"},
                    "false history": {**existing, "history_as_of": "2026-01-01"},
                    "false source": {**existing, "source_as_of": "2026-01-01"},
                    "false first trade": {**existing, "first_trade_date": "2020-01-01"},
                    "missing source stamp": {key: value for key, value in existing.items() if key != "source_as_of"},
                    "future fetch": {**existing, "fetched_at": (now + timedelta(days=1)).isoformat().replace("+00:00", "Z")},
                    "future quote": {**existing, "data": data(now + timedelta(days=1), old_dates)},
                }
                newer_data = data(now - timedelta(hours=1), [*old_dates, now.date().isoformat()])
                newer = engine.decorate_finance_payload(
                    ticker, "daily", now.isoformat().replace("+00:00", "Z"), newer_data
                )
                newer.pop("first_trade_date", None)
                cases["source regression"] = newer
                wider_data = data(old_quote, [(now - timedelta(days=4)).date().isoformat(), *old_dates])
                wider = engine.decorate_finance_payload(ticker, "daily", old_fetched, wider_data)
                wider.pop("first_trade_date", None)
                cases["history collapse"] = wider
                for label, bad_finance in cases.items():
                    with self.subTest(label=label):
                        before = seed(bad_finance)
                        with self.assertRaises(ValueError):
                            self.fetcher.publish_yahoo_etf_fallback_pair(
                                ticker, candidate_provider, candidate_detail, mirror_public=True
                            )
                        self.assertEqual([path.read_bytes() for path in paths], before)
                with self.subTest(label="wrong detail canonical"):
                    before = seed(existing, {**old_detail, "ticker": "WRONG"})
                    with self.assertRaises(ValueError):
                        self.fetcher.publish_yahoo_etf_fallback_pair(
                            ticker, candidate_provider, candidate_detail, mirror_public=True
                        )
                    self.assertEqual([path.read_bytes() for path in paths], before)
                with self.subTest(label="candidate raw mismatch"):
                    before = seed()
                    mismatched = {**candidate_detail, "raw": {"yf": old_data}}
                    with self.assertRaises(ValueError):
                        self.fetcher.publish_yahoo_etf_fallback_pair(
                            ticker, candidate_provider, mismatched, mirror_public=True
                        )
                    self.assertEqual([path.read_bytes() for path in paths], before)
                with self.subTest(label="valid same-day raw clocks"):
                    before = seed()
                    same_day = data(now, [*new_dates, now.date().isoformat()])
                    same_provider = self.fetcher.build_yf_payload(
                        ticker, same_day, now.isoformat().replace("+00:00", "Z")
                    )
                    same_detail = self.fetcher.yahoo_etf_payload(ticker, same_provider)
                    self.fetcher.publish_yahoo_etf_fallback_pair(
                        ticker, same_provider, same_detail, mirror_public=True
                    )
                    self.assertNotEqual(finance.read_bytes(), before[0])
                    self.assertEqual(json.loads(detail.read_bytes()), same_detail)
                for label, bad_data in (
                    ("candidate wrong symbol", {**data(new_quote, new_dates), "info": {
                        **candidate_provider["data"]["info"], "symbol": "WRONG",
                    }}),
                    ("candidate wrong kind", {**data(new_quote, new_dates), "info": {
                        **candidate_provider["data"]["info"], "quoteType": "EQUITY",
                    }}),
                    ("candidate future history", data(new_quote, [*new_dates,
                        (now + timedelta(days=1)).date().isoformat()])),
                    ("candidate future first trade", {**data(new_quote, new_dates), "info": {
                        **candidate_provider["data"]["info"],
                        "firstTradeDateEpochUtc": int((now + timedelta(days=2)).timestamp()),
                    }}),
                ):
                    with self.subTest(label=label):
                        bad_provider = self.fetcher.build_yf_payload(
                            ticker, bad_data, now.isoformat().replace("+00:00", "Z")
                        )
                        # Bypass the normalizer's own identity rejection to test
                        # the pair publisher against mutually bound forged raw.
                        bad_detail = (
                            {**candidate_detail, "raw": {"yf": bad_data}}
                            if label in {"candidate wrong symbol", "candidate wrong kind"}
                            else self.fetcher.yahoo_etf_payload(ticker, bad_provider)
                        )
                        before = seed()
                        with self.assertRaises(ValueError):
                            self.fetcher.publish_yahoo_etf_fallback_pair(
                                ticker, bad_provider, bad_detail, mirror_public=True
                            )
                        self.assertEqual([path.read_bytes() for path in paths], before)

    def test_yahoo_fallback_preserves_validated_history_before_normalizing(self) -> None:
        ticker = "IAUM"
        now = datetime.now(timezone.utc).replace(microsecond=0)
        old_quote = now - timedelta(days=2)
        new_quote = now - timedelta(days=1)
        dates = [(now - timedelta(days=offset)).date().isoformat() for offset in (4, 3, 2, 1)]
        old_rows = [{"date": day, "Close": 10.0} for day in dates[:3]]
        fresh_rows = [{"date": day, "Close": 11.0} for day in (dates[0], dates[2], dates[3])]

        def data(quote, rows):
            return {"info": {"symbol": ticker, "quoteType": "ETF", "currentPrice": 11.0,
                             "regularMarketTime": int(quote.timestamp())},
                    "history_1y": rows, "funds_data": {"description": "fresh only"}}

        old_data = data(old_quote, old_rows)
        fresh_data = data(new_quote, fresh_rows)
        old_fetch = (old_quote + timedelta(hours=1)).isoformat().replace("+00:00", "Z")
        fresh_fetch = now.isoformat().replace("+00:00", "Z")
        engine = self.fetcher.load_yf_finance_module()
        source_less = engine.decorate_finance_payload(ticker, "daily", old_fetch, old_data)
        source_less.pop("first_trade_date", None)
        explicit = self.fetcher.build_yf_payload(ticker, old_data, old_fetch)
        with tempfile.TemporaryDirectory() as tmp, patch.object(self.fetcher, "YF_OUT_DIR", Path(tmp)):
            canonical = Path(tmp) / f"{ticker}.json"
            for existing in (source_less, explicit):
                with self.subTest(profile=existing["profile"], source=existing.get("source")):
                    canonical.write_bytes(self.fetcher.json_payload_bytes(existing))
                    merged, snapshot = self.fetcher.preserve_yahoo_etf_history_coverage(
                        ticker, fresh_data, fresh_fetch)
                    self.assertEqual(snapshot, canonical.read_bytes())
                    self.assertEqual([row["date"] for row in merged["history_1y"]], dates)
                    self.assertEqual(merged["history_1y"][1], old_rows[1])
                    self.assertEqual(merged["history_1y"][2], fresh_rows[1])
                    self.assertEqual(merged["funds_data"], fresh_data["funds_data"])
                    self.assertEqual(merged["info"], fresh_data["info"])
                    self.assertEqual(json.loads(canonical.read_bytes()), existing)
                    provider = self.fetcher.build_yf_payload(ticker, merged, fresh_fetch)
                    detail = self.fetcher.yahoo_etf_payload(ticker, provider)
                    with patch.object(self.fetcher, "YF_ETF_DETAIL_OUT_DIR", Path(tmp) / "detail"):
                        self.fetcher.publish_yahoo_etf_fallback_pair(
                            ticker, provider, detail, mirror_public=False,
                            expected_finance_bytes=snapshot)
                    # The next fallback must preserve coverage after canonical is explicit-source.
                    canonical.write_bytes(self.fetcher.json_payload_bytes(explicit))
                    self.assertEqual(
                        len(self.fetcher.preserve_yahoo_etf_history_coverage(
                            ticker, fresh_data, fresh_fetch)[0]["history_1y"]), 4)
            canonical.write_bytes(self.fetcher.json_payload_bytes(source_less))
            merged, snapshot = self.fetcher.preserve_yahoo_etf_history_coverage(
                ticker, fresh_data, fresh_fetch)
            provider = self.fetcher.build_yf_payload(ticker, merged, fresh_fetch)
            detail = self.fetcher.yahoo_etf_payload(ticker, provider)
            concurrent = self.fetcher.build_yf_payload(
                ticker, data(old_quote, [*old_rows, {"date": dates[3], "Close": 12.0}]), old_fetch)
            with patch.object(self.fetcher, "YF_ETF_DETAIL_OUT_DIR", Path(tmp) / "detail"), \
                    patch.object(self.fetcher, "YF_PUBLIC_DIR", Path(tmp) / "public"):
                detail_path = self.fetcher.YF_ETF_DETAIL_OUT_DIR / f"{ticker}.json"
                public_path = self.fetcher.YF_PUBLIC_DIR / f"{ticker}.json"
                for target in (detail_path, public_path):
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(b"unchanged sentinel\n")
                canonical.write_bytes(self.fetcher.json_payload_bytes(concurrent))
                before = (canonical.read_bytes(), detail_path.read_bytes(), public_path.read_bytes())
                with self.assertRaisesRegex(ValueError, "changed after history validation"):
                    self.fetcher.publish_yahoo_etf_fallback_pair(
                        ticker, provider, detail, mirror_public=True,
                        expected_finance_bytes=snapshot)
                self.assertEqual(
                    (canonical.read_bytes(), detail_path.read_bytes(), public_path.read_bytes()), before)
            for label, bad_data in (
                ("missing fresh history", {**fresh_data, "history_1y": []}),
                ("null fresh history", {**fresh_data, "history_1y": None}),
                ("malformed fresh history", {**fresh_data, "history_1y": [
                    {"date": dates[-1], "Close": float("nan")}] }),
                ("regressed fresh history", data(new_quote, old_rows[:2])),
                ("regressed quote", data(old_quote - timedelta(days=1), fresh_rows)),
                ("wrong identity", {**fresh_data, "info": {**fresh_data["info"], "symbol": "WRONG"}}),
            ):
                with self.subTest(label=label):
                    canonical.write_bytes(self.fetcher.json_payload_bytes(source_less))
                    before = canonical.read_bytes()
                    with self.assertRaises(ValueError):
                        self.fetcher.preserve_yahoo_etf_history_coverage(ticker, bad_data, fresh_fetch)
                    self.assertEqual(canonical.read_bytes(), before)
            canonical.write_bytes(self.fetcher.json_payload_bytes(
                {**explicit, "source_as_of": "2020-01-01T00:00:00Z"}))
            with self.assertRaises(ValueError):
                self.fetcher.preserve_yahoo_etf_history_coverage(ticker, fresh_data, fresh_fetch)

    def test_yahoo_quote_only_fallback_keeps_empty_history_valid(self) -> None:
        ticker = "SLON"
        now = datetime.now(timezone.utc).replace(microsecond=0)
        old = (now - timedelta(days=1)).isoformat().replace("+00:00", "Z")
        fetched = now.isoformat().replace("+00:00", "Z")
        data = {"info": {"symbol": ticker, "quoteType": "ETF", "currentPrice": 24,
                         "regularMarketTime": int((now - timedelta(days=1)).timestamp())},
                "history_1y": []}
        with tempfile.TemporaryDirectory() as tmp, patch.object(self.fetcher, "YF_OUT_DIR", Path(tmp)):
            canonical = Path(tmp) / f"{ticker}.json"
            canonical.write_bytes(self.fetcher.json_payload_bytes(
                self.fetcher.build_yf_payload(ticker, data, old)))
            for fresh_data in (data, {**data, "history_1y": None},
                               {key: value for key, value in data.items() if key != "history_1y"}):
                with self.subTest(history=fresh_data.get("history_1y")):
                    fresh, snapshot = self.fetcher.preserve_yahoo_etf_history_coverage(
                        ticker, fresh_data, fetched)
                    self.assertEqual(fresh, fresh_data)
                    self.assertEqual(snapshot, canonical.read_bytes())

    def test_invalid_yahoo_fallback_preserves_provider_files_and_records_invalid_observation(self) -> None:
        original_loader = self.fetcher.load_yf_finance_module
        original_yf_out_dir = self.fetcher.YF_OUT_DIR
        original_yf_detail_out_dir = self.fetcher.YF_ETF_DETAIL_OUT_DIR
        original_state_root = self.fetcher.DATA_SUPPLY_STATE_ROOT

        class FakeYahooModule:
            @staticmethod
            def fetch_with_retry(_ticker: str, profile: str = "etf", retries: int = 1, backoffs: tuple = (3,), include_evidence: bool = False):
                result = ({"info": {"symbol": "ADIU", "quoteType": "EQUITY", "currentPrice": 14.5}}, 10, None)
                return (*result, {"attempts_used": 1, "latency_ms": 10, "failures": []}) if include_evidence else result

        self.fetcher.load_yf_finance_module = lambda: FakeYahooModule
        try:
            with tempfile.TemporaryDirectory() as tmp:
                temp_root = Path(tmp)
                self.fetcher.YF_OUT_DIR = temp_root / "data" / "yf" / "finance"
                self.fetcher.YF_ETF_DETAIL_OUT_DIR = temp_root / "data" / "yf" / "etf-details"
                self.fetcher.DATA_SUPPLY_STATE_ROOT = temp_root / "data" / "admin" / "data-supply-state" / "v1"
                with self.assertRaises(ValueError):
                    self.fetcher.fetch_yahoo_etf_fallback("ADIU", mirror_public=False)
                raw_path = self.fetcher.YF_OUT_DIR / "ADIU.json"
                candidate_path = self.fetcher.YF_ETF_DETAIL_OUT_DIR / "ADIU.json"
                history_files = list((self.fetcher.DATA_SUPPLY_STATE_ROOT / "history" / "observations").glob("*.jsonl"))
                observations = [json.loads(line) for line in history_files[0].read_text(encoding="utf-8").splitlines()]
                raw_exists = raw_path.exists()
                candidate_exists = candidate_path.exists()
        finally:
            self.fetcher.load_yf_finance_module = original_loader
            self.fetcher.YF_OUT_DIR = original_yf_out_dir
            self.fetcher.YF_ETF_DETAIL_OUT_DIR = original_yf_detail_out_dir
            self.fetcher.DATA_SUPPLY_STATE_ROOT = original_state_root

        self.assertFalse(raw_exists)
        self.assertFalse(candidate_exists)
        self.assertEqual(len(observations), 1)
        self.assertEqual(observations[0]["validation_status"], "invalid")
        self.assertIsNone(observations[0]["source_as_of"])
        self.assertEqual(observations[0]["provider_path"], "data/yf/finance/ADIU.json")

    def test_malformed_yahoo_container_still_records_invalid_observation(self) -> None:
        original_loader = self.fetcher.load_yf_finance_module
        original_yf_out_dir = self.fetcher.YF_OUT_DIR
        original_yf_detail_out_dir = self.fetcher.YF_ETF_DETAIL_OUT_DIR
        original_state_root = self.fetcher.DATA_SUPPLY_STATE_ROOT

        class FakeYahooModule:
            @staticmethod
            def fetch_with_retry(_ticker: str, profile: str = "etf", retries: int = 1, backoffs: tuple = (3,), include_evidence: bool = False):
                result = ({
                    "info": {"symbol": "ADIU", "quoteType": "ETF", "currentPrice": 10},
                    "funds_data": {"asset_classes": ["malformed"]},
                }, 10, None)
                return (*result, {"attempts_used": 1, "latency_ms": 10, "failures": []}) if include_evidence else result

        try:
            with tempfile.TemporaryDirectory() as tmp:
                temp_root = Path(tmp)
                self.fetcher.load_yf_finance_module = lambda: FakeYahooModule
                self.fetcher.YF_OUT_DIR = temp_root / "data" / "yf" / "finance"
                self.fetcher.YF_ETF_DETAIL_OUT_DIR = temp_root / "data" / "yf" / "etf-details"
                self.fetcher.DATA_SUPPLY_STATE_ROOT = temp_root / "data" / "admin" / "data-supply-state" / "v1"
                with self.assertRaisesRegex(ValueError, "asset_classes"):
                    self.fetcher.fetch_yahoo_etf_fallback("ADIU", mirror_public=False)
                history_files = list((self.fetcher.DATA_SUPPLY_STATE_ROOT / "history" / "observations").glob("*.jsonl"))
                observations = [json.loads(line) for line in history_files[0].read_text(encoding="utf-8").splitlines()]
                raw_exists = (self.fetcher.YF_OUT_DIR / "ADIU.json").exists()
                candidate_exists = (self.fetcher.YF_ETF_DETAIL_OUT_DIR / "ADIU.json").exists()
        finally:
            self.fetcher.load_yf_finance_module = original_loader
            self.fetcher.YF_OUT_DIR = original_yf_out_dir
            self.fetcher.YF_ETF_DETAIL_OUT_DIR = original_yf_detail_out_dir
            self.fetcher.DATA_SUPPLY_STATE_ROOT = original_state_root

        self.assertFalse(raw_exists)
        self.assertFalse(candidate_exists)
        self.assertEqual(len(observations), 1)
        self.assertEqual(observations[0]["validation_status"], "invalid")
        self.assertIsNone(observations[0]["source_as_of"])

    def test_undated_yahoo_candidate_records_source_unavailable_observation(self) -> None:
        original_loader = self.fetcher.load_yf_finance_module
        original_yf_out_dir = self.fetcher.YF_OUT_DIR
        original_yf_detail_out_dir = self.fetcher.YF_ETF_DETAIL_OUT_DIR
        original_state_root = self.fetcher.DATA_SUPPLY_STATE_ROOT

        class FakeYahooModule:
            @staticmethod
            def fetch_with_retry(_ticker: str, profile: str = "etf", retries: int = 1, backoffs: tuple = (3,), include_evidence: bool = False):
                result = ({
                    "info": {
                        "symbol": "ADIU",
                        "quoteType": "ETF",
                        "currentPrice": 10,
                        "previousClose": 9.5,
                    },
                    "funds_data": {"top_holdings": []},
                    "history_1y": [],
                }, 10, None)
                return (*result, {"attempts_used": 1, "latency_ms": 10, "failures": []}) if include_evidence else result

        try:
            with tempfile.TemporaryDirectory() as tmp:
                temp_root = Path(tmp)
                self.fetcher.load_yf_finance_module = lambda: FakeYahooModule
                self.fetcher.YF_OUT_DIR = temp_root / "data" / "yf" / "finance"
                self.fetcher.YF_ETF_DETAIL_OUT_DIR = temp_root / "data" / "yf" / "etf-details"
                self.fetcher.DATA_SUPPLY_STATE_ROOT = temp_root / "data" / "admin" / "data-supply-state" / "v1"
                with self.assertRaisesRegex(ValueError, "provider source date is unavailable"):
                    self.fetcher.fetch_yahoo_etf_fallback("ADIU", mirror_public=False)
                history_files = list((self.fetcher.DATA_SUPPLY_STATE_ROOT / "history" / "observations").glob("*.jsonl"))
                observations = [json.loads(line) for line in history_files[0].read_text(encoding="utf-8").splitlines()]
                raw_exists = (self.fetcher.YF_OUT_DIR / "ADIU.json").exists()
                candidate_exists = (self.fetcher.YF_ETF_DETAIL_OUT_DIR / "ADIU.json").exists()
        finally:
            self.fetcher.load_yf_finance_module = original_loader
            self.fetcher.YF_OUT_DIR = original_yf_out_dir
            self.fetcher.YF_ETF_DETAIL_OUT_DIR = original_yf_detail_out_dir
            self.fetcher.DATA_SUPPLY_STATE_ROOT = original_state_root

        self.assertFalse(raw_exists)
        self.assertFalse(candidate_exists)
        self.assertEqual(len(observations), 1)
        self.assertEqual(observations[0]["reason_code"], "source_date_unavailable")
        self.assertIsNone(observations[0]["source_as_of"])

    def test_etf_classification_separates_index_and_single_stock_leverage(self) -> None:
        index_etf = self.fetcher.classify_etf(
            {"ticker": "TQQQ", "name": "ProShares UltraPro QQQ"},
            overview={
                "description": (
                    "The fund provides 3x leveraged exposure to a modified "
                    "market-cap-weighted index tracking 100 of the largest firms."
                )
            },
            holdings=[],
        )
        single_stock = self.fetcher.classify_etf(
            {"ticker": "NVDL", "name": "GraniteShares 2x Long NVDA Daily ETF"},
            overview={
                "description": (
                    "The fund provides 2x leveraged exposure, less fees and expenses, "
                    "to the daily price movement for shares of NVIDIA Corporation stock."
                )
            },
            holdings=[],
        )
        inverse_1x = self.fetcher.classify_etf(
            {"ticker": "AAPD", "name": "Direxion Daily AAPL Bear 1X ETF"},
            overview={
                "description": (
                    "The fund provides inverse exposure to the daily price movement "
                    "for shares of Apple stock."
                )
            },
            holdings=[],
        )

        self.assertTrue(index_etf["is_leveraged"])
        self.assertEqual(index_etf["leverage_factor"], 3.0)
        self.assertFalse(index_etf["is_single_stock"])
        self.assertTrue(single_stock["is_leveraged"])
        self.assertEqual(single_stock["leverage_factor"], 2.0)
        self.assertTrue(single_stock["is_single_stock"])
        self.assertEqual(single_stock["underlying"], "NVIDIA Corporation")
        self.assertFalse(inverse_1x["is_leveraged"])
        self.assertTrue(inverse_1x["is_inverse"])
        self.assertFalse(inverse_1x["is_single_stock"])

    def test_etf_classification_ignores_short_maturity_terms(self) -> None:
        short_term_bond = self.fetcher.classify_etf(
            {"ticker": "BSV", "name": "Vanguard Short-Term Bond ETF"},
            overview={"description": "The fund invests in short-term investment-grade bonds."},
            holdings=[],
        )
        ultra_short_income = self.fetcher.classify_etf(
            {"ticker": "JPST", "name": "JPMorgan Ultra-Short Income ETF"},
            overview={"description": "The fund is an ultra short duration income ETF."},
            holdings=[],
        )
        vix_futures = self.fetcher.classify_etf(
            {"ticker": "VIXY", "name": "ProShares VIX Short-Term Futures ETF"},
            overview={"description": "The fund tracks VIX short-term futures contracts."},
            holdings=[],
        )
        ultra_short_treasury = self.fetcher.classify_etf(
            {"ticker": "VGUS", "name": "Vanguard Ultra-Short Treasury ETF"},
            overview={
                "description": (
                    "The fund is based on the Bloomberg Short Treasury index, "
                    "tracking US Treasurys with maturities of one to three months."
                )
            },
            holdings=[],
        )
        short_muni = self.fetcher.classify_etf(
            {"ticker": "SMB", "name": "VanEck Short Muni ETF"},
            overview={"description": "The fund tracks municipal bonds with nominal maturities of 1-6 years."},
            holdings=[],
        )
        short_high_yield_muni = self.fetcher.classify_etf(
            {"ticker": "SHYD", "name": "VanEck Short High Yield Muni ETF"},
            overview={"description": "The fund tracks high-yield municipal bonds with 1-12 years remaining in maturity."},
            holdings=[],
        )
        short_to_intermediate = self.fetcher.classify_etf(
            {"ticker": "TMNS", "name": "T. Rowe Price Short Municipal Income ETF"},
            overview={"description": "The fund invests in short- to intermediate-term investment grade municipal bonds."},
            holdings=[],
        )

        for classification in (
            short_term_bond,
            ultra_short_income,
            vix_futures,
            ultra_short_treasury,
            short_muni,
            short_high_yield_muni,
            short_to_intermediate,
        ):
            self.assertFalse(classification["is_leveraged"])
            self.assertIsNone(classification["leverage_factor"])
            self.assertFalse(classification["is_inverse"])

    def test_etf_classification_preserves_directional_short_products(self) -> None:
        short_sp500 = self.fetcher.classify_etf(
            {"ticker": "SH", "name": "ProShares Short S&P500"},
            overview={"description": "The fund seeks inverse exposure to the S&P 500."},
            holdings=[],
        )
        ultrapro_short = self.fetcher.classify_etf(
            {"ticker": "SQQQ", "name": "ProShares UltraPro Short QQQ"},
            overview={"description": "The fund provides 3x inverse daily exposure to the Nasdaq-100 Index."},
            holdings=[],
        )
        short_vix = self.fetcher.classify_etf(
            {"ticker": "SVXY", "name": "ProShares Short VIX Short-Term Futures ETF"},
            overview={"description": "The fund provides short exposure to VIX short-term futures."},
            holdings=[],
        )

        self.assertFalse(short_sp500["is_leveraged"])
        self.assertTrue(short_sp500["is_inverse"])
        self.assertTrue(ultrapro_short["is_leveraged"])
        self.assertEqual(ultrapro_short["leverage_factor"], 3.0)
        self.assertTrue(ultrapro_short["is_inverse"])
        self.assertFalse(short_vix["is_leveraged"])
        self.assertTrue(short_vix["is_inverse"])

    def test_enrolled_stock_success_records_exact_manual_object(self) -> None:
        original = (
            self.fetcher.OUT_DIR, self.fetcher.PUBLIC_DIR,
            self.fetcher.DATA_SUPPLY_STATE_ROOT, self.fetcher.fetch_stock,
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fetcher.OUT_DIR = root / "data" / "stockanalysis"
            self.fetcher.PUBLIC_DIR = root / "public" / "stockanalysis"
            self.fetcher.DATA_SUPPLY_STATE_ROOT = root / "state"
            self.fetcher.fetch_stock = lambda ticker, _timeout, _financials: {
                "schema_version": "stockanalysis/v1", "source": "stockanalysis",
                "asset_type": "stock", "ticker": ticker, "fetched_at": "2026-07-10T10:00:00Z",
                "normalized": {
                    "overview": {"marketCap": "1T"},
                    "quote": {"p": 500.0, "cl": 495.0, "symbol": ticker, "uid": ticker},
                    "history": [{"t": "2026-07-10", "c": 500.0}],
                },
            }
            try:
                result = self.fetcher.run_one("stock", "AAPL", 1, False)
            finally:
                (
                    self.fetcher.OUT_DIR, self.fetcher.PUBLIC_DIR,
                    self.fetcher.DATA_SUPPLY_STATE_ROOT, self.fetcher.fetch_stock,
                ) = original
            truth = root / "data" / "stockanalysis" / "stocks" / "AAPL.json"
            pending = root / "state" / "providers" / "stockanalysis" / "stock_detail" / "pending" / "AAPL.json"
            pointer = json.loads(pending.read_text())
            object_path = root / "state" / pointer["path"]
            observation = json.loads(next((root / "state" / "history" / "observations").glob("*.jsonl")).read_text())
            self.assertIsNone(result["error"])
            self.assertEqual(object_path.read_bytes(), truth.read_bytes())
            self.assertEqual(observation["observation_origin"], "rebuild")
            self.assertEqual(observation["collection_origin"], "manual")

    def test_unenrolled_stock_success_writes_truth_without_state(self) -> None:
        original = self.fetcher.fetch_stock
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            original_dirs = self.fetcher.OUT_DIR, self.fetcher.PUBLIC_DIR, self.fetcher.DATA_SUPPLY_STATE_ROOT
            self.fetcher.OUT_DIR = root / "data" / "stockanalysis"
            self.fetcher.PUBLIC_DIR = root / "public" / "stockanalysis"
            self.fetcher.DATA_SUPPLY_STATE_ROOT = root / "state"
            self.fetcher.fetch_stock = lambda ticker, _timeout, _financials: {
                "schema_version": "stockanalysis/v1", "source": "stockanalysis",
                "asset_type": "stock", "ticker": ticker, "fetched_at": "2026-07-10T10:00:00Z",
                "normalized": {"overview": {}, "quote": {}, "history": []},
            }
            try:
                result = self.fetcher.run_one("stock", "SPY", 1, False)
            finally:
                self.fetcher.fetch_stock = original
                self.fetcher.OUT_DIR, self.fetcher.PUBLIC_DIR, self.fetcher.DATA_SUPPLY_STATE_ROOT = original_dirs
            self.assertIsNone(result["error"])
            self.assertTrue((root / "data" / "stockanalysis" / "stocks" / "SPY.json").exists())
            self.assertFalse((root / "state").exists())

    def test_enrolled_stock_schema_failure_preserves_truth_and_records_invalid(self) -> None:
        original = self.fetcher.fetch_stock
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            original_dirs = self.fetcher.OUT_DIR, self.fetcher.PUBLIC_DIR, self.fetcher.DATA_SUPPLY_STATE_ROOT
            self.fetcher.OUT_DIR = root / "data" / "stockanalysis"
            self.fetcher.PUBLIC_DIR = root / "public" / "stockanalysis"
            self.fetcher.DATA_SUPPLY_STATE_ROOT = root / "state"
            truth = self.fetcher.OUT_DIR / "stocks" / "AAPL.json"
            truth.parent.mkdir(parents=True)
            sentinel = b'{"sentinel":true}\n'
            truth.write_bytes(sentinel)
            self.fetcher.fetch_stock = lambda ticker, _timeout, _financials: {
                "schema_version": "stockanalysis/v1", "source": "stockanalysis",
                "asset_type": "stock", "ticker": ticker, "fetched_at": "2026-07-10T10:00:00Z",
                "normalized": {"overview": {"ok": True}, "quote": {"p": 1, "symbol": ticker, "uid": ticker}, "history": [{}]},
            }
            try:
                result = self.fetcher.run_one("stock", "AAPL", 1, False)
            finally:
                self.fetcher.fetch_stock = original
                self.fetcher.OUT_DIR, self.fetcher.PUBLIC_DIR, self.fetcher.DATA_SUPPLY_STATE_ROOT = original_dirs
            observation = json.loads(next((root / "state" / "history" / "observations").glob("*.jsonl")).read_text())
            self.assertIsNotNone(result["error"])
            self.assertEqual(truth.read_bytes(), sentinel)
            self.assertEqual(observation["validation_status"], "invalid")
            self.assertFalse((root / "state" / "providers").exists())

    def test_enrolled_stock_network_failure_records_invalid_without_truth_write(self) -> None:
        original = self.fetcher.fetch_stock
        for failure, expected_reason in (
            (urllib.error.URLError("offline"), "fetch_failed"),
            (RuntimeError("adapter failed"), "fetch_failed"),
            (ValueError("decoded schema drift"), "schema_invalid"),
        ):
            with self.subTest(failure=type(failure).__name__), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                original_dirs = self.fetcher.OUT_DIR, self.fetcher.PUBLIC_DIR, self.fetcher.DATA_SUPPLY_STATE_ROOT
                self.fetcher.OUT_DIR = root / "data" / "stockanalysis"
                self.fetcher.PUBLIC_DIR = root / "public" / "stockanalysis"
                self.fetcher.DATA_SUPPLY_STATE_ROOT = root / "state"
                self.fetcher.fetch_stock = lambda *_args, _failure=failure, **_kwargs: (_ for _ in ()).throw(_failure)
                try:
                    result = self.fetcher.run_one("stock", "AAPL", 1, False)
                finally:
                    self.fetcher.fetch_stock = original
                    self.fetcher.OUT_DIR, self.fetcher.PUBLIC_DIR, self.fetcher.DATA_SUPPLY_STATE_ROOT = original_dirs
                observation = json.loads(next((root / "state" / "history" / "observations").glob("*.jsonl")).read_text())
                self.assertIsNotNone(result["error"])
                self.assertEqual(observation["reason_code"], expected_reason)
                self.assertFalse((root / "data" / "stockanalysis" / "stocks" / "AAPL.json").exists())

    def test_stock_controlled_failure_retains_lkg_then_real_fetch_recovers(self) -> None:
        original = self.fetcher.fetch_stock
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            original_dirs = self.fetcher.OUT_DIR, self.fetcher.PUBLIC_DIR, self.fetcher.DATA_SUPPLY_STATE_ROOT
            self.fetcher.OUT_DIR = root / "data" / "stockanalysis"
            self.fetcher.PUBLIC_DIR = root / "public" / "stockanalysis"
            self.fetcher.DATA_SUPPLY_STATE_ROOT = root / "data-supply-state"
            truth = self.fetcher.OUT_DIR / "stocks" / "AAPL.json"
            lkg_payload = {
                "schema_version": "stockanalysis/v1", "source": "stockanalysis",
                "asset_type": "stock", "ticker": "AAPL",
                "source_as_of": "2026-07-14T20:00:00Z", "fetched_at": "2026-07-14T21:00:00Z",
                "normalized": {"overview": {"marketCap": 1}, "quote": {"p": 10, "cl": 9, "symbol": "AAPL", "uid": "AAPL"}, "history": [{"t": "2026-07-14", "c": 10}]},
            }
            self.fetcher.write_json(truth, lkg_payload)
            expected_lkg = truth.read_bytes()
            store = self.fetcher.StockAnalysisRecoveryStateStore(
                root / "data" / "admin" / "stockanalysis-recovery", root
            )
            bootstrap = {"run_id": "bootstrap", "run_attempt": 1, "event_name": "local", "observed_at": "2026-07-15T07:00:00Z"}
            chaos = {"run_id": "chaos-1", "run_attempt": 1, "event_name": "workflow_dispatch", "observed_at": "2026-07-15T08:00:00Z"}
            recovery = {"run_id": "real-1", "run_attempt": 1, "event_name": "schedule", "observed_at": "2026-07-15T08:05:00Z"}
            store.bootstrap_existing(bootstrap)
            try:
                failed = self.fetcher.run_one(
                    "stock", "AAPL", 1, False,
                    recovery_store=store, recovery_run=chaos, controlled_failure=True,
                )
                self.assertIsNotNone(failed["error"])
                self.assertEqual(truth.read_bytes(), expected_lkg)
                self.assertEqual(
                    (store.root / "lkg" / "stock" / "AAPL.json").read_bytes(), expected_lkg
                )

                advanced = json.loads(json.dumps(lkg_payload))
                advanced["source_as_of"] = "2026-07-15T20:00:00Z"
                advanced["fetched_at"] = "2026-07-15T21:00:00Z"
                advanced["normalized"]["history"] = [{"t": "2026-07-15", "c": 11}]
                self.fetcher.fetch_stock = lambda *_args, **_kwargs: advanced
                succeeded = self.fetcher.run_one(
                    "stock", "AAPL", 1, False,
                    recovery_store=store, recovery_run=recovery,
                )
            finally:
                self.fetcher.fetch_stock = original
                self.fetcher.OUT_DIR, self.fetcher.PUBLIC_DIR, self.fetcher.DATA_SUPPLY_STATE_ROOT = original_dirs

            state = json.loads((store.root / "states" / "stock" / "AAPL.json").read_text())
            self.assertIsNone(succeeded["error"])
            self.assertEqual(state["resolution_state"], "fresh_primary")
            self.assertFalse(state["retry"])

    def test_stock_controlled_failure_also_retains_financial_lkg_and_retry(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            original_dirs = self.fetcher.OUT_DIR, self.fetcher.PUBLIC_DIR, self.fetcher.DATA_SUPPLY_STATE_ROOT
            self.fetcher.OUT_DIR = root / "data" / "stockanalysis"
            self.fetcher.PUBLIC_DIR = root / "public" / "stockanalysis"
            self.fetcher.DATA_SUPPLY_STATE_ROOT = root / "data-supply-state"
            stock_payload = {
                "schema_version": "stockanalysis/v1", "source": "stockanalysis",
                "asset_type": "stock", "ticker": "AAPL",
                "source_as_of": "2026-07-14T20:00:00Z", "fetched_at": "2026-07-14T21:00:00Z",
                "normalized": {
                    "overview": {},
                    "quote": {"symbol": "AAPL", "uid": "AAPL"},
                    "history": [{"t": "2026-07-14", "c": 10}],
                },
            }
            financial_payload = {
                "schema_version": "stockanalysis/v1", "source": "stockanalysis",
                "asset_type": "stock", "ticker": "AAPL",
                "fetched_at": "2026-07-14T21:00:00Z",
                "statements": {"annual": {"income": {"periods": ["2026-06-30"]}}},
            }
            stock_path = self.fetcher.OUT_DIR / "stocks" / "AAPL.json"
            financial_path = self.fetcher.OUT_DIR / "financials" / "AAPL.json"
            self.fetcher.write_json(stock_path, stock_payload)
            self.fetcher.write_json(financial_path, financial_payload)
            expected_financial_lkg = financial_path.read_bytes()
            store = self.fetcher.StockAnalysisRecoveryStateStore(
                root / "data" / "admin" / "stockanalysis-recovery", root
            )
            bootstrap = {"run_id": "bootstrap", "run_attempt": 1, "event_name": "local", "observed_at": "2026-07-15T07:00:00Z"}
            chaos = {"run_id": "chaos-financial", "run_attempt": 1, "event_name": "workflow_dispatch", "observed_at": "2026-07-15T08:00:00Z"}
            store.bootstrap_existing(bootstrap)
            try:
                failed = self.fetcher.run_one(
                    "stock", "AAPL", 1, False,
                    include_financials=True,
                    recovery_store=store,
                    recovery_run=chaos,
                    controlled_failure=True,
                )
                index = store.rebuild_index(chaos)
            finally:
                self.fetcher.OUT_DIR, self.fetcher.PUBLIC_DIR, self.fetcher.DATA_SUPPLY_STATE_ROOT = original_dirs

            financial_state = json.loads(
                (store.root / "states" / "financial" / "AAPL.json").read_text()
            )
            self.assertIsNotNone(failed["error"])
            self.assertEqual(financial_state["resolution_state"], "lkg_primary")
            self.assertTrue(financial_state["retry"])
            self.assertIn("controlled failure", financial_state["latest_failure"]["error"])
            self.assertEqual(
                (store.root / "lkg" / "financial" / "AAPL.json").read_bytes(),
                expected_financial_lkg,
            )
            self.assertIn(
                {"artifact_kind": "financial", "entity": "AAPL"},
                index["retry_artifacts"],
            )

    def test_upcoming_ipo_html_calendar_publishes_without_event_date_freshness(self):
        html = """<table><thead><tr><th>Symbol</th><th>Company Name</th><th>IPO Date</th></tr></thead>
        <tbody><tr><td>NEW</td><td>NewCo</td><td>Sep 30, 2099</td></tr></tbody></table>"""
        original_outputs = self.fetcher.current_candidate_outputs()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fetcher.install_candidate_outputs(self.fetcher.CandidateOutputs.from_root(root))
            try:
                with patch.object(self.fetcher, "now_iso", return_value="2026-07-15T07:00:00Z"):
                    payload = self.fetcher.build_table_surface_payload(
                        "ipos_calendar", self.fetcher.SURFACE_DEFINITIONS["ipos_calendar"], html)
                store = self.fetcher.StockAnalysisRecoveryStateStore(root / "data/admin/stockanalysis-recovery", root)
                with patch.object(self.fetcher, "fetch_table_surface_response", return_value=(payload, 200)):
                    summary = self.fetcher.fetch_surfaces(["ipos_calendar"], 1, 0, False,
                        recovery_store=store, recovery_run={"observed_at": "2026-07-15T07:00:00Z"})
                self.assertEqual(summary["counts"]["ok"], 1)
                canonical = json.loads((self.fetcher.OUT_DIR / "surfaces/ipos_calendar.json").read_bytes())
                self.assertEqual(canonical["tables"][0]["records"][0]["ipo_date"], "Sep 30, 2099")
                state = json.loads((store.root / "states/surface/ipos_calendar.json").read_bytes())
                self.assertIsNone(state["current"]["source_as_of"])
                self.assertEqual(state["current"]["fetched_at"], payload["fetched_at"])
            finally:
                self.fetcher.install_candidate_outputs(original_outputs)

    def test_surface_controlled_failure_retains_lkg_then_real_fetch_recovers(self) -> None:
        original = self.fetcher.fetch_svelte_surface_response
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            original_dirs = self.fetcher.OUT_DIR, self.fetcher.PUBLIC_DIR
            self.fetcher.OUT_DIR = root / "data" / "stockanalysis"
            self.fetcher.PUBLIC_DIR = root / "public" / "stockanalysis"
            name = "actions_recent"
            truth = self.fetcher.OUT_DIR / "surfaces" / f"{name}.json"
            lkg_payload = {
                "schema_version": "stockanalysis/v1", "source": "stockanalysis",
                "surface": name, "group": "events", "priority": "high", "role": "fixture",
                "source_as_of": None, "source_as_of_reason": "provider publishes no aggregate source date",
                "fetched_at": "2026-07-15T07:00:00Z", "endpoint": "/actions/", "url": "https://stockanalysis.com/actions/",
                "format": "html_table", "counts": {"tables": 1, "rows": 1}, "tables": [{"records": [{"symbol": "AAPL", "date": "Jul 14, 2026"}]}],
            }
            self.fetcher.write_json(truth, lkg_payload)
            expected_lkg = truth.read_bytes()
            store = self.fetcher.StockAnalysisRecoveryStateStore(
                root / "data" / "admin" / "stockanalysis-recovery", root
            )
            bootstrap = {"run_id": "bootstrap", "run_attempt": 1, "event_name": "local", "observed_at": "2026-07-15T07:00:00Z"}
            chaos = {"run_id": "chaos-2", "run_attempt": 1, "event_name": "workflow_dispatch", "observed_at": "2026-07-15T08:00:00Z"}
            recovery = {"run_id": "real-2", "run_attempt": 1, "event_name": "schedule", "observed_at": "2026-07-15T08:05:00Z"}
            store.bootstrap_existing(bootstrap)
            try:
                failed = self.fetcher.fetch_surfaces(
                    [name], 1, 0, False,
                    recovery_store=store, recovery_run=chaos,
                    controlled_failure_surfaces={name},
                )
                self.assertEqual(failed["counts"]["failed"], 1)
                self.assertEqual(truth.read_bytes(), expected_lkg)
                canonical_after_failure = json.loads(
                    (self.fetcher.OUT_DIR / "surfaces" / "index.json").read_text()
                )
                actions_row = next(
                    row for row in canonical_after_failure["results"]
                    if row["surface"] == name
                )
                self.assertEqual(actions_row["status"], "ok")
                self.assertEqual(actions_row["path"], f"surfaces/{name}.json")
                self.assertIsNone(actions_row["error"])
                self.assertEqual(
                    canonical_after_failure["latest_attempt"]["counts"]["failed"], 1
                )
                self.fetcher.fetch_svelte_surface_response = lambda *_args, **_kwargs: ({
                    **lkg_payload,
                    "fetched_at": "2026-07-15T08:05:00Z",
                    "tables": [{"records": [{"symbol": "MSFT", "date": "Jul 15, 2026"}]}],
                }, 200)
                succeeded = self.fetcher.fetch_surfaces(
                    [name], 1, 0, False,
                    recovery_store=store, recovery_run=recovery,
                )
            finally:
                self.fetcher.fetch_svelte_surface_response = original
                self.fetcher.OUT_DIR, self.fetcher.PUBLIC_DIR = original_dirs

            state = json.loads((store.root / "states" / "surface" / f"{name}.json").read_text())
            self.assertEqual(succeeded["counts"]["ok"], 1)
            self.assertEqual(state["resolution_state"], "fresh_primary")
            self.assertFalse(state["retry"])


if __name__ == "__main__":
    unittest.main()
