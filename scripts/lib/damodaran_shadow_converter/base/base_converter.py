"""
Base Converter Class
====================

Abstract base class for all Damodaran dataset converters.
Provides common functionality for downloading, parsing, and saving data.
"""

import json
import logging
import requests
from abc import ABC, abstractmethod
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, Optional

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)


class BaseConverter(ABC):
    """
    Abstract base class for Damodaran dataset converters.

    Subclasses must implement:
    - _download(): Download raw data from source
    - _parse(): Parse downloaded data into structured format
    - _generate_output(): Generate final JSON structure
    """

    def __init__(self, output_dir: Optional[Path] = None):
        """
        Initialize converter.

        Args:
            output_dir: Output directory for JSON files
        """
        self.output_dir = output_dir or Path(__file__).parent.parent / "output"
        self.raw_data: Any = None
        self.parsed_data: Dict[str, Any] = {}

    @property
    @abstractmethod
    def name(self) -> str:
        """Dataset name identifier."""
        pass

    @property
    @abstractmethod
    def source_url(self) -> str:
        """Source URL for the dataset."""
        pass

    @property
    @abstractmethod
    def output_filename(self) -> str:
        """Output JSON filename."""
        pass

    def download(self, timeout: int = 60) -> Any:
        """
        Download data from source URL.

        Args:
            timeout: Request timeout in seconds

        Returns:
            Raw downloaded data
        """
        logger.info(f"Downloading from {self.source_url}...")

        response = requests.get(self.source_url, timeout=timeout)
        response.raise_for_status()

        logger.info(f"Downloaded {len(response.content) / 1024:.1f} KB")
        self.raw_data = response.content
        return self.raw_data

    @abstractmethod
    def _parse(self) -> Dict[str, Any]:
        """
        Parse downloaded data into structured format.

        Must be implemented by subclasses.

        Returns:
            Parsed data dictionary
        """
        pass

    @abstractmethod
    def _generate_output(self) -> Dict[str, Any]:
        """
        Generate final JSON output structure.

        Must be implemented by subclasses.

        Returns:
            Final JSON structure with metadata
        """
        pass

    def parse(self) -> Dict[str, Any]:
        """
        Parse data (downloads first if needed).

        Returns:
            Parsed data dictionary
        """
        if self.raw_data is None:
            self.download()

        logger.info(f"Parsing {self.name}...")
        self.parsed_data = self._parse()
        logger.info(f"Parsed {len(self.parsed_data)} records")

        return self.parsed_data

    def to_json(self, output_path: Optional[Path] = None) -> Path:
        """
        Save data to JSON file.

        Args:
            output_path: Custom output path (optional)

        Returns:
            Path to saved file
        """
        if not self.parsed_data:
            self.parse()

        # Determine output path
        if output_path is None:
            self.output_dir.mkdir(parents=True, exist_ok=True)
            output_path = self.output_dir / self.output_filename

        # Generate output structure
        output = self._generate_output()

        # Save JSON
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(output, f, indent=2, ensure_ascii=False)

        file_size = output_path.stat().st_size / 1024
        logger.info(f"Saved to: {output_path} ({file_size:.1f} KB)")

        return output_path

    def convert(self, output_path: Optional[Path] = None) -> Path:
        """
        Full conversion pipeline: download -> parse -> save.

        Args:
            output_path: Custom output path (optional)

        Returns:
            Path to saved file
        """
        self.download()
        self.parse()
        return self.to_json(output_path)


class ExcelConverter(BaseConverter):
    """
    Base class for Excel-based converters (xlsx, xls).

    Uses openpyxl for parsing.
    """

    def __init__(self, output_dir: Optional[Path] = None):
        super().__init__(output_dir)
        self._workbook = None

    def download(self, timeout: int = 60) -> bytes:
        """Download Excel file."""
        result = super().download(timeout)
        return result

    def _get_workbook(self):
        """Load workbook from downloaded data."""
        if self._workbook is None:
            try:
                import openpyxl
            except ImportError:
                raise ImportError("openpyxl required: pip install openpyxl")

            self._workbook = openpyxl.load_workbook(
                BytesIO(self.raw_data),
                data_only=True
            )
        return self._workbook

    @property
    def workbook(self):
        """Get openpyxl workbook object."""
        return self._get_workbook()


class HTMLTableConverter(BaseConverter):
    """
    Base class for HTML table converters.

    Uses pandas.read_html for parsing.
    """

    def download(self, timeout: int = 60) -> str:
        """Download HTML content."""
        result = super().download(timeout)
        # Decode bytes to string
        self.raw_data = result.decode('utf-8')
        return self.raw_data

    def _get_tables(self):
        """Parse HTML tables from downloaded content."""
        try:
            import pandas as pd
        except ImportError:
            raise ImportError("pandas required: pip install pandas")

        tables = pd.read_html(self.source_url)
        if not tables:
            raise ValueError(f"No tables found at {self.source_url}")

        return tables
