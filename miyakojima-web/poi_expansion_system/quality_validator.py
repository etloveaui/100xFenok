"""
Quality Validator for POI Expansion System.

Implements Single Responsibility Principle by handling only data validation.
Ensures data integrity and quality standards for POI records.
"""

import re
import logging
from typing import List, Dict, Any, Set
from dataclasses import asdict

from .interfaces import IDataValidator, POIRecord, ValidationResult, IConfigManager


class QualityValidator(IDataValidator):
    """
    Comprehensive POI data validator with quality assurance.
    
    Features:
    - Coordinate validation for Miyakojima region
    - Category and field validation
    - Data format and consistency checks
    - Rating normalization and validation
    - Duplicate detection
    - Quality scoring
    """
    
    def __init__(self, config_manager: IConfigManager):
        self.config = config_manager
        self.logger = logging.getLogger(__name__)
        
        # Cache validation rules
        self._coordinate_bounds = self.config.get_config('validation.miyakojima_bounds')
        self._required_fields = self.config.get_config('validation.required_fields', [])
        self._rating_range = self.config.get_config('validation.rating_range')
        self._valid_categories = set(self.config.get_config('categories', {}).keys())
        
        # Quality thresholds
        self._quality_thresholds = {
            'min_description_length': 20,
            'min_features_count': 2,
            'max_features_count': 10,
            'min_tips_length': 15,
            'required_weather_conditions': {'sunny', 'cloudy', 'rainy'}
        }
    
    def validate_poi_record(self, poi: POIRecord) -> ValidationResult:
        """
        Comprehensive validation of a POI record.
        
        Args:
            poi: POI record to validate
        
        Returns:
            ValidationResult with detailed validation feedback
        """
        errors = []
        warnings = []
        metadata = {}
        
        try:
            # Validate required fields directly on POIRecord
            field_errors = self._validate_poi_required_fields(poi)
            errors.extend(field_errors)
            
            # Validate ID format
            if not self._validate_id_format(poi.id):
                errors.append(f"Invalid ID format: {poi.id}")
            
            # Validate coordinates
            if not self.validate_coordinates(
                poi.coordinates.get('lat', 0), 
                poi.coordinates.get('lng', 0)
            ):
                errors.append("Coordinates outside Miyakojima region")
            
            # Validate category
            if not self.validate_category(poi.category):
                errors.append(f"Invalid category: {poi.category}")
            
            # Validate rating
            rating_validation = self._validate_rating(poi.rating)
            if not rating_validation[0]:
                errors.append(rating_validation[1])
            
            # Validate text content quality
            content_warnings = self._validate_content_quality(poi)
            warnings.extend(content_warnings)
            
            # Validate features
            features_validation = self._validate_features(poi.features)
            if not features_validation[0]:
                warnings.append(features_validation[1])
            
            # Validate cost structure
            cost_validation = self._validate_cost(poi.cost)
            if not cost_validation[0]:
                errors.append(cost_validation[1])
            
            # Validate weather conditions
            weather_validation = self._validate_weather(poi.weather)
            if not weather_validation[0]:
                warnings.append(weather_validation[1])
            
            # Calculate quality score
            quality_score = self._calculate_quality_score(poi)
            metadata['quality_score'] = quality_score
            
            if quality_score < 0.7:
                warnings.append(f"Low quality score: {quality_score:.2f}")
            
            is_valid = len(errors) == 0
            
            return ValidationResult(is_valid, errors, warnings, metadata)
            
        except Exception as e:
            self.logger.error(f"Validation failed for POI {poi.id}: {e}")
            return ValidationResult(False, [f"Validation exception: {e}"], [], {})
    
    def validate_coordinates(self, lat: float, lng: float) -> bool:
        """
        Validate coordinates are within Miyakojima region.
        
        Args:
            lat: Latitude
            lng: Longitude
        
        Returns:
            True if coordinates are valid
        """
        if not self._coordinate_bounds:
            self.logger.warning("No coordinate bounds configured")
            return True
        
        return (
            self._coordinate_bounds['lat_min'] <= lat <= self._coordinate_bounds['lat_max'] and
            self._coordinate_bounds['lng_min'] <= lng <= self._coordinate_bounds['lng_max']
        )
    
    def validate_category(self, category: str) -> bool:
        """
        Validate POI category is allowed.
        
        Args:
            category: Category to validate
        
        Returns:
            True if category is valid
        """
        return category in self._valid_categories
    
    def validate_poi_list(self, pois: List[POIRecord]) -> ValidationResult:
        """
        Validate a list of POI records.
        
        Args:
            pois: List of POI records
        
        Returns:
            ValidationResult with aggregate validation results
        """
        errors = []
        warnings = []
        metadata = {
            'total_pois': len(pois),
            'valid_pois': 0,
            'invalid_pois': 0,
            'duplicate_ids': []
        }
        
        # Check for duplicate IDs
        seen_ids = set()
        for poi in pois:
            if poi.id in seen_ids:
                metadata['duplicate_ids'].append(poi.id)
                errors.append(f"Duplicate POI ID: {poi.id}")
            seen_ids.add(poi.id)
        
        # Validate each POI
        quality_scores = []
        for poi in pois:
            result = self.validate_poi_record(poi)
            if result.is_valid:
                metadata['valid_pois'] += 1
                quality_scores.append(result.metadata.get('quality_score', 0))
            else:
                metadata['invalid_pois'] += 1
                errors.extend([f"POI {poi.id}: {error}" for error in result.errors])
            
            warnings.extend([f"POI {poi.id}: {warning}" for warning in result.warnings])
        
        # Calculate average quality
        if quality_scores:
            metadata['average_quality'] = sum(quality_scores) / len(quality_scores)
        
        # Category distribution analysis
        category_counts = {}
        for poi in pois:
            category_counts[poi.category] = category_counts.get(poi.category, 0) + 1
        metadata['category_distribution'] = category_counts
        
        is_valid = len(errors) == 0
        return ValidationResult(is_valid, errors, warnings, metadata)
    
    def _validate_required_fields(self, poi_dict: Dict[str, Any]) -> List[str]:
        """Validate all required fields are present."""
        errors = []
        for field in self._required_fields:
            if field not in poi_dict or poi_dict[field] is None:
                errors.append(f"Missing required field: {field}")
            elif isinstance(poi_dict[field], str) and not poi_dict[field].strip():
                errors.append(f"Empty required field: {field}")
        return errors
    
    def _validate_poi_required_fields(self, poi: POIRecord) -> List[str]:
        """Validate required fields on POIRecord object."""
        errors = []
        
        # Essential fields that must be present and non-empty
        if not poi.id or not poi.id.strip():
            errors.append("Missing or empty ID")
        if not poi.name or not poi.name.strip():
            errors.append("Missing or empty name")
        if not poi.category or not poi.category.strip():
            errors.append("Missing or empty category")
        if not poi.description or not poi.description.strip():
            errors.append("Missing or empty description")
        
        # Coordinates validation
        if not poi.coordinates or not isinstance(poi.coordinates, dict):
            errors.append("Missing or invalid coordinates")
        else:
            if 'lat' not in poi.coordinates or 'lng' not in poi.coordinates:
                errors.append("Coordinates missing lat or lng")
        
        # Features validation  
        if not poi.features or not isinstance(poi.features, list):
            errors.append("Missing or invalid features list")
        
        # Rating validation
        if poi.rating is None:
            errors.append("Missing rating")
        
        return errors
    
    def _validate_id_format(self, poi_id: str) -> bool:
        """Validate POI ID follows expected format."""
        # Expected format: category_number (e.g., beach_001, restaurant_045)
        pattern = r'^[a-z]+_\d{3}$'
        return bool(re.match(pattern, poi_id))
    
    def _validate_rating(self, rating: float) -> tuple[bool, str]:
        """Validate rating is within acceptable range."""
        if not isinstance(rating, (int, float)):
            return False, "Rating must be numeric"
        
        if not self._rating_range:
            return True, ""
        
        min_rating = self._rating_range['min']
        max_rating = self._rating_range['max']
        
        if not (min_rating <= rating <= max_rating):
            return False, f"Rating {rating} outside range [{min_rating}, {max_rating}]"
        
        return True, ""
    
    def _validate_content_quality(self, poi: POIRecord) -> List[str]:
        """Validate text content quality."""
        warnings = []
        
        # Description length
        if len(poi.description) < self._quality_thresholds['min_description_length']:
            warnings.append("Description too short")
        
        # Tips quality
        if poi.tips and len(poi.tips) < self._quality_thresholds['min_tips_length']:
            warnings.append("Tips too short")
        
        # Check for placeholder text
        placeholder_patterns = ['placeholder', 'todo', 'tbd', 'xxx']
        for pattern in placeholder_patterns:
            if pattern.lower() in poi.description.lower():
                warnings.append(f"Placeholder text detected: {pattern}")
        
        return warnings
    
    def _validate_features(self, features: List[str]) -> tuple[bool, str]:
        """Validate features list."""
        if not features:
            return False, "No features specified"
        
        if len(features) < self._quality_thresholds['min_features_count']:
            return False, f"Too few features: {len(features)}"
        
        if len(features) > self._quality_thresholds['max_features_count']:
            return False, f"Too many features: {len(features)}"
        
        return True, ""
    
    def _validate_cost(self, cost: Dict[str, Any]) -> tuple[bool, str]:
        """Validate cost structure."""
        required_cost_fields = ['min', 'max', 'currency']
        
        for field in required_cost_fields:
            if field not in cost:
                return False, f"Missing cost field: {field}"
        
        if cost['min'] < 0 or cost['max'] < 0:
            return False, "Negative cost values not allowed"
        
        if cost['min'] > cost['max']:
            return False, "Minimum cost greater than maximum cost"
        
        if cost['currency'] != 'JPY':
            return False, "Currency must be JPY for Miyakojima"
        
        return True, ""
    
    def _validate_weather(self, weather: Dict[str, str]) -> tuple[bool, str]:
        """Validate weather conditions."""
        required_conditions = self._quality_thresholds['required_weather_conditions']
        missing_conditions = required_conditions - set(weather.keys())
        
        if missing_conditions:
            return False, f"Missing weather conditions: {', '.join(missing_conditions)}"
        
        valid_ratings = {'최적', '좋음', '보통', '부적합'}
        for condition, rating in weather.items():
            if rating not in valid_ratings:
                return False, f"Invalid weather rating '{rating}' for {condition}"
        
        return True, ""
    
    def _calculate_quality_score(self, poi: POIRecord) -> float:
        """Calculate quality score for POI (0.0 to 1.0)."""
        score = 0.0
        max_score = 0.0
        
        # Description quality (0.2)
        max_score += 0.2
        if len(poi.description) >= self._quality_thresholds['min_description_length']:
            score += 0.1
        if len(poi.description) >= 50:  # Bonus for detailed description
            score += 0.1
        
        # Features quality (0.15)
        max_score += 0.15
        feature_count = len(poi.features)
        if self._quality_thresholds['min_features_count'] <= feature_count <= self._quality_thresholds['max_features_count']:
            score += 0.15
        
        # Tips quality (0.1)
        max_score += 0.1
        if poi.tips and len(poi.tips) >= self._quality_thresholds['min_tips_length']:
            score += 0.1
        
        # Coordinate precision (0.1)
        max_score += 0.1
        lat_precision = len(str(poi.coordinates['lat']).split('.')[-1])
        lng_precision = len(str(poi.coordinates['lng']).split('.')[-1])
        if lat_precision >= 4 and lng_precision >= 4:
            score += 0.1
        
        # Rating reasonableness (0.1)
        max_score += 0.1
        if 3.5 <= poi.rating <= 5.0:  # Reasonable rating range
            score += 0.1
        
        # Accessibility info (0.1)
        max_score += 0.1
        if poi.accessibility and len(poi.accessibility) > 5:
            score += 0.1
        
        # Weather completeness (0.1)
        max_score += 0.1
        required_conditions = self._quality_thresholds['required_weather_conditions']
        if all(condition in poi.weather for condition in required_conditions):
            score += 0.1
        
        # Cost information (0.1)
        max_score += 0.1
        if isinstance(poi.cost, dict) and 'min' in poi.cost and 'max' in poi.cost:
            score += 0.1
        
        # Estimated time (0.05)
        max_score += 0.05
        if poi.estimated_time and poi.estimated_time != "정보 없음":
            score += 0.05
        
        return score / max_score if max_score > 0 else 0.0