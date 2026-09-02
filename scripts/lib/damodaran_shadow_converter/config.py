"""
Damodaran Unified Converter Configuration
=========================================

Centralized configuration for all Damodaran dataset converters.
"""

from pathlib import Path

# Directories
BASE_DIR = Path(__file__).parent
OUTPUT_DIR = BASE_DIR / "output"
SCHEMAS_DIR = BASE_DIR / "schemas"

# Damodaran Data URLs
URLS = {
    # Group A: Industry averages (unified into industries.json).
    # Prefer current-year HTML tables so the converter does not depend on xlrd
    # for legacy .xls parsing.
    "betas": "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/Betas.html",
    "margin": "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/margin.html",
    "eva": "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/EVA.html",
    "debtdetails": "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/debtdetails.html",
    "fundgr": "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/fundgr.html",
    "ev_sales": "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/psdata.html",

    # Group B: Time Series. Keep xls because the public HTML omits the DDM
    # implied ERP column used by current consumers.
    "histimpl": "https://pages.stern.nyu.edu/~adamodar/pc/datasets/histimpl.xls",

    # Group C: Calculator Tool. The current data page links the workbook; it
    # includes large, small/risky, and financial lookup tables.
    "ratings": "https://pages.stern.nyu.edu/~adamodar/pc/ratings.xls",

    # Country-based ERP. This pinned value is only the LAST-RESORT fallback:
    # resolve_erp_url() below probes for the newest published month first, so a
    # hardcoded month can never silently freeze the dataset.
    "erp": "https://pages.stern.nyu.edu/~adamodar/pc/datasets/ctrypremApr26.xlsx",
}

# Damodaran republishes the country ERP workbook as ctryprem<Mon><YY>.xlsx.
# Pinning one month means the weekly lane re-downloads the same stale file
# forever, so the newest available month is resolved at run time instead.
ERP_URL_TEMPLATE = "https://pages.stern.nyu.edu/~adamodar/pc/datasets/ctryprem{month}{yy}.xlsx"
ERP_URL_LOOKBACK_MONTHS = 18


def erp_url_candidates(today=None):
    """Newest-first candidate URLs for the country ERP workbook."""
    from datetime import date

    if today is None:
        today = date.today()
    year, month = today.year, today.month
    names_short = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    names_full = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    out = []
    for _ in range(ERP_URL_LOOKBACK_MONTHS):
        yy = f"{year % 100:02d}"
        # FH-20260902-390: Damodaran drifted from Jul26 to July26 (datacurrent.html lists
        # July 1, 2026 as https://pages.stern.nyu.edu/~adamodar/pc/datasets/ctrypremJuly26.xlsx,
        # Last-Mod 10 Jul 2026). Try both 3-letter and full-month variants newest-first.
        for mon in (names_full[month - 1], names_short[month - 1]):
            url = ERP_URL_TEMPLATE.format(month=mon, yy=yy)
            if url not in out:
                out.append(url)
        month -= 1
        if month == 0:
            month, year = 12, year - 1
    return out


def resolve_erp_url(today=None, timeout=15):
    """Return (url, source_month, resolved) for the newest published workbook.

    Falls back to the pinned URLS["erp"] when every probe fails, so a network
    problem degrades to the previous behaviour instead of breaking the lane.
    """
    import urllib.request

    # Map full month tokens back to 3-letter for canonicalize_source_date (which
    # only accepts <Mon><YY>). Keep the URL verbatim for provenance.
    _full_to_short = {
        "January": "Jan", "February": "Feb", "March": "Mar", "April": "Apr",
        "May": "May", "June": "Jun", "July": "Jul", "August": "Aug",
        "September": "Sep", "October": "Oct", "November": "Nov", "December": "Dec",
    }

    for url in erp_url_candidates(today):
        try:
            request = urllib.request.Request(url, method="HEAD")
            with urllib.request.urlopen(request, timeout=timeout) as response:
                if response.status == 200:
                    token = url.rsplit("ctryprem", 1)[-1].replace(".xlsx", "")
                    # Normalize July26-style drift (datacurrent.html lists July, not Jul)
                    # so the token stays <Mon><YY> for the downstream parser.
                    for full, short in _full_to_short.items():
                        if token.startswith(full):
                            token = short + token[len(full):]
                            break
                    return url, token, True
        except Exception:
            continue
    # Fallback still returns the pinned token (already short)
    return URLS["erp"], URLS["erp"].rsplit("ctryprem", 1)[-1].replace(".xlsx", ""), False

INDUSTRY_METRIC_URLS = {
    "wacc": "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/wacc.html",
    "taxrate": "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/taxrate.html",
    "pedata": "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/pedata.html",
    "pbvdata": "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/pbvdata.html",
    "psdata": "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/psdata.html",
    "vebitda": "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/vebitda.html",
    "capex": "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/capex.html",
    "roe": "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/roe.html",
    "wcdata": "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/wcdata.html",
    "leaseeffect": "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/leaseeffect.html",
    "fundgrEB": "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/fundgrEB.html",
}

REGIONAL_INDUSTRY_REGIONS = {
    "europe": {"label": "Europe", "suffix": "Europe"},
    "japan": {"label": "Japan", "suffix": "Japan"},
    "rest": {"label": "Aus, NZ & Canada", "suffix": "Rest"},
    "emerging": {"label": "All Emerging Markets", "suffix": "emerg"},
    "china": {"label": "China", "suffix": "China"},
    "india": {"label": "India", "suffix": "India"},
    "global": {"label": "Global", "suffix": "Global"},
}

REGIONAL_INDUSTRY_DATASET_BASES = {
    "betas": "beta",
    "totalbeta": "totalbeta",
    "wacc": "wacc",
    "taxrate": "taxrate",
    "eva": "EVA",
    "debtdetails": "debtdetails",
    "leaseeffect": "leaseeffect",
    "capex": "capex",
    "margin": "margin",
    "wcdata": "wcdata",
    "roe": "roe",
    "fundgr": "fundgr",
    "fundgrEB": "fundgrEB",
    "pedata": "pe",
    "pbvdata": "pbv",
    "psdata": "ps",
    "vebitda": "vebitda",
}

REGIONAL_DATASET_BASE_URL = "https://pages.stern.nyu.edu/~adamodar/pc/datasets"

INDUSTRY_METRIC_REGIONAL_URLS = {
    dataset: {
        region: f"{REGIONAL_DATASET_BASE_URL}/{base}{region_cfg['suffix']}.xls"
        for region, region_cfg in REGIONAL_INDUSTRY_REGIONS.items()
    }
    for dataset, base in REGIONAL_INDUSTRY_DATASET_BASES.items()
}

# Output filenames (fixed names for 100xFenok integration)
OUTPUT_FILES = {
    "industries": "industries.json",      # Group A unified
    "historical_erp": "historical_erp.json",  # Group B
    "credit_ratings": "credit_ratings.json",  # Group C
    "erp": "erp.json",                    # Country ERP (legacy)
    "ev_sales": "ev_sales.json",          # Legacy (for compatibility)
    "industry_metrics": "industry_metrics.json",  # Extended valuation metrics
    "industry_metrics_regions": "industry_metrics_regions.json",
}

# Group A datasets merged into industries.json
GROUP_A_DATASETS = [
    "betas",
    "margin",
    "eva",
    "debtdetails",
    "fundgr",
    "ev_sales",
]

# Excel sheet configurations
SHEET_CONFIG = {
    "betas": {
        "sheet_name": "Industry Averages",
        "header_row": 8,
        "data_start_row": 9,
    },
    "margin": {
        "sheet_name": "Industry Averages",
        "header_row": None,  # Uses first row as header
        "data_start_row": 1,
    },
    "eva": {
        "sheet_name": "Industry Averages",
        "header_row": None,
        "data_start_row": 1,
    },
    "debtdetails": {
        "sheet_name": "Industry Values",
        "header_row": None,
        "data_start_row": 1,
    },
    "fundgr": {
        "sheet_name": "Industry Averages",
        "header_row": None,
        "data_start_row": 1,
    },
    "histimpl": {
        "sheet_name": "Historical Impl Premiums",
        "header_row": None,
        "data_start_row": 1,
    },
    "ratings": {
        "sheet_name": "Start here Ratings sheet",
        "lookup_start_row": 27,
        "lookup_end_row": 50,
    },
}

# Ratings fallback data (used if dynamic parsing fails)
# Source: Damodaran ratings.xls (2024 data)
# Three company types with different coverage thresholds
RATINGS_FALLBACK = {
    # Large manufacturing firms (>$5B market cap)
    "large_manufacturing": [
        {"min_coverage": 12.5, "max_coverage": None, "rating": "AAA", "spread": 0.0063},
        {"min_coverage": 9.5, "max_coverage": 12.5, "rating": "AA", "spread": 0.0078},
        {"min_coverage": 7.5, "max_coverage": 9.5, "rating": "A+", "spread": 0.0098},
        {"min_coverage": 6.0, "max_coverage": 7.5, "rating": "A", "spread": 0.0108},
        {"min_coverage": 4.5, "max_coverage": 6.0, "rating": "A-", "spread": 0.0122},
        {"min_coverage": 4.0, "max_coverage": 4.5, "rating": "BBB", "spread": 0.0156},
        {"min_coverage": 3.5, "max_coverage": 4.0, "rating": "BB+", "spread": 0.0200},
        {"min_coverage": 3.0, "max_coverage": 3.5, "rating": "BB", "spread": 0.0240},
        {"min_coverage": 2.5, "max_coverage": 3.0, "rating": "BB-", "spread": 0.0300},
        {"min_coverage": 2.0, "max_coverage": 2.5, "rating": "B+", "spread": 0.0375},
        {"min_coverage": 1.5, "max_coverage": 2.0, "rating": "B", "spread": 0.0450},
        {"min_coverage": 1.25, "max_coverage": 1.5, "rating": "B-", "spread": 0.0525},
        {"min_coverage": 0.8, "max_coverage": 1.25, "rating": "CCC", "spread": 0.0700},
        {"min_coverage": 0.5, "max_coverage": 0.8, "rating": "CC", "spread": 0.0850},
        {"min_coverage": None, "max_coverage": 0.5, "rating": "C/D", "spread": 0.1100},
    ],
    # Small/risky firms (<$5B market cap, more volatile)
    "small_risky": [
        {"min_coverage": 8.5, "max_coverage": None, "rating": "AAA", "spread": 0.0063},
        {"min_coverage": 6.5, "max_coverage": 8.5, "rating": "AA", "spread": 0.0078},
        {"min_coverage": 5.5, "max_coverage": 6.5, "rating": "A+", "spread": 0.0098},
        {"min_coverage": 4.25, "max_coverage": 5.5, "rating": "A", "spread": 0.0108},
        {"min_coverage": 3.0, "max_coverage": 4.25, "rating": "A-", "spread": 0.0122},
        {"min_coverage": 2.5, "max_coverage": 3.0, "rating": "BBB", "spread": 0.0156},
        {"min_coverage": 2.25, "max_coverage": 2.5, "rating": "BB+", "spread": 0.0200},
        {"min_coverage": 2.0, "max_coverage": 2.25, "rating": "BB", "spread": 0.0240},
        {"min_coverage": 1.75, "max_coverage": 2.0, "rating": "BB-", "spread": 0.0300},
        {"min_coverage": 1.5, "max_coverage": 1.75, "rating": "B+", "spread": 0.0375},
        {"min_coverage": 1.25, "max_coverage": 1.5, "rating": "B", "spread": 0.0450},
        {"min_coverage": 1.0, "max_coverage": 1.25, "rating": "B-", "spread": 0.0525},
        {"min_coverage": 0.65, "max_coverage": 1.0, "rating": "CCC", "spread": 0.0700},
        {"min_coverage": 0.45, "max_coverage": 0.65, "rating": "CC", "spread": 0.0850},
        {"min_coverage": None, "max_coverage": 0.45, "rating": "C/D", "spread": 0.1100},
    ],
    # Financial services firms (use interest coverage differently)
    "financial": [
        {"min_coverage": 0.05, "max_coverage": None, "rating": "AAA", "spread": 0.0063},
        {"min_coverage": 0.04, "max_coverage": 0.05, "rating": "AA", "spread": 0.0078},
        {"min_coverage": 0.035, "max_coverage": 0.04, "rating": "A+", "spread": 0.0098},
        {"min_coverage": 0.03, "max_coverage": 0.035, "rating": "A", "spread": 0.0108},
        {"min_coverage": 0.025, "max_coverage": 0.03, "rating": "A-", "spread": 0.0122},
        {"min_coverage": 0.02, "max_coverage": 0.025, "rating": "BBB", "spread": 0.0156},
        {"min_coverage": 0.015, "max_coverage": 0.02, "rating": "BB+", "spread": 0.0200},
        {"min_coverage": 0.0125, "max_coverage": 0.015, "rating": "BB", "spread": 0.0240},
        {"min_coverage": 0.01, "max_coverage": 0.0125, "rating": "BB-", "spread": 0.0300},
        {"min_coverage": 0.0075, "max_coverage": 0.01, "rating": "B+", "spread": 0.0375},
        {"min_coverage": 0.005, "max_coverage": 0.0075, "rating": "B", "spread": 0.0450},
        {"min_coverage": 0.0025, "max_coverage": 0.005, "rating": "B-", "spread": 0.0525},
        {"min_coverage": 0.001, "max_coverage": 0.0025, "rating": "CCC", "spread": 0.0700},
        {"min_coverage": 0.0005, "max_coverage": 0.001, "rating": "CC", "spread": 0.0850},
        {"min_coverage": None, "max_coverage": 0.0005, "rating": "C/D", "spread": 0.1100},
    ],
}
