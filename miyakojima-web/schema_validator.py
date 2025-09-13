"""
Universal Schema Validator

Provides validation that works with both JSON files and database records,
ensuring data consistency across different storage backends.
"""

import json
import re
from datetime import datetime
from typing import Dict, List, Any, Optional, Union, Tuple
from dataclasses import dataclass
from enum import Enum
import logging


class ValidationLevel(Enum):
    """Validation strictness levels."""
    STRICT = "strict"      # All rules enforced, no warnings allowed
    NORMAL = "normal"      # Standard validation with warnings
    LENIENT = "lenient"    # Basic validation only


class ValidationResult:
    """Container for validation results."""
    
    def __init__(self, valid: bool = True, errors: List[str] = None, warnings: List[str] = None):
        self.valid = valid
        self.errors = errors or []
        self.warnings = warnings or []
        self.details = {}
    
    def add_error(self, message: str, field: str = None):
        """Add validation error."""
        self.valid = False
        if field:
            message = f"{field}: {message}"
        self.errors.append(message)
    
    def add_warning(self, message: str, field: str = None):
        """Add validation warning."""
        if field:
            message = f"{field}: {message}"
        self.warnings.append(message)
    
    def merge(self, other: 'ValidationResult'):
        """Merge another validation result into this one."""
        if not other.valid:
            self.valid = False
        self.errors.extend(other.errors)
        self.warnings.extend(other.warnings)
        self.details.update(other.details)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary representation."""
        return {
            'valid': self.valid,
            'error_count': len(self.errors),
            'warning_count': len(self.warnings),
            'errors': self.errors,
            'warnings': self.warnings,
            'details': self.details
        }


class FieldValidator:
    """Individual field validation logic."""
    
    def __init__(self, coordinate_bounds: Dict[str, float]):
        self.coordinate_bounds = coordinate_bounds
        self.logger = logging.getLogger(__name__)
    
    def validate_id(self, value: Any) -> ValidationResult:
        """Validate POI ID field."""
        result = ValidationResult()
        
        if not value:
            result.add_error("ID is required")
            return result
        
        if not isinstance(value, str):
            result.add_error("ID must be a string")
            return result
        
        # ID format validation
        if not re.match(r'^[a-zA-Z0-9_-]+$', value):
            result.add_error("ID must contain only alphanumeric characters, underscores, and hyphens")
        
        if len(value) < 3:
            result.add_error("ID must be at least 3 characters long")
        
        if len(value) > 50:
            result.add_error("ID must not exceed 50 characters")
        
        return result
    
    def validate_name(self, value: Any) -> ValidationResult:
        """Validate name field."""
        result = ValidationResult()
        
        if not value:
            result.add_error("Name is required")
            return result
        
        if not isinstance(value, str):
            result.add_error("Name must be a string")
            return result
        
        value = value.strip()
        if len(value) < 2:
            result.add_error("Name must be at least 2 characters long")
        
        if len(value) > 100:
            result.add_error("Name must not exceed 100 characters")
        
        return result
    
    def validate_category(self, value: Any, valid_categories: List[str] = None) -> ValidationResult:
        """Validate category field."""
        result = ValidationResult()
        
        if not value:
            result.add_error("Category is required")
            return result
        
        if not isinstance(value, str):
            result.add_error("Category must be a string")
            return result
        
        # Default valid categories
        if valid_categories is None:
            valid_categories = [
                'beaches', 'activities', 'restaurants', 
                'culture', 'nature', 'shopping'
            ]
        
        if value not in valid_categories:
            result.add_warning(f"Category '{value}' is not in standard categories: {', '.join(valid_categories)}")
        
        return result
    
    def validate_rating(self, value: Any) -> ValidationResult:
        """Validate rating field."""
        result = ValidationResult()
        
        if value is None:
            result.add_error("Rating is required")
            return result
        
        if not isinstance(value, (int, float)):
            result.add_error("Rating must be a number")
            return result
        
        if value < 1.0 or value > 5.0:
            result.add_error("Rating must be between 1.0 and 5.0")
        
        # Check for reasonable precision
        if isinstance(value, float) and len(str(value).split('.')[-1]) > 1:
            result.add_warning("Rating should have at most 1 decimal place")
        
        return result
    
    def validate_coordinates(self, value: Any) -> ValidationResult:
        """Validate coordinates field."""
        result = ValidationResult()
        
        if not value:
            result.add_error("Coordinates are required")
            return result
        
        if not isinstance(value, dict):
            result.add_error("Coordinates must be an object")
            return result
        
        # Required coordinate fields
        if 'lat' not in value:
            result.add_error("Coordinates missing 'lat' field")
        if 'lng' not in value:
            result.add_error("Coordinates missing 'lng' field")
        
        if result.errors:
            return result
        
        # Validate latitude
        lat = value['lat']
        if not isinstance(lat, (int, float)):
            result.add_error("Latitude must be a number")
        else:
            if lat < -90 or lat > 90:
                result.add_error("Latitude must be between -90 and 90")
            elif not (self.coordinate_bounds['lat_min'] <= lat <= self.coordinate_bounds['lat_max']):
                result.add_error(f"Latitude {lat} is outside Miyakojima bounds ({self.coordinate_bounds['lat_min']} to {self.coordinate_bounds['lat_max']})")
        
        # Validate longitude
        lng = value['lng']
        if not isinstance(lng, (int, float)):
            result.add_error("Longitude must be a number")
        else:
            if lng < -180 or lng > 180:
                result.add_error("Longitude must be between -180 and 180")
            elif not (self.coordinate_bounds['lng_min'] <= lng <= self.coordinate_bounds['lng_max']):
                result.add_error(f"Longitude {lng} is outside Miyakojima bounds ({self.coordinate_bounds['lng_min']} to {self.coordinate_bounds['lng_max']})")
        
        return result
    
    def validate_description(self, value: Any) -> ValidationResult:
        """Validate description field."""
        result = ValidationResult()
        
        if value is not None:
            if not isinstance(value, str):
                result.add_error("Description must be a string")
            elif len(value.strip()) == 0:
                result.add_warning("Description is empty")
            elif len(value) > 500:
                result.add_warning("Description is quite long (>500 characters)")
        
        return result
    
    def validate_features(self, value: Any) -> ValidationResult:
        """Validate features array field."""
        result = ValidationResult()
        
        if value is not None:
            if not isinstance(value, list):
                result.add_error("Features must be an array")
            else:
                for i, feature in enumerate(value):
                    if not isinstance(feature, str):
                        result.add_error(f"Feature {i+1} must be a string")
                    elif len(feature.strip()) == 0:
                        result.add_warning(f"Feature {i+1} is empty")
        
        return result
    
    def validate_cost(self, value: Any) -> ValidationResult:
        """Validate cost object field."""
        result = ValidationResult()
        
        if value is not None:
            if not isinstance(value, dict):
                result.add_error("Cost must be an object")
            else:
                # Validate cost fields
                if 'min' in value and not isinstance(value['min'], (int, float)):
                    result.add_error("Cost min must be a number")
                if 'max' in value and not isinstance(value['max'], (int, float)):
                    result.add_error("Cost max must be a number")
                
                if 'min' in value and 'max' in value:
                    if value['min'] > value['max']:
                        result.add_error("Cost min cannot be greater than max")
                
                if 'currency' in value and not isinstance(value['currency'], str):
                    result.add_error("Cost currency must be a string")
        
        return result
    
    def validate_open_hours(self, value: Any) -> ValidationResult:
        """Validate open hours field."""
        result = ValidationResult()
        
        if value is not None:
            if not isinstance(value, str):
                result.add_error("Open hours must be a string")
            elif len(value.strip()) == 0:
                result.add_warning("Open hours field is empty")
        
        return result
    
    def validate_estimated_time(self, value: Any) -> ValidationResult:
        """Validate estimated time field."""
        result = ValidationResult()
        
        if value is not None:
            if not isinstance(value, str):
                result.add_error("Estimated time must be a string")
            elif len(value.strip()) == 0:
                result.add_warning("Estimated time field is empty")
        
        return result


class POIValidator:
    """Main POI validation class."""
    
    def __init__(self, 
                 coordinate_bounds: Dict[str, float],
                 valid_categories: List[str] = None,
                 validation_level: ValidationLevel = ValidationLevel.NORMAL):
        self.coordinate_bounds = coordinate_bounds
        self.valid_categories = valid_categories or [
            'beaches', 'activities', 'restaurants', 
            'culture', 'nature', 'shopping'
        ]
        self.validation_level = validation_level
        self.field_validator = FieldValidator(coordinate_bounds)
        self.logger = logging.getLogger(__name__)
    
    def validate_poi(self, poi: Dict[str, Any], context: str = "") -> ValidationResult:
        """Validate a single POI record."""
        result = ValidationResult()
        
        if context:
            result.details['context'] = context
        
        # Required fields validation
        required_fields = ['id', 'name', 'category', 'coordinates', 'rating']
        for field in required_fields:
            if field not in poi:
                result.add_error(f"Missing required field", field)
        
        # If critical fields are missing, return early
        if result.errors:
            return result
        
        # Validate individual fields
        field_validations = [
            ('id', self.field_validator.validate_id(poi.get('id'))),
            ('name', self.field_validator.validate_name(poi.get('name'))),
            ('category', self.field_validator.validate_category(poi.get('category'), self.valid_categories)),
            ('rating', self.field_validator.validate_rating(poi.get('rating'))),
            ('coordinates', self.field_validator.validate_coordinates(poi.get('coordinates'))),
            ('description', self.field_validator.validate_description(poi.get('description'))),
            ('features', self.field_validator.validate_features(poi.get('features'))),
            ('cost', self.field_validator.validate_cost(poi.get('cost'))),
            ('openHours', self.field_validator.validate_open_hours(poi.get('openHours'))),
            ('estimatedTime', self.field_validator.validate_estimated_time(poi.get('estimatedTime'))),
        ]
        
        for field_name, field_result in field_validations:
            if not field_result.valid:
                for error in field_result.errors:
                    result.add_error(error, field_name)
            for warning in field_result.warnings:
                result.add_warning(warning, field_name)
        
        # Apply validation level filtering
        if self.validation_level == ValidationLevel.LENIENT:
            # In lenient mode, convert some errors to warnings
            lenient_errors = []
            for error in result.errors:
                if any(keyword in error.lower() for keyword in ['warning', 'empty', 'long']):
                    result.add_warning(error)
                else:
                    lenient_errors.append(error)
            result.errors = lenient_errors
            result.valid = len(result.errors) == 0
        
        elif self.validation_level == ValidationLevel.STRICT:
            # In strict mode, warnings become errors
            if result.warnings:
                result.errors.extend(result.warnings)
                result.warnings = []
                result.valid = False
        
        return result
    
    def validate_poi_list(self, pois: List[Dict[str, Any]], context: str = "") -> ValidationResult:
        """Validate a list of POI records."""
        result = ValidationResult()
        
        if context:
            result.details['context'] = context
        
        result.details['total_pois'] = len(pois)
        result.details['valid_pois'] = 0
        
        # Check for duplicate IDs
        ids_seen = set()
        duplicate_ids = set()
        
        for poi in pois:
            poi_id = poi.get('id', '')
            if poi_id in ids_seen:
                duplicate_ids.add(poi_id)
            ids_seen.add(poi_id)
        
        for duplicate_id in duplicate_ids:
            result.add_error(f"Duplicate POI ID found: {duplicate_id}")
        
        # Validate each POI
        category_counts = {}
        coordinate_issues = 0
        
        for i, poi in enumerate(pois):
            poi_context = f"POI #{i+1} ({poi.get('id', 'unknown')})"
            poi_result = self.validate_poi(poi, poi_context)
            
            # Count categories
            category = poi.get('category', 'unknown')
            category_counts[category] = category_counts.get(category, 0) + 1
            
            # Track coordinate issues
            if 'coordinates' in poi_result.errors:
                coordinate_issues += 1
            
            if poi_result.valid:
                result.details['valid_pois'] += 1
            else:
                for error in poi_result.errors:
                    result.add_error(error, poi_context)
            
            for warning in poi_result.warnings:
                result.add_warning(warning, poi_context)
        
        # Category balance analysis
        result.details['category_distribution'] = category_counts
        total_pois = len(pois)
        expected_per_category = total_pois / len(self.valid_categories)
        
        for category in self.valid_categories:
            count = category_counts.get(category, 0)
            if count == 0:
                result.add_warning(f"No POIs found in category: {category}")
            elif count < expected_per_category * 0.3:  # Less than 30% of expected
                result.add_warning(f"Very few POIs in category {category}: {count}")
        
        # Coordinate validation summary
        result.details['coordinate_issues'] = coordinate_issues
        if coordinate_issues > 0:
            result.add_error(f"{coordinate_issues} POIs have coordinate validation issues")
        
        return result
    
    def validate_database_schema(self, poi: Dict[str, Any]) -> ValidationResult:
        """Validate POI data for database storage compatibility."""
        result = self.validate_poi(poi)
        
        # Additional database-specific validations
        # Check for SQL injection patterns
        string_fields = ['name', 'nameEn', 'description', 'openHours', 'estimatedTime', 'tips', 'accessibility']
        
        for field in string_fields:
            if field in poi and isinstance(poi[field], str):
                value = poi[field].lower()
                sql_patterns = ['drop table', 'delete from', 'insert into', 'update set', 'union select', '--', ';']
                if any(pattern in value for pattern in sql_patterns):
                    result.add_error(f"Potential SQL injection pattern detected in {field}")
        
        # Check field lengths for database constraints
        field_limits = {
            'id': 50,
            'name': 100,
            'nameEn': 100,
            'description': 1000,
            'openHours': 100,
            'estimatedTime': 50,
            'tips': 500,
            'accessibility': 200
        }
        
        for field, limit in field_limits.items():
            if field in poi and isinstance(poi[field], str):
                if len(poi[field]) > limit:
                    result.add_error(f"Field {field} exceeds database limit of {limit} characters")
        
        return result
    
    def validate_json_structure(self, data: Dict[str, Any]) -> ValidationResult:
        """Validate complete JSON file structure."""
        result = ValidationResult()
        
        # Check top-level structure
        required_top_level = ['version', 'totalPOIs', 'pois']
        for field in required_top_level:
            if field not in data:
                result.add_error(f"Missing top-level field: {field}")
        
        # Validate metadata consistency
        if 'totalPOIs' in data and 'pois' in data:
            declared_count = data['totalPOIs']
            actual_count = len(data['pois'])
            if declared_count != actual_count:
                result.add_error(f"Declared POI count ({declared_count}) doesn't match actual count ({actual_count})")
        
        # Validate version format
        if 'version' in data:
            version = data['version']
            if not isinstance(version, str) or not re.match(r'^\d+\.\d+\.\d+$', version):
                result.add_error("Version must be in semantic versioning format (e.g., '2.3.0')")
        
        # Validate POI array
        if 'pois' in data:
            if not isinstance(data['pois'], list):
                result.add_error("POIs must be an array")
            else:
                poi_list_result = self.validate_poi_list(data['pois'], "JSON file")
                result.merge(poi_list_result)
        
        return result


def create_validation_config(coordinate_bounds: Dict[str, float] = None) -> Dict[str, Any]:
    """Create a validation configuration template."""
    if coordinate_bounds is None:
        coordinate_bounds = {
            'lat_min': 24.6,
            'lat_max': 24.9,
            'lng_min': 125.1,
            'lng_max': 125.5
        }
    
    return {
        'coordinate_bounds': coordinate_bounds,
        'valid_categories': [
            'beaches', 'activities', 'restaurants', 
            'culture', 'nature', 'shopping'
        ],
        'validation_level': 'normal',
        'required_fields': ['id', 'name', 'category', 'coordinates', 'rating'],
        'field_limits': {
            'id': {'min_length': 3, 'max_length': 50},
            'name': {'min_length': 2, 'max_length': 100},
            'description': {'max_length': 1000},
            'rating': {'min': 1.0, 'max': 5.0}
        },
        'database_constraints': {
            'enable_sql_injection_check': True,
            'enable_length_validation': True,
            'max_string_length': 1000
        }
    }


if __name__ == "__main__":
    import sys
    
    # Command-line usage
    if len(sys.argv) > 1:
        if sys.argv[1] == "validate-file":
            if len(sys.argv) < 3:
                print("Usage: python schema_validator.py validate-file <file_path>")
                sys.exit(1)
            
            file_path = sys.argv[2]
            
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                
                # Create validator with default Miyakojima bounds
                coordinate_bounds = {
                    'lat_min': 24.6, 'lat_max': 24.9,
                    'lng_min': 125.1, 'lng_max': 125.5
                }
                
                validator = POIValidator(coordinate_bounds)
                result = validator.validate_json_structure(data)
                
                print("=== VALIDATION RESULTS ===")
                print(f"File: {file_path}")
                print(f"Valid: {result.valid}")
                print(f"Errors: {len(result.errors)}")
                print(f"Warnings: {len(result.warnings)}")
                
                if result.errors:
                    print("\nErrors:")
                    for error in result.errors:
                        print(f"  ❌ {error}")
                
                if result.warnings:
                    print("\nWarnings:")
                    for warning in result.warnings:
                        print(f"  ⚠️  {warning}")
                
                if result.details:
                    print(f"\nDetails:")
                    for key, value in result.details.items():
                        print(f"  {key}: {value}")
                
                sys.exit(0 if result.valid else 1)
                
            except FileNotFoundError:
                print(f"Error: File not found: {file_path}")
                sys.exit(1)
            except json.JSONDecodeError as e:
                print(f"Error: Invalid JSON in file: {e}")
                sys.exit(1)
            except Exception as e:
                print(f"Error: {e}")
                sys.exit(1)
        
        elif sys.argv[1] == "create-config":
            config = create_validation_config()
            config_file = "validation_config.json"
            
            with open(config_file, 'w', encoding='utf-8') as f:
                json.dump(config, f, indent=2, ensure_ascii=False)
            
            print(f"Validation configuration created: {config_file}")
    
    else:
        print("Schema Validator - Usage:")
        print("  python schema_validator.py validate-file <file_path>")
        print("  python schema_validator.py create-config")
        print()
        print("Example:")
        print("  python schema_validator.py validate-file data/miyakojima_pois.json")