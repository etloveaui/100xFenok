"""
Integration tests for POI Expansion System.

Tests complete system workflows and component interactions.
"""

import unittest
import tempfile
import json
from pathlib import Path
from unittest.mock import patch, Mock

from poi_expansion_system.orchestrator import POIExpansionOrchestrator
from poi_expansion_system.interfaces import ExpansionPhase


class TestSystemIntegration(unittest.TestCase):
    """Integration tests for complete system workflows."""
    
    def setUp(self):
        """Set up test environment."""
        self.temp_dir = Path(tempfile.mkdtemp())
        
        # Create test directory structure
        self.config_dir = self.temp_dir / "config"
        self.data_dir = self.temp_dir / "data"
        self.docs_dir = self.temp_dir / "docs" / "knowledge"
        self.backup_dir = self.temp_dir / "backups" / "pois"
        self.logs_dir = self.temp_dir / "logs"
        
        for dir_path in [self.config_dir, self.data_dir, self.docs_dir, self.backup_dir, self.logs_dir]:
            dir_path.mkdir(parents=True, exist_ok=True)
        
        # Create test configuration
        self._create_test_config()
        
        # Create test POI data
        self._create_test_poi_data()
        
        # Create test source database
        self._create_test_source_database()
    
    def _create_test_config(self):
        """Create test configuration files."""
        base_config = {
            "data_paths": {
                "current_pois": str(self.data_dir / "miyakojima_pois.json"),
                "source_database": str(self.docs_dir / "miyakojima_database.json"),
                "backup_dir": str(self.backup_dir)
            },
            "expansion_phases": {
                "phase_1": {"target": 30, "increment": 15},
                "phase_2": {"target": 45, "increment": 15},
                "phase_3": {"target": 60, "increment": 15}
            },
            "validation": {
                "miyakojima_bounds": {
                    "lat_min": 24.6, "lat_max": 24.9,
                    "lng_min": 125.1, "lng_max": 125.5
                },
                "required_fields": [
                    "id", "name", "nameEn", "category", "rating",
                    "coordinates", "description", "features"
                ],
                "rating_range": {"min": 1.0, "max": 5.0}
            },
            "categories": {
                "beaches": "해변",
                "restaurants": "음식점",
                "culture": "문화"
            },
            "backup": {
                "max_backups": 5,
                "auto_backup": True,
                "compression": False
            },
            "logging": {
                "level": "DEBUG",
                "file": str(self.logs_dir / "test.log")
            }
        }
        
        with open(self.config_dir / "base.json", 'w', encoding='utf-8') as f:
            json.dump(base_config, f, ensure_ascii=False, indent=2)
        
        # Test environment config
        test_config = {
            "validation": {"quality_thresholds": {"min_quality_score": 0.3}}
        }
        
        with open(self.config_dir / "test.json", 'w', encoding='utf-8') as f:
            json.dump(test_config, f, ensure_ascii=False, indent=2)
    
    def _create_test_poi_data(self):
        """Create test POI data file."""
        test_pois = {
            "version": "2.0.0",
            "lastUpdated": "2025-09-10T00:00:00Z",
            "totalPOIs": 15,
            "categories": {
                "beaches": "해변",
                "restaurants": "음식점",
                "culture": "문화"
            },
            "pois": []
        }
        
        # Generate 15 test POIs
        for i in range(15):
            category = ["beaches", "restaurants", "culture"][i % 3]
            poi = {
                "id": f"{category}_{i+1:03d}",
                "name": f"테스트 {category} {i+1}",
                "nameEn": f"Test {category.title()} {i+1}",
                "category": category,
                "rating": 4.0 + (i % 10) * 0.1,
                "coordinates": {
                    "lat": 24.7 + (i % 5) * 0.02,
                    "lng": 125.3 + (i % 5) * 0.02
                },
                "description": f"테스트용 {category} POI {i+1}입니다. 상세한 설명이 포함되어 있습니다.",
                "features": ["특징1", "특징2", f"특징{i+3}"],
                "openHours": "09:00-18:00",
                "estimatedTime": "1-2시간",
                "cost": {"min": 0, "max": 1000, "currency": "JPY"},
                "tips": f"팁: {category} {i+1} 방문 시 주의사항입니다.",
                "accessibility": "접근 가능",
                "weather": {
                    "sunny": "최적",
                    "cloudy": "좋음",
                    "rainy": "부적합"
                }
            }
            test_pois["pois"].append(poi)
        
        with open(self.data_dir / "miyakojima_pois.json", 'w', encoding='utf-8') as f:
            json.dump(test_pois, f, ensure_ascii=False, indent=2)
    
    def _create_test_source_database(self):
        """Create test source database with additional POIs."""
        source_db = {
            "schema_version": "1.0",
            "last_updated": "2025-09-10",
            "poi_database": {
                "total_count": 75,
                "entries": []
            }
        }
        
        # Generate 60 additional POIs (75 total - 15 existing = 60 new)
        for i in range(60):
            category = ["beaches", "restaurants", "culture"][i % 3]
            poi = {
                "id": f"new_{category}_{i+1:03d}",
                "name": f"신규 {category} {i+1}",
                "name_en": f"New {category.title()} {i+1}",
                "category": category,
                "rating": 3.5 + (i % 15) * 0.1,
                "coordinates": {
                    "lat": 24.65 + (i % 10) * 0.025,
                    "lng": 125.15 + (i % 10) * 0.025
                },
                "description": f"신규 {category} POI {i+1}입니다. 확장을 위한 후보 POI입니다.",
                "features": ["신규특징1", "신규특징2"],
                "open_hours": "10:00-20:00",
                "estimated_time": "2-3시간",
                "cost": {"min": 500, "max": 2000, "currency": "JPY"},
                "tips": f"신규 {category} {i+1} 추천 정보입니다.",
                "accessibility": "접근 가능",
                "weather": {
                    "sunny": "좋음",
                    "cloudy": "보통",
                    "rainy": "부적합"
                }
            }
            source_db["poi_database"]["entries"].append(poi)
        
        with open(self.docs_dir / "miyakojima_database.json", 'w', encoding='utf-8') as f:
            json.dump(source_db, f, ensure_ascii=False, indent=2)
    
    def test_system_initialization(self):
        """Test complete system initialization."""
        orchestrator = POIExpansionOrchestrator(str(self.config_dir), "test")
        
        # System should initialize successfully
        self.assertTrue(orchestrator.initialize_system())
        self.assertTrue(orchestrator.is_initialized)
    
    def test_system_status(self):
        """Test system status reporting."""
        orchestrator = POIExpansionOrchestrator(str(self.config_dir), "test")
        orchestrator.initialize_system()
        
        status = orchestrator.get_system_status()
        
        self.assertIn('system', status)
        self.assertIn('pois', status)
        self.assertIn('backups', status)
        self.assertIn('configuration', status)
        
        # Should show 15 current POIs
        self.assertEqual(status['pois']['current_count'], 15)
    
    def test_expansion_phase_execution(self):
        """Test complete expansion phase execution."""
        orchestrator = POIExpansionOrchestrator(str(self.config_dir), "test")
        orchestrator.initialize_system()
        
        # Get initial count
        initial_status = orchestrator.get_system_status()
        initial_count = initial_status['pois']['current_count']
        
        # Execute Phase 1 expansion (15 → 30 POIs)
        success = orchestrator.execute_expansion_phase(ExpansionPhase.PHASE_1)
        self.assertTrue(success)
        
        # Verify expansion
        final_status = orchestrator.get_system_status()
        final_count = final_status['pois']['current_count']
        
        self.assertGreater(final_count, initial_count)
        self.assertLessEqual(final_count, 30)  # Should not exceed target
    
    def test_backup_and_restore_workflow(self):
        """Test complete backup and restore workflow."""
        orchestrator = POIExpansionOrchestrator(str(self.config_dir), "test")
        orchestrator.initialize_system()
        
        # Create manual backup
        backup_id = orchestrator.create_manual_backup("Integration test backup")
        self.assertIsNotNone(backup_id)
        
        # List backups
        backups = orchestrator.list_available_backups()
        self.assertGreater(len(backups), 0)
        
        # Find our backup
        our_backup = next((b for b in backups if backup_id in b['id']), None)
        self.assertIsNotNone(our_backup)
        
        # Verify backup contains correct POI count
        self.assertEqual(our_backup['poi_count'], 15)
        
        # Execute expansion to change state
        orchestrator.execute_expansion_phase(ExpansionPhase.PHASE_1)
        
        # Verify state changed
        status_after_expansion = orchestrator.get_system_status()
        expanded_count = status_after_expansion['pois']['current_count']
        self.assertGreater(expanded_count, 15)
        
        # Restore from backup
        restore_success = orchestrator.restore_from_backup(backup_id)
        self.assertTrue(restore_success)
        
        # Verify restoration
        status_after_restore = orchestrator.get_system_status()
        restored_count = status_after_restore['pois']['current_count']
        self.assertEqual(restored_count, 15)
    
    def test_data_validation_workflow(self):
        """Test data validation workflow."""
        orchestrator = POIExpansionOrchestrator(str(self.config_dir), "test")
        orchestrator.initialize_system()
        
        # Validate current data
        validation_result = orchestrator.validate_current_data()
        
        self.assertIsInstance(validation_result.is_valid, bool)
        self.assertIsInstance(validation_result.errors, list)
        self.assertIsInstance(validation_result.warnings, list)
        self.assertIsInstance(validation_result.metadata, dict)
        
        # Should be valid with our test data
        self.assertTrue(validation_result.is_valid)
    
    def test_expansion_recommendations(self):
        """Test expansion recommendation system."""
        orchestrator = POIExpansionOrchestrator(str(self.config_dir), "test")
        orchestrator.initialize_system()
        
        recommendations = orchestrator.get_expansion_recommendations()
        
        self.assertIn('next_phase', recommendations)
        self.assertIn('current_count', recommendations)
        self.assertIn('target_count', recommendations)
        self.assertIn('candidates_needed', recommendations)
        self.assertIn('category_targets', recommendations)
        
        # With 15 current POIs, should recommend Phase 1 (target: 30)
        self.assertEqual(recommendations['current_count'], 15)
        self.assertEqual(recommendations['next_phase'], 'phase_1')
        self.assertEqual(recommendations['target_count'], 30)
        self.assertEqual(recommendations['candidates_needed'], 15)
    
    def test_error_recovery(self):
        """Test system error recovery mechanisms."""
        orchestrator = POIExpansionOrchestrator(str(self.config_dir), "test")
        orchestrator.initialize_system()
        
        # Create backup before potential failure
        backup_id = orchestrator.create_manual_backup("Before error test")
        
        # Simulate data corruption by creating invalid POI data
        invalid_data = {
            "version": "2.0.0",
            "totalPOIs": 1,
            "pois": [{
                "id": "invalid_poi",
                "name": "Invalid POI",
                # Missing required fields to trigger validation failure
                "rating": 10.0  # Invalid rating
            }]
        }
        
        with open(self.data_dir / "miyakojima_pois.json", 'w') as f:
            json.dump(invalid_data, f)
        
        # Attempt expansion (should fail due to invalid data)
        success = orchestrator.execute_expansion_phase(ExpansionPhase.PHASE_1)
        
        # Expansion should fail gracefully
        self.assertFalse(success)
        
        # System should still be functional for restore
        restore_success = orchestrator.restore_from_backup(backup_id)
        self.assertTrue(restore_success)
        
        # Verify system recovered
        status = orchestrator.get_system_status()
        self.assertEqual(status['pois']['current_count'], 15)
    
    def test_multiple_phase_expansion(self):
        """Test multiple consecutive expansion phases."""
        orchestrator = POIExpansionOrchestrator(str(self.config_dir), "test")
        orchestrator.initialize_system()
        
        # Execute Phase 1
        success1 = orchestrator.execute_expansion_phase(ExpansionPhase.PHASE_1)
        self.assertTrue(success1)
        
        status1 = orchestrator.get_system_status()
        count1 = status1['pois']['current_count']
        self.assertGreater(count1, 15)
        
        # Execute Phase 2
        success2 = orchestrator.execute_expansion_phase(ExpansionPhase.PHASE_2)
        self.assertTrue(success2)
        
        status2 = orchestrator.get_system_status()
        count2 = status2['pois']['current_count']
        self.assertGreater(count2, count1)
        
        # Execute Phase 3
        success3 = orchestrator.execute_expansion_phase(ExpansionPhase.PHASE_3)
        self.assertTrue(success3)
        
        final_status = orchestrator.get_system_status()
        final_count = final_status['pois']['current_count']
        self.assertGreater(final_count, count2)
    
    def test_configuration_environment_switching(self):
        """Test switching between different configuration environments."""
        # Test with development environment
        orchestrator_dev = POIExpansionOrchestrator(str(self.config_dir), "test")
        self.assertTrue(orchestrator_dev.initialize_system())
        
        # Test with production environment  
        orchestrator_prod = POIExpansionOrchestrator(str(self.config_dir), "production")
        # Should fail because we don't have production config, but gracefully
        # (It will fall back to base config)
        self.assertTrue(orchestrator_prod.initialize_system())


if __name__ == '__main__':
    unittest.main()