#!/usr/bin/env python3
"""
Index Membership Tracker for SlickCharts

Tracks changes in index composition (additions/removals) over time.
Creates universe.json with all unique tickers across indices.

Usage:
    # Check for membership changes
    python membership-tracker.py --check

    # Generate universe.json
    python membership-tracker.py --universe

    # Both (default)
    python membership-tracker.py

Created: 2026-01-10
Reference: Individual Stock Data Pipeline v2 (#151)
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Set, Tuple

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

# Constants
DATA_DIR = Path(__file__).parent.parent.parent / "source/100xFenok/data/slickcharts"
MEMBERSHIP_FILE = DATA_DIR / "membership-changes.json"
UNIVERSE_FILE = DATA_DIR / "universe.json"

# Index file paths
INDEX_FILES = {
    "sp500": DATA_DIR / "sp500.json",
    "nasdaq100": DATA_DIR / "nasdaq100.json",
    "dowjones": DATA_DIR / "dowjones.json",
}


def load_index_tickers(index_name: str) -> Set[str]:
    """
    Load ticker symbols from an index JSON file.

    Args:
        index_name: Index identifier (sp500, nasdaq100, dowjones)

    Returns:
        Set of ticker symbols
    """
    file_path = INDEX_FILES.get(index_name)
    if not file_path or not file_path.exists():
        print(f"Warning: {index_name} file not found at {file_path}")
        return set()

    try:
        data = json.loads(file_path.read_text(encoding="utf-8"))
        holdings = data.get("holdings", [])
        return {h["symbol"] for h in holdings if "symbol" in h}
    except (json.JSONDecodeError, KeyError) as e:
        print(f"Error loading {index_name}: {e}")
        return set()


def load_membership_history() -> Dict[str, Any]:
    """
    Load existing membership change history.

    Returns:
        Dictionary with membership history or empty structure
    """
    if not MEMBERSHIP_FILE.exists():
        return {
            "updated": None,
            "indices": {
                "sp500": {"count": 0, "tickers": []},
                "nasdaq100": {"count": 0, "tickers": []},
                "dowjones": {"count": 0, "tickers": []},
            },
            "changes": [],
        }

    try:
        return json.loads(MEMBERSHIP_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {
            "updated": None,
            "indices": {},
            "changes": [],
        }


def detect_changes(
    current: Set[str],
    previous: Set[str],
    index_name: str,
) -> Tuple[Set[str], Set[str]]:
    """
    Detect additions and removals between current and previous ticker sets.

    Args:
        current: Current set of tickers
        previous: Previous set of tickers
        index_name: Name of the index

    Returns:
        Tuple of (added tickers, removed tickers)
    """
    added = current - previous
    removed = previous - current
    return added, removed


def check_membership_changes(verbose: bool = True) -> Dict[str, Any]:
    """
    Check all indices for membership changes.

    Args:
        verbose: Print progress messages

    Returns:
        Dictionary with detected changes
    """
    history = load_membership_history()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    timestamp = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    all_changes: List[Dict[str, Any]] = []

    for index_name in INDEX_FILES:
        current_tickers = load_index_tickers(index_name)

        # Get previous tickers
        previous_data = history.get("indices", {}).get(index_name, {})
        previous_tickers = set(previous_data.get("tickers", []))

        # Skip if no current data
        if not current_tickers:
            if verbose:
                print(f"  {index_name}: No data found")
            continue

        # Detect changes
        added, removed = detect_changes(current_tickers, previous_tickers, index_name)

        if added or removed:
            change_record = {
                "date": today,
                "index": index_name,
                "added": sorted(added),
                "removed": sorted(removed),
                "previousCount": len(previous_tickers),
                "currentCount": len(current_tickers),
            }
            all_changes.append(change_record)

            if verbose:
                print(f"  {index_name}: {len(added)} added, {len(removed)} removed")
                if added:
                    print(f"    + Added: {', '.join(sorted(added))}")
                if removed:
                    print(f"    - Removed: {', '.join(sorted(removed))}")
        else:
            if verbose:
                print(f"  {index_name}: No changes ({len(current_tickers)} tickers)")

        # Update history with current state
        history["indices"][index_name] = {
            "count": len(current_tickers),
            "tickers": sorted(current_tickers),
        }

    # Add new changes to history
    if all_changes:
        existing_changes = history.get("changes", [])
        history["changes"] = all_changes + existing_changes

    history["updated"] = timestamp

    return history


def generate_universe() -> Dict[str, Any]:
    """
    Generate universe.json with all unique tickers across indices.

    Returns:
        Universe payload dictionary
    """
    all_tickers: Dict[str, List[str]] = {}  # ticker -> list of indices

    for index_name in INDEX_FILES:
        tickers = load_index_tickers(index_name)
        for ticker in tickers:
            if ticker not in all_tickers:
                all_tickers[ticker] = []
            all_tickers[ticker].append(index_name)

    # Build universe list with index membership
    universe: List[Dict[str, Any]] = []
    for ticker in sorted(all_tickers.keys()):
        universe.append({
            "symbol": ticker,
            "indices": sorted(all_tickers[ticker]),
            "indexCount": len(all_tickers[ticker]),
        })

    timestamp = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    # Count per index
    index_counts = {
        index_name: len(load_index_tickers(index_name))
        for index_name in INDEX_FILES
    }

    return {
        "updated": timestamp,
        "source": "slickcharts",
        "uniqueCount": len(universe),
        "indexCounts": index_counts,
        "stocks": universe,
    }


def save_membership_history(history: Dict[str, Any]) -> None:
    """Save membership history to file."""
    MEMBERSHIP_FILE.parent.mkdir(parents=True, exist_ok=True)
    MEMBERSHIP_FILE.write_text(
        json.dumps(history, indent=2, ensure_ascii=False),
        encoding="utf-8"
    )


def save_universe(universe: Dict[str, Any]) -> None:
    """Save universe to file."""
    UNIVERSE_FILE.parent.mkdir(parents=True, exist_ok=True)
    UNIVERSE_FILE.write_text(
        json.dumps(universe, indent=2, ensure_ascii=False),
        encoding="utf-8"
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Track index membership changes and generate universe",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python membership-tracker.py              # Check changes + generate universe
  python membership-tracker.py --check      # Only check for changes
  python membership-tracker.py --universe   # Only generate universe.json
        """
    )

    parser.add_argument(
        "--check", "-c",
        action="store_true",
        help="Check for membership changes only"
    )
    parser.add_argument(
        "--universe", "-u",
        action="store_true",
        help="Generate universe.json only"
    )
    parser.add_argument(
        "--quiet", "-q",
        action="store_true",
        help="Suppress progress output"
    )
    parser.add_argument(
        "--dry-run", "-n",
        action="store_true",
        help="Show what would be done without saving"
    )

    return parser.parse_args()


def main() -> None:
    args = parse_args()
    verbose = not args.quiet

    # Default: do both
    do_check = args.check or (not args.check and not args.universe)
    do_universe = args.universe or (not args.check and not args.universe)

    if verbose:
        print("Index Membership Tracker")
        print("=" * 40)

    # Check membership changes
    if do_check:
        if verbose:
            print("\nChecking membership changes...")

        history = check_membership_changes(verbose=verbose)

        if not args.dry_run:
            save_membership_history(history)
            if verbose:
                print(f"\nSaved to: {MEMBERSHIP_FILE}")
        else:
            if verbose:
                print("\n[Dry run] Would save membership changes")

    # Generate universe
    if do_universe:
        if verbose:
            print("\nGenerating universe.json...")

        universe = generate_universe()

        if verbose:
            print(f"  Unique tickers: {universe['uniqueCount']}")
            for index_name, count in universe['indexCounts'].items():
                print(f"  {index_name}: {count}")

        if not args.dry_run:
            save_universe(universe)
            if verbose:
                print(f"\nSaved to: {UNIVERSE_FILE}")
        else:
            if verbose:
                print("\n[Dry run] Would save universe.json")

    if verbose:
        print("\nDone!")


if __name__ == "__main__":
    main()
