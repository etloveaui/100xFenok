"""
Configuration management for POI Expansion System

Provides flexible configuration through environment variables, 
config files, and command-line arguments.
"""

import os
import json
from pathlib import Path
from typing import Dict, Any, Optional
from dataclasses import dataclass, field, asdict


@dataclass
class ExpansionConfig:
    """Enhanced configuration with environment variable support."""
    
    # File paths
    source_database_path: str = "docs/knowledge/miyakojima_database.json"
    current_pois_path: str = "data/miyakojima_pois.json"
    backup_dir: str = "backups"
    log_dir: str = "logs"
    
    # Expansion settings
    target_total_pois: int = 100  # Phase 3 target
    current_pois_count: int = 50  # Updated after Phase 2 completion
    
    # Geographic bounds for Miyakojima
    lat_min: float = 24.6
    lat_max: float = 24.9
    lng_min: float = 125.1
    lng_max: float = 125.5
    
    # Data quality settings
    min_rating_threshold: float = 3.5  # Lowered for Phase 3 to expand candidate pool
    maintain_proportional_distribution: bool = True
    duplicate_distance_threshold: float = 0.001
    
    # Safety settings
    max_pois_per_run: int = 50  # Updated for Phase 3: 50→100 POIs
    backup_retention_days: int = 30
    
    @property
    def pois_to_add(self) -> int:
        """Calculate number of POIs to add."""
        return max(0, self.target_total_pois - self.current_pois_count)
    
    @property
    def coordinate_bounds(self) -> Dict[str, tuple]:
        """Get coordinate bounds as dictionary."""
        return {
            "lat": (self.lat_min, self.lat_max),
            "lng": (self.lng_min, self.lng_max)
        }
    
    @property
    def required_fields(self) -> list:
        """Get list of required POI fields."""
        return [
            "name", "nameEn", "category", "rating", 
            "coordinates", "description", "features"
        ]
    
    def validate(self) -> tuple[bool, list]:
        """
        Validate configuration values.
        
        Returns:
            Tuple of (is_valid, error_messages)
        """
        errors = []
        
        # Validate coordinate bounds
        if self.lat_min >= self.lat_max:
            errors.append("lat_min must be less than lat_max")
        if self.lng_min >= self.lng_max:
            errors.append("lng_min must be less than lng_max")
            
        # Validate expansion settings
        if self.target_total_pois <= self.current_pois_count:
            errors.append("target_total_pois must be greater than current_pois_count")
        if self.pois_to_add > self.max_pois_per_run:
            errors.append(f"Trying to add {self.pois_to_add} POIs, but max_pois_per_run is {self.max_pois_per_run}")
            
        # Validate file paths
        if self.source_database_path:
            source_path = Path(self.source_database_path)
        else:
            errors.append("source_database_path is not set")
            source_path = None
            
        if self.current_pois_path:
            current_path = Path(self.current_pois_path)
        else:
            errors.append("current_pois_path is not set")
            current_path = None
        
        if source_path and not source_path.exists():
            errors.append(f"Source database not found: {self.source_database_path}")
        if current_path and not current_path.exists():
            errors.append(f"Current POI file not found: {self.current_pois_path}")
            
        # Validate numeric ranges
        if not 1.0 <= self.min_rating_threshold <= 5.0:
            errors.append("min_rating_threshold must be between 1.0 and 5.0")
        if self.duplicate_distance_threshold <= 0:
            errors.append("duplicate_distance_threshold must be positive")
            
        return len(errors) == 0, errors
    
    @classmethod
    def from_env(cls) -> 'ExpansionConfig':
        """Create configuration from environment variables."""
        config = cls()
        
        # Override with environment variables if they exist
        env_mappings = {
            'POI_SOURCE_DB': 'source_database_path',
            'POI_CURRENT_FILE': 'current_pois_path',
            'POI_BACKUP_DIR': 'backup_dir',
            'POI_LOG_DIR': 'log_dir',
            'POI_TARGET_TOTAL': 'target_total_pois',
            'POI_CURRENT_COUNT': 'current_pois_count',
            'POI_LAT_MIN': 'lat_min',
            'POI_LAT_MAX': 'lat_max',
            'POI_LNG_MIN': 'lng_min',
            'POI_LNG_MAX': 'lng_max',
            'POI_MIN_RATING': 'min_rating_threshold',
            'POI_PROPORTIONAL': 'maintain_proportional_distribution',
            'POI_DUPLICATE_THRESHOLD': 'duplicate_distance_threshold',
            'POI_MAX_PER_RUN': 'max_pois_per_run',
            'POI_BACKUP_RETENTION': 'backup_retention_days'
        }
        
        for env_var, attr_name in env_mappings.items():
            env_value = os.getenv(env_var)
            if env_value is not None:
                attr_value = getattr(config, attr_name)
                
                # Type conversion based on current attribute type
                if isinstance(attr_value, bool):
                    setattr(config, attr_name, env_value.lower() in ('true', '1', 'yes', 'on'))
                elif isinstance(attr_value, int):
                    setattr(config, attr_name, int(env_value))
                elif isinstance(attr_value, float):
                    setattr(config, attr_name, float(env_value))
                else:
                    setattr(config, attr_name, env_value)
        
        return config
    
    @classmethod
    def from_file(cls, config_path: str) -> 'ExpansionConfig':
        """Create configuration from JSON file."""
        config_file = Path(config_path)
        
        if not config_file.exists():
            raise FileNotFoundError(f"Configuration file not found: {config_path}")
            
        with open(config_file, 'r', encoding='utf-8') as f:
            config_data = json.load(f)
            
        config = cls()
        
        # Update configuration with file values
        for key, value in config_data.items():
            if hasattr(config, key):
                setattr(config, key, value)
            else:
                print(f"Warning: Unknown configuration key '{key}' in {config_path}")
                
        return config
    
    def to_file(self, config_path: str) -> None:
        """Save configuration to JSON file."""
        config_file = Path(config_path)
        config_file.parent.mkdir(parents=True, exist_ok=True)
        
        with open(config_file, 'w', encoding='utf-8') as f:
            json.dump(asdict(self), f, indent=2, ensure_ascii=False)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert configuration to dictionary."""
        return asdict(self)
    
    def summary(self) -> str:
        """Get configuration summary for logging."""
        return f"""
Configuration Summary:
├── Source Database: {self.source_database_path}
├── Current POIs: {self.current_pois_path}
├── Target Total: {self.target_total_pois} POIs
├── POIs to Add: {self.pois_to_add} POIs
├── Coordinate Bounds: lat({self.lat_min}-{self.lat_max}), lng({self.lng_min}-{self.lng_max})
├── Min Rating: {self.min_rating_threshold}
├── Proportional Distribution: {self.maintain_proportional_distribution}
├── Backup Directory: {self.backup_dir}
└── Log Directory: {self.log_dir}
        """.strip()


class ConfigManager:
    """Manages configuration loading and validation."""
    
    def __init__(self):
        self.config: Optional[ExpansionConfig] = None
        
    def load_config(self, 
                   config_file: Optional[str] = None, 
                   use_env: bool = True,
                   **overrides) -> ExpansionConfig:
        """
        Load configuration with precedence: overrides > file > env > defaults
        
        Args:
            config_file: Path to configuration file (optional)
            use_env: Whether to use environment variables
            **overrides: Direct configuration overrides
            
        Returns:
            ExpansionConfig: Loaded and validated configuration
        """
        # Start with defaults
        if use_env:
            config = ExpansionConfig.from_env()
        else:
            config = ExpansionConfig()
            
        # Override with file if provided
        if config_file:
            try:
                file_config = ExpansionConfig.from_file(config_file)
                # Merge file config
                for key, value in asdict(file_config).items():
                    if value != getattr(ExpansionConfig(), key):  # Only non-default values
                        setattr(config, key, value)
            except Exception as e:
                print(f"Warning: Could not load config file {config_file}: {e}")
                
        # Apply direct overrides
        for key, value in overrides.items():
            if hasattr(config, key):
                setattr(config, key, value)
            else:
                print(f"Warning: Unknown configuration key '{key}'")
                
        # Validate configuration
        is_valid, errors = config.validate()
        if not is_valid:
            raise ValueError(f"Invalid configuration:\n" + "\n".join(f"  - {error}" for error in errors))
            
        self.config = config
        return config
    
    def create_sample_config(self, output_path: str = "config/expansion_config.json") -> None:
        """Create a sample configuration file."""
        sample_config = ExpansionConfig()
        sample_config.to_file(output_path)
        print(f"Sample configuration created at: {output_path}")
    
    def validate_current_setup(self) -> Dict[str, Any]:
        """Validate current project setup and return status."""
        if not self.config:
            return {"valid": False, "error": "No configuration loaded"}
            
        validation_result = {
            "valid": True,
            "checks": {},
            "warnings": [],
            "errors": []
        }
        
        # Check file existence
        files_to_check = [
            ("source_database", self.config.source_database_path),
            ("current_pois", self.config.current_pois_path)
        ]
        
        for name, path in files_to_check:
            exists = Path(path).exists()
            validation_result["checks"][f"{name}_exists"] = exists
            if not exists:
                validation_result["errors"].append(f"Missing file: {path}")
        
        # Check directories
        dirs_to_check = [
            ("backup_dir", self.config.backup_dir),
            ("log_dir", self.config.log_dir)
        ]
        
        for name, dir_path in dirs_to_check:
            dir_exists = Path(dir_path).exists()
            validation_result["checks"][f"{name}_exists"] = dir_exists
            if not dir_exists:
                validation_result["warnings"].append(f"Directory will be created: {dir_path}")
                
        # Check current POI count
        if validation_result["checks"].get("current_pois_exists", False):
            try:
                with open(self.config.current_pois_path, 'r', encoding='utf-8') as f:
                    current_data = json.load(f)
                    actual_count = len(current_data.get("pois", []))
                    expected_count = self.config.current_pois_count
                    
                validation_result["checks"]["poi_count_match"] = (actual_count == expected_count)
                validation_result["checks"]["actual_poi_count"] = actual_count
                validation_result["checks"]["expected_poi_count"] = expected_count
                
                if actual_count != expected_count:
                    validation_result["warnings"].append(
                        f"POI count mismatch: found {actual_count}, expected {expected_count}"
                    )
                    
            except Exception as e:
                validation_result["errors"].append(f"Could not read current POI file: {e}")
                
        # Set overall validity
        validation_result["valid"] = len(validation_result["errors"]) == 0
        
        return validation_result


# Default configuration instance
default_config_manager = ConfigManager()


def get_config(**overrides) -> ExpansionConfig:
    """Convenience function to get configuration."""
    return default_config_manager.load_config(**overrides)


def validate_setup() -> None:
    """Convenience function to validate current setup."""
    config_manager = ConfigManager()
    config_manager.load_config()
    
    result = config_manager.validate_current_setup()
    
    print("=== Project Setup Validation ===")
    
    if result["valid"]:
        print("✅ Setup is valid")
    else:
        print("❌ Setup has issues")
        
    # Show checks
    for check_name, check_result in result["checks"].items():
        status = "✅" if check_result else "❌"
        print(f"{status} {check_name}: {check_result}")
        
    # Show warnings
    if result["warnings"]:
        print("\n⚠️  Warnings:")
        for warning in result["warnings"]:
            print(f"   • {warning}")
            
    # Show errors
    if result["errors"]:
        print("\n❌ Errors:")
        for error in result["errors"]:
            print(f"   • {error}")
            
    print(f"\nConfiguration Summary:")
    print(config_manager.config.summary())


if __name__ == "__main__":
    # Command-line interface for configuration management
    import argparse
    
    parser = argparse.ArgumentParser(description="POI Expansion Configuration Manager")
    subparsers = parser.add_subparsers(dest="command", help="Available commands")
    
    # Validate command
    validate_parser = subparsers.add_parser("validate", help="Validate current setup")
    
    # Create sample command
    sample_parser = subparsers.add_parser("create-sample", help="Create sample configuration file")
    sample_parser.add_argument("--output", "-o", default="config/expansion_config.json", 
                              help="Output path for sample config")
    
    # Show config command
    show_parser = subparsers.add_parser("show", help="Show current configuration")
    show_parser.add_argument("--config-file", "-c", help="Configuration file to load")
    
    args = parser.parse_args()
    
    if args.command == "validate":
        validate_setup()
    elif args.command == "create-sample":
        manager = ConfigManager()
        manager.create_sample_config(args.output)
    elif args.command == "show":
        manager = ConfigManager()
        config = manager.load_config(config_file=args.config_file)
        print(config.summary())
    else:
        parser.print_help()