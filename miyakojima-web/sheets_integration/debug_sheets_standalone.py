#!/usr/bin/env python3
"""
Standalone debug script to inspect Google Sheets data structure.
This script doesn't depend on pandas to avoid compatibility issues.
"""

import gspread
import json
from google.oauth2.service_account import Credentials
from sheets_config import POI_COLUMNS, REQUIRED_FIELDS, SPREADSHEET_ID, WORKSHEET_NAME, CREDENTIALS_FILE

def connect_to_sheets():
    """Connect to Google Sheets directly"""
    scope = [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive'
    ]
    credentials = Credentials.from_service_account_file(CREDENTIALS_FILE, scopes=scope)
    client = gspread.authorize(credentials)
    spreadsheet = client.open_by_key(SPREADSHEET_ID)
    worksheet = spreadsheet.worksheet(WORKSHEET_NAME)
    return spreadsheet, worksheet

def debug_sheets_structure():
    """Debug the Google Sheets structure and column mapping"""
    print("=" * 60)
    print("Google Sheets Structure Debug Tool (Standalone)")
    print("=" * 60)

    try:
        # Connect to sheets
        print("\n1. Connecting to Google Sheets...")
        spreadsheet, worksheet = connect_to_sheets()

        print(f"   ✅ Connected to: {spreadsheet.title}")
        print(f"   📊 Worksheet: {worksheet.title}")
        print(f"   📏 Dimensions: {worksheet.row_count} rows × {worksheet.col_count} columns")

        # Get all values as 2D array
        print("\n2. Fetching raw data...")
        all_values = worksheet.get_all_values()

        if not all_values:
            print("   ❌ No data found in spreadsheet!")
            return

        print(f"   ✅ Found {len(all_values)} rows of data")

        # Show actual headers from row 1
        print("\n3. Actual Column Headers (Row 1):")
        print("-" * 50)
        actual_headers = all_values[0] if all_values else []
        for i, header in enumerate(actual_headers):
            print(f"   Column {i+1:2d}: '{header}'")

        print(f"\n   📝 Total columns in sheet: {len(actual_headers)}")

        # Show expected headers
        print(f"\n4. Expected Column Headers (from sheets_config.py):")
        print("-" * 50)
        for i, header in enumerate(POI_COLUMNS):
            print(f"   Column {i+1:2d}: '{header}'")

        print(f"\n   📝 Total expected columns: {len(POI_COLUMNS)}")

        # Compare headers
        print("\n5. Header Comparison:")
        print("-" * 50)
        max_len = max(len(actual_headers), len(POI_COLUMNS))

        mismatches = []
        missing_in_actual = []
        extra_in_actual = []

        for i in range(max_len):
            actual = actual_headers[i] if i < len(actual_headers) else None
            expected = POI_COLUMNS[i] if i < len(POI_COLUMNS) else None

            if actual is None:
                missing_in_actual.append((i+1, expected))
                print(f"   Col {i+1:2d}: (missing) vs '{expected}' - ❌ MISSING")
            elif expected is None:
                extra_in_actual.append((i+1, actual))
                print(f"   Col {i+1:2d}: '{actual}' vs (extra) - ⚠️  EXTRA")
            elif actual == expected:
                print(f"   Col {i+1:2d}: '{actual}' vs '{expected}' - ✅ MATCH")
            else:
                mismatches.append((i+1, actual, expected))
                print(f"   Col {i+1:2d}: '{actual}' vs '{expected}' - ❌ MISMATCH")

        # Show sample data row
        print("\n6. Sample Data (Row 2):")
        print("-" * 50)
        if len(all_values) > 1:
            sample_row = all_values[1]
            for i, value in enumerate(sample_row):
                header = actual_headers[i] if i < len(actual_headers) else f"Col{i+1}"
                # Truncate long values for display
                display_value = value[:50] + "..." if len(str(value)) > 50 else str(value)
                print(f"   {header:20s}: '{display_value}'")
        else:
            print("   ❌ No data rows found!")

        # Test get_all_records() equivalent
        print("\n7. Testing record mapping (simulating get_all_records()):")
        print("-" * 50)
        try:
            if len(all_values) > 1:
                # Create records manually (like gspread does)
                records = []
                headers = all_values[0]
                for row in all_values[1:]:
                    record = {}
                    for i, value in enumerate(row):
                        if i < len(headers):
                            record[headers[i]] = value
                    records.append(record)

                if records:
                    first_record = records[0]
                    print(f"   ✅ Successfully created {len(records)} records")
                    print(f"   📝 First record keys: {list(first_record.keys())}")

                    # Check for POI ID specifically
                    poi_id_keys = [k for k in first_record.keys() if 'id' in k.lower()]
                    print(f"   🔍 Keys containing 'id': {poi_id_keys}")

                    # Check required fields
                    print("\n   📋 Required field check:")
                    for field in REQUIRED_FIELDS:
                        if field in first_record:
                            value = first_record[field]
                            display_value = str(value)[:30] + "..." if len(str(value)) > 30 else str(value)
                            print(f"      ✅ {field}: '{display_value}'")
                        else:
                            print(f"      ❌ {field}: NOT FOUND")
                            # Try to find similar keys
                            similar_keys = [k for k in first_record.keys() if field.lower() in k.lower() or k.lower() in field.lower()]
                            if similar_keys:
                                print(f"         💡 Similar keys found: {similar_keys}")
            else:
                print("   ❌ No data rows to process!")

        except Exception as e:
            print(f"   ❌ Error creating records: {e}")

        # Summary and recommendations
        print("\n8. Summary and Recommendations:")
        print("=" * 50)

        total_issues = len(mismatches) + len(missing_in_actual) + len(extra_in_actual)

        if total_issues > 0:
            print(f"   🚨 Found {total_issues} column issues!")

            if mismatches:
                print(f"\n   ❌ {len(mismatches)} column mismatches:")
                for col_num, actual, expected in mismatches:
                    print(f"      Column {col_num}: '{actual}' ≠ '{expected}'")

            if missing_in_actual:
                print(f"\n   📉 {len(missing_in_actual)} missing columns:")
                for col_num, expected in missing_in_actual:
                    print(f"      Column {col_num}: missing '{expected}'")

            if extra_in_actual:
                print(f"\n   📈 {len(extra_in_actual)} extra columns:")
                for col_num, actual in extra_in_actual:
                    print(f"      Column {col_num}: extra '{actual}'")

            print("\n   💡 Possible solutions:")
            print("   1. Update sheets_config.py POI_COLUMNS to match actual headers")
            print("   2. Update the spreadsheet headers to match POI_COLUMNS")
            print("   3. Add column mapping logic in download script")

        else:
            print("   ✅ All column headers match configuration perfectly!")

        if len(all_values) <= 1:
            print("   ⚠️  No data rows found - spreadsheet may be empty except for headers")
        else:
            print(f"   ✅ Found {len(all_values)-1} data rows")

        return {
            'actual_headers': actual_headers,
            'expected_headers': POI_COLUMNS,
            'mismatches': mismatches,
            'missing_in_actual': missing_in_actual,
            'extra_in_actual': extra_in_actual,
            'row_count': len(all_values),
            'has_data': len(all_values) > 1
        }

    except FileNotFoundError:
        print(f"\n❌ Credentials file not found: {CREDENTIALS_FILE}")
        print("   Make sure credentials.json is in the same directory as this script")
        return None
    except Exception as e:
        print(f"\n❌ Error occurred: {e}")
        print(f"   Error type: {type(e).__name__}")
        import traceback
        traceback.print_exc()
        return None

def generate_mapping_solution(debug_result):
    """Generate code to fix column mapping issues"""
    if not debug_result:
        return

    print("\n9. Generated Solutions:")
    print("=" * 50)

    actual_headers = debug_result['actual_headers']

    # Solution 1: Update POI_COLUMNS
    if debug_result['mismatches'] or debug_result['missing_in_actual'] or debug_result['extra_in_actual']:
        print("\n   💡 Solution 1: Update sheets_config.py")
        print("   Copy this to replace POI_COLUMNS in sheets_config.py:")
        print("   " + "-" * 45)
        print("   POI_COLUMNS = [")
        for header in actual_headers:
            print(f"       '{header}',")
        print("   ]")

        # Solution 2: Create mapping function
        print("\n   💡 Solution 2: Add column mapping to download script")
        print("   Add this function to your download script:")
        print("   " + "-" * 45)

        print("   def map_sheet_columns(record):")
        print("       '''Map actual sheet column names to expected POI field names'''")
        print("       mapping = {")

        # Try to intelligently map columns
        for actual in actual_headers:
            # Find best match in expected columns
            best_match = None
            actual_lower = actual.lower().replace(' ', '_').replace('-', '_')

            for expected in POI_COLUMNS:
                expected_lower = expected.lower()
                if actual_lower == expected_lower:
                    best_match = expected
                    break
                elif actual_lower in expected_lower or expected_lower in actual_lower:
                    if not best_match:  # Only set if we haven't found an exact match
                        best_match = expected

            if best_match and actual != best_match:
                print(f"           '{actual}': '{best_match}',")
            elif not best_match:
                print(f"           '{actual}': '{actual}',  # TODO: map to correct field")

        print("       }")
        print("       ")
        print("       mapped_record = {}")
        print("       for key, value in record.items():")
        print("           mapped_key = mapping.get(key, key)")
        print("           mapped_record[mapped_key] = value")
        print("       return mapped_record")

if __name__ == "__main__":
    print("Starting Google Sheets structure debug (standalone version)...")
    result = debug_sheets_structure()

    if result:
        generate_mapping_solution(result)

    print("\n" + "=" * 60)
    print("Debug complete!")