#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Deep analysis of xlsb file structure to understand the real data layout
"""

import pyxlsb
from pathlib import Path
from collections import Counter

XLSB_DIR = Path("data/xlsb")
WEEK = "20251010"  # Latest week

def analyze_structure():
    filepath = XLSB_DIR / f"Global_Scouter_{WEEK}.xlsb"

    print(f"Analyzing: {filepath.name}")
    print("=" * 80)

    with pyxlsb.open_workbook(str(filepath)) as wb:
        sheets = wb.sheets
        print(f"\nTotal sheets: {len(sheets)}")

        # Categorize sheets by prefix
        sheet_categories = Counter()
        main_sheets = []

        for sheet_name in sheets:
            if sheet_name.startswith('M_'):
                sheet_categories['Master (M_)'] += 1
                main_sheets.append(sheet_name)
            elif sheet_name.startswith('T_'):
                sheet_categories['Technical (T_)'] += 1
                main_sheets.append(sheet_name)
            elif sheet_name.startswith('A_'):
                sheet_categories['Advanced (A_)'] += 1
                main_sheets.append(sheet_name)
            elif sheet_name.startswith('S_'):
                sheet_categories['Screening (S_)'] += 1
                main_sheets.append(sheet_name)
            elif sheet_name.startswith('E_'):
                sheet_categories['Economic (E_)'] += 1
                main_sheets.append(sheet_name)
            elif sheet_name == 'ReadMe':
                sheet_categories['Special'] += 1
                main_sheets.append(sheet_name)
            elif sheet_name == 'UP & Down':
                sheet_categories['Special'] += 1
                main_sheets.append(sheet_name)
            else:
                sheet_categories['Ticker Sheets'] += 1

        print("\n### Sheet Categories:")
        for category, count in sorted(sheet_categories.items()):
            print(f"  {category}: {count}")

        print("\n### Main Data Sheets (non-ticker):")
        for sheet in sorted(main_sheets):
            print(f"  - {sheet}")

        # Analyze a few main sheets for structure
        print("\n" + "=" * 80)
        print("### Main Sheet Structure Analysis:")

        target_sheets = ['M_Company', 'A_Company', 'T_EPS_C', 'T_Growth_C', 'T_Rank',
                        'T_CFO', 'T_Correlation', 'S_Mylist']

        for sheet_name in target_sheets:
            if sheet_name in sheets:
                print(f"\n#### {sheet_name}")
                try:
                    with wb.get_sheet(sheet_name) as ws:
                        rows = list(ws.rows())
                        print(f"  Total rows: {len(rows)}")

                        if len(rows) > 0:
                            # Check first row
                            first_row = [cell.v if cell else "" for cell in rows[0]]
                            non_empty = [c for c in first_row if c]
                            print(f"  First row cells: {len(first_row)} (non-empty: {len(non_empty)})")

                            # Show first few non-empty cells
                            print(f"  First row sample: {non_empty[:5]}")

                        if len(rows) > 1:
                            # Check second row
                            second_row = [cell.v if cell else "" for cell in rows[1]]
                            non_empty = [c for c in second_row if c]
                            print(f"  Second row sample: {non_empty[:5]}")

                        # Try to find actual data start
                        header_row_idx = None
                        for i, row in enumerate(rows[:10]):
                            cells = [cell.v if cell else "" for cell in row]
                            # Look for common header patterns
                            if any(str(c).lower() in ['ticker', 'corp', 'company', '종목코드', '종목명']
                                  for c in cells):
                                header_row_idx = i
                                print(f"  Possible header row: {i}")
                                header = [cell.v if cell else "" for cell in rows[i]]
                                non_empty_header = [c for c in header if c]
                                print(f"  Header fields: {non_empty_header[:10]}")
                                break

                        if header_row_idx is not None and len(rows) > header_row_idx + 1:
                            data_rows = len(rows) - header_row_idx - 1
                            print(f"  Estimated data rows: {data_rows}")

                except Exception as e:
                    print(f"  ERROR reading sheet: {str(e)}")
            else:
                print(f"\n#### {sheet_name}")
                print(f"  NOT FOUND in workbook")

        print("\n" + "=" * 80)
        print("### Ticker Sheet Sample (first 10):")
        ticker_sheets = [s for s in sheets if s not in main_sheets][:10]
        for sheet_name in ticker_sheets:
            print(f"  - {sheet_name}")

if __name__ == "__main__":
    analyze_structure()
