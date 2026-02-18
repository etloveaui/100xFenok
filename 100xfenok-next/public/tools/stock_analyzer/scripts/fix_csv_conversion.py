#!/usr/bin/env python3
"""
Quick CSV to JSON converter for Global Scouter data
Handles multi-line headers from Excel export
"""

import json
import pandas as pd
from pathlib import Path
import sys

def convert_csv_to_json(csv_path, output_path=None, skiprows=2):
    """
    Convert CSV to JSON, skipping Excel header rows

    Args:
        csv_path: Path to CSV file
        output_path: Output JSON path (default: same name with .json)
        skiprows: Number of rows to skip (default: 2 for Excel export)
    """
    print(f"Converting {csv_path}...")

    csv_file = Path(csv_path)
    if not csv_file.exists():
        print(f"ERROR: File not found: {csv_path}")
        return False

    if output_path is None:
        output_path = csv_file.parent.parent / f"{csv_file.stem}.json"

    try:
        # Read CSV, skipping header rows
        df = pd.read_csv(csv_path, encoding='utf-8', skiprows=skiprows)

        # Remove unnamed columns
        df = df.loc[:, ~df.columns.str.contains('^Unnamed')]

        # Convert to records
        records = df.to_dict('records')

        # Clean None/NaN values
        for record in records:
            for key in list(record.keys()):
                if pd.isna(record[key]):
                    record[key] = None

        # Prepare output
        output_data = {
            "metadata": {
                "source": csv_file.name,
                "recordCount": len(records),
                "fieldCount": len(df.columns)
            },
            "data": records
        }

        # Write JSON
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, indent=2, ensure_ascii=False)

        print(f"✓ {csv_file.name}: {len(records)} records → {output_path}")
        return True

    except Exception as e:
        print(f"✗ {csv_file.name}: ERROR - {e}")
        return False


def batch_convert(csv_dir, output_dir, pattern="*.csv"):
    """Convert all CSV files in directory"""
    csv_path = Path(csv_dir)
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    csv_files = list(csv_path.glob(pattern))
    print(f"Found {len(csv_files)} CSV files\n")

    success_count = 0
    for csv_file in csv_files:
        output_file = output_path / f"{csv_file.stem}.json"
        if convert_csv_to_json(str(csv_file), str(output_file)):
            success_count += 1

    print(f"\n✓ Converted {success_count}/{len(csv_files)} files successfully")
    return success_count


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python fix_csv_conversion.py <csv_dir> <output_dir>")
        sys.exit(1)

    csv_dir = sys.argv[1]
    output_dir = sys.argv[2]

    batch_convert(csv_dir, output_dir)
