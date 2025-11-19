import json
import sys
from pathlib import Path

def validate_json(file_path):
    print(f"Validating {file_path}...")
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            
        companies = data.get('companies', [])
        print(f"Total companies: {len(companies)}")
        
        errors = []
        
        for i, company in enumerate(companies):
            # Check for NaN keys
            if 'NaN' in company or 'nan' in company:
                errors.append(f"Row {i}: Found 'NaN' or 'nan' key")
                
            # Check for Excel date keys (e.g., '45933')
            for key in company.keys():
                if key.isdigit() and len(key) == 5 and key.startswith('4'):
                     errors.append(f"Row {i}: Found potential Excel date key '{key}'")

            # Check for NaN/Infinity values
            for key, value in company.items():
                if value == float('inf') or value == float('-inf'):
                    errors.append(f"Row {i}, Key '{key}': Found Infinity value")
                if isinstance(value, str):
                    if value.lower() == 'nan':
                        errors.append(f"Row {i}, Key '{key}': Found 'NaN' string value")
                        
        if errors:
            print(f"❌ Found {len(errors)} errors:")
            for err in errors[:10]:
                print(f"  - {err}")
            if len(errors) > 10:
                print(f"  ... and {len(errors) - 10} more.")
            return False
        else:
            print("✅ Validation Passed: No NaN keys or values found.")
            return True
            
    except Exception as e:
        print(f"❌ Error reading file: {e}")
        return False

if __name__ == "__main__":
    target_file = Path(r"\\wsl.localhost\Ubuntu\home\etlov\agents-workspace\00_my_data\01_El_Fenomono\20_Codebase\100xFenok\tools\stock_analyzer\data\enhanced_summary_data_full.json")
    if validate_json(target_file):
        sys.exit(0)
    else:
        sys.exit(1)
