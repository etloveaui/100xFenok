#!/usr/bin/env python3
"""
Mock debug analysis to demonstrate the column mapping issue and solution.
This shows what the debug would reveal and how to fix the download problem.
"""

from sheets_config import POI_COLUMNS, REQUIRED_FIELDS

def analyze_column_mapping_issue():
    """
    Analyze the likely column mapping issue based on common patterns.
    """
    print("="*60)
    print("Mock Analysis: Google Sheets Column Mapping Debug")
    print("="*60)

    print("\n1. Expected Columns (from sheets_config.py):")
    print("-"*50)
    for i, col in enumerate(POI_COLUMNS):
        print(f"   Column {i+1:2d}: '{col}'")
    print(f"\n   Total expected columns: {len(POI_COLUMNS)}")

    print("\n2. Likely Issue Analysis:")
    print("-"*50)
    print("   The error 'POI ID is required' suggests that when the download")
    print("   script reads the data using get_all_records(), it can't find")
    print("   a column matching 'id' from the REQUIRED_FIELDS.")
    print()
    print("   Common causes:")
    print("   - Column headers in the sheet don't exactly match POI_COLUMNS")
    print("   - Extra spaces, different capitalization, or special characters")
    print("   - The upload script might have used different headers")

    print("\n3. Most Likely Scenario:")
    print("-"*50)
    print("   Since the upload was successful (100 POIs uploaded), the")
    print("   GoogleSheetsClient.upload_data() method worked correctly.")
    print("   It uses POI_COLUMNS as headers via upload_headers().")
    print()
    print("   However, the download might be using gspread's get_all_records()")
    print("   which converts the first row to dictionary keys, and there might")
    print("   be a mismatch in how the column names are interpreted.")

    print("\n4. Debugging Without Credentials:")
    print("-"*50)
    print("   Since we can't access the actual sheet right now, here's how")
    print("   to debug and fix the issue manually:")

    print("\n   Step 1: Check the actual spreadsheet")
    print("   - Open the Google Sheet manually in your browser")
    print("   - Look at row 1 (headers) and verify they match POI_COLUMNS")
    print("   - Check for extra spaces, special characters, or encoding issues")

    print("\n   Step 2: Test get_all_records() output")
    print("   Add this debug code to your download script:")
    print()
    debug_code = '''
    # Add this to your download script for debugging:
    records = client.get_all_data()
    if records:
        first_record = records[0]
        print("Available columns:", list(first_record.keys()))
        print("Required fields:", REQUIRED_FIELDS)

        for field in REQUIRED_FIELDS:
            if field in first_record:
                print(f"✓ Found {field}: {first_record[field]}")
            else:
                print(f"✗ Missing {field}")
                # Look for similar column names
                similar = [k for k in first_record.keys()
                          if field.lower() in k.lower() or k.lower() in field.lower()]
                if similar:
                    print(f"  Similar columns found: {similar}")
    '''
    print(debug_code)

    print("\n5. Common Fixes:")
    print("-"*50)

    print("\n   Fix 1: Column Name Mapping")
    print("   If column names don't match exactly, add mapping:")
    print()
    mapping_code = '''
    def map_columns(record):
        """Map actual column names to expected names"""
        mapping = {
            # Add mappings as needed, for example:
            # 'ID': 'id',                    # if sheet has 'ID' instead of 'id'
            # 'Name (Korean)': 'name_ko',   # if sheet has different format
            # 'Latitude': 'lat',            # if sheet has full names
            # 'Longitude': 'lng',
        }

        mapped = {}
        for key, value in record.items():
            # Use mapped name if available, otherwise keep original
            mapped_key = mapping.get(key, key)
            mapped[mapped_key] = value
        return mapped

    # Use in download script:
    records = client.get_all_data()
    mapped_records = [map_columns(record) for record in records]
    '''
    print(mapping_code)

    print("\n   Fix 2: Update POI_COLUMNS")
    print("   If the sheet headers are correct but POI_COLUMNS is wrong,")
    print("   update sheets_config.py to match the actual sheet headers.")

    print("\n   Fix 3: Recreate Headers")
    print("   If headers are completely wrong, you can fix them:")
    print()
    fix_headers_code = '''
    # Fix headers in the sheet:
    client = GoogleSheetsClient()
    client.upload_headers()  # This will overwrite row 1 with correct headers
    '''
    print(fix_headers_code)

    print("\n6. Testing Strategy:")
    print("-"*50)
    print("   1. First, add debug prints to see what columns exist")
    print("   2. Compare with REQUIRED_FIELDS to identify missing ones")
    print("   3. Create mapping or fix headers as needed")
    print("   4. Test download with a small subset first")
    print("   5. Validate the downloaded data structure")

    print("\n7. Expected Resolution:")
    print("-"*50)
    print("   Once the column mapping is fixed, the download should work")
    print("   and you should be able to successfully retrieve all 100 POIs")
    print("   that were uploaded to the sheet.")

    return True

def create_debug_download_script():
    """Create a download script with built-in debugging"""
    print("\n8. Debug-Enabled Download Script:")
    print("="*50)

    script_content = '''
#!/usr/bin/env python3
"""
Debug-enabled download script for Google Sheets POI data
"""
from google_sheets_client import GoogleSheetsClient
from sheets_config import POI_COLUMNS, REQUIRED_FIELDS
import json

def debug_download_pois():
    """Download POIs with extensive debugging"""
    try:
        print("Connecting to Google Sheets...")
        client = GoogleSheetsClient()

        print("Fetching data...")
        records = client.get_all_data()

        if not records:
            print("ERROR: No records found in spreadsheet")
            return []

        print(f"Found {len(records)} records")

        # Debug first record
        first_record = records[0]
        print("\\nDEBUG: First record structure")
        print("Available columns:", list(first_record.keys()))
        print("Expected columns:", POI_COLUMNS)
        print("Required fields:", REQUIRED_FIELDS)

        # Check each required field
        print("\\nField availability check:")
        missing_fields = []
        for field in REQUIRED_FIELDS:
            if field in first_record:
                value = str(first_record[field])[:30]
                print(f"  ✓ {field}: '{value}...'")
            else:
                print(f"  ✗ {field}: MISSING")
                missing_fields.append(field)

                # Look for similar names
                similar = [k for k in first_record.keys()
                          if field.lower() in k.lower() or k.lower() in field.lower()]
                if similar:
                    print(f"    Similar: {similar}")

        if missing_fields:
            print(f"\\nERROR: Missing required fields: {missing_fields}")
            print("Fix needed: Update column mapping or sheet headers")
            return []

        print("\\nAll required fields found. Processing records...")

        # Process all records
        processed_pois = []
        for i, record in enumerate(records):
            try:
                # Validate required fields
                for field in REQUIRED_FIELDS:
                    if not record.get(field):
                        raise ValueError(f"POI ID is required (row {i+2})")

                processed_pois.append(record)

            except Exception as e:
                print(f"Error processing row {i+2}: {e}")
                continue

        print(f"Successfully processed {len(processed_pois)} POIs")
        return processed_pois

    except Exception as e:
        print(f"Error in debug_download_pois: {e}")
        import traceback
        traceback.print_exc()
        return []

if __name__ == "__main__":
    pois = debug_download_pois()
    if pois:
        print(f"\\nSuccess! Downloaded {len(pois)} POIs")
        # Optionally save to file
        with open("downloaded_pois_debug.json", "w", encoding="utf-8") as f:
            json.dump(pois, f, ensure_ascii=False, indent=2)
        print("Data saved to downloaded_pois_debug.json")
    else:
        print("\\nDownload failed. Check debug output above.")
'''

    print("Save this as debug_download.py and run it to identify the exact issue:")
    print(script_content)

if __name__ == "__main__":
    print("Starting mock analysis...")
    analyze_column_mapping_issue()
    create_debug_download_script()
    print("\n" + "="*60)
    print("Mock analysis complete!")
    print("\nNext steps:")
    print("1. Run the debug download script to see actual column names")
    print("2. Apply the appropriate fix based on the debug output")
    print("3. Test the download again")