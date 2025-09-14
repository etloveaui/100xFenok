"""
Download miyakojima POI data from Google Sheets.

This script downloads POI data from Google Sheets and saves it to a local JSON file,
converting the data format and providing options for backup and validation.
"""

import json
import logging
import sys
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional

from google_sheets_client import GoogleSheetsClient

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def convert_sheets_row_to_poi(row_data: Dict[str, str]) -> Dict[str, Any]:
    """
    Convert a Google Sheets row to POI JSON format.

    Args:
        row_data: Dictionary with column names as keys

    Returns:
        POI dictionary in JSON format

    Raises:
        ValueError: If required fields are missing or invalid
    """
    try:
        # Extract and validate required fields
        poi_id = row_data.get('id', '').strip()
        if not poi_id:
            raise ValueError("POI ID is required")

        name = row_data.get('name', '').strip()
        if not name:
            raise ValueError("POI name is required")

        # Extract coordinates
        latitude_str = row_data.get('latitude', '').strip()
        longitude_str = row_data.get('longitude', '').strip()

        coordinates = {}
        if latitude_str and longitude_str:
            try:
                coordinates = {
                    'lat': float(latitude_str),
                    'lng': float(longitude_str)
                }
            except ValueError:
                logger.warning(f"Invalid coordinates for POI {poi_id}")

        # Extract rating
        rating = None
        rating_str = row_data.get('rating', '').strip()
        if rating_str:
            try:
                rating = float(rating_str)
            except ValueError:
                logger.warning(f"Invalid rating for POI {poi_id}: {rating_str}")

        # Parse price range
        cost = {}
        price_range = row_data.get('price_range', '').strip()
        if price_range:
            try:
                # Parse formats like "0-1000 JPY" or "500 JPY"
                if '-' in price_range:
                    price_part, currency = price_range.rsplit(' ', 1)
                    min_str, max_str = price_part.split('-', 1)
                    cost = {
                        'min': int(min_str.strip()),
                        'max': int(max_str.strip()),
                        'currency': currency
                    }
                else:
                    price_part, currency = price_range.rsplit(' ', 1)
                    cost = {
                        'min': int(price_part.strip()),
                        'max': int(price_part.strip()),
                        'currency': currency
                    }
            except (ValueError, IndexError):
                logger.warning(f"Could not parse price range for POI {poi_id}: {price_range}")

        # Parse tags/features
        features = []
        tags_str = row_data.get('tags', '').strip()
        if tags_str:
            features = [tag.strip() for tag in tags_str.split(',') if tag.strip()]

        # Parse weather dependency
        weather = {}
        weather_dependent = row_data.get('weather_dependent', '').strip().lower()
        if weather_dependent == 'yes':
            # Create a basic weather structure
            weather = {
                'sunny': '최적',
                'cloudy': '좋음',
                'rainy': '부적합'
            }

        # Build POI object
        poi = {
            'id': poi_id,
            'name': name,
            'nameEn': row_data.get('name_en', '').strip(),
            'category': row_data.get('category', '').strip(),
            'description': row_data.get('description', '').strip(),
            'openHours': row_data.get('opening_hours', '').strip(),
            'tips': row_data.get('best_time', '').strip(),
            'accessibility': row_data.get('accessibility', '').strip()
        }

        # Add optional fields only if they have values
        if rating is not None:
            poi['rating'] = rating

        if coordinates:
            poi['coordinates'] = coordinates

        if cost:
            poi['cost'] = cost

        if features:
            poi['features'] = features

        if weather:
            poi['weather'] = weather

        # Add estimated time (default for compatibility)
        poi['estimatedTime'] = '1-2시간'

        return poi

    except Exception as e:
        logger.error(f"Error converting row to POI format: {e}")
        raise


def download_pois_from_sheets(
    output_file: str = 'data/miyakojima_pois_downloaded.json',
    backup_existing: bool = True,
    validate_data: bool = True
) -> bool:
    """
    Download POI data from Google Sheets and save to JSON file.

    Args:
        output_file: Path to output JSON file
        backup_existing: Whether to backup existing file
        validate_data: Whether to validate downloaded data

    Returns:
        True if successful, False otherwise
    """
    logger.info("Starting POI download from Google Sheets")

    try:
        # Connect to Google Sheets and download data
        logger.info("Connecting to Google Sheets...")
        with GoogleSheetsClient() as client:
            # Get worksheet info
            info = client.get_worksheet_info()
            logger.info(f"Connected to: {info['spreadsheet_title']}")
            logger.info(f"Data rows available: {info['data_rows']}")

            if info['data_rows'] == 0:
                logger.warning("No data found in Google Sheets")
                return False

            # Download all data
            raw_data = client.get_all_data(include_headers=True)

            if not raw_data or len(raw_data) <= 1:
                logger.warning("No POI data found in sheets")
                return False

            headers = raw_data[0]
            rows = raw_data[1:]

            logger.info(f"Downloaded {len(rows)} data rows with {len(headers)} columns")

            # Convert rows to POI format
            pois = []
            conversion_errors = 0

            for i, row in enumerate(rows):
                if not row or not any(cell.strip() for cell in row):
                    continue  # Skip empty rows

                try:
                    # Pad row with empty strings if needed
                    padded_row = row + [''] * (len(headers) - len(row))

                    # Create row dictionary
                    row_dict = dict(zip(headers, padded_row))

                    # Convert to POI format
                    poi = convert_sheets_row_to_poi(row_dict)
                    pois.append(poi)

                    logger.debug(f"Converted row {i+1}: {poi.get('id', 'unknown')}")

                except Exception as e:
                    conversion_errors += 1
                    logger.error(f"Failed to convert row {i+1}: {e}")

            logger.info(f"Successfully converted {len(pois)} POIs")
            if conversion_errors > 0:
                logger.warning(f"{conversion_errors} rows failed conversion")

            if not pois:
                logger.error("No valid POIs after conversion")
                return False

            # Validate data if requested
            if validate_data:
                logger.info("Validating downloaded data...")
                validation_errors = 0

                for poi in pois:
                    if not poi.get('id') or not poi.get('name'):
                        validation_errors += 1
                        logger.error(f"Invalid POI: missing id or name - {poi}")

                if validation_errors > 0:
                    logger.warning(f"{validation_errors} POIs failed validation")

            # Create output directory if needed
            output_path = Path(output_file)
            output_path.parent.mkdir(parents=True, exist_ok=True)

            # Backup existing file if requested
            if backup_existing and output_path.exists():
                backup_path = output_path.with_suffix(f'.backup_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json')
                output_path.rename(backup_path)
                logger.info(f"Backed up existing file to: {backup_path}")

            # Create output data structure
            output_data = {
                'version': '3.0.0',
                'lastUpdated': datetime.now().isoformat() + '+00:00',
                'totalPOIs': len(pois),
                'downloadedFrom': info['spreadsheet_title'],
                'downloadedAt': datetime.now().isoformat(),
                'categories': {
                    'beaches': '해변',
                    'activities': '액티비티',
                    'restaurants': '음식점',
                    'culture': '문화',
                    'nature': '자연',
                    'shopping': '쇼핑'
                },
                'pois': pois
            }

            # Save to JSON file
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(output_data, f, ensure_ascii=False, indent=2)

            logger.info(f"Saved {len(pois)} POIs to {output_file}")

            # Log download summary
            print("\n=== DOWNLOAD SUMMARY ===")
            print(f"Source: {info['spreadsheet_title']}")
            print(f"Rows downloaded: {len(rows)}")
            print(f"POIs converted: {len(pois)}")
            print(f"Conversion errors: {conversion_errors}")
            print(f"Output file: {output_file}")
            print("Status: SUCCESS")

            return True

    except Exception as e:
        logger.error(f"Download process failed: {e}")
        return False


def compare_with_existing(
    downloaded_file: str,
    existing_file: str = 'data/miyakojima_pois.json'
) -> Optional[Dict[str, Any]]:
    """
    Compare downloaded data with existing JSON file.

    Args:
        downloaded_file: Path to downloaded JSON file
        existing_file: Path to existing JSON file

    Returns:
        Comparison statistics or None if comparison fails
    """
    try:
        logger.info("Comparing downloaded data with existing file...")

        # Load both files
        with open(downloaded_file, 'r', encoding='utf-8') as f:
            downloaded_data = json.load(f)

        if not Path(existing_file).exists():
            logger.warning(f"Existing file not found: {existing_file}")
            return None

        with open(existing_file, 'r', encoding='utf-8') as f:
            existing_data = json.load(f)

        # Extract POI lists
        downloaded_pois = {poi['id']: poi for poi in downloaded_data.get('pois', [])}
        existing_pois = {poi['id']: poi for poi in existing_data.get('pois', [])}

        # Calculate statistics
        downloaded_ids = set(downloaded_pois.keys())
        existing_ids = set(existing_pois.keys())

        new_pois = downloaded_ids - existing_ids
        removed_pois = existing_ids - downloaded_ids
        common_pois = downloaded_ids & existing_ids

        comparison = {
            'downloaded_count': len(downloaded_pois),
            'existing_count': len(existing_pois),
            'new_pois': len(new_pois),
            'removed_pois': len(removed_pois),
            'common_pois': len(common_pois),
            'new_poi_ids': list(new_pois),
            'removed_poi_ids': list(removed_pois)
        }

        logger.info(f"Comparison complete: {comparison}")
        return comparison

    except Exception as e:
        logger.error(f"Comparison failed: {e}")
        return None


def main():
    """Main function with command line argument handling."""
    import os
    import argparse

    os.environ['PYTHONIOENCODING'] = 'utf-8'

    parser = argparse.ArgumentParser(description='Download miyakojima POI data from Google Sheets')
    parser.add_argument(
        '--output', '-o',
        default='data/miyakojima_pois_downloaded.json',
        help='Output JSON file path (default: data/miyakojima_pois_downloaded.json)'
    )
    parser.add_argument(
        '--no-backup',
        action='store_true',
        help='Don\'t backup existing output file'
    )
    parser.add_argument(
        '--no-validate',
        action='store_true',
        help='Skip data validation'
    )
    parser.add_argument(
        '--compare',
        help='Compare with existing JSON file'
    )
    parser.add_argument(
        '--verbose', '-v',
        action='store_true',
        help='Enable verbose logging'
    )

    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    print("=== Miyakojima POI Download from Google Sheets ===\n")

    try:
        success = download_pois_from_sheets(
            output_file=args.output,
            backup_existing=not args.no_backup,
            validate_data=not args.no_validate
        )

        if not success:
            print("\n[ERROR] Download failed!")
            sys.exit(1)

        # Compare with existing file if requested
        if args.compare:
            comparison = compare_with_existing(args.output, args.compare)
            if comparison:
                print(f"\n=== COMPARISON WITH {args.compare} ===")
                print(f"Downloaded POIs: {comparison['downloaded_count']}")
                print(f"Existing POIs: {comparison['existing_count']}")
                print(f"New POIs: {comparison['new_pois']}")
                print(f"Removed POIs: {comparison['removed_pois']}")
                print(f"Common POIs: {comparison['common_pois']}")

                if comparison['new_poi_ids']:
                    print(f"New POI IDs: {', '.join(comparison['new_poi_ids'][:10])}")
                if comparison['removed_poi_ids']:
                    print(f"Removed POI IDs: {', '.join(comparison['removed_poi_ids'][:10])}")

        print("\n[SUCCESS] Download completed successfully!")
        sys.exit(0)

    except KeyboardInterrupt:
        print("\n[WARNING] Download cancelled by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n[ERROR] Unexpected error: {e}")
        logger.exception("Unexpected error during download")
        sys.exit(1)


if __name__ == "__main__":
    main()