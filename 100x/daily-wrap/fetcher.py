#!/usr/bin/env python3
"""
100x Daily Wrap - Market Data Fetcher

Fetches market data from Yahoo Finance and FRED API, then saves to JSON.
This powers the daily market wrap system.

Usage:
    python fetcher.py [--date YYYY-MM-DD] [--output-dir ./data]

Dependencies:
    pip install yfinance requests python-dotenv
"""

import os
import sys
import json
import argparse
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Any, Optional

try:
    import yfinance as yf
    import requests
except ImportError:
    print("⚠️ Missing dependencies. Install with:")
    print("   pip install yfinance requests python-dotenv")
    sys.exit(1)

# Configuration
DEFAULT_OUTPUT_DIR = Path(__file__).parent / "data"
FRED_API_KEY = os.getenv("FRED_API_KEY", None)  # Set via environment or .env file
FRED_BASE_URL = "https://api.stlouisfed.org/fred/series/observations"

# Market symbols to track
SYMBOLS = {
    "indices": {
        "^GSPC": "S&P 500",
        "^DJI": "Dow Jones",
        "^IXIC": "NASDAQ",
        "^RUT": "Russell 2000",
        "^VIX": "VIX (Volatility)"
    },
    "crypto": {
        "BTC-USD": "Bitcoin",
        "ETH-USD": "Ethereum"
    },
    "commodities": {
        "GC=F": "Gold Futures",
        "CL=F": "Crude Oil WTI"
    },
    "treasury": {
        "^TNX": "10-Year Treasury Yield",
        "^IRX": "13-Week Treasury Bill"
    }
}

# FRED series IDs for economic indicators
FRED_SERIES = {
    "DGS10": "10-Year Treasury Rate",
    "DGS2": "2-Year Treasury Rate",
    "DEXUSEU": "USD/EUR Exchange Rate",
    "DEXJPUS": "USD/JPY Exchange Rate"
}


def log(message: str, level: str = "INFO"):
    """Simple logging utility"""
    timestamp = datetime.now().strftime("%H:%M:%S")
    prefix = {
        "INFO": "ℹ️",
        "SUCCESS": "✅",
        "WARNING": "⚠️",
        "ERROR": "❌"
    }.get(level, "ℹ️")
    print(f"[{timestamp}] {prefix} {message}")


def fetch_yahoo_data(symbol: str, date: datetime) -> Optional[Dict[str, Any]]:
    """
    Fetch historical data for a specific symbol from Yahoo Finance.
    
    Args:
        symbol: Yahoo Finance ticker symbol (e.g., "^GSPC")
        date: Target date for data
        
    Returns:
        Dictionary with OHLCV data or None if failed
    """
    try:
        ticker = yf.Ticker(symbol)
        
        # Get data for the target date (plus buffer for market closures)
        start_date = (date - timedelta(days=5)).strftime("%Y-%m-%d")
        end_date = (date + timedelta(days=1)).strftime("%Y-%m-%d")
        
        hist = ticker.history(start=start_date, end=end_date)
        
        if hist.empty:
            log(f"No data available for {symbol} on {date.strftime('%Y-%m-%d')}", "WARNING")
            return None
        
        # Get the most recent data point (closest to target date)
        latest = hist.iloc[-1]
        
        return {
            "symbol": symbol,
            "date": hist.index[-1].strftime("%Y-%m-%d"),
            "open": round(float(latest['Open']), 2),
            "high": round(float(latest['High']), 2),
            "low": round(float(latest['Low']), 2),
            "close": round(float(latest['Close']), 2),
            "volume": int(latest['Volume']),
            "change": round(float(latest['Close'] - latest['Open']), 2),
            "change_pct": round(((latest['Close'] - latest['Open']) / latest['Open']) * 100, 2)
        }
    except Exception as e:
        log(f"Error fetching {symbol}: {str(e)}", "ERROR")
        return None


def fetch_fred_data(series_id: str, date: datetime) -> Optional[Dict[str, Any]]:
    """
    Fetch data from FRED API for a specific series.
    
    Args:
        series_id: FRED series identifier (e.g., "DGS10")
        date: Target date for data
        
    Returns:
        Dictionary with series data or None if failed
    """
    if not FRED_API_KEY:
        # Return mock data if API key not available
        log(f"FRED API key not set, using mock data for {series_id}", "WARNING")
        return {
            "series_id": series_id,
            "date": date.strftime("%Y-%m-%d"),
            "value": 4.25,  # Mock value
            "is_mock": True
        }
    
    try:
        params = {
            "series_id": series_id,
            "api_key": FRED_API_KEY,
            "file_type": "json",
            "observation_start": (date - timedelta(days=7)).strftime("%Y-%m-%d"),
            "observation_end": date.strftime("%Y-%m-%d"),
            "sort_order": "desc",
            "limit": 1
        }
        
        response = requests.get(FRED_BASE_URL, params=params, timeout=10)
        response.raise_for_status()
        
        data = response.json()
        
        if not data.get("observations"):
            log(f"No observations for {series_id} near {date.strftime('%Y-%m-%d')}", "WARNING")
            return None
        
        obs = data["observations"][0]
        
        return {
            "series_id": series_id,
            "date": obs["date"],
            "value": float(obs["value"]) if obs["value"] != "." else None,
            "is_mock": False
        }
    except Exception as e:
        log(f"Error fetching FRED series {series_id}: {str(e)}", "ERROR")
        return None


def fetch_all_market_data(target_date: datetime) -> Dict[str, Any]:
    """
    Fetch all market data for the target date.
    
    Args:
        target_date: Date to fetch data for
        
    Returns:
        Complete market data dictionary
    """
    log(f"Fetching market data for {target_date.strftime('%Y-%m-%d')}...")
    
    market_data = {
        "metadata": {
            "fetch_timestamp": datetime.now().isoformat(),
            "target_date": target_date.strftime("%Y-%m-%d"),
            "data_sources": ["Yahoo Finance", "FRED API (mock)" if not FRED_API_KEY else "FRED API"]
        },
        "indices": {},
        "crypto": {},
        "commodities": {},
        "treasury": {},
        "economic_indicators": {}
    }
    
    # Fetch Yahoo Finance data
    for category, symbols in SYMBOLS.items():
        log(f"Fetching {category} data...")
        for symbol, name in symbols.items():
            data = fetch_yahoo_data(symbol, target_date)
            if data:
                market_data[category][name] = data
    
    # Fetch FRED data
    log("Fetching economic indicators from FRED...")
    for series_id, name in FRED_SERIES.items():
        data = fetch_fred_data(series_id, target_date)
        if data:
            market_data["economic_indicators"][name] = data
    
    return market_data


def save_market_data(data: Dict[str, Any], output_dir: Path, target_date: datetime):
    """
    Save market data to JSON file.
    
    Args:
        data: Market data dictionary
        output_dir: Output directory path
        target_date: Target date for filename
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    
    filename = f"{target_date.strftime('%Y-%m-%d')}.json"
    filepath = output_dir / filename
    
    try:
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        
        log(f"Market data saved to: {filepath}", "SUCCESS")
        
        # Print summary
        total_instruments = sum([
            len(data.get("indices", {})),
            len(data.get("crypto", {})),
            len(data.get("commodities", {})),
            len(data.get("treasury", {})),
            len(data.get("economic_indicators", {}))
        ])
        log(f"Total instruments collected: {total_instruments}", "SUCCESS")
        
    except Exception as e:
        log(f"Failed to save data: {str(e)}", "ERROR")
        raise


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(description="Fetch market data for 100x Daily Wrap")
    parser.add_argument(
        "--date",
        type=str,
        default=None,
        help="Target date (YYYY-MM-DD). Defaults to yesterday's date."
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default=str(DEFAULT_OUTPUT_DIR),
        help=f"Output directory for JSON files (default: {DEFAULT_OUTPUT_DIR})"
    )
    
    args = parser.parse_args()
    
    # Determine target date
    if args.date:
        try:
            target_date = datetime.strptime(args.date, "%Y-%m-%d")
        except ValueError:
            log("Invalid date format. Use YYYY-MM-DD", "ERROR")
            sys.exit(1)
    else:
        # Default to yesterday (market data usually available for previous day)
        target_date = datetime.now() - timedelta(days=1)
    
    output_dir = Path(args.output_dir)
    
    log("=" * 60)
    log("100x Daily Wrap - Market Data Fetcher")
    log("=" * 60)
    
    # Fetch data
    market_data = fetch_all_market_data(target_date)
    
    # Save to file
    save_market_data(market_data, output_dir, target_date)
    
    log("=" * 60)
    log("Fetch complete!", "SUCCESS")
    log("=" * 60)


if __name__ == "__main__":
    main()
