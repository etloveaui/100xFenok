#!/usr/bin/env python3
"""
CSV to JSON Converter for Stock Analyzer Global Expansion
Converts Global Scouter CSV files to optimized JSON for web application

@version 1.0.0
@author Stock Analyzer Team
"""

import csv
import json
import os
import sys
import re
import argparse
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class CSVToJSONConverter:
    """Main converter class for CSV to JSON transformation"""

    def __init__(self, config_path: Optional[str] = None):
        """Initialize converter with optional config file"""
        self.config = self.load_config(config_path) if config_path else self.default_config()
        self.validation_errors = []
        self.quality_metrics = {}

    def default_config(self) -> Dict:
        """Default configuration for CSV conversion"""
        return {
            "field_mappings": {
                # Identity fields
                "Ticker": "Ticker",
                "종목명": "corpName",
                "ISIN": "ISIN",
                "CUSIP": "CUSIP",

                # Classification
                "거래소": "exchange",
                "업종": "industry",
                "Country": "country",
                "GICS Sector": "gicsSector",
                "GICS Industry": "gicsIndustry",

                # Valuation metrics
                "PER (Oct-25)": "perCurrent",
                "PBR (Oct-25)": "pbrCurrent",
                "PSR (Oct-25)": "psrCurrent",
                "EV/EBITDA (Oct-25)": "evEbitdaCurrent",
                "PEG (Oct-25)": "pegCurrent",
                "PCF (Oct-25)": "pcfCurrent",

                # Profitability metrics
                "ROE (Fwd)": "roeFwd",
                "ROA (Fwd)": "roaFwd",
                "OPM (Fwd)": "opmFwd",
                "NPM (Fwd)": "npmFwd",
                "GPM (Fwd)": "gpmFwd",

                # Growth metrics
                "Sales (CAGR3)": "salesCagr3",
                "EBIT (CAGR3)": "ebitCagr3",
                "NI (CAGR3)": "niCagr3",
                "Sales Growth (YoY)": "salesGrowthYoY",

                # Financial health
                "D/E (Oct-25)": "debtEquityRatio",
                "Current Ratio (Oct-25)": "currentRatio",
                "Quick Ratio (Oct-25)": "quickRatio",
                "Interest Coverage (Oct-25)": "interestCoverage",

                # Price & returns
                "Price": "currentPrice",
                "52W High": "high52Week",
                "52W Low": "low52Week",
                "YTD": "returnYTD",
                "1 M": "return1M",
                "3 M": "return3M",
                "6 M": "return6M",
                "Return (Y)": "return1Y",

                # Momentum
                "W": "returnWeekly",
                "실적모멘텀": "earningsMomentum",
                "주가모멘텀": "priceMomentum",

                # Other
                "시가총액 ($M)": "marketCapMillions",
                "DY (FY+1)": "dividendYieldFwd",
                "EPS (FY+1)": "epsFwd",
                "DPS (FY+1)": "dpsFwd"
            },
            "data_types": {
                "Ticker": "string",
                "corpName": "string",
                "currentPrice": "float",
                "marketCapMillions": "float",
                "perCurrent": "float",
                "pbrCurrent": "float",
                "roeFwd": "float",
                "returnYTD": "float"
            },
            "validation_rules": {
                "required_fields": ["Ticker", "corpName"],
                "numeric_ranges": {
                    "perCurrent": [-1000, 1000],
                    "roeFwd": [-200, 200],
                    "returnYTD": [-100, 1000]
                }
            },
            "output": {
                "pretty_print": True,
                "minify": False,
                "encoding": "utf-8",
                "date_format": "%Y-%m-%d"
            }
        }

    def load_config(self, config_path: str) -> Dict:
        """Load configuration from JSON file"""
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Failed to load config from {config_path}: {e}")
            return self.default_config()

    def clean_value(self, value: str, data_type: str = "string") -> Any:
        """Clean and convert single value"""
        if value is None or value == "":
            return None

        # Remove problematic patterns
        value = str(value).strip()
        value = re.sub(r'^0-0x2a0x2a$', '', value)  # Remove 0-0x2a0x2a pattern
        value = re.sub(r'^-$', '', value)  # Remove standalone dash

        if value == "" or value.lower() in ["na", "n/a", "null", "none", "#n/a", "#ref!"]:
            return None

        # Type conversion
        if data_type == "float":
            try:
                # Handle percentage strings
                if value.endswith('%'):
                    return float(value.rstrip('%')) / 100
                return float(value.replace(',', ''))
            except (ValueError, TypeError):
                return None

        elif data_type == "int":
            try:
                return int(float(value.replace(',', '')))
            except (ValueError, TypeError):
                return None

        elif data_type == "boolean":
            return value.lower() in ["true", "yes", "1", "y"]

        return value

    def validate_record(self, record: Dict) -> bool:
        """Validate single record against rules"""
        errors = []
        rules = self.config.get("validation_rules", {})

        # Check required fields
        for field in rules.get("required_fields", []):
            if not record.get(field):
                errors.append(f"Missing required field: {field}")

        # Check numeric ranges
        for field, (min_val, max_val) in rules.get("numeric_ranges", {}).items():
            value = record.get(field)
            if value is not None and isinstance(value, (int, float)):
                if value < min_val or value > max_val:
                    errors.append(f"{field} value {value} outside range [{min_val}, {max_val}]")

        if errors:
            self.validation_errors.extend(errors)

        return len(errors) == 0

    def convert_csv_to_json(self, csv_path: str, output_path: Optional[str] = None) -> Dict:
        """Main conversion method"""
        logger.info(f"Starting conversion of {csv_path}")

        # Prepare paths
        csv_file = Path(csv_path)
        if not csv_file.exists():
            raise FileNotFoundError(f"CSV file not found: {csv_path}")

        if output_path is None:
            output_path = csv_file.with_suffix('.json')

        # Read and convert CSV
        records = []
        skipped_rows = 0
        processed_rows = 0

        try:
            with open(csv_file, 'r', encoding='utf-8-sig') as f:
                # Detect delimiter
                sample = f.read(1024)
                f.seek(0)
                delimiter = ',' if ',' in sample else '\t'

                reader = csv.DictReader(f, delimiter=delimiter)
                field_mappings = self.config.get("field_mappings", {})
                data_types = self.config.get("data_types", {})

                for row_num, row in enumerate(reader, 1):
                    processed_rows += 1

                    # Transform record
                    record = {}
                    for csv_field, json_field in field_mappings.items():
                        if csv_field in row:
                            value = self.clean_value(
                                row[csv_field],
                                data_types.get(json_field, "string")
                            )
                            if value is not None:
                                record[json_field] = value

                    # Add metadata
                    record["_sourceRow"] = row_num
                    record["_lastUpdated"] = datetime.now().strftime(
                        self.config["output"]["date_format"]
                    )

                    # Validate and add
                    if self.validate_record(record):
                        records.append(record)
                    else:
                        skipped_rows += 1

        except Exception as e:
            logger.error(f"Error processing CSV: {e}")
            raise

        # Calculate quality metrics
        self.quality_metrics = self.calculate_quality_metrics(records)

        # Prepare output
        output_data = {
            "metadata": {
                "source": csv_file.name,
                "converted": datetime.now().isoformat(),
                "recordCount": len(records),
                "skippedRows": skipped_rows,
                "processedRows": processed_rows,
                "qualityMetrics": self.quality_metrics,
                "validationErrors": len(self.validation_errors)
            },
            "data": records
        }

        # Write JSON output
        with open(output_path, 'w', encoding=self.config["output"]["encoding"]) as f:
            if self.config["output"]["pretty_print"]:
                json.dump(output_data, f, indent=2, ensure_ascii=False)
            else:
                json.dump(output_data, f, ensure_ascii=False)

        logger.info(f"Conversion complete: {len(records)} records written to {output_path}")
        logger.info(f"Quality metrics: {self.quality_metrics}")

        return output_data

    def calculate_quality_metrics(self, records: List[Dict]) -> Dict:
        """Calculate data quality metrics"""
        if not records:
            return {"completeness": 0, "recordCount": 0}

        total_fields = 0
        non_null_fields = 0
        field_completeness = {}

        # Get all fields
        all_fields = set()
        for record in records:
            all_fields.update(record.keys())

        # Calculate completeness per field
        for field in all_fields:
            if field.startswith('_'):
                continue

            field_count = 0
            non_null_count = 0

            for record in records:
                field_count += 1
                total_fields += 1
                if record.get(field) is not None:
                    non_null_count += 1
                    non_null_fields += 1

            field_completeness[field] = (non_null_count / field_count * 100) if field_count > 0 else 0

        return {
            "completeness": (non_null_fields / total_fields * 100) if total_fields > 0 else 0,
            "recordCount": len(records),
            "fieldCount": len(all_fields) - 2,  # Exclude metadata fields
            "fieldCompleteness": field_completeness,
            "averageCompleteness": sum(field_completeness.values()) / len(field_completeness) if field_completeness else 0
        }

    def batch_convert(self, input_dir: str, output_dir: str, pattern: str = "*.csv"):
        """Convert multiple CSV files"""
        input_path = Path(input_dir)
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        csv_files = list(input_path.glob(pattern))
        logger.info(f"Found {len(csv_files)} CSV files to convert")

        results = []
        for csv_file in csv_files:
            try:
                output_file = output_path / csv_file.with_suffix('.json').name
                result = self.convert_csv_to_json(str(csv_file), str(output_file))
                results.append({
                    "file": csv_file.name,
                    "status": "success",
                    "records": result["metadata"]["recordCount"]
                })
            except Exception as e:
                logger.error(f"Failed to convert {csv_file.name}: {e}")
                results.append({
                    "file": csv_file.name,
                    "status": "error",
                    "error": str(e)
                })

        return results


def main():
    """Command line interface"""
    parser = argparse.ArgumentParser(
        description="Convert Global Scouter CSV files to JSON for Stock Analyzer"
    )
    parser.add_argument("input", help="Input CSV file or directory")
    parser.add_argument("-o", "--output", help="Output JSON file or directory")
    parser.add_argument("-c", "--config", help="Configuration JSON file")
    parser.add_argument("-b", "--batch", action="store_true", help="Batch convert directory")
    parser.add_argument("-p", "--pattern", default="*.csv", help="File pattern for batch mode")
    parser.add_argument("-v", "--verbose", action="store_true", help="Verbose output")

    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    converter = CSVToJSONConverter(args.config)

    try:
        if args.batch:
            if not args.output:
                args.output = Path(args.input).parent / "json_output"
            results = converter.batch_convert(args.input, args.output, args.pattern)
            print(f"\nBatch conversion complete:")
            for result in results:
                status = "✓" if result["status"] == "success" else "✗"
                print(f"  {status} {result['file']}: {result.get('records', result.get('error'))}")
        else:
            output_data = converter.convert_csv_to_json(args.input, args.output)
            print(f"\n✓ Conversion successful!")
            print(f"  Records: {output_data['metadata']['recordCount']}")
            print(f"  Quality: {output_data['metadata']['qualityMetrics']['completeness']:.1f}%")
            if converter.validation_errors:
                print(f"  ⚠ Validation errors: {len(converter.validation_errors)}")

    except Exception as e:
        logger.error(f"Conversion failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()