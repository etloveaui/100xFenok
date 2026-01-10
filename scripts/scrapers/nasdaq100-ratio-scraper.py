#!/usr/bin/env python3
"""
SlickCharts Nasdaq 100 to QQQ ratio scraper.

Usage:
    python scripts/scrapers/nasdaq100-ratio-scraper.py --output data/nasdaq100_ratio.json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scraper_utils import fetch_html

SOURCE_URL = "https://www.slickcharts.com/nasdaq100/ratio"
DEFAULT_OUTPUT = Path(__file__).with_name("nasdaq100_ratio.json")


def extract_js_data(html: str) -> List[List[str | float]]:
    """Extract chart data from JavaScript in the page."""
    # Look for __sc_init_state__ with brace counting
    pattern = r'__sc_init_state__\s*=\s*\{'
    match = re.search(pattern, html)
    if match:
        start = match.end() - 1  # Include the opening brace
        depth = 0
        for i, char in enumerate(html[start:], start):
            if char == '{':
                depth += 1
            elif char == '}':
                depth -= 1
                if depth == 0:
                    json_str = html[start:i + 1]
                    try:
                        state = json.loads(json_str)
                        # Look for nasdaq100RatioChartComponent.ratios
                        if "nasdaq100RatioChartComponent" in state:
                            component = state["nasdaq100RatioChartComponent"]
                            if "ratios" in component:
                                return component["ratios"]
                        # Generic fallback
                        for key, value in state.items():
                            if isinstance(value, dict):
                                if "ratios" in value:
                                    return value["ratios"]
                                if "data" in value and isinstance(value["data"], list):
                                    return value["data"]
                    except json.JSONDecodeError:
                        pass
                    break

    # Fallback: extract any array that looks like date-value pairs
    array_pattern = r'\[\s*"(\d{4}-\d{2}-\d{2})",\s*([\d.]+)\s*\]'
    matches = re.findall(array_pattern, html)
    if matches:
        return [[date, float(value)] for date, value in matches]

    raise ValueError("Unable to locate ratio data in the page")


def parse_ratio_data(raw_data: List[List[str | float]]) -> Dict[str, object]:
    """Parse ratio data into structured format."""
    history = []
    for item in raw_data:
        if len(item) >= 2:
            date = str(item[0])
            ratio = float(item[1])
            history.append({"date": date, "ratio": ratio})

    if not history:
        raise ValueError("No ratio history parsed")

    # Sort by date descending (latest first)
    history.sort(key=lambda x: x["date"], reverse=True)

    # Get current (latest) ratio
    current = history[0] if history else None

    return {
        "current": current,
        "history": history,
    }


def build_payload(data: Dict[str, object]) -> Dict[str, object]:
    return {
        "updated": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source": "slickcharts",
        "index": "nasdaq100",
        "count": len(data.get("history", [])),
        **data,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape Nasdaq 100 to QQQ ratio from SlickCharts.")
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Output JSON path (default: {DEFAULT_OUTPUT})",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print JSON with indentation.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)

    with requests.Session() as session:
        html = fetch_html(session, SOURCE_URL)
    raw_data = extract_js_data(html)
    data = parse_ratio_data(raw_data)
    payload = build_payload(data)

    args.output.write_text(
        json.dumps(payload, indent=2 if args.pretty else None),
        encoding="utf-8",
    )
    print(f"Wrote {payload['count']} data points to {args.output}")
    if data.get("current"):
        print(f"Current Ratio: {data['current']['ratio']:.4f} ({data['current']['date']})")


if __name__ == "__main__":
    main()
