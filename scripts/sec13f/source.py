#!/usr/bin/env python3
"""Cache-backed SEC filing source with explicit offline resume support."""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Mapping, Sequence

try:
    from .archive import Filing, discover_filings, fetch_filing_documents
    from .cache import RawCache, RawCacheError, RawCacheRecord
    from .client import SecClient
except ImportError:  # pragma: no cover - direct test imports
    from archive import Filing, discover_filings, fetch_filing_documents
    from cache import RawCache, RawCacheError, RawCacheRecord
    from client import SecClient


class CachedFilingSource:
    """Prefer validated immutable cache; network only fills a missing entry."""

    def __init__(
        self,
        *,
        cache: RawCache,
        client: SecClient | None = None,
        filings_by_cik: Mapping[str, Sequence[Filing]] | None = None,
    ) -> None:
        self.cache = cache
        self.client = client
        self._filings_by_cik = {
            cik: list(filings)
            for cik, filings in (filings_by_cik or {}).items()
        }
        self._records: dict[tuple[str, str], RawCacheRecord] = {}
        self._semantics: dict[tuple[str, str], dict[str, object]] = {}

    def discover(self, cik: str) -> list[Filing]:
        cached = self._filings_by_cik.get(cik)
        if cached is not None:
            return list(cached)
        if self.client is not None:
            filings = discover_filings(self.client, cik)
            self._filings_by_cik[cik] = list(filings)
            return filings
        filings = self._filings_by_cik.get(cik)
        if filings is None:
            raise RawCacheError("missing_cached_discovery", cik=cik)
        return list(filings)

    def _record(self, cik: str, filing: Filing) -> RawCacheRecord:
        key = (cik, filing.accession)
        try:
            record = self.cache.load(cik=cik, accession=filing.accession)
        except RawCacheError as error:
            if error.reason != "missing_cache_entry" or self.client is None:
                raise
            documents = fetch_filing_documents(self.client, cik, filing)
            record = self.cache.store(
                cik=cik,
                accession=filing.accession,
                documents=documents,
            )
        self._records[key] = record
        return record

    def components(self, cik: str, filing: Filing) -> dict[str, bytes]:
        record = self._record(cik, filing)
        return {
            "index.json": record.documents.get("archive_index", b""),
            "primary": record.documents["primary"],
            "information_table": record.documents["information_table"],
        }

    def record_semantics(
        self,
        cik: str,
        filing: Filing,
        *,
        amendment_type: str | None,
        amendment_number: int | None,
        component_order: int,
    ) -> None:
        self._semantics[(cik, filing.accession)] = {
            "amendment_type": amendment_type,
            "amendment_number": amendment_number,
            "component_order": component_order,
        }

    def ledger_document(
        self,
        investor_id: str,
        cik: str,
        filing: Filing,
        *,
        amendment_type: str | None = None,
        amendment_number: int | None = None,
        component_order: int = 0,
    ) -> dict:
        key = (cik, filing.accession)
        record = self._records.get(key) or self._record(cik, filing)
        semantics = self._semantics.get(key, {})
        entry_root = record.path.relative_to(self.cache.root).as_posix()
        documents = [
            {
                **deepcopy(row),
                "cache_path": str(Path(entry_root) / "objects" / row["sha256"]),
            }
            for row in record.manifest["documents"]
        ]
        return {
            "investor_id": investor_id,
            "cik": cik,
            "accession": filing.accession,
            "form": filing.form,
            "report_date": filing.report_date,
            "filing_date": filing.filing_date,
            "amendment_type": semantics.get("amendment_type", amendment_type),
            "amendment_number": semantics.get("amendment_number", amendment_number),
            "component_order": semantics.get("component_order", component_order),
            "documents": documents,
        }

    def acquisition_snapshot(self, *, registry_digest: str, investor_data: dict):
        """Bind successful parsed data to every cached discovered accession."""

        try:
            from .ledger import AcquisitionSnapshot
        except ImportError:  # pragma: no cover - direct test imports
            from ledger import AcquisitionSnapshot

        investor_by_cik = {
            row.get("cik"): investor_id
            for investor_id, row in investor_data.items()
            if isinstance(row, dict)
        }
        documents = []
        for cik, filings in sorted(self._filings_by_cik.items()):
            investor_id = investor_by_cik.get(cik)
            if not isinstance(investor_id, str):
                raise RawCacheError("missing_investor_for_cached_discovery", cik=cik)
            for filing in filings:
                if (cik, filing.accession) not in self._semantics:
                    raise RawCacheError(
                        "missing_parsed_filing_semantics",
                        cik=cik,
                        accession=filing.accession,
                    )
                documents.append(self.ledger_document(investor_id, cik, filing))
        return AcquisitionSnapshot(
            registry_digest=registry_digest,
            investor_data=investor_data,
            documents=documents,
        )


__all__ = ["CachedFilingSource"]
