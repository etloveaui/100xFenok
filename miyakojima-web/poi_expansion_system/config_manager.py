"""
Configuration Manager for POI Expansion System.

Implements Single Responsibility Principle by handling only configuration management.
Provides environment-specific configuration loading and validation.
"""

import os
import json
import logging
from typing import Any, Dict, Optional
from pathlib import Path

from .interfaces import IConfigManager, ValidationResult


class ConfigManager(IConfigManager):
    """
    Production-ready configuration manager with environment support.
    
    Features:
    - Environment-specific configuration
    - Configuration validation
    - Default value handling
    - Runtime configuration updates
    """
    
    def __init__(self, config_dir: str = "config", environment: str = "production"):
        self.config_dir = Path(config_dir)
        self.environment = environment
        self._config: Dict[str, Any] = {}
        self._load_configuration()
    
    def _load_configuration(self) -> None:
        """Load configuration from files."""
        try:
            # Load base configuration
            base_config_path = self.config_dir / "base.json"
            if base_config_path.exists():
                with open(base_config_path, 'r', encoding='utf-8') as f:
                    self._config = json.load(f)
            else:
                self._config = self._get_default_config()
            
            # Load environment-specific overrides
            env_config_path = self.config_dir / f"{self.environment}.json"
            if env_config_path.exists():
                with open(env_config_path, 'r', encoding='utf-8') as f:
                    env_config = json.load(f)
                    self._merge_config(env_config)
            
            logging.info(f"Configuration loaded for environment: {self.environment}")
            
        except Exception as e:
            logging.error(f"Failed to load configuration: {e}")
            self._config = self._get_default_config()
    
    def _merge_config(self, override_config: Dict[str, Any]) -> None:
        """Merge override configuration with base configuration."""
        for key, value in override_config.items():
            if isinstance(value, dict) and key in self._config:
                if isinstance(self._config[key], dict):
                    self._config[key].update(value)
                else:
                    self._config[key] = value
            else:
                self._config[key] = value
    
    def _get_default_config(self) -> Dict[str, Any]:
        """Get default configuration."""
        return {
            "data_paths": {
                "current_pois": "./data/miyakojima_pois.json",
                "source_database": "./docs/knowledge/miyakojima_database.json",
                "backup_dir": "./backups/pois"
            },
            "expansion_phases": {
                "phase_1": {"target": 50, "increment": 25},
                "phase_2": {"target": 100, "increment": 50}, 
                "phase_3": {"target": 175, "increment": 75}
            },
            "validation": {
                "miyakojima_bounds": {
                    "lat_min": 24.6,
                    "lat_max": 24.9,
                    "lng_min": 125.1,
                    "lng_max": 125.5
                },
                "required_fields": [
                    "id", "name", "nameEn", "category", "rating", 
                    "coordinates", "description", "features"
                ],
                "rating_range": {"min": 1.0, "max": 5.0}
            },
            "categories": {
                "beaches": "해변",
                "activities": "액티비티",
                "restaurants": "음식점", 
                "culture": "문화",
                "nature": "자연",
                "shopping": "쇼핑"
            },
            "backup": {
                "max_backups": 10,
                "auto_backup": True,
                "compression": True
            },
            "logging": {
                "level": "INFO",
                "format": "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
                "file": "./logs/poi_expansion.log"
            },
            "performance": {
                "batch_size": 50,
                "memory_limit_mb": 512,
                "timeout_seconds": 300
            }
        }
    
    def get_config(self, key: str, default: Any = None) -> Any:
        """
        Get configuration value using dot notation.
        
        Args:
            key: Configuration key (supports dot notation like 'data_paths.current_pois')
            default: Default value if key not found
        
        Returns:
            Configuration value or default
        """
        try:
            keys = key.split('.')
            value = self._config
            
            for k in keys:
                if isinstance(value, dict) and k in value:
                    value = value[k]
                else:
                    return default
            
            return value
            
        except Exception as e:
            logging.error(f"Error getting config key '{key}': {e}")
            return default
    
    def set_config(self, key: str, value: Any) -> None:
        """
        Set configuration value using dot notation.
        
        Args:
            key: Configuration key (supports dot notation)
            value: Value to set
        """
        try:
            keys = key.split('.')
            config = self._config
            
            # Navigate to parent of target key
            for k in keys[:-1]:
                if k not in config or not isinstance(config[k], dict):
                    config[k] = {}
                config = config[k]
            
            # Set the value
            config[keys[-1]] = value
            logging.debug(f"Configuration updated: {key} = {value}")
            
        except Exception as e:
            logging.error(f"Error setting config key '{key}': {e}")
    
    def validate_config(self) -> ValidationResult:
        """
        Validate current configuration.
        
        Returns:
            ValidationResult with validation status and any issues
        """
        errors = []
        warnings = []
        
        try:
            # Validate required sections
            required_sections = ['data_paths', 'expansion_phases', 'validation', 'categories']
            for section in required_sections:
                if section not in self._config:
                    errors.append(f"Missing required configuration section: {section}")
            
            # Validate data paths
            if 'data_paths' in self._config:
                current_pois_path = self.get_config('data_paths.current_pois')
                if current_pois_path and not Path(current_pois_path).parent.exists():
                    warnings.append(f"Current POIs directory may not exist: {current_pois_path}")
            
            # Validate expansion phases
            if 'expansion_phases' in self._config:
                phases = self._config['expansion_phases']
                expected_targets = [50, 100, 175]
                for i, (phase_key, phase_config) in enumerate(phases.items()):
                    if 'target' not in phase_config:
                        errors.append(f"Phase {phase_key} missing 'target' configuration")
                    elif phase_config['target'] != expected_targets[i]:
                        warnings.append(f"Phase {phase_key} target {phase_config['target']} != expected {expected_targets[i]}")
            
            # Validate miyakojima bounds
            bounds = self.get_config('validation.miyakojima_bounds')
            if bounds:
                required_bounds = ['lat_min', 'lat_max', 'lng_min', 'lng_max']
                for bound in required_bounds:
                    if bound not in bounds:
                        errors.append(f"Missing coordinate bound: {bound}")
            
            # Validate categories
            categories = self.get_config('categories')
            if not categories or len(categories) < 3:
                warnings.append("Less than 3 categories defined, expansion may be limited")
            
            is_valid = len(errors) == 0
            metadata = {
                'config_sections': len(self._config),
                'environment': self.environment
            }
            
            return ValidationResult(is_valid, errors, warnings, metadata)
            
        except Exception as e:
            return ValidationResult(False, [f"Configuration validation failed: {e}"], [], {})
    
    def save_config(self, config_path: Optional[str] = None) -> bool:
        """
        Save current configuration to file.
        
        Args:
            config_path: Optional path to save config, defaults to environment config
        
        Returns:
            True if successful, False otherwise
        """
        try:
            if not config_path:
                config_path = self.config_dir / f"{self.environment}.json"
            else:
                config_path = Path(config_path)
            
            # Ensure directory exists
            config_path.parent.mkdir(parents=True, exist_ok=True)
            
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump(self._config, f, indent=2, ensure_ascii=False)
            
            logging.info(f"Configuration saved to: {config_path}")
            return True
            
        except Exception as e:
            logging.error(f"Failed to save configuration: {e}")
            return False
    
    def get_all_config(self) -> Dict[str, Any]:
        """Get complete configuration dictionary."""
        return self._config.copy()
    
    def reload_config(self) -> None:
        """Reload configuration from files."""
        self._load_configuration()