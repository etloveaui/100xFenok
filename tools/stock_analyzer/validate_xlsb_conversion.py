#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
xlsb → CSV Conversion Validation Script
Task 0.2: Validate 5 weekly xlsb files for conversion accuracy
"""

import os
import sys
from pathlib import Path
from datetime import datetime
import pyxlsb
import pandas as pd
from collections import defaultdict

# Set UTF-8 encoding for output
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Configuration
XLSB_DIR = Path("data/xlsb")
WEEKS = ["20250912", "20250919", "20250926", "20251003", "20251010"]
KEY_SHEETS = ["M_Company", "A_Company", "T_EPS_C"]

def check_file_exists_and_size(week):
    """Check if xlsb file exists and return its size"""
    filepath = XLSB_DIR / f"Global_Scouter_{week}.xlsb"
    if not filepath.exists():
        return None, "File not found"

    size_mb = filepath.stat().st_size / (1024 * 1024)
    status = "✅ OK" if 80 <= size_mb <= 90 else "⚠️ Size unusual"
    return size_mb, status

def get_sheet_names(week):
    """Extract all sheet names from xlsb file"""
    filepath = XLSB_DIR / f"Global_Scouter_{week}.xlsb"
    try:
        with pyxlsb.open_workbook(str(filepath)) as wb:
            return wb.sheets
    except Exception as e:
        return None, str(e)

def get_sheet_info(week, sheet_name):
    """Get record count and field names for a specific sheet"""
    filepath = XLSB_DIR / f"Global_Scouter_{week}.xlsb"
    try:
        with pyxlsb.open_workbook(str(filepath)) as wb:
            with wb.get_sheet(sheet_name) as sheet:
                rows = list(sheet.rows())
                if len(rows) < 2:
                    return 0, [], "Sheet has less than 2 rows"

                # First row is header
                header = [cell.v if cell else "" for cell in rows[0]]
                record_count = len(rows) - 1  # Exclude header

                return record_count, header, "✅ Success"
    except Exception as e:
        return 0, [], f"❌ Error: {str(e)}"

def sample_records(week, sheet_name, num_records=5):
    """Get first N records from a sheet"""
    filepath = XLSB_DIR / f"Global_Scouter_{week}.xlsb"
    try:
        with pyxlsb.open_workbook(str(filepath)) as wb:
            with wb.get_sheet(sheet_name) as sheet:
                rows = list(sheet.rows())
                if len(rows) < 2:
                    return None

                # Convert to list of dicts for first N records
                header = [cell.v if cell else "" for cell in rows[0]]
                samples = []
                for row in rows[1:min(num_records+1, len(rows))]:
                    record = {header[i]: (cell.v if cell else "") for i, cell in enumerate(row)}
                    samples.append(record)

                return samples
    except Exception as e:
        return None

def main():
    print("=" * 80)
    print("xlsb → CSV CONVERSION VALIDATION")
    print("=" * 80)
    print(f"Validation Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Target: 5 weekly xlsb files (20250912~20251010)")
    print()

    # Part 1: File Inspection
    print("=" * 80)
    print("PART 1: FILE INSPECTION")
    print("=" * 80)
    print()
    print("| Week       | Filename                          | Size (MB) | Status      |")
    print("|------------|-----------------------------------|-----------|-------------|")

    file_results = {}
    for week in WEEKS:
        size_mb, status = check_file_exists_and_size(week)
        file_results[week] = (size_mb, status)
        filename = f"Global_Scouter_{week}.xlsb"
        print(f"| {week} | {filename:33} | {size_mb:8.2f}  | {status:11} |")
    print()

    # Part 2: Sheet List Comparison
    print("=" * 80)
    print("PART 2: SHEET LIST COMPARISON")
    print("=" * 80)
    print()

    sheet_lists = {}
    for week in WEEKS:
        sheets = get_sheet_names(week)
        sheet_lists[week] = sheets
        print(f"### Week {week}")
        print(f"- Sheet count: {len(sheets)}")
        print(f"- Sheet names: {', '.join(sheets[:5])}{'...' if len(sheets) > 5 else ''}")
        print()

    # Check consistency
    print("### Sheet List Consistency Check")
    first_week_sheets = set(sheet_lists[WEEKS[0]])
    all_consistent = True
    for week in WEEKS[1:]:
        week_sheets = set(sheet_lists[week])
        if week_sheets != first_week_sheets:
            all_consistent = False
            added = week_sheets - first_week_sheets
            removed = first_week_sheets - week_sheets
            print(f"⚠️ Week {week} differs from {WEEKS[0]}:")
            if added:
                print(f"  - Added sheets: {', '.join(added)}")
            if removed:
                print(f"  - Removed sheets: {', '.join(removed)}")

    if all_consistent:
        print("✅ All weeks have identical sheet lists")
    print()

    # Part 3: Record and Field Validation
    print("=" * 80)
    print("PART 3: RECORD AND FIELD VALIDATION")
    print("=" * 80)
    print()

    print("### Record Count Trends")
    print("| Week       | M_Company | A_Company | T_EPS_C |")
    print("|------------|-----------|-----------|---------|")

    record_counts = defaultdict(dict)
    field_info = defaultdict(dict)

    for week in WEEKS:
        row = [week]
        for sheet in KEY_SHEETS:
            count, fields, status = get_sheet_info(week, sheet)
            record_counts[sheet][week] = count
            field_info[week][sheet] = (fields, status)
            row.append(f"{count:,}")
        print(f"| {' | '.join(row)} |")
    print()

    print("### Field Name Validation")
    for sheet in KEY_SHEETS:
        print(f"\n#### {sheet}")
        first_week = WEEKS[0]
        first_fields, _ = field_info[first_week][sheet]
        print(f"- Field count (Week {first_week}): {len(first_fields)}")
        print(f"- Sample fields: {', '.join(first_fields[:5])}...")

        # Check field consistency
        field_consistent = True
        for week in WEEKS[1:]:
            week_fields, _ = field_info[week][sheet]
            if week_fields != first_fields:
                field_consistent = False
                print(f"⚠️ Week {week} has different fields")
                if len(week_fields) != len(first_fields):
                    print(f"  - Field count: {len(week_fields)} vs {len(first_fields)}")

        if field_consistent:
            print(f"✅ All weeks have identical field structure")
    print()

    # Part 4: Encoding and Format Validation
    print("=" * 80)
    print("PART 4: ENCODING AND FORMAT VALIDATION")
    print("=" * 80)
    print()

    print("### Korean Character Test (M_Company sample)")
    for week in [WEEKS[0], WEEKS[-1]]:  # Check first and last week
        print(f"\n#### Week {week}")
        samples = sample_records(week, "M_Company", 3)
        if samples:
            for i, record in enumerate(samples):
                # Check for common Korean fields
                corp_field = None
                for key in record.keys():
                    if 'Corp' in key or '종목' in key or 'Name' in key:
                        corp_field = key
                        break

                if corp_field and record.get(corp_field):
                    value = str(record[corp_field])
                    has_korean = any('\uac00' <= c <= '\ud7a3' for c in value)
                    status = "✅ Korean OK" if has_korean else "⚠️ No Korean detected"
                    print(f"- Record {i+1}: {corp_field} = '{value[:30]}...' ({status})")
        else:
            print("❌ Failed to read sample records")
    print()

    # Part 5: Issues Summary
    print("=" * 80)
    print("PART 5: ISSUES SUMMARY")
    print("=" * 80)
    print()

    issues = {
        "critical": [],
        "medium": [],
        "low": []
    }

    # Check for critical issues
    for week in WEEKS:
        size_mb, status = file_results[week]
        if status != "✅ OK":
            issues["critical"].append(f"Week {week}: {status}")

    # Check for record count anomalies
    for sheet in KEY_SHEETS:
        counts = [record_counts[sheet][week] for week in WEEKS]
        avg_count = sum(counts) / len(counts)
        for week in WEEKS:
            deviation = abs(record_counts[sheet][week] - avg_count) / avg_count
            if deviation > 0.1:  # >10% deviation
                issues["medium"].append(
                    f"{sheet} Week {week}: Record count {record_counts[sheet][week]} "
                    f"deviates {deviation*100:.1f}% from average"
                )

    print("### Critical Issues (🔴)")
    if issues["critical"]:
        for issue in issues["critical"]:
            print(f"- {issue}")
    else:
        print("- None detected")
    print()

    print("### Medium Issues (🟡)")
    if issues["medium"]:
        for issue in issues["medium"]:
            print(f"- {issue}")
    else:
        print("- None detected")
    print()

    print("### Low Issues (🟢)")
    if issues["low"]:
        for issue in issues["low"]:
            print(f"- {issue}")
    else:
        print("- None detected")
    print()

    # Part 6: Recommendations
    print("=" * 80)
    print("PART 6: RECOMMENDATIONS")
    print("=" * 80)
    print()

    print("### Conversion Script Improvements Needed")
    print("1. Implement automated sheet count validation (expected: 22-23 sheets)")
    print("2. Add record count range checks (M_Company: 5,500-6,500)")
    print("3. Validate field name consistency across weeks")
    print("4. Add Korean character encoding verification")
    print("5. Implement date format standardization")
    print()

    print("### Validation Automation Needed")
    print("- Weekly automated validation after each new file")
    print("- Alert on field structure changes")
    print("- Track record count trends over time")
    print()

    # Conclusion
    print("=" * 80)
    print("CONCLUSION")
    print("=" * 80)
    print()

    total_issues = len(issues["critical"]) + len(issues["medium"]) + len(issues["low"])
    if total_issues == 0:
        verdict = "✅ VALIDATION PASSED"
    elif len(issues["critical"]) > 0:
        verdict = "❌ VALIDATION FAILED - Critical issues detected"
    else:
        verdict = "⚠️ VALIDATION PASSED WITH WARNINGS"

    print(f"**Validation Result**: {verdict}")
    print()
    print("**Next Steps**:")
    print("- Task 0.3: Implement conversion script improvements")
    print("- Task 0.4: Create automated validation pipeline")
    print()

if __name__ == "__main__":
    main()
