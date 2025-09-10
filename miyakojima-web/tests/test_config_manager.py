"""
Unit tests for ConfigManager.

Tests configuration loading, validation, and environment handling.
"""

import unittest
import tempfile
import json
from pathlib import Path
from poi_expansion_system.config_manager import ConfigManager


class TestConfigManager(unittest.TestCase):
    """Test cases for ConfigManager functionality."""
    
    def setUp(self):
        """Set up test fixtures."""
        self.temp_dir = tempfile.mkdtemp()
        self.config_dir = Path(self.temp_dir) / "config"
        self.config_dir.mkdir()
        
        # Create test configuration files
        base_config = {
            "data_paths": {
                "current_pois": "./data/test.json",
                "source_database": "./docs/test.json"
            },
            "categories": {
                "beaches": "해변",
                "restaurants": "음식점"
            },
            "validation": {
                "miyakojima_bounds": {
                    "lat_min": 24.6,
                    "lat_max": 24.9,
                    "lng_min": 125.1,
                    "lng_max": 125.5
                }
            }
        }
        
        with open(self.config_dir / "base.json", 'w') as f:
            json.dump(base_config, f)
        
        # Environment override
        prod_config = {
            "logging": {
                "level": "INFO"
            }
        }
        
        with open(self.config_dir / "production.json", 'w') as f:
            json.dump(prod_config, f)
    
    def test_initialization(self):
        """Test ConfigManager initialization."""
        config = ConfigManager(str(self.config_dir), "production")
        
        self.assertEqual(config.environment, "production")
        self.assertIsInstance(config._config, dict)
    
    def test_config_loading(self):
        """Test configuration file loading."""
        config = ConfigManager(str(self.config_dir), "production")
        
        # Test base config loading
        self.assertEqual(
            config.get_config("data_paths.current_pois"),
            "./data/test.json"
        )
        
        # Test environment override
        self.assertEqual(config.get_config("logging.level"), "INFO")
    
    def test_get_config_with_dot_notation(self):
        """Test get_config with dot notation."""
        config = ConfigManager(str(self.config_dir), "production")
        
        # Single level
        self.assertIsInstance(config.get_config("categories"), dict)
        
        # Nested level
        self.assertEqual(
            config.get_config("validation.miyakojima_bounds.lat_min"),
            24.6
        )
        
        # Non-existent key with default
        self.assertEqual(
            config.get_config("non.existent.key", "default"),
            "default"
        )
        
        # Non-existent key without default
        self.assertIsNone(config.get_config("non.existent.key"))
    
    def test_set_config(self):
        """Test setting configuration values."""
        config = ConfigManager(str(self.config_dir), "production")
        
        # Set new value
        config.set_config("test.new_value", 42)
        self.assertEqual(config.get_config("test.new_value"), 42)
        
        # Override existing value
        config.set_config("logging.level", "DEBUG")
        self.assertEqual(config.get_config("logging.level"), "DEBUG")
    
    def test_config_validation(self):
        """Test configuration validation."""
        config = ConfigManager(str(self.config_dir), "production")
        result = config.validate_config()
        
        self.assertIsInstance(result.is_valid, bool)
        self.assertIsInstance(result.errors, list)
        self.assertIsInstance(result.warnings, list)
        self.assertIsInstance(result.metadata, dict)
    
    def test_default_config_fallback(self):
        """Test fallback to default configuration."""
        # Use non-existent directory
        config = ConfigManager("/non/existent/path", "test")
        
        # Should still have default config
        self.assertIsInstance(config.get_config("categories"), dict)
        self.assertGreater(len(config.get_config("categories")), 0)
    
    def test_save_config(self):
        """Test configuration saving."""
        config = ConfigManager(str(self.config_dir), "production")
        config.set_config("test.saved_value", "test123")
        
        # Save to custom path
        save_path = self.config_dir / "test_save.json"
        success = config.save_config(str(save_path))
        
        self.assertTrue(success)
        self.assertTrue(save_path.exists())
        
        # Verify saved content
        with open(save_path) as f:
            saved_config = json.load(f)
        
        self.assertEqual(saved_config["test"]["saved_value"], "test123")
    
    def test_reload_config(self):
        """Test configuration reloading."""
        config = ConfigManager(str(self.config_dir), "production")
        
        # Modify config file
        new_config = {"test_reload": "success"}
        with open(self.config_dir / "production.json", 'w') as f:
            json.dump(new_config, f)
        
        # Reload
        config.reload_config()
        
        # Should have new value
        self.assertEqual(config.get_config("test_reload"), "success")


if __name__ == '__main__':
    unittest.main()