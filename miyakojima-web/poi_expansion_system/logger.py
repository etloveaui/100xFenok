"""
Production Logger for POI Expansion System.

Implements structured logging with multiple output formats and levels.
"""

import logging
import logging.handlers
from typing import Dict, Any, Optional
from pathlib import Path
import json
from datetime import datetime

from .interfaces import ILogger, IConfigManager


class StructuredFormatter(logging.Formatter):
    """Structured JSON formatter for log records."""
    
    def format(self, record: logging.LogRecord) -> str:
        log_entry = {
            'timestamp': datetime.fromtimestamp(record.created).isoformat(),
            'level': record.levelname,
            'logger': record.name,
            'message': record.getMessage(),
            'module': record.module,
            'function': record.funcName,
            'line': record.lineno
        }
        
        # Add extra fields if present
        if hasattr(record, 'extra_data'):
            log_entry.update(record.extra_data)
        
        # Add exception info if present
        if record.exc_info:
            log_entry['exception'] = self.formatException(record.exc_info)
        
        return json.dumps(log_entry, ensure_ascii=False)


class ProductionLogger(ILogger):
    """
    Production-ready logger with multiple outputs and structured logging.
    
    Features:
    - File and console output
    - Structured JSON logging
    - Log rotation and retention
    - Performance metrics integration
    - Error tracking and alerting
    """
    
    def __init__(self, config_manager: IConfigManager, name: str = "poi_expansion"):
        self.config = config_manager
        self.logger = logging.getLogger(name)
        self._setup_logger()
    
    def _setup_logger(self) -> None:
        """Setup logger with configured handlers and formatters."""
        # Clear existing handlers
        self.logger.handlers.clear()
        
        # Set log level
        log_level = self.config.get_config('logging.level', 'INFO')
        self.logger.setLevel(getattr(logging, log_level))
        
        # Console handler with simple format
        console_handler = logging.StreamHandler()
        console_format = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
        console_handler.setFormatter(console_format)
        self.logger.addHandler(console_handler)
        
        # File handler with rotation
        log_file = self.config.get_config('logging.file', './logs/poi_expansion.log')
        log_path = Path(log_file)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        
        file_handler = logging.handlers.RotatingFileHandler(
            log_file,
            maxBytes=10*1024*1024,  # 10MB
            backupCount=5,
            encoding='utf-8'
        )
        file_handler.setFormatter(StructuredFormatter())
        self.logger.addHandler(file_handler)
        
        # Prevent propagation to root logger
        self.logger.propagate = False
    
    def info(self, message: str, **kwargs) -> None:
        """Log info message with optional structured data."""
        extra = {'extra_data': kwargs} if kwargs else None
        self.logger.info(message, extra=extra)
    
    def warning(self, message: str, **kwargs) -> None:
        """Log warning message with optional structured data."""
        extra = {'extra_data': kwargs} if kwargs else None
        self.logger.warning(message, extra=extra)
    
    def error(self, message: str, **kwargs) -> None:
        """Log error message with optional structured data."""
        extra = {'extra_data': kwargs} if kwargs else None
        self.logger.error(message, extra=extra)
    
    def debug(self, message: str, **kwargs) -> None:
        """Log debug message with optional structured data."""
        extra = {'extra_data': kwargs} if kwargs else None
        self.logger.debug(message, extra=extra)
    
    def critical(self, message: str, **kwargs) -> None:
        """Log critical message with optional structured data."""
        extra = {'extra_data': kwargs} if kwargs else None
        self.logger.critical(message, extra=extra)
    
    def log_performance(self, operation: str, duration_ms: float, **metrics) -> None:
        """Log performance metrics."""
        self.info(
            f"Performance: {operation}",
            operation=operation,
            duration_ms=duration_ms,
            **metrics
        )
    
    def log_expansion_event(self, 
                           event_type: str,
                           phase: str,
                           poi_count: int,
                           **details) -> None:
        """Log POI expansion specific events."""
        self.info(
            f"Expansion Event: {event_type}",
            event_type=event_type,
            expansion_phase=phase,
            poi_count=poi_count,
            **details
        )
    
    def log_validation_result(self,
                             poi_id: str,
                             is_valid: bool,
                             errors: list,
                             warnings: list) -> None:
        """Log POI validation results."""
        level_method = self.info if is_valid else self.error
        level_method(
            f"POI Validation: {poi_id} - {'PASS' if is_valid else 'FAIL'}",
            poi_id=poi_id,
            is_valid=is_valid,
            error_count=len(errors),
            warning_count=len(warnings),
            errors=errors,
            warnings=warnings
        )
    
    def log_backup_event(self,
                        event_type: str,
                        backup_id: str,
                        success: bool,
                        **details) -> None:
        """Log backup/recovery events."""
        level_method = self.info if success else self.error
        level_method(
            f"Backup Event: {event_type} - {'SUCCESS' if success else 'FAILED'}",
            event_type=event_type,
            backup_id=backup_id,
            success=success,
            **details
        )


def setup_logging(config_manager: IConfigManager) -> ProductionLogger:
    """Setup production logging system."""
    return ProductionLogger(config_manager)


def get_logger(name: str = "poi_expansion") -> logging.Logger:
    """Get configured logger instance."""
    return logging.getLogger(name)