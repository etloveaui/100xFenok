#!/usr/bin/env python3

from __future__ import annotations

import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "sec13f"))

from archive import discover_filings, fetch_filing_components  # noqa: E402
from client import SecClient, SecClientError, validate_user_agent  # noqa: E402


class SliceAClientTest(unittest.TestCase):
    def test_identity_and_rate_contract_fail_closed(self) -> None:
        with self.assertRaises(SecClientError):
            validate_user_agent("contact@example.com")
        with self.assertRaises(SecClientError):
            SecClient(user_agent="Fenok ops@fenok.test", minimum_interval=0.01)

    def test_recent_and_history_shards_are_composed_and_sorted(self) -> None:
        responses = {
            "https://data.sec.gov/submissions/CIK0000000001.json": {
                "filings": {
                    "recent": {
                        "accessionNumber": ["0000000001-26-000002", "skip"],
                        "form": ["13F-HR/A", "10-K"],
                        "filingDate": ["2026-05-16", "2026-01-01"],
                        "reportDate": ["2026-03-31", "2025-12-31"],
                        "primaryDocument": ["primary.xml", "x.htm"],
                    },
                    "files": [{"name": "CIK0000000001-submissions-001.json"}],
                }
            },
            "https://data.sec.gov/submissions/CIK0000000001-submissions-001.json": {
                "accessionNumber": ["0000000001-25-000001"],
                "form": ["13F-HR"],
                "filingDate": ["2025-11-15"],
                "reportDate": ["2025-09-30"],
                "primaryDocument": ["primary.xml"],
            },
        }

        def transport(url, headers, _timeout):
            self.assertEqual(headers["Accept-Encoding"], "identity")
            return 200, json.dumps(responses[url]).encode()

        client = SecClient(user_agent="Fenok sec13f@fenok.test", transport=transport, sleep=lambda _value: None)
        filings = discover_filings(client, "0000000001")
        self.assertEqual([row.accession for row in filings], ["0000000001-25-000001", "0000000001-26-000002"])

    def test_archive_requires_primary_and_information_table(self) -> None:
        filing = discover_filings(
            SecClient(
                user_agent="Fenok sec13f@fenok.test",
                transport=lambda _url, _headers, _timeout: (200, json.dumps({
                    "filings": {"recent": {
                        "accessionNumber": ["0000000001-26-000001"], "form": ["13F-HR"],
                        "filingDate": ["2026-05-15"], "reportDate": ["2026-03-31"],
                        "primaryDocument": ["primary.xml"],
                    }, "files": []}
                }).encode()),
                sleep=lambda _value: None,
            ),
            "0000000001",
        )[0]
        base = "https://www.sec.gov/Archives/edgar/data/1/000000000126000001"
        responses = {
            f"{base}/index.json": json.dumps({"directory": {"item": [{"name": "primary.xml"}, {"name": "infotable.xml"}]}}).encode(),
            f"{base}/primary.xml": b"<cover/>",
            f"{base}/infotable.xml": b"<informationTable/>",
        }
        client = SecClient(user_agent="Fenok sec13f@fenok.test", transport=lambda url, _headers, _timeout: (200, responses[url]), sleep=lambda _value: None)
        components = fetch_filing_components(client, "0000000001", filing)
        self.assertEqual(components["information_table"], b"<informationTable/>")

    def test_retry_is_bounded_and_auth_does_not_retry(self) -> None:
        calls = []
        client = SecClient(user_agent="Fenok sec13f@fenok.test", transport=lambda *_args: (403, b"no"), sleep=lambda _value: None)
        client.transport = lambda *_args: (calls.append(1) or (403, b"no"))
        with self.assertRaises(SecClientError):
            client.get_bytes("https://data.sec.gov/x")
        self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()
