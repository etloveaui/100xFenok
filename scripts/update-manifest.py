#!/usr/bin/env python3
"""
update-manifest.py — Automatic manifest.json updater

Automatically keeps manifest.json in sync with the actual data/ folder state.

What this script updates:
  - file_count  : actual JSON file count per folder (schema.json excluded)
  - updated     : the complete source floor: the oldest of each required input's
                  latest honest source/observation date. Build/collection clocks
                  are never promoted. Missing source dates become null with
                  `updated_reason`.
  - last_updated: root-level metadata (manifest rebuild day)
  - generatedAt : UTC snapshot timestamp for the manifest
  - categories  : MCP-facing hybrid registry derived from legacy folders
  - manifest_version: bumped once when the hybrid registry is introduced

What this script never rewrites:
  - update_frequency, source, schema, description, except when a known default
    folder is explicitly promoted to a newer schema/default version
  - existing recent_changes entries (it only inserts the one-time hybrid note)

New folder behavior:
  - Auto-discovers folders not in manifest → adds default entry
  - Requires manual fill-in: update_frequency, source, description

Usage:
  python scripts/update-manifest.py           # normal run
  python scripts/update-manifest.py --dry-run # preview only, no file write

Exit codes:
  0 = success (no warnings)
  1 = success with warnings (orphan files or missing folders)
"""

import json
import os
import subprocess
import sys
from datetime import date, datetime, timezone
from pathlib import Path


# ─── Constants ────────────────────────────────────────────────────────────────

CATEGORY_ORDER = (
    "computed",
    "calendar",
    "sentiment",
    "slickcharts",
    "stockanalysis",
    "yf",
    "sec-13f",
    "benchmarks",
    "damodaran",
    "indices",
    "global-scouter",
    "macro",
    "yardney",
)

HYBRID_MANIFEST_VERSION = "1.1.0"
EXCLUDED_CATEGORIES = {"admin"}
DEFAULT_FOLDER_META = {
    "computed": {
        "version": "1.0.0",
        "update_frequency": "after source data refresh",
        "source": "Macro Monitor computed signal export",
        "schema": False,
        "description": "Deterministic computed signals and normalized market facts derived from macro, sentiment, Yahoo, StockAnalysis, and SlickCharts data.",
    },
    "calendar": {
        "version": "1.0.0",
        "update_frequency": "daily / on calendar edit",
        "source": "BujaBot USD Google Calendar",
        "schema": True,
        "description": "Verified USD macro, Fed policy, filing, and market calendar events mirrored from BujaBot Google Calendar.",
    },
    "stockanalysis": {
        "version": "1.1.0",
        "update_frequency": "weekly / on-demand",
        "source": "StockAnalysis public JSON, Svelte/devalue payloads, and HTML tables",
        "schema": True,
        "description": "ETF holdings, ETF metadata, quote/history cross-checks, stock financial statement candidates, stock overview snapshots, and market event surfaces.",
    },
    "edgar": {
        "version": "1.0.0",
        "update_frequency": "weekly / on-demand",
        "source": "SEC company_tickers.json",
        "schema": True,
        "description": "Normalized SEC ticker-to-CIK cache used by the EDGAR filing timeline builder.",
    },
    "edgar-korean-summaries": {
        "version": "1.0.0",
        "update_frequency": "weekly / on-demand",
        "source": "SEC EDGAR submissions and feno-edgar Korean summary artifacts",
        "schema": True,
        "description": "Ticker availability index, ticker-level SEC filing timeline manifests, original filing links, and Korean summary artifacts when available.",
    },
}

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent          # scripts/ → repo root
DATA_DIR = REPO_ROOT / "data"
MANIFEST = DATA_DIR / "manifest.json"
NEXT_MANIFEST = REPO_ROOT / "100xfenok-next" / "public" / "data" / "manifest.json"

# JSON files excluded from count (metadata files, not data)
EXCLUDE_FILES = {"schema.json"}

# Root-level names that are NOT orphan data files
ROOT_KNOWN = {
    "manifest.json",
    "README.md",
}


# ─── Helpers ──────────────────────────────────────────────────────────────────


def parse_semver(version: str | None) -> tuple[int, int, int]:
    """Parse a loose semver string into a comparable tuple."""
    if not version:
        return (0, 0, 0)

    parts = version.split(".")
    parsed: list[int] = []

    for part in parts[:3]:
        token = part.split("-")[0]
        try:
            parsed.append(int(token))
        except ValueError:
            parsed.append(0)

    while len(parsed) < 3:
        parsed.append(0)

    return (parsed[0], parsed[1], parsed[2])


def count_data_files(folder: Path) -> int:
    """Count all .json files under folder recursively, excluding schema.json."""
    return sum(
        1 for file_path in folder.rglob("*.json")
        if file_path.name not in EXCLUDE_FILES
    )


def read_schema_version(folder: Path, fallback: str) -> str:
    """Read the per-folder schema version, falling back to the manifest version."""
    schema_path = folder / "schema.json"
    try:
        with open(schema_path, encoding="utf-8") as f:
            schema = json.load(f)
    except Exception:
        return fallback

    version = schema.get("version")
    if isinstance(version, str) and version.strip():
        return version

    return fallback


def refresh_default_folder_metadata(
    folder_name: str,
    folder_path: Path,
    entry: dict[str, object],
) -> list[str]:
    """Promote known folder metadata when the checked-in schema/default advances."""
    defaults = DEFAULT_FOLDER_META.get(folder_name)
    if not defaults:
        return []

    current_version = str(entry.get("version") or "0.0.0")
    default_version = str(defaults.get("version") or "1.0.0")
    schema_version = (
        read_schema_version(folder_path, default_version)
        if defaults.get("schema")
        else default_version
    )
    target_version = max(
        (current_version, default_version, schema_version),
        key=parse_semver,
    )

    reasons: list[str] = []
    for key in ("update_frequency", "source", "description"):
        default_value = defaults.get(key)
        current_value = entry.get(key)
        is_generic_frequency = key == "update_frequency" and current_value == "on-demand" and default_value != "on-demand"
        if isinstance(default_value, str) and (not current_value or current_value == "TBD" or is_generic_frequency):
            entry[key] = default_value
            reasons.append(f"{key} filled")
    if defaults.get("schema") is True and entry.get("schema") is not True:
        entry["schema"] = True
        reasons.append("schema enabled")

    if parse_semver(target_version) > parse_semver(current_version):
        entry["version"] = target_version
        reasons.append(f"version {current_version}→{target_version}")

        default_description = defaults.get("description")
        if isinstance(default_description, str) and entry.get("description") != default_description:
            entry["description"] = default_description
            reasons.append("description refreshed")

    return reasons


NO_AGGREGATE_SOURCE_DATE = "no aggregate source date is published for this folder"
SourceClock = tuple[str | None, str | None]


def _coerce_date_str(value: object) -> str | None:
    """Pull a YYYY-MM-DD prefix out of a scalar if it looks like a date/timestamp."""
    if not isinstance(value, str):
        return None
    text = value.strip()
    # Accept ISO date / datetime ("2026-06-05", "2026-06-05T23:59:52+00:00",
    # "2026-05-11 17:31") — require the YYYY-MM-DD shape up front.
    if len(text) >= 10 and text[4] == "-" and text[7] == "-":
        head = text[:10]
        y, m, d = head[:4], head[5:7], head[8:10]
        if y.isdigit() and m.isdigit() and d.isdigit():
            try:
                date.fromisoformat(head)
            except ValueError:
                return None
            return head
    for fmt in ("%B %d, %Y", "%b %d, %Y", "%B %Y", "%b %Y"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _read_json(file_path: Path) -> object | None:
    """Read JSON without converting a malformed present file into 'unknown'."""
    try:
        with open(file_path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return None


def _latest_row_date(rows: object, *keys: str) -> str | None:
    if not isinstance(rows, list):
        return None
    dates = [
        parsed
        for row in rows
        if isinstance(row, dict)
        for key in keys
        if (parsed := _coerce_date_str(row.get(key))) is not None
    ]
    return max(dates) if dates else None


def _complete_floor(named_dates: list[tuple[str, str | None]], label: str) -> SourceClock:
    """Return the oldest latest-date only when every required source is dated."""
    if not named_dates:
        return None, f"{label} declares no required source inputs"

    missing = [name for name, source_date in named_dates if source_date is None]
    if missing:
        preview = ", ".join(missing[:4])
        suffix = f" (+{len(missing) - 4} more)" if len(missing) > 4 else ""
        return None, f"source date unavailable for required {label}: {preview}{suffix}"

    return min(source_date for _, source_date in named_dates if source_date is not None), None


def _schema_file_names(folder: Path) -> list[str]:
    schema = _read_json(folder / "schema.json")
    files = schema.get("files") if isinstance(schema, dict) else None
    return sorted(name for name in files if isinstance(name, str)) if isinstance(files, dict) else []


def _benchmark_clock(folder: Path) -> SourceClock:
    files = [name for name in _schema_file_names(folder) if name != "summaries.json"]
    file_dates: list[tuple[str, str | None]] = []
    for file_name in files:
        payload = _read_json(folder / file_name)
        sections = payload.get("sections") if isinstance(payload, dict) else None
        section_items = sections.items() if isinstance(sections, dict) else []
        section_dates = [
            (f"{file_name}:{section_name}", _latest_row_date(section.get("data"), "date"))
            for section_name, section in section_items
            if isinstance(section, dict)
        ]
        file_date, _ = _complete_floor(section_dates, f"benchmark sections in {file_name}")
        file_dates.append((file_name, file_date))
    return _complete_floor(file_dates, "benchmark files")


def _damodaran_clock(folder: Path) -> SourceClock:
    named_dates: list[tuple[str, str | None]] = []
    for file_name in _schema_file_names(folder):
        payload = _read_json(folder / file_name)
        metadata = payload.get("metadata") if isinstance(payload, dict) else None
        source_date = metadata.get("source_date") if isinstance(metadata, dict) else None
        named_dates.append((file_name, _coerce_date_str(source_date)))
    return _complete_floor(named_dates, "Damodaran files")


def _global_scouter_clock(folder: Path) -> SourceClock:
    required = (
        "core/metadata.json",
        "core/stocks_index.json",
        "etfs/index.json",
        "indicators/economic.json",
        "raw/manifest.json",
    )
    named_dates = []
    for file_name in required:
        payload = _read_json(folder / file_name)
        source_date = payload.get("source_date") if isinstance(payload, dict) else None
        named_dates.append((file_name, _coerce_date_str(source_date)))
    return _complete_floor(named_dates, "Global Scouter files")


def _indices_clock(folder: Path) -> SourceClock:
    named_dates = [
        (file_name, _latest_row_date(_read_json(folder / file_name), "date"))
        for file_name in _schema_file_names(folder)
    ]
    return _complete_floor(named_dates, "index series")


def _series_floor(payload: object, label: str) -> SourceClock:
    series = payload.get("series") if isinstance(payload, dict) else None
    if isinstance(series, list):
        return _complete_floor([(label, _latest_row_date(series, "date"))], label)
    if not isinstance(series, dict):
        return None, f"source date unavailable for required {label}: series"
    named_dates = [
        (str(series_id), _latest_row_date(rows, "date"))
        for series_id, rows in series.items()
    ]
    return _complete_floor(named_dates, label)


def _activity_surveys_clock(payload: object) -> SourceClock:
    meta = payload.get("meta") if isinstance(payload, dict) else None
    coverage = meta.get("coverage") if isinstance(meta, dict) else None
    named_dates = [
        (str(name), _coerce_date_str(item.get("latest_date")) if isinstance(item, dict) else None)
        for name, item in (coverage.items() if isinstance(coverage, dict) else [])
    ]
    return _complete_floor(named_dates, "activity survey series")


def _yahoo_ticker_clock(payload: object) -> SourceClock:
    tickers = payload.get("tickers") if isinstance(payload, dict) else None
    named_dates: list[tuple[str, str | None]] = []
    for ticker, quote in (tickers.items() if isinstance(tickers, dict) else []):
        raw = quote.get("regularMarketTime") if isinstance(quote, dict) else None
        source_date = None
        if isinstance(raw, (int, float)) and raw > 0:
            source_date = datetime.fromtimestamp(raw, tz=timezone.utc).date().isoformat()
        named_dates.append((str(ticker), source_date))
    return _complete_floor(named_dates, "Yahoo ticker observations")


def _macro_clock(folder: Path) -> SourceClock:
    required: list[tuple[str, SourceClock]] = []

    activity = _read_json(folder / "activity-surveys.json")
    required.append(("activity-surveys.json", _activity_surveys_clock(activity)))

    fdic = _read_json(folder / "fdic-tier1.json")
    fdic_rows = fdic.get("data") if isinstance(fdic, dict) else None
    required.append(("fdic-tier1.json", (_latest_row_date(fdic_rows, "date"), None)))

    for file_name in (
        "fred-banking-daily.json",
        "fred-banking-weekly.json",
        "fred-banking-quarterly.json",
        "fred-macro.json",
    ):
        required.append((file_name, _series_floor(_read_json(folder / file_name), file_name)))

    for file_name in ("stablecoins.json", "tga.json"):
        required.append((file_name, _series_floor(_read_json(folder / file_name), file_name)))

    required.append(("yahoo-ticker.json", _yahoo_ticker_clock(_read_json(folder / "yahoo-ticker.json"))))

    missing_reasons = [f"{name}: {clock[1]}" for name, clock in required if clock[0] is None]
    if missing_reasons:
        return None, "; ".join(missing_reasons)
    return _complete_floor([(name, clock[0]) for name, clock in required], "macro files")


def _sec_13f_clock(folder: Path) -> SourceClock:
    summary = _read_json(folder / "summary.json")
    metadata = summary.get("metadata") if isinstance(summary, dict) else None
    quarters = metadata.get("quarters_covered") if isinstance(metadata, dict) else None
    current_quarter = quarters[0] if isinstance(quarters, list) and quarters else None
    named_dates = []
    for file_path in sorted((folder / "investors").glob("*.json")):
        payload = _read_json(file_path)
        investor = payload.get("investor") if isinstance(payload, dict) else None
        filings = investor.get("filings") if isinstance(investor, dict) else None
        current_filings = [
            filing
            for filing in filings or []
            if isinstance(filing, dict) and filing.get("quarter") == current_quarter
        ]
        if current_filings:
            named_dates.append((file_path.name, _latest_row_date(current_filings, "filing_date")))
    consensus = _read_json(folder / "analytics" / "consensus.json")
    consensus_meta = consensus.get("metadata") if isinstance(consensus, dict) else None
    expected_count = consensus_meta.get("current_cohort_investors") if isinstance(consensus_meta, dict) else None
    if isinstance(expected_count, int) and len(named_dates) != expected_count:
        return None, f"active 13F source count mismatch: expected {expected_count}, found {len(named_dates)}"
    return _complete_floor(named_dates, "active 13F investor filings")


def _sentiment_clock(folder: Path) -> SourceClock:
    named_dates = [
        (file_name, _latest_row_date(_read_json(folder / file_name), "date"))
        for file_name in _schema_file_names(folder)
    ]
    return _complete_floor(named_dates, "sentiment series")


def _computed_clock(folder: Path) -> SourceClock:
    signals = _read_json(folder / "signals.json")
    signal_rows = signals.get("signals") if isinstance(signals, dict) else None
    signal_dates = [
        (str(signal_name), _coerce_date_str(row.get("as_of")) if isinstance(row, dict) else None)
        for signal_name, row in (signal_rows.items() if isinstance(signal_rows, dict) else [])
    ]
    signals_floor, signals_reason = _complete_floor(signal_dates, "computed signals")

    market_facts = _read_json(folder / "market_facts" / "index.json")
    facts_floor = _coerce_date_str(
        market_facts.get("full_universe_floor_as_of") if isinstance(market_facts, dict) else None
    )
    if signals_reason:
        return None, signals_reason
    return _complete_floor(
        [("signals.json", signals_floor), ("market_facts/index.json", facts_floor)],
        "computed core artifacts",
    )


def _yardney_clock(folder: Path) -> SourceClock:
    payload = _read_json(folder / "yardney_model.json")
    meta = payload.get("meta") if isinstance(payload, dict) else None
    source_date = None
    if isinstance(meta, dict):
        last_update = meta.get("last_update")
        source_date = _coerce_date_str(
            last_update.get("last_public_date") if isinstance(last_update, dict) else None
        )
    return _complete_floor([("yardney_model.json", source_date)], "Yardeni model")


def _yf_clock(folder: Path) -> SourceClock:
    named_dates: list[tuple[str, str | None]] = []
    for file_path in sorted((folder / "finance").glob("*.json")):
        payload = _read_json(file_path)
        data = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(data, dict) or "history_1y" not in data:
            continue
        source_date = _latest_row_date(data.get("history_1y"), "date")
        named_dates.append((f"finance/{file_path.name}", source_date))
    for file_path in sorted((folder / "etf-details").glob("*.json")):
        payload = _read_json(file_path)
        normalized = payload.get("normalized") if isinstance(payload, dict) else None
        source_date = _latest_row_date(
            normalized.get("history") if isinstance(normalized, dict) else None,
            "date",
        )
        named_dates.append((f"etf-details/{file_path.name}", source_date))
    return _complete_floor(named_dates, "Yahoo finance histories")


def _edgar_summaries_clock(folder: Path) -> SourceClock:
    named_dates: list[tuple[str, str | None]] = []
    for file_path in sorted((folder / "by-ticker").glob("*.json")):
        payload = _read_json(file_path)
        filings = payload.get("filings") if isinstance(payload, dict) else None
        if not isinstance(filings, list) or not filings:
            continue
        named_dates.append((file_path.name, _latest_row_date(filings, "filingDate")))
    return _complete_floor(named_dates, "EDGAR ticker filing feeds")


def latest_data_clock(folder: Path) -> SourceClock:
    """Return a dataset-specific complete source floor, never a build clock."""
    extractors = {
        "benchmarks": _benchmark_clock,
        "computed": _computed_clock,
        "damodaran": _damodaran_clock,
        "edgar-korean-summaries": _edgar_summaries_clock,
        "global-scouter": _global_scouter_clock,
        "indices": _indices_clock,
        "macro": _macro_clock,
        "sec-13f": _sec_13f_clock,
        "sentiment": _sentiment_clock,
        "yardney": _yardney_clock,
        "yf": _yf_clock,
    }
    if folder.name in extractors:
        return extractors[folder.name](folder)

    reasons = {
        "admin": "internal listing cache has a build time but no upstream source date",
        "calendar": "calendar export has a collection time but no upstream snapshot date",
        "catalog": "curated catalog has an edit time but no upstream source date",
        "edgar": "SEC company ticker feed publishes no aggregate source date",
        "slickcharts": "provider payload publishes no source date; updated is collection time",
        "stockanalysis": "provider publishes no aggregate source date",
    }
    return None, reasons.get(folder.name, NO_AGGREGATE_SOURCE_DATE)


def latest_data_date(folder: Path) -> str | None:
    """Compatibility wrapper for callers that only need the source floor."""
    return latest_data_clock(folder)[0]


def infer_manifest_base_sha() -> str:
    """
    Return the last commit that refreshed manifest/computed outputs.
    Scheduled runs use this as the diff base because GITHUB_TOKEN data commits
    do not trigger this workflow directly.
    """
    result = subprocess.run(
        [
            "git",
            "rev-list",
            "-n",
            "1",
            "HEAD",
            "--",
            "data/manifest.json",
            "data/computed/signals.json",
            "100xfenok-next/public/data/manifest.json",
            "100xfenok-next/public/data/computed/signals.json",
        ],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
        timeout=15,
    )
    inferred = result.stdout.strip()
    return inferred or "HEAD~1"


def get_git_changed_folders() -> tuple[set[str], bool, str]:
    """
    Return data/ subfolder names that have changes in this push, plus
    whether the git diff command itself succeeded.
    Uses BEFORE_SHA env var (set by GitHub Actions) to cover ALL commits
    in a multi-commit push. Schedule/manual runs infer the last manifest
    refresh commit as the base. Returns (empty set, False, base) if git is
    unavailable.
    """
    try:
        before = os.environ.get("BEFORE_SHA", "").strip()
        if not before or before.upper() == "AUTO" or before == "HEAD" or before == "0" * 40:
            before = infer_manifest_base_sha()

        result = subprocess.run(
            ["git", "diff", "--name-only", before, "HEAD"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=True,
            timeout=15,
        )
        changed = set()
        for line in result.stdout.strip().splitlines():
            # Match: data/{folder}/... or data/{folder}.json (root-level)
            parts = line.strip().split("/")
            if parts[0] == "data" and len(parts) >= 2:
                candidate = parts[1]
                # Skip root-level files and manifest itself
                if candidate and "." not in candidate:
                    changed.add(candidate)
        return changed, True, before
    except Exception:
        return set(), False, ""


def get_orphan_files() -> list[str]:
    """
    Return .json files sitting directly in data/ root (not in a subfolder).
    These are unorganized and should be moved to proper subfolders.
    """
    return sorted(
        f.name for f in DATA_DIR.iterdir()
        if f.is_file() and f.suffix == ".json" and f.name not in ROOT_KNOWN
    )


def build_categories(folders_meta: dict[str, dict[str, object]]) -> list[dict[str, object]]:
    """Build the MCP-facing category registry from the core data folders."""
    categories = []
    ordered_names = [
        name for name in CATEGORY_ORDER
        if name in folders_meta and name not in EXCLUDED_CATEGORIES
    ]
    ordered_names.extend(
        name for name in sorted(folders_meta)
        if name not in ordered_names and name not in EXCLUDED_CATEGORIES
    )

    for name in ordered_names:
        manifest_meta = folders_meta.get(name)
        if not manifest_meta:
            continue

        folder_path = DATA_DIR / name
        fallback_version = str(manifest_meta.get("version", "1.0.0"))
        if "updated" in manifest_meta:
            last_updated = manifest_meta.get("updated")
            last_updated_reason = manifest_meta.get("updated_reason")
        else:
            last_updated, last_updated_reason = latest_data_clock(folder_path)
        if not last_updated and not last_updated_reason:
            last_updated_reason = NO_AGGREGATE_SOURCE_DATE

        raw_file_count = manifest_meta.get("file_count")
        file_count = raw_file_count if isinstance(raw_file_count, int) else count_data_files(folder_path)
        categories.append(
            {
                "name": name,
                "path": f"/data/{name}/",
                "schemaVersion": read_schema_version(folder_path, fallback_version),
                "fileCount": file_count,
                "lastUpdated": last_updated,
                "lastUpdatedReason": last_updated_reason,
                "notes": str(manifest_meta.get("description") or ""),
            }
        )

    return categories


def write_manifest(path: Path, manifest: dict[str, object]) -> None:
    """Write a manifest JSON file with stable formatting."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write("\n")


# ─── Core ─────────────────────────────────────────────────────────────────────


def update_manifest(dry_run: bool = False) -> int:
    """Main logic. Returns exit code (0=clean, 1=has warnings)."""
    today = str(date.today())
    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    exit_code = 0

    # Load manifest
    with open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)

    original_manifest_version = manifest.get("manifest_version")
    original_categories = manifest.get("categories")
    folders_meta = manifest.setdefault("folders", {})
    manifest_changed = False

    # Detect git-changed folders (for `updated` accuracy)
    git_changed, git_diff_available, git_diff_base = get_git_changed_folders()
    if git_changed:
        print(f"🔍 Git changes detected since {git_diff_base}: {', '.join(sorted(git_changed))}")
    elif git_diff_available:
        print(f"🔍 Git diff checked since {git_diff_base} — no data folder changes detected")
    else:
        print("🔍 Git diff not available — using file-count change detection")

    # Scan actual data/ subdirectories
    actual_folders = sorted(
        d.name for d in DATA_DIR.iterdir()
        if d.is_dir() and not d.name.startswith(".")
    )

    # ── Warn: orphan files at data/ root ──────────────────────────────────────
    orphans = get_orphan_files()
    if orphans:
        print(f"\n⚠️  Unorganized files in data/ root (not counted in any folder):")
        for f in orphans:
            print(f"   - {f}")
        print("   Tip: move these into a dedicated subfolder and add a manifest entry")
        exit_code = 1

    # ── Process each folder ───────────────────────────────────────────────────
    updated_entries = []
    new_entries = []

    for folder_name in actual_folders:
        folder_path = DATA_DIR / folder_name
        actual_count = count_data_files(folder_path)

        if folder_name in folders_meta:
            entry = folders_meta[folder_name]
            metadata_reasons = refresh_default_folder_metadata(folder_name, folder_path, entry)
            if metadata_reasons:
                manifest_changed = True
                updated_entries.append(f"{folder_name}: {', '.join(metadata_reasons)}")

            old_count = entry.get("file_count", 0)
            old_updated = entry.get("updated")
            old_updated_reason = entry.get("updated_reason")
            count_diff = old_count != actual_count
            git_touched = folder_name in git_changed

            # A content/build change never supplies a source date. Recompute the
            # honest date for every folder and fail closed to null + reason.
            new_updated, new_updated_reason = latest_data_clock(folder_path)
            date_diff = new_updated != old_updated or new_updated_reason != old_updated_reason

            if count_diff or date_diff:
                manifest_changed = True
                entry["file_count"] = actual_count
                entry["updated"] = new_updated
                if new_updated_reason:
                    entry["updated_reason"] = new_updated_reason
                else:
                    entry.pop("updated_reason", None)

                reasons = []
                if count_diff:
                    reasons.append(f"count {old_count}→{actual_count}")
                if date_diff:
                    reasons.append(f"source date {old_updated}→{new_updated}")
                updated_entries.append(f"{folder_name}: {', '.join(reasons)}")
            elif git_touched:
                # The collection/build changed but the source clock did not.
                print(f"ℹ️  {folder_name}: content changed; source date remains {new_updated or 'unknown'}")
        else:
            # Brand-new folder not yet in manifest
            defaults = DEFAULT_FOLDER_META.get(folder_name, {})
            initial_source_date, initial_source_reason = latest_data_clock(folder_path)
            new_entry = {
                "version": defaults.get("version", "1.0.0"),
                "updated": initial_source_date,
                "updated_reason": initial_source_reason,
                "update_frequency": defaults.get("update_frequency", "on-demand"),
                "source": defaults.get("source", "TBD"),
                "file_count": actual_count,
                "schema": defaults.get("schema", False),
                "description": defaults.get("description", "TBD"),
            }
            folders_meta[folder_name] = new_entry
            manifest_changed = True

            manual_note = "" if defaults else " ← needs manual: update_frequency, source, description"
            new_entries.append(f"{folder_name} ({actual_count} files){manual_note}")

    # ── Warn: manifest folders missing from disk ───────────────────────────────
    missing = sorted(set(folders_meta.keys()) - set(actual_folders))
    if missing:
        print(f"\n⚠️  In manifest but not found in data/:")
        for m in missing:
            print(f"   - {m}")
        print("   Tip: remove the entry or restore the folder")
        exit_code = 1

    if parse_semver(original_manifest_version) < parse_semver(HYBRID_MANIFEST_VERSION):
        manifest["manifest_version"] = HYBRID_MANIFEST_VERSION
        manifest_changed = True
    elif isinstance(original_manifest_version, str) and original_manifest_version.strip():
        manifest["manifest_version"] = original_manifest_version
    else:
        manifest["manifest_version"] = HYBRID_MANIFEST_VERSION
        manifest_changed = True

    categories = build_categories(folders_meta)
    if categories != original_categories:
        manifest_changed = True
    manifest["categories"] = categories

    recent_changes = manifest.setdefault("recent_changes", [])
    if not any(
        isinstance(entry, dict)
        and entry.get("folder") == "manifest"
        and entry.get("version") == manifest["manifest_version"]
        for entry in recent_changes
    ):
        recent_changes.insert(
            0,
            {
                "date": today,
                "folder": "manifest",
                "version": manifest["manifest_version"],
                "change": "Added hybrid categories registry for fenok-data-mcp while preserving legacy folders for runtime compatibility.",
                "breaking": False,
            },
        )
        manifest_changed = True

    # ── Update root metadata only when manifest content changed ───────────────
    if manifest_changed:
        manifest["last_updated"] = today
        manifest["generatedAt"] = generated_at
    else:
        generated_at = str(manifest.get("generatedAt", generated_at))
        manifest["last_updated"] = manifest.get("last_updated", today)
        manifest["generatedAt"] = generated_at

    # ── Summary ───────────────────────────────────────────────────────────────
    print()
    if updated_entries:
        print(f"✅ Updated ({len(updated_entries)}):")
        for e in updated_entries:
            print(f"   {e}")
    if new_entries:
        print(f"🆕 New folders added ({len(new_entries)}):")
        for e in new_entries:
            print(f"   {e}")

    print("🧩 Manifest metadata refreshed:")
    print(f"   manifest_version: {manifest['manifest_version']}")
    print(f"   generatedAt     : {generated_at}")
    print(f"   categories      : {len(categories)} entries")

    # ── Write ─────────────────────────────────────────────────────────────────
    if not dry_run:
        write_manifest(MANIFEST, manifest)
        write_manifest(NEXT_MANIFEST, manifest)
        print(f"\n💾 Saved → {MANIFEST.relative_to(REPO_ROOT)}")
        print(f"💾 Mirrored → {NEXT_MANIFEST.relative_to(REPO_ROOT)}")
    else:
        print("\n[dry-run] — no file written")

    return exit_code


# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    dry_run = "--dry-run" in sys.argv

    print("=" * 60)
    print("update-manifest.py")
    print(f"  date    : {date.today()}")
    print(f"  data/   : {DATA_DIR}")
    print(f"  mirror  : {NEXT_MANIFEST}")
    print(f"  mode    : {'dry-run' if dry_run else 'write'}")
    print("=" * 60)

    sys.exit(update_manifest(dry_run=dry_run))
