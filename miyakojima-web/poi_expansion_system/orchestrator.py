"""
Main Orchestrator for POI Expansion System.

Coordinates all components following Open/Closed Principle for extensibility.
Provides high-level API for POI expansion operations.
"""

import logging
from typing import List, Dict, Any, Optional
from pathlib import Path
import time

from .interfaces import (
    POIRecord, ExpansionPhase, ValidationResult, 
    IConfigManager, IDataValidator, IBackupManager
)
from .config_manager import ConfigManager
from .quality_validator import QualityValidator
from .backup_manager import BackupManager
from .data_manager import POIDataManager
from .expansion_engine import ExpansionEngine, ExpansionPlan
from .logger import ProductionLogger


class POIExpansionOrchestrator:
    """
    Main orchestrator for POI expansion system.
    
    Coordinates all system components and provides high-level operations:
    - System initialization and health checks
    - Phased expansion execution
    - Quality validation and monitoring
    - Backup and recovery operations
    - Performance monitoring
    """
    
    def __init__(self, config_dir: str = "config", environment: str = "production"):
        """Initialize orchestrator with all components."""
        # Initialize core components
        self.config_manager = ConfigManager(config_dir, environment)
        self.logger = ProductionLogger(self.config_manager)
        
        # Initialize system components
        self.validator = QualityValidator(self.config_manager)
        self.backup_manager = BackupManager(self.config_manager)
        self.data_manager = POIDataManager(self.config_manager, self.validator)
        self.expansion_engine = ExpansionEngine(self.config_manager, self.validator)
        
        # System state
        self.is_initialized = False
        self._current_poi_count = 0
        
        self.logger.info("POI Expansion Orchestrator initialized", environment=environment)
    
    def initialize_system(self) -> bool:
        """
        Initialize and validate the entire system.
        
        Returns:
            True if initialization successful
        """
        try:
            start_time = time.time()
            
            self.logger.info("Starting system initialization...")
            
            # Validate configuration
            config_validation = self.config_manager.validate_config()
            if not config_validation.is_valid:
                self.logger.error("Configuration validation failed", errors=config_validation.errors)
                return False
            
            if config_validation.warnings:
                self.logger.warning("Configuration warnings", warnings=config_validation.warnings)
            
            # Check data file accessibility
            current_pois_path = Path(self.config_manager.get_config('data_paths.current_pois'))
            if not current_pois_path.exists():
                self.logger.error(f"Current POI file not found: {current_pois_path}")
                return False
            
            source_db_path = Path(self.config_manager.get_config('data_paths.source_database'))
            if not source_db_path.exists():
                self.logger.error(f"Source database not found: {source_db_path}")
                return False
            
            # Load and validate current POI data
            try:
                current_pois = self.data_manager.load_pois()
                validation_result = self.validator.validate_poi_list(current_pois)
                
                if not validation_result.is_valid:
                    self.logger.error("Current POI data validation failed", errors=validation_result.errors)
                    return False
                
                self._current_poi_count = len(current_pois)
                self.logger.info(f"Current POI data validated: {self._current_poi_count} POIs")
                
            except Exception as e:
                self.logger.error(f"Failed to load current POI data: {e}")
                return False
            
            # Test backup system
            try:
                backup_dir = Path(self.config_manager.get_config('data_paths.backup_dir'))
                backup_dir.mkdir(parents=True, exist_ok=True)
                
                # Create test backup to verify system
                test_backup = self.backup_manager.create_checkpoint(ExpansionPhase.PHASE_1)
                self.logger.info("Backup system verified", backup_id=test_backup.timestamp)
                
            except Exception as e:
                self.logger.error(f"Backup system test failed: {e}")
                return False
            
            # System initialization complete
            duration_ms = (time.time() - start_time) * 1000
            self.is_initialized = True
            
            self.logger.log_performance("system_initialization", duration_ms)
            self.logger.info("System initialization completed successfully")
            
            return True
            
        except Exception as e:
            self.logger.error(f"System initialization failed: {e}")
            return False
    
    def get_system_status(self) -> Dict[str, Any]:
        """Get comprehensive system status."""
        try:
            current_pois = self.data_manager.load_pois()
            poi_stats = self.data_manager.get_poi_statistics(current_pois)
            
            # Check backup system
            backups = self.backup_manager.list_backups()
            backup_size = self.backup_manager.get_total_backup_size()
            
            # Configuration status
            config_validation = self.config_manager.validate_config()
            
            status = {
                'system': {
                    'initialized': self.is_initialized,
                    'version': '1.0.0',
                    'environment': self.config_manager.environment
                },
                'pois': {
                    'current_count': len(current_pois),
                    'categories': poi_stats['categories'],
                    'average_rating': poi_stats['ratings']['average'],
                    'quality_metrics': poi_stats['quality_metrics']
                },
                'backups': {
                    'total_backups': len(backups),
                    'latest_backup': backups[0].timestamp if backups else None,
                    'total_size_mb': backup_size / (1024 * 1024)
                },
                'configuration': {
                    'valid': config_validation.is_valid,
                    'warnings': len(config_validation.warnings),
                    'errors': len(config_validation.errors)
                }
            }
            
            return status
            
        except Exception as e:
            self.logger.error(f"Failed to get system status: {e}")
            return {'error': str(e)}
    
    def execute_expansion_phase(self, phase: ExpansionPhase) -> bool:
        """
        Execute complete expansion phase with all safety checks.
        
        Args:
            phase: Expansion phase to execute
        
        Returns:
            True if expansion successful
        """
        if not self.is_initialized:
            self.logger.error("System not initialized")
            return False
        
        try:
            start_time = time.time()
            phase_name = phase.value
            
            self.logger.log_expansion_event("phase_start", phase_name, self._current_poi_count)
            
            # Step 1: Create pre-expansion backup
            self.logger.info(f"Creating pre-expansion backup for {phase_name}")
            backup_metadata = self.backup_manager.create_checkpoint(phase)
            
            try:
                # Step 2: Load current and source data
                current_pois = self.data_manager.load_pois()
                source_candidates = self.data_manager.load_source_database()
                
                if not source_candidates:
                    self.logger.error("No source candidates available")
                    return False
                
                # Step 3: Create expansion plan
                expansion_plan = self.expansion_engine.create_expansion_plan(current_pois, phase)
                
                self.logger.info(
                    f"Expansion plan created: {expansion_plan.current_count} → {expansion_plan.target_count}",
                    candidates_needed=expansion_plan.candidates_needed,
                    priority_categories=expansion_plan.priority_categories
                )
                
                # Step 4: Execute expansion
                expanded_pois = self.expansion_engine.execute_expansion(
                    current_pois,
                    expansion_plan, 
                    source_candidates
                )
                
                if len(expanded_pois) <= len(current_pois):
                    self.logger.error("No POIs were added during expansion")
                    return False
                
                # Step 5: Final validation
                final_validation = self.validator.validate_poi_list(expanded_pois)
                
                if not final_validation.is_valid:
                    self.logger.error("Final validation failed", errors=final_validation.errors)
                    # Restore from backup
                    self.backup_manager.restore_checkpoint(backup_metadata.timestamp)
                    return False
                
                # Step 6: Save expanded data
                success = self.data_manager.save_pois(expanded_pois)
                
                if not success:
                    self.logger.error("Failed to save expanded POI data")
                    # Restore from backup
                    self.backup_manager.restore_checkpoint(backup_metadata.timestamp)
                    return False
                
                # Step 7: Update system state
                self._current_poi_count = len(expanded_pois)
                
                # Step 8: Log success metrics
                duration_ms = (time.time() - start_time) * 1000
                pois_added = len(expanded_pois) - len(current_pois)
                
                self.logger.log_performance(f"expansion_phase_{phase_name}", duration_ms, pois_added=pois_added)
                self.logger.log_expansion_event(
                    "phase_complete", 
                    phase_name, 
                    len(expanded_pois),
                    pois_added=pois_added,
                    duration_ms=duration_ms
                )
                
                return True
                
            except Exception as e:
                # Restore from backup on any error
                self.logger.error(f"Expansion failed, restoring backup: {e}")
                restore_success = self.backup_manager.restore_checkpoint(backup_metadata.timestamp)
                
                if not restore_success:
                    self.logger.critical("CRITICAL: Backup restoration failed!")
                
                return False
                
        except Exception as e:
            self.logger.error(f"Expansion phase {phase.value} failed: {e}")
            return False
    
    def validate_current_data(self) -> ValidationResult:
        """Validate current POI data comprehensively."""
        try:
            current_pois = self.data_manager.load_pois()
            return self.validator.validate_poi_list(current_pois)
            
        except Exception as e:
            self.logger.error(f"Data validation failed: {e}")
            return ValidationResult(False, [f"Validation error: {e}"], [], {})
    
    def create_manual_backup(self, description: str = "") -> Optional[str]:
        """Create manual backup with description."""
        try:
            backup = self.backup_manager.create_manual_backup(description)
            self.logger.log_backup_event("manual_backup", backup.timestamp, True, description=description)
            return backup.timestamp
            
        except Exception as e:
            self.logger.log_backup_event("manual_backup", "", False, error=str(e))
            return None
    
    def restore_from_backup(self, backup_id: str) -> bool:
        """Restore system from backup."""
        try:
            success = self.backup_manager.restore_checkpoint(backup_id)
            
            if success:
                # Update system state
                current_pois = self.data_manager.load_pois()
                self._current_poi_count = len(current_pois)
            
            self.logger.log_backup_event("restore", backup_id, success)
            return success
            
        except Exception as e:
            self.logger.log_backup_event("restore", backup_id, False, error=str(e))
            return False
    
    def list_available_backups(self) -> List[Dict[str, Any]]:
        """List all available backups with metadata."""
        try:
            backups = self.backup_manager.list_backups()
            return [
                {
                    'id': backup.timestamp,
                    'phase': backup.phase,
                    'poi_count': backup.poi_count,
                    'timestamp': backup.timestamp,
                    'file_path': backup.file_path,
                    'checksum': backup.checksum
                }
                for backup in backups
            ]
            
        except Exception as e:
            self.logger.error(f"Failed to list backups: {e}")
            return []
    
    def get_expansion_recommendations(self) -> Dict[str, Any]:
        """Get recommendations for next expansion phase."""
        try:
            current_pois = self.data_manager.load_pois()
            current_count = len(current_pois)
            
            # Determine next phase
            if current_count < 50:
                next_phase = ExpansionPhase.PHASE_1
            elif current_count < 100:
                next_phase = ExpansionPhase.PHASE_2
            else:
                next_phase = ExpansionPhase.PHASE_3
            
            # Create expansion plan
            plan = self.expansion_engine.create_expansion_plan(current_pois, next_phase)
            
            # Get current statistics
            stats = self.data_manager.get_poi_statistics(current_pois)
            
            recommendations = {
                'next_phase': next_phase.value,
                'current_count': current_count,
                'target_count': plan.target_count,
                'candidates_needed': plan.candidates_needed,
                'category_targets': plan.category_targets,
                'priority_categories': plan.priority_categories,
                'current_distribution': stats['categories'],
                'recommended_action': 'proceed' if plan.candidates_needed > 0 else 'complete'
            }
            
            return recommendations
            
        except Exception as e:
            self.logger.error(f"Failed to get recommendations: {e}")
            return {'error': str(e)}