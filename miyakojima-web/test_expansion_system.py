#!/usr/bin/env python3
"""
Test suite for POI Expansion System

Comprehensive testing to ensure system reliability and data integrity.
"""

import sys
import json
import tempfile
import shutil
from pathlib import Path
from typing import Dict, Any, List
import unittest
from unittest.mock import patch, MagicMock

# Import our modules
from expansion_config import ExpansionConfig, ConfigManager
from poi_expansion_system import (
    POIExpansionSystem, 
    POIDataExtractor, 
    CoordinateValidator, 
    DataQualityValidator,
    CategoryBalancer,
    BackupManager
)


class TestCoordinateValidator(unittest.TestCase):
    """Test coordinate validation functionality."""
    
    def setUp(self):
        self.bounds = {"lat": (24.6, 24.9), "lng": (125.1, 125.5)}
        self.validator = CoordinateValidator(self.bounds)
    
    def test_valid_coordinates(self):
        """Test valid coordinates pass validation."""
        self.assertTrue(self.validator.is_valid(24.7, 125.3))
        self.assertTrue(self.validator.is_valid(24.6, 125.1))  # Edge cases
        self.assertTrue(self.validator.is_valid(24.9, 125.5))
    
    def test_invalid_coordinates(self):
        """Test invalid coordinates fail validation."""
        self.assertFalse(self.validator.is_valid(24.5, 125.3))  # lat too low
        self.assertFalse(self.validator.is_valid(25.0, 125.3))  # lat too high
        self.assertFalse(self.validator.is_valid(24.7, 125.0))  # lng too low
        self.assertFalse(self.validator.is_valid(24.7, 125.6))  # lng too high
    
    def test_validate_poi_coordinates(self):
        """Test POI coordinate validation."""
        valid_poi = {
            "coordinates": {"lat": 24.7, "lng": 125.3}
        }
        invalid_poi = {
            "coordinates": {"lat": 25.0, "lng": 125.3}
        }
        missing_coords_poi = {
            "name": "Test POI"
        }
        
        self.assertTrue(self.validator.validate_poi_coordinates(valid_poi))
        self.assertFalse(self.validator.validate_poi_coordinates(invalid_poi))
        self.assertFalse(self.validator.validate_poi_coordinates(missing_coords_poi))


class TestDataQualityValidator(unittest.TestCase):
    """Test data quality validation functionality."""
    
    def setUp(self):
        self.required_fields = ["name", "nameEn", "category", "rating", "coordinates", "description", "features"]
        self.validator = DataQualityValidator(self.required_fields)
    
    def test_valid_poi(self):
        """Test valid POI passes all checks."""
        valid_poi = {
            "name": "Test POI",
            "nameEn": "Test POI EN",
            "category": "beaches",
            "rating": 4.5,
            "coordinates": {"lat": 24.7, "lng": 125.3},
            "description": "Test description",
            "features": ["test", "poi"]
        }
        
        is_valid, errors = self.validator.validate_poi(valid_poi)
        self.assertTrue(is_valid)
        self.assertEqual(len(errors), 0)
    
    def test_missing_required_fields(self):
        """Test POI with missing required fields."""
        incomplete_poi = {
            "name": "Test POI",
            "category": "beaches"
            # Missing other required fields
        }
        
        is_valid, errors = self.validator.validate_poi(incomplete_poi)
        self.assertFalse(is_valid)
        self.assertGreater(len(errors), 0)
        self.assertTrue(any("Missing required field" in error for error in errors))
    
    def test_invalid_rating(self):
        """Test POI with invalid rating."""
        invalid_rating_poi = {
            "name": "Test POI",
            "nameEn": "Test POI EN", 
            "category": "beaches",
            "rating": 6.0,  # Invalid rating
            "coordinates": {"lat": 24.7, "lng": 125.3},
            "description": "Test description",
            "features": ["test"]
        }
        
        is_valid, errors = self.validator.validate_poi(invalid_rating_poi)
        self.assertFalse(is_valid)
        self.assertTrue(any("Invalid rating" in error for error in errors))
    
    def test_invalid_category(self):
        """Test POI with invalid category."""
        invalid_category_poi = {
            "name": "Test POI",
            "nameEn": "Test POI EN",
            "category": "invalid_category",  # Invalid category
            "rating": 4.5,
            "coordinates": {"lat": 24.7, "lng": 125.3},
            "description": "Test description", 
            "features": ["test"]
        }
        
        is_valid, errors = self.validator.validate_poi(invalid_category_poi)
        self.assertFalse(is_valid)
        self.assertTrue(any("Invalid category" in error for error in errors))


class TestCategoryBalancer(unittest.TestCase):
    """Test category balancing functionality."""
    
    def setUp(self):
        self.current_distribution = {
            "beaches": 4,
            "culture": 5,
            "activities": 5,
            "restaurants": 4,
            "nature": 4,
            "shopping": 3
        }
        self.target_total = 50
        self.balancer = CategoryBalancer(self.current_distribution, self.target_total)
    
    def test_calculate_target_distribution(self):
        """Test target distribution calculation."""
        target_distribution = self.balancer.calculate_target_distribution()
        
        # Should add 25 POIs total
        total_to_add = sum(target_distribution.values())
        self.assertEqual(total_to_add, 25)
        
        # All values should be non-negative
        for count in target_distribution.values():
            self.assertGreaterEqual(count, 0)
    
    def test_select_balanced_pois(self):
        """Test balanced POI selection."""
        # Create mock candidates
        candidates = []
        for category in ["beaches", "culture", "activities", "restaurants", "nature", "shopping"]:
            for i in range(10):  # 10 candidates per category
                candidates.append({
                    "name": f"Test {category} {i}",
                    "category": category,
                    "rating": 4.0 + (i * 0.1)  # Varying ratings
                })
        
        selected_pois = self.balancer.select_balanced_pois(candidates)
        
        # Should select exactly 25 POIs
        self.assertEqual(len(selected_pois), 25)
        
        # Check that higher-rated POIs are selected
        for poi in selected_pois:
            self.assertGreaterEqual(poi["rating"], 4.0)


class TestExpansionConfig(unittest.TestCase):
    """Test configuration management."""
    
    def test_default_config(self):
        """Test default configuration values."""
        config = ExpansionConfig()
        
        self.assertEqual(config.target_total_pois, 50)
        self.assertEqual(config.current_pois_count, 25)
        self.assertEqual(config.pois_to_add, 25)
        
        # Test coordinate bounds
        bounds = config.coordinate_bounds
        self.assertEqual(bounds["lat"], (24.6, 24.9))
        self.assertEqual(bounds["lng"], (125.1, 125.5))
    
    def test_config_validation(self):
        """Test configuration validation."""
        # Valid config
        config = ExpansionConfig()
        is_valid, errors = config.validate()
        self.assertTrue(is_valid)
        self.assertEqual(len(errors), 0)
        
        # Invalid config - target less than current
        invalid_config = ExpansionConfig(target_total_pois=20, current_pois_count=25)
        is_valid, errors = invalid_config.validate()
        self.assertFalse(is_valid)
        self.assertGreater(len(errors), 0)
    
    def test_config_from_dict(self):
        """Test creating config from dictionary."""
        config_dict = {
            "target_total_pois": 60,
            "min_rating_threshold": 4.5,
            "backup_dir": "test_backups"
        }
        
        config = ExpansionConfig(**config_dict)
        self.assertEqual(config.target_total_pois, 60)
        self.assertEqual(config.min_rating_threshold, 4.5)
        self.assertEqual(config.backup_dir, "test_backups")


class TestBackupManager(unittest.TestCase):
    """Test backup and restore functionality."""
    
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.backup_manager = BackupManager(self.temp_dir)
        
        # Create a test file
        self.test_file = Path(self.temp_dir) / "test_file.json"
        self.test_data = {"test": "data", "number": 42}
        
        with open(self.test_file, 'w', encoding='utf-8') as f:
            json.dump(self.test_data, f)
    
    def tearDown(self):
        shutil.rmtree(self.temp_dir)
    
    def test_create_backup(self):
        """Test backup creation."""
        backup_path = self.backup_manager.create_backup(str(self.test_file))
        
        # Backup should exist
        self.assertTrue(Path(backup_path).exists())
        
        # Backup should have same content
        with open(backup_path, 'r', encoding='utf-8') as f:
            backup_data = json.load(f)
        
        self.assertEqual(backup_data, self.test_data)
    
    def test_restore_backup(self):
        """Test backup restoration."""
        # Create backup
        backup_path = self.backup_manager.create_backup(str(self.test_file))
        
        # Modify original file
        modified_data = {"modified": True}
        with open(self.test_file, 'w', encoding='utf-8') as f:
            json.dump(modified_data, f)
        
        # Restore backup
        success = self.backup_manager.restore_backup(backup_path, str(self.test_file))
        self.assertTrue(success)
        
        # Original data should be restored
        with open(self.test_file, 'r', encoding='utf-8') as f:
            restored_data = json.load(f)
        
        self.assertEqual(restored_data, self.test_data)


class IntegrationTests(unittest.TestCase):
    """Integration tests for the complete system."""
    
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        
        # Create test configuration
        self.config = ExpansionConfig(
            source_database_path=str(Path(self.temp_dir) / "source_db.json"),
            current_pois_path=str(Path(self.temp_dir) / "current_pois.json"),
            backup_dir=str(Path(self.temp_dir) / "backups"),
            log_dir=str(Path(self.temp_dir) / "logs"),
            target_total_pois=30,
            current_pois_count=25
        )
        
        # Create test data files
        self._create_test_files()
    
    def tearDown(self):
        shutil.rmtree(self.temp_dir)
    
    def _create_test_files(self):
        """Create test data files."""
        # Create current POI file
        current_pois = {
            "version": "2.0.0",
            "totalPOIs": 25,
            "pois": []
        }
        
        # Add some sample current POIs
        for i in range(25):
            current_pois["pois"].append({
                "id": f"current_{i}",
                "name": f"Current POI {i}",
                "nameEn": f"Current POI {i}",
                "category": ["beaches", "culture", "activities", "restaurants", "nature", "shopping"][i % 6],
                "rating": 4.0 + (i % 10) * 0.1,
                "coordinates": {"lat": 24.7 + (i * 0.001), "lng": 125.3 + (i * 0.001)},
                "description": f"Test POI {i}",
                "features": ["test", "poi"]
            })
        
        with open(self.config.current_pois_path, 'w', encoding='utf-8') as f:
            json.dump(current_pois, f, indent=2)
        
        # Create source database file
        source_db = {
            "extensions": {
                "poi_locations": {
                    "nature_views": {
                        "beaches_detailed": {
                            "test_beach_1": {
                                "coordinates": [24.75, 125.25],
                                "activities": ["swimming", "sunbathing"]
                            },
                            "test_beach_2": {
                                "coordinates": [24.76, 125.26],
                                "activities": ["snorkeling", "diving"]
                            }
                        },
                        "viewpoints_detailed": {
                            "test_viewpoint_1": {
                                "coordinates": [24.77, 125.27],
                                "features": ["panoramic view", "lighthouse"]
                            }
                        }
                    },
                    "dining_cafe": {
                        "premium_restaurants": {
                            "test_restaurant_1": {
                                "coordinates": [24.78, 125.28],
                                "specialty": "local cuisine",
                                "price_range": "2000-5000 JPY"
                            }
                        },
                        "cafes": {
                            "test_cafe_1": {
                                "coordinates": [24.79, 125.29],
                                "specialty": "coffee",
                                "price_range": "500-1500 JPY"
                            }
                        }
                    },
                    "shopping": {
                        "specialty_stores": {
                            "test_shop_1": {
                                "coordinates": [24.80, 125.30],
                                "specialties": ["souvenirs", "local products"]
                            }
                        }
                    },
                    "culture_spots": {
                        "museums_cultural": {
                            "test_museum_1": {
                                "coordinates": [24.81, 125.31],
                                "admission": "300 JPY"
                            }
                        }
                    },
                    "marine_activities": {
                        "diving_shops": {
                            "test_diving_1": {
                                "coordinates": [24.82, 125.32],
                                "price": "体験다이빙 8000 JPY"
                            }
                        }
                    },
                    "experience_activities": {
                        "traditional_crafts": {
                            "test_craft_1": {
                                "coordinates": [24.83, 125.33],
                                "price_range": "2000-4000 JPY"
                            }
                        }
                    }
                }
            }
        }
        
        with open(self.config.source_database_path, 'w', encoding='utf-8') as f:
            json.dump(source_db, f, indent=2)
    
    def test_complete_expansion_dry_run(self):
        """Test complete expansion process in dry run mode."""
        expansion_system = POIExpansionSystem(self.config)
        result = expansion_system.expand_pois(dry_run=True)
        
        self.assertTrue(result["success"])
        self.assertTrue(result["dry_run"])
        self.assertEqual(result["original_count"], 25)
        self.assertGreater(result["would_add_count"], 0)
    
    def test_complete_expansion_real(self):
        """Test complete expansion process with actual changes."""
        expansion_system = POIExpansionSystem(self.config)
        result = expansion_system.expand_pois(dry_run=False)
        
        self.assertTrue(result["success"])
        self.assertFalse(result["dry_run"])
        self.assertEqual(result["original_count"], 25)
        self.assertGreater(result["added_count"], 0)
        
        # Verify backup was created
        self.assertTrue(Path(result["backup_path"]).exists())
        
        # Verify updated file
        with open(self.config.current_pois_path, 'r', encoding='utf-8') as f:
            updated_data = json.load(f)
        
        self.assertEqual(updated_data["totalPOIs"], result["new_total"])
        self.assertEqual(len(updated_data["pois"]), result["new_total"])


def run_system_validation():
    """Run system validation checks."""
    print("🔍 Running System Validation")
    print("=" * 50)
    
    # Test configuration validation
    print("Testing configuration management...")
    try:
        config_manager = ConfigManager()
        config = config_manager.load_config()
        print("✅ Configuration loaded successfully")
        
        is_valid, errors = config.validate()
        if is_valid:
            print("✅ Configuration validation passed")
        else:
            print("❌ Configuration validation failed:")
            for error in errors:
                print(f"   - {error}")
                
    except Exception as e:
        print(f"❌ Configuration error: {e}")
    
    # Test file existence
    print("\nTesting file existence...")
    required_files = [
        "docs/knowledge/miyakojima_database.json",
        "data/miyakojima_pois.json"
    ]
    
    all_files_exist = True
    for file_path in required_files:
        if Path(file_path).exists():
            print(f"✅ Found: {file_path}")
        else:
            print(f"❌ Missing: {file_path}")
            all_files_exist = False
    
    if all_files_exist:
        print("✅ All required files found")
    else:
        print("❌ Some required files are missing")
    
    print("\nSystem validation complete!")
    return all_files_exist


def main():
    """Main test runner."""
    import argparse
    
    parser = argparse.ArgumentParser(description="POI Expansion System Test Suite")
    parser.add_argument(
        "--validate-only", 
        action="store_true", 
        help="Only run system validation, skip unit tests"
    )
    parser.add_argument(
        "--unit-tests-only", 
        action="store_true", 
        help="Only run unit tests, skip system validation"
    )
    parser.add_argument(
        "--verbose", "-v", 
        action="store_true", 
        help="Verbose test output"
    )
    
    args = parser.parse_args()
    
    print("🧪 POI Expansion System Test Suite")
    print("=" * 60)
    
    success = True
    
    # Run system validation
    if not args.unit_tests_only:
        try:
            system_valid = run_system_validation()
            if not system_valid:
                success = False
        except Exception as e:
            print(f"❌ System validation error: {e}")
            success = False
    
    # Run unit tests
    if not args.validate_only:
        print(f"\n🔧 Running Unit Tests")
        print("=" * 50)
        
        # Configure test runner
        test_loader = unittest.TestLoader()
        test_suite = test_loader.loadTestsFromModule(sys.modules[__name__])
        
        # Run tests
        test_runner = unittest.TextTestRunner(
            verbosity=2 if args.verbose else 1,
            stream=sys.stdout
        )
        
        test_result = test_runner.run(test_suite)
        
        if not test_result.wasSuccessful():
            success = False
    
    print(f"\n" + "=" * 60)
    if success:
        print("✅ All tests passed! System is ready for use.")
        return 0
    else:
        print("❌ Some tests failed. Please review and fix issues.")
        return 1


if __name__ == "__main__":
    sys.exit(main())