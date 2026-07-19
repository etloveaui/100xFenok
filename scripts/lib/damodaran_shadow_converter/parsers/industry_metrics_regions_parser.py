"""
Regional Industry Metrics Parser
================================

Parses Damodaran non-US regional current-year industry workbooks into a
separate additive file. The US contract remains industry_metrics.json.
"""

import json
import logging
import requests
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from config import (
    INDUSTRY_METRIC_REGIONAL_URLS,
    OUTPUT_FILES,
    REGIONAL_INDUSTRY_REGIONS,
)
from base.excel_loader import load_excel
from base.html_table import parse_int_value, parse_number
from base.industry_normalizer import normalize_with_typo_fix

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


FieldSpec = Tuple[int, bool, int]


class IndustryMetricsRegionsParser:
    """Parser for non-US regional Damodaran industry tables."""

    FIELD_MAP: Dict[str, Dict[str, Any]] = {
        "betas": {
            "group": "beta",
            "fields": {
                "levered": (2, False, 4),
                "d_e_ratio": (3, True, 4),
                "effective_tax_rate": (4, True, 4),
                "unlevered": (5, False, 4),
                "cash_to_firm_value": (6, True, 4),
                "unlevered_cash_adj": (7, False, 4),
                "hilo_risk": (8, True, 4),
                "std_dev_equity": (9, True, 4),
                "std_dev_operating_income": (10, True, 4),
            },
        },
        "totalbeta": {
            "group": "total_beta",
            "fields": {
                "average_unlevered_beta": (2, False, 4),
                "average_levered_beta": (3, False, 4),
                "average_correlation_with_market": (4, False, 4),
                "total_unlevered_beta": (5, False, 4),
                "total_levered_beta": (6, False, 4),
            },
        },
        "wacc": {
            "group": "cost_of_capital",
            "fields": {
                "beta": (2, False, 4),
                "cost_of_equity": (3, True, 4),
                "equity_to_capital": (4, True, 4),
                "std_dev_stock": (5, True, 4),
                "cost_of_debt": (6, True, 4),
                "tax_rate": (7, True, 4),
                "after_tax_cost_of_debt": (8, True, 4),
                "debt_to_capital": (9, True, 4),
                "cost_of_capital": (10, True, 4),
                "cost_of_capital_local_currency": (11, True, 4),
            },
        },
        "taxrate": {
            "group": "tax_rates",
            "fields": {
                "total_taxable_income_millions": (2, False, 2),
                "total_taxes_paid_accrual_millions": (3, False, 2),
                "total_cash_taxes_paid_millions": (4, False, 2),
                "cash_taxes_to_accrual_taxes": (5, False, 4),
                "accrual_average_all": (6, True, 4),
                "accrual_average_money_making": (7, True, 4),
                "accrual_aggregate": (8, True, 4),
                "cash_average_money_making": (9, True, 4),
                "cash_aggregate": (10, True, 4),
            },
        },
        "eva": {
            "group": "eva",
            "fields": {
                "beta": (2, False, 4),
                "roe": (3, True, 4),
                "cost_of_equity": (4, True, 4),
                "roe_minus_cost_of_equity": (5, True, 4),
                "book_value_equity_millions": (6, False, 2),
                "equity_eva_millions": (7, False, 2),
                "roc": (8, True, 4),
                "cost_of_capital": (9, True, 4),
                "roc_minus_wacc": (10, True, 4),
                "book_value_capital_millions": (11, False, 2),
                "eva_millions": (12, False, 2),
                "equity_to_capital": (13, True, 4),
                "std_dev_stock": (14, True, 4),
                "cost_of_debt": (15, True, 4),
                "tax_rate": (16, True, 4),
                "after_tax_cost_of_debt": (17, True, 4),
                "debt_to_capital": (18, True, 4),
            },
        },
        "debtdetails": {
            "group": "debt_details",
            "fields": {
                "lease_debt_estimate_millions": (2, False, 2),
                "conventional_debt_millions": (3, False, 2),
                "total_debt_with_leases_millions": (4, False, 2),
                "interest_expense_millions": (5, False, 2),
                "book_interest_rate": (6, True, 4),
                "short_term_debt_pct": (7, True, 4),
                "lease_debt_accounting_millions": (8, False, 2),
                "debt_repaid_millions": (9, False, 2),
                "debt_raised_millions": (10, False, 2),
            },
        },
        "leaseeffect": {
            "group": "lease_adjustments",
            "fields": {
                "lease_expense_to_sales": (2, True, 4),
                "total_debt_without_leases_millions": (3, False, 2),
                "total_debt_with_leases_millions": (4, False, 2),
                "lease_debt_to_total_debt": (5, True, 4),
                "market_debt_to_capital_without_leases": (6, True, 4),
                "market_debt_to_capital_with_leases": (7, True, 4),
                "book_debt_to_capital_without_leases": (8, True, 4),
                "book_debt_to_capital_with_leases": (9, True, 4),
                "operating_income_before_lease_adj_millions": (10, False, 2),
                "operating_income_after_lease_adj_millions": (11, False, 2),
                "roic_without_leases": (12, True, 4),
                "roic_with_leases": (13, True, 4),
                "pretax_operating_margin_before_lease_adj": (14, True, 4),
                "pretax_operating_margin_after_lease_adj": (15, True, 4),
                "lease_debt_estimate_millions": (16, False, 2),
                "lease_debt_accounting_millions": (17, False, 2),
            },
        },
        "capex": {
            "group": "reinvestment",
            "fields": {
                "capex_millions": (2, False, 2),
                "depreciation_amortization_millions": (3, False, 2),
                "capex_to_depreciation": (4, False, 4),
                "acquisitions_millions": (5, False, 2),
                "net_rd_millions": (6, False, 2),
                "net_capex_to_sales": (7, True, 4),
                "net_capex_to_after_tax_ebit": (8, True, 4),
                "sales_to_invested_capital": (9, False, 4),
            },
        },
        "margin": {
            "group": "margins",
            "fields": {
                "gross": (2, True, 4),
                "net": (3, True, 4),
                "pretax_prestock_operating": (4, True, 4),
                "pretax_unadjusted_operating": (5, True, 4),
                "after_tax_unadjusted_operating": (6, True, 4),
                "pretax_lease_adjusted": (7, True, 4),
                "after_tax_lease_adjusted": (8, True, 4),
                "pretax_lease_rd_adjusted": (9, True, 4),
                "after_tax_lease_rd_adjusted": (10, True, 4),
                "ebitda_to_sales": (11, True, 4),
                "ebitda_sga_to_sales": (12, True, 4),
                "ebitda_rd_to_sales": (13, True, 4),
                "cogs_to_sales": (14, True, 4),
                "rd_to_sales": (15, True, 4),
                "sga_to_sales": (16, True, 4),
                "stock_based_comp_to_sales": (17, True, 4),
                "lease_expense_to_sales": (18, True, 4),
            },
        },
        "wcdata": {
            "group": "working_capital",
            "fields": {
                "accounts_receivable_to_sales": (2, True, 4),
                "inventory_to_sales": (3, True, 4),
                "accounts_payable_to_sales": (4, True, 4),
                "non_cash_working_capital_to_sales": (5, True, 4),
            },
        },
        "roe": {
            "group": "roe_decomposition",
            "fields": {
                "roe_unadjusted": (2, True, 4),
                "roe_adjusted_for_rd": (3, True, 4),
            },
        },
        "fundgr": {
            "group": "eps_growth",
            "fields": {
                "roe": (2, True, 4),
                "retention_ratio": (3, True, 4),
                "fundamental_growth": (4, True, 4),
            },
        },
        "fundgrEB": {
            "group": "ebit_growth",
            "fields": {
                "roc": (2, True, 4),
                "reinvestment_rate": (3, True, 4),
                "expected_growth_in_ebit": (4, True, 4),
            },
        },
        "pedata": {
            "group": "pe_multiples",
            "fields": {
                "money_losing_pct": (2, True, 4),
                "current_pe": (3, False, 2),
                "trailing_pe": (4, False, 2),
                "forward_pe": (5, False, 2),
                "aggregate_market_cap_to_net_income_all": (6, False, 2),
                "aggregate_market_cap_to_trailing_net_income_profitable": (7, False, 2),
                "expected_growth_next_5y": (8, True, 4),
                "peg_ratio": (9, False, 2),
            },
        },
        "pbvdata": {
            "group": "book_value_returns",
            "fields": {
                "price_to_book": (2, False, 2),
                "roe": (3, True, 4),
                "ev_to_invested_capital": (4, False, 2),
                "roic": (5, True, 4),
            },
        },
        "psdata": {
            "group": "sales_multiples",
            "fields": {
                "price_to_sales": (2, False, 2),
                "net_margin": (3, True, 4),
                "ev_to_sales": (4, False, 2),
                "pretax_operating_margin": (5, True, 4),
            },
        },
        "vebitda": {
            "group": "ev_multiples",
            "fields": {
                "positive_ev_to_ebitda_rd": (2, False, 2),
                "positive_ev_to_ebitda": (3, False, 2),
                "positive_ev_to_ebit": (4, False, 2),
                "positive_ev_to_after_tax_ebit": (5, False, 2),
                "all_ev_to_ebitda_rd": (6, False, 2),
                "all_ev_to_ebitda": (7, False, 2),
                "all_ev_to_ebit": (8, False, 2),
                "all_ev_to_after_tax_ebit": (9, False, 2),
            },
        },
    }

    def __init__(self, output_dir: Optional[Path] = None):
        self.output_dir = output_dir or Path(__file__).parent.parent / "output"
        self.regions: Dict[str, Dict[str, Any]] = {
            region: {
                "label": cfg["label"],
                "industries": {},
            }
            for region, cfg in REGIONAL_INDUSTRY_REGIONS.items()
        }
        self.datasets_parsed = []
        self.dataset_region_counts: Dict[str, Dict[str, int]] = {}
        self.errors = []

    def download_dataset(self, dataset: str, region: str, timeout: int = 60) -> bytes:
        url = INDUSTRY_METRIC_REGIONAL_URLS[dataset][region]
        logger.info(f"Downloading {dataset}/{region} from {url}...")
        response = requests.get(url, timeout=timeout)
        response.raise_for_status()
        logger.info(f"  Downloaded {len(response.content) / 1024:.1f} KB")
        return response.content

    def _find_industry_sheet(self, content: bytes):
        workbook = load_excel(content)
        for sheet_name in workbook.sheetnames:
            ws = workbook[sheet_name]
            for row_idx in range(1, min(ws.max_row, 40) + 1):
                for col_idx in range(1, min(ws.max_column, 8) + 1):
                    value = ws.cell(row_idx, col_idx)
                    if value and "industry name" in str(value).lower():
                        return ws, row_idx, col_idx
        raise ValueError("Industry Name header not found")

    def _get_or_create_industry(self, region: str, name: str) -> Dict[str, Any]:
        normalized = normalize_with_typo_fix(name)
        industries = self.regions[region]["industries"]
        if normalized not in industries:
            industries[normalized] = {}
        return industries[normalized]

    def parse_dataset_region(self, dataset: str, region: str, content: bytes) -> int:
        config = self.FIELD_MAP[dataset]
        ws, header_row, industry_col = self._find_industry_sheet(content)
        group = config["group"]
        count = 0

        logger.info(
            f"  {dataset}/{region} sheet={ws.title!r} header_row={header_row} columns={ws.max_column}"
        )

        for row_idx in range(header_row + 1, ws.max_row + 1):
            industry_val = ws.cell(row_idx, industry_col)
            if industry_val is None:
                continue
            industry = str(industry_val).strip()
            if industry.lower() in ["total", "grand total", "average", "", "nan"]:
                continue

            ind_data = self._get_or_create_industry(region, industry)
            num_firms = parse_int_value(ws.cell(row_idx, industry_col + 1))
            if num_firms is not None:
                ind_data["num_firms"] = num_firms

            values = {}
            for field, (idx, is_percent, decimals) in config["fields"].items():
                col_idx = industry_col + idx
                if col_idx > ws.max_column:
                    continue
                val = parse_number(ws.cell(row_idx, col_idx), percent=is_percent)
                if val is not None:
                    values[field] = round(val, decimals)

            if values:
                ind_data[group] = values
                count += 1

        logger.info(f"  Parsed {count} industries from {dataset}/{region}")
        return count

    def parse_all(self, datasets=None, regions=None) -> Dict[str, Dict[str, Any]]:
        if datasets is None:
            datasets = list(self.FIELD_MAP.keys())
        if regions is None:
            regions = list(REGIONAL_INDUSTRY_REGIONS.keys())

        parsed_dataset_set = set()
        for dataset in datasets:
            self.dataset_region_counts.setdefault(dataset, {})
            for region in regions:
                try:
                    content = self.download_dataset(dataset, region)
                    count = self.parse_dataset_region(dataset, region, content)
                    self.dataset_region_counts[dataset][region] = count
                    parsed_dataset_set.add(dataset)
                except Exception as exc:
                    error = f"{dataset}/{region}: {exc}"
                    logger.error(f"Failed to parse {error}")
                    self.errors.append(error)

        self.datasets_parsed = [dataset for dataset in datasets if dataset in parsed_dataset_set]
        logger.info(
            "Total: %s regions, %s datasets, %s parse errors",
            len(regions),
            len(self.datasets_parsed),
            len(self.errors),
        )
        return self.regions

    def to_json(self, output_path: Optional[Path] = None) -> Path:
        if not any(region_data["industries"] for region_data in self.regions.values()):
            self.parse_all()

        if output_path is None:
            self.output_dir.mkdir(parents=True, exist_ok=True)
            output_path = self.output_dir / OUTPUT_FILES["industry_metrics_regions"]
        else:
            output_path = Path(output_path)

        output = {
            "metadata": {
                "source": "Damodaran Online",
                "source_url": "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datacurrent.html",
                "dataset": "industry_metrics_regions",
                "url": {
                    ds: {
                        region: INDUSTRY_METRIC_REGIONAL_URLS[ds][region]
                        for region in REGIONAL_INDUSTRY_REGIONS
                    }
                    for ds in self.datasets_parsed
                },
                "schema_version": "1.0.0",
                "generated_at": datetime.now().isoformat(),
                "source_date": "January 2026",
                "scope": "Non-US current-year regional industry tables",
                "contract": "US remains in industry_metrics.json; this file contains non-US regional variants only",
                "region_count": len(REGIONAL_INDUSTRY_REGIONS),
                "dataset_count": len(self.datasets_parsed),
                "regions": list(REGIONAL_INDUSTRY_REGIONS.keys()),
                "datasets_merged": self.datasets_parsed,
                "dataset_region_counts": self.dataset_region_counts,
                "errors": self.errors,
                "description": "Regional industry metrics: beta, total beta, WACC, taxes, EVA, debt, leases, reinvestment, margins, working capital, ROE, growth, PE/PB/PS, and EV multiples",
            },
            "regions": self.regions,
        }

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(output, f, indent=2, ensure_ascii=False)

        file_size = output_path.stat().st_size / 1024
        logger.info(f"Saved to: {output_path} ({file_size:.1f} KB)")
        return output_path

    def convert(self, output_path: Optional[Path] = None) -> Path:
        self.parse_all()
        return self.to_json(output_path)
