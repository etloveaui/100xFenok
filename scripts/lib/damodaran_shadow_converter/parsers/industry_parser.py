"""
Industry Parser (Group A)
=========================

Unified parser for 6 industry-based Damodaran datasets.
Outputs: industries.json

Datasets merged:
- betas.xls      → beta (levered, unlevered, unlevered_cash_adj, d_e_ratio)
- margin.xls     → margins (net, operating, ebitda, gross)
- eva.xls        → eva (roe, roc, wacc, eva_millions)
- debtdetails.xls → debt (total_debt, lease_debt, short_term_pct)
- fundgr.xls     → growth (fundamental_growth, retention_ratio, roe_for_growth)
- ev_sales (HTML) → multiples (ev_sales, price_sales)
"""

import json
import logging
import requests
import pandas as pd
from datetime import datetime
from io import BytesIO, StringIO
from pathlib import Path
from typing import Any, Dict, List, Optional

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from config import URLS, OUTPUT_FILES, GROUP_A_DATASETS, SHEET_CONFIG
from base.industry_normalizer import normalize_industry_name, normalize_with_typo_fix
from base.percent_parser import parse_percent, parse_ratio, parse_int
from base.metadata_generator import generate_industries_metadata
from base.excel_loader import load_excel
from base.html_table import (
    build_column_map,
    is_html_content,
    normalize_text,
    parse_int_value,
    parse_number,
    read_first_table,
)

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)


class IndustryParser:
    """
    Unified industry data parser for Group A datasets.

    Merges 6 Damodaran datasets into single industries.json with structure:
    {
        "metadata": {...},
        "industries": {
            "Industry Name": {
                "num_firms": int,
                "beta": {...},
                "margins": {...},
                "eva": {...},
                "debt": {...},
                "growth": {...},
                "multiples": {...}
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
        self.industries: Dict[str, Dict[str, Any]] = {}
        self.raw_data: Dict[str, Any] = {}
        self.datasets_parsed: List[str] = []

    def download_dataset(self, dataset: str, timeout: int = 60) -> bytes:
        """
        Download a single dataset.

        Args:
            dataset: Dataset name (betas, margin, etc.)
            timeout: Request timeout

        Returns:
            Raw content bytes
        """
        url = URLS.get(dataset)
        if not url:
            raise ValueError(f"Unknown dataset: {dataset}")

        logger.info(f"Downloading {dataset} from {url}...")
        response = requests.get(url, timeout=timeout)
        response.raise_for_status()

        logger.info(f"  Downloaded {len(response.content) / 1024:.1f} KB")
        return response.content

    def _get_or_create_industry(self, name: str) -> Dict[str, Any]:
        """Get existing industry dict or create new one."""
        normalized = normalize_with_typo_fix(name)
        if normalized not in self.industries:
            self.industries[normalized] = {}
        return self.industries[normalized]

    def _find_header_row(self, ws, search_text: str = "Industry Name", max_rows: int = 30) -> int:
        """
        Dynamically find header row by searching for specific text.

        Args:
            ws: Worksheet
            search_text: Text to search for in column 1
            max_rows: Maximum rows to search

        Returns:
            Header row number (1-indexed)

        Raises:
            ValueError: If header row not found within max_rows
        """
        for row in range(1, min(max_rows, ws.max_row + 1)):
            cell_val = ws.cell(row, 1)
            if cell_val and search_text.lower() in str(cell_val).lower():
                return row
        raise ValueError(
            f"Header row not found: '{search_text}' not in first {max_rows} rows of sheet '{ws.title}'. "
            f"Damodaran may have changed the Excel structure."
        )

    def _last_column_with(self, columns, *needles: str):
        """Return the last column matching all normalized needles."""
        normalized_needles = [normalize_text(n) for n in needles]
        match = None
        for col in columns:
            col_norm = normalize_text(col)
            if all(needle in col_norm for needle in normalized_needles):
                match = col
        return match

    def _parse_common_industry_rows(self, content: bytes):
        """Load a Damodaran current-year HTML table and find the industry column."""
        df = read_first_table(content)
        col_map = build_column_map(df.columns, {
            "industry": ["industry&&name"],
            "num_firms": ["number&&firm"],
        })
        industry_col = col_map.get("industry", df.columns[0])
        return df, col_map, industry_col

    def _industry_from_row(self, row, industry_col) -> Optional[str]:
        """Return normalized industry name or None for invalid rows."""
        industry_val = row[industry_col]
        if pd.isna(industry_val):
            return None
        industry = str(industry_val).strip()
        if industry.lower() in ["total", "average", "", "nan"]:
            return None
        return industry

    def _maybe_set_num_firms(self, ind_data: Dict[str, Any], row, col_map: Dict[str, Any]):
        """Set num_firms if available and not already set."""
        if "num_firms" in ind_data or "num_firms" not in col_map:
            return
        num_firms = parse_int_value(row[col_map["num_firms"]])
        if num_firms is not None:
            ind_data["num_firms"] = num_firms

    def parse_html_dataset(self, dataset: str, content: bytes) -> int:
        """Parse one current-year Damodaran HTML industry table."""
        if dataset == "ev_sales":
            html_content = content.decode("utf-8", errors="replace")
            return self.parse_ev_sales(html_content)

        df, col_map, industry_col = self._parse_common_industry_rows(content)
        columns = list(df.columns)

        if dataset == "betas":
            col_map.update(build_column_map(columns, {
                "levered": ["beta"],
                "d_e_ratio": ["d&&e&&ratio"],
                "unlevered": ["unlevered&&beta"],
                "unlevered_cash": ["unlevered&&cash"],
            }))
        elif dataset == "margin":
            col_map.update(build_column_map(columns, {
                "gross": ["gross&&margin"],
                "net": ["net&&margin"],
                "ebitda": ["ebitda&&sales"],
            }))
            operating_col = self._last_column_with(columns, "pretax", "margin")
            if operating_col is not None:
                col_map["operating"] = operating_col
        elif dataset == "eva":
            col_map.update(build_column_map(columns, {
                "roe": ["roe"],
                "roc": ["roc"],
                "wacc": ["cost&&capital"],
                "eva": ["eva"],
            }))
        elif dataset == "debtdetails":
            col_map.update(build_column_map(columns, {
                "lease_debt": ["lease&&debt&&estimate"],
                "total_debt": ["total&&debt&&leases"],
                "short_term_pct": ["short&&term&&debt"],
            }))
        elif dataset == "fundgr":
            col_map.update(build_column_map(columns, {
                "roe_for_growth": ["roe"],
                "retention_ratio": ["retention&&ratio"],
                "fundamental_growth": ["fundamental&&growth"],
            }))
        else:
            raise ValueError(f"Unsupported HTML industry dataset: {dataset}")

        logger.info(f"  {dataset} HTML column mapping: {col_map}")

        count = 0
        for _, row in df.iterrows():
            industry = self._industry_from_row(row, industry_col)
            if not industry:
                continue

            ind_data = self._get_or_create_industry(industry)
            self._maybe_set_num_firms(ind_data, row, col_map)

            if dataset == "betas":
                beta_data = {}
                for key, out_key, is_pct in [
                    ("levered", "levered", False),
                    ("unlevered", "unlevered", False),
                    ("unlevered_cash", "unlevered_cash_adj", False),
                    ("d_e_ratio", "d_e_ratio", True),
                ]:
                    if key in col_map:
                        val = parse_number(row[col_map[key]], percent=is_pct)
                        if val is not None:
                            beta_data[out_key] = round(val, 4)
                if beta_data:
                    ind_data["beta"] = beta_data
                    count += 1

            elif dataset == "margin":
                margins = {}
                for key in ["net", "operating", "ebitda", "gross"]:
                    if key in col_map:
                        val = parse_number(row[col_map[key]], percent=True)
                        if val is not None:
                            margins[key] = round(val, 4)
                if margins:
                    ind_data["margins"] = margins
                    count += 1

            elif dataset == "eva":
                eva_data = {}
                for key in ["roe", "roc", "wacc"]:
                    if key in col_map:
                        val = parse_number(row[col_map[key]], percent=True)
                        if val is not None:
                            eva_data[key] = round(val, 4)
                if "eva" in col_map:
                    val = parse_number(row[col_map["eva"]])
                    if val is not None:
                        eva_data["eva_millions"] = round(val, 2)
                if eva_data:
                    ind_data["eva"] = eva_data
                    count += 1

            elif dataset == "debtdetails":
                debt_data = {}
                for key in ["total_debt", "lease_debt"]:
                    if key in col_map:
                        val = parse_number(row[col_map[key]])
                        if val is not None:
                            debt_data[key] = round(val, 2)
                if "short_term_pct" in col_map:
                    val = parse_number(row[col_map["short_term_pct"]], percent=True)
                    if val is not None:
                        debt_data["short_term_pct"] = round(val, 4)
                if debt_data:
                    ind_data["debt"] = debt_data
                    count += 1

            elif dataset == "fundgr":
                growth_data = {}
                for key in ["fundamental_growth", "retention_ratio", "roe_for_growth"]:
                    if key in col_map:
                        val = parse_number(row[col_map[key]], percent=True)
                        if val is not None:
                            growth_data[key] = round(val, 4)
                if growth_data:
                    ind_data["growth"] = growth_data
                    count += 1

        logger.info(f"  Parsed {count} industries from {dataset} HTML")
        return count

    # =========================================================================
    # Dataset Parsers
    # =========================================================================

    def parse_betas(self, content: bytes) -> int:
        """
        Parse betas.xls for beta values.

        Structure (Industry Averages sheet):
        - Dynamic header detection (typically row 10)
        - Columns: Industry Name, Number of firms, Beta, D/E Ratio,
                   Unlevered beta, Unlevered beta corrected for cash

        Returns:
            Number of industries parsed
        """
        wb = load_excel(content)
        ws = wb["Industry Averages"]

        # Dynamic header detection
        header_row = self._find_header_row(ws, "Industry Name")
        logger.info(f"  betas header row: {header_row}")

        # Build column map from header row
        col_map = {}
        for col_idx in range(1, ws.max_column + 1):
            cell_val = ws.cell(header_row, col_idx)
            if cell_val:
                col_str = str(cell_val).lower().replace(" ", "").replace("-", "")
                if "industryname" in col_str:
                    col_map["industry"] = col_idx
                elif "numberoffirm" in col_str:
                    col_map["num_firms"] = col_idx
                elif "unleveredbeta" in col_str and ("cash" in col_str or "corre" in col_str):
                    col_map["unlevered_cash"] = col_idx
                elif "unleveredbeta" in col_str:
                    col_map["unlevered"] = col_idx
                elif "beta" in col_str and "unlev" not in col_str:
                    col_map["levered"] = col_idx
                elif "d/eratio" in col_str or "deratio" in col_str:
                    col_map["d_e_ratio"] = col_idx

        logger.info(f"  betas column mapping: {col_map}")

        count = 0
        for row_idx in range(header_row + 1, ws.max_row + 1):
            industry_val = ws.cell(row=row_idx, column=col_map.get("industry", 1))
            if not industry_val:
                continue

            industry = str(industry_val).strip()
            if industry.lower() in ["total", "average", "", "nan"]:
                continue

            ind_data = self._get_or_create_industry(industry)

            # Num firms (shared across datasets)
            if "num_firms" not in ind_data and "num_firms" in col_map:
                num_firms = parse_int(ws.cell(row=row_idx, column=col_map["num_firms"]))
                if num_firms:
                    ind_data["num_firms"] = num_firms

            # Beta data
            beta_data = {}
            if "levered" in col_map:
                val = parse_ratio(ws.cell(row=row_idx, column=col_map["levered"]))
                if val is not None:
                    beta_data["levered"] = round(val, 4)
            if "unlevered" in col_map:
                val = parse_ratio(ws.cell(row=row_idx, column=col_map["unlevered"]))
                if val is not None:
                    beta_data["unlevered"] = round(val, 4)
            if "unlevered_cash" in col_map:
                val = parse_ratio(ws.cell(row=row_idx, column=col_map["unlevered_cash"]))
                if val is not None:
                    beta_data["unlevered_cash_adj"] = round(val, 4)
            if "d_e_ratio" in col_map:
                val = parse_ratio(ws.cell(row=row_idx, column=col_map["d_e_ratio"]))
                if val is not None:
                    beta_data["d_e_ratio"] = round(val, 4)

            if beta_data:
                ind_data["beta"] = beta_data
                count += 1

        logger.info(f"  Parsed {count} industries from betas.xls")
        return count

    def parse_margin(self, content: bytes) -> int:
        """
        Parse margin.xls for margin data.

        Returns:
            Number of industries parsed
        """
        wb = load_excel(content)
        ws = wb["Industry Averages"]

        # Dynamic header detection
        header_row = self._find_header_row(ws, "Industry Name")
        logger.info(f"  margin header row: {header_row}")

        # Build column map
        col_map = {}
        for col_idx in range(1, ws.max_column + 1):
            cell_val = ws.cell(header_row, col_idx)
            if cell_val:
                col_str = str(cell_val).lower().replace(" ", "").replace("-", "")
                if "industryname" in col_str:
                    col_map["industry"] = col_idx
                elif "netmargin" in col_str:
                    col_map["net"] = col_idx
                elif "operatingmargin" in col_str or "pretax" in col_str:
                    col_map["operating"] = col_idx
                elif "ebitda" in col_str:
                    col_map["ebitda"] = col_idx
                elif "grossmargin" in col_str:
                    col_map["gross"] = col_idx

        logger.info(f"  margin column mapping: {col_map}")

        count = 0
        for row_idx in range(header_row + 1, ws.max_row + 1):
            industry_val = ws.cell(row=row_idx, column=col_map.get("industry", 1))
            if not industry_val:
                continue

            industry = str(industry_val).strip()
            if industry.lower() in ["total", "average", "", "nan"]:
                continue

            ind_data = self._get_or_create_industry(industry)

            margins = {}
            for key in ["net", "operating", "ebitda", "gross"]:
                if key in col_map:
                    val = parse_percent(ws.cell(row=row_idx, column=col_map[key]))
                    if val is not None:
                        margins[key] = round(val, 4)

            if margins:
                ind_data["margins"] = margins
                count += 1

        logger.info(f"  Parsed {count} industries from margin.xls")
        return count

    def parse_eva(self, content: bytes) -> int:
        """
        Parse eva.xls for EVA data (ROE, ROC, WACC, EVA).

        Returns:
            Number of industries parsed
        """
        wb = load_excel(content)
        ws = wb["Industry Averages"]

        # Dynamic header detection (eva header typically at row 19)
        header_row = self._find_header_row(ws, "Industry Name")
        logger.info(f"  eva header row: {header_row}")

        col_map = {}
        for col_idx in range(1, ws.max_column + 1):
            cell_val = ws.cell(row=header_row, column=col_idx)
            if cell_val:
                col_str = str(cell_val).lower().replace(" ", "")
                if "industryname" in col_str:
                    col_map["industry"] = col_idx
                elif "roe" in col_str:
                    col_map["roe"] = col_idx
                elif "roc" in col_str or "roic" in col_str:
                    col_map["roc"] = col_idx
                elif "wacc" in col_str or "costofcapital" in col_str:
                    col_map["wacc"] = col_idx
                elif "eva" in col_str:
                    col_map["eva"] = col_idx

        logger.info(f"  eva column mapping: {col_map}")

        count = 0
        for row_idx in range(header_row + 1, ws.max_row + 1):
            industry_val = ws.cell(row=row_idx, column=col_map.get("industry", 1))
            if not industry_val:
                continue

            industry = str(industry_val).strip()
            if industry.lower() in ["total", "average", "", "nan"]:
                continue

            ind_data = self._get_or_create_industry(industry)

            eva_data = {}
            for key in ["roe", "roc", "wacc"]:
                if key in col_map:
                    val = parse_percent(ws.cell(row=row_idx, column=col_map[key]))
                    if val is not None:
                        eva_data[key] = round(val, 4)
            if "eva" in col_map:
                val = parse_ratio(ws.cell(row=row_idx, column=col_map["eva"]))
                if val is not None:
                    eva_data["eva_millions"] = round(val, 2)

            if eva_data:
                ind_data["eva"] = eva_data
                count += 1

        logger.info(f"  Parsed {count} industries from eva.xls")
        return count

    def parse_debtdetails(self, content: bytes) -> int:
        """
        Parse debtdetails.xls for debt structure.

        Returns:
            Number of industries parsed
        """
        wb = load_excel(content)
        ws = wb["Industry Values"]

        # Dynamic header detection (debtdetails header typically at row 8)
        header_row = self._find_header_row(ws, "Industry Name")
        logger.info(f"  debtdetails header row: {header_row}")

        col_map = {}
        for col_idx in range(1, ws.max_column + 1):
            cell_val = ws.cell(row=header_row, column=col_idx)
            if cell_val:
                col_str = str(cell_val).lower().replace(" ", "")
                if "industryname" in col_str:
                    col_map["industry"] = col_idx
                elif "totaldebt" in col_str or "bookdebt" in col_str:
                    col_map["total_debt"] = col_idx
                elif "leasedebt" in col_str or "lease" in col_str:
                    col_map["lease_debt"] = col_idx
                elif "shortterm" in col_str or "stdebt" in col_str:
                    col_map["short_term_pct"] = col_idx

        logger.info(f"  debtdetails column mapping: {col_map}")

        count = 0
        for row_idx in range(header_row + 1, ws.max_row + 1):
            industry_val = ws.cell(row=row_idx, column=col_map.get("industry", 1))
            if not industry_val:
                continue

            industry = str(industry_val).strip()
            if industry.lower() in ["total", "average", "", "nan"]:
                continue

            ind_data = self._get_or_create_industry(industry)

            debt_data = {}
            for key in ["total_debt", "lease_debt"]:
                if key in col_map:
                    val = parse_ratio(ws.cell(row=row_idx, column=col_map[key]))
                    if val is not None:
                        debt_data[key] = round(val, 2)
            if "short_term_pct" in col_map:
                val = parse_percent(ws.cell(row=row_idx, column=col_map["short_term_pct"]))
                if val is not None:
                    debt_data["short_term_pct"] = round(val, 4)

            if debt_data:
                ind_data["debt"] = debt_data
                count += 1

        logger.info(f"  Parsed {count} industries from debtdetails.xls")
        return count

    def parse_fundgr(self, content: bytes) -> int:
        """
        Parse fundgr.xls for fundamental growth data.

        Returns:
            Number of industries parsed
        """
        wb = load_excel(content)
        ws = wb["Industry Averages"]

        # Dynamic header detection (fundgr header typically at row 8)
        header_row = self._find_header_row(ws, "Industry Name")
        logger.info(f"  fundgr header row: {header_row}")

        col_map = {}
        for col_idx in range(1, ws.max_column + 1):
            cell_val = ws.cell(row=header_row, column=col_idx)
            if cell_val:
                col_str = str(cell_val).lower().replace(" ", "")
                if "industryname" in col_str:
                    col_map["industry"] = col_idx
                elif "fundamentalgrowth" in col_str or "fundgrowth" in col_str:
                    col_map["fundamental_growth"] = col_idx
                elif "retention" in col_str or "retentionratio" in col_str:
                    col_map["retention_ratio"] = col_idx
                elif "roeforgrowth" in col_str or "roe" in col_str:
                    col_map["roe_for_growth"] = col_idx

        logger.info(f"  fundgr column mapping: {col_map}")

        count = 0
        for row_idx in range(header_row + 1, ws.max_row + 1):
            industry_val = ws.cell(row=row_idx, column=col_map.get("industry", 1))
            if not industry_val:
                continue

            industry = str(industry_val).strip()
            if industry.lower() in ["total", "average", "", "nan"]:
                continue

            ind_data = self._get_or_create_industry(industry)

            growth_data = {}
            for key in ["fundamental_growth", "retention_ratio", "roe_for_growth"]:
                if key in col_map:
                    val = parse_percent(ws.cell(row=row_idx, column=col_map[key]))
                    if val is not None:
                        growth_data[key] = round(val, 4)

            if growth_data:
                ind_data["growth"] = growth_data
                count += 1

        logger.info(f"  Parsed {count} industries from fundgr.xls")
        return count

    def parse_ev_sales(self, content: str) -> int:
        """
        Parse ev_sales HTML for EV/Sales multiples.

        Args:
            content: HTML content (not bytes!)

        Returns:
            Number of industries parsed
        """
        tables = pd.read_html(StringIO(content))
        if not tables:
            raise ValueError("No tables found in HTML")

        df = tables[0]

        # Check if first row is header
        first_row = df.iloc[0]
        first_cell = str(first_row.iloc[0]).replace(" ", "").lower()
        if "industryname" in first_cell:
            df.columns = df.iloc[0]
            df = df.iloc[1:].reset_index(drop=True)

        # Build column map
        col_map = {}
        for col in df.columns:
            col_str = str(col).lower().replace(" ", "").replace("\xa0", "").replace("/", "")
            if "industryname" in col_str:
                col_map["industry"] = col
            elif "evsales" in col_str:
                col_map["ev_sales"] = col
            elif "pricesales" in col_str:
                col_map["price_sales"] = col
            elif "numberoffirms" in col_str:
                col_map["num_firms"] = col

        logger.info(f"  ev_sales column mapping: {col_map}")

        count = 0
        for _, row in df.iterrows():
            industry_col = col_map.get("industry", df.columns[0])
            industry_val = row[industry_col]
            if pd.isna(industry_val):
                continue

            industry = str(industry_val).strip()
            if industry.lower() in ["total", "average", "", "nan"]:
                continue

            ind_data = self._get_or_create_industry(industry)

            # Num firms (may override or supplement)
            if "num_firms" not in ind_data and "num_firms" in col_map:
                val = row[col_map["num_firms"]]
                if pd.notna(val):
                    try:
                        ind_data["num_firms"] = int(float(val))
                    except:
                        pass

            multiples = {}
            if "ev_sales" in col_map:
                val = row[col_map["ev_sales"]]
                if pd.notna(val):
                    try:
                        multiples["ev_sales"] = round(float(val), 2)
                    except:
                        pass
            if "price_sales" in col_map:
                val = row[col_map["price_sales"]]
                if pd.notna(val):
                    try:
                        multiples["price_sales"] = round(float(val), 2)
                    except:
                        pass

            if multiples:
                ind_data["multiples"] = multiples
                count += 1

        logger.info(f"  Parsed {count} industries from ev_sales HTML")
        return count

    # =========================================================================
    # Main Methods
    # =========================================================================

    def parse_all(self, datasets: Optional[List[str]] = None) -> Dict[str, Dict[str, Any]]:
        """
        Parse all Group A datasets and merge into unified structure.

        Args:
            datasets: List of datasets to parse (default: all GROUP_A_DATASETS)

        Returns:
            Merged industries dictionary
        """
        if datasets is None:
            datasets = GROUP_A_DATASETS

        logger.info(f"Parsing {len(datasets)} datasets: {datasets}")

        for dataset in datasets:
            try:
                content = self.download_dataset(dataset)
                self.raw_data[dataset] = content

                if is_html_content(content):
                    self.parse_html_dataset(dataset, content)
                elif dataset == "betas":
                    self.parse_betas(content)
                elif dataset == "margin":
                    self.parse_margin(content)
                elif dataset == "eva":
                    self.parse_eva(content)
                elif dataset == "debtdetails":
                    self.parse_debtdetails(content)
                elif dataset == "fundgr":
                    self.parse_fundgr(content)
                elif dataset == "ev_sales":
                    # HTML needs decoding
                    html_content = content.decode('utf-8', errors='replace')
                    self.parse_ev_sales(html_content)

                self.datasets_parsed.append(dataset)

            except Exception as e:
                logger.error(f"Failed to parse {dataset}: {e}")

        logger.info(f"Total: {len(self.industries)} industries from {len(self.datasets_parsed)} datasets")
        return self.industries

    def to_json(self, output_path: Optional[Path] = None) -> Path:
        """
        Save merged data to industries.json.

        Args:
            output_path: Custom output path (optional)

        Returns:
            Path to saved file
        """
        if not self.industries:
            self.parse_all()

        # Determine output path
        if output_path is None:
            self.output_dir.mkdir(parents=True, exist_ok=True)
            output_path = self.output_dir / OUTPUT_FILES["industries"]
        else:
            output_path = Path(output_path)

        # Generate metadata
        urls = {ds: URLS[ds] for ds in self.datasets_parsed if ds in URLS}
        metadata = generate_industries_metadata(
            industry_count=len(self.industries),
            datasets_merged=self.datasets_parsed,
            urls=urls
        )
        metadata["source_date"] = "January 2026"
        metadata["scope"] = "US current-year industry tables"
        metadata["source_format"] = "Damodaran HTML current data pages"

        # Build output
        output = {
            "metadata": metadata,
            "industries": self.industries
        }

        # Save
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(output, f, indent=2, ensure_ascii=False)

        file_size = output_path.stat().st_size / 1024
        logger.info(f"Saved to: {output_path} ({file_size:.1f} KB)")

        return output_path

    def convert(self, datasets: Optional[List[str]] = None, output_path: Optional[Path] = None) -> Path:
        """
        Full conversion pipeline: download -> parse -> save.

        Args:
            datasets: Datasets to parse (default: all)
            output_path: Output path (default: output/industries.json)

        Returns:
            Path to saved file
        """
        self.parse_all(datasets)
        return self.to_json(output_path)


# =============================================================================
# Legacy EV/Sales Output (for compatibility)
# =============================================================================

def generate_legacy_ev_sales(industries: Dict[str, Dict[str, Any]], output_path: Path) -> Path:
    """
    Generate legacy ev_sales.json for backward compatibility.

    Args:
        industries: Parsed industries data
        output_path: Output file path

    Returns:
        Path to saved file
    """
    sectors = {}
    for name, data in industries.items():
        if "multiples" in data:
            sector_data = {
                "ev_sales": data["multiples"].get("ev_sales"),
                "price_sales": data["multiples"].get("price_sales"),
                "net_margin": data.get("margins", {}).get("net"),
                "operating_margin": data.get("margins", {}).get("operating"),
                "num_firms": data.get("num_firms"),
            }
            # Remove None values
            sectors[name] = {k: v for k, v in sector_data.items() if v is not None}

    output = {
        "metadata": {
            "source": "Damodaran Online",
            "url": URLS["ev_sales"],
            "schema_version": "2.0.0",
            "generated_at": datetime.now().isoformat(),
            "sector_count": len(sectors),
            "note": "Legacy format - use industries.json instead"
        },
        "sectors": sectors
    }

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    logger.info(f"Legacy ev_sales.json saved: {output_path}")
    return output_path


# =============================================================================
# CLI
# =============================================================================

def main():
    """CLI entry point."""
    import argparse

    parser = argparse.ArgumentParser(description="Parse Damodaran industry datasets")
    parser.add_argument(
        "--datasets",
        nargs="+",
        default=GROUP_A_DATASETS,
        help=f"Datasets to parse (default: all {GROUP_A_DATASETS})"
    )
    parser.add_argument(
        "-o", "--output",
        help="Output file path (default: output/industries.json)"
    )
    parser.add_argument(
        "--legacy",
        action="store_true",
        help="Also generate legacy ev_sales.json"
    )
    args = parser.parse_args()

    # Parse
    ip = IndustryParser()
    output_path = ip.convert(
        datasets=args.datasets,
        output_path=Path(args.output) if args.output else None
    )

    # Legacy output if requested
    if args.legacy:
        legacy_path = output_path.parent / OUTPUT_FILES["ev_sales"]
        generate_legacy_ev_sales(ip.industries, legacy_path)

    # Summary
    print("\n" + "=" * 60)
    print(f"Industries: {len(ip.industries)}")
    print(f"Datasets: {ip.datasets_parsed}")
    print(f"Output: {output_path}")
    print("=" * 60)


if __name__ == "__main__":
    main()
