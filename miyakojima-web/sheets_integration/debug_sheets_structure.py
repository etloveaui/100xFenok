#!/usr/bin/env python3
"""
Debug script to inspect Google Sheets data structure and identify column mapping issues.

This script will:
1. Connect to the Google Sheets using existing GoogleSheetsClient
2. Show actual column headers from row 1
3. Show sample data from row 2
4. Compare with expected POI_COLUMNS configuration
5. Identify mapping issues
"""

import sys
import json
from google_sheets_client import GoogleSheetsClient
from sheets_config import POI_COLUMNS, REQUIRED_FIELDS

def debug_sheets_structure():
    """Debug the Google Sheets structure and column mapping"""
    print("=" * 60)
    print("Google Sheets Structure Debug Tool")
    print("=" * 60)

    try:
        # Initialize client
        print("\n1. Connecting to Google Sheets...")
        client = GoogleSheetsClient()

        # Get spreadsheet info
        info = client.get_spreadsheet_info()
        print(f"   ✅ Connected to: {info['title']}")
        print(f"   📊 Worksheet: {info['current_worksheet']}")
        print(f"   📏 Dimensions: {info['row_count']} rows × {info['col_count']} columns")

        # Get all values as 2D array (includes headers)
        print("\n2. Fetching raw data...")
        all_values = client.worksheet.get_all_values()

        if not all_values:
            print("   ❌ No data found in spreadsheet!")
            return

        print(f"   ✅ Found {len(all_values)} rows of data")

        # Show actual headers from row 1
        print("\n3. Actual Column Headers (Row 1):")
        print("-" * 40)
        actual_headers = all_values[0] if all_values else []
        for i, header in enumerate(actual_headers):
            print(f"   Column {i+1:2d}: '{header}'")

        # Show expected headers
        print("\n4. Expected Column Headers (from sheets_config.py):")
        print("-" * 40)
        for i, header in enumerate(POI_COLUMNS):
            print(f"   Column {i+1:2d}: '{header}'")

        # Compare headers
        print("\n5. Header Comparison:")
        print("-" * 40)
        max_len = max(len(actual_headers), len(POI_COLUMNS))

        mismatches = []
        for i in range(max_len):
            actual = actual_headers[i] if i < len(actual_headers) else "(missing)"
            expected = POI_COLUMNS[i] if i < len(POI_COLUMNS) else "(extra)"

            if actual == expected:
                status = "✅ MATCH"
            else:
                status = "❌ MISMATCH"
                mismatches.append((i+1, actual, expected))

            print(f"   Col {i+1:2d}: '{actual}' vs '{expected}' - {status}")

        # Show sample data row
        print("\n6. Sample Data (Row 2):")
        print("-" * 40)
        if len(all_values) > 1:
            sample_row = all_values[1]
            for i, value in enumerate(sample_row):
                header = actual_headers[i] if i < len(actual_headers) else f"Col{i+1}"
                # Truncate long values for display
                display_value = value[:50] + "..." if len(value) > 50 else value
                print(f"   {header}: '{display_value}'")
        else:
            print("   ❌ No data rows found!")

        # Test get_all_records() method
        print("\n7. Testing get_all_records() method:")
        print("-" * 40)
        try:
            records = client.get_all_data()
            if records:
                first_record = records[0]
                print(f"   ✅ Successfully got {len(records)} records")
                print(f"   📝 First record keys: {list(first_record.keys())}")

                # Check for POI ID specifically
                poi_id_keys = [k for k in first_record.keys() if 'id' in k.lower()]
                print(f"   🔍 Keys containing 'id': {poi_id_keys}")

                # Check required fields
                print("\n   📋 Required field check:")
                for field in REQUIRED_FIELDS:
                    if field in first_record:
                        value = first_record[field]
                        print(f"      ✅ {field}: '{value}'")
                    else:
                        print(f"      ❌ {field}: NOT FOUND")

            else:
                print("   ❌ No records returned!")

        except Exception as e:
            print(f"   ❌ Error getting records: {e}")

        # Summary and recommendations
        print("\n8. Summary and Recommendations:")
        print("=" * 40)

        if mismatches:
            print(f"   🚨 Found {len(mismatches)} column mismatches!")
            print("   📝 Mismatched columns:")
            for col_num, actual, expected in mismatches:
                print(f"      Column {col_num}: '{actual}' ≠ '{expected}'")

            print("\n   💡 Possible solutions:")
            print("   1. Update sheets_config.py POI_COLUMNS to match actual headers")
            print("   2. Or update the spreadsheet headers to match POI_COLUMNS")
            print("   3. Add column mapping logic to handle different header names")

        else:
            print("   ✅ All column headers match configuration!")

        if len(all_values) <= 1:
            print("   ⚠️  No data rows found - spreadsheet may be empty except for headers")

        return {
            'actual_headers': actual_headers,
            'expected_headers': POI_COLUMNS,
            'mismatches': mismatches,
            'row_count': len(all_values),
            'has_data': len(all_values) > 1
        }

    except Exception as e:
        print(f"\n❌ Error occurred: {e}")
        print(f"   Error type: {type(e).__name__}")
        import traceback
        traceback.print_exc()
        return None

def create_mapping_fix(debug_result):
    """Generate code to fix the column mapping issue"""
    if not debug_result or not debug_result['mismatches']:
        return

    print("\n9. Generated Fix Code:")
    print("=" * 40)

    actual_headers = debug_result['actual_headers']

    # Create a mapping dictionary
    mapping_code = "# Add this to your download script to map columns correctly:\n\n"
    mapping_code += "COLUMN_MAPPING = {\n"

    for i, actual_header in enumerate(actual_headers):
        if i < len(POI_COLUMNS):
            expected = POI_COLUMNS[i]
            if actual_header != expected:
                mapping_code += f"    '{actual_header}': '{expected}',\n"

    mapping_code += "}\n\n"
    mapping_code += "# Use this function to map column names:\n"
    mapping_code += "def map_columns(record):\n"
    mapping_code += "    mapped = {}\n"
    mapping_code += "    for key, value in record.items():\n"
    mapping_code += "        mapped_key = COLUMN_MAPPING.get(key, key)\n"
    mapping_code += "        mapped[mapped_key] = value\n"
    mapping_code += "    return mapped\n"

    print(mapping_code)

if __name__ == "__main__":
    print("Starting Google Sheets structure debug...")
    result = debug_sheets_structure()

    if result:
        create_mapping_fix(result)

    print("\n" + "=" * 60)
    print("Debug complete!")