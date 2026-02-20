#!/usr/bin/env python3
"""
update-manifest.py — Automatic manifest.json updater

Automatically keeps manifest.json in sync with the actual data/ folder state.

What this script updates:
  - file_count  : actual JSON file count per folder (schema.json excluded)
  - updated     : today's date if file count changed OR git-detected change
  - last_updated: root-level metadata

What this script NEVER touches:
  - version, update_frequency, source, schema, description
  - recent_changes, agent_instructions

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
from datetime import date
from pathlib import Path


# ─── Paths ────────────────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT  = SCRIPT_DIR.parent          # scripts/ → repo root
DATA_DIR   = REPO_ROOT / "data"
MANIFEST   = DATA_DIR / "manifest.json"


# ─── Config ───────────────────────────────────────────────────────────────────

# JSON files excluded from count (metadata files, not data)
EXCLUDE_FILES = {"schema.json"}

# Root-level names that are NOT orphan data files
ROOT_KNOWN = {"manifest.json", "README.md"}

# Default template for newly discovered folders
# Fill in update_frequency / source / description manually after auto-add
NEW_FOLDER_TEMPLATE = {
    "version": "1.0.0",
    "updated": None,             # set at runtime
    "update_frequency": "on-demand",  # ← update manually
    "source": "TBD",                  # ← update manually
    "file_count": 0,             # set at runtime
    "schema": False,
    "description": "TBD"              # ← update manually
}


# ─── Helpers ──────────────────────────────────────────────────────────────────

def count_data_files(folder: Path) -> int:
    """
    Count all .json files under folder recursively,
    excluding metadata files (schema.json).
    """
    return sum(
        1 for f in folder.rglob("*.json")
        if f.name not in EXCLUDE_FILES
    )


def get_git_changed_folders() -> set[str]:
    """
    Return data/ subfolder names that have changes in this push.
    Uses BEFORE_SHA env var (set by GitHub Actions) to cover ALL commits
    in a multi-commit push. Falls back to HEAD~1 for local runs.
    Falls back to empty set if git is unavailable.
    """
    try:
        before = os.environ.get("BEFORE_SHA", "").strip()
        # Initial push or local run: fall back to HEAD~1
        if not before or before == "0" * 40:
            before = "HEAD~1"

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
        return changed
    except Exception:
        return set()


def get_orphan_files() -> list[str]:
    """
    Return .json files sitting directly in data/ root (not in a subfolder).
    These are unorganized and should be moved to proper subfolders.
    """
    return sorted(
        f.name for f in DATA_DIR.iterdir()
        if f.is_file() and f.suffix == ".json" and f.name not in ROOT_KNOWN
    )


# ─── Core ─────────────────────────────────────────────────────────────────────

def update_manifest(dry_run: bool = False) -> int:
    """
    Main logic. Returns exit code (0=clean, 1=has warnings).
    """
    today     = str(date.today())
    exit_code = 0

    # Load manifest
    with open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)
    folders_meta = manifest.setdefault("folders", {})

    # Detect git-changed folders (for `updated` accuracy)
    git_changed = get_git_changed_folders()
    if git_changed:
        print(f"🔍 Git changes detected in: {', '.join(sorted(git_changed))}")
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
    new_entries     = []

    for folder_name in actual_folders:
        folder_path  = DATA_DIR / folder_name
        actual_count = count_data_files(folder_path)

        if folder_name in folders_meta:
            entry       = folders_meta[folder_name]
            old_count   = entry.get("file_count", 0)
            count_diff  = old_count != actual_count
            git_touched = folder_name in git_changed

            if count_diff or git_touched:
                entry["file_count"] = actual_count
                entry["updated"]    = today

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
            new_entry               = NEW_FOLDER_TEMPLATE.copy()
            new_entry["file_count"] = actual_count
            new_entry["updated"]    = today
            folders_meta[folder_name] = new_entry

            new_entries.append(
                f"{folder_name} ({actual_count} files) "
                f"← needs manual: update_frequency, source, description"
            )

    # ── Warn: manifest folders missing from disk ───────────────────────────────
    missing = sorted(set(folders_meta.keys()) - set(actual_folders))
    if missing:
        print(f"\n⚠️  In manifest but not found in data/:")
        for m in missing:
            print(f"   - {m}")
        print("   Tip: remove the entry or restore the folder")
        exit_code = 1

    # ── Update root last_updated ──────────────────────────────────────────────
    manifest["last_updated"] = today

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
    if not updated_entries and not new_entries:
        print("✓ manifest.json already up to date — no changes")

    # ── Write ─────────────────────────────────────────────────────────────────
    if not dry_run:
        with open(MANIFEST, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print(f"\n💾 Saved → {MANIFEST.relative_to(REPO_ROOT)}")
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
    print(f"  mode    : {'dry-run' if dry_run else 'write'}")
    print("=" * 60)

    sys.exit(update_manifest(dry_run=dry_run))
