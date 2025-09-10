"""
Miyakojima POI Expansion System

Production-ready data transformation system for expanding POI database
from 25 to 175 points of interest while maintaining data integrity
and providing comprehensive backup/recovery capabilities.

Core Components:
- POIDataManager: CRUD operations with validation
- ExpansionEngine: Phased expansion logic
- QualityValidator: Data integrity and quality assurance
- BackupManager: Automated backup/recovery system
- ConfigManager: Environment and configuration management

Author: Claude Code
Version: 1.0.0
"""

__version__ = "1.0.0"
__author__ = "Claude Code"

# Core exports
from .data_manager import POIDataManager
from .expansion_engine import ExpansionEngine
from .quality_validator import QualityValidator
from .backup_manager import BackupManager
from .config_manager import ConfigManager

__all__ = [
    "POIDataManager",
    "ExpansionEngine", 
    "QualityValidator",
    "BackupManager",
    "ConfigManager"
]