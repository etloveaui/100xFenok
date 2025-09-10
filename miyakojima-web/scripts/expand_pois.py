#!/usr/bin/env python3
"""
POI Expansion CLI Script

Command-line interface for POI expansion system operations.
Supports Windows execution with comprehensive error handling.
"""

import sys
import argparse
import json
from pathlib import Path
from typing import Optional

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from poi_expansion_system.orchestrator import POIExpansionOrchestrator
from poi_expansion_system.interfaces import ExpansionPhase


def print_status(orchestrator: POIExpansionOrchestrator) -> None:
    """Print comprehensive system status."""
    status = orchestrator.get_system_status()
    
    print("\n" + "="*60)
    print("POI EXPANSION SYSTEM STATUS")
    print("="*60)
    
    # System status
    system = status.get('system', {})
    print(f"System Initialized: {system.get('initialized', False)}")
    print(f"Version: {system.get('version', 'Unknown')}")
    print(f"Environment: {system.get('environment', 'Unknown')}")
    
    # POI status
    pois = status.get('pois', {})
    print(f"\nCurrent POI Count: {pois.get('current_count', 0)}")
    print(f"Average Rating: {pois.get('average_rating', 0):.2f}")
    
    categories = pois.get('categories', {})
    if categories:
        print("\nCategory Distribution:")
        for category, count in categories.items():
            print(f"  {category}: {count} POIs")
    
    # Quality metrics
    quality = pois.get('quality_metrics', {})
    if quality:
        print("\nQuality Metrics:")
        for metric, value in quality.items():
            print(f"  {metric}: {value}")
    
    # Backup status
    backups = status.get('backups', {})
    print(f"\nBackup Status:")
    print(f"  Total Backups: {backups.get('total_backups', 0)}")
    print(f"  Latest Backup: {backups.get('latest_backup', 'None')}")
    print(f"  Total Size: {backups.get('total_size_mb', 0):.1f} MB")
    
    # Configuration status
    config = status.get('configuration', {})
    print(f"\nConfiguration:")
    print(f"  Valid: {config.get('valid', False)}")
    print(f"  Warnings: {config.get('warnings', 0)}")
    print(f"  Errors: {config.get('errors', 0)}")
    
    print("="*60 + "\n")


def print_recommendations(orchestrator: POIExpansionOrchestrator) -> None:
    """Print expansion recommendations."""
    recommendations = orchestrator.get_expansion_recommendations()
    
    if 'error' in recommendations:
        print(f"Error getting recommendations: {recommendations['error']}")
        return
    
    print("\n" + "="*60)
    print("EXPANSION RECOMMENDATIONS")
    print("="*60)
    
    print(f"Current Count: {recommendations.get('current_count', 0)} POIs")
    print(f"Next Phase: {recommendations.get('next_phase', 'Unknown')}")
    print(f"Target Count: {recommendations.get('target_count', 0)} POIs")
    print(f"Candidates Needed: {recommendations.get('candidates_needed', 0)}")
    
    priority_cats = recommendations.get('priority_categories', [])
    if priority_cats:
        print(f"Priority Categories: {', '.join(priority_cats)}")
    
    category_targets = recommendations.get('category_targets', {})
    if category_targets:
        print("\nCategory Targets:")
        for category, target in category_targets.items():
            current = recommendations.get('current_distribution', {}).get(category, 0)
            print(f"  {category}: {current} → {current + target}")
    
    action = recommendations.get('recommended_action', 'unknown')
    print(f"\nRecommended Action: {action.upper()}")
    
    print("="*60 + "\n")


def list_backups(orchestrator: POIExpansionOrchestrator) -> None:
    """List available backups."""
    backups = orchestrator.list_available_backups()
    
    if not backups:
        print("No backups available.")
        return
    
    print("\n" + "="*80)
    print("AVAILABLE BACKUPS")
    print("="*80)
    print(f"{'ID':<20} {'Phase':<15} {'POIs':<6} {'Timestamp':<20} {'Size':<10}")
    print("-"*80)
    
    for backup in backups:
        backup_id = backup['id'][:18] + ".." if len(backup['id']) > 20 else backup['id']
        phase = backup['phase']
        poi_count = backup['poi_count']
        timestamp = backup['timestamp']
        
        # Get file size
        try:
            file_path = Path(backup['file_path'])
            size_mb = file_path.stat().st_size / (1024 * 1024) if file_path.exists() else 0
            size_str = f"{size_mb:.1f}MB"
        except:
            size_str = "Unknown"
        
        print(f"{backup_id:<20} {phase:<15} {poi_count:<6} {timestamp:<20} {size_str:<10}")
    
    print("="*80 + "\n")


def main():
    """Main CLI entry point."""
    parser = argparse.ArgumentParser(
        description="POI Expansion System CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python scripts/expand_pois.py --status
  python scripts/expand_pois.py --expand phase-1
  python scripts/expand_pois.py --backup
  python scripts/expand_pois.py --restore 20250910_123456
  python scripts/expand_pois.py --validate
        """
    )
    
    # Commands
    parser.add_argument('--status', action='store_true', 
                       help='Show system status')
    parser.add_argument('--expand', choices=['phase-1', 'phase-2', 'phase-3'],
                       help='Execute expansion phase')
    parser.add_argument('--validate', action='store_true',
                       help='Validate current POI data')
    parser.add_argument('--backup', action='store_true',
                       help='Create manual backup')
    parser.add_argument('--restore', metavar='BACKUP_ID',
                       help='Restore from backup')
    parser.add_argument('--list-backups', action='store_true',
                       help='List available backups')
    parser.add_argument('--recommendations', action='store_true',
                       help='Show expansion recommendations')
    
    # Options
    parser.add_argument('--environment', choices=['production', 'development'],
                       default='production', help='Environment configuration')
    parser.add_argument('--config-dir', default='config',
                       help='Configuration directory path')
    parser.add_argument('--quiet', action='store_true',
                       help='Suppress verbose output')
    
    args = parser.parse_args()
    
    if not any([args.status, args.expand, args.validate, args.backup, 
                args.restore, args.list_backups, args.recommendations]):
        parser.print_help()
        return 1
    
    try:
        # Initialize orchestrator
        if not args.quiet:
            print("Initializing POI Expansion System...")
        
        orchestrator = POIExpansionOrchestrator(args.config_dir, args.environment)
        
        if not orchestrator.initialize_system():
            print("ERROR: System initialization failed!")
            return 1
        
        if not args.quiet:
            print("System initialized successfully.\n")
        
        # Execute commands
        if args.status:
            print_status(orchestrator)
        
        if args.recommendations:
            print_recommendations(orchestrator)
        
        if args.validate:
            print("Validating current POI data...")
            result = orchestrator.validate_current_data()
            
            if result.is_valid:
                print("[OK] Validation PASSED")
                if result.warnings:
                    print(f"[WARN] Warnings ({len(result.warnings)}):")
                    for warning in result.warnings[:5]:  # Show first 5
                        print(f"   - {warning}")
            else:
                print("[FAIL] Validation FAILED")
                print(f"Errors ({len(result.errors)}):")
                for error in result.errors[:5]:  # Show first 5
                    print(f"   - {error}")
                return 1
        
        if args.backup:
            print("Creating manual backup...")
            backup_id = orchestrator.create_manual_backup("Manual backup via CLI")
            
            if backup_id:
                print(f"[OK] Backup created: {backup_id}")
            else:
                print("[FAIL] Backup creation failed")
                return 1
        
        if args.restore:
            print(f"Restoring from backup: {args.restore}")
            success = orchestrator.restore_from_backup(args.restore)
            
            if success:
                print("[OK] Restore completed successfully")
            else:
                print("[FAIL] Restore failed")
                return 1
        
        if args.list_backups:
            list_backups(orchestrator)
        
        if args.expand:
            # Map phase names to enum values
            phase_map = {
                'phase-1': ExpansionPhase.PHASE_1,
                'phase-2': ExpansionPhase.PHASE_2,
                'phase-3': ExpansionPhase.PHASE_3
            }
            
            phase = phase_map[args.expand]
            print(f"Executing expansion {args.expand}...")
            
            success = orchestrator.execute_expansion_phase(phase)
            
            if success:
                print("[OK] Expansion completed successfully!")
                if not args.quiet:
                    print_status(orchestrator)
            else:
                print("[FAIL] Expansion failed!")
                return 1
        
        return 0
        
    except KeyboardInterrupt:
        print("\n\nOperation cancelled by user.")
        return 130
        
    except Exception as e:
        print(f"\nERROR: {e}")
        if not args.quiet:
            import traceback
            traceback.print_exc()
        return 1


if __name__ == '__main__':
    exit(main())