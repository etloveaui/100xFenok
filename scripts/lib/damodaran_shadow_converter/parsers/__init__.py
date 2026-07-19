"""
Damodaran Parsers Module
========================

Group-based parsers for different Damodaran dataset types.

Groups:
- Group A (industry_parser): 6 industry-based datasets → industries.json
- Group B (timeseries_parser): histimpl → historical_erp.json
- Group C (ratings_parser): ratings → credit_ratings.json
- Group D (erp_parser): ctryprem → erp.json (178 countries)
- Group E (industry_metrics_parser): valuation metrics → industry_metrics.json
- Group F (industry_metrics_regions_parser): non-US regional metrics → industry_metrics_regions.json
"""

from .industry_parser import IndustryParser, generate_legacy_ev_sales
from .timeseries_parser import TimeSeriesParser
from .ratings_parser import RatingsParser, lookup_rating
from .erp_parser import ERPParser
from .industry_metrics_parser import IndustryMetricsParser
from .industry_metrics_regions_parser import IndustryMetricsRegionsParser

__all__ = [
    "IndustryParser",
    "TimeSeriesParser",
    "RatingsParser",
    "ERPParser",
    "IndustryMetricsParser",
    "IndustryMetricsRegionsParser",
    "generate_legacy_ev_sales",
    "lookup_rating",
]
