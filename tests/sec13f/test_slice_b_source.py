#!/usr/bin/env python3
"""RED-first cache-backed acquisition and zero-holding safety contract."""

from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts" / "sec13f"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from archive import ARCHIVE_BASE, Filing  # noqa: E402
from cache import RawCache, RawCacheError  # noqa: E402
from client import SecClient  # noqa: E402
from pipeline import PipelineError, UnitDecision, build_investor_run  # noqa: E402
from source import CachedFilingSource  # noqa: E402


CIK = "0000000001"
ACCESSION = "0000000001-26-000001"
FILING = Filing(
    accession=ACCESSION,
    form="13F-HR",
    filing_date="2026-05-15",
    report_date="2026-03-31",
    primary_document="primary.xml",
)
BASE = f"{ARCHIVE_BASE}/1/{ACCESSION.replace('-', '')}"
INDEX = json.dumps(
    {"directory": {"item": [{"name": "primary.xml"}, {"name": "infotable.xml"}]}}
).encode()
COVER = b"""<?xml version="1.0"?><edgarSubmission><summaryPage><tableEntryTotal>1</tableEntryTotal><tableValueTotal>1000</tableValueTotal><isConfidentialOmitted>false</isConfidentialOmitted></summaryPage></edgarSubmission>"""
TABLE = b"""<?xml version="1.0"?><informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable"><infoTable><nameOfIssuer>Alpha</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>000000AA1</cusip><value>1000</value><shrsOrPrnAmt><sshPrnamt>10</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt><investmentDiscretion>SOLE</investmentDiscretion><votingAuthority><Sole>10</Sole><Shared>0</Shared><None>0</None></votingAuthority></infoTable></informationTable>"""


def client(responses: dict[str, bytes], calls: list[str]) -> SecClient:
    def transport(url, _headers, _timeout):
        calls.append(url)
        if url not in responses:
            raise AssertionError(f"unexpected network call: {url}")
        return 200, responses[url]

    return SecClient.fixture(
        user_agent="Fenok source@fenok.test",
        transport=transport,
        sleep=lambda _seconds: None,
    )


class SliceBSourceTest(unittest.TestCase):
    def test_online_fill_then_offline_resume_uses_validated_raw_cache(self) -> None:
        responses = {
            f"{BASE}/index.json": INDEX,
            f"{BASE}/primary.xml": COVER,
            f"{BASE}/infotable.xml": TABLE,
        }
        with tempfile.TemporaryDirectory() as temporary_root:
            calls: list[str] = []
            cache = RawCache(Path(temporary_root))
            online = CachedFilingSource(
                cache=cache,
                client=client(responses, calls),
                filings_by_cik={CIK: [FILING]},
            )
            run = build_investor_run(
                client=None,
                filing_source=online,
                investor_id="synthetic",
                investor={"name": "Synthetic", "entity": "Synthetic", "cik": CIK, "group": "hedge"},
                reference_mapping={"000000AA1": {"ticker": "AAA", "sector": "Technology"}},
                unit_resolver=lambda _parsed: UnitDecision("thousands", "fixture", 1.0),
            )
            first = online.components(CIK, FILING)
            self.assertEqual(len(calls), 3)
            snapshot = online.acquisition_snapshot(
                registry_digest="a" * 64,
                investor_data={"synthetic": run},
            )
            self.assertEqual(snapshot.documents[0]["component_order"], 0)

            offline = CachedFilingSource(cache=cache, filings_by_cik={CIK: [FILING]})
            self.assertEqual(offline.discover(CIK), [FILING])
            self.assertEqual(offline.components(CIK, FILING), first)
            self.assertEqual(len(calls), 3)
            manifest = offline.ledger_document("synthetic", CIK, FILING)
            self.assertEqual(manifest["accession"], ACCESSION)
            self.assertEqual(
                {row["role"] for row in manifest["documents"]},
                {"archive_index", "primary", "information_table"},
            )

    def test_corrupt_cache_fails_closed_without_network_fallback(self) -> None:
        responses = {
            f"{BASE}/index.json": INDEX,
            f"{BASE}/primary.xml": COVER,
            f"{BASE}/infotable.xml": TABLE,
        }
        with tempfile.TemporaryDirectory() as temporary_root:
            calls: list[str] = []
            cache = RawCache(Path(temporary_root))
            source = CachedFilingSource(cache=cache, client=client(responses, calls))
            source.components(CIK, FILING)
            record = cache.load(cik=CIK, accession=ACCESSION)
            primary = next(row for row in record.manifest["documents"] if row["role"] == "primary")
            object_path = record.path / "objects" / primary["sha256"]
            object_path.chmod(0o644)
            object_path.write_bytes(b"X" * primary["bytes"])
            calls.clear()

            with self.assertRaises(RawCacheError) as raised:
                source.components(CIK, FILING)
            self.assertEqual(raised.exception.reason, "document_digest_mismatch")
            self.assertEqual(calls, [])

    def test_unexplained_zero_holdings_is_publish_blocking(self) -> None:
        zero_cover = b"""<?xml version="1.0"?><edgarSubmission><summaryPage><tableEntryTotal>0</tableEntryTotal><tableValueTotal>0</tableValueTotal><isConfidentialOmitted>false</isConfidentialOmitted></summaryPage></edgarSubmission>"""
        empty_table = b"""<?xml version="1.0"?><informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable"/>"""

        class ZeroSource:
            def discover(self, _cik):
                return [FILING]

            def components(self, _cik, _filing):
                return {"index.json": INDEX, "primary": zero_cover, "information_table": empty_table}

        with self.assertRaises(PipelineError) as raised:
            build_investor_run(
                client=None,
                filing_source=ZeroSource(),
                investor_id="synthetic",
                investor={
                    "name": "Synthetic",
                    "entity": "Synthetic",
                    "cik": CIK,
                    "group": "hedge",
                },
                reference_mapping={"000000AA1": {"ticker": "AAA", "sector": "Technology"}},
                unit_resolver=lambda _parsed: UnitDecision("thousands", "fixture", 1.0),
            )
        self.assertEqual(raised.exception.reason, "unexplained_zero_holdings")
        self.assertEqual(raised.exception.accession, ACCESSION)


if __name__ == "__main__":
    unittest.main()
