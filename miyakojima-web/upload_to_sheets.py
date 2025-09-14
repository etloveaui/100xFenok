"""
Upload miyakojima POI data to Google Sheets.

This script reads POI data from the local JSON file and uploads it to Google Sheets,
converting the data format as needed and handling batch operations efficiently.
"""

import json
import logging
import sys
from pathlib import Path
from typing import List, Dict, Any

from google_sheets_client import GoogleSheetsClient, DataValidationError

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def load_pois_from_json(file_path: str) -> List[Dict[str, Any]]:
    """
    Load POI data from JSON file.

    Args:
        file_path: Path to the JSON file

    Returns:
        List of POI dictionaries

    Raises:
        FileNotFoundError: If JSON file doesn't exist
        json.JSONDecodeError: If JSON is malformed
    """
    json_path = Path(file_path)
    if not json_path.exists():
        raise FileNotFoundError(f"POI JSON file not found: {file_path}")

    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        # Extract POIs from nested structure
        pois = data.get('pois', [])
        logger.info(f"Loaded {len(pois)} POIs from {file_path}")

        if not pois:
            logger.warning("No POI data found in JSON file")

        return pois

    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON format in {file_path}: {e}")
        raise
    except Exception as e:
        logger.error(f"Error loading POI data: {e}")
        raise


def convert_poi_to_sheets_format(poi: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convert POI data from JSON format to Google Sheets format.

    Args:
        poi: POI dictionary from JSON

    Returns:
        POI dictionary formatted for sheets

    Raises:
        KeyError: If required fields are missing
    """
    try:
        # Extract coordinates
        coords = poi.get('coordinates', {})
        latitude = coords.get('lat', '') if coords else ''
        longitude = coords.get('lng', '') if coords else ''

        # Extract cost information
        cost = poi.get('cost', {})
        if cost:
            cost_min = cost.get('min', 0)
            cost_max = cost.get('max', 0)
            currency = cost.get('currency', 'JPY')
            price_range = f"{cost_min}-{cost_max} {currency}" if cost_max > 0 else f"{cost_min} {currency}"
        else:
            price_range = ""

        # Convert features to tags
        features = poi.get('features', [])
        tags = ', '.join(features) if features else ''

        # Weather dependency check
        weather = poi.get('weather', {})
        weather_dependent = 'Yes' if weather else 'No'

        # Create sheets-formatted POI
        sheets_poi = {
            'id': poi.get('id', ''),
            'name': poi.get('name', ''),
            'name_en': poi.get('nameEn', ''),
            'category': poi.get('category', ''),
            'subcategory': '',  # Not available in current JSON structure
            'rating': poi.get('rating', ''),
            'review_count': '',  # Not available in current JSON structure
            'latitude': str(latitude) if latitude else '',
            'longitude': str(longitude) if longitude else '',
            'description': poi.get('description', ''),
            'address': '',  # Not available in current JSON structure
            'phone': '',  # Not available in current JSON structure
            'website': '',  # Not available in current JSON structure
            'opening_hours': poi.get('openHours', ''),
            'price_range': price_range,
            'tags': tags,
            'weather_dependent': weather_dependent,
            'best_time': poi.get('tips', ''),
            'accessibility': poi.get('accessibility', '')
        }

        return sheets_poi

    except Exception as e:
        logger.error(f"Error converting POI {poi.get('id', 'unknown')}: {e}")
        raise


def upload_pois_to_sheets(
    json_file_path: str = 'data/miyakojima_pois.json',
    clear_existing: bool = True,
    dry_run: bool = False
) -> bool:
    """
    Upload POI data from JSON file to Google Sheets.

    Args:
        json_file_path: Path to the POI JSON file
        clear_existing: Whether to clear existing data before upload
        dry_run: If True, validate data but don't upload

    Returns:
        True if successful, False otherwise
    """
    logger.info(f"Starting POI upload process {'(DRY RUN)' if dry_run else ''}")

    try:
        # Load POI data
        pois = load_pois_from_json(json_file_path)
        if not pois:
            logger.error("No POI data to upload")
            return False

        # Convert POIs to sheets format
        converted_pois = []
        conversion_errors = 0

        for i, poi in enumerate(pois):
            try:
                converted_poi = convert_poi_to_sheets_format(poi)
                converted_pois.append(converted_poi)
                logger.debug(f"Converted POI {i+1}/{len(pois)}: {poi.get('id', 'unknown')}")
            except Exception as e:
                conversion_errors += 1
                logger.error(f"Failed to convert POI {i+1}: {e}")

        logger.info(f"Successfully converted {len(converted_pois)} POIs")
        if conversion_errors > 0:
            logger.warning(f"{conversion_errors} POIs failed conversion")

        if not converted_pois:
            logger.error("No valid POIs to upload after conversion")
            return False

        # Dry run - just validate data
        if dry_run:
            logger.info("DRY RUN: Validating data format...")
            with GoogleSheetsClient() as client:
                # Test data validation
                for poi in converted_pois[:5]:  # Test first 5
                    try:
                        client._validate_poi_data(poi)
                    except DataValidationError as e:
                        logger.error(f"Validation error: {e}")
                        return False

            logger.info("DRY RUN: All data validation passed")
            return True

        # Upload to Google Sheets
        logger.info("Connecting to Google Sheets...")
        with GoogleSheetsClient() as client:
            # Get current worksheet info
            info = client.get_worksheet_info()
            logger.info(f"Connected to: {info['spreadsheet_title']}")
            logger.info(f"Current data rows: {info['data_rows']}")

            # Clear existing data if requested
            if clear_existing and info['data_rows'] > 0:
                logger.info("Clearing existing worksheet data...")
                client.clear_worksheet(keep_headers=True)

            # Batch upload POIs
            logger.info(f"Uploading {len(converted_pois)} POIs...")
            success = client.batch_update(converted_pois)

            if success:
                # Get updated info
                updated_info = client.get_worksheet_info()
                logger.info(f"Upload successful! Worksheet now has {updated_info['data_rows']} data rows")

                # Log upload summary
                print("\n=== UPLOAD SUMMARY ===")
                print(f"Source file: {json_file_path}")
                print(f"POIs processed: {len(pois)}")
                print(f"POIs uploaded: {len(converted_pois)}")
                print(f"Conversion errors: {conversion_errors}")
                print(f"Final worksheet rows: {updated_info['data_rows']}")
                print("Status: SUCCESS")

                return True
            else:
                logger.error("Upload failed")
                return False

    except FileNotFoundError as e:
        logger.error(f"File not found: {e}")
        return False
    except Exception as e:
        logger.error(f"Upload process failed: {e}")
        return False


def main():
    """Main function with command line argument handling."""
    import os
    import argparse

    os.environ['PYTHONIOENCODING'] = 'utf-8'

    parser = argparse.ArgumentParser(description='Upload miyakojima POI data to Google Sheets')
    parser.add_argument(
        '--file', '-f',
        default='data/miyakojima_pois.json',
        help='Path to POI JSON file (default: data/miyakojima_pois.json)'
    )
    parser.add_argument(
        '--no-clear',
        action='store_true',
        help='Don\'t clear existing data before upload'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Validate data without uploading'
    )
    parser.add_argument(
        '--verbose', '-v',
        action='store_true',
        help='Enable verbose logging'
    )

    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    print("=== Miyakojima POI Upload to Google Sheets ===\n")

    try:
        success = upload_pois_to_sheets(
            json_file_path=args.file,
            clear_existing=not args.no_clear,
            dry_run=args.dry_run
        )

        if success:
            print("\n[SUCCESS] Upload completed successfully!")
            sys.exit(0)
        else:
            print("\n[ERROR] Upload failed!")
            sys.exit(1)

    except KeyboardInterrupt:
        print("\n[WARNING] Upload cancelled by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n[ERROR] Unexpected error: {e}")
        logger.exception("Unexpected error during upload")
        sys.exit(1)


if __name__ == "__main__":
    main()