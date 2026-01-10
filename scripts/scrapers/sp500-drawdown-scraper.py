#!/usr/bin/env python3
"""
S&P 500 Drawdown Scraper for SlickCharts
Extracts historical drawdown data from JavaScript state object.

Data structure: window.__sc_init_state__ contains:
- currentDrawdown: Current drawdown percentage
- currentPrice: Current S&P 500 price
- allTimeHigh: All-time high price
- years[]: Array of years (1928-2026)
- lowReturns[]: Annual low returns percentages
- highReturns[]: Annual high returns percentages
- lows[]: Lowest prices by year
- lowDates[]: Dates when lows occurred

Created: 2026-01-10
Reference: docs/planning/slickcharts-data-pipeline.md
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

# Import shared utilities
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scraper_utils import fetch_html, extract_js_state

# Constants
SOURCE_URL = "https://www.slickcharts.com/sp500/drawdown"


def parse_drawdown_data(state: dict) -> dict:
    """Parse drawdown data from JavaScript state object."""
    # Extract nested components
    metrics = state.get("drawdownMetricsComponent", {})
    chart = state.get("drawdownChartComponent", {})

    data = {
        "current": {
            "drawdown": metrics.get("drawdown", ""),
            "price": metrics.get("currentPrice", ""),
            "allTimeHigh": metrics.get("allTimeHigh", ""),
            "lowSinceATH": metrics.get("lowSinceAllTimeHigh", ""),
            "worstDrawdown": metrics.get("worstDrawdown", ""),
            "gainFromWorst": metrics.get("gainFromWorst", ""),
            "gainRequired": metrics.get("gainRequiredToReachHigh", "")
        },
        "historical": []
    }

    # Extract arrays from chart component
    years = chart.get("years", [])
    low_returns = chart.get("lowReturns", [])
    high_returns = chart.get("highReturns", [])
    lows = chart.get("lows", [])
    low_dates = chart.get("lowDates", [])
    prior_closes = chart.get("priorYearCloses", [])

    # Build historical records
    for i, year in enumerate(years):
        record = {"year": year}

        if i < len(low_returns):
            record["lowReturn"] = low_returns[i]
        if i < len(high_returns):
            record["highReturn"] = high_returns[i]
        if i < len(lows):
            record["low"] = lows[i]
        if i < len(low_dates):
            record["lowDate"] = low_dates[i]
        if i < len(prior_closes):
            record["priorYearClose"] = prior_closes[i]

        data["historical"].append(record)

    return data


def build_payload(data: dict) -> dict:
    """Build final JSON payload."""
    return {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "slickcharts",
        "endpoint": "/sp500/drawdown",
        "current": data["current"],
        "count": len(data["historical"]),
        "data": data["historical"]
    }


def parse_args():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="Scrape S&P 500 drawdown data from SlickCharts"
    )
    parser.add_argument(
        "--output", "-o",
        help="Output file path (default: stdout)"
    )
    parser.add_argument(
        "--pretty", "-p",
        action="store_true",
        help="Pretty print JSON output"
    )
    return parser.parse_args()


def main():
    """Main entry point."""
    args = parse_args()

    try:
        session = requests.Session()

        # Fetch and parse
        html = fetch_html(session, SOURCE_URL)
        state = extract_js_state(html)
        data = parse_drawdown_data(state)
        payload = build_payload(data)

        # Output
        indent = 2 if args.pretty else None
        json_output = json.dumps(payload, indent=indent, ensure_ascii=False)

        if args.output:
            with open(args.output, 'w', encoding='utf-8') as f:
                f.write(json_output)
            print(f"Saved {payload['count']} years to {args.output}")
        else:
            print(json_output)

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
