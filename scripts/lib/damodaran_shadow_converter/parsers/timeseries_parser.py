"""
Time Series Parser (Group B)
============================

Parser for time-series Damodaran datasets.
Outputs: historical_erp.json

Datasets:
- histimpl.xls → Historical Implied Equity Risk Premiums (US Market)
"""

import json
import logging
import requests
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, Optional

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from config import URLS, OUTPUT_FILES, SHEET_CONFIG
from base.percent_parser import parse_percent, parse_ratio
from base.metadata_generator import generate_historical_erp_metadata
from base.excel_loader import load_excel

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)


class TimeSeriesParser:
    """
    Parser for historical time-series data.

    Output structure (historical_erp.json):
    {
        "metadata": {...},
        "years": {
            "2024": {
                "implied_erp_ddm": 0.0433,
                "implied_erp_fcfe": 0.0451,
                "tbond_rate": 0.043,
                "sp500_level": 4800
            }
        }
    }
    """

    def __init__(self, output_dir: Optional[Path] = None):
        """
        Initialize parser.

        Args:
            output_dir: Output directory for JSON files
        """
        self.output_dir = output_dir or Path(__file__).parent.parent / "output"
        self.years: Dict[str, Dict[str, Any]] = {}
        self.raw_data: bytes = None
        self.year_range: str = ""

    def download(self, timeout: int = 60) -> bytes:
        """
        Download histimpl.xls.

        Args:
            timeout: Request timeout

        Returns:
            Raw content bytes
        """
        url = URLS["histimpl"]
        logger.info(f"Downloading histimpl from {url}...")

        response = requests.get(url, timeout=timeout)
        response.raise_for_status()

        logger.info(f"  Downloaded {len(response.content) / 1024:.1f} KB")
        self.raw_data = response.content
        return response.content

    def parse_histimpl(self, content: Optional[bytes] = None) -> Dict[str, Dict[str, Any]]:
        """
        Parse histimpl.xls for historical implied ERP data.

        Structure (Historical Impl Premiums sheet):
        - Row 1: Header
        - Columns: Year, S&P 500 Level, T.Bond Rate, Implied ERP (DDM), Implied ERP (FCFE)

        Returns:
            Years dictionary
        """
        if content is None:
            content = self.raw_data
        if content is None:
            content = self.download()

        wb = load_excel(content)

        # Try to find the right sheet
        sheet_name = SHEET_CONFIG.get("histimpl", {}).get("sheet_name", "Historical Impl Premiums")
        if sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
        else:
            # Try first sheet
            ws = wb.active
            logger.warning(f"Sheet '{sheet_name}' not found, using: {ws.title}")

        # Find header row
        header_row = 1
        for row_idx in range(1, min(10, ws.max_row + 1)):
            cell_val = ws.cell(row=row_idx, column=1)
            if cell_val and "year" in str(cell_val).lower():
                header_row = row_idx
                break

        # Build column map
        col_map = {}
        for col_idx in range(1, ws.max_column + 1):
            cell_val = ws.cell(row=header_row, column=col_idx)
            if cell_val:
                col_str = str(cell_val).lower().replace(" ", "").replace(".", "")
                if "year" in col_str:
                    col_map["year"] = col_idx
                elif "sp500" in col_str or "s&p" in col_str.replace("&", ""):
                    col_map["sp500_level"] = col_idx
                elif "tbond" in col_str or "tbondrate" in col_str:
                    col_map["tbond_rate"] = col_idx
                elif "impliederpddm" in col_str or ("implied" in col_str and "ddm" in col_str):
                    col_map["implied_erp_ddm"] = col_idx
                elif "impliederpfcfe" in col_str or ("implied" in col_str and "fcfe" in col_str):
                    col_map["implied_erp_fcfe"] = col_idx
                elif "impliedpremium" in col_str or "impliedequitypremium" in col_str:
                    # Generic implied premium (use as DDM if no DDM column)
                    if "implied_erp_ddm" not in col_map:
                        col_map["implied_erp_ddm"] = col_idx

        logger.info(f"  histimpl column mapping: {col_map}")

        years_list = []
        for row_idx in range(header_row + 1, ws.max_row + 1):
            year_val = ws.cell(row=row_idx, column=col_map.get("year", 1))
            if year_val is None:
                continue

            # Try to parse year
            try:
                if isinstance(year_val, (int, float)):
                    year = str(int(year_val))
                else:
                    year = str(year_val).strip()
                # Validate it looks like a year
                if not (year.isdigit() and 1900 <= int(year) <= 2100):
                    continue
            except:
                continue

            year_data = {}

            # S&P 500 Level
            if "sp500_level" in col_map:
                val = ws.cell(row=row_idx, column=col_map["sp500_level"])
                if val is not None:
                    try:
                        year_data["sp500_level"] = round(float(val), 2)
                    except:
                        pass

            # T.Bond Rate
            if "tbond_rate" in col_map:
                val = parse_percent(ws.cell(row=row_idx, column=col_map["tbond_rate"]))
                if val is not None:
                    year_data["tbond_rate"] = round(val, 4)

            # Implied ERP (DDM)
            if "implied_erp_ddm" in col_map:
                val = parse_percent(ws.cell(row=row_idx, column=col_map["implied_erp_ddm"]))
                if val is not None:
                    year_data["implied_erp_ddm"] = round(val, 4)

            # Implied ERP (FCFE)
            if "implied_erp_fcfe" in col_map:
                val = parse_percent(ws.cell(row=row_idx, column=col_map["implied_erp_fcfe"]))
                if val is not None:
                    year_data["implied_erp_fcfe"] = round(val, 4)

            if year_data:
                self.years[year] = year_data
                years_list.append(int(year))

        # Calculate year range
        if years_list:
            self.year_range = f"{min(years_list)}-{max(years_list)}"

        logger.info(f"  Parsed {len(self.years)} years ({self.year_range}) from histimpl.xls")
        return self.years

    def to_json(self, output_path: Optional[Path] = None) -> Path:
        """
        Save data to historical_erp.json.

        Args:
            output_path: Custom output path (optional)

        Returns:
            Path to saved file
        """
        if not self.years:
            self.parse_histimpl()

        # Determine output path
        if output_path is None:
            self.output_dir.mkdir(parents=True, exist_ok=True)
            output_path = self.output_dir / OUTPUT_FILES["historical_erp"]
        else:
            output_path = Path(output_path)

        # Generate metadata
        metadata = generate_historical_erp_metadata(
            year_count=len(self.years),
            year_range=self.year_range,
            url=URLS["histimpl"]
        )
        metadata["source_date"] = "January 2026"
        metadata["scope"] = "US market historical implied ERP"
        metadata["source_format"] = "Damodaran XLS dataset"

        # Build output
        output = {
            "metadata": metadata,
            "years": self.years
        }

        # Save
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(output, f, indent=2, ensure_ascii=False)

        file_size = output_path.stat().st_size / 1024
        logger.info(f"Saved to: {output_path} ({file_size:.1f} KB)")

        return output_path

    def convert(self, output_path: Optional[Path] = None) -> Path:
        """
        Full conversion pipeline: download -> parse -> save.

        Args:
            output_path: Output path (optional)

        Returns:
            Path to saved file
        """
        self.download()
        self.parse_histimpl()
        return self.to_json(output_path)


# =============================================================================
# CLI
# =============================================================================

def main():
    """CLI entry point."""
    import argparse

    parser = argparse.ArgumentParser(description="Parse Damodaran historical ERP data")
    parser.add_argument(
        "-o", "--output",
        help="Output file path (default: output/historical_erp.json)"
    )
    args = parser.parse_args()

    # Parse
    tsp = TimeSeriesParser()
    output_path = tsp.convert(
        output_path=Path(args.output) if args.output else None
    )

    # Summary
    print("\n" + "=" * 60)
    print(f"Years: {len(tsp.years)}")
    print(f"Range: {tsp.year_range}")
    print(f"Output: {output_path}")

    # Show recent years
    if tsp.years:
        print("\nRecent data:")
        sorted_years = sorted(tsp.years.keys(), reverse=True)[:5]
        for year in sorted_years:
            data = tsp.years[year]
            erp = data.get("implied_erp_ddm", data.get("implied_erp_fcfe", "N/A"))
            if isinstance(erp, float):
                erp = f"{erp:.2%}"
            print(f"  {year}: ERP={erp}")
    print("=" * 60)


if __name__ == "__main__":
    main()
