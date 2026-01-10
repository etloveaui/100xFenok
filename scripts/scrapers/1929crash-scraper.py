#!/usr/bin/env python3
"""
1929 Crash Scraper for SlickCharts

Extracts historical Dow Jones daily prices during the 1929 crash period.
Data range: January 2, 1929 - January 3, 1933 (4 years, ~1192 data points)

URL: https://www.slickcharts.com/dowjones/crash/1929
Data source: Embedded JSON array in page script

Created: 2026-01-10
Reference: docs/planning/slickcharts-data-pipeline.md
"""

import json
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from scraper_utils import (
    create_session,
    fetch_html,
    create_scraper_parser,
    build_standard_payload,
    write_output,
)

SOURCE_URL = "https://www.slickcharts.com/dowjones/crash/1929"


def extract_crash_json(html: str) -> list:
    """
    Extract crash data JSON array from HTML.

    The data is embedded as: [{"time":"1929-01-02","value":307.01},...]
    """
    # Find the data array
    start_marker = '[{"time"'
    idx = html.find(start_marker)

    if idx == -1:
        raise ValueError("Could not find crash data in page")

    # Extract from [ to matching ]
    depth = 0
    end = idx
    for i, c in enumerate(html[idx:]):
        if c == '[':
            depth += 1
        elif c == ']':
            depth -= 1
            if depth == 0:
                end = idx + i + 1
                break

    json_str = html[idx:end]

    try:
        return json.loads(json_str)
    except json.JSONDecodeError as e:
        raise ValueError(f"Failed to parse crash data JSON: {e}")


def parse_crash_data(raw_data: list) -> dict:
    """
    Parse and structure 1929 crash data.

    Input format: [{"time": "1929-01-02", "value": 307.01}, ...]
    """
    if not raw_data:
        raise ValueError("No crash data found")

    # Convert to standard format
    data_points = []
    for point in raw_data:
        date_str = point.get("time", "")
        value = point.get("value", 0)

        if date_str and value:
            data_points.append({
                "date": date_str,
                "close": value,
            })

    # Sort by date (should already be sorted)
    data_points.sort(key=lambda x: x["date"])

    # Calculate statistics
    closes = [p["close"] for p in data_points]
    peak = max(closes)
    trough = min(closes)
    peak_idx = closes.index(peak)
    trough_idx = closes.index(trough)
    drawdown = ((trough - peak) / peak) * 100

    return {
        "data": data_points,
        "stats": {
            "start_date": data_points[0]["date"] if data_points else None,
            "end_date": data_points[-1]["date"] if data_points else None,
            "peak_date": data_points[peak_idx]["date"],
            "peak_value": peak,
            "trough_date": data_points[trough_idx]["date"],
            "trough_value": trough,
            "max_drawdown_pct": round(drawdown, 2),
            "total_points": len(data_points),
        }
    }


def main() -> None:
    parser = create_scraper_parser(
        "Scrape 1929 crash data from SlickCharts"
    )
    args = parser.parse_args()

    try:
        session = create_session()
        html = fetch_html(session, SOURCE_URL)
        raw_data = extract_crash_json(html)
        parsed = parse_crash_data(raw_data)

        payload = build_standard_payload(
            parsed["data"],
            data_key="prices",
            extra_fields={
                "endpoint": "/dowjones/crash/1929",
                "stats": parsed["stats"],
            }
        )

        write_output(payload, args.output, pretty=args.pretty)

        if args.output:
            print(f"Saved {payload['count']} daily prices to {args.output}")

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
