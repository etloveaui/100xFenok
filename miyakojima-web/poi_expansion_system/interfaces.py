"""
Interface definitions for POI expansion system following SOLID principles.

Implements Interface Segregation Principle by providing client-specific interfaces
and Dependency Inversion Principle by defining abstractions for concrete implementations.
"""

from abc import ABC, abstractmethod
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass
from enum import Enum


class ExpansionPhase(Enum):
    """Expansion phases for POI database growth."""
    PHASE_1 = "25_to_50"
    PHASE_2 = "50_to_100"
    PHASE_3 = "100_to_175"


@dataclass
class POIRecord:
    """Standardized POI record structure."""
    id: str
    name: str
    name_en: str
    category: str
    rating: float
    coordinates: Dict[str, float]
    description: str
    features: List[str]
    open_hours: str
    estimated_time: str
    cost: Dict[str, Any]
    tips: str
    accessibility: str
    weather: Dict[str, str]


@dataclass
class ValidationResult:
    """Validation result container."""
    is_valid: bool
    errors: List[str]
    warnings: List[str]
    metadata: Dict[str, Any]


@dataclass
class BackupMetadata:
    """Backup metadata container."""
    timestamp: str
    phase: str
    poi_count: int
    checksum: str
    file_path: str


class IDataValidator(ABC):
    """Interface for data validation operations."""
    
    @abstractmethod
    def validate_poi_record(self, poi: POIRecord) -> ValidationResult:
        """Validate a single POI record."""
        pass
    
    @abstractmethod
    def validate_coordinates(self, lat: float, lng: float) -> bool:
        """Validate coordinates are within Miyakojima region."""
        pass
    
    @abstractmethod
    def validate_category(self, category: str) -> bool:
        """Validate POI category is allowed."""
        pass


class IDataStorage(ABC):
    """Interface for data storage operations."""
    
    @abstractmethod
    def load_pois(self, file_path: str) -> List[POIRecord]:
        """Load POI records from storage."""
        pass
    
    @abstractmethod
    def save_pois(self, pois: List[POIRecord], file_path: str) -> bool:
        """Save POI records to storage."""
        pass
    
    @abstractmethod
    def backup_data(self, source_path: str, backup_path: str) -> BackupMetadata:
        """Create data backup."""
        pass


class IExpansionStrategy(ABC):
    """Interface for expansion strategy implementations."""
    
    @abstractmethod
    def select_candidates(self, 
                         source_data: List[POIRecord], 
                         current_data: List[POIRecord],
                         target_count: int) -> List[POIRecord]:
        """Select POI candidates for expansion phase."""
        pass
    
    @abstractmethod
    def balance_categories(self, candidates: List[POIRecord]) -> List[POIRecord]:
        """Balance POI distribution across categories."""
        pass


class IBackupManager(ABC):
    """Interface for backup and recovery operations."""
    
    @abstractmethod
    def create_checkpoint(self, phase: ExpansionPhase) -> BackupMetadata:
        """Create checkpoint before expansion."""
        pass
    
    @abstractmethod
    def restore_checkpoint(self, backup_id: str) -> bool:
        """Restore from checkpoint."""
        pass
    
    @abstractmethod
    def list_backups(self) -> List[BackupMetadata]:
        """List available backups."""
        pass


class IConfigManager(ABC):
    """Interface for configuration management."""
    
    @abstractmethod
    def get_config(self, key: str, default: Any = None) -> Any:
        """Get configuration value."""
        pass
    
    @abstractmethod
    def set_config(self, key: str, value: Any) -> None:
        """Set configuration value."""
        pass
    
    @abstractmethod
    def validate_config(self) -> ValidationResult:
        """Validate current configuration."""
        pass


class ILogger(ABC):
    """Interface for logging operations."""
    
    @abstractmethod
    def info(self, message: str, **kwargs) -> None:
        """Log info message."""
        pass
    
    @abstractmethod
    def warning(self, message: str, **kwargs) -> None:
        """Log warning message."""
        pass
    
    @abstractmethod
    def error(self, message: str, **kwargs) -> None:
        """Log error message."""
        pass
    
    @abstractmethod
    def debug(self, message: str, **kwargs) -> None:
        """Log debug message."""
        pass