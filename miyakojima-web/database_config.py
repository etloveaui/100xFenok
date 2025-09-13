"""
Database Configuration Management for Future Integration

Provides templates and utilities for database connectivity and configuration
management in preparation for migration from JSON to database storage.
"""

import os
from dataclasses import dataclass, field
from typing import Dict, Any, Optional, Union
from enum import Enum
import json


class DatabaseType(Enum):
    """Supported database types for future integration."""
    MYSQL = "mysql"
    POSTGRESQL = "postgresql"
    MONGODB = "mongodb"
    SQLITE = "sqlite"


@dataclass
class DatabaseConfig:
    """Database connection configuration template."""
    
    # Connection details
    database_type: DatabaseType = DatabaseType.POSTGRESQL
    host: str = "localhost"
    port: int = 5432
    database: str = "miyakojima_pois"
    username: str = ""
    password: str = ""
    
    # Connection pool settings
    min_connections: int = 1
    max_connections: int = 10
    connection_timeout: int = 30
    idle_timeout: int = 300
    
    # SSL/Security
    ssl_enabled: bool = True
    ssl_cert_path: Optional[str] = None
    ssl_key_path: Optional[str] = None
    
    # Schema settings
    schema_name: str = "public"
    table_prefix: str = "miyako_"
    
    # Migration settings
    enable_migrations: bool = True
    migration_table: str = "schema_migrations"
    
    def to_connection_string(self) -> str:
        """Generate database connection string."""
        if self.database_type == DatabaseType.POSTGRESQL:
            return (f"postgresql://{self.username}:{self.password}@"
                   f"{self.host}:{self.port}/{self.database}")
        elif self.database_type == DatabaseType.MYSQL:
            return (f"mysql://{self.username}:{self.password}@"
                   f"{self.host}:{self.port}/{self.database}")
        elif self.database_type == DatabaseType.MONGODB:
            return (f"mongodb://{self.username}:{self.password}@"
                   f"{self.host}:{self.port}/{self.database}")
        elif self.database_type == DatabaseType.SQLITE:
            return f"sqlite:///{self.database}"
        else:
            raise ValueError(f"Unsupported database type: {self.database_type}")


@dataclass
class SpreadsheetConfig:
    """Spreadsheet integration configuration for Google Sheets/Excel."""
    
    # Google Sheets configuration
    google_sheets_enabled: bool = False
    google_credentials_path: str = "credentials/google_service_account.json"
    google_sheet_id: str = ""
    google_worksheet_name: str = "POIs"
    
    # Excel configuration
    excel_enabled: bool = False
    excel_file_path: str = "data/miyakojima_pois.xlsx"
    excel_worksheet_name: str = "POIs"
    
    # Synchronization settings
    sync_interval_minutes: int = 30
    auto_sync_enabled: bool = False
    conflict_resolution: str = "database_wins"  # database_wins, sheet_wins, manual
    
    # Data validation
    validate_coordinates: bool = True
    validate_categories: bool = True
    require_rating: bool = True


class ConfigManager:
    """Configuration manager for database and spreadsheet integration."""
    
    def __init__(self, config_file: Optional[str] = None):
        self.config_file = config_file or "config/database_config.json"
        self.database_config = DatabaseConfig()
        self.spreadsheet_config = SpreadsheetConfig()
        
    def load_from_file(self, file_path: str) -> Dict[str, Any]:
        """Load configuration from JSON file."""
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except FileNotFoundError:
            return {}
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON in config file {file_path}: {e}")
    
    def save_to_file(self, file_path: str, config: Dict[str, Any]):
        """Save configuration to JSON file."""
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
    
    def load_database_config(self) -> DatabaseConfig:
        """Load database configuration with environment variable overrides."""
        config_data = self.load_from_file(self.config_file)
        db_config = config_data.get("database", {})
        
        # Environment variable overrides
        env_overrides = {
            "host": os.getenv("DB_HOST"),
            "port": int(os.getenv("DB_PORT", "5432")),
            "database": os.getenv("DB_NAME"),
            "username": os.getenv("DB_USER"),
            "password": os.getenv("DB_PASSWORD"),
            "ssl_enabled": os.getenv("DB_SSL_ENABLED", "true").lower() == "true",
        }
        
        # Apply overrides if values are not None
        for key, value in env_overrides.items():
            if value is not None:
                db_config[key] = value
        
        # Update database config with loaded values
        for key, value in db_config.items():
            if hasattr(self.database_config, key):
                if key == "database_type" and isinstance(value, str):
                    setattr(self.database_config, key, DatabaseType(value))
                else:
                    setattr(self.database_config, key, value)
        
        return self.database_config
    
    def load_spreadsheet_config(self) -> SpreadsheetConfig:
        """Load spreadsheet configuration."""
        config_data = self.load_from_file(self.config_file)
        sheet_config = config_data.get("spreadsheet", {})
        
        # Environment variable overrides
        env_overrides = {
            "google_sheet_id": os.getenv("GOOGLE_SHEET_ID"),
            "google_credentials_path": os.getenv("GOOGLE_CREDENTIALS_PATH"),
            "excel_file_path": os.getenv("EXCEL_FILE_PATH"),
        }
        
        # Apply overrides
        for key, value in env_overrides.items():
            if value is not None:
                sheet_config[key] = value
        
        # Update spreadsheet config
        for key, value in sheet_config.items():
            if hasattr(self.spreadsheet_config, key):
                setattr(self.spreadsheet_config, key, value)
        
        return self.spreadsheet_config
    
    def generate_sample_config(self) -> Dict[str, Any]:
        """Generate sample configuration file."""
        return {
            "database": {
                "database_type": "postgresql",
                "host": "localhost",
                "port": 5432,
                "database": "miyakojima_pois",
                "username": "miyako_user",
                "password": "secure_password_here",
                "ssl_enabled": True,
                "min_connections": 1,
                "max_connections": 10,
                "schema_name": "public",
                "table_prefix": "miyako_"
            },
            "spreadsheet": {
                "google_sheets_enabled": False,
                "google_credentials_path": "credentials/google_service_account.json",
                "google_sheet_id": "your_google_sheet_id_here",
                "excel_enabled": True,
                "excel_file_path": "data/miyakojima_pois.xlsx",
                "sync_interval_minutes": 30,
                "auto_sync_enabled": False,
                "conflict_resolution": "database_wins"
            },
            "validation": {
                "coordinate_bounds": {
                    "lat_min": 24.6,
                    "lat_max": 24.9,
                    "lng_min": 125.1,
                    "lng_max": 125.5
                },
                "required_fields": ["name", "category", "coordinates", "rating"],
                "min_rating": 1.0,
                "max_rating": 5.0
            }
        }
    
    def validate_database_config(self) -> Dict[str, Any]:
        """Validate database configuration."""
        issues = []
        
        if not self.database_config.host:
            issues.append("Database host is required")
        
        if not self.database_config.database:
            issues.append("Database name is required")
        
        if not self.database_config.username:
            issues.append("Database username is required")
        
        if not self.database_config.password:
            issues.append("Database password is required")
        
        if self.database_config.port < 1 or self.database_config.port > 65535:
            issues.append("Database port must be between 1 and 65535")
        
        return {
            "valid": len(issues) == 0,
            "issues": issues
        }
    
    def test_connection(self) -> Dict[str, Any]:
        """Test database connection (placeholder for future implementation)."""
        # This will be implemented when database integration is ready
        return {
            "success": False,
            "message": "Database integration not yet implemented",
            "connection_string": self.database_config.to_connection_string()
        }


def create_sample_config_file():
    """Create a sample configuration file for users to customize."""
    config_manager = ConfigManager()
    sample_config = config_manager.generate_sample_config()
    
    config_path = "config/database_config.json.example"
    config_manager.save_to_file(config_path, sample_config)
    
    print(f"Sample configuration created at: {config_path}")
    print("Copy this file to config/database_config.json and customize it for your environment.")


if __name__ == "__main__":
    # Create sample configuration when run directly
    create_sample_config_file()