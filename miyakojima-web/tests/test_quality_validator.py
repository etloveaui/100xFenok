"""
Unit tests for QualityValidator.

Tests POI validation logic, quality scoring, and data integrity checks.
"""

import unittest
from unittest.mock import Mock
from poi_expansion_system.quality_validator import QualityValidator
from poi_expansion_system.interfaces import POIRecord


class TestQualityValidator(unittest.TestCase):
    """Test cases for QualityValidator functionality."""
    
    def setUp(self):
        """Set up test fixtures."""
        # Mock config manager
        self.mock_config = Mock()
        self.mock_config.get_config.side_effect = self._mock_config_getter
        
        self.validator = QualityValidator(self.mock_config)
        
        # Sample valid POI record
        self.valid_poi = POIRecord(
            id="beach_001",
            name="테스트 해변",
            name_en="Test Beach", 
            category="beaches",
            rating=4.5,
            coordinates={"lat": 24.7, "lng": 125.3},
            description="아름다운 테스트 해변입니다. 맑은 물과 하얀 모래가 특징입니다.",
            features=["수영", "스노클링", "일몰"],
            open_hours="24시간",
            estimated_time="2-3시간",
            cost={"min": 0, "max": 0, "currency": "JPY"},
            tips="일몰 시간대 방문을 추천합니다.",
            accessibility="휠체어 접근 가능",
            weather={"sunny": "최적", "cloudy": "좋음", "rainy": "부적합"}
        )
    
    def _mock_config_getter(self, key, default=None):
        """Mock configuration getter."""
        config_map = {
            'validation.miyakojima_bounds': {
                'lat_min': 24.6,
                'lat_max': 24.9,
                'lng_min': 125.1,
                'lng_max': 125.5
            },
            'validation.required_fields': [
                'id', 'name', 'nameEn', 'category', 'rating',
                'coordinates', 'description', 'features'
            ],
            'validation.rating_range': {'min': 1.0, 'max': 5.0},
            'categories': {
                'beaches': '해변',
                'restaurants': '음식점',
                'culture': '문화'
            }
        }
        return config_map.get(key, default)
    
    def test_valid_poi_record(self):
        """Test validation of valid POI record."""
        result = self.validator.validate_poi_record(self.valid_poi)
        
        self.assertTrue(result.is_valid)
        self.assertEqual(len(result.errors), 0)
        self.assertIn('quality_score', result.metadata)
        self.assertGreater(result.metadata['quality_score'], 0.5)
    
    def test_invalid_coordinates(self):
        """Test validation with coordinates outside Miyakojima."""
        invalid_poi = self.valid_poi
        invalid_poi.coordinates = {"lat": 30.0, "lng": 140.0}  # Outside bounds
        
        result = self.validator.validate_poi_record(invalid_poi)
        
        self.assertFalse(result.is_valid)
        self.assertIn("Coordinates outside Miyakojima region", result.errors)
    
    def test_validate_coordinates(self):
        """Test coordinate validation method."""
        # Valid coordinates
        self.assertTrue(self.validator.validate_coordinates(24.7, 125.3))
        
        # Invalid coordinates
        self.assertFalse(self.validator.validate_coordinates(30.0, 140.0))
        self.assertFalse(self.validator.validate_coordinates(24.5, 125.3))  # Below min lat
        self.assertFalse(self.validator.validate_coordinates(25.0, 125.3))  # Above max lat
    
    def test_validate_category(self):
        """Test category validation."""
        # Valid categories
        self.assertTrue(self.validator.validate_category("beaches"))
        self.assertTrue(self.validator.validate_category("restaurants"))
        
        # Invalid category
        self.assertFalse(self.validator.validate_category("invalid_category"))
    
    def test_invalid_rating(self):
        """Test validation with invalid rating."""
        invalid_poi = self.valid_poi
        invalid_poi.rating = 6.0  # Above max
        
        result = self.validator.validate_poi_record(invalid_poi)
        
        self.assertFalse(result.is_valid)
        self.assertTrue(any("Rating" in error for error in result.errors))
    
    def test_invalid_id_format(self):
        """Test validation with invalid ID format."""
        invalid_poi = self.valid_poi
        invalid_poi.id = "invalid-id-format"
        
        result = self.validator.validate_poi_record(invalid_poi)
        
        self.assertFalse(result.is_valid)
        self.assertTrue(any("Invalid ID format" in error for error in result.errors))
    
    def test_missing_required_fields(self):
        """Test validation with missing required fields."""
        # Create POI with missing description
        invalid_poi = POIRecord(
            id="test_001",
            name="Test",
            name_en="Test",
            category="beaches",
            rating=4.0,
            coordinates={"lat": 24.7, "lng": 125.3},
            description="",  # Empty description
            features=["test"],
            open_hours="24시간",
            estimated_time="1시간",
            cost={"min": 0, "max": 0, "currency": "JPY"},
            tips="",
            accessibility="",
            weather={}
        )
        
        result = self.validator.validate_poi_record(invalid_poi)
        
        self.assertFalse(result.is_valid)
        self.assertTrue(any("Empty required field" in error for error in result.errors))
    
    def test_quality_score_calculation(self):
        """Test quality score calculation."""
        # High quality POI
        high_quality_poi = self.valid_poi
        result = self.validator.validate_poi_record(high_quality_poi)
        high_score = result.metadata['quality_score']
        
        # Low quality POI
        low_quality_poi = POIRecord(
            id="test_001",
            name="Test",
            name_en="Test",
            category="beaches", 
            rating=2.0,  # Low rating
            coordinates={"lat": 24.7, "lng": 125.3},
            description="짧은 설명",  # Short description
            features=["test"],  # Few features
            open_hours="",
            estimated_time="",
            cost={"min": 0, "max": 0, "currency": "JPY"},
            tips="",
            accessibility="",
            weather={"sunny": "좋음"}  # Incomplete weather
        )
        
        result = self.validator.validate_poi_record(low_quality_poi)
        low_score = result.metadata['quality_score']
        
        # High quality should score higher
        self.assertGreater(high_score, low_score)
        self.assertGreater(high_score, 0.7)
        self.assertLess(low_score, 0.5)
    
    def test_validate_poi_list(self):
        """Test validation of POI list."""
        poi_list = [self.valid_poi]
        result = self.validator.validate_poi_list(poi_list)
        
        self.assertTrue(result.is_valid)
        self.assertEqual(result.metadata['total_pois'], 1)
        self.assertEqual(result.metadata['valid_pois'], 1)
        self.assertIn('category_distribution', result.metadata)
    
    def test_duplicate_detection(self):
        """Test duplicate POI detection."""
        # Create duplicate POIs
        poi1 = self.valid_poi
        poi2 = self.valid_poi  # Same POI
        
        poi_list = [poi1, poi2]
        result = self.validator.validate_poi_list(poi_list)
        
        self.assertFalse(result.is_valid)
        self.assertIn(poi1.id, result.metadata['duplicate_ids'])
        self.assertTrue(any("Duplicate POI ID" in error for error in result.errors))
    
    def test_features_validation(self):
        """Test features list validation."""
        # Valid features count
        valid_poi = self.valid_poi
        valid_poi.features = ["feature1", "feature2", "feature3"]
        result = self.validator.validate_poi_record(valid_poi)
        self.assertTrue(result.is_valid)
        
        # Too few features (triggers warning)
        few_features_poi = self.valid_poi
        few_features_poi.features = []
        result = self.validator.validate_poi_record(few_features_poi)
        # Should be invalid due to missing features
        self.assertFalse(result.is_valid)
    
    def test_cost_validation(self):
        """Test cost structure validation."""
        # Invalid currency
        invalid_cost_poi = self.valid_poi
        invalid_cost_poi.cost = {"min": 0, "max": 100, "currency": "USD"}
        result = self.validator.validate_poi_record(invalid_cost_poi)
        self.assertFalse(result.is_valid)
        
        # Negative cost
        invalid_cost_poi.cost = {"min": -10, "max": 100, "currency": "JPY"}
        result = self.validator.validate_poi_record(invalid_cost_poi)
        self.assertFalse(result.is_valid)
        
        # Min > Max
        invalid_cost_poi.cost = {"min": 100, "max": 50, "currency": "JPY"}
        result = self.validator.validate_poi_record(invalid_cost_poi)
        self.assertFalse(result.is_valid)
    
    def test_weather_validation(self):
        """Test weather conditions validation."""
        # Missing weather conditions
        invalid_weather_poi = self.valid_poi
        invalid_weather_poi.weather = {"sunny": "좋음"}  # Missing cloudy, rainy
        result = self.validator.validate_poi_record(invalid_weather_poi)
        # Should generate warning about incomplete weather
        self.assertGreater(len(result.warnings), 0)
        
        # Invalid weather rating
        invalid_weather_poi.weather = {
            "sunny": "invalid_rating",
            "cloudy": "좋음",
            "rainy": "부적합"
        }
        result = self.validator.validate_poi_record(invalid_weather_poi)
        self.assertFalse(result.is_valid)


if __name__ == '__main__':
    unittest.main()