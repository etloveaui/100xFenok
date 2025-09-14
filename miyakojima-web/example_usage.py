"""
Example usage of Google Sheets client for miyakojima POI synchronization.

This script demonstrates how to use the GoogleSheetsClient for common operations:
- Uploading POI data from JSON to Google Sheets
- Downloading POI data from Google Sheets to JSON
- Batch operations and data validation
"""

import json
import logging
from pathlib import Path
from google_sheets_client import GoogleSheetsClient

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def load_pois_from_json(file_path: str) -> list:
    """Load POI data from JSON file."""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            # Extract POIs from the nested structure
            pois = data.get('pois', [])
            logger.info(f"Loaded {len(pois)} POIs from {file_path}")
            return pois
    except Exception as e:
        logger.error(f"Error loading POIs from {file_path}: {e}")
        return []


def convert_poi_for_sheets(poi: dict) -> dict:
    """Convert POI data from JSON format to sheets format."""
    converted = {
        'id': poi.get('id', ''),
        'name': poi.get('name', ''),
        'name_en': poi.get('nameEn', ''),
        'category': poi.get('category', ''),
        'subcategory': '',  # Not in current JSON structure
        'rating': poi.get('rating', ''),
        'review_count': '',  # Not in current JSON structure
        'latitude': poi.get('coordinates', {}).get('lat', ''),
        'longitude': poi.get('coordinates', {}).get('lng', ''),
        'description': poi.get('description', ''),
        'address': '',  # Not in current JSON structure
        'phone': '',  # Not in current JSON structure
        'website': '',  # Not in current JSON structure
        'opening_hours': poi.get('openHours', ''),
        'price_range': f"{poi.get('cost', {}).get('min', 0)}-{poi.get('cost', {}).get('max', 0)} {poi.get('cost', {}).get('currency', 'JPY')}",
        'tags': ', '.join(poi.get('features', [])),
        'weather_dependent': 'Yes' if poi.get('weather') else 'No',
        'best_time': poi.get('tips', ''),
        'accessibility': poi.get('accessibility', '')
    }
    return converted


def upload_pois_to_sheets():
    """Upload POI data from JSON file to Google Sheets."""
    logger.info("Starting POI upload to Google Sheets")

    try:
        # Load POI data from JSON
        json_file = 'data/miyakojima_pois.json'
        pois = load_pois_from_json(json_file)

        if not pois:
            logger.error("No POI data found to upload")
            return False

        # Convert POIs to sheets format
        converted_pois = [convert_poi_for_sheets(poi) for poi in pois]
        logger.info(f"Converted {len(converted_pois)} POIs for sheets format")

        # Upload to Google Sheets
        with GoogleSheetsClient() as client:
            # Clear existing data (keep headers)
            client.clear_worksheet(keep_headers=True)
            logger.info("Cleared existing worksheet data")

            # Batch upload POIs
            success = client.batch_update(converted_pois)

            if success:
                logger.info(f"Successfully uploaded {len(converted_pois)} POIs to Google Sheets")

                # Get updated info
                info = client.get_worksheet_info()
                logger.info(f"Worksheet now contains {info['data_rows']} data rows")

                return True
            else:
                logger.error("Failed to upload POIs to Google Sheets")
                return False

    except Exception as e:
        logger.error(f"Error during POI upload: {e}")
        return False


def download_pois_from_sheets():
    """Download POI data from Google Sheets and save to JSON."""
    logger.info("Starting POI download from Google Sheets")

    try:
        with GoogleSheetsClient() as client:
            # Get all data from sheets
            data = client.get_all_data(include_headers=True)

            if not data or len(data) <= 1:  # Only headers or empty
                logger.warning("No POI data found in Google Sheets")
                return []

            headers = data[0]
            rows = data[1:]

            logger.info(f"Downloaded {len(rows)} POI records from Google Sheets")

            # Convert to dictionary format
            pois = []
            for row in rows:
                if not row or not row[0]:  # Skip empty rows
                    continue

                # Pad row with empty strings if shorter than headers
                padded_row = row + [''] * (len(headers) - len(row))

                poi = dict(zip(headers, padded_row))
                pois.append(poi)

            logger.info(f"Converted {len(pois)} POIs from sheets format")
            return pois

    except Exception as e:
        logger.error(f"Error during POI download: {e}")
        return []


def sync_example():
    """Example of bidirectional sync between JSON and Google Sheets."""
    logger.info("Starting sync example")

    try:
        with GoogleSheetsClient() as client:
            # Get worksheet info
            info = client.get_worksheet_info()
            logger.info(f"Connected to: {info['spreadsheet_title']}")
            logger.info(f"Current data rows: {info['data_rows']}")

            # Perform health check
            health = client.health_check()
            all_healthy = all([health[key] for key in health if key != 'error_message'])

            if all_healthy:
                logger.info("All health checks passed - ready for sync operations")
            else:
                logger.warning(f"Health check issues detected: {health}")

            # Example: Find specific POI
            specific_poi = client.find_poi_by_id('beach_001')
            if specific_poi:
                row_num, poi_data = specific_poi
                logger.info(f"Found POI 'beach_001' at row {row_num}: {poi_data[1]}")  # Name is in column 2
            else:
                logger.info("POI 'beach_001' not found in sheets")

    except Exception as e:
        logger.error(f"Error during sync example: {e}")


def main():
    """Main function demonstrating various operations."""
    import os
    os.environ['PYTHONIOENCODING'] = 'utf-8'

    print("=== Miyakojima POI Google Sheets Integration Example ===\n")

    try:
        # Test connection first
        print("1. Testing connection...")
        with GoogleSheetsClient() as client:
            info = client.get_worksheet_info()
            print(f"   Connected to: {info['spreadsheet_title']}")
            print(f"   Current data rows: {info['data_rows']}\n")

        # Example sync operations
        print("2. Running sync example...")
        sync_example()
        print()

        # Uncomment these lines to actually upload/download data:

        # print("3. Uploading POIs from JSON to Google Sheets...")
        # upload_success = upload_pois_to_sheets()
        # if upload_success:
        #     print("   Upload completed successfully\n")
        # else:
        #     print("   Upload failed\n")

        # print("4. Downloading POIs from Google Sheets...")
        # downloaded_pois = download_pois_from_sheets()
        # print(f"   Downloaded {len(downloaded_pois)} POIs\n")

        print("Example completed successfully!")

    except Exception as e:
        print(f"Example failed: {e}")


if __name__ == "__main__":
    main()