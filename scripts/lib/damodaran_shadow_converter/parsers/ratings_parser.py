"""
Ratings Parser (Group C)
========================

Parser for credit rating lookup tables from Damodaran.
Outputs: credit_ratings.json

Datasets:
- ratings.xls -> Interest Coverage to Credit Rating lookup tables

Features:
- Dynamic parsing of current workbook lookup tables
- Fallback to hardcoded data if parsing fails
- Support for 3 company types: large_manufacturing, small_risky, financial
"""

import json
import logging
import requests
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from config import URLS, OUTPUT_FILES, SHEET_CONFIG, RATINGS_FALLBACK
from base.percent_parser import parse_percent, parse_ratio
from base.metadata_generator import generate_credit_ratings_metadata
from base.excel_loader import load_excel
from base.html_table import is_html_content, parse_number

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)


class RatingsParser:
    """
    Parser for credit rating lookup tables.

    Output structure (credit_ratings.json):
    {
        "metadata": {
            "parsing_method": "dynamic" | "fallback",
            "fallback_used": false | true,
            "warning": "..." (if fallback used)
        },
        "lookup_tables": {
            "large_manufacturing": [
                {"min_coverage": 12.5, "max_coverage": null, "rating": "AAA", "spread": 0.0063}
            ],
            "small_risky": [...],
            "financial": [...]
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
        self.lookup_tables: Dict[str, List[Dict[str, Any]]] = {}
        self.raw_data: bytes = None
        self.parsing_method: str = "dynamic"
        self.fallback_used: bool = False
        self.fallback_tables: List[str] = []

    def download(self, timeout: int = 60) -> bytes:
        """
        Download ratings.xls.

        Args:
            timeout: Request timeout

        Returns:
            Raw content bytes
        """
        url = URLS["ratings"]
        logger.info(f"Downloading ratings from {url}...")

        response = requests.get(url, timeout=timeout)
        response.raise_for_status()

        logger.info(f"  Downloaded {len(response.content) / 1024:.1f} KB")
        self.raw_data = response.content
        return response.content

    def _find_lookup_table_range(self, ws) -> Tuple[int, int]:
        """
        Find the row range for lookup tables in the sheet.

        Scans for patterns like "Interest Coverage Ratio" or rating headers.

        Returns:
            Tuple of (start_row, end_row)
        """
        config = SHEET_CONFIG.get("ratings", {})
        lookup_start = config.get("lookup_start_row", 27)
        lookup_end = config.get("lookup_end_row", 50)

        # Try to auto-detect by scanning for patterns
        for row_idx in range(1, min(60, ws.max_row + 1)):
            cell_val = ws.cell(row=row_idx, column=1)
            if cell_val:
                cell_str = str(cell_val).lower()
                if "interest coverage" in cell_str or "if greater than" in cell_str:
                    # Found potential start
                    lookup_start = row_idx
                    # Look for end
                    for end_idx in range(row_idx + 1, min(row_idx + 30, ws.max_row + 1)):
                        end_cell = ws.cell(row=end_idx, column=1)
                        if end_cell is None or str(end_cell).strip() == "":
                            lookup_end = end_idx - 1
                            break
                    break

        return lookup_start, lookup_end

    def _parse_single_table(
        self,
        ws,
        start_row: int,
        end_row: int,
        rating_col: int,
        spread_col: int,
        coverage_col: int = 1
    ) -> List[Dict[str, Any]]:
        """
        Parse a single lookup table from specific columns.

        Args:
            ws: Worksheet
            start_row: Start row
            end_row: End row
            rating_col: Column index for rating
            spread_col: Column index for spread
            coverage_col: Column index for coverage threshold (default: 1)

        Returns:
            List of lookup entries
        """
        entries = []
        prev_coverage = None

        for row_idx in range(start_row, end_row + 1):
            # Coverage threshold
            coverage_val = ws.cell(row=row_idx, column=coverage_col)
            if coverage_val is None:
                continue

            # Try to extract numeric coverage
            coverage_str = str(coverage_val).lower()
            min_coverage = None

            # Pattern: "If greater than X"
            if "greater than" in coverage_str:
                import re
                match = re.search(r'(\d+\.?\d*)', coverage_str)
                if match:
                    min_coverage = float(match.group(1))
            elif coverage_str.replace(".", "").replace("-", "").isdigit():
                min_coverage = float(coverage_val)

            if min_coverage is None:
                continue

            # Rating
            rating_val = ws.cell(row=row_idx, column=rating_col)
            if rating_val is None:
                continue
            rating = str(rating_val).strip()

            # Spread
            spread_val = ws.cell(row=row_idx, column=spread_col)
            spread = parse_percent(spread_val)

            if not rating or spread is None:
                continue

            entry = {
                "min_coverage": min_coverage,
                "max_coverage": prev_coverage,  # Previous row's min is this row's max
                "rating": rating,
                "spread": round(spread, 4)
            }
            entries.append(entry)
            prev_coverage = min_coverage

        # First entry should have max_coverage = null (highest rating)
        if entries:
            entries[0]["max_coverage"] = None

        return entries

    def _parse_range_table(
        self,
        ws,
        start_row: int,
        base_col: int,
    ) -> List[Dict[str, Any]]:
        """
        Parse current workbook tables that use low/high coverage bounds.

        Expected columns from base_col:
        lower coverage, upper coverage, rating, spread.
        """
        entries = []

        for row_idx in range(start_row, ws.max_row + 1):
            low = parse_number(ws.cell(row=row_idx, column=base_col))
            high = parse_number(ws.cell(row=row_idx, column=base_col + 1))
            rating_val = ws.cell(row=row_idx, column=base_col + 2)
            spread = parse_number(ws.cell(row=row_idx, column=base_col + 3), percent=True)

            if low is None and high is None and not rating_val:
                break
            if low is None or high is None or spread is None:
                continue

            rating = str(rating_val).strip()
            if not rating or rating.lower() == "nan":
                continue

            min_coverage = 0 if low <= -99999 else low
            max_coverage = None if high >= 99999 else high
            entries.append({
                "min_coverage": round(min_coverage, 6),
                "max_coverage": round(max_coverage, 6) if max_coverage is not None else None,
                "rating": rating,
                "spread": round(spread, 6),
            })

        entries.sort(key=lambda item: item["min_coverage"], reverse=True)
        return entries

    def _parse_current_workbook_tables(self, ws) -> Dict[str, List[Dict[str, Any]]]:
        """
        Parse the current Damodaran ratings workbook.

        The public workbook places large non-financial and financial tables side
        by side, then the small/risky table below them.
        """
        tables: Dict[str, List[Dict[str, Any]]] = {}

        for row_idx in range(1, min(ws.max_row, 80) + 1):
            col1 = ws.cell(row=row_idx, column=1)
            col6 = ws.cell(row=row_idx, column=6)
            col1_text = str(col1 or "").lower()
            col6_text = str(col6 or "").lower()

            if "large" in col1_text and "non-financial" in col1_text:
                large = self._parse_range_table(ws, start_row=row_idx + 3, base_col=1)
                if large:
                    tables["large_manufacturing"] = large
                    logger.info(f"    Parsed {len(large)} entries for large_manufacturing from XLS")

            if "financial" in col6_text:
                financial = self._parse_range_table(ws, start_row=row_idx + 3, base_col=6)
                if financial:
                    tables["financial"] = financial
                    logger.info(f"    Parsed {len(financial)} entries for financial from XLS")

            if "smaller" in col1_text and "risk" in col1_text:
                small = self._parse_range_table(ws, start_row=row_idx + 3, base_col=1)
                if small:
                    tables["small_risky"] = small
                    logger.info(f"    Parsed {len(small)} entries for small_risky from XLS")

        return tables

    def parse_ratings(self, content: Optional[bytes] = None) -> Dict[str, List[Dict[str, Any]]]:
        """
        Parse ratings.xls for credit rating lookup tables.

        Attempts dynamic parsing first, falls back to hardcoded data if needed.

        Returns:
            Lookup tables dictionary
        """
        if content is None:
            content = self.raw_data
        if content is None:
            content = self.download()

        if is_html_content(content):
            return self._parse_ratings_html(content)

        try:
            wb = load_excel(content)

            # Try to find the right sheet
            sheet_name = SHEET_CONFIG.get("ratings", {}).get("sheet_name", "Start here Ratings sheet")
            if sheet_name in wb.sheetnames:
                ws = wb[sheet_name]
            else:
                # Try first sheet
                ws = wb.active
                logger.warning(f"Sheet '{sheet_name}' not found, using: {ws.title}")

            current_tables = self._parse_current_workbook_tables(ws)
            if {"large_manufacturing", "small_risky", "financial"}.issubset(current_tables):
                self.lookup_tables = {
                    "large_manufacturing": current_tables["large_manufacturing"],
                    "small_risky": current_tables["small_risky"],
                    "financial": current_tables["financial"],
                }
                self.parsing_method = "xls_dynamic"
                self.fallback_used = False
                logger.info("  Successfully parsed 3 lookup tables from current ratings workbook")
                return self.lookup_tables

            # Legacy fallback for older workbook structures.
            # Find lookup table range
            start_row, end_row = self._find_lookup_table_range(ws)
            logger.info(f"  Lookup table range: rows {start_row}-{end_row}")

            # Scan header row to find table columns
            # Typical structure: Col 1-3 = Large Manufacturing, Col 4-6 = Small/Risky, Col 7-9 = Financial
            table_configs = []

            header_row = start_row - 1
            for col_idx in range(1, ws.max_column + 1):
                cell_val = ws.cell(row=header_row, column=col_idx)
                if cell_val:
                    cell_str = str(cell_val).lower()
                    if "large" in cell_str or "manufacturing" in cell_str:
                        table_configs.append(("large_manufacturing", col_idx))
                    elif "small" in cell_str or "risky" in cell_str:
                        table_configs.append(("small_risky", col_idx))
                    elif "financial" in cell_str:
                        table_configs.append(("financial", col_idx))

            logger.info(f"  Found table configs: {table_configs}")

            # Parse each table
            parsed_count = 0
            for table_type, base_col in table_configs:
                # Assume: coverage in col, rating in col+1, spread in col+2
                entries = self._parse_single_table(
                    ws,
                    start_row=start_row,
                    end_row=end_row,
                    rating_col=base_col + 1,
                    spread_col=base_col + 2,
                    coverage_col=base_col
                )

                if entries:
                    self.lookup_tables[table_type] = entries
                    parsed_count += 1
                    logger.info(f"    Parsed {len(entries)} entries for {table_type}")

            # If we didn't find any tables, try a simpler approach
            if parsed_count == 0:
                logger.warning("  Complex structure detected, trying simple parse...")
                entries = self._parse_single_table(
                    ws,
                    start_row=start_row,
                    end_row=end_row,
                    rating_col=2,
                    spread_col=3,
                    coverage_col=1
                )
                if entries:
                    self.lookup_tables["large_manufacturing"] = entries
                    parsed_count = 1

            if parsed_count > 0:
                self.parsing_method = "dynamic"
                self.fallback_used = False
                logger.info(f"  Successfully parsed {parsed_count} lookup tables dynamically")
                return self.lookup_tables

        except Exception as e:
            logger.error(f"  Dynamic parsing failed: {e}")

        # Fallback to hardcoded data
        logger.warning("  Using fallback hardcoded data")
        self._use_fallback()
        return self.lookup_tables

    def _parse_ratings_html(self, content: bytes) -> Dict[str, List[Dict[str, Any]]]:
        """
        Parse the current-year ratings HTML table.

        The current public page exposes large non-financial and financial firm
        tables. The legacy small/risky table is not present, so it remains a
        targeted fallback table for compatibility.
        """
        import pandas as pd
        from io import BytesIO

        df = pd.read_html(BytesIO(content))[0]

        def parse_table(table_type: str, base_col: int) -> List[Dict[str, Any]]:
            entries = []
            for row_idx in range(4, len(df)):
                low = parse_number(df.iloc[row_idx, base_col])
                high = parse_number(df.iloc[row_idx, base_col + 1])
                rating_val = df.iloc[row_idx, base_col + 2]
                spread = parse_number(df.iloc[row_idx, base_col + 3], percent=True)
                if low is None or high is None or spread is None:
                    continue
                rating = str(rating_val).strip()
                if not rating or rating.lower() == "nan":
                    continue
                min_coverage = 0 if low <= -99999 else low
                max_coverage = None if high >= 99999 else high
                entries.append({
                    "min_coverage": round(min_coverage, 6),
                    "max_coverage": round(max_coverage, 6) if max_coverage is not None else None,
                    "rating": rating,
                    "spread": round(spread, 4),
                })

            entries.sort(key=lambda item: item["min_coverage"], reverse=True)
            logger.info(f"    Parsed {len(entries)} entries for {table_type} from HTML")
            return entries

        large = parse_table("large_manufacturing", 0)
        financial = parse_table("financial", 5)
        if large:
            self.lookup_tables["large_manufacturing"] = large
        if financial:
            self.lookup_tables["financial"] = financial

        # Current HTML does not expose a separate small/risky table. Preserve
        # the existing compatibility table explicitly instead of pretending the
        # large-firm table applies.
        self.lookup_tables["small_risky"] = RATINGS_FALLBACK["small_risky"]
        self.fallback_tables = ["small_risky"]
        self.fallback_used = True
        self.parsing_method = "html_dynamic_partial_fallback"
        logger.warning("  small_risky table not present in HTML; using compatibility fallback")

        if not large or not financial:
            logger.warning("  HTML parsing incomplete; using full fallback")
            self._use_fallback()

        return self.lookup_tables

    def _use_fallback(self):
        """
        Use fallback hardcoded data when dynamic parsing fails.
        """
        self.lookup_tables = RATINGS_FALLBACK.copy()
        self.parsing_method = "fallback"
        self.fallback_used = True
        self.fallback_tables = sorted(self.lookup_tables.keys())
        logger.warning("  ⚠️ Fallback data used - spreads may not reflect latest values")

    def to_json(self, output_path: Optional[Path] = None) -> Path:
        """
        Save data to credit_ratings.json.

        Args:
            output_path: Custom output path (optional)

        Returns:
            Path to saved file
        """
        if not self.lookup_tables:
            self.parse_ratings()

        # Determine output path
        if output_path is None:
            self.output_dir.mkdir(parents=True, exist_ok=True)
            output_path = self.output_dir / OUTPUT_FILES["credit_ratings"]
        else:
            output_path = Path(output_path)

        # Generate metadata
        metadata = generate_credit_ratings_metadata(
            table_count=len(self.lookup_tables),
            url=URLS["ratings"],
            parsing_method=self.parsing_method,
            fallback_used=self.fallback_used
        )
        metadata["fallback_used"] = self.fallback_used
        if self.fallback_tables:
            metadata["fallback_tables"] = self.fallback_tables
        metadata["source_date"] = "January 2026"
        metadata["scope"] = "US credit rating spread lookup"
        metadata["source_format"] = (
            "Damodaran current ratings workbook"
            if self.parsing_method.startswith("xls")
            else "Damodaran HTML current data page"
        )

        # Build output
        output = {
            "metadata": metadata,
            "lookup_tables": self.lookup_tables
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
        self.parse_ratings()
        return self.to_json(output_path)


# =============================================================================
# Helper Functions
# =============================================================================

def lookup_rating(
    coverage_ratio: float,
    lookup_table: List[Dict[str, Any]]
) -> Optional[Dict[str, Any]]:
    """
    Look up credit rating for a given interest coverage ratio.

    Args:
        coverage_ratio: Interest coverage ratio (EBIT / Interest Expense)
        lookup_table: List of lookup entries from credit_ratings.json

    Returns:
        Dict with rating and spread, or None if not found

    Example:
        >>> from parsers.ratings_parser import lookup_rating
        >>> import json
        >>> data = json.load(open("output/credit_ratings.json"))
        >>> lookup_rating(5.0, data["lookup_tables"]["large_manufacturing"])
        {'rating': 'A-', 'spread': 0.0122}
    """
    for entry in lookup_table:
        min_cov = entry.get("min_coverage", 0)
        max_cov = entry.get("max_coverage")

        # Check range
        if max_cov is None:
            # First entry (highest rating) - coverage >= min
            if coverage_ratio >= min_cov:
                return {"rating": entry["rating"], "spread": entry["spread"]}
        else:
            # Middle entries - min <= coverage < max
            if min_cov <= coverage_ratio < max_cov:
                return {"rating": entry["rating"], "spread": entry["spread"]}

    # If coverage is below all ranges, return lowest rating (last entry)
    if lookup_table:
        last_entry = lookup_table[-1]
        if coverage_ratio < last_entry.get("min_coverage", 0):
            return {"rating": last_entry["rating"], "spread": last_entry["spread"]}

    return None


# =============================================================================
# CLI
# =============================================================================

def main():
    """CLI entry point."""
    import argparse

    parser = argparse.ArgumentParser(description="Parse Damodaran credit rating data")
    parser.add_argument(
        "-o", "--output",
        help="Output file path (default: output/credit_ratings.json)"
    )
    parser.add_argument(
        "--test-lookup",
        type=float,
        help="Test lookup with given coverage ratio"
    )
    args = parser.parse_args()

    # Parse
    rp = RatingsParser()
    output_path = rp.convert(
        output_path=Path(args.output) if args.output else None
    )

    # Summary
    print("\n" + "=" * 60)
    print(f"Lookup Tables: {list(rp.lookup_tables.keys())}")
    print(f"Parsing Method: {rp.parsing_method}")
    if rp.fallback_used:
        print("⚠️  WARNING: Fallback data used - spreads may not be current")
    print(f"Output: {output_path}")

    # Show sample data
    if rp.lookup_tables:
        print("\nSample (large_manufacturing):")
        table = rp.lookup_tables.get("large_manufacturing", [])
        for entry in table[:5]:
            min_c = entry.get("min_coverage", "N/A")
            max_c = entry.get("max_coverage", "∞")
            rating = entry.get("rating", "N/A")
            spread = entry.get("spread", 0)
            print(f"  Coverage {min_c}-{max_c}: {rating} ({spread:.2%})")

    # Test lookup if requested
    if args.test_lookup:
        print(f"\nLookup test for coverage ratio {args.test_lookup}:")
        for table_name, table in rp.lookup_tables.items():
            result = lookup_rating(args.test_lookup, table)
            if result:
                print(f"  {table_name}: {result['rating']} (spread: {result['spread']:.2%})")

    print("=" * 60)


if __name__ == "__main__":
    main()
