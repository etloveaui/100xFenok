#!/usr/bin/env python3
"""JSON validation script"""
import json
import sys

def validate_file(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        print(f"OK {filepath}: Valid JSON")
        return True
    except json.JSONDecodeError as e:
        print(f"FAIL {filepath}: Invalid JSON - {e}")
        return False
    except Exception as e:
        print(f"ERROR {filepath}: Error - {e}")
        return False

if __name__ == "__main__":
    files = [
        'data/column_config.json',
        'data/enhanced_summary_data_clean.json'
    ]

    all_valid = True
    for f in files:
        if not validate_file(f):
            all_valid = False

    sys.exit(0 if all_valid else 1)
