#!/usr/bin/env python3
"""
update-manifest.py — Automatic manifest.json updater

Automatically keeps manifest.json in sync with the actual data/ folder state.

What this script updates:
  - file_count  : actual JSON file count per folder (schema.json excluded)
  - updated     : today's date if file count changed OR git-detected change
  - last_updated: root-level metadata
  - generatedAt : UTC snapshot timestamp for the manifest
  - categories  : MCP-facing hybrid registry derived from legacy folders
  - manifest_version: bumped once when the hybrid registry is introduced

What this script never rewrites:
  - version, update_frequency, source, schema, description
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
    "sentiment",
    "slickcharts",
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
        "description": "Deterministic computed signals derived from macro, banking, liquidity, and sentiment raw data.",
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

    return tuple(parsed)


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


def latest_data_date(folder: Path) -> str | None:
    """Return the date declared in a folder schema, or the fallback manifest date."""
    schema_path = folder / "schema.json"
    try:
        with open(schema_path, encoding="utf-8") as f:
            schema = json.load(f)
    except Exception:
        return None

    for key in ("updated", "last_updated", "generatedAt"):
        value = schema.get(key)
        if isinstance(value, str) and value.strip():
            return value[:10]

    return None


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
        fallback_last_updated = str(manifest_meta.get("updated", date.today().isoformat()))

        categories.append(
            {
                "name": name,
                "path": f"/data/{name}/",
                "schemaVersion": read_schema_version(folder_path, fallback_version),
                "fileCount": int(manifest_meta.get("file_count", count_data_files(folder_path))),
                "lastUpdated": fallback_last_updated or latest_data_date(folder_path),
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
            old_count = entry.get("file_count", 0)
            count_diff = old_count != actual_count
            git_touched = folder_name in git_changed

            if count_diff or git_touched:
                manifest_changed = True
                entry["file_count"] = actual_count
                entry["updated"] = today

                reasons = []
                if count_diff:
                    reasons.append(f"count {old_count}→{actual_count}")
                if git_touched and not count_diff:
                    reasons.append("content updated (git)")

                updated_entries.append(
                    f"{folder_name}: {', '.join(reasons)}"
                )
        else:
            # Brand-new folder not yet in manifest
            defaults = DEFAULT_FOLDER_META.get(folder_name, {})
            new_entry = {
                "version": defaults.get("version", "1.0.0"),
                "updated": today,
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
