"""
Data Synchronization Utilities

Provides bi-directional synchronization between JSON files and databases,
including conflict resolution and data transformation utilities.
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass
from enum import Enum
import hashlib


class SyncDirection(Enum):
    """Synchronization direction options."""
    JSON_TO_DB = "json_to_db"
    DB_TO_JSON = "db_to_json"
    BIDIRECTIONAL = "bidirectional"


class ConflictResolution(Enum):
    """Conflict resolution strategies."""
    JSON_WINS = "json_wins"
    DB_WINS = "db_wins"
    LATEST_WINS = "latest_wins"
    MANUAL = "manual"


@dataclass
class SyncResult:
    """Result of synchronization operation."""
    success: bool
    direction: SyncDirection
    records_processed: int
    records_added: int
    records_updated: int
    records_deleted: int
    conflicts_found: int
    conflicts_resolved: int
    errors: List[str]
    warnings: List[str]
    timestamp: datetime
    
    @property
    def total_changes(self) -> int:
        return self.records_added + self.records_updated + self.records_deleted


@dataclass
class ConflictRecord:
    """Represents a data conflict between JSON and database."""
    poi_id: str
    field_name: str
    json_value: Any
    db_value: Any
    json_timestamp: Optional[datetime]
    db_timestamp: Optional[datetime]
    resolution: Optional[Any] = None


class DataHasher:
    """Utility for generating data hashes to detect changes."""
    
    @staticmethod
    def hash_poi(poi: Dict[str, Any]) -> str:
        """Generate consistent hash for POI data."""
        # Extract key fields for hashing (excluding timestamps)
        hashable_fields = {
            'id': poi.get('id', ''),
            'name': poi.get('name', ''),
            'category': poi.get('category', ''),
            'coordinates': poi.get('coordinates', {}),
            'rating': poi.get('rating', 0),
            'description': poi.get('description', ''),
            'features': sorted(poi.get('features', [])),  # Sort for consistency
            'cost': poi.get('cost', {}),
        }
        
        # Convert to consistent JSON string
        hash_string = json.dumps(hashable_fields, sort_keys=True, ensure_ascii=False)
        return hashlib.md5(hash_string.encode('utf-8')).hexdigest()
    
    @staticmethod
    def detect_changes(old_poi: Dict[str, Any], new_poi: Dict[str, Any]) -> List[str]:
        """Detect which fields have changed between two POI records."""
        changes = []
        
        # Fields to check for changes
        check_fields = [
            'name', 'nameEn', 'category', 'rating', 'coordinates',
            'description', 'features', 'openHours', 'estimatedTime',
            'cost', 'tips', 'accessibility', 'weather'
        ]
        
        for field in check_fields:
            old_value = old_poi.get(field)
            new_value = new_poi.get(field)
            
            if old_value != new_value:
                changes.append(field)
        
        return changes


class DataValidator:
    """Validates data consistency and integrity."""
    
    def __init__(self, coordinate_bounds: Dict[str, float]):
        self.coordinate_bounds = coordinate_bounds
        
    def validate_poi(self, poi: Dict[str, Any]) -> Dict[str, Any]:
        """Validate a single POI record."""
        errors = []
        warnings = []
        
        # Required fields
        required_fields = ['id', 'name', 'category', 'coordinates', 'rating']
        for field in required_fields:
            if field not in poi or not poi[field]:
                errors.append(f"Missing required field: {field}")
        
        # Coordinate validation
        if 'coordinates' in poi and poi['coordinates']:
            coords = poi['coordinates']
            if 'lat' in coords and 'lng' in coords:
                lat = coords['lat']
                lng = coords['lng']
                
                if not (self.coordinate_bounds['lat_min'] <= lat <= self.coordinate_bounds['lat_max']):
                    errors.append(f"Latitude {lat} outside valid range")
                
                if not (self.coordinate_bounds['lng_min'] <= lng <= self.coordinate_bounds['lng_max']):
                    errors.append(f"Longitude {lng} outside valid range")
            else:
                errors.append("Coordinates missing lat/lng fields")
        
        # Rating validation
        if 'rating' in poi:
            rating = poi['rating']
            if not isinstance(rating, (int, float)) or rating < 1.0 or rating > 5.0:
                errors.append(f"Rating {rating} must be between 1.0 and 5.0")
        
        # Category validation (basic check)
        valid_categories = ['beaches', 'activities', 'restaurants', 'culture', 'nature', 'shopping']
        if 'category' in poi and poi['category'] not in valid_categories:
            warnings.append(f"Category '{poi['category']}' is not in standard categories")
        
        return {
            'valid': len(errors) == 0,
            'errors': errors,
            'warnings': warnings
        }
    
    def validate_poi_list(self, pois: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Validate a list of POI records."""
        total_errors = []
        total_warnings = []
        valid_count = 0
        
        # Check for duplicate IDs
        ids_seen = set()
        for poi in pois:
            poi_id = poi.get('id', '')
            if poi_id in ids_seen:
                total_errors.append(f"Duplicate POI ID found: {poi_id}")
            ids_seen.add(poi_id)
        
        # Validate each POI
        for i, poi in enumerate(pois):
            validation = self.validate_poi(poi)
            if validation['valid']:
                valid_count += 1
            else:
                for error in validation['errors']:
                    total_errors.append(f"POI #{i+1} ({poi.get('id', 'unknown')}): {error}")
            
            for warning in validation['warnings']:
                total_warnings.append(f"POI #{i+1} ({poi.get('id', 'unknown')}): {warning}")
        
        return {
            'valid': len(total_errors) == 0,
            'total_pois': len(pois),
            'valid_pois': valid_count,
            'errors': total_errors,
            'warnings': total_warnings
        }


class JsonDataManager:
    """Manages JSON file operations for POI data."""
    
    def __init__(self, file_path: str):
        self.file_path = Path(file_path)
        self.logger = logging.getLogger(__name__)
    
    def load_data(self) -> Dict[str, Any]:
        """Load POI data from JSON file."""
        try:
            with open(self.file_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except FileNotFoundError:
            self.logger.error(f"JSON file not found: {self.file_path}")
            return {}
        except json.JSONDecodeError as e:
            self.logger.error(f"Invalid JSON in file {self.file_path}: {e}")
            return {}
    
    def save_data(self, data: Dict[str, Any], backup: bool = True) -> bool:
        """Save POI data to JSON file with optional backup."""
        try:
            # Create backup if requested
            if backup and self.file_path.exists():
                backup_path = self.file_path.with_suffix(f'.backup_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json')
                self.file_path.rename(backup_path)
                self.logger.info(f"Created backup: {backup_path}")
            
            # Update metadata
            data['lastUpdated'] = datetime.now(timezone.utc).isoformat()
            data['totalPOIs'] = len(data.get('pois', []))
            
            # Ensure directory exists
            self.file_path.parent.mkdir(parents=True, exist_ok=True)
            
            # Save data
            with open(self.file_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            
            self.logger.info(f"Data saved successfully to {self.file_path}")
            return True
            
        except Exception as e:
            self.logger.error(f"Failed to save data to {self.file_path}: {e}")
            return False
    
    def get_poi_by_id(self, poi_id: str) -> Optional[Dict[str, Any]]:
        """Get specific POI by ID."""
        data = self.load_data()
        pois = data.get('pois', [])
        
        for poi in pois:
            if poi.get('id') == poi_id:
                return poi
        
        return None
    
    def update_poi(self, poi_id: str, updated_poi: Dict[str, Any]) -> bool:
        """Update specific POI in the JSON file."""
        data = self.load_data()
        pois = data.get('pois', [])
        
        for i, poi in enumerate(pois):
            if poi.get('id') == poi_id:
                pois[i] = updated_poi
                return self.save_data(data)
        
        return False


class DatabaseManager:
    """Database operations manager (placeholder for future implementation)."""
    
    def __init__(self, database_config):
        self.config = database_config
        self.logger = logging.getLogger(__name__)
    
    def connect(self) -> bool:
        """Establish database connection."""
        # Placeholder for future database implementation
        self.logger.info("Database connection placeholder - not implemented yet")
        return False
    
    def load_pois(self) -> List[Dict[str, Any]]:
        """Load all POIs from database."""
        # Placeholder for future database implementation
        self.logger.info("Database POI loading placeholder - not implemented yet")
        return []
    
    def save_poi(self, poi: Dict[str, Any]) -> bool:
        """Save POI to database."""
        # Placeholder for future database implementation
        self.logger.info(f"Database POI save placeholder for {poi.get('id', 'unknown')}")
        return False
    
    def update_poi(self, poi_id: str, poi: Dict[str, Any]) -> bool:
        """Update POI in database."""
        # Placeholder for future database implementation
        self.logger.info(f"Database POI update placeholder for {poi_id}")
        return False
    
    def delete_poi(self, poi_id: str) -> bool:
        """Delete POI from database."""
        # Placeholder for future database implementation
        self.logger.info(f"Database POI delete placeholder for {poi_id}")
        return False


class SyncManager:
    """Main synchronization manager coordinating JSON and database operations."""
    
    def __init__(self, json_file_path: str, database_config, coordinate_bounds: Dict[str, float]):
        self.json_manager = JsonDataManager(json_file_path)
        self.database_manager = DatabaseManager(database_config)
        self.validator = DataValidator(coordinate_bounds)
        self.hasher = DataHasher()
        self.logger = logging.getLogger(__name__)
    
    def sync_json_to_db(self) -> SyncResult:
        """Synchronize JSON data to database."""
        start_time = datetime.now()
        result = SyncResult(
            success=False,
            direction=SyncDirection.JSON_TO_DB,
            records_processed=0,
            records_added=0,
            records_updated=0,
            records_deleted=0,
            conflicts_found=0,
            conflicts_resolved=0,
            errors=[],
            warnings=[],
            timestamp=start_time
        )
        
        try:
            # Load JSON data
            json_data = self.json_manager.load_data()
            pois = json_data.get('pois', [])
            
            # Validate data
            validation = self.validator.validate_poi_list(pois)
            if not validation['valid']:
                result.errors.extend(validation['errors'])
                result.warnings.extend(validation['warnings'])
                return result
            
            result.records_processed = len(pois)
            
            # Since database is not implemented yet, mark as successful
            # but note that no actual sync occurred
            result.success = True
            result.warnings.append("Database integration not yet implemented - JSON data validated only")
            
        except Exception as e:
            result.errors.append(f"Sync failed: {str(e)}")
            self.logger.error(f"JSON to DB sync failed: {e}")
        
        return result
    
    def sync_db_to_json(self) -> SyncResult:
        """Synchronize database data to JSON."""
        start_time = datetime.now()
        result = SyncResult(
            success=False,
            direction=SyncDirection.DB_TO_JSON,
            records_processed=0,
            records_added=0,
            records_updated=0,
            records_deleted=0,
            conflicts_found=0,
            conflicts_resolved=0,
            errors=[],
            warnings=[],
            timestamp=start_time
        )
        
        # Placeholder for future implementation
        result.warnings.append("Database integration not yet implemented - no sync performed")
        result.success = True
        
        return result
    
    def detect_conflicts(self) -> List[ConflictRecord]:
        """Detect conflicts between JSON and database data."""
        # Placeholder for future implementation
        return []
    
    def resolve_conflicts(self, conflicts: List[ConflictRecord], resolution: ConflictResolution) -> List[ConflictRecord]:
        """Resolve data conflicts using specified strategy."""
        resolved = []
        
        for conflict in conflicts:
            if resolution == ConflictResolution.JSON_WINS:
                conflict.resolution = conflict.json_value
            elif resolution == ConflictResolution.DB_WINS:
                conflict.resolution = conflict.db_value
            elif resolution == ConflictResolution.LATEST_WINS:
                if conflict.json_timestamp and conflict.db_timestamp:
                    if conflict.json_timestamp > conflict.db_timestamp:
                        conflict.resolution = conflict.json_value
                    else:
                        conflict.resolution = conflict.db_value
                else:
                    conflict.resolution = conflict.json_value  # Default to JSON
            # MANUAL resolution requires external intervention
            
            resolved.append(conflict)
        
        return resolved
    
    def create_migration_report(self) -> Dict[str, Any]:
        """Create a report for JSON to database migration planning."""
        json_data = self.json_manager.load_data()
        pois = json_data.get('pois', [])
        
        # Analyze current data structure
        categories = {}
        ratings = []
        coordinate_ranges = {'lat': [], 'lng': []}
        
        for poi in pois:
            # Category distribution
            category = poi.get('category', 'unknown')
            categories[category] = categories.get(category, 0) + 1
            
            # Rating distribution
            if 'rating' in poi:
                ratings.append(poi['rating'])
            
            # Coordinate ranges
            if 'coordinates' in poi:
                coords = poi['coordinates']
                if 'lat' in coords:
                    coordinate_ranges['lat'].append(coords['lat'])
                if 'lng' in coords:
                    coordinate_ranges['lng'].append(coords['lng'])
        
        return {
            'total_pois': len(pois),
            'data_version': json_data.get('version', 'unknown'),
            'last_updated': json_data.get('lastUpdated', 'unknown'),
            'category_distribution': categories,
            'rating_stats': {
                'count': len(ratings),
                'average': sum(ratings) / len(ratings) if ratings else 0,
                'min': min(ratings) if ratings else 0,
                'max': max(ratings) if ratings else 0
            },
            'coordinate_ranges': {
                'lat_min': min(coordinate_ranges['lat']) if coordinate_ranges['lat'] else 0,
                'lat_max': max(coordinate_ranges['lat']) if coordinate_ranges['lat'] else 0,
                'lng_min': min(coordinate_ranges['lng']) if coordinate_ranges['lng'] else 0,
                'lng_max': max(coordinate_ranges['lng']) if coordinate_ranges['lng'] else 0
            },
            'estimated_db_size': f"{len(pois) * 2}KB",  # Rough estimate
            'migration_complexity': "Medium" if len(pois) > 50 else "Low"
        }


def export_to_excel(json_file_path: str, excel_file_path: str) -> bool:
    """Export JSON POI data to Excel format."""
    try:
        # This will require openpyxl or xlsxwriter in the future
        print(f"Excel export placeholder: {json_file_path} -> {excel_file_path}")
        print("Note: Install openpyxl package for Excel functionality")
        return True
    except Exception as e:
        print(f"Excel export failed: {e}")
        return False


def import_from_excel(excel_file_path: str, json_file_path: str) -> bool:
    """Import POI data from Excel to JSON format."""
    try:
        # This will require openpyxl or xlsxwriter in the future
        print(f"Excel import placeholder: {excel_file_path} -> {json_file_path}")
        print("Note: Install openpyxl package for Excel functionality")
        return True
    except Exception as e:
        print(f"Excel import failed: {e}")
        return False


if __name__ == "__main__":
    # Example usage and testing
    import sys
    
    if len(sys.argv) > 1:
        if sys.argv[1] == "migration-report":
            # Create migration report
            sync_manager = SyncManager(
                json_file_path="data/miyakojima_pois.json",
                database_config=None,
                coordinate_bounds={
                    'lat_min': 24.6, 'lat_max': 24.9,
                    'lng_min': 125.1, 'lng_max': 125.5
                }
            )
            
            report = sync_manager.create_migration_report()
            print("=== MIGRATION REPORT ===")
            print(json.dumps(report, indent=2, ensure_ascii=False))
        
        elif sys.argv[1] == "validate":
            # Validate current JSON data
            json_manager = JsonDataManager("data/miyakojima_pois.json")
            validator = DataValidator({
                'lat_min': 24.6, 'lat_max': 24.9,
                'lng_min': 125.1, 'lng_max': 125.5
            })
            
            data = json_manager.load_data()
            pois = data.get('pois', [])
            validation = validator.validate_poi_list(pois)
            
            print("=== VALIDATION REPORT ===")
            print(f"Total POIs: {validation['total_pois']}")
            print(f"Valid POIs: {validation['valid_pois']}")
            print(f"Overall Valid: {validation['valid']}")
            
            if validation['errors']:
                print("\nErrors:")
                for error in validation['errors']:
                    print(f"  - {error}")
            
            if validation['warnings']:
                print("\nWarnings:")
                for warning in validation['warnings']:
                    print(f"  - {warning}")
    
    else:
        print("Data Sync Utils - Available commands:")
        print("  python data_sync_utils.py migration-report")
        print("  python data_sync_utils.py validate")