#!/usr/bin/env python3
"""
Damodaran Unified Converter
===========================

Unified CLI for all Damodaran data conversions.

Usage:
    python run.py --dataset all             # All datasets (6 JSON files)
    python run.py --dataset industries      # Group A (6 datasets merged)
    python run.py --dataset histimpl        # Group B (historical ERP)
    python run.py --dataset ratings         # Group C (credit ratings)
    python run.py --dataset erp             # Group D (country ERP, 178 countries)
    python run.py --dataset industry_metrics # Group E (extended valuation metrics)
    python run.py --dataset industry_metrics_regions # Group F (non-US regional industry metrics)

    python run.py --list                    # Show available datasets
    python run.py --validate                # Validate existing output files

Version: 2.3.0 (2026-06-05) - Regional industry metrics + ratings XLS
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import List, Optional

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from config import URLS, OUTPUT_FILES, GROUP_A_DATASETS
from parsers import (
    ERPParser,
    IndustryMetricsParser,
    IndustryMetricsRegionsParser,
    IndustryParser,
    RatingsParser,
    TimeSeriesParser,
    generate_legacy_ev_sales,
)


# =============================================================================
# Dataset Registry
# =============================================================================

DATASETS = {
    "industries": {
        "description": "Unified industry data (Group A: betas, margin, eva, debtdetails, fundgr, ev_sales)",
        "output": "industries.json",
        "parser": IndustryParser,
    },
    "histimpl": {
        "description": "Historical implied ERP (Group B: time-series)",
        "output": "historical_erp.json",
        "parser": TimeSeriesParser,
    },
    "ratings": {
        "description": "Credit rating lookup tables (Group C: calculator)",
        "output": "credit_ratings.json",
        "parser": RatingsParser,
    },
    "erp": {
        "description": "Country equity risk premiums (178 countries, 2026 structure)",
        "output": "erp.json",
        "parser": ERPParser,
    },
    "industry_metrics": {
        "description": "Extended US industry valuation metrics (WACC, multiples, tax, capex, ROE, WC, leases)",
        "output": "industry_metrics.json",
        "parser": IndustryMetricsParser,
    },
    "industry_metrics_regions": {
        "description": "Extended non-US regional industry metrics (7 regions, 17 current-year datasets)",
        "output": "industry_metrics_regions.json",
        "parser": IndustryMetricsRegionsParser,
    },
}

ALL_DATASETS = [
    "industries",
    "histimpl",
    "ratings",
    "erp",
    "industry_metrics",
    "industry_metrics_regions",
]


# =============================================================================
# Conversion Functions
# =============================================================================

def convert_industries(output_dir: Path, legacy: bool = False) -> Path:
    """Convert Group A industry datasets."""
    print("\n" + "=" * 60)
    print("📊 Converting Group A: Industry Datasets")
    print("=" * 60)

    parser = IndustryParser(output_dir=output_dir)
    output_path = parser.convert()

    if legacy:
        legacy_path = output_dir / OUTPUT_FILES["ev_sales"]
        generate_legacy_ev_sales(parser.industries, legacy_path)

    print(f"\n✅ Industries: {len(parser.industries)} industries from {len(parser.datasets_parsed)} datasets")
    return output_path


def convert_histimpl(output_dir: Path) -> Path:
    """Convert Group B time-series dataset."""
    print("\n" + "=" * 60)
    print("📈 Converting Group B: Historical ERP")
    print("=" * 60)

    parser = TimeSeriesParser(output_dir=output_dir)
    output_path = parser.convert()

    print(f"\n✅ Historical ERP: {len(parser.years)} years ({parser.year_range})")
    return output_path


def convert_ratings(output_dir: Path) -> Path:
    """Convert Group C ratings dataset."""
    print("\n" + "=" * 60)
    print("⭐ Converting Group C: Credit Ratings")
    print("=" * 60)

    parser = RatingsParser(output_dir=output_dir)
    output_path = parser.convert()

    status = "✅" if not parser.fallback_used else "⚠️"
    method = parser.parsing_method
    print(f"\n{status} Credit Ratings: {len(parser.lookup_tables)} tables ({method})")

    if parser.fallback_used:
        print("   ⚠️  WARNING: Fallback data used - spreads may not be current")

    return output_path


def convert_erp(output_dir: Path) -> Path:
    """Convert ERP dataset (178 countries, 2026 structure)."""
    print("\n" + "=" * 60)
    print("🌍 Converting Group D: Country Risk Premiums")
    print("=" * 60)

    parser = ERPParser(output_dir=output_dir)
    output_path = parser.convert()

    us_erp_str = f"{parser.us_erp:.2%}" if parser.us_erp else "N/A"
    print(f"\n✅ ERP: {len(parser.countries)} countries, US ERP: {us_erp_str}")
    return output_path


def convert_industry_metrics(output_dir: Path) -> Path:
    """Convert Group E extended industry metrics."""
    print("\n" + "=" * 60)
    print("🧮 Converting Group E: Extended Industry Metrics")
    print("=" * 60)

    parser = IndustryMetricsParser(output_dir=output_dir)
    output_path = parser.convert()

    print(
        f"\n✅ Industry Metrics: {len(parser.industries)} industries from {len(parser.datasets_parsed)} datasets"
    )
    return output_path


def convert_industry_metrics_regions(output_dir: Path) -> Path:
    """Convert Group F non-US regional industry metrics."""
    print("\n" + "=" * 60)
    print("Converting Group F: Regional Industry Metrics")
    print("=" * 60)

    parser = IndustryMetricsRegionsParser(output_dir=output_dir)
    output_path = parser.convert()

    region_counts = {
        region: len(region_data.get("industries", {}))
        for region, region_data in parser.regions.items()
    }
    print(
        f"\nRegional Industry Metrics: {len(parser.regions)} regions, "
        f"{len(parser.datasets_parsed)} datasets, counts={region_counts}"
    )
    if parser.errors:
        print(f"   WARNING: {len(parser.errors)} parse errors recorded in metadata")
    return output_path


# =============================================================================
# Validation Functions
# =============================================================================

def validate_output(output_dir: Path) -> bool:
    """Validate existing output files."""
    print("\n" + "=" * 60)
    print("🔍 Validating Output Files")
    print("=" * 60)

    all_valid = True

    for name, info in DATASETS.items():
        output_file = output_dir / info["output"]

        if not output_file.exists():
            print(f"❌ {name}: File not found ({output_file})")
            all_valid = False
            continue

        try:
            with open(output_file) as f:
                data = json.load(f)

            # Basic validation
            if "metadata" not in data:
                print(f"⚠️  {name}: Missing metadata")
                all_valid = False
                continue

            metadata = data["metadata"]
            generated_at = metadata.get("generated_at", "unknown")
            schema_version = metadata.get("schema_version", "unknown")

            # Count records
            if name == "industries":
                count = len(data.get("industries", {}))
                print(f"✅ {name}: {count} industries (v{schema_version}, {generated_at[:10]})")
            elif name == "histimpl":
                count = len(data.get("years", {}))
                print(f"✅ {name}: {count} years (v{schema_version}, {generated_at[:10]})")
            elif name == "ratings":
                count = len(data.get("lookup_tables", {}))
                fallback = metadata.get("fallback_used", False)
                status = "⚠️ fallback" if fallback else "✅"
                print(f"{status} {name}: {count} tables (v{schema_version}, {generated_at[:10]})")
            elif name == "erp":
                count = len(data.get("countries", {}))
                print(f"✅ {name}: {count} countries (v{schema_version}, {generated_at[:10]})")
            elif name == "industry_metrics":
                count = len(data.get("industries", {}))
                dataset_count = metadata.get("dataset_count", 0)
                print(f"✅ {name}: {count} industries, {dataset_count} datasets (v{schema_version}, {generated_at[:10]})")
            elif name == "industry_metrics_regions":
                region_count = len(data.get("regions", {}))
                dataset_count = metadata.get("dataset_count", 0)
                errors = len(metadata.get("errors", []))
                status = "✅" if errors == 0 else "⚠️"
                print(
                    f"{status} {name}: {region_count} regions, {dataset_count} datasets, "
                    f"{errors} errors (v{schema_version}, {generated_at[:10]})"
                )

        except Exception as e:
            print(f"❌ {name}: Validation error - {e}")
            all_valid = False

    print("=" * 60)
    return all_valid


# =============================================================================
# Main CLI
# =============================================================================

def main():
    """Main CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Damodaran Unified Converter",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python run.py --dataset all           # Convert all datasets
  python run.py --dataset industries    # Only industry data
  python run.py --dataset ratings       # Only credit ratings
  python run.py --dataset industry_metrics # Only extended industry metrics
  python run.py --dataset industry_metrics_regions # Only non-US regional metrics
  python run.py --validate              # Validate existing output
  python run.py --list                  # Show available datasets
        """
    )

    parser.add_argument(
        "--dataset", "-d",
        choices=["all"] + list(DATASETS.keys()),
        default="all",
        help="Dataset to convert (default: all)"
    )
    parser.add_argument(
        "--output-dir", "-o",
        type=Path,
        default=Path(__file__).parent / "output",
        help="Output directory (default: ./output)"
    )
    parser.add_argument(
        "--legacy",
        action="store_true",
        help="Also generate legacy ev_sales.json for backward compatibility"
    )
    parser.add_argument(
        "--validate",
        action="store_true",
        help="Validate existing output files instead of converting"
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="List available datasets"
    )

    args = parser.parse_args()

    # List datasets
    if args.list:
        print("\n📋 Available Datasets:")
        print("-" * 60)
        for name, info in DATASETS.items():
            print(f"  {name:15} → {info['output']}")
            print(f"                   {info['description']}")
        print("-" * 60)
        return

    # Validate
    if args.validate:
        validate_output(args.output_dir)
        return

    # Create output directory
    args.output_dir.mkdir(parents=True, exist_ok=True)

    # Convert
    print(f"\n🚀 Damodaran Unified Converter")
    print(f"   Output: {args.output_dir}")
    print(f"   Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    outputs = []

    if args.dataset in ["all", "industries"]:
        path = convert_industries(args.output_dir, legacy=args.legacy)
        if path:
            outputs.append(path)

    if args.dataset in ["all", "histimpl"]:
        path = convert_histimpl(args.output_dir)
        if path:
            outputs.append(path)

    if args.dataset in ["all", "ratings"]:
        path = convert_ratings(args.output_dir)
        if path:
            outputs.append(path)

    if args.dataset in ["all", "erp"]:
        path = convert_erp(args.output_dir)
        if path:
            outputs.append(path)

    if args.dataset in ["all", "industry_metrics"]:
        path = convert_industry_metrics(args.output_dir)
        if path:
            outputs.append(path)

    if args.dataset in ["all", "industry_metrics_regions"]:
        path = convert_industry_metrics_regions(args.output_dir)
        if path:
            outputs.append(path)

    # Summary
    print("\n" + "=" * 60)
    print("📁 Output Summary")
    print("=" * 60)

    total_size = 0
    for path in outputs:
        if path and path.exists():
            size = path.stat().st_size / 1024
            total_size += size
            print(f"  ✅ {path.name:30} ({size:.1f} KB)")

    print("-" * 60)
    print(f"  Total: {len(outputs)} files ({total_size:.1f} KB)")
    print("=" * 60)


if __name__ == "__main__":
    main()
