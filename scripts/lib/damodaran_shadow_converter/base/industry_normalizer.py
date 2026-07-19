"""
Industry Name Normalizer
========================

Normalizes industry names across all Damodaran datasets for consistent merging.

Problem solved:
- betas.xls: "Auto Parts"
- ev_sales.html: "Auto  Parts" (double space)
- Match rate: 57% -> 97% after normalization
"""

import re
from unicodedata import normalize as unicode_normalize


def normalize_industry_name(name: str) -> str:
    """
    Normalize industry name for consistent matching across datasets.

    Applies:
    1. Unicode NFKC normalization (non-breaking space, etc.)
    2. Multi-space -> single space
    3. Strip leading/trailing whitespace

    Args:
        name: Raw industry name from any Damodaran dataset

    Returns:
        Normalized industry name

    Examples:
        >>> normalize_industry_name("Auto  Parts")
        'Auto Parts'
        >>> normalize_industry_name("Software (System & Application)")
        'Software (System & Application)'
        >>> normalize_industry_name("  Retail (General)  ")
        'Retail (General)'
    """
    if not name:
        return ""

    # Convert to string if needed
    name = str(name)

    # 1. Unicode NFKC normalization (handles non-breaking spaces, etc.)
    name = unicode_normalize('NFKC', name)

    # 2. Multiple whitespace -> single space
    name = re.sub(r'\s+', ' ', name)

    # 3. Strip leading/trailing whitespace
    name = name.strip()

    return name


# Common industry name fixes (typos in source data)
TYPO_FIXES = {
    "Heathcare Information and Technology": "Healthcare Information and Technology",
    "Heathcare Information and  Technology": "Healthcare Information and Technology",
    "Heathcare Information and Techno": "Healthcare Information and Technology",
    "Financial Svcs. (Non-bank & Insur": "Financial Svcs. (Non-bank & Insurance)",
    "Financial Svcs. (Non-bank & Insurance": "Financial Svcs. (Non-bank & Insurance)",
    "Oil/Gas (Production and Exploratio": "Oil/Gas (Production and Exploration)",
    "Real Estate (Operations & Service": "Real Estate (Operations & Services)",
    "Total Market (without financial": "Total Market (without financials)",
    # Add more as discovered
}


def normalize_with_typo_fix(name: str) -> str:
    """
    Normalize and apply typo fixes.

    Args:
        name: Raw industry name

    Returns:
        Normalized and typo-corrected industry name
    """
    normalized = normalize_industry_name(name)
    return TYPO_FIXES.get(normalized, normalized)
