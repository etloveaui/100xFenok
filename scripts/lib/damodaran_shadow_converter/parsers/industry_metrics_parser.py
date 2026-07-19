"""
Extended Industry Metrics Parser
================================

Parses additional Damodaran current-year US industry tables into
industry_metrics.json. This file is additive and does not replace the legacy
industries.json consumer contract.
"""

import json
import logging
import requests
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

import pandas as pd

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from config import INDUSTRY_METRIC_URLS, OUTPUT_FILES
from base.html_table import parse_int_value, parse_number, read_first_table
from base.industry_normalizer import normalize_with_typo_fix

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


class IndustryMetricsParser:
    """Parser for additive valuation-oriented Damodaran industry metrics."""

    FIELD_MAP = {
        "wacc": {
            "group": "cost_of_capital",
            "fields": {
                "beta": (2, False),
                "cost_of_equity": (3, True),
                "equity_to_capital": (4, True),
                "cost_of_debt": (6, True),
                "tax_rate": (7, True),
                "after_tax_cost_of_debt": (8, True),
                "debt_to_capital": (9, True),
                "cost_of_capital": (10, True),
            },
        },
        "taxrate": {
            "group": "tax_rates",
            "fields": {
                "accrual_average_all": (6, True),
                "accrual_average_money_making": (7, True),
                "accrual_aggregate": (8, True),
                "cash_average_money_making": (9, True),
                "cash_aggregate": (10, True),
            },
        },
        "pedata": {
            "group": "pe_multiples",
            "fields": {
                "money_losing_pct": (2, True),
                "current_pe": (3, False),
                "trailing_pe": (4, False),
                "forward_pe": (5, False),
                "aggregate_market_cap_to_net_income_all": (6, False),
                "aggregate_market_cap_to_trailing_net_income_profitable": (7, False),
                "expected_growth_next_5y": (8, True),
                "peg_ratio": (9, False),
            },
        },
        "pbvdata": {
            "group": "book_value_returns",
            "fields": {
                "price_to_book": (2, False),
                "roe": (3, True),
                "ev_to_invested_capital": (4, False),
                "roic": (5, True),
            },
        },
        "psdata": {
            "group": "sales_multiples",
            "fields": {
                "price_to_sales": (2, False),
                "net_margin": (3, True),
                "ev_to_sales": (4, False),
                "pretax_operating_margin": (5, True),
            },
        },
        "vebitda": {
            "group": "ev_multiples",
            "fields": {
                "positive_ev_to_ebitda_rd": (2, False),
                "positive_ev_to_ebitda": (3, False),
                "positive_ev_to_ebit": (4, False),
                "positive_ev_to_after_tax_ebit": (5, False),
                "all_ev_to_ebitda_rd": (6, False),
                "all_ev_to_ebitda": (7, False),
                "all_ev_to_ebit": (8, False),
                "all_ev_to_after_tax_ebit": (9, False),
            },
        },
        "capex": {
            "group": "reinvestment",
            "fields": {
                "capex_millions": (2, False),
                "depreciation_amortization_millions": (3, False),
                "capex_to_depreciation": (4, False),
                "acquisitions_millions": (5, False),
                "net_rd_millions": (6, False),
                "net_capex_to_sales": (7, True),
                "net_capex_to_after_tax_ebit": (8, True),
                "sales_to_invested_capital": (9, False),
            },
        },
        "roe": {
            "group": "roe_decomposition",
            "fields": {
                "roe_unadjusted": (2, True),
                "roe_adjusted_for_rd": (3, True),
            },
        },
        "wcdata": {
            "group": "working_capital",
            "fields": {
                "accounts_receivable_to_sales": (2, True),
                "inventory_to_sales": (3, True),
                "accounts_payable_to_sales": (4, True),
                "non_cash_working_capital_to_sales": (5, True),
            },
        },
        "leaseeffect": {
            "group": "lease_adjustments",
            "fields": {
                "lease_expense_to_sales": (2, True),
                "total_debt_without_leases_millions": (3, False),
                "total_debt_with_leases_millions": (4, False),
                "lease_debt_to_total_debt": (5, True),
                "market_debt_to_capital_without_leases": (6, True),
                "market_debt_to_capital_with_leases": (7, True),
                "book_debt_to_capital_without_leases": (8, True),
                "book_debt_to_capital_with_leases": (9, True),
                "operating_income_before_lease_adj_millions": (10, False),
                "operating_income_after_lease_adj_millions": (11, False),
                "roic_without_leases": (12, True),
                "roic_with_leases": (13, True),
                "pretax_operating_margin_before_lease_adj": (14, True),
                "pretax_operating_margin_after_lease_adj": (15, True),
                "lease_debt_estimate_millions": (16, False),
                "lease_debt_accounting_millions": (17, False),
            },
        },
        "fundgrEB": {
            "group": "ebit_growth",
            "fields": {
                "roc": (2, True),
                "reinvestment_rate": (3, True),
                "expected_growth_in_ebit": (4, True),
            },
        },
    }

    def __init__(self, output_dir: Optional[Path] = None):
        self.output_dir = output_dir or Path(__file__).parent.parent / "output"
        self.industries: Dict[str, Dict[str, Any]] = {}
        self.datasets_parsed = []
        self.dataset_row_counts: Dict[str, int] = {}

    def download_dataset(self, dataset: str, timeout: int = 60) -> bytes:
        url = INDUSTRY_METRIC_URLS.get(dataset)
        if not url:
            raise ValueError(f"Unknown industry metric dataset: {dataset}")
        logger.info(f"Downloading {dataset} from {url}...")
        response = requests.get(url, timeout=timeout)
        response.raise_for_status()
        logger.info(f"  Downloaded {len(response.content) / 1024:.1f} KB")
        return response.content

    def _get_or_create_industry(self, name: str) -> Dict[str, Any]:
        normalized = normalize_with_typo_fix(name)
        if normalized not in self.industries:
            self.industries[normalized] = {}
        return self.industries[normalized]

    def parse_dataset(self, dataset: str, content: bytes) -> int:
        config = self.FIELD_MAP[dataset]
        df = read_first_table(content)
        group = config["group"]
        count = 0

        for _, row in df.iterrows():
            industry_val = row.iloc[0]
            if pd.isna(industry_val):
                continue
            industry = str(industry_val).strip()
            if industry.lower() in ["total", "average", "", "nan"]:
                continue

            ind_data = self._get_or_create_industry(industry)
            num_firms = parse_int_value(row.iloc[1]) if len(row) > 1 else None
            if num_firms is not None and "num_firms" not in ind_data:
                ind_data["num_firms"] = num_firms

            values = {}
            for field, (idx, is_percent) in config["fields"].items():
                if idx >= len(row):
                    continue
                val = parse_number(row.iloc[idx], percent=is_percent)
                if val is not None:
                    values[field] = round(val, 4 if is_percent else 2)

            if values:
                ind_data[group] = values
                count += 1

        logger.info(f"  Parsed {count} industries from {dataset}")
        return count

    def parse_all(self, datasets=None) -> Dict[str, Dict[str, Any]]:
        if datasets is None:
            datasets = list(self.FIELD_MAP.keys())

        for dataset in datasets:
            try:
                content = self.download_dataset(dataset)
                count = self.parse_dataset(dataset, content)
                self.datasets_parsed.append(dataset)
                self.dataset_row_counts[dataset] = count
            except Exception as e:
                logger.error(f"Failed to parse {dataset}: {e}")

        logger.info(
            f"Total: {len(self.industries)} industries from {len(self.datasets_parsed)} extended datasets"
        )
        return self.industries

    def to_json(self, output_path: Optional[Path] = None) -> Path:
        if not self.industries:
            self.parse_all()

        if output_path is None:
            self.output_dir.mkdir(parents=True, exist_ok=True)
            output_path = self.output_dir / OUTPUT_FILES["industry_metrics"]
        else:
            output_path = Path(output_path)

        output = {
            "metadata": {
                "source": "Damodaran Online",
                "dataset": "industry_metrics",
                "url": {ds: INDUSTRY_METRIC_URLS[ds] for ds in self.datasets_parsed},
                "schema_version": "1.0.0",
                "generated_at": datetime.now().isoformat(),
                "source_date": "January 2026",
                "scope": "US current-year industry tables",
                "industry_count": len(self.industries),
                "dataset_count": len(self.datasets_parsed),
                "datasets_merged": self.datasets_parsed,
                "dataset_row_counts": self.dataset_row_counts,
                "description": "Additive valuation metrics: WACC, tax rates, multiples, reinvestment, working capital, lease adjustments, and EBIT growth",
            },
            "industries": self.industries,
        }

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(output, f, indent=2, ensure_ascii=False)

        file_size = output_path.stat().st_size / 1024
        logger.info(f"Saved to: {output_path} ({file_size:.1f} KB)")
        return output_path

    def convert(self, output_path: Optional[Path] = None) -> Path:
        self.parse_all()
        return self.to_json(output_path)

