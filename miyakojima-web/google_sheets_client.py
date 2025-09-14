"""
Production-grade Google Sheets client for miyakojima POI synchronization system.

This module provides a robust interface for interacting with Google Sheets,
supporting both read and write operations with proper error handling, retry logic,
and batch processing capabilities.
"""

import logging
import time
from typing import List, Dict, Any, Optional, Tuple, Union
from pathlib import Path

import gspread
from google.oauth2.service_account import Credentials
from gspread.exceptions import APIError, SpreadsheetNotFound, WorksheetNotFound
from requests.exceptions import ConnectionError, Timeout

from sheets_config import (
    CREDENTIALS_FILE, SPREADSHEET_ID, WORKSHEET_NAME,
    MAX_RETRIES, POI_COLUMNS
)

# Configure logging
logger = logging.getLogger(__name__)


class GoogleSheetsError(Exception):
    """Base exception for Google Sheets operations."""
    pass


class AuthenticationError(GoogleSheetsError):
    """Raised when authentication fails."""
    pass


class SheetAccessError(GoogleSheetsError):
    """Raised when sheet or worksheet cannot be accessed."""
    pass


class DataValidationError(GoogleSheetsError):
    """Raised when data validation fails."""
    pass


class GoogleSheetsClient:
    """
    Production-grade Google Sheets client with authentication, error handling,
    and batch operations support.

    Attributes:
        spreadsheet_id: Google Sheets spreadsheet ID
        worksheet_name: Target worksheet name
        max_retries: Maximum retry attempts for failed operations
        _client: Authenticated gspread client instance
        _spreadsheet: Cached spreadsheet reference
        _worksheet: Cached worksheet reference
    """

    def __init__(
        self,
        spreadsheet_id: Optional[str] = None,
        worksheet_name: Optional[str] = None,
        credentials_file: Optional[str] = None,
        max_retries: int = MAX_RETRIES
    ):
        """
        Initialize the Google Sheets client.

        Args:
            spreadsheet_id: Google Sheets ID (defaults to config)
            worksheet_name: Worksheet name (defaults to config)
            credentials_file: Service account credentials file path
            max_retries: Maximum retry attempts for failed operations

        Raises:
            AuthenticationError: If authentication fails
            FileNotFoundError: If credentials file doesn't exist
        """
        self.spreadsheet_id = spreadsheet_id or SPREADSHEET_ID
        self.worksheet_name = worksheet_name or WORKSHEET_NAME
        self.max_retries = max_retries
        self.credentials_file = credentials_file or CREDENTIALS_FILE

        # Validate inputs
        if not self.spreadsheet_id:
            raise ValueError("Spreadsheet ID is required")

        if not Path(self.credentials_file).exists():
            raise FileNotFoundError(f"Credentials file not found: {self.credentials_file}")

        # Initialize client components
        self._client: Optional[gspread.Client] = None
        self._spreadsheet: Optional[gspread.Spreadsheet] = None
        self._worksheet: Optional[gspread.Worksheet] = None

        # Authenticate on initialization
        self._authenticate()
        logger.info("GoogleSheetsClient initialized successfully")

    def _authenticate(self) -> None:
        """
        Authenticate with Google Sheets API using service account credentials.

        Raises:
            AuthenticationError: If authentication fails
        """
        try:
            scope = [
                'https://www.googleapis.com/auth/spreadsheets',
                'https://www.googleapis.com/auth/drive'
            ]

            credentials = Credentials.from_service_account_file(
                self.credentials_file,
                scopes=scope
            )

            self._client = gspread.authorize(credentials)
            logger.info("Successfully authenticated with Google Sheets API")

        except Exception as e:
            error_msg = f"Authentication failed: {str(e)}"
            logger.error(error_msg)
            raise AuthenticationError(error_msg) from e

    def _get_worksheet(self) -> gspread.Worksheet:
        """
        Get or create worksheet reference with caching and error handling.

        Returns:
            Worksheet object

        Raises:
            SheetAccessError: If spreadsheet or worksheet cannot be accessed
        """
        try:
            # Cache spreadsheet reference
            if not self._spreadsheet:
                self._spreadsheet = self._client.open_by_key(self.spreadsheet_id)
                logger.info(f"Opened spreadsheet: {self._spreadsheet.title}")

            # Cache worksheet reference
            if not self._worksheet:
                try:
                    self._worksheet = self._spreadsheet.worksheet(self.worksheet_name)
                except WorksheetNotFound:
                    # Create worksheet if it doesn't exist
                    logger.warning(f"Worksheet '{self.worksheet_name}' not found, creating...")
                    self._worksheet = self._spreadsheet.add_worksheet(
                        title=self.worksheet_name,
                        rows=1000,
                        cols=len(POI_COLUMNS)
                    )
                    # Add headers
                    self._worksheet.append_row(POI_COLUMNS)
                    logger.info(f"Created worksheet '{self.worksheet_name}' with headers")

                logger.info(f"Accessed worksheet: {self._worksheet.title}")

            return self._worksheet

        except SpreadsheetNotFound as e:
            error_msg = f"Spreadsheet not found: {self.spreadsheet_id}"
            logger.error(error_msg)
            raise SheetAccessError(error_msg) from e
        except Exception as e:
            error_msg = f"Failed to access worksheet: {str(e)}"
            logger.error(error_msg)
            raise SheetAccessError(error_msg) from e

    def _retry_operation(self, operation, *args, **kwargs) -> Any:
        """
        Execute operation with exponential backoff retry logic.

        Args:
            operation: Function to execute
            *args: Function arguments
            **kwargs: Function keyword arguments

        Returns:
            Operation result

        Raises:
            GoogleSheetsError: If all retry attempts fail
        """
        last_exception = None

        for attempt in range(self.max_retries + 1):
            try:
                return operation(*args, **kwargs)

            except (APIError, ConnectionError, Timeout) as e:
                last_exception = e
                if attempt < self.max_retries:
                    wait_time = (2 ** attempt)  # Exponential backoff
                    logger.warning(
                        f"Operation failed (attempt {attempt + 1}/{self.max_retries + 1}), "
                        f"retrying in {wait_time}s: {str(e)}"
                    )
                    time.sleep(wait_time)
                else:
                    error_msg = f"Operation failed after {self.max_retries + 1} attempts: {str(e)}"
                    logger.error(error_msg)
                    raise GoogleSheetsError(error_msg) from e

            except Exception as e:
                # Don't retry for non-recoverable errors
                error_msg = f"Non-recoverable error: {str(e)}"
                logger.error(error_msg)
                raise GoogleSheetsError(error_msg) from e

        # This should never be reached, but just in case
        raise GoogleSheetsError("Unexpected retry loop exit") from last_exception

    def _validate_poi_data(self, poi_data: Dict[str, Any]) -> List[str]:
        """
        Validate POI data against schema and convert to row format.

        Args:
            poi_data: POI data dictionary

        Returns:
            List of values in column order

        Raises:
            DataValidationError: If data validation fails
        """
        if not isinstance(poi_data, dict):
            raise DataValidationError("POI data must be a dictionary")

        if 'id' not in poi_data or not poi_data['id']:
            raise DataValidationError("POI data must have a non-empty 'id' field")

        # Convert POI data to row format
        row = []
        for column in POI_COLUMNS:
            value = poi_data.get(column, '')

            # Handle special data types
            if column in ['latitude', 'longitude'] and isinstance(poi_data.get('coordinates'), dict):
                if column == 'latitude':
                    value = poi_data['coordinates'].get('lat', '')
                elif column == 'longitude':
                    value = poi_data['coordinates'].get('lng', '')
            elif column == 'tags' and isinstance(value, list):
                value = ', '.join(str(tag) for tag in value)
            elif column == 'rating' and value:
                try:
                    value = float(value)
                except (ValueError, TypeError):
                    value = ''

            # Convert to string and handle None values
            row.append(str(value) if value is not None else '')

        return row

    def get_all_data(self, include_headers: bool = True) -> List[List[str]]:
        """
        Retrieve all data from the worksheet.

        Args:
            include_headers: Whether to include header row

        Returns:
            List of rows, each row is a list of cell values

        Raises:
            GoogleSheetsError: If operation fails
        """
        logger.info("Fetching all data from worksheet")

        def _get_data():
            worksheet = self._get_worksheet()
            all_values = worksheet.get_all_values()

            if not include_headers and all_values:
                return all_values[1:]  # Skip header row
            return all_values

        result = self._retry_operation(_get_data)
        logger.info(f"Retrieved {len(result)} rows from worksheet")
        return result

    def get_range(self, range_name: str) -> List[List[str]]:
        """
        Retrieve data from a specific range.

        Args:
            range_name: A1 notation range (e.g., 'A1:Z100')

        Returns:
            List of rows from the specified range

        Raises:
            GoogleSheetsError: If operation fails
        """
        logger.info(f"Fetching data from range: {range_name}")

        def _get_range():
            worksheet = self._get_worksheet()
            return worksheet.get(range_name)

        result = self._retry_operation(_get_range)
        logger.info(f"Retrieved {len(result)} rows from range {range_name}")
        return result

    def find_poi_by_id(self, poi_id: str) -> Optional[Tuple[int, List[str]]]:
        """
        Find POI row by ID.

        Args:
            poi_id: POI identifier

        Returns:
            Tuple of (row_number, row_data) if found, None otherwise

        Raises:
            GoogleSheetsError: If operation fails
        """
        logger.info(f"Searching for POI ID: {poi_id}")

        def _find_poi():
            worksheet = self._get_worksheet()
            try:
                # Find cell with POI ID (assuming ID is in column A)
                cell = worksheet.find(poi_id)
                if cell:
                    row_data = worksheet.row_values(cell.row)
                    logger.info(f"Found POI {poi_id} at row {cell.row}")
                    return cell.row, row_data
                return None
            except Exception:
                logger.info(f"POI {poi_id} not found")
                return None

        return self._retry_operation(_find_poi)

    def batch_update(self, poi_data_list: List[Dict[str, Any]]) -> bool:
        """
        Update multiple POI records in batch for efficiency.

        Args:
            poi_data_list: List of POI data dictionaries

        Returns:
            True if successful

        Raises:
            GoogleSheetsError: If operation fails
            DataValidationError: If data validation fails
        """
        if not poi_data_list:
            logger.warning("No data provided for batch update")
            return True

        logger.info(f"Starting batch update of {len(poi_data_list)} POIs")

        def _batch_update():
            worksheet = self._get_worksheet()
            updates = []

            for poi_data in poi_data_list:
                # Validate and convert data
                row_data = self._validate_poi_data(poi_data)
                poi_id = poi_data['id']

                # Find existing row or prepare for append
                existing = self.find_poi_by_id(poi_id)
                if existing:
                    row_num, _ = existing
                    # Prepare update for existing row
                    range_name = f'A{row_num}:{chr(ord("A") + len(POI_COLUMNS) - 1)}{row_num}'
                    updates.append({
                        'range': range_name,
                        'values': [row_data]
                    })
                    logger.debug(f"Prepared update for POI {poi_id} at row {row_num}")
                else:
                    # Append new row
                    worksheet.append_row(row_data)
                    logger.debug(f"Appended new POI {poi_id}")

            # Execute batch update for existing rows
            if updates:
                worksheet.batch_update(updates)
                logger.info(f"Batch updated {len(updates)} existing POIs")

            return True

        result = self._retry_operation(_batch_update)
        logger.info(f"Batch update completed successfully")
        return result

    def append_pois(self, poi_data_list: List[Dict[str, Any]]) -> bool:
        """
        Append new POI records to the worksheet.

        Args:
            poi_data_list: List of POI data dictionaries

        Returns:
            True if successful

        Raises:
            GoogleSheetsError: If operation fails
            DataValidationError: If data validation fails
        """
        if not poi_data_list:
            logger.warning("No data provided for append")
            return True

        logger.info(f"Appending {len(poi_data_list)} POIs to worksheet")

        def _append_pois():
            worksheet = self._get_worksheet()
            rows = []

            for poi_data in poi_data_list:
                row_data = self._validate_poi_data(poi_data)
                rows.append(row_data)
                logger.debug(f"Prepared row for POI {poi_data.get('id', 'unknown')}")

            # Batch append all rows
            if rows:
                worksheet.append_rows(rows)
                logger.info(f"Appended {len(rows)} rows to worksheet")

            return True

        result = self._retry_operation(_append_pois)
        logger.info("Append operation completed successfully")
        return result

    def clear_worksheet(self, keep_headers: bool = True) -> bool:
        """
        Clear all data from the worksheet.

        Args:
            keep_headers: Whether to preserve header row

        Returns:
            True if successful

        Raises:
            GoogleSheetsError: If operation fails
        """
        logger.warning("Clearing worksheet data")

        def _clear():
            worksheet = self._get_worksheet()
            if keep_headers:
                # Clear from row 2 onwards
                worksheet.batch_clear([f"A2:{chr(ord('A') + len(POI_COLUMNS) - 1)}{worksheet.row_count}"])
            else:
                # Clear everything
                worksheet.clear()
                # Re-add headers if needed
                if keep_headers:
                    worksheet.append_row(POI_COLUMNS)

            return True

        result = self._retry_operation(_clear)
        logger.info("Worksheet cleared successfully")
        return result

    def get_worksheet_info(self) -> Dict[str, Any]:
        """
        Get worksheet metadata and statistics.

        Returns:
            Dictionary with worksheet information

        Raises:
            GoogleSheetsError: If operation fails
        """
        logger.info("Fetching worksheet information")

        def _get_info():
            worksheet = self._get_worksheet()
            spreadsheet = self._spreadsheet or self._client.open_by_key(self.spreadsheet_id)

            all_values = worksheet.get_all_values()
            data_rows = len(all_values) - 1 if all_values else 0  # Exclude header

            return {
                'spreadsheet_title': spreadsheet.title,
                'spreadsheet_id': self.spreadsheet_id,
                'worksheet_title': worksheet.title,
                'worksheet_id': worksheet.id,
                'total_rows': worksheet.row_count,
                'total_cols': worksheet.col_count,
                'data_rows': data_rows,
                'last_updated': spreadsheet.lastUpdateTime,
                'poi_columns': POI_COLUMNS,
                'column_count': len(POI_COLUMNS)
            }

        result = self._retry_operation(_get_info)
        logger.info("Retrieved worksheet information")
        return result

    def health_check(self) -> Dict[str, Union[bool, str]]:
        """
        Perform health check on the connection and permissions.

        Returns:
            Dictionary with health check results
        """
        logger.info("Performing health check")

        health_status = {
            'authenticated': False,
            'spreadsheet_accessible': False,
            'worksheet_accessible': False,
            'read_permission': False,
            'write_permission': False,
            'error_message': None
        }

        try:
            # Test authentication
            if self._client:
                health_status['authenticated'] = True

            # Test spreadsheet access
            spreadsheet = self._client.open_by_key(self.spreadsheet_id)
            health_status['spreadsheet_accessible'] = True

            # Test worksheet access
            worksheet = self._get_worksheet()
            health_status['worksheet_accessible'] = True

            # Test read permission
            worksheet.get_all_values()
            health_status['read_permission'] = True

            # Test write permission (add and remove a test row)
            test_row = ['health_check_test'] + [''] * (len(POI_COLUMNS) - 1)
            worksheet.append_row(test_row)

            # Find and delete the test row
            try:
                cell = worksheet.find('health_check_test')
                if cell:
                    worksheet.delete_rows(cell.row)
            except Exception:
                pass  # Test row not found, which is fine

            health_status['write_permission'] = True
            logger.info("Health check completed successfully")

        except Exception as e:
            error_msg = f"Health check failed: {str(e)}"
            health_status['error_message'] = error_msg
            logger.error(error_msg)

        return health_status

    def __enter__(self):
        """Context manager entry."""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit - cleanup if needed."""
        # Clear cached references
        self._worksheet = None
        self._spreadsheet = None
        if exc_type:
            logger.error(f"Exception in context: {exc_type.__name__}: {exc_val}")


# Convenience functions for common operations
def create_client(**kwargs) -> GoogleSheetsClient:
    """
    Create and return a configured GoogleSheetsClient instance.

    Args:
        **kwargs: Arguments to pass to GoogleSheetsClient constructor

    Returns:
        Configured client instance
    """
    return GoogleSheetsClient(**kwargs)


def quick_health_check() -> bool:
    """
    Perform a quick health check using default configuration.

    Returns:
        True if all checks pass, False otherwise
    """
    try:
        with create_client() as client:
            health = client.health_check()
            return all([
                health['authenticated'],
                health['spreadsheet_accessible'],
                health['worksheet_accessible'],
                health['read_permission'],
                health['write_permission']
            ])
    except Exception as e:
        logger.error(f"Quick health check failed: {e}")
        return False


if __name__ == "__main__":
    # Basic test when run directly
    import os
    os.environ['PYTHONIOENCODING'] = 'utf-8'

    # Configure logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )

    print("Testing Google Sheets Client...")

    try:
        with create_client() as client:
            info = client.get_worksheet_info()
            print(f"[SUCCESS] Connected to: {info['spreadsheet_title']}")
            print(f"[SUCCESS] Worksheet: {info['worksheet_title']}")
            print(f"[SUCCESS] Data rows: {info['data_rows']}")

            health = client.health_check()
            if all([health[key] for key in health if key != 'error_message']):
                print("[SUCCESS] All health checks passed")
            else:
                print(f"[WARNING] Health check issues: {health}")

    except Exception as e:
        print(f"[ERROR] Test failed: {e}")