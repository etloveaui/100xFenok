#!/usr/bin/env python3
"""
Debug-enabled download script for Google Sheets POI data.
This script will identify column mapping issues and provide solutions.
"""

import sys
import os
import json

# Remove pandas dependency from the import path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def debug_download_pois():
    """Download POIs with extensive debugging to identify column mapping issues"""
    try:
        print("=" * 60)
        print("Debug Download Script")
        print("=" * 60)

        # Import after path manipulation to avoid pandas issues
        print("\n1. Importing modules...")
        try:
            # Try to import without pandas dependency
            import gspread
            from google.oauth2.service_account import Credentials
            from sheets_config import POI_COLUMNS, REQUIRED_FIELDS, SPREADSHEET_ID, WORKSHEET_NAME, CREDENTIALS_FILE
            print("   Modules imported successfully")
        except Exception as e:
            print(f"   Error importing modules: {e}")
            return []

        print("\n2. Connecting to Google Sheets...")
        try:
            # Connect directly without using GoogleSheetsClient to avoid pandas
            scope = [
                'https://www.googleapis.com/auth/spreadsheets',
                'https://www.googleapis.com/auth/drive'
            ]

            if not os.path.exists(CREDENTIALS_FILE):
                print(f"   ERROR: Credentials file not found: {CREDENTIALS_FILE}")
                print("   Please ensure credentials.json is in the sheets_integration directory")
                return []

            credentials = Credentials.from_service_account_file(CREDENTIALS_FILE, scopes=scope)
            client = gspread.authorize(credentials)
            spreadsheet = client.open_by_key(SPREADSHEET_ID)
            worksheet = spreadsheet.worksheet(WORKSHEET_NAME)

            print(f"   Connected to: {spreadsheet.title}")
            print(f"   Worksheet: {worksheet.title}")
            print(f"   Dimensions: {worksheet.row_count} rows x {worksheet.col_count} columns")

        except Exception as e:
            print(f"   ERROR connecting to sheets: {e}")
            return []

        print("\n3. Fetching raw data...")
        try:
            # Get all values as 2D array first
            all_values = worksheet.get_all_values()
            if not all_values:
                print("   ERROR: No data found in spreadsheet")
                return []
            print(f"   Found {len(all_values)} rows of raw data")

            # Show headers
            headers = all_values[0]
            print(f"\n   Actual headers in sheet:")
            for i, header in enumerate(headers):
                print(f"      Column {i+1:2d}: '{header}'")

            # Show expected headers
            print(f"\n   Expected headers (POI_COLUMNS):")
            for i, header in enumerate(POI_COLUMNS):
                print(f"      Column {i+1:2d}: '{header}'")

            # Compare
            print(f"\n   Header comparison:")
            mismatches = []
            for i in range(max(len(headers), len(POI_COLUMNS))):
                actual = headers[i] if i < len(headers) else "(missing)"
                expected = POI_COLUMNS[i] if i < len(POI_COLUMNS) else "(extra)"

                if actual == expected:
                    status = "MATCH"
                else:
                    status = "MISMATCH"
                    mismatches.append((i+1, actual, expected))

                print(f"      Col {i+1:2d}: '{actual}' vs '{expected}' - {status}")

            if mismatches:
                print(f"\n   WARNING: Found {len(mismatches)} column mismatches!")

        except Exception as e:
            print(f"   ERROR fetching data: {e}")
            return []

        print("\n4. Testing get_all_records() method...")
        try:
            # This is what the failing download script is probably using
            records = worksheet.get_all_records()

            if not records:
                print("   ERROR: get_all_records() returned no data")
                return []

            print(f"   get_all_records() returned {len(records)} records")

            # Analyze first record
            first_record = records[0]
            print(f"\n   First record keys: {list(first_record.keys())}")

        except Exception as e:
            print(f"   ERROR with get_all_records(): {e}")
            return []

        print("\n5. Checking required fields...")
        missing_fields = []
        available_keys = list(first_record.keys())

        for field in REQUIRED_FIELDS:
            if field in first_record:
                value = str(first_record[field])
                display_value = value[:30] + "..." if len(value) > 30 else value
                print(f"   FOUND {field}: '{display_value}'")
            else:
                print(f"   MISSING {field}")
                missing_fields.append(field)

                # Look for similar keys
                similar = [k for k in available_keys if field.lower() in k.lower() or k.lower() in field.lower()]
                if similar:
                    print(f"           Similar keys: {similar}")

        if missing_fields:
            print(f"\n6. DIAGNOSIS: Missing Required Fields")
            print("   " + "-" * 40)
            print(f"   The download fails because these required fields are missing:")
            for field in missing_fields:
                print(f"   - {field}")

            print(f"\n   Available columns in the sheet:")
            for key in available_keys:
                print(f"   - '{key}'")

            # Generate mapping solution
            print(f"\n7. SOLUTION: Column Mapping")
            print("   " + "-" * 40)
            print("   Add this mapping to your download script:")
            print()
            print("   COLUMN_MAPPING = {")

            for field in missing_fields:
                # Try to find best match
                best_match = None
                field_lower = field.lower()

                for key in available_keys:
                    key_lower = key.lower()
                    if field_lower in key_lower or key_lower in field_lower:
                        best_match = key
                        break

                if best_match:
                    print(f"       '{best_match}': '{field}',")
                else:
                    print(f"       # '{field}': '???',  # TODO: find correct column name")

            print("   }")
            print()
            print("   def map_record(record):")
            print("       mapped = {}")
            print("       for key, value in record.items():")
            print("           mapped_key = COLUMN_MAPPING.get(key, key)")
            print("           mapped[mapped_key] = value")
            print("       return mapped")

            return []
        else:
            print(f"\n6. SUCCESS: All required fields found!")
            print("   Processing all records...")

            # Process all records
            processed_pois = []
            for i, record in enumerate(records):
                try:
                    # Basic validation
                    for field in REQUIRED_FIELDS:
                        if not record.get(field):
                            print(f"   WARNING: Empty {field} in row {i+2}")

                    processed_pois.append(record)

                except Exception as e:
                    print(f"   ERROR processing row {i+2}: {e}")
                    continue

            print(f"\n   Successfully processed {len(processed_pois)} POIs")

            # Save debug output
            debug_file = "debug_download_output.json"
            try:
                with open(debug_file, "w", encoding="utf-8") as f:
                    json.dump({
                        "total_records": len(processed_pois),
                        "headers": headers,
                        "expected_columns": POI_COLUMNS,
                        "sample_record": processed_pois[0] if processed_pois else None,
                        "all_records": processed_pois
                    }, f, ensure_ascii=False, indent=2)
                print(f"   Debug data saved to {debug_file}")
            except Exception as e:
                print(f"   Warning: Could not save debug file: {e}")

            return processed_pois

    except Exception as e:
        print(f"\nFATAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        return []

if __name__ == "__main__":
    print("Starting debug download to identify column mapping issues...")

    pois = debug_download_pois()

    print("\n" + "=" * 60)

    if pois:
        print(f"SUCCESS! Downloaded {len(pois)} POIs")
        print("The download is working correctly.")
    else:
        print("DOWNLOAD FAILED")
        print("Check the debug output above to identify and fix the issue.")

    print("\nDebug complete!")