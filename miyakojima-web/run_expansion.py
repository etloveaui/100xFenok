#!/usr/bin/env python3
"""
Simple CLI runner for POI Expansion System

Provides an easy-to-use interface for expanding POIs with safety features.
"""

import sys
import argparse
from pathlib import Path
from expansion_config import ConfigManager
from poi_expansion_main import POIExpansionSystem


def print_banner():
    """Print application banner."""
    print("=" * 60)
    print("   Miyakojima Travel Web App - POI Expansion System")
    print("   Production-Grade POI Database Expansion Tool")
    print("=" * 60)
    print()


def print_results(result):
    """Print expansion results in a formatted way."""
    if not result["success"]:
        print("[ERROR] Expansion Failed")
        print(f"Error: {result.get('error', 'Unknown error')}")
        return
        
    if result["dry_run"]:
        print("[DRY RUN] Results (No changes made)")
        print(f"|- Current POIs: {result['original_count']}")
        print(f"|- Would add: {result['would_add_count']} POIs")
        print(f"+- Would total: {result['would_be_total']} POIs")
        
        print(f"\nCurrent Distribution:")
        for category, count in result["current_distribution"].items():
            print(f"   {category}: {count}")
            
        print(f"\nWould Add Distribution:")
        for category, count in result["selection_distribution"].items():
            print(f"   {category}: {count}")
            
        print(f"\nPreview of Selected POIs:")
        for i, poi in enumerate(result.get("selected_pois", [])[:5], 1):
            print(f"   {i}. {poi['name']} ({poi['category']}) - Rating: {poi['rating']}")
            
    else:
        print("[SUCCESS] Expansion Completed Successfully")
        print(f"|- Original POIs: {result['original_count']}")
        print(f"|- Added POIs: {result['added_count']}")
        print(f"|- New total: {result['new_total']}")
        print(f"+- Backup created: {Path(result['backup_path']).name}")
        
        print(f"\nOriginal Distribution:")
        for category, count in result["current_distribution"].items():
            print(f"   {category}: {count}")
            
        print(f"\nAdded Distribution:")
        for category, count in result["selection_distribution"].items():
            print(f"   {category}: {count}")
            
        # Show verification results
        verification = result.get("verification", {})
        if verification:
            print(f"\n[STATS] Verification Results:")
            coord_val = verification.get("coordinate_validation", {})
            quality_val = verification.get("data_quality", {})
            
            print(f"   Coordinate Validation: [SUCCESS] {coord_val.get('passed', 0)} passed, [ERROR] {coord_val.get('failed', 0)} failed")
            print(f"   Data Quality: [SUCCESS] {quality_val.get('passed', 0)} passed, [ERROR] {quality_val.get('failed', 0)} failed")
            
            if coord_val.get("failed", 0) > 0 or quality_val.get("failed", 0) > 0:
                print("   [WARNING]  Some validation issues found. Check logs for details.")
                
            print(f"\nFinal Category Distribution:")
            for category, count in verification.get("category_balance", {}).items():
                print(f"   {category}: {count}")


def confirm_expansion(config):
    """Ask for user confirmation before expansion."""
    print("[PLAN] Expansion Plan:")
    print(f"   Current POIs: {config.current_pois_count}")
    print(f"   Target Total: {config.target_total_pois}")
    print(f"   POIs to Add: {config.pois_to_add}")
    print(f"   Source Database: {config.source_database_path}")
    print(f"   Current POI File: {config.current_pois_path}")
    print(f"   Backup Directory: {config.backup_dir}")
    print()
    
    while True:
        response = input("Proceed with expansion? (y/N): ").lower()
        if response in ['y', 'yes']:
            return True
        elif response in ['n', 'no', '']:
            return False
        else:
            print("Please enter 'y' for yes or 'n' for no.")


def main():
    """Main entry point."""
    print_banner()
    
    parser = argparse.ArgumentParser(
        description="Miyakojima POI Expansion System",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python run_expansion.py                    # Interactive expansion
  python run_expansion.py --dry-run          # Preview what would be done
  python run_expansion.py --yes              # Skip confirmation
  python run_expansion.py --target 60        # Set custom target
  python run_expansion.py --rollback BACKUP  # Rollback to backup
  python run_expansion.py --list-backups     # Show available backups
        """
    )
    
    # Main operation arguments
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be done without making changes"
    )
    parser.add_argument(
        "--yes", "-y",
        action="store_true",
        help="Skip confirmation prompt"
    )
    parser.add_argument(
        "--target",
        type=int,
        help="Target total number of POIs (default: 50)"
    )
    
    # Configuration arguments
    parser.add_argument(
        "--config",
        help="Configuration file path"
    )
    parser.add_argument(
        "--source-db",
        help="Source database file path"
    )
    parser.add_argument(
        "--current-pois",
        help="Current POI file path"
    )
    
    # Backup and rollback
    parser.add_argument(
        "--rollback",
        help="Rollback to specified backup file"
    )
    parser.add_argument(
        "--list-backups",
        action="store_true",
        help="List available backup files"
    )
    
    # Validation
    parser.add_argument(
        "--validate-setup",
        action="store_true",
        help="Validate current project setup"
    )
    
    # Verbosity
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable verbose output"
    )
    
    args = parser.parse_args()
    
    try:
        # Initialize configuration manager
        config_manager = ConfigManager()
        
        # Handle validation command
        if args.validate_setup:
            overrides = {}
            if args.target:
                overrides['target_total_pois'] = args.target
            if args.source_db:
                overrides['source_database_path'] = args.source_db
            if args.current_pois:
                overrides['current_pois_path'] = args.current_pois
                
            config = config_manager.load_config(
                config_file=args.config,
                use_env=False,
                **overrides
            )
            
            result = config_manager.validate_current_setup()
            
            print("[VALIDATION] Project Setup Validation")
            print("-" * 30)
            
            if result["valid"]:
                print("[PASS] Setup is valid and ready for expansion")
            else:
                print("[FAIL] Setup has issues that need to be resolved")
                
            # Show detailed results
            for check_name, check_result in result["checks"].items():
                status = "[PASS]" if check_result else "[FAIL]"
                print(f"{status} {check_name.replace('_', ' ').title()}")
                
            if result["warnings"]:
                print(f"\n[WARNING] Warnings:")
                for warning in result["warnings"]:
                    print(f"   - {warning}")
                    
            if result["errors"]:
                print(f"\n[ERROR] Errors:")
                for error in result["errors"]:
                    print(f"   - {error}")
                    
            if args.verbose:
                print(f"\n[CONFIG] Configuration:")
                print(config.summary())
                
            return 0 if result["valid"] else 1
        
        # Load configuration with overrides
        overrides = {}
        if args.target:
            overrides['target_total_pois'] = args.target
        if args.source_db:
            overrides['source_database_path'] = args.source_db
        if args.current_pois:
            overrides['current_pois_path'] = args.current_pois
            
        config = config_manager.load_config(
            config_file=args.config,
            use_env=False,  # Don't use environment variables by default
            **overrides
        )
        
        # Initialize expansion system
        expansion_system = POIExpansionSystem(config)
        
        # Handle backup listing
        if args.list_backups:
            print("[BACKUPS] Available Backups:")
            backups = expansion_system.list_backups()
            if backups:
                for i, backup in enumerate(backups, 1):
                    backup_path = Path(backup)
                    print(f"   {i}. {backup_path.name}")
                    if args.verbose:
                        print(f"      Path: {backup}")
            else:
                print("   No backups found.")
            return 0
        
        # Handle rollback
        if args.rollback:
            print(f"[ROLLBACK] Rolling back to: {args.rollback}")
            
            if not args.yes:
                confirm = input("This will overwrite current POI data. Continue? (y/N): ").lower()
                if confirm not in ['y', 'yes']:
                    print("Rollback cancelled.")
                    return 0
                    
            success = expansion_system.rollback(args.rollback)
            
            if success:
                print("[SUCCESS] Rollback completed successfully.")
                return 0
            else:
                print("[ERROR] Rollback failed. Check logs for details.")
                return 1
        
        # Handle expansion
        if args.verbose:
            print("[PLAN] Configuration Summary:")
            print(config.summary())
            print()
            
        # Validate setup before proceeding
        validation = config_manager.validate_current_setup()
        if not validation["valid"]:
            print("[ERROR] Setup validation failed:")
            for error in validation["errors"]:
                print(f"   • {error}")
            print("\nPlease fix these issues before running expansion.")
            return 1
            
        if validation["warnings"] and args.verbose:
            print("[WARNING]  Setup warnings:")
            for warning in validation["warnings"]:
                print(f"   • {warning}")
            print()
        
        # Confirm expansion (unless --yes or --dry-run)
        if not args.dry_run and not args.yes:
            if not confirm_expansion(config):
                print("Expansion cancelled by user.")
                return 0
        
        # Run expansion
        print("[START] Starting POI expansion...")
        if args.dry_run:
            print("   (Dry run mode - no changes will be made)")
        print()
        
        result = expansion_system.expand_pois(dry_run=args.dry_run)
        
        # Print results
        print_results(result)
        
        if result["success"]:
            if not args.dry_run:
                print(f"\n[SAVED] Data updated successfully!")
                print(f"   POI file: {config.current_pois_path}")
                print(f"   Backup: {config.backup_dir}")
                print(f"   Logs: {config.log_dir}")
            return 0
        else:
            return 1
            
    except KeyboardInterrupt:
        print("\n\nOperation cancelled by user.")
        return 1
    except Exception as e:
        print(f"\nError: {e}")
        if args.verbose:
            import traceback
            traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())