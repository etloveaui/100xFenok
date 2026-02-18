#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Simple CSV to JSON converter - no unicode in output"""

import json
import pandas as pd
from pathlib import Path
import sys
import os

# Force UTF-8 output on Windows
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')

def convert_one_csv(csv_path, output_path, skiprows=2):
    """Convert single CSV to JSON"""
    csv_file = Path(csv_path)
    print(f"Processing: {csv_file.name}")

    try:
        # Read CSV skipping Excel header rows
        df = pd.read_csv(csv_path, encoding='utf-8', skiprows=skiprows)

        # Remove unnamed columns
        df = df.loc[:, ~df.columns.str.contains('^Unnamed')]

        # Convert to records
        records = df.to_dict('records')

        # Clean NaN values
        for record in records:
            for key in list(record.keys()):
                if pd.isna(record[key]):
                    record[key] = None

        output_data = {
            "metadata": {
                "source": csv_file.name,
                "recordCount": len(records)
            },
            "data": records
        }

        # Write JSON
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, indent=2, ensure_ascii=False)

        print(f"[OK] {len(records)} records -> {Path(output_path).name}")
        return len(records)

    except Exception as e:
        print(f"[ERROR] {csv_file.name}: {str(e)[:100]}")
        return 0


def main(csv_dir, output_dir):
    """Batch convert all CSV files"""
    csv_path = Path(csv_dir)
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    csv_files = list(csv_path.glob("*.csv"))
    print(f"\nFound {len(csv_files)} CSV files\n")

    total_records = 0
    success_count = 0

    for csv_file in csv_files:
        output_file = output_path / f"{csv_file.stem}.json"
        records = convert_one_csv(str(csv_file), str(output_file))
        if records > 0:
            success_count += 1
            total_records += records

    print(f"\n[DONE] {success_count}/{len(csv_files)} files, {total_records} total records")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python simple_csv_converter.py <csv_dir> <output_dir>")
        sys.exit(1)

    main(sys.argv[1], sys.argv[2])
