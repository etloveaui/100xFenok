"""SEC submissions and filing archive discovery for 13F-HR / 13F-HR/A."""

from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Iterable

from client import SecClient, SecClientError


FORMS = {"13F-HR", "13F-HR/A"}
SUBMISSIONS_BASE = "https://data.sec.gov/submissions"
ARCHIVE_BASE = "https://www.sec.gov/Archives/edgar/data"


@dataclass(frozen=True)
class Filing:
    accession: str
    form: str
    filing_date: str
    report_date: str
    primary_document: str


def _rows(recent: dict) -> Iterable[dict[str, str]]:
    required = ["accessionNumber", "form", "filingDate", "reportDate", "primaryDocument"]
    columns = {key: recent.get(key) for key in required}
    if any(not isinstance(value, list) for value in columns.values()):
        raise SecClientError("SEC submissions columns are missing")
    lengths = {len(value) for value in columns.values()}
    if len(lengths) != 1:
        raise SecClientError("SEC submissions columns have inconsistent lengths")
    for index in range(lengths.pop()):
        yield {key: columns[key][index] for key in required}


def discover_filings(client: SecClient, cik: str) -> list[Filing]:
    if len(cik) != 10 or not cik.isdigit():
        raise SecClientError("CIK must be exactly 10 digits")
    root = client.get_json(f"{SUBMISSIONS_BASE}/CIK{cik}.json")
    batches = [root.get("filings", {}).get("recent", {})]
    history = root.get("filings", {}).get("files", [])
    if not isinstance(history, list):
        raise SecClientError("SEC submissions history list is invalid")
    for entry in history:
        name = entry.get("name") if isinstance(entry, dict) else None
        if not isinstance(name, str) or not name.endswith(".json") or "/" in name:
            raise SecClientError("SEC submissions history shard name is unsafe")
        batches.append(client.get_json(f"{SUBMISSIONS_BASE}/{name}"))
    found: dict[str, Filing] = {}
    for batch in batches:
        for row in _rows(batch):
            if row["form"] not in FORMS:
                continue
            filing = Filing(
                accession=row["accessionNumber"],
                form=row["form"],
                filing_date=row["filingDate"],
                report_date=row["reportDate"],
                primary_document=row["primaryDocument"],
            )
            prior = found.get(filing.accession)
            if prior is not None and prior != filing:
                raise SecClientError(f"conflicting duplicate accession {filing.accession}")
            found[filing.accession] = filing
    return sorted(found.values(), key=lambda row: (row.report_date, row.filing_date, row.accession))


def filing_base_url(cik: str, accession: str) -> str:
    return f"{ARCHIVE_BASE}/{int(cik)}/{accession.replace('-', '')}"


def fetch_filing_documents(client: SecClient, cik: str, filing: Filing) -> list[dict[str, object]]:
    """Fetch one filing as role-addressed documents suitable for raw caching."""

    base = filing_base_url(cik, filing.accession)
    index_url = f"{base}/index.json"
    index_bytes = client.get_bytes(index_url)
    try:
        index = json.loads(index_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SecClientError(f"SEC archive index decode failed: {error}") from error
    if not isinstance(index, dict):
        raise SecClientError("SEC archive index root must be an object")
    items = index.get("directory", {}).get("item", [])
    if not isinstance(items, list):
        raise SecClientError("SEC archive index item list is missing")
    names = [row.get("name") for row in items if isinstance(row, dict)]
    safe_names = [name for name in names if isinstance(name, str) and name and "/" not in name and name not in {".", ".."}]
    primary = filing.primary_document if filing.primary_document in safe_names else None
    table = next((name for name in safe_names if name.lower().endswith((".xml", ".txt")) and "infotable" in name.lower()), None)
    if primary is None:
        raise SecClientError("SEC primary document is missing from archive index")
    if table is None:
        table = next((name for name in safe_names if name.lower().endswith(".xml") and name != primary), None)
    if table is None:
        raise SecClientError("SEC information table is missing from archive index")
    return [
        {"role": "archive_index", "name": "index.json", "url": index_url, "content": index_bytes},
        {
            "role": "primary",
            "name": primary,
            "url": f"{base}/{primary}",
            "content": client.get_bytes(f"{base}/{primary}"),
        },
        {
            "role": "information_table",
            "name": table,
            "url": f"{base}/{table}",
            "content": client.get_bytes(f"{base}/{table}"),
        },
    ]


def fetch_filing_components(client: SecClient, cik: str, filing: Filing) -> dict[str, bytes]:
    documents = fetch_filing_documents(client, cik, filing)
    by_role = {str(row["role"]): row["content"] for row in documents}
    return {
        "index.json": by_role["archive_index"],
        "primary": by_role["primary"],
        "information_table": by_role["information_table"],
    }
