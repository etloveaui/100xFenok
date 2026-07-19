"""
Metadata Generator
==================

Generates consistent metadata for all Damodaran JSON outputs.
"""

from datetime import datetime
from typing import Dict, List, Any, Optional


SCHEMA_VERSION = "2.0.0"
SOURCE = "Damodaran Online"


def generate_metadata(
    dataset: str,
    url: str,
    record_count: int,
    description: Optional[str] = None,
    datasets_merged: Optional[List[str]] = None,
    fallback_used: bool = False,
    extra: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Generate metadata block for JSON output.

    Args:
        dataset: Dataset identifier (e.g., "industries", "historical_erp", "credit_ratings")
        url: Source URL(s)
        record_count: Number of records (industries, years, etc.)
        description: Optional description
        datasets_merged: List of merged datasets (for industries.json)
        fallback_used: Whether fallback data was used (for ratings)
        extra: Additional metadata fields

    Returns:
        Metadata dictionary
    """
    metadata = {
        "source": SOURCE,
        "dataset": dataset,
        "url": url,
        "schema_version": SCHEMA_VERSION,
        "generated_at": datetime.now().isoformat(),
    }

    # Add record count with appropriate key
    if dataset == "industries":
        metadata["industry_count"] = record_count
    elif dataset == "historical_erp":
        metadata["year_count"] = record_count
    elif dataset == "credit_ratings":
        metadata["table_count"] = record_count
    elif dataset == "erp":
        metadata["country_count"] = record_count
    else:
        metadata["record_count"] = record_count

    # Optional fields
    if description:
        metadata["description"] = description

    if datasets_merged:
        metadata["datasets_merged"] = datasets_merged

    if fallback_used:
        metadata["fallback_used"] = fallback_used
        metadata["warning"] = "Fallback data used - latest spreads may not be reflected"

    if extra:
        metadata.update(extra)

    return metadata


def generate_industries_metadata(
    industry_count: int,
    datasets_merged: List[str],
    urls: Dict[str, str]
) -> Dict[str, Any]:
    """
    Generate metadata for unified industries.json.

    Args:
        industry_count: Number of industries
        datasets_merged: List of merged dataset names
        urls: Dict of dataset -> URL mapping

    Returns:
        Metadata dictionary
    """
    return generate_metadata(
        dataset="industries",
        url=urls,  # Multiple URLs as dict
        record_count=industry_count,
        description="Unified industry data from multiple Damodaran datasets",
        datasets_merged=datasets_merged,
    )


def generate_historical_erp_metadata(
    year_count: int,
    year_range: str,
    url: str
) -> Dict[str, Any]:
    """
    Generate metadata for historical_erp.json.

    Args:
        year_count: Number of years
        year_range: String like "1960-2025"
        url: Source URL

    Returns:
        Metadata dictionary
    """
    return generate_metadata(
        dataset="historical_erp",
        url=url,
        record_count=year_count,
        description="Historical implied equity risk premiums (US market)",
        extra={"year_range": year_range}
    )


def generate_credit_ratings_metadata(
    table_count: int,
    url: str,
    parsing_method: str = "dynamic",
    fallback_used: bool = False
) -> Dict[str, Any]:
    """
    Generate metadata for credit_ratings.json.

    Args:
        table_count: Number of lookup tables
        url: Source URL
        parsing_method: "dynamic" or "fallback"
        fallback_used: Whether fallback was used

    Returns:
        Metadata dictionary
    """
    return generate_metadata(
        dataset="credit_ratings",
        url=url,
        record_count=table_count,
        description="Interest coverage to credit rating lookup tables",
        fallback_used=fallback_used,
        extra={"parsing_method": parsing_method}
    )
