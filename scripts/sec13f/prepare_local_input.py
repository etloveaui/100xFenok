#!/usr/bin/env python3
"""Prepare one generator-safe SEC 13F input from explicit local artifacts.

This is the Slice C0 boundary: it only reads a retained ``RawCache``, a
versioned filing/unit manifest, and a versioned CUSIP reference mapping.  It
never creates a SEC client, performs a network request, generates the 73 base
outputs, or touches canonical/public SEC 13F data.
"""

from __future__ import annotations

import argparse
from datetime import date
import hashlib
import json
import os
from pathlib import Path
import re
from typing import Any, Mapping, Sequence

import yaml

try:
    from .archive import FORMS, Filing
    from .cache import RawCache, RawCacheError
    from .input_adapter import InputAdapterError, prepare_investor_data
    from .ledger import LedgerError
    from .pipeline import PipelineError, UnitDecision, build_investor_runs
    from .source import CachedFilingSource
except ImportError:  # pragma: no cover - direct script import path
    from archive import FORMS, Filing
    from cache import RawCache, RawCacheError
    from input_adapter import InputAdapterError, prepare_investor_data
    from ledger import LedgerError
    from pipeline import PipelineError, UnitDecision, build_investor_runs
    from source import CachedFilingSource


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_REGISTRY_PATH = ROOT / "scripts" / "sec13f" / "config" / "investors.yaml"
LOCAL_INPUT_SCHEMA = "sec13f-local-input/v1"
PREPARED_INPUT_SCHEMA = "sec13f-local-prepared-input/v1"
ACCESSION_PATTERN = re.compile(r"^(\d{10})-\d{2}-\d{6}$")
PROTECTED_OUTPUT_ROOTS = (
    ROOT / "data" / "sec-13f",
    ROOT / "100xfenok-next" / "public" / "data" / "sec-13f",
)
MANIFEST_KEYS = frozenset(
    {"schema_version", "registry_sha256", "filings", "unit_decisions", "content_digest"}
)
FILING_KEYS = frozenset(
    {
        "investor_id",
        "cik",
        "accession",
        "form",
        "filing_date",
        "report_date",
        "primary_document",
    }
)
UNIT_DECISION_KEYS = frozenset({"cik", "accession", "unit", "evidence", "confidence"})


class LocalInputError(ValueError):
    """A local SEC 13F input is incomplete, unsafe, or non-reproducible."""


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
        allow_nan=False,
    ).encode("utf-8")


def _digest(value: Any) -> str:
    return hashlib.sha256(_canonical_bytes(value)).hexdigest()


def _file_digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _json_object(path: Path, *, label: str) -> dict[str, Any]:
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise LocalInputError(f"{label} must be a regular file: {path}")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise LocalInputError(f"{label} is not valid JSON: {path}") from error
    if not isinstance(payload, dict):
        raise LocalInputError(f"{label} must be a JSON object")
    return payload


def _safe_name(value: Any, *, label: str) -> str:
    if (
        not isinstance(value, str)
        or not value
        or value in {".", ".."}
        or Path(value).name != value
        or "/" in value
        or "\\" in value
    ):
        raise LocalInputError(f"{label} must be a safe filename")
    return value


def _iso_date(value: Any, *, label: str) -> str:
    if not isinstance(value, str):
        raise LocalInputError(f"{label} must be an ISO date")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as error:
        raise LocalInputError(f"{label} must be an ISO date") from error
    if parsed.isoformat() != value:
        raise LocalInputError(f"{label} must use canonical YYYY-MM-DD form")
    return value


def _load_registry(path: Path) -> tuple[dict[str, Any], str]:
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise LocalInputError(f"registry must be a regular file: {path}")
    try:
        registry = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, yaml.YAMLError) as error:
        raise LocalInputError(f"registry is unreadable: {path}") from error
    if not isinstance(registry, dict):
        raise LocalInputError("registry must be a mapping")
    investors = registry.get("investors")
    groups = registry.get("groups")
    if not isinstance(investors, dict) or not isinstance(groups, dict) or len(investors) != 60:
        raise LocalInputError("registry must declare exactly 60 investors and groups")
    seen_ciks: set[str] = set()
    for investor_id, investor in investors.items():
        if not isinstance(investor_id, str) or not investor_id or not isinstance(investor, dict):
            raise LocalInputError("registry has an invalid investor record")
        cik = investor.get("cik")
        if not isinstance(cik, str) or not re.fullmatch(r"\d{10}", cik) or cik in seen_ciks:
            raise LocalInputError(f"registry has an invalid or duplicate CIK: {investor_id}")
        seen_ciks.add(cik)
        if investor.get("active") is not True or investor.get("group") not in groups:
            raise LocalInputError(f"registry has inactive or ungrouped investor: {investor_id}")
        if any(not isinstance(investor.get(field), str) or not investor[field] for field in ("name", "entity")):
            raise LocalInputError(f"registry has incomplete identity: {investor_id}")
    return registry, _file_digest(path)


def _load_reference_mapping(path: Path) -> tuple[dict[str, dict[str, str]], str]:
    payload = _json_object(Path(path), label="reference mapping")
    output: dict[str, dict[str, str]] = {}
    for cusip, reference in payload.items():
        if not isinstance(cusip, str) or not cusip.strip() or not isinstance(reference, Mapping):
            raise LocalInputError("reference mapping entries require a CUSIP object")
        ticker = reference.get("ticker")
        sector = reference.get("sector")
        if not isinstance(ticker, str) or not ticker.strip() or not isinstance(sector, str) or not sector.strip():
            raise LocalInputError(f"reference mapping is incomplete for CUSIP: {cusip}")
        output[cusip] = {"ticker": ticker.strip(), "sector": sector.strip()}
    if not output:
        raise LocalInputError("reference mapping must not be empty")
    return output, _file_digest(Path(path))


def _filing_sort_key(row: Mapping[str, Any]) -> tuple[str, str, str, str]:
    return (
        str(row["investor_id"]),
        str(row["report_date"]),
        str(row["filing_date"]),
        str(row["accession"]),
    )


def _decision_sort_key(row: Mapping[str, Any]) -> tuple[str, str]:
    return str(row["cik"]), str(row["accession"])


def _load_manifest(path: Path, *, registry: Mapping[str, Any], registry_digest: str) -> tuple[dict[str, list[Filing]], dict[tuple[str, str], UnitDecision], str]:
    payload = _json_object(Path(path), label="local input manifest")
    if set(payload) != MANIFEST_KEYS:
        raise LocalInputError("local input manifest has an unsupported field set")
    if payload.get("schema_version") != LOCAL_INPUT_SCHEMA:
        raise LocalInputError("local input manifest schema is unsupported")
    if payload.get("content_digest") != _digest({key: value for key, value in payload.items() if key != "content_digest"}):
        raise LocalInputError("local input manifest content digest mismatch")
    if payload.get("registry_sha256") != registry_digest:
        raise LocalInputError("local input manifest registry digest mismatch")

    investors = registry["investors"]
    filings = payload.get("filings")
    if not isinstance(filings, list) or not filings:
        raise LocalInputError("local input manifest filings must be a non-empty list")
    if any(not isinstance(row, dict) or set(row) != FILING_KEYS for row in filings):
        raise LocalInputError("local input manifest filings have an unsupported field set")
    if filings != sorted(filings, key=_filing_sort_key):
        raise LocalInputError("local input manifest filings must use canonical order")

    by_cik: dict[str, list[Filing]] = {row["cik"]: [] for row in investors.values()}
    filing_keys: set[tuple[str, str]] = set()
    investor_ids: set[str] = set()
    for index, row in enumerate(filings):
        investor_id = row.get("investor_id")
        if not isinstance(investor_id, str) or investor_id not in investors:
            raise LocalInputError(f"filings[{index}] has an unknown investor")
        registered = investors[investor_id]
        cik = row.get("cik")
        if cik != registered["cik"]:
            raise LocalInputError(f"filings[{index}] CIK does not match registry")
        accession = row.get("accession")
        match = ACCESSION_PATTERN.fullmatch(accession) if isinstance(accession, str) else None
        if match is None or match.group(1) != cik:
            raise LocalInputError(f"filings[{index}] has an invalid accession")
        form = row.get("form")
        if form not in FORMS:
            raise LocalInputError(f"filings[{index}] has an unsupported form")
        filing_date = _iso_date(row.get("filing_date"), label=f"filings[{index}].filing_date")
        report_date = _iso_date(row.get("report_date"), label=f"filings[{index}].report_date")
        if report_date > filing_date:
            raise LocalInputError(f"filings[{index}] report date must not follow filing date")
        _safe_name(row.get("primary_document"), label=f"filings[{index}].primary_document")
        key = (cik, accession)
        if key in filing_keys:
            raise LocalInputError(f"local input manifest has duplicate filing: {cik}/{accession}")
        filing_keys.add(key)
        investor_ids.add(investor_id)
        by_cik[cik].append(
            Filing(
                accession=accession,
                form=form,
                filing_date=filing_date,
                report_date=report_date,
                primary_document=row["primary_document"],
            )
        )
    if investor_ids != set(investors):
        raise LocalInputError("local input manifest filings must cover all 60 registry investors")

    raw_decisions = payload.get("unit_decisions")
    if not isinstance(raw_decisions, list) or not raw_decisions:
        raise LocalInputError("local input manifest unit decisions must be a non-empty list")
    if any(not isinstance(row, dict) or set(row) != UNIT_DECISION_KEYS for row in raw_decisions):
        raise LocalInputError("local input manifest unit decisions have an unsupported field set")
    if raw_decisions != sorted(raw_decisions, key=_decision_sort_key):
        raise LocalInputError("local input manifest unit decisions must use canonical order")
    decisions: dict[tuple[str, str], UnitDecision] = {}
    for index, row in enumerate(raw_decisions):
        cik = row.get("cik")
        accession = row.get("accession")
        key = (cik, accession)
        if key not in filing_keys or key in decisions:
            raise LocalInputError("local input manifest unit decisions must match filings exactly")
        unit = row.get("unit")
        evidence = row.get("evidence")
        confidence = row.get("confidence")
        if unit not in {"dollars", "thousands"}:
            raise LocalInputError(f"unit_decisions[{index}].unit is invalid")
        if not isinstance(evidence, str) or not evidence.strip():
            raise LocalInputError(f"unit_decisions[{index}].evidence is required")
        if isinstance(confidence, bool) or not isinstance(confidence, (int, float)) or not 0.5 <= confidence <= 1:
            raise LocalInputError(f"unit_decisions[{index}].confidence is invalid")
        decisions[key] = UnitDecision(unit=unit, evidence=evidence.strip(), confidence=float(confidence))
    if set(decisions) != filing_keys:
        raise LocalInputError("local input manifest unit decisions must match filings exactly")
    return by_cik, decisions, _file_digest(Path(path))


def _validate_cache_binding(
    *,
    cache: RawCache,
    filings_by_cik: Mapping[str, Sequence[Filing]],
) -> None:
    for cik, filings in sorted(filings_by_cik.items()):
        for filing in filings:
            try:
                record = cache.load(cik=cik, accession=filing.accession)
            except RawCacheError as error:
                raise LocalInputError(f"raw cache is unavailable for {cik}/{filing.accession}: {error.reason}") from error
            primary = next((row for row in record.manifest["documents"] if row["role"] == "primary"), None)
            if primary is None or primary.get("name") != filing.primary_document:
                raise LocalInputError(f"raw cache primary document mismatch: {cik}/{filing.accession}")


def _prepared_payload(
    *,
    registry_digest: str,
    manifest_digest: str,
    reference_mapping_digest: str,
    investor_data: dict[str, Any],
    documents: list[dict[str, Any]],
    source_set_digest: str,
) -> dict[str, Any]:
    payload = {
        "schema_version": PREPARED_INPUT_SCHEMA,
        "registry_sha256": registry_digest,
        "input_manifest_sha256": manifest_digest,
        "reference_mapping_sha256": reference_mapping_digest,
        "investor_count": len(investor_data),
        "filing_count": sum(len(row["filings"]) for row in investor_data.values()),
        "investors_data": investor_data,
        "documents": documents,
        "source_set_digest": source_set_digest,
    }
    return {**payload, "content_digest": _digest(payload)}


def build_prepared_input(
    *,
    manifest_path: Path,
    registry_path: Path = DEFAULT_REGISTRY_PATH,
    reference_mapping_path: Path,
    cache_root: Path,
) -> dict[str, Any]:
    """Read only local artifacts and return generator-safe investor input.

    ``client=None`` is intentional.  The resulting source can only read
    validated cache records and cannot fall back to SEC or any other network.
    """

    registry, registry_digest = _load_registry(Path(registry_path))
    reference_mapping, reference_digest = _load_reference_mapping(Path(reference_mapping_path))
    filings_by_cik, decisions, manifest_digest = _load_manifest(
        Path(manifest_path), registry=registry, registry_digest=registry_digest
    )
    try:
        cache = RawCache(Path(cache_root))
        _validate_cache_binding(cache=cache, filings_by_cik=filings_by_cik)
        source = CachedFilingSource(
            cache=cache,
            client=None,
            filings_by_cik=filings_by_cik,
        )
        decisions_by_accession = {
            accession: decision for (_cik, accession), decision in decisions.items()
        }
        if len(decisions_by_accession) != len(decisions):
            raise LocalInputError("local input manifest has ambiguous accession unit decisions")

        def unit_resolver(parsed: dict[str, Any]) -> UnitDecision:
            accession = parsed.get("accession")
            if not isinstance(accession, str):
                raise LocalInputError("parsed filing accession is missing")
            decision = decisions_by_accession.get(accession)
            if decision is None:
                raise LocalInputError(f"unit decision is missing for accession: {accession}")
            return decision

        runs = build_investor_runs(
            client=None,
            filing_source=source,
            registry=registry,
            reference_mapping=reference_mapping,
            unit_resolver=unit_resolver,
        )
        investor_data = prepare_investor_data(registry, runs)
        snapshot = source.acquisition_snapshot(
            registry_digest=registry_digest,
            investor_data=investor_data,
        ).validated()
    except (RawCacheError, PipelineError, InputAdapterError, LedgerError) as error:
        raise LocalInputError(f"local SEC 13F preparation failed: {error}") from error
    return _prepared_payload(
        registry_digest=registry_digest,
        manifest_digest=manifest_digest,
        reference_mapping_digest=reference_digest,
        investor_data=investor_data,
        documents=snapshot["documents"],
        source_set_digest=snapshot["source_set_digest"],
    )


def _assert_safe_output(path: Path, *, cache_root: Path) -> Path:
    requested = Path(path)
    if ".." in requested.parts:
        raise LocalInputError("output must not contain parent traversal")
    absolute = requested if requested.is_absolute() else Path.cwd() / requested
    current = Path(absolute.anchor)
    for component in absolute.parts[1:]:
        current /= component
        if current.is_symlink():
            raise LocalInputError("output path must not contain symlinks")
    output = absolute.resolve()
    if output.name in {"", ".", ".."}:
        raise LocalInputError("output must be a file path")
    for protected in (*PROTECTED_OUTPUT_ROOTS, Path(cache_root)):
        protected = protected.resolve()
        if output == protected or protected in output.parents:
            raise LocalInputError(f"output overlaps protected data tree: {protected}")
    if output.exists() and not output.is_file():
        raise LocalInputError("existing output must be a regular file")
    return output


def write_prepared_input(*, payload: Mapping[str, Any], output_path: Path, cache_root: Path, overwrite: bool = False) -> Path:
    """Atomically write an explicit noncanonical artifact, never a data payload."""

    output = _assert_safe_output(Path(output_path), cache_root=Path(cache_root))
    if output.exists() and not overwrite:
        raise LocalInputError(f"output already exists (use --overwrite): {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False).encode("utf-8") + b"\n"
    temporary = output.with_name(f".{output.name}.{os.getpid()}.tmp")
    try:
        with temporary.open("xb") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, output)
    finally:
        if temporary.exists():
            temporary.unlink()
    return output


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True, help="local SEC filing/unit manifest JSON")
    parser.add_argument("--registry", type=Path, default=DEFAULT_REGISTRY_PATH)
    parser.add_argument("--reference-mapping", type=Path, required=True, help="CUSIP-to-ticker/sector JSON")
    parser.add_argument("--cache-root", type=Path, required=True, help="immutable RawCache root")
    parser.add_argument("--output", type=Path, required=True, help="explicit noncanonical prepared-input JSON")
    parser.add_argument("--overwrite", action="store_true", help="replace an existing explicit output atomically")
    args = parser.parse_args(argv)
    payload = build_prepared_input(
        manifest_path=args.manifest,
        registry_path=args.registry,
        reference_mapping_path=args.reference_mapping,
        cache_root=args.cache_root,
    )
    output = write_prepared_input(
        payload=payload,
        output_path=args.output,
        cache_root=args.cache_root,
        overwrite=args.overwrite,
    )
    print(json.dumps({
        "output": str(output),
        "investor_count": payload["investor_count"],
        "filing_count": payload["filing_count"],
        "source_set_digest": payload["source_set_digest"],
    }, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except LocalInputError as error:
        raise SystemExit(f"SEC 13F local input blocked: {error}") from error
